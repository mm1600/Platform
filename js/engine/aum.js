/* Scope engine: AUM.
 * Pure function of (tables, adjustments, platform, currency) → result. No DOM. Runs in browser and Node.
 *
 * Reproduces the logic of the existing Excel AUM workbook (see README "Workbook → engine map"):
 *   Holdings → keys (investor x holding)  → Mapping (asset code, investor label)  → Hardcoded / ESG lookups
 *   → ratings branch → FX to base/display currency → asset × investor matrices → platform column → Output rows
 *   → portfolio totals, exposure-weighted metrics and distributions.
 * Where the workbook silently produced 0 / "" / #REF!, this engine raises an issue instead and excludes the row.
 *
 * Registers Scope.engine.aum (alias AUM): compute(input) → result, summarise(rows, ratingScale, cfg),
 * bucketOf, outputRecords / positionRecords (CSV exports), DIMENSIONS and the canonical field lists.
 * First engine in the chain aum.js → dataset.js → pivot.js. js/core/store.js calls compute() with the
 * loaded CSV tables and memoises the result; every page reads that result, so no module computes
 * totals of its own.
 *
 * input: { tables: { 'holdings.csv': rows, ... }, tableInfo?, adjustments?, platform, currency, includeLines? }
 * result (main members): positions (canonical, incl. excluded), assets (asset × investor matrices),
 *   rows (Output rows for the selected platform, ranked by exposure), metrics / distributions, investors,
 *   investorColumns, issues (error / warn / info with table + line), excludedPositions, stats.
 * Amounts: *_eur and *_base (display currency) are full units; *_m fields on Output rows are in
 * config amount_display_unit (millions by default).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const E = (Scope.engine = Scope.engine || {});
  const AUM = (E.aum = {});

  // Canonical holdings columns after the mapping_columns.csv header renames (Holdings sheet extract).
  AUM.POSITION_FIELDS = ['portfolio_id', 'portfolio_alt_id', 'holding_id', 'security_name', 'as_of_date', 'currency', 'nominal', 'drawn', 'commitment',
    'internal_grade', 'fitch', 'moodys', 'sp', 'funding_date', 'maturity_date', 'coupon_type', 'coupon', 'margin_bps', 'instrument_type'];
  // Position fields that a manual adjustment (store.addAdjustment) may override; the original is kept for provenance.
  AUM.ADJUSTABLE_POSITION_FIELDS = ['nominal', 'drawn', 'commitment', 'currency', 'internal_grade', 'fitch', 'moodys', 'sp', 'funding_date', 'maturity_date', 'coupon_type', 'coupon', 'margin_bps'];
  // Per-asset manual attributes (workbook "Hardcoded" sheet → hardcoded.csv) and ESG attributes ("ESG Hardcoded" → esg.csv).
  AUM.ASSET_ATTRIBUTE_FIELDS = ['sector', 'subsector', 'country', 'region', 'sponsor', 'greenfield_brownfield', 'repayment_type', 'cash_flow_type', 'instrument', 'origination', 'deal_year',
    'upfront_fee_bps', 'protection_end_date', 'watchlist', 'deal_lead', 'covenant_type', 'lockup_level', 'default_level', 'wal_years', 'total_transaction_size', 'description'];
  AUM.ESG_FIELDS = ['esg_score', 'cbi_taxonomy', 'ghg_scope1_t', 'ghg_scope2_t', 'ghg_scope3_t', 'ghg_intensity_t_per_eurm', 'green_loan', 'sfdr_article', 'data_coverage'];
  // Attribute / ESG fields converted to numbers after loading (a non-numeric value raises a warning and stays as text).
  AUM.NUMERIC_ASSET_FIELDS = ['upfront_fee_bps', 'lockup_level', 'default_level', 'wal_years', 'total_transaction_size', 'deal_year', 'esg_score', 'ghg_scope1_t', 'ghg_scope2_t', 'ghg_scope3_t', 'ghg_intensity_t_per_eurm'];

  /**
   * config.csv (key,value rows) → settings with defaults: base currency EUR, IG threshold 610 (Mapping AC:AD),
   * SINGLE portfolio token, display unit 1e6, maturity bucket edges, dataset label and the attribution label
   * ("Group" unless configured). `raw` keeps every key for optional settings read elsewhere (e.g. band edges).
   */
  function readConfig(rows) {
    const c = {};
    for (const r of rows) if (r && r.key) c[r.key] = r.value;
    return {
      base_currency: c.base_currency || 'EUR',
      ig_threshold: U.isNum(U.toNumber(c.ig_threshold)) ? U.toNumber(c.ig_threshold) : 610,
      single_token: c.single_portfolio_token || 'SINGLE',
      unit: U.isNum(U.toNumber(c.amount_display_unit)) ? U.toNumber(c.amount_display_unit) : 1e6,
      buckets: (c.maturity_buckets || '0-3,3-5,5-10,10-20,20+').split(',').map((s) => s.trim()),
      dataset_label: c.dataset_label || '',
      attribution_label: (c.attribution_label || '').trim() || 'Group',
      raw: c,
    };
  }

  /**
   * Remaining years → maturity bucket label from config edges: "a-b" is [a, b), "a+" open-ended, labels get
   * a " y" suffix ("3-5 y"). Negative years (past maturity) → "Matured"; non-numeric → "Unknown".
   */
  AUM.bucketOf = function (years, buckets) {
    if (!U.isNum(years)) return 'Unknown';
    for (const b of buckets) {
      const m = b.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
      if (m && years >= +m[1] && years < +m[2]) return b + ' y';
      const p = b.match(/^(\d+(?:\.\d+)?)\s*\+$/);
      if (p && years >= +p[1]) return b + ' y';
      if (b === '<0' && years < 0) return 'Matured';
    }
    return years < 0 ? 'Matured' : 'Unknown';
  };

  /** Dimensions available for filtering/breakdowns of Output rows (labels must match AUM.summarise distributions). */
  AUM.DIMENSIONS = {
    sector: { label: 'Sector', key: (r) => r.sector }, subsector: { label: 'Subsector', key: (r) => r.subsector }, country: { label: 'Country', key: (r) => r.country }, region: { label: 'Region', key: (r) => r.region },
    currency: { label: 'Currency', key: (r) => r.currency }, rating: { label: 'Rating', key: (r) => (r.rating_status === 'rated' ? r.rating : 'NR') }, ig: { label: 'IG / Sub-IG', key: (r) => (r.rating_status === 'rated' ? r.ig_label : 'NR') },
    fixed_floating: { label: 'Fixed / floating', key: (r) => r.fixed_floating }, repayment_type: { label: 'Repayment', key: (r) => r.repayment_type }, instrument: { label: 'Instrument', key: (r) => r.instrument },
    greenfield: { label: 'Greenfield / brownfield', key: (r) => r.greenfield_brownfield }, watchlist: { label: 'Watchlist', key: (r) => r.watchlist }, maturity_bucket: { label: 'Maturity bucket', key: (r) => r.maturity_bucket },
    green_loan: { label: 'Green loan', key: (r) => (r.green_loan === 'Y' ? 'Green loan' : 'Not green') }, sponsor: { label: 'Sponsor', key: (r) => r.sponsor }, cbi_taxonomy: { label: 'CBI taxonomy', key: (r) => r.cbi_taxonomy },
    sfdr_article: { label: 'SFDR article', key: (r) => r.sfdr_article }, deal_year: { label: 'Deal year', key: (r) => String(r.deal_year || '') },
  };

  /** Exposure-weighted metrics and distributions for a set of Output rows (also used for filtered views). */
  /**
   * Exposure-weighted metrics and distributions for a set of Output rows (also used for filtered views).
   * Weighted averages skip rows without a value (so coverage is reported alongside); the weighted rating
   * uses rated rows only and is labelled with the nearest grade of the S&P / Fitch scale. Shares are
   * fractions of total exposure; the sub-IG share excludes NR exposure, which is reported separately
   * (the workbook would count numeric-0 NR as IG, see README open definitions).
   * @returns {{metrics: Object, distributions: Object<string, {label, exposure_m, drawn_m, count, share, value}[]>}}
   */
  AUM.summarise = function (rows, ratingScaleSP, cfg) {
    // ---------- portfolio totals and metrics (exposure-weighted) ----------
    const total_exposure_m = U.sum(rows, (r) => r.exposure_m), total_drawn_m = U.sum(rows, (r) => r.drawn_m);
    // wavg: Σ(v × exposure) / Σ exposure over rows with a numeric value (optionally filtered);
    // coverage: share of exposure that has a numeric value for f; wRating: exposure-weighted numeric over rated rows only.
    const wavg = (f, filter) => { let n = 0, d = 0; for (const r of rows) { const v = f(r); if (U.isNum(v) && (!filter || filter(r))) { n += v * r.exposure_m; d += r.exposure_m; } } return d ? n / d : NaN; };
    const coverage = (f) => { let d = 0; for (const r of rows) if (U.isNum(f(r))) d += r.exposure_m; return total_exposure_m ? d / total_exposure_m : 0; };
    const ratedRows = rows.filter((r) => r.rating_status === 'rated');
    const wRating = (() => { let n = 0, d = 0; for (const r of ratedRows) { n += r.rating_numeric * r.exposure_m; d += r.exposure_m; } return d ? n / d : NaN; })();
    let wRatingLabel = 'NR';
    if (U.isNum(wRating) && ratingScaleSP.length) { let best = null; for (const r of ratingScaleSP) if (!best || Math.abs(r.numeric - wRating) < Math.abs(best.numeric - wRating)) best = r; wRatingLabel = best.grade; }
    const igExposure = U.sum(rows.filter((r) => r.ig_label === 'IG' && r.rating_status === 'rated'), (r) => r.exposure_m);
    const nrExposure = U.sum(rows.filter((r) => r.rating_status !== 'rated'), (r) => r.exposure_m);
    const metrics = {
      total_exposure_m, total_drawn_m, total_undrawn_m: total_exposure_m - total_drawn_m, drawn_pct: total_exposure_m ? total_drawn_m / total_exposure_m : NaN,
      total_commitment_m: U.sum(rows, (r) => r.commitment_m),
      n_assets: rows.length, n_positions: U.sum(rows, (r) => r.positions),
      book_total_m: U.sum(rows, (r) => r.total_nominal_m), book_group_m: U.sum(rows, (r) => r.group_nominal_m), book_third_party_m: U.sum(rows, (r) => r.third_party_nominal_m),
      group_share_of_book: (() => { const t = U.sum(rows, (r) => r.total_nominal_m); return t ? U.sum(rows, (r) => r.group_nominal_m) / t : NaN; })(),
      w_margin_bps: wavg((r) => r.margin_bps), margin_coverage: coverage((r) => r.margin_bps),
      w_wal_years: wavg((r) => r.wal_years), wal_coverage: coverage((r) => r.wal_years),
      w_remaining_years: wavg((r) => r.remaining_years), w_initial_tenor: wavg((r) => r.initial_tenor),
      w_rating_numeric: wRating, w_rating_label: wRatingLabel, rated_share: total_exposure_m ? 1 - nrExposure / total_exposure_m : NaN,
      sub_ig_share: total_exposure_m ? 1 - igExposure / total_exposure_m - nrExposure / total_exposure_m : NaN, // among all exposure; NR shown separately
      nr_share: total_exposure_m ? nrExposure / total_exposure_m : NaN,
      fixed_share: total_exposure_m ? U.sum(rows.filter((r) => r.fixed_floating === 'Fixed'), (r) => r.exposure_m) / total_exposure_m : NaN,
      green_share: total_exposure_m ? U.sum(rows.filter((r) => r.green_loan === 'Y'), (r) => r.exposure_m) / total_exposure_m : NaN,
      watchlist_share: total_exposure_m ? U.sum(rows.filter((r) => r.watchlist && r.watchlist !== 'No'), (r) => r.exposure_m) / total_exposure_m : NaN,
      w_esg_score: wavg((r) => r.esg_score), esg_coverage: coverage((r) => r.esg_score),
      ghg_scope12_t: U.sum(rows, (r) => r.ghg_scope12_t),
    };
    // Exposure by category. Order: an explicit ordinal order (ratings, buckets, ...; unknown labels last),
    // a natural label sort, or by exposure descending (default).
    const dist = (keyFn, opts) => {
      const m = new Map();
      for (const r of rows) { const k = keyFn(r) || '(blank)'; if (!m.has(k)) m.set(k, { label: k, exposure_m: 0, drawn_m: 0, count: 0 }); const d = m.get(k); d.exposure_m += r.exposure_m; d.drawn_m += r.drawn_m; d.count++; }
      let arr = Array.from(m.values()); arr.forEach((d) => { d.share = total_exposure_m ? d.exposure_m / total_exposure_m : 0; d.value = d.exposure_m; });
      if (opts && opts.order) { const idx = (l) => { const i = opts.order.indexOf(l); return i < 0 ? 999 : i; }; arr.sort((a, b) => idx(a.label) - idx(b.label)); }
      else if (opts && opts.sortLabel) arr.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
      else arr.sort((a, b) => b.exposure_m - a.exposure_m);
      return arr;
    };
    const ratingOrder = ratingScaleSP.map((r) => r.grade).concat(['NR']);
    const distributions = {
      sector: dist((r) => r.sector), subsector: dist((r) => r.subsector), country: dist((r) => r.country), region: dist((r) => r.region), currency: dist((r) => r.currency),
      rating: dist((r) => (r.rating_status === 'rated' ? r.rating : 'NR'), { order: ratingOrder }), ig: dist((r) => (r.rating_status === 'rated' ? r.ig_label : 'NR'), { order: ['IG', 'SUB IG', 'NR'] }),
      fixed_floating: dist((r) => r.fixed_floating, { order: ['Fixed', 'Floating'] }), repayment_type: dist((r) => r.repayment_type), instrument: dist((r) => r.instrument),
      greenfield: dist((r) => r.greenfield_brownfield), watchlist: dist((r) => r.watchlist, { order: ['No', 'Watch', 'Intensive'] }),
      maturity_bucket: dist((r) => r.maturity_bucket, { order: cfg.buckets.map((b) => b + ' y').concat(['Matured', 'Unknown']) }),
      green_loan: dist((r) => (r.green_loan === 'Y' ? 'Green loan' : 'Not green'), { order: ['Green loan', 'Not green'] }), sponsor: dist((r) => r.sponsor),
      cbi_taxonomy: dist((r) => r.cbi_taxonomy), sfdr_article: dist((r) => r.sfdr_article), deal_year: dist((r) => String(r.deal_year || ''), { sortLabel: true }),
      group_split: [{ label: `${cfg.attribution_label} attributed`, value: metrics.book_group_m, exposure_m: metrics.book_group_m }, { label: 'Third party', value: metrics.book_third_party_m, exposure_m: metrics.book_third_party_m }],
    };
    return { metrics, distributions };
  };

  /**
   * Run the whole workbook pipeline on the loaded tables. Steps (sections below): reference tables →
   * holdings column mapping → canonical positions → ratings branch → FX conversion → global filter →
   * asset × investor matrices and platform columns → Output rows for the selected platform → summary.
   * Never throws on bad data: problems become issues and, where a position cannot be valued, an exclusion.
   */
  AUM.compute = function (input) {
    const T = input.tables || {};
    const issues = [];
    // issue(severity, table, file line (header = 1, first data row = 2), message, extra such as { key })
    const issue = (severity, table, row, message, extra) => { issues.push(Object.assign({ severity, table, row, message }, extra || {})); };
    const cfg = readConfig(T['config.csv'] || []);
    const displayCcy = input.currency || cfg.base_currency;
    // Manual adjustments indexed by "table|key|field" (positions: key = position key; assets: key = asset code).
    const adjIndex = new Map();
    for (const a of input.adjustments || []) adjIndex.set(`${a.table}|${a.key}|${a.field}`, a);

    // ---------- reference tables ----------
    // mapping_assets.csv: holding_id → asset_code (Calculations!D). assetOrder keeps the file order of assets.
    const assetsByHolding = new Map(), assetOrder = [], assetMeta = new Map();
    (T['mapping_assets.csv'] || []).forEach((r, i) => {
      if (!r.holding_id || !r.asset_code) { issue('warn', 'mapping_assets.csv', i + 2, 'Row missing holding_id or asset_code; ignored'); return; }
      if (assetsByHolding.has(r.holding_id)) issue('warn', 'mapping_assets.csv', i + 2, `Duplicate holding_id ${r.holding_id}; first mapping wins`);
      else assetsByHolding.set(r.holding_id, Object.assign({ _row: i + 2 }, r));
      if (!assetMeta.has(r.asset_code)) { assetMeta.set(r.asset_code, { code: r.asset_code, name: r.asset_name || r.asset_code, code_name: r.code_name || '', holdings: [] }); assetOrder.push(r.asset_code); }
      assetMeta.get(r.asset_code).holdings.push(r.holding_id);
    });
    // mapping_investors.csv: investor / portfolio id → label, group and attribution weight (Calculations!K/G,
    // workbook row-3 weights). investorOrder is the workbook's investor-column order.
    const investorsById = new Map(), investorOrder = [];
    const invRows = T['mapping_investors.csv'] || [];
    // Attribution weight column: group_weight. A file without it attributes nothing to the group (one warning).
    const missingWeight = invRows.length > 0 && invRows.every((r) => !r || r.group_weight === undefined);
    if (missingWeight) issue('warn', 'mapping_investors.csv', 1, `Column group_weight not found; every investor is treated as third party (weight 0) for ${cfg.attribution_label} attribution`);
    invRows.forEach((r, i) => {
      if (!r.investor_id || !r.investor_label) { issue('warn', 'mapping_investors.csv', i + 2, 'Row missing investor_id or investor_label; ignored'); return; }
      const w = missingWeight ? 0 : U.toNumber(r.group_weight);
      const inv = { id: String(r.investor_id).trim(), key: r.investor_key || '', label: r.investor_label, group: r.investor_group || '', group_weight: U.isNum(w) ? w : 0, _row: i + 2 };
      if (!U.isNum(w)) issue('warn', 'mapping_investors.csv', i + 2, `group_weight for ${inv.label} is not numeric; treated as 0`);
      investorsById.set(inv.id, inv); investorOrder.push(inv);
    });
    const investorByLabel = new Map(investorOrder.map((x) => [x.label, x]));
    // platforms.csv: each platform (Output!G8 choice) is a weighted list of investor columns; '*' = all investors.
    const platforms = new Map();
    (T['platforms.csv'] || []).forEach((r, i) => {
      if (!r.platform_id) return;
      if (!platforms.has(r.platform_id)) platforms.set(r.platform_id, { id: r.platform_id, label: r.platform_label || r.platform_id, composition: [] });
      const w = U.toNumber(r.weight);
      if (r.investor_label !== '*' && !investorByLabel.has(r.investor_label)) issue('warn', 'platforms.csv', i + 2, `Platform ${r.platform_id} references unknown investor label "${r.investor_label}"`);
      platforms.get(r.platform_id).composition.push({ label: r.investor_label, weight: U.isNum(w) ? w : 1 });
    });
    if (!platforms.size) { platforms.set('TOTAL', { id: 'TOTAL', label: 'Total platform', composition: [{ label: '*', weight: 1 }] }); issue('warn', 'platforms.csv', null, 'No platforms defined; using TOTAL = all investors'); }
    // ratings.csv: grade → numeric per scale (INTERNAL, SP_FITCH, MOODYS or ALL); higher numeric = weaker credit.
    // ratingScaleSP (S&P / Fitch grades in numeric order) labels the weighted average rating.
    const ratings = (T['ratings.csv'] || []).map((r, i) => ({ grade: U.normalizeGrade(r.grade), up: U.normalizeGrade(r.grade).toUpperCase(), numeric: U.toNumber(r.numeric), scale: (r.scale || 'ALL').toUpperCase(), _row: i + 2 })).filter((r) => r.grade && U.isNum(r.numeric));
    const ratingScaleSP = ratings.filter((r) => r.scale === 'SP_FITCH' || r.scale === 'ALL').sort((a, b) => a.numeric - b.numeric);
    // fx.csv (table CU:CW): rates per EUR. Rows with an investor_id and / or platform_id are overrides (the
    // workbook's 94338 / GBP / AHO 2 exception); the base currency is implied at 1 if not listed.
    const fxStd = new Map(), fxOverrides = [];
    (T['fx.csv'] || []).forEach((r, i) => {
      const rate = U.toNumber(r.rate_per_eur);
      if (!r.currency || !U.isNum(rate) || rate <= 0) { issue('warn', 'fx.csv', i + 2, 'FX row without valid currency/rate; ignored'); return; }
      const rec = { currency: r.currency.toUpperCase(), rate, investor_id: String(r.investor_id || '').trim(), platform_id: String(r.platform_id || '').trim(), note: r.note || '', _row: i + 2 };
      if (rec.investor_id || rec.platform_id) fxOverrides.push(rec); else fxStd.set(rec.currency, rec);
    });
    if (!fxStd.has(cfg.base_currency)) fxStd.set(cfg.base_currency, { currency: cfg.base_currency, rate: 1, note: 'implied base', _row: null });
    // hardcoded.csv / esg.csv: per-asset attributes (INDEX-MATCH on asset code in the workbook); first row per asset wins.
    const hardcodedByAsset = new Map();
    (T['hardcoded.csv'] || []).forEach((r, i) => { if (r.asset_code) { if (hardcodedByAsset.has(r.asset_code)) issue('warn', 'hardcoded.csv', i + 2, `Duplicate asset_code ${r.asset_code}; first row wins`); else hardcodedByAsset.set(r.asset_code, Object.assign({ _row: i + 2 }, r)); } });
    const esgByAsset = new Map();
    (T['esg.csv'] || []).forEach((r, i) => { if (r.asset_code) { if (esgByAsset.has(r.asset_code)) issue('warn', 'esg.csv', i + 2, `Duplicate asset_code ${r.asset_code}; first row wins`); else esgByAsset.set(r.asset_code, Object.assign({ _row: i + 2 }, r)); } });
    for (const code of hardcodedByAsset.keys()) if (!assetMeta.has(code)) issue('info', 'hardcoded.csv', hardcodedByAsset.get(code)._row, `Manual attributes for ${code} but no holding maps to it`);

    // ---------- column mapping (Holdings row 2 ← Mapping C:D) ----------
    // Source header → canonical field (case-insensitive); canonical names are also accepted directly.
    // Without portfolio_id, holding_id, nominal and currency no position can be built (fatal).
    const colRows = T['mapping_columns.csv'] || [];
    const hmap = new Map(), required = new Set();
    colRows.forEach((r) => { if (r.source_header && r.canonical_field) { hmap.set(r.source_header.trim().toLowerCase(), r.canonical_field.trim()); if (/^y/i.test(r.required || '')) required.add(r.canonical_field.trim()); } });
    const hInfo = input.tableInfo && input.tableInfo['holdings.csv'];
    const headers = hInfo ? hInfo.parsed.headers : (T['holdings.csv'] && T['holdings.csv'][0] ? Object.keys(T['holdings.csv'][0]) : []);
    const headerToCanon = {}, canonPresent = new Set(), unmappedHeaders = [];
    headers.forEach((hd) => {
      const canon = hmap.get(hd.trim().toLowerCase()) || (AUM.POSITION_FIELDS.includes(hd.trim()) ? hd.trim() : null);
      if (canon) { headerToCanon[hd] = canon; canonPresent.add(canon); } else unmappedHeaders.push(hd);
    });
    if (unmappedHeaders.length) issue('info', 'holdings.csv', 1, `Unmapped columns ignored: ${unmappedHeaders.join(', ')}`);
    const missingRequired = Array.from(required).filter((c) => !canonPresent.has(c));
    ['portfolio_id', 'holding_id', 'nominal', 'currency'].forEach((c) => { if (!canonPresent.has(c) && !missingRequired.includes(c)) missingRequired.push(c); });
    if (missingRequired.length) issue('error', 'holdings.csv', 1, `Required columns missing after mapping: ${missingRequired.join(', ')}`);
    const fatal = ['portfolio_id', 'holding_id', 'nominal', 'currency'].some((c) => !canonPresent.has(c));

    // ---------- positions ----------
    const positions = [];
    let paddingRows = 0;
    const hRecords = (hInfo ? hInfo.parsed.records : (T['holdings.csv'] || [])) || [];
    const seenKeys = new Map();
    // One canonical position per holdings row (rows 4..1388 in the workbook). Blank / padding rows are counted, not issues.
    if (!fatal) hRecords.forEach((row, idx) => {
      const line = idx + 2;
      if (!row) { paddingRows++; return; }
      const rec = {}, src = {};
      for (const hd in headerToCanon) { const c = headerToCanon[hd]; rec[c] = row[hd]; src[c] = { table: 'holdings.csv', row: line, col: hd }; }
      const allBlank = AUM.POSITION_FIELDS.every((f) => !rec[f]);
      if (allBlank) { paddingRows++; return; }
      const p = { line, src, raw: rec, excluded: false, exclusionReason: null, flags: [] };
      // Holdings!C: IF G="SINGLE" THEN H ELSE G
      if (String(rec.portfolio_id).trim().toUpperCase() === cfg.single_token.toUpperCase()) {
        p.investor_id = String(rec.portfolio_alt_id || '').trim();
        src.investor_id = { table: 'calc', note: `portfolio_id = ${cfg.single_token} → used portfolio_alt_id (line ${line})` };
        if (!p.investor_id) issue('error', 'holdings.csv', line, `portfolio_id is ${cfg.single_token} but portfolio_alt_id is blank`);
      } else { p.investor_id = String(rec.portfolio_id || '').trim(); src.investor_id = src.portfolio_id; }
      p.holding_id = String(rec.holding_id || '').trim();
      p.key = p.investor_id + 'x' + p.holding_id; // Holdings!B / Calculations!C
      p.security_name = rec.security_name || '';
      // manual adjustments (brief §11) — applied before parsing, original retained
      for (const f of AUM.ADJUSTABLE_POSITION_FIELDS) {
        const a = adjIndex.get(`positions|${p.key}|${f}`);
        if (a) { p.flags.push('adjusted'); src[f] = { table: 'manual', adjustment: a, original: rec[f] }; rec[f] = a.value; }
      }
      for (const f of AUM.POSITION_FIELDS) if (!(f in p)) p[f] = rec[f] === undefined ? '' : rec[f];
      // numbers: a non-numeric nominal excludes the position; blank drawn → 0; blank commitment → nominal
      p.nominal = U.toNumber(rec.nominal);
      if (!U.isNum(p.nominal)) { issue('error', 'holdings.csv', line, `Nominal "${rec.nominal}" is not numeric`, { key: p.key }); p.excluded = true; p.exclusionReason = 'nominal not numeric'; }
      p.drawn = U.toNumber(rec.drawn);
      if (!U.isNum(p.drawn)) { if (String(rec.drawn || '').trim()) issue('warn', 'holdings.csv', line, `Drawn "${rec.drawn}" is not numeric; treated as 0`, { key: p.key }); p.drawn = 0; src.drawn = { table: 'calc', note: 'blank/invalid drawn treated as 0' }; }
      p.commitment = U.toNumber(rec.commitment);
      if (!U.isNum(p.commitment)) { p.commitment = U.isNum(p.nominal) ? p.nominal : 0; src.commitment = { table: 'calc', note: 'commitment blank → equals nominal' }; }
      if (U.isNum(p.nominal) && p.nominal < 0) issue('warn', 'holdings.csv', line, 'Negative nominal', { key: p.key });
      if (U.isNum(p.nominal) && p.drawn > p.nominal * 1.000001) issue('warn', 'holdings.csv', line, `Drawn (${p.drawn}) exceeds nominal (${p.nominal})`, { key: p.key });
      p.currency = String(rec.currency || '').trim().toUpperCase();
      if (!p.currency) { issue('error', 'holdings.csv', line, 'Currency blank', { key: p.key }); p.excluded = true; p.exclusionReason = 'currency blank'; }
      // dates (unparseable values warn and stay null; a missing maturity disables tenor and bucket)
      p.as_of_date = U.parseDate(rec.as_of_date); if (rec.as_of_date && !p.as_of_date) issue('warn', 'holdings.csv', line, `Unparseable as_of_date "${rec.as_of_date}"`, { key: p.key });
      p.funding_date = U.parseDate(rec.funding_date); if (rec.funding_date && !p.funding_date) issue('warn', 'holdings.csv', line, `Unparseable funding_date "${rec.funding_date}"`, { key: p.key });
      p.maturity_date = U.parseDate(rec.maturity_date);
      if (rec.maturity_date && !p.maturity_date) issue('warn', 'holdings.csv', line, `Unparseable maturity_date "${rec.maturity_date}"`, { key: p.key });
      else if (!p.maturity_date) issue('warn', 'holdings.csv', line, 'Maturity date missing; tenor and maturity bucket unavailable', { key: p.key });
      p.margin_bps = U.toNumber(rec.margin_bps); p.coupon = U.toNumber(rec.coupon);
      // asset mapping (Calculations!D = XLOOKUP(holding, Mapping!T:T, Mapping!S:S))
      const am = assetsByHolding.get(p.holding_id);
      if (am) { p.asset_code = am.asset_code; p.asset_name = am.asset_name || am.asset_code; p.tranche = am.tranche || ''; src.asset_code = { table: 'mapping_assets.csv', row: am._row }; }
      else { p.asset_code = null; p.asset_name = p.security_name || '(unmapped)'; if (!p.excluded) { p.excluded = true; p.exclusionReason = 'holding_id not in mapping_assets.csv'; } issue('error', 'holdings.csv', line, `Holding ID "${p.holding_id}" is not in mapping_assets.csv — position excluded from AUM (the workbook would show a broken/zero row)`, { key: p.key }); }
      // investor mapping (Calculations!K/G)
      const im = investorsById.get(p.investor_id);
      if (im) { p.investor_label = im.label; p.investor_key = im.key; p.investor_group = im.group; p.group_weight = im.group_weight; src.investor_label = { table: 'mapping_investors.csv', row: im._row }; }
      else { p.investor_label = '⚠ Unmapped investor ' + p.investor_id; p.investor_key = ''; p.investor_group = 'Unmapped'; p.group_weight = 0; p.flags.push('unmapped_investor'); issue('error', 'holdings.csv', line, `Investor/portfolio ID "${p.investor_id}" is not in mapping_investors.csv — counted in asset totals but in no investor column (workbook behaviour), shown as "Unmapped investor"`, { key: p.key }); }
      p.matrixKey = p.investor_label + p.asset_code; // Calculations!F
      if (seenKeys.has(p.key)) issue('warn', 'holdings.csv', line, `Duplicate position key ${p.key} (also line ${seenKeys.get(p.key)}); both rows are counted`, { key: p.key }); else seenKeys.set(p.key, line);
      positions.push(p);
    });

    // reporting date = MIN(Holdings!F)
    const asOfDates = positions.map((p) => p.as_of_date).filter(Boolean);
    const reportingDate = asOfDates.length ? new Date(Math.min.apply(null, asOfDates)) : null;
    if (!reportingDate && positions.length) issue('warn', 'holdings.csv', null, 'No as_of_date values; reporting date unknown (remaining tenor not computed)');
    if (asOfDates.length) { const mx = new Date(Math.max.apply(null, asOfDates)); if (mx - reportingDate > 0) issue('info', 'holdings.csv', null, `Position dates span ${U.isoDate(reportingDate)} to ${U.isoDate(mx)}; reporting date uses the earliest (workbook rule)`); }

    // ---------- ratings branch ----------
    // Position rating branch (Mapping AC:AD). Each agency grade is looked up on its own scale first, then on any scale.
    /**
     * Grade → { grade, numeric, known }. Blank or "NR" → NR with numeric 0; an unknown grade warns and is
     * treated as NR (numeric NaN, known false) so it never silently counts as rated.
     */
    function lookupGrade(raw, scale, p, field) {
      const g = U.normalizeGrade(raw);
      if (!g || g.toUpperCase() === 'NR') return { grade: 'NR', numeric: 0, known: true, blank: !g };
      const up = g.toUpperCase();
      let r = ratings.find((x) => x.up === up && (x.scale === scale || x.scale === 'ALL')) || ratings.find((x) => x.up === up);
      if (!r) { issue('warn', 'holdings.csv', p.line, `Unknown ${field} grade "${raw}" (normalised "${g}"); treated as NR`, { key: p.key }); return { grade: g, numeric: NaN, known: false }; }
      return { grade: r.grade, numeric: r.numeric, known: true };
    }
    for (const p of positions) {
      const int = lookupGrade(p.internal_grade, 'INTERNAL', p, 'internal'), fi = lookupGrade(p.fitch, 'SP_FITCH', p, 'Fitch'), mo = lookupGrade(p.moodys, 'MOODYS', p, "Moody's"), sp = lookupGrade(p.sp, 'SP_FITCH', p, 'S&P');
      // Current rating: the internal grade unless NR, else the worst external grade (highest numeric).
      // current_numeric = MAX(internal, external) even when the displayed grade is the internal one — the
      // workbook rule, reproduced and flagged as an open definition in the README. Numeric 0 = NR.
      const num = (x) => (x.known ? x.numeric : 0);
      const internal_numeric = num(int);
      const external_numeric = Math.max(num(fi), num(mo), num(sp), 0);
      let external_grade = 'NR';
      if (external_numeric > 0) external_grade = [fi, mo, sp].find((x) => x.known && x.numeric === external_numeric).grade; // Fitch → Moody's → S&P priority
      const current_grade = int.known && int.grade !== 'NR' ? int.grade : external_grade;
      const current_numeric = Math.max(internal_numeric, external_numeric);
      p.rating = { internal: int.grade, internal_numeric, fitch: fi.grade, moodys: mo.grade, sp: sp.grade, external_grade, external_numeric, current_grade, current_numeric,
        ig_label: current_numeric > cfg.ig_threshold ? 'SUB IG' : 'IG', status: current_numeric === 0 ? 'NR' : 'rated' };
      p.src.rating = { table: 'calc', note: `current = internal unless NR, else worst external (Fitch→Moody's→S&P); IG if numeric ≤ ${cfg.ig_threshold}` };
      if (p.rating.status === 'NR' && !p.excluded) issue('warn', 'holdings.csv', p.line, 'No usable rating (all NR/blank). Workbook rule labels numeric 0 as "IG"; shown as NR here', { key: p.key });
      // derived fields
      p.fixed_floating = String(p.coupon_type || '').trim().toLowerCase() === 'fixed' ? 'Fixed' : 'Floating';
      p.initial_tenor = p.funding_date && p.maturity_date ? U.yearfrac(p.funding_date, p.maturity_date) : 0; // IFERROR(YEARFRAC,0)
      // remaining years: actual days / 365.25 from the reporting date; drives the maturity bucket
      p.remaining_years = reportingDate && p.maturity_date ? U.yearsBetween(reportingDate, p.maturity_date) : NaN;
      p.maturity_bucket = AUM.bucketOf(p.remaining_years, cfg.buckets);
    }

    // ---------- FX and amount conversion ----------
    // amount_eur = amount ÷ rate per EUR; amount_base (display currency, Output!G6) = amount_eur × display rate.
    const displayRate = fxStd.get(displayCcy);
    if (!displayRate) issue('error', 'fx.csv', null, `Display currency ${displayCcy} has no FX rate; amounts shown in ${cfg.base_currency}`);
    const dispRate = displayRate ? displayRate.rate : 1;
    /**
     * FX rate for a position: the most specific matching override (investor and platform match beats one
     * of them), else the standard rate for the currency, else null (the position is then excluded).
     */
    function rateFor(p) {
      const cands = fxOverrides.filter((o) => o.currency === p.currency && (!o.investor_id || o.investor_id === p.investor_id) && (!o.platform_id || o.platform_id === input.platform));
      if (cands.length) { cands.sort((a, b) => (b.investor_id ? 1 : 0) + (b.platform_id ? 1 : 0) - ((a.investor_id ? 1 : 0) + (a.platform_id ? 1 : 0))); return { rate: cands[0].rate, src: { table: 'fx.csv', row: cands[0]._row, note: 'override: ' + cands[0].note } }; }
      const s = fxStd.get(p.currency);
      return s ? { rate: s.rate, src: { table: 'fx.csv', row: s._row } } : null;
    }
    for (const p of positions) {
      if (p.excluded) continue;
      const r = rateFor(p);
      if (!r) { p.excluded = true; p.exclusionReason = `no FX rate for ${p.currency}`; issue('error', 'holdings.csv', p.line, `No FX rate for ${p.currency} — position excluded (the workbook's IFERROR would silently show 0)`, { key: p.key }); continue; }
      p.fx_rate = r.rate; p.src.fx_rate = r.src;
      p.nominal_eur = p.nominal / r.rate; p.drawn_eur = p.drawn / r.rate; p.commitment_eur = p.commitment / r.rate;
      p.nominal_base = p.nominal_eur * dispRate; p.drawn_base = p.drawn_eur * dispRate; p.commitment_base = p.commitment_eur * dispRate;
      p.src.nominal_base = { table: 'calc', note: `${p.currency} ${p.nominal} ÷ ${r.rate} (per EUR) × ${dispRate} (${displayCcy} per EUR)` };
    }

    // ---------- global filter (Scope.filters): keep only positions whose holdings line is in input.includeLines ----------
    // Filtered-out positions stay in result.positions (flagged) but feed no asset, row or metric.
    const keepLines = input.includeLines instanceof Set ? input.includeLines : null;
    let filteredOutCount = 0;
    if (keepLines) for (const p of positions) if (!p.excluded && !keepLines.has(p.line)) { p.filteredOut = true; filteredOutCount++; }
    const inView = (p) => !p.excluded && !p.filteredOut; // counts towards assets, rows and metrics

    // ---------- asset × investor matrices ----------
    // Workbook: nominal / drawn matrices = SUMIF over positions by asset code (D) and label & asset (F).
    // Investor columns follow mapping_investors.csv order, then one column per unmapped investor id in view.
    const unmappedLabels = U.uniq(positions.filter((p) => p.investor_group === 'Unmapped' && inView(p)).map((p) => p.investor_label));
    const investorColumns = investorOrder.map((i) => i.label).concat(unmappedLabels);
    const investorMeta = new Map(investorOrder.map((i) => [i.label, i]));
    unmappedLabels.forEach((l) => investorMeta.set(l, { id: '', key: '', label: l, group: 'Unmapped', group_weight: 0 }));
    const posByAsset = U.groupBy(positions.filter((p) => inView(p) && p.asset_code), (p) => p.asset_code);
    const assets = [];
    // Apply asset-level manual adjustments to an attribute record and record each field's provenance.
    const applyAssetAdjustments = (code, rec, src, tableName, fields) => {
      for (const f of fields) {
        const a = adjIndex.get(`assets|${code}|${f}`);
        if (a) { src[f] = { table: 'manual', adjustment: a, original: rec[f] }; rec[f] = a.value; }
        else if (rec[f] !== undefined) src[f] = { table: tableName, row: rec._row, col: f };
      }
    };
    for (const code of assetOrder) {
      const meta = assetMeta.get(code);
      const ps = posByAsset.get(code) || [];
      const a = { code, name: meta.name, code_name: meta.code_name, holdings: meta.holdings, positions: ps, positionCount: ps.length, excludedCount: positions.filter((p) => p.asset_code === code && p.excluded).length, src: {}, attrs: {}, esg: {}, byInvestor: new Map(), platform: {}, flags: [] };
      const sum = (f) => ps.reduce((s, p) => s + (p[f] || 0), 0); // Σ of a position field over this asset's positions in view
      a.nominal = sum('nominal_base'); a.drawn = sum('drawn_base'); a.commitment = sum('commitment_base');
      a.nominal_eur = sum('nominal_eur'); a.drawn_eur = sum('drawn_eur');
      for (const p of ps) {
        if (!a.byInvestor.has(p.investor_label)) a.byInvestor.set(p.investor_label, { nominal: 0, drawn: 0, commitment: 0, positions: 0 });
        const cell = a.byInvestor.get(p.investor_label); cell.nominal += p.nominal_base; cell.drawn += p.drawn_base; cell.commitment += p.commitment_base; cell.positions++;
      }
      const cellOf = (label) => a.byInvestor.get(label) || { nominal: 0, drawn: 0, commitment: 0 }; // empty investor cell = 0
      // Attributed to the group = SUMPRODUCT(investor columns, inclusion weights)
      a.group_nominal = 0; a.group_drawn = 0;
      for (const [label, cell] of a.byInvestor) { const w = (investorMeta.get(label) || { group_weight: 0 }).group_weight; a.group_nominal += cell.nominal * w; a.group_drawn += cell.drawn * w; }
      a.third_party_nominal = a.nominal - a.group_nominal; a.third_party_drawn = a.drawn - a.group_drawn;
      a.group_invested = a.group_nominal > 0;
      // platform columns = weighted composition (the workbook's special look-through columns): Σ weight × investor cell
      for (const [pid, pl] of platforms) {
        let n = 0, d = 0, c = 0;
        for (const comp of pl.composition) {
          if (comp.label === '*') for (const [, cell] of a.byInvestor) { n += cell.nominal * comp.weight; d += cell.drawn * comp.weight; c += cell.commitment * comp.weight; }
          else { const cell = cellOf(comp.label); n += cell.nominal * comp.weight; d += cell.drawn * comp.weight; c += cell.commitment * comp.weight; }
        }
        a.platform[pid] = { nominal: n, drawn: d, commitment: c };
      }
      // attributes (Hardcoded / ESG), with adjustments
      const hc = hardcodedByAsset.get(code);
      if (hc) { a.attrs = Object.assign({}, hc); applyAssetAdjustments(code, a.attrs, a.src, 'hardcoded.csv', AUM.ASSET_ATTRIBUTE_FIELDS); }
      else if (ps.length) { issue('warn', 'hardcoded.csv', null, `No manual attributes (sector, country, …) for ${code} ${meta.name}`, { key: code }); a.flags.push('no_attributes'); applyAssetAdjustments(code, a.attrs, a.src, 'hardcoded.csv', AUM.ASSET_ATTRIBUTE_FIELDS); }
      const eg = esgByAsset.get(code);
      if (eg) { a.esg = Object.assign({}, eg); applyAssetAdjustments(code, a.esg, a.src, 'esg.csv', AUM.ESG_FIELDS); }
      else if (ps.length) { a.flags.push('no_esg'); issue('info', 'esg.csv', null, `No ESG record for ${code} ${meta.name}`, { key: code }); }
      for (const f of AUM.NUMERIC_ASSET_FIELDS) { const holder = f in a.attrs ? a.attrs : a.esg; if (holder[f] !== undefined && holder[f] !== '') { const n = U.toNumber(holder[f]); if (U.isNum(n)) holder[f] = n; else issue('warn', f in a.attrs ? 'hardcoded.csv' : 'esg.csv', (f in a.attrs ? hc : eg) && (f in a.attrs ? hc : eg)._row, `${code}: ${f} "${holder[f]}" not numeric`, { key: code }); } }
      // position-level attributes shared by the asset (first position; flag inconsistencies)
      // protected life = share of funding → maturity that falls before protection_end_date ('' if not computable)
      const first = ps[0];
      if (first) {
        a.currency = U.uniq(ps.map((p) => p.currency)).length > 1 ? 'Multi' : first.currency;
        a.fixed_floating = first.fixed_floating; a.instrument_type = first.instrument_type || a.attrs.instrument || '';
        a.funding_date = first.funding_date; a.maturity_date = first.maturity_date; a.margin_bps = first.margin_bps; a.coupon = first.coupon;
        a.initial_tenor = first.initial_tenor; a.remaining_years = first.remaining_years; a.maturity_bucket = first.maturity_bucket;
        a.rating = first.rating;
        const grades = U.uniq(ps.map((p) => p.rating.current_grade));
        if (grades.length > 1) { a.flags.push('rating_inconsistent'); issue('warn', 'holdings.csv', first.line, `${code} ${meta.name}: positions carry different ratings (${grades.join(', ')}); first position's rating used`, { key: code }); }
        const pe = U.parseDate(a.attrs.protection_end_date);
        a.protected_life_fraction = pe && a.funding_date && a.maturity_date && a.maturity_date > a.funding_date ? (pe - a.funding_date) / (a.maturity_date - a.funding_date) : '';
        a.src.rating = first.src.rating; a.src.nominal = { table: 'calc', note: `Σ nominal_base over ${ps.length} position(s)` };
      }
      a.active = a.nominal > 0;
      assets.push(a);
    }
    // assets seen in holdings but absent from mapping → already errors; assets in mapping with no positions → info
    if (!keepLines) assets.filter((a) => !a.positionCount && !a.excludedCount).forEach((a) => issue('info', 'mapping_assets.csv', null, `${a.code} ${a.name} has no positions in holdings (repaid or not yet funded?)`, { key: a.code }));

    // ---------- selected platform → Output rows ----------
    // Output rows 11..283: one per asset with a positive nominal in the selected platform column (Output!G8),
    // amounts in the display unit, ranked by platform exposure. An unknown platform falls back to the first one.
    let platformId = input.platform;
    if (!platforms.has(platformId)) { const first = platforms.keys().next().value; if (platformId) issue('warn', 'platforms.csv', null, `Platform "${platformId}" not defined; showing ${first}`); platformId = first; }
    const platform = platforms.get(platformId);
    const unit = cfg.unit;
    const rows = assets.filter((a) => a.platform[platformId].nominal > 0).map((a) => {
      const pv = a.platform[platformId];
      const r = {
        code: a.code, name: a.name, code_name: a.code_name, asset: a,
        exposure_m: pv.nominal / unit, drawn_m: pv.drawn / unit, commitment_m: pv.commitment / unit, undrawn_m: (pv.nominal - pv.drawn) / unit,
        drawn_pct: pv.nominal ? pv.drawn / pv.nominal : NaN,
        total_nominal_m: a.nominal / unit, total_drawn_m: a.drawn / unit, total_commitment_m: a.commitment / unit,
        group_nominal_m: a.group_nominal / unit, third_party_nominal_m: a.third_party_nominal / unit, group_drawn_m: a.group_drawn / unit, third_party_drawn_m: a.third_party_drawn / unit,
        group_invested: a.group_invested ? 'Yes' : 'No',
        sector: a.attrs.sector || '', subsector: a.attrs.subsector || '', country: a.attrs.country || '', region: a.attrs.region || '', sponsor: a.attrs.sponsor || '',
        greenfield_brownfield: a.attrs.greenfield_brownfield || '', repayment_type: a.attrs.repayment_type || '', instrument: a.instrument_type || '', watchlist: a.attrs.watchlist || '',
        wal_years: U.isNum(a.attrs.wal_years) ? a.attrs.wal_years : NaN, deal_year: a.attrs.deal_year, covenant_type: a.attrs.covenant_type || '',
        currency: a.currency, fixed_floating: a.fixed_floating, margin_bps: a.margin_bps, coupon: a.coupon, funding_date: a.funding_date, maturity_date: a.maturity_date,
        initial_tenor: a.initial_tenor, remaining_years: a.remaining_years, maturity_bucket: a.maturity_bucket,
        rating: a.rating ? a.rating.current_grade : '', rating_numeric: a.rating ? a.rating.current_numeric : NaN, ig_label: a.rating ? a.rating.ig_label : '', rating_status: a.rating ? a.rating.status : '',
        internal_grade: a.rating ? a.rating.internal : '', external_grade: a.rating ? a.rating.external_grade : '',
        esg_score: U.isNum(a.esg.esg_score) ? a.esg.esg_score : NaN, green_loan: a.esg.green_loan || '', cbi_taxonomy: a.esg.cbi_taxonomy || '', sfdr_article: a.esg.sfdr_article || '',
        ghg_scope12_t: (U.isNum(a.esg.ghg_scope1_t) ? a.esg.ghg_scope1_t : 0) + (U.isNum(a.esg.ghg_scope2_t) ? a.esg.ghg_scope2_t : 0),
        investors: {}, investors_drawn: {},
        positions: a.positions.length, flags: a.flags,
      };
      for (const [label, cell] of a.byInvestor) { r.investors[label] = cell.nominal / unit; r.investors_drawn[label] = cell.drawn / unit; }
      return r;
    }).sort((x, y) => y.exposure_m - x.exposure_m);
    rows.forEach((r, i) => { r.rank = i + 1; });

    const { metrics, distributions } = AUM.summarise(rows, ratingScaleSP, cfg);
    // investor summary: totals over all assets (full units → display unit) and over the selected Output rows
    const investors = investorColumns.map((label) => {
      const meta = investorMeta.get(label);
      let nominal = 0, drawn = 0, commitment = 0, n = 0, selNominal = 0, selDrawn = 0;
      for (const a of assets) { const c = a.byInvestor.get(label); if (c) { nominal += c.nominal; drawn += c.drawn; commitment += c.commitment; n += c.positions; } }
      for (const r of rows) { selNominal += r.investors[label] || 0; selDrawn += r.investors_drawn[label] || 0; }
      return { label, key: meta.key, group: meta.group, group_weight: meta.group_weight, id: meta.id, nominal_m: nominal / unit, drawn_m: drawn / unit, commitment_m: commitment / unit, positions: n, selected_nominal_m: selNominal, selected_drawn_m: selDrawn };
    });
    const excludedPositions = positions.filter((p) => p.excluded);
    const sev = { error: 0, warn: 0, info: 0 }; issues.forEach((i) => { sev[i.severity] = (sev[i.severity] || 0) + 1; });
    return {
      config: cfg, ratingScale: ratingScaleSP, displayCurrency: displayRate ? displayCcy : cfg.base_currency, currencies: Array.from(fxStd.keys()), reportingDate, quarter: U.quarterCaption(reportingDate),
      platform, platformId, platforms: Array.from(platforms.values()), investors, investorColumns, assets, positions, rows, metrics, distributions, issues, issueCounts: sev,
      stats: { holdingsRows: hRecords.length, paddingRows, positions: positions.length, excluded: excludedPositions.length, included: positions.length - excludedPositions.length, assetsMapped: assets.length, assetsActive: assets.filter((a) => a.active).length, assetsSelected: rows.length, filteredOut: filteredOutCount, inView: positions.filter(inView).length },
      excludedPositions, fatal, filtered: !!keepLines,
    };
  };

  /** Flat records of the Output sheet for CSV export (one column per investor for nominal and for drawn, in the display unit). */
  AUM.outputRecords = function (res) {
    const f = U.isoDate;
    return res.rows.map((r) => {
      const o = { rank: r.rank, asset_code: r.code, asset_name: r.name, code_name: r.code_name, platform: res.platform.label, currency_display: res.displayCurrency,
        exposure_m: r.exposure_m, drawn_m: r.drawn_m, undrawn_m: r.undrawn_m, drawn_pct: r.drawn_pct, commitment_m: r.commitment_m,
        total_nominal_m: r.total_nominal_m, group_nominal_m: r.group_nominal_m, third_party_nominal_m: r.third_party_nominal_m, total_drawn_m: r.total_drawn_m, group_drawn_m: r.group_drawn_m, third_party_drawn_m: r.third_party_drawn_m, group_invested: r.group_invested,
        sector: r.sector, subsector: r.subsector, country: r.country, region: r.region, sponsor: r.sponsor, greenfield_brownfield: r.greenfield_brownfield, repayment_type: r.repayment_type, instrument: r.instrument,
        position_currency: r.currency, fixed_floating: r.fixed_floating, margin_bps: r.margin_bps, coupon: r.coupon, funding_date: f(r.funding_date), maturity_date: f(r.maturity_date), initial_tenor: r.initial_tenor, remaining_years: r.remaining_years, maturity_bucket: r.maturity_bucket, wal_years: r.wal_years,
        internal_grade: r.internal_grade, external_grade: r.external_grade, current_rating: r.rating, rating_numeric: r.rating_numeric, ig_label: r.rating_status === 'rated' ? r.ig_label : 'NR', watchlist: r.watchlist,
        esg_score: r.esg_score, green_loan: r.green_loan, cbi_taxonomy: r.cbi_taxonomy, ghg_scope12_t: r.ghg_scope12_t, positions: r.positions, flags: r.flags.join('|') };
      for (const label of res.investorColumns) o['nominal_m: ' + label] = r.investors[label] || 0;
      for (const label of res.investorColumns) o['drawn_m: ' + label] = r.investors_drawn[label] || 0;
      return o;
    });
  };
  /** Flat records of canonical positions (Calculations sheet) for CSV export, excluded ones included and flagged; globally filtered-out ones omitted. */
  AUM.positionRecords = function (res) {
    const f = U.isoDate;
    return res.positions.filter((p) => !p.filteredOut).map((p) => ({ line: p.line, key: p.key, investor_id: p.investor_id, investor_label: p.investor_label, investor_group: p.investor_group, holding_id: p.holding_id, asset_code: p.asset_code || '', asset_name: p.asset_name,
      currency: p.currency, nominal: p.nominal, drawn: p.drawn, commitment: p.commitment, fx_rate: p.fx_rate, nominal_eur: p.nominal_eur, drawn_eur: p.drawn_eur, ['nominal_' + res.displayCurrency]: p.nominal_base, ['drawn_' + res.displayCurrency]: p.drawn_base,
      internal_grade: p.rating.internal, fitch: p.rating.fitch, moodys: p.rating.moodys, sp: p.rating.sp, external_grade: p.rating.external_grade, current_grade: p.rating.current_grade, current_numeric: p.rating.current_numeric, ig_label: p.rating.status === 'rated' ? p.rating.ig_label : 'NR',
      funding_date: f(p.funding_date), maturity_date: f(p.maturity_date), fixed_floating: p.fixed_floating, margin_bps: p.margin_bps, coupon: p.coupon, initial_tenor: p.initial_tenor, remaining_years: p.remaining_years, maturity_bucket: p.maturity_bucket,
      excluded: p.excluded ? 'Y' : '', exclusion_reason: p.exclusionReason || '', flags: p.flags.join('|') }));
  };
})(typeof window !== 'undefined' ? window : globalThis);
