/* Scope engine: dataset.
 * Flattens an AUM engine result into analysis-ready records with a field registry, for the pivot and grid.
 * Pure: no DOM, runs in Node. Memoised on result identity.
 *
 * Second engine in the chain aum.js → dataset.js → pivot.js (loaded in that order by index.html). It
 * adds no new business rules: every amount, rating and bucket is read from the AUM result, so Explorer
 * figures tie to the AUM page. What it adds is shape: one flat record per position (or per Output row),
 * a field registry that tells the pivot how to aggregate, weight, order and format each field, and
 * derived band dimensions. Because the result is memoised in a WeakMap keyed by the engine result, a
 * platform or currency switch (which produces a new result) rebuilds the dataset exactly once.
 *
 *   Scope.engine.dataset.build(res)        → { records, fields, fieldById }   one record per position (excluded ones carry excluded:"Yes")
 *   Scope.engine.dataset.buildAssets(res)  → { records, fields, fieldById }   one record per Output row (asset grain)
 *   Scope.engine.dataset.assetRecords(res) → buildAssets(res).records
 *
 * Dimensions are strings ("(blank)" is never stored; blanks are ""), dates are ISO strings, measures are numbers.
 * Amounts are in the display currency in full units (like the engine's *_base fields); field.unit (= config amount unit)
 * and field.format() turn them into millions for display. NaN on a measure means "no value" (skipped by wavg/avg, 0 in sums).
 *
 * Field shape: { id, label, kind:'dimension'|'measure', type:'string'|'number'|'date', group, get(rec), format(v),
 *                agg, weight(rec), perAsset, distinctKey(rec), sortRank(value), unit, unitLabel }
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const E = (Scope.engine = Scope.engine || {});
  const DS = (E.dataset = {});

  const BLANK = '(blank)';
  DS.BLANK = BLANK;

  // engine result → built dataset (WeakMap so an old result and its dataset can be garbage-collected together)
  const memoPositions = new WeakMap(), memoAssets = new WeakMap();

  // ---------- helpers ----------
  // str: any value → string, blanks as ''; num: finite number or NaN ("no value", skipped by averages);
  // num0: finite number or 0 (amounts, so sums never turn into NaN); iso / year: Date → 'yyyy-mm-dd' / 'yyyy';
  // pick: property with a default when absent.
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const num = (v) => (U.isNum(v) ? v : NaN);
  const num0 = (v) => (U.isNum(v) ? v : 0);
  const iso = (d) => (d instanceof Date && !isNaN(d) ? U.isoDate(d) : '');
  const year = (d) => (d instanceof Date && !isNaN(d) ? String(d.getUTCFullYear()) : '');
  const pick = (obj, name, dflt) => (obj && obj[name] !== undefined ? obj[name] : dflt);

  /**
   * Band a numeric value into config-style edges ("0-3,3-5,5+"). Returns "" for non-numeric.
   * "a-b" bands are half-open [a, b) and "a+" is open-ended; the band label is the edge text plus
   * an optional suffix (' y'). Values below every band give "Negative" (if < 0) or "Other".
   */
  DS.band = function (v, edges, suffix) {
    if (!U.isNum(v)) return '';
    for (const b of edges) {
      const m = b.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
      if (m && v >= +m[1] && v < +m[2]) return b + (suffix || '');
      const p = b.match(/^(-?\d+(?:\.\d+)?)\s*\+$/);
      if (p && v >= +p[1]) return b + (suffix || '');
    }
    return v < 0 ? 'Negative' : 'Other';
  };
  // Band edges come from the calculation settings (keys below) when present, else these defaults.
  const edgesFrom = (cfg, key, dflt) => str(cfg && cfg.raw && cfg.raw[key] ? cfg.raw[key] : dflt).split(',').map((s) => s.trim()).filter(Boolean);
  const DEFAULT_EDGES = {
    remaining_years_bands: '0-1,1-3,3-5,5-7,7-10,10-15,15+',
    wal_bands: '0-3,3-5,5-7,7-10,10-15,15+',
    spread_bands: '0-100,100-150,150-200,200-250,250-300,300-400,400+',
    size_bands: '0-10,10-25,25-50,50-100,100-250,250+',
  };

  /**
   * Rank helper for ordinal dimensions: a function value → number; blanks always last (Infinity).
   * Values not in `order` rank after the listed ones (or at `fallback`). Used as field.sortRank by the pivot.
   */
  function orderRank(order, fallback) {
    const idx = new Map(order.map((v, i) => [String(v), i]));
    return (v) => { const s = str(v); if (!s || s === BLANK) return Infinity; return idx.has(s) ? idx.get(s) : (fallback === undefined ? order.length : fallback); };
  }
  // Years and ranks sort numerically, dates chronologically; unparseable values go just before blanks.
  const numericRank = (v) => { const s = str(v); if (!s || s === BLANK) return Infinity; const n = U.toNumber(s); return U.isNum(n) ? n : 1e15; };
  const dateRank = (v) => { const s = str(v); if (!s || s === BLANK) return Infinity; const t = Date.parse(s); return isNaN(t) ? 1e15 : t; };
  // Bands sort in edge order, then Negative, Other.
  const bandRank = (edges) => orderRank(edges.concat(['Negative', 'Other']));

  // ---------- context shared by both grains ----------
  /**
   * Settings and lookups derived once per engine result: amount unit and its label ("EUR m"),
   * display currency, attribution label (config attribution_label, default "Group"), platform weight
   * per investor, ordinal ranks (ratings, investors, investor groups, maturity buckets), band edges
   * and an asset_code → asset map.
   */
  function context(res) {
    const cfg = res.config || { unit: 1e6, buckets: ['0-3', '3-5', '5-10', '10-20', '20+'], raw: {} };
    const unit = U.isNum(cfg.unit) && cfg.unit > 0 ? cfg.unit : 1e6;
    const ccy = res.displayCurrency || cfg.base_currency || 'EUR';
    const attribution = str(cfg.raw && cfg.raw.attribution_label) || 'Group';
    const unitLabel = ccy + (unit === 1e6 ? ' m' : unit === 1e3 ? ' k' : unit === 1e9 ? ' bn' : '');
    // platform weight per investor label (Σ matching composition rows; '*' matches every investor).
    // This is the Output!G8 platform selector: exposure = nominal × this weight, and weight > 0 means platform member.
    const comp = (res.platform && res.platform.composition) || [{ label: '*', weight: 1 }];
    const weightOf = (label) => { let w = 0; for (const c of comp) if (c.label === '*' || c.label === label) w += U.isNum(c.weight) ? c.weight : 1; return w; };
    // ordinal orders
    // Ratings sort by the numeric of the ratings.csv scale (grades seen only on positions are added from
    // their own numeric); unknown grades sort after known ones, then NR, then blanks.
    const ratingRankMap = new Map();
    for (const r of res.ratingScale || []) ratingRankMap.set(String(r.grade).toUpperCase(), r.numeric);
    for (const p of res.positions || []) if (p.rating && U.isNum(p.rating.current_numeric) && p.rating.current_numeric > 0 && p.rating.current_grade) { const k = String(p.rating.current_grade).toUpperCase(); if (!ratingRankMap.has(k)) ratingRankMap.set(k, p.rating.current_numeric); }
    const ratingRank = (v) => { const s = str(v); if (!s || s === BLANK) return Infinity; const k = s.toUpperCase(); if (k === 'NR') return 1e9; return ratingRankMap.has(k) ? ratingRankMap.get(k) : 1e8; };
    // Investors keep the workbook's investor-column order (mapping_investors.csv); investor groups are ordered
    // by their largest attribution weight (the attributed group first), then by name.
    const investors = res.investors || [];
    const investorRank = orderRank(investors.map((i) => i.label));
    const groupWeights = new Map();
    for (const i of investors) { const w = num0(pick(i, 'group_weight', 0)); const g = str(i.group); if (!groupWeights.has(g) || groupWeights.get(g) < w) groupWeights.set(g, w); }
    const groupOrder = Array.from(groupWeights.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]);
    const investorGroupRank = orderRank(groupOrder);
    // Maturity buckets in config order ("0-3 y", "3-5 y", ...), then Matured and Unknown.
    const bucketRank = orderRank((cfg.buckets || []).map((b) => b + ' y').concat(['Matured', 'Unknown']));
    const edges = {
      remaining_years_band: edgesFrom(cfg, 'remaining_years_bands', DEFAULT_EDGES.remaining_years_bands),
      wal_band: edgesFrom(cfg, 'wal_bands', DEFAULT_EDGES.wal_bands),
      spread_band: edgesFrom(cfg, 'spread_bands', DEFAULT_EDGES.spread_bands),
      size_band: edgesFrom(cfg, 'size_bands', DEFAULT_EDGES.size_bands),
    };
    const assetsByCode = new Map();
    for (const a of res.assets || []) assetsByCode.set(a.code, a);
    return { cfg, unit, ccy, attribution, unitLabel, weightOf, ratingRank, investorRank, investorGroupRank, bucketRank, edges, assetsByCode };
  }

  // ---------- field registry ----------
  /**
   * Field definitions for one grain ('positions' or 'assets'), in display order within each group.
   * Builders: dim (string dimension, counted), date (dimension sorted chronologically), amt (amount in
   * full units, summed, shown in millions), measure (plain number with its own aggregation).
   * Grain-specific fields: tranche / holding / investor dimensions only exist per position; rank,
   * "<Group> invested", drawn % and protected life only per asset.
   */
  function makeFields(ctx, grain) {
    const F = [];
    // Amounts are stored in full units and shown in the display unit (millions); position-currency amounts in full.
    const fmtM = (v) => U.fmt.m(U.isNum(v) ? v / ctx.unit : NaN);
    const fmtCcy = (v) => (U.isNum(v) ? U.fmt.amount(v) : '–');
    const dim = (id, label, group, opts) => F.push(Object.assign({ id, label, kind: 'dimension', type: 'string', group, get: (r) => r[id], format: (v) => (v === '' || v === null || v === undefined ? BLANK : String(v)), agg: 'count', distinctKey: (r) => r[id] }, opts || {}));
    const date = (id, label, group, opts) => dim(id, label, group, Object.assign({ type: 'date', sortRank: dateRank, format: (v) => (v ? U.fmt.date(U.parseDate(v)) : BLANK) }, opts || {}));
    const amt = (id, label, group, opts) => F.push(Object.assign({ id, label, kind: 'measure', type: 'number', group, get: (r) => r[id], format: fmtM, agg: 'sum', unit: ctx.unit, unitLabel: ctx.unitLabel, weight: null }, opts || {}));
    const measure = (id, label, group, opts) => F.push(Object.assign({ id, label, kind: 'measure', type: 'number', group, get: (r) => r[id], format: (v) => U.fmt.n1(v), agg: 'sum', unit: 1, unitLabel: '' }, opts || {}));
    const wExposure = (r) => r.exposure;
    const A = ctx.attribution;

    // Asset
    dim('asset_code', 'Asset code', 'Asset'); dim('asset_name', 'Asset name', 'Asset'); dim('code_name', 'Code name', 'Asset');
    dim('sector', 'Sector', 'Asset'); dim('subsector', 'Subsector', 'Asset'); dim('country', 'Country', 'Asset'); dim('region', 'Region', 'Asset');
    dim('sponsor', 'Sponsor', 'Asset'); dim('greenfield_brownfield', 'Greenfield / brownfield', 'Asset', { sortRank: orderRank(['Greenfield', 'Brownfield']) });
    dim('repayment_type', 'Repayment type', 'Asset'); dim('cash_flow_type', 'Cash-flow type', 'Asset'); dim('instrument', 'Instrument', 'Asset'); dim('origination', 'Origination', 'Asset');
    dim('deal_year', 'Deal year', 'Asset', { sortRank: numericRank }); dim('deal_lead', 'Deal lead', 'Asset');
    dim('watchlist', 'Watchlist', 'Asset', { sortRank: orderRank(['No', 'Watch', 'Intensive']) }); dim('covenant_type', 'Covenant type', 'Asset');
    // Position
    if (grain === 'positions') {
      dim('tranche', 'Tranche', 'Position'); dim('holding_id', 'Holding ID', 'Position'); dim('security_name', 'Security name', 'Position');
      dim('position_key', 'Position key', 'Position');
    }
    dim('currency', 'Currency', 'Position'); date('as_of_date', 'As-of date', 'Position');
    dim('excluded', 'Excluded', 'Position', { sortRank: orderRank(['No', 'Yes']) }); dim('exclusion_reason', 'Exclusion reason', 'Position'); dim('flags', 'Flags', 'Position');
    if (grain === 'assets') dim('rank', 'Rank', 'Asset', { sortRank: numericRank });
    // Investor
    if (grain === 'positions') {
      dim('investor_label', 'Investor', 'Investor', { sortRank: ctx.investorRank }); dim('investor_key', 'Investor key', 'Investor');
      dim('investor_group', 'Investor group', 'Investor', { sortRank: ctx.investorGroupRank });
      dim('platform_member', 'Platform member', 'Investor', { sortRank: orderRank(['Yes', 'No']) });
    } else {
      dim('group_invested', A + ' invested', 'Investor', { sortRank: orderRank(['Yes', 'No']) });
    }
    // Credit
    dim('rating', 'Rating', 'Credit', { sortRank: ctx.ratingRank }); dim('ig_label', 'IG / Sub-IG', 'Credit', { sortRank: orderRank(['IG', 'SUB IG', 'NR']) });
    dim('rating_status', 'Rating status', 'Credit', { sortRank: orderRank(['rated', 'NR']) });
    dim('internal_grade', 'Internal grade', 'Credit', { sortRank: ctx.ratingRank }); dim('external_grade', 'External grade', 'Credit', { sortRank: ctx.ratingRank });
    dim('fitch', 'Fitch', 'Credit', { sortRank: ctx.ratingRank }); dim('moodys', "Moody's", 'Credit', { sortRank: ctx.ratingRank }); dim('sp', 'S&P', 'Credit', { sortRank: ctx.ratingRank });
    // Terms
    dim('fixed_floating', 'Fixed / floating', 'Terms', { sortRank: orderRank(['Fixed', 'Floating']) });
    dim('maturity_bucket', 'Maturity bucket', 'Terms', { sortRank: ctx.bucketRank });
    dim('maturity_year', 'Maturity year', 'Terms', { sortRank: numericRank }); dim('funding_year', 'Funding year', 'Terms', { sortRank: numericRank });
    date('maturity_date', 'Maturity date', 'Terms'); date('funding_date', 'Funding date', 'Terms');
    // ESG
    dim('green_loan', 'Green loan', 'ESG', { sortRank: orderRank(['Y', 'N']) }); dim('cbi_taxonomy', 'CBI taxonomy', 'ESG'); dim('sfdr_article', 'SFDR article', 'ESG'); dim('data_coverage', 'ESG data coverage', 'ESG');
    // Derived bands (behave like real dimensions)
    dim('remaining_years_band', 'Remaining years band', 'Derived', { sortRank: bandRank(ctx.edges.remaining_years_band) });
    dim('wal_band', 'WAL band', 'Derived', { sortRank: bandRank(ctx.edges.wal_band) });
    dim('spread_band', 'Margin band (bps)', 'Derived', { sortRank: bandRank(ctx.edges.spread_band) });
    dim('size_band', 'Size band (' + ctx.unitLabel + ')', 'Derived', { sortRank: bandRank(ctx.edges.size_band) });

    // Amounts (display currency). Exposure / attributed / third party follow the workbook's look-through:
    // attributed = Σ group_weight × investor amount, third party = total − attributed.
    amt('nominal', 'Nominal', 'Amounts', { title: 'Position nominal in ' + ctx.ccy + ' (all investors)' });
    amt('drawn', 'Drawn', 'Amounts'); amt('undrawn', 'Undrawn', 'Amounts'); amt('commitment', 'Commitment', 'Amounts');
    amt('exposure', 'Exposure', 'Amounts', { title: 'Nominal × platform weight of the investor (selected platform)' });
    amt('exposure_drawn', 'Exposure drawn', 'Amounts', { title: 'Drawn × platform weight of the investor' });
    amt('attributed', A + ' attributed', 'Amounts', { title: 'Nominal × ' + A.toLowerCase() + ' weight of the investor' });
    amt('third_party', 'Third party', 'Amounts', { title: 'Nominal − ' + A.toLowerCase() + ' attributed' });
    F.push({ id: 'nominal_ccy', label: 'Nominal (position ccy)', kind: 'measure', type: 'number', group: 'Amounts', get: (r) => r.nominal_ccy, format: fmtCcy, agg: 'sum', unit: 1, unitLabel: 'position currency' });
    F.push({ id: 'drawn_ccy', label: 'Drawn (position ccy)', kind: 'measure', type: 'number', group: 'Amounts', get: (r) => r.drawn_ccy, format: fmtCcy, agg: 'sum', unit: 1, unitLabel: 'position currency' });
    amt('total_transaction_size', 'Total transaction size', 'Amounts', { perAsset: true, title: 'Per asset, counted once' });
    // Counts: positions sum a 1 per record; assets and investors are distinct counts (never summed across groups)
    measure('positions', 'Positions', 'Derived', { format: (v) => U.fmt.int(v), agg: 'sum' });
    measure('assets', 'Assets', 'Derived', { format: (v) => U.fmt.int(v), agg: 'countDistinct', distinctKey: (r) => r.asset_code });
    measure('investors', 'Investors', 'Derived', { format: (v) => U.fmt.int(v), agg: 'countDistinct', distinctKey: (r) => r.investor_label });
    // Weighted averages (exposure-weighted, like the engine metrics in AUM.summarise); GHG is per asset, counted once
    measure('margin_bps', 'Margin (bps)', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.bps(v) });
    measure('coupon', 'Coupon (%)', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.n2(v) });
    measure('wal_years', 'WAL (years)', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.yrs(v) });
    measure('initial_tenor', 'Initial tenor (years)', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.yrs(v) });
    measure('remaining_years', 'Remaining years', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.yrs(v) });
    measure('rating_numeric', 'Rating numeric', 'Credit', { agg: 'wavg', weight: (r) => (r.rating_status === 'rated' ? r.exposure : 0), format: (v) => U.fmt.int(v), title: 'Exposure-weighted, rated positions only' });
    measure('esg_score', 'ESG score', 'ESG', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.n1(v) });
    measure('ghg_scope12_t', 'GHG scope 1+2 (t)', 'ESG', { agg: 'sum', perAsset: true, format: (v) => U.fmt.int(v) });
    measure('ghg_scope3_t', 'GHG scope 3 (t)', 'ESG', { agg: 'sum', perAsset: true, format: (v) => U.fmt.int(v) });
    measure('upfront_fee_bps', 'Upfront fee (bps)', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.bps(v) });
    measure('fx_rate', 'FX rate (per EUR)', 'Derived', { agg: 'avg', format: (v) => U.fmt.n4(v) });
    if (grain === 'assets') {
      measure('drawn_pct', 'Drawn %', 'Derived', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.pct(v) });
      measure('protected_life_fraction', 'Protected life', 'Terms', { agg: 'wavg', weight: wExposure, format: (v) => U.fmt.pct(v) });
    }
    return F;
  }

  /** Package records and fields with a fieldById index; amount fields' placeholder weight: null is removed so the pivot falls back to exposure. */
  function finish(records, fields) {
    const fieldById = {};
    for (const f of fields) { if (f.weight === null) delete f.weight; fieldById[f.id] = f; }
    return { records, fields, fieldById };
  }


  // ---------- raw sheet columns ----------
  // Every column of the input sheets is also a field, so anything in the workbook can be filtered, pivoted or shown:
  // all Holdings columns per position, every Hardcoded and ESG Hardcoded column per asset (on both grains).
  const RAW_GROUP = { Holdings: 'Holdings columns', Hardcoded: 'Hardcoded columns', 'ESG Hardcoded': 'ESG columns' };
  const isBlankish = (v) => v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || /^#/.test(v.trim())));
  /** Value of a raw column for a position (Holdings) or its asset (Hardcoded / ESG Hardcoded). */
  const rawValue = (sheet, header, p, a) => (sheet === 'Holdings' ? (p && p.sheet ? p.sheet[header] : null)
    : (a && a.sheets && a.sheets[sheet] && a.sheets[sheet][header] ? a.sheets[sheet][header].value : null));
  /** Cleaned raw value: Excel errors → blank, date columns → ISO date (Excel serials converted), numeric text → number. */
  function rawClean(v, def) {
    if (isBlankish(v)) return def.kind === 'measure' ? NaN : '';
    if (def.type === 'date') {
      if (typeof v === 'number' && v > 20000 && v < 80000) return U.isoDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000));
      const d = U.parseDate(v); return d ? U.isoDate(d) : String(v);
    }
    if (def.kind === 'measure') return typeof v === 'number' ? v : U.toNumber(v);
    return String(v).trim();
  }
  /**
   * Add one field per raw sheet column to `fields` (ids 'raw:<sheet>:<header>'). A column is a measure when at least
   * 80% of its values are numbers: amounts are summed (Holdings amounts in source units, not converted; Hardcoded / ESG
   * amounts once per asset), other numbers are exposure-weighted averages. Columns whose header says "date" are dates.
   * @returns {Array<{id, sheet, header, field}>} definitions used to fill the records
   */
  function addRawFields(fields, res, grain) {
    const sheets = (res.inputs && res.inputs.sheets) || {};
    const want = grain === 'positions' ? ['Holdings', 'Hardcoded', 'ESG Hardcoded'] : ['Hardcoded', 'ESG Hardcoded'];
    const used = new Set(fields.map((f) => f.id)), labels = new Set(fields.map((f) => f.label));
    const posSample = (res.positions || []).slice(0, 500), assetSample = (res.assets || []).slice(0, 300);
    const defs = [];
    for (const sheet of want) {
      for (const c of (sheets[sheet] && sheets[sheet].columns) || []) {
        const id = 'raw:' + sheet + ':' + c.header; if (used.has(id)) continue; used.add(id);
        const vals = (sheet === 'Holdings' ? posSample.map((p) => rawValue(sheet, c.header, p, null)) : assetSample.map((a) => rawValue(sheet, c.header, null, a))).filter((v) => !isBlankish(v));
        const isDate = /date/i.test(c.header);
        const numeric = !isDate && vals.length > 0 && vals.filter((v) => typeof v === 'number' || (typeof v === 'string' && /^-?[\d,]*\.?\d+%?$/.test(v.trim()))).length / vals.length >= 0.8;
        const label = labels.has(c.header) ? `${c.header} (${sheet})` : c.header; labels.add(label);
        const base = { id, label, group: RAW_GROUP[sheet], title: `${sheet}!${c.letter}: ${c.header}${c.output ? ' (' + c.output + ')' : ''}` };
        let f;
        if (numeric) {
          const amount = /amount|notional|commitment|balance|book value|revenue|ebitda|offering|nominal|ghg|scope/i.test(c.header);
          const perAsset = sheet !== 'Holdings' && amount;
          f = Object.assign(base, { kind: 'measure', type: 'number', get: (r) => r[id], agg: amount ? 'sum' : 'wavg', weight: (r) => r.exposure, perAsset,
            format: (v) => (U.isNum(v) ? (Math.abs(v) >= 1000 ? U.fmt.int(v) : U.fmt.n2(v)) : '–'), unit: 1, unitLabel: amount && sheet === 'Holdings' ? 'source units, not converted' : '' });
        } else {
          f = Object.assign(base, { kind: 'dimension', type: isDate ? 'date' : 'string', get: (r) => r[id], agg: 'count', distinctKey: (r) => r[id],
            format: (v) => (v === '' || v === null || v === undefined ? BLANK : isDate ? U.fmt.date(U.parseDate(v)) : String(v)) });
          if (isDate) f.sortRank = dateRank;
        }
        fields.push(f); defs.push({ id, sheet, header: c.header, field: f });
      }
    }
    return defs;
  }

  // ---------- position grain ----------
  /**
   * One record per engine position (holding × investor), including excluded positions (excluded: 'Yes',
   * with the reason) so they can be inspected; the Explorer's default filter is Excluded = No.
   * Records keep _pos / _asset references to the engine objects for drill-through and the asset page.
   * @returns {{records: Object[], fields: Object[], fieldById: Object, grain: 'positions', unit: number,
   *           unitLabel: string, attributionLabel: string, displayCurrency: string}}
   */
  DS.build = function (res) {
    if (!res || typeof res !== 'object') return finish([], []);
    if (memoPositions.has(res)) return memoPositions.get(res);
    const ctx = context(res);
    const fields = makeFields(ctx, 'positions');
    const rawDefs = addRawFields(fields, res, 'positions');
    const records = [];
    for (const p of res.positions || []) {
      if (p.filteredOut) continue; // outside the global filter (Scope.filters)
      const a = p.asset_code ? ctx.assetsByCode.get(p.asset_code) || null : null;
      const attrs = (a && a.attrs) || {}, esg = (a && a.esg) || {}, rt = p.rating || {};
      const rated = rt.status === 'rated';
      const w = ctx.weightOf(p.investor_label);          // platform weight (Output!G8 selection)
      const gw = num0(pick(p, 'group_weight', 0));       // attribution weight (js/calc/aum.js CONFIG.investors)
      const nominal = num0(p.nominal_base), drawn = num0(p.drawn_base), commitment = num0(p.commitment_base);
      const rec = {
        _pos: p, _asset: a,
        asset_code: str(p.asset_code), asset_name: str(p.asset_name), code_name: str(a && a.code_name), tranche: str(p.tranche), holding_id: str(p.holding_id), security_name: str(p.security_name),
        position_key: str(p.key),
        investor_label: str(p.investor_label), investor_key: str(p.investor_key), investor_group: str(p.investor_group),
        sector: str(attrs.sector), subsector: str(attrs.subsector), country: str(attrs.country), region: str(attrs.region), sponsor: str(attrs.sponsor),
        greenfield_brownfield: str(attrs.greenfield_brownfield), repayment_type: str(attrs.repayment_type), cash_flow_type: str(attrs.cash_flow_type),
        instrument: str((a && a.instrument_type) || attrs.instrument || p.instrument_type), origination: str(attrs.origination), deal_year: str(attrs.deal_year),
        deal_lead: str(attrs.deal_lead), watchlist: str(attrs.watchlist), covenant_type: str(attrs.covenant_type),
        currency: str(p.currency), fixed_floating: str(p.fixed_floating),
        // unrated positions show as NR (not the workbook's numeric-0 "IG", see README open definitions)
        rating: rated ? str(rt.current_grade) : 'NR', ig_label: rated ? str(rt.ig_label) : 'NR', rating_status: str(rt.status),
        internal_grade: str(rt.internal), external_grade: str(rt.external_grade), fitch: str(rt.fitch), moodys: str(rt.moodys), sp: str(rt.sp),
        maturity_bucket: str(p.maturity_bucket), maturity_year: year(p.maturity_date), funding_year: year(p.funding_date),
        maturity_date: iso(p.maturity_date), funding_date: iso(p.funding_date), as_of_date: iso(p.as_of_date),
        green_loan: str(esg.green_loan), cbi_taxonomy: str(esg.cbi_taxonomy), sfdr_article: str(esg.sfdr_article), data_coverage: str(esg.data_coverage),
        excluded: p.excluded ? 'Yes' : 'No', exclusion_reason: str(p.exclusionReason), flags: (p.flags || []).join('|'),
        platform_member: w > 0 ? 'Yes' : 'No',
        // measures
        nominal, drawn, undrawn: nominal - drawn, commitment,
        exposure: nominal * w, exposure_drawn: drawn * w,
        attributed: nominal * gw, third_party: nominal - nominal * gw,
        nominal_ccy: num0(p.nominal), drawn_ccy: num0(p.drawn),
        positions: 1, assets: 1, investors: 1,
        margin_bps: num(p.margin_bps), coupon: num(p.coupon), wal_years: num(attrs.wal_years), initial_tenor: num(p.initial_tenor), remaining_years: num(p.remaining_years),
        rating_numeric: rated ? num(rt.current_numeric) : NaN, esg_score: num(esg.esg_score),
        ghg_scope12_t: num0(esg.ghg_scope1_t) + num0(esg.ghg_scope2_t), ghg_scope3_t: num0(esg.ghg_scope3_t),
        total_transaction_size: num0(attrs.total_transaction_size), upfront_fee_bps: num(attrs.upfront_fee_bps), fx_rate: num(p.fx_rate),
      };
      // derived bands (size band on position nominal, in millions)
      rec.remaining_years_band = DS.band(rec.remaining_years, ctx.edges.remaining_years_band, ' y');
      rec.wal_band = DS.band(rec.wal_years, ctx.edges.wal_band, ' y');
      rec.spread_band = DS.band(rec.margin_bps, ctx.edges.spread_band);
      rec.size_band = DS.band(nominal / ctx.unit, ctx.edges.size_band);
      for (const d of rawDefs) rec[d.id] = rawClean(rawValue(d.sheet, d.header, p, a), d.field);
      records.push(rec);
    }
    const out = finish(records, fields);
    out.grain = 'positions'; out.unit = ctx.unit; out.unitLabel = ctx.unitLabel; out.attributionLabel = ctx.attribution; out.displayCurrency = ctx.ccy;
    memoPositions.set(res, out);
    return out;
  };

  // ---------- asset grain (one record per Output row) ----------
  /**
   * One record per Output row (Output rows 11..283 in the workbook: one per asset in the selected platform
   * view), with every Output column, the hardcoded / ESG attributes and one nominal and one drawn measure
   * per investor column (ids 'investor_nominal:<label>' / 'investor_drawn:<label>'). Same return shape as build().
   */
  DS.buildAssets = function (res) {
    if (!res || typeof res !== 'object') return finish([], []);
    if (memoAssets.has(res)) return memoAssets.get(res);
    const ctx = context(res);
    const fields = makeFields(ctx, 'assets');
    const unit = ctx.unit;
    const investorColumns = res.investorColumns || [];
    for (const label of investorColumns) {
      fields.push({ id: 'investor_nominal:' + label, label: label + ' nominal', kind: 'measure', type: 'number', group: 'Investor', get: (r) => r['investor_nominal:' + label], format: (v) => U.fmt.m(U.isNum(v) ? v / unit : NaN), agg: 'sum', unit, unitLabel: ctx.unitLabel, investor: label, measureOf: 'nominal' });
      fields.push({ id: 'investor_drawn:' + label, label: label + ' drawn', kind: 'measure', type: 'number', group: 'Investor', get: (r) => r['investor_drawn:' + label], format: (v) => U.fmt.m(U.isNum(v) ? v / unit : NaN), agg: 'sum', unit, unitLabel: ctx.unitLabel, investor: label, measureOf: 'drawn' });
    }
    const rawDefs = addRawFields(fields, res, 'assets');
    const records = [];
    for (const r of res.rows || []) {
      const a = r.asset || ctx.assetsByCode.get(r.code) || {};
      const attrs = a.attrs || {}, esg = a.esg || {}, rt = a.rating || {};
      const rated = r.rating_status === 'rated';
      const nominal = num0(a.nominal), drawn = num0(a.drawn), commitment = num0(a.commitment);
      // Output rows carry amounts in millions; convert back to full units like the position grain.
      const exposure = num0(r.exposure_m) * unit, exposureDrawn = num0(r.drawn_m) * unit;
      const attributed = num0(pick(a, 'group_nominal', 0));
      const investorsInvested = Object.keys(r.investors || {}).filter((k) => r.investors[k] > 0).length;
      const ps = a.positions || [], fxPs = ps.filter((p) => U.isNum(p.fx_rate)), multi = str(r.currency) === 'Multi'; // position-currency amounts only for single-currency assets
      const rec = {
        _pos: null, _asset: a, _row: r,
        rank: str(r.rank), asset_code: str(r.code), asset_name: str(r.name), code_name: str(r.code_name),
        sector: str(r.sector), subsector: str(r.subsector), country: str(r.country), region: str(r.region), sponsor: str(r.sponsor),
        greenfield_brownfield: str(r.greenfield_brownfield), repayment_type: str(r.repayment_type), cash_flow_type: str(attrs.cash_flow_type),
        instrument: str(r.instrument), origination: str(attrs.origination), deal_year: str(r.deal_year), deal_lead: str(attrs.deal_lead), watchlist: str(r.watchlist), covenant_type: str(r.covenant_type),
        currency: str(r.currency), as_of_date: iso(a.positions && a.positions[0] && a.positions[0].as_of_date),
        excluded: 'No', exclusion_reason: '', flags: (r.flags || []).join('|'),
        group_invested: str(pick(r, 'group_invested', 'No')),
        rating: rated ? str(r.rating) : 'NR', ig_label: rated ? str(r.ig_label) : 'NR', rating_status: str(r.rating_status),
        internal_grade: str(r.internal_grade), external_grade: str(r.external_grade), fitch: str(rt.fitch), moodys: str(rt.moodys), sp: str(rt.sp),
        fixed_floating: str(r.fixed_floating), maturity_bucket: str(r.maturity_bucket), maturity_year: year(r.maturity_date), funding_year: year(r.funding_date),
        maturity_date: iso(r.maturity_date), funding_date: iso(r.funding_date),
        green_loan: str(r.green_loan), cbi_taxonomy: str(r.cbi_taxonomy), sfdr_article: str(r.sfdr_article), data_coverage: str(esg.data_coverage),
        // measures
        nominal, drawn, undrawn: nominal - drawn, commitment,
        exposure, exposure_drawn: exposureDrawn,
        attributed, third_party: nominal - attributed,
        nominal_ccy: multi ? NaN : ps.reduce((s, p) => s + num0(p.nominal), 0), drawn_ccy: multi ? NaN : ps.reduce((s, p) => s + num0(p.drawn), 0),
        positions: num0(r.positions), assets: 1, investors: investorsInvested,
        margin_bps: num(r.margin_bps), coupon: num(r.coupon), wal_years: num(r.wal_years), initial_tenor: num(r.initial_tenor), remaining_years: num(r.remaining_years),
        rating_numeric: rated ? num(r.rating_numeric) : NaN, esg_score: num(r.esg_score),
        ghg_scope12_t: num0(r.ghg_scope12_t), ghg_scope3_t: num0(esg.ghg_scope3_t),
        total_transaction_size: num0(attrs.total_transaction_size), upfront_fee_bps: num(attrs.upfront_fee_bps),
        fx_rate: fxPs.length ? fxPs.reduce((s, p) => s + p.fx_rate, 0) / fxPs.length : NaN,
        drawn_pct: num(r.drawn_pct), protected_life_fraction: num(a.protected_life_fraction),
      };
      for (const label of investorColumns) { rec['investor_nominal:' + label] = num0(r.investors && r.investors[label]) * unit; rec['investor_drawn:' + label] = num0(r.investors_drawn && r.investors_drawn[label]) * unit; }
      // derived bands (size band on platform exposure, in millions)
      rec.remaining_years_band = DS.band(rec.remaining_years, ctx.edges.remaining_years_band, ' y');
      rec.wal_band = DS.band(rec.wal_years, ctx.edges.wal_band, ' y');
      rec.spread_band = DS.band(rec.margin_bps, ctx.edges.spread_band);
      rec.size_band = DS.band(exposure / unit, ctx.edges.size_band);
      for (const d of rawDefs) rec[d.id] = rawClean(rawValue(d.sheet, d.header, null, r.asset), d.field);
      records.push(rec);
    }
    // the asset grain has no investor dimension; countDistinct on investors is a per-row count summed
    const invF = fields.find((f) => f.id === 'investors'); if (invF) { invF.agg = 'sum'; delete invF.distinctKey; invF.title = 'Investors with a nominal > 0 in the asset (summed across assets; an investor in several assets is counted several times)'; }
    const out = finish(records, fields);
    out.grain = 'assets'; out.unit = unit; out.unitLabel = ctx.unitLabel; out.attributionLabel = ctx.attribution; out.displayCurrency = ctx.ccy;
    memoAssets.set(res, out);
    return out;
  };

  /** Asset-grain records only (the README's "one record per Output row"). */
  DS.assetRecords = (res) => DS.buildAssets(res).records;

  /** Field groups in display order (for field lists and column choosers). */
  DS.GROUPS = ['Asset', 'Position', 'Investor', 'Credit', 'Terms', 'ESG', 'Amounts', 'Derived'];
})(typeof window !== 'undefined' ? window : globalThis);
