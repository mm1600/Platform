/* Module: Layer 2 · Concentration & risk — how concentrated the selected platform is by name, sponsor, sector, country,
 * rating, currency and maturity, read against ILLUSTRATIVE thresholds from config.csv (never mandate limits).
 *
 * Scope.concentration holds the pure helpers. Nothing here touches the DOM at load time, so tests/concentration.tests.js
 * runs them in Node:
 *   hhi(values) · effectiveN(hhiOrValues) · groupShares(rows, keyFn, valueFn) · paretoCumulative(items, total)
 *   addMonths(date, n) · maturityLadder(rows, reportingDate, opts) · thresholds(res) · metrics(res) · baseCurrency(res)
 * The page registers only where Scope.registerModule exists (the app shell). Clicking a chart adds a global filter
 * (Scope.filters) so every page follows the selection. Amounts are in the display currency, in millions. */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const toNum = (v) => (Scope.util && Scope.util.toNumber ? Scope.util.toNumber(v) : typeof v === 'number' ? v : parseFloat(v));
  const BLANK = '(blank)';
  const expo = (r) => (r && isNum(r.exposure_m) ? r.exposure_m : 0);
  const sumOf = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  const CX = (Scope.concentration = {});
  CX.BLANK = BLANK;

  // ======================================================================
  // Pure helpers
  // ======================================================================

  /** Herfindahl–Hirschman index Σ share² (0 … 1) of a list of amounts. Non-numeric and non-positive amounts are ignored; NaN when none remain. */
  CX.hhi = function (values) {
    const v = (values || []).filter((x) => isNum(x) && x > 0);
    const t = sumOf(v, (x) => x);
    if (!(t > 0)) return NaN;
    return sumOf(v, (x) => (x / t) * (x / t));
  };

  /** Effective number of names = 1 / HHI. Accepts an HHI (number) or a list of amounts; NaN when undefined. */
  CX.effectiveN = function (x) {
    const h = Array.isArray(x) ? CX.hhi(x) : x;
    return isNum(h) && h > 0 ? 1 / h : NaN;
  };

  /** Group rows by a key → [{ label, value, share, count }], largest first. Blank keys read "(blank)"; rows with a non-numeric value are skipped. */
  CX.groupShares = function (rows, keyFn, valueFn) {
    valueFn = valueFn || expo;
    const m = new Map();
    let total = 0;
    for (const r of rows || []) {
      const v = valueFn(r);
      if (!isNum(v)) continue;
      const k0 = keyFn(r), k = k0 === '' || k0 === null || k0 === undefined ? BLANK : String(k0);
      if (!m.has(k)) m.set(k, { label: k, value: 0, count: 0 });
      const g = m.get(k); g.value += v; g.count++; total += v;
    }
    return Array.from(m.values()).map((g) => Object.assign(g, { share: total ? g.value / total : NaN }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  };

  /** Rank items { value } largest first and add rank, share of total and cumulative share. `total` defaults to Σ values (pass the book total for a top-N cut). */
  CX.paretoCumulative = function (items, total) {
    const list = (items || []).filter((x) => x && isNum(x.value)).slice().sort((a, b) => b.value - a.value);
    const t = isNum(total) && total > 0 ? total : sumOf(list, (x) => x.value);
    let cum = 0;
    return list.map((x, i) => { cum += x.value; return Object.assign({}, x, { rank: i + 1, share: t ? x.value / t : NaN, cumShare: t ? cum / t : NaN }); });
  };

  /** Add n calendar months to a UTC date, clamping to the month end (31 Jan + 1 month = 28/29 Feb). */
  CX.addMonths = function (d, n) {
    if (!(d instanceof Date) || isNaN(d)) return null;
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
  };

  CX.WINDOWS = [12, 24, 36];
  CX.MAX_LADDER_YEARS = 80; // guard against a stray date stretching the ladder; older years fold into the first bar

  /**
   * Maturity ladder: exposure maturing per calendar year of maturity_date, plus "maturing within n months" windows.
   * Years run continuously from the reporting year (or the earliest maturity, if earlier) to the last maturity, so empty
   * years show as gaps. Rows without a maturity date go to `unknown`. A window counts every dated row maturing on or
   * before reportingDate + n months, including any already past due on the reporting date.
   * opts: { value(row) → amount (default exposure_m), windows: [months] }
   * → { years:[{ label, year, value, count, share, cumShare }], unknown:{ value, count, share }, within:{ n:{ months, until, value, count, share } }, total }
   */
  CX.maturityLadder = function (rows, reportingDate, opts) {
    opts = opts || {};
    const valueFn = opts.value || expo;
    const rd = reportingDate instanceof Date && !isNaN(reportingDate) ? reportingDate : null;
    const byYear = new Map(), unknown = { value: 0, count: 0, share: NaN };
    let total = 0;
    const dated = [];
    for (const r of rows || []) {
      const v = valueFn(r);
      if (!isNum(v)) continue;
      total += v;
      const d = r.maturity_date;
      if (!(d instanceof Date) || isNaN(d)) { unknown.value += v; unknown.count++; continue; }
      dated.push({ d, v });
      const y = d.getUTCFullYear();
      if (!byYear.has(y)) byYear.set(y, { value: 0, count: 0 });
      const b = byYear.get(y); b.value += v; b.count++;
    }
    const years = [];
    const ys = Array.from(byYear.keys());
    if (ys.length) {
      const last = Math.max.apply(null, ys);
      let first = Math.min.apply(null, rd ? ys.concat([rd.getUTCFullYear()]) : ys);
      const floor = last - CX.MAX_LADDER_YEARS;
      let carry = { value: 0, count: 0 };
      if (first < floor) { for (const y of ys) if (y < floor) { carry.value += byYear.get(y).value; carry.count += byYear.get(y).count; } first = floor; }
      let cum = 0;
      for (let y = first; y <= last; y++) {
        const b = byYear.get(y) || { value: 0, count: 0 };
        const value = b.value + (y === first ? carry.value : 0), count = b.count + (y === first ? carry.count : 0);
        cum += value;
        years.push({ label: y === first && carry.count ? y + ' or earlier' : String(y), year: y, value, count, share: total ? value / total : NaN, cumShare: total ? cum / total : NaN });
      }
    }
    unknown.share = total ? unknown.value / total : NaN;
    const within = {};
    for (const n of opts.windows || CX.WINDOWS) {
      const until = rd ? CX.addMonths(rd, n) : null;
      let value = 0, count = 0;
      if (until) for (const x of dated) if (x.d <= until) { value += x.v; count++; }
      within[n] = { months: n, until, value: until ? value : NaN, count, share: until && total ? value / total : NaN };
    }
    return { years, unknown, within, total };
  };

  /** Base currency of the book (config.csv base_currency), used for the non-base-currency share. */
  CX.baseCurrency = function (res) {
    const c = (res && res.config) || {};
    return c.base_currency || (c.raw && c.raw.base_currency) || 'EUR';
  };

  /** The illustrative thresholds read from config.csv (percent values). `field` is the dataset field the worst contributor filters on. */
  CX.THRESHOLDS = [
    { id: 'single_name', key: 'limit_single_name_pct', label: 'Largest single asset', field: 'asset_code' },
    { id: 'sponsor', key: 'limit_sponsor_pct', label: 'Largest sponsor', field: 'sponsor' },
    { id: 'sector', key: 'limit_sector_pct', label: 'Largest sector', field: 'sector' },
    { id: 'country', key: 'limit_country_pct', label: 'Largest country', field: 'country' },
    { id: 'sub_ig', key: 'limit_sub_ig_pct', label: 'Sub-IG share', field: 'ig_label' },
    { id: 'non_base_ccy', key: 'limit_non_base_ccy_pct', label: 'Non-base-currency share', field: 'currency' },
  ];

  // largest asset of a row set → contributor { label, code, value, share, filter }
  function topAsset(rows, total, filter) {
    let top = null;
    for (const r of rows) if (!top || expo(r) > expo(top)) top = r;
    if (!top) return null;
    return { label: top.name || top.code, code: top.code, value: expo(top), share: total > 0 ? expo(top) / total : NaN, filter: filter || { field: 'asset_code', value: [top.code] } };
  }

  /**
   * Measure the book against each illustrative threshold in config.csv (limit_*_pct, in percent).
   * Largest sponsor / sector / country ignore blank labels (an unknown sponsor is not one counterparty). Sub-IG is
   * rated sub-investment-grade exposure over all exposure (NR excluded, as in the engine metrics). Non-base currency is
   * exposure whose position currency differs from config base_currency; a multi-currency asset counts as non-base.
   * → [{ id, key, label, field, measured, limit, headroom, utilisation, status:'within'|'above'|'na', worst, illustrative:true }]
   */
  CX.thresholds = function (res) {
    const rows = (res && res.rows) || [];
    const raw = (res && res.config && res.config.raw) || {};
    const total = sumOf(rows, expo);
    const share = (v) => (total > 0 ? v / total : NaN);
    return CX.THRESHOLDS.map((def) => {
      const pctValue = toNum(raw[def.key]);
      const limit = isNum(pctValue) ? pctValue / 100 : NaN;
      let measured = NaN, worst = null;
      if (def.id === 'single_name') {
        worst = topAsset(rows, total);
        measured = worst ? worst.share : NaN;
      } else if (def.id === 'sponsor' || def.id === 'sector' || def.id === 'country') {
        const g = CX.groupShares(rows, (r) => r[def.id]).filter((x) => x.label !== BLANK)[0];
        measured = g ? share(g.value) : total > 0 ? 0 : NaN;
        if (g) worst = { label: g.label, value: g.value, share: share(g.value), filter: { field: def.field, value: [g.label] } };
      } else if (def.id === 'sub_ig') {
        const sub = rows.filter((r) => r.rating_status === 'rated' && r.ig_label === 'SUB IG');
        measured = share(sumOf(sub, expo));
        worst = topAsset(sub, total, { field: 'ig_label', value: ['SUB IG'] });
      } else if (def.id === 'non_base_ccy') {
        const base = CX.baseCurrency(res);
        const nb = rows.filter((r) => r.currency && r.currency !== base);
        measured = share(sumOf(nb, expo));
        const g = CX.groupShares(nb, (r) => r.currency)[0];
        // a "Multi" asset has no single position currency to filter on
        if (g) worst = { label: g.label, value: g.value, share: share(g.value), filter: g.label === 'Multi' ? null : { field: 'currency', value: [g.label] } };
      }
      const ok = isNum(limit) && isNum(measured);
      return {
        id: def.id, key: def.key, label: def.label, field: def.field, measured, limit,
        headroom: ok ? limit - measured : NaN, utilisation: ok && limit > 0 ? measured / limit : NaN,
        status: !ok ? 'na' : measured > limit + 1e-12 ? 'above' : 'within', worst, illustrative: true,
      };
    });
  };

  /**
   * Headline concentration measures of an engine result (rows with exposure on the selected platform).
   * HHIs are fractions (0 … 1); multiply by 10,000 for index points.
   */
  CX.metrics = function (res) {
    const rows = (res && res.rows) || [];
    const total = sumOf(rows, expo);
    const share = (v) => (total > 0 ? v / total : NaN);
    const sorted = rows.slice().sort((a, b) => expo(b) - expo(a));
    const exps = sorted.map(expo);
    const topShare = (n) => share(sumOf(exps.slice(0, n), (x) => x));
    const sectors = CX.groupShares(rows, (r) => r.sector), countries = CX.groupShares(rows, (r) => r.country);
    const sponsors = CX.groupShares(rows, (r) => r.sponsor).filter((s) => s.label !== BLANK);
    const currencies = CX.groupShares(rows, (r) => r.currency);
    const base = CX.baseCurrency(res);
    const where = (f) => sumOf(rows.filter(f), expo);
    const hhiAsset = CX.hhi(exps), hhiSector = CX.hhi(sectors.map((g) => g.value)), hhiCountry = CX.hhi(countries.map((g) => g.value)), hhiSponsor = CX.hhi(sponsors.map((g) => g.value));
    const ladder = CX.maturityLadder(rows, res && res.reportingDate);
    const undrawn = sumOf(rows, (r) => (isNum(r.undrawn_m) ? r.undrawn_m : 0)), drawn = sumOf(rows, (r) => (isNum(r.drawn_m) ? r.drawn_m : 0));
    const big = sorted[0];
    return {
      total, nAssets: rows.length, nPositions: sumOf(rows, (r) => (isNum(r.positions) ? r.positions : 0)), nSponsors: sponsors.length,
      largest: big ? { name: big.name || big.code, code: big.code, value: expo(big), share: share(expo(big)) } : null,
      top5Share: topShare(5), top10Share: topShare(10),
      hhiAsset, effectiveN: CX.effectiveN(hhiAsset),
      hhiSector, effectiveSectors: CX.effectiveN(hhiSector), largestSector: sectors[0] || null,
      hhiCountry, effectiveCountries: CX.effectiveN(hhiCountry), largestCountry: countries[0] || null,
      hhiSponsor, largestSponsor: sponsors[0] || null,
      subIgShare: share(where((r) => r.rating_status === 'rated' && r.ig_label === 'SUB IG')), nrShare: share(where((r) => r.rating_status !== 'rated')),
      floatingShare: share(where((r) => r.fixed_floating === 'Floating')), fixedShare: share(where((r) => r.fixed_floating === 'Fixed')),
      baseCurrency: base, nonBaseShare: share(where((r) => r.currency && r.currency !== base)),
      largestNonBase: currencies.filter((c) => c.label !== base && c.label !== BLANK)[0] || null,
      drawn, drawnShare: share(drawn), undrawn, undrawnShare: share(undrawn),
      maturing: ladder.within, ladder, sectors, countries, sponsors, currencies,
    };
  };

  // ======================================================================
  // Page (browser only)
  // ======================================================================
  if (typeof Scope.registerModule !== 'function') return;

  // view state survives re-renders (a chart click adds a global filter, which re-renders the page)
  const VIEW_KEY = 'scope.concentration.view';
  const view = { group: 'sector', rowDim: 'rating', colDim: 'maturity_bucket', measure: 'exposure', mapView: null, selected: null };
  let viewLoaded = false;
  // restore the per-viewer layout choices (best effort: storage may be unavailable)
  function loadView() {
    try { const s = JSON.parse(global.localStorage.getItem(VIEW_KEY) || 'null'); if (s && typeof s === 'object') for (const k of ['group', 'rowDim', 'colDim', 'measure', 'mapView']) if (typeof s[k] === 'string') view[k] = s[k]; } catch (e) { /* storage unavailable */ }
  }
  // persist the layout choices (never the selection, which depends on the filters)
  function saveView() {
    try { global.localStorage.setItem(VIEW_KEY, JSON.stringify({ group: view.group, rowDim: view.rowDim, colDim: view.colDim, measure: view.measure, mapView: view.mapView })); } catch (e) { /* storage unavailable */ }
  }

  /** Add global filters ({ field, value[] }) shared by every page; without Scope.filters, open the Explorer instead. */
  function addFilters(list) {
    const fs = (list || []).filter((f) => f && f.field);
    if (!fs.length) return;
    if (Scope.filters && typeof Scope.filters.add === 'function') {
      for (const f of fs) Scope.filters.add({ field: f.field, op: 'in', value: (Array.isArray(f.value) ? f.value : [f.value]).map((v) => (v === '' || v === null || v === undefined ? BLANK : String(v))) });
    } else if (Scope.navigate) Scope.navigate('explorer');
  }
  const addFilter = (field, value) => addFilters([{ field, value }]);

  // treemap groupings
  const GROUPINGS = [
    { id: 'sector', label: 'Sector', key: (r) => r.sector },
    { id: 'country', label: 'Country', key: (r) => r.country },
    { id: 'sponsor', label: 'Sponsor', key: (r) => r.sponsor },
    { id: 'rating', label: 'Rating', key: (r) => (r.rating_status === 'rated' ? r.rating : 'NR') },
  ];
  // heatmap dimensions (dataset field ids, so a clicked cell maps straight onto a global filter)
  const HEAT_DIMS = ['rating', 'ig_label', 'maturity_bucket', 'maturity_year', 'sector', 'subsector', 'country', 'region', 'currency', 'fixed_floating', 'sponsor', 'investor_group', 'investor_label', 'watchlist'];

  function render(el, ctx) {
    if (!viewLoaded) { loadView(); viewLoaded = true; }
    const U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, Ch = Scope.charts;
    const res = ctx.result, ccy = res.displayCurrency, rows = res.rows || [];
    const A = (res.config && res.config.attribution_label) || 'Group';
    const mfmt = (v) => F.m(v) + 'm';       // chart labels, display-currency millions
    const cfmt = (v) => F.ccy(v, ccy);      // KPI values, "EUR 1,234.5m"
    const pts = (x) => (isNum(x) ? F.int(x * 10000) : '–'); // HHI in index points
    const M = CX.metrics(res), TH = CX.thresholds(res);
    const thById = {}; TH.forEach((t) => { thById[t.id] = t; });
    const base = M.baseCurrency;
    const draws = []; // { body, fn } chart renderers, re-run on resize

    // ---------- header ----------
    const actions = [h('button', { class: 'btn btn-sm', onClick: () => Scope.navigate('explorer'), title: 'Open the Explorer pivot over the same data' }, Scope.icon('grid', { size: 14 }), 'Open in Explorer')];
    const sub = `${ccy} m · reporting date ${F.date(res.reportingDate)} · exposure by name, sponsor, sector, country, rating, currency and maturity`;
    el.appendChild(Scope.app && Scope.app.pageHead ? Scope.app.pageHead({ title: 'Concentration · ' + res.platform.label, sub, actions }) : h('h1', { class: 'h3' }, 'Concentration · ' + res.platform.label));

    // ---------- active global filters ----------
    const gf = res.globalFilters || [];
    if (gf.length) {
      const baseTotal = res.base && res.base.metrics ? res.base.metrics.total_exposure_m : NaN;
      const ds = Scope.engine && Scope.engine.dataset ? Scope.engine.dataset.build(res.base || res) : null;
      const label = (id) => (ds && ds.fieldById[id] ? ds.fieldById[id].label : id);
      const valueText = (f) => { const v = Array.isArray(f.value) ? f.value : [f.value]; return (f.op && f.op !== 'in' ? f.op + ' ' : '') + v.slice(0, 3).join(', ') + (v.length > 3 ? ` +${v.length - 3}` : ''); };
      el.appendChild(h('div', { class: 'notice info cx-filter-note' },
        h('div', {}, Scope.icon('filter', { size: 14 }), ` Figures reflect ${gf.length} active filter${gf.length === 1 ? '' : 's'} (${F.m(M.total)} of ${F.m(baseTotal)} ${ccy} m${isNum(baseTotal) && baseTotal > 0 ? ', ' + F.pct(M.total / baseTotal) : ''}).`),
        h('div', { class: 'cx-filter-list' }, gf.map((f) => `${label(f.field)}: ${valueText(f)}`).join(' · ')),
        Scope.filters && typeof Scope.filters.clear === 'function' ? h('button', { class: 'btn btn-sm btn-ghost', onClick: () => Scope.filters.clear() }, Scope.icon('x', { size: 14 }), 'Clear filters') : null));
    }
    if (!rows.length) { el.appendChild(UI.section({ title: 'No exposure', body: UI.empty('No asset has exposure on this platform with the current filters.') })); return; }

    // ---------- KPI row ----------
    const above = (id) => !!thById[id] && thById[id].status === 'above';
    const thTitle = (id) => { const t = thById[id]; return t && isNum(t.limit) ? `Illustrative threshold from config.csv: ${F.pct(t.limit, 0)} (not a mandate limit)` : undefined; };
    const within = (n) => M.maturing[n] || {};
    const matKpi = (n) => UI.kpi({ icon: 'clock', label: `Maturing within ${n} months`, value: cfmt(within(n).value), sub: `${F.pct(within(n).share)} of exposure · ${F.int(within(n).count)} asset${within(n).count === 1 ? '' : 's'}`, title: `Maturity date on or before ${F.date(within(n).until)} (reporting date + ${n} months), past-due included` });
    el.appendChild(h('div', { class: 'kpis cx-kpis' },
      UI.kpi({ icon: 'database', label: 'Total exposure', value: cfmt(M.total), sub: `${F.int(M.nPositions)} positions · ${F.pct(M.drawnShare)} drawn` }),
      UI.kpi({ icon: 'box', label: 'Assets (obligors)', value: F.int(M.nAssets), sub: 'with exposure on this platform' }),
      UI.kpi({ icon: 'briefcase', label: 'Sponsors', value: F.int(M.nSponsors), tone: above('sponsor') ? 'warn' : null, title: thTitle('sponsor'), sub: M.largestSponsor ? `largest ${M.largestSponsor.label} ${F.pct(M.largestSponsor.share)}` : 'no sponsor recorded' }),
      UI.kpi({ icon: 'target', label: 'Largest single asset', value: F.pct(M.largest && M.largest.share), tone: above('single_name') ? 'warn' : null, title: thTitle('single_name'), sub: M.largest ? `${M.largest.name} · ${mfmt(M.largest.value)}` : '' }),
      UI.kpi({ icon: 'bar-chart-2', label: 'Top-10 share', value: F.pct(M.top10Share), sub: `top 5 ${F.pct(M.top5Share)}` }),
      UI.kpi({ icon: 'grid', label: 'HHI · assets', value: pts(M.hhiAsset), sub: `effective names ${F.n1(M.effectiveN)} (1/HHI)`, title: 'Herfindahl–Hirschman index = sum of squared exposure shares, shown × 10,000' }),
      UI.kpi({ icon: 'layers', label: 'HHI · sectors', value: pts(M.hhiSector), tone: above('sector') ? 'warn' : null, title: thTitle('sector'), sub: M.largestSector ? `largest ${M.largestSector.label} ${F.pct(M.largestSector.share)} · ${F.n1(M.effectiveSectors)} effective` : '' }),
      UI.kpi({ icon: 'map', label: 'HHI · countries', value: pts(M.hhiCountry), tone: above('country') ? 'warn' : null, title: thTitle('country'), sub: M.largestCountry ? `largest ${M.largestCountry.label} ${F.pct(M.largestCountry.share)} · ${F.n1(M.effectiveCountries)} effective` : '' }),
      UI.kpi({ icon: 'shield', label: 'Sub-IG share', value: F.pct(M.subIgShare), tone: above('sub_ig') ? 'warn' : null, title: thTitle('sub_ig'), sub: `NR ${F.pct(M.nrShare)} shown separately` }),
      UI.kpi({ icon: 'activity', label: 'Floating share', value: F.pct(M.floatingShare), sub: `fixed ${F.pct(M.fixedShare)}` }),
      UI.kpi({ icon: 'dollar-sign', label: 'Non-base currency', value: F.pct(M.nonBaseShare), tone: above('non_base_ccy') ? 'warn' : null, title: thTitle('non_base_ccy'), sub: `base ${base}` + (M.largestNonBase ? ` · largest ${M.largestNonBase.label} ${F.pct(M.largestNonBase.share)}` : '') }),
      matKpi(12), matKpi(24), matKpi(36),
      UI.kpi({ icon: 'inbox', label: 'Undrawn commitments', value: cfmt(M.undrawn), sub: `${F.pct(M.undrawnShare)} of exposure` }),
    ));

    // ---------- illustrative thresholds ----------
    const utilBar = (t) => {
      if (!isNum(t.utilisation)) return h('span', { class: 'muted' }, '–');
      return h('span', { class: 'cx-util-cell' }, h('span', { class: 'cx-util' + (t.status === 'above' ? ' cx-util-over' : ''), title: `${F.pct(t.utilisation, 0)} of the illustrative threshold` }, h('span', { style: { width: Math.min(100, t.utilisation * 100).toFixed(1) + '%' } })), h('span', { class: 'cx-util-pct' }, F.pct(t.utilisation, 0)));
    };
    const statusBadge = (t) => (t.status === 'above' ? UI.badge('Above', 'warn', 'Above the illustrative threshold from config.csv') : t.status === 'within' ? UI.badge('Within', 'ok', 'Within the illustrative threshold from config.csv') : UI.badge('Not set', 'muted', 'No illustrative threshold in config.csv'));
    const thRows = TH.map((t) => Object.assign({}, t, { label: t.id === 'non_base_ccy' ? `${t.label} (base ${base})` : t.label, worstLabel: t.worst ? t.worst.label : '' }));
    el.appendChild(UI.section({ title: 'Illustrative thresholds', subtitle: 'Illustrative thresholds from config.csv, not mandate limits · click a row to filter on its worst contributor',
      body: UI.table({ rows: thRows, filter: false, compact: true, onRow: (t) => { if (t.worst && t.worst.filter) addFilters([t.worst.filter]); }, columns: [
        { key: 'label', label: 'Measure', class: 'strong', title: 'Each threshold is an illustrative value from config.csv' },
        { key: 'measured', label: 'Measured', align: 'right', format: (v) => F.pct(v) },
        { key: 'limit', label: 'Illustrative threshold', align: 'right', format: (v) => (isNum(v) ? F.pct(v, 0) : 'not set'), title: 'Illustrative threshold from config.csv, not a mandate limit' },
        { key: 'headroom', label: 'Headroom', align: 'right', format: (v) => (isNum(v) ? (v >= 0 ? '+' : '-') + F.n1(Math.abs(v) * 100) + ' pp' : '–'), title: 'Threshold minus measured, in percentage points' },
        { key: 'utilisation', label: 'Utilisation', render: utilBar },
        { key: 'status', label: 'Status', render: statusBadge },
        { key: 'worstLabel', label: 'Worst contributor', format: (v, t) => (t.worst ? `${t.worst.label} · ${F.pct(t.worst.share)}` : '–') },
      ] }) }));

    // ---------- map ----------
    const mapBody = h('div');
    el.appendChild(UI.section({ title: 'Exposure by country', subtitle: `${ccy} m by asset country · click a country to filter`, body: mapBody }));
    const countryValues = {}; M.countries.forEach((c) => { countryValues[c.label] = c.value; });
    draws.push({ body: mapBody, fn: () => Ch.choropleth(mapBody, { values: countryValues, format: mfmt, view: view.mapView, onViewChange: (v) => { view.mapView = v; saveView(); }, onClick: (c) => addFilter('country', c) }) });

    // ---------- treemap with a details panel ----------
    const grouping = () => GROUPINGS.find((g) => g.id === view.group) || GROUPINGS[0];
    const select = (options, value, onChange) => h('select', { class: 'input cx-select', onChange: (e) => onChange(e.target.value) }, options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.label)));
    const tmChart = h('div', { class: 'cx-tm-chart' }), tmPanel = h('div', { class: 'cx-panel' });
    // stable colour order from the unfiltered book, so filtering never repaints a group
    const groupOrder = () => { const d = (res.base || res).distributions; const g = grouping(); return d && d[g.id] ? d[g.id].map((x) => x.label) : CX.groupShares((res.base || res).rows || rows, g.key).map((x) => x.label); };
    const drawTreemap = () => Ch.treemap(tmChart, {
      items: rows.map((r) => ({ label: r.name, value: r.exposure_m, group: grouping().key(r) || BLANK, sub: `${r.code} · ${r.sector || BLANK} · ${r.country || BLANK}`, key: r.code })),
      format: mfmt, groupOrder: groupOrder(), selectedKey: view.selected,
      onClick: (it) => { view.selected = it.key; renderPanel(); addFilter('asset_code', it.key); },
    });
    // details of the selected tile, with the asset-page action a tooltip cannot offer
    function renderPanel() {
      tmPanel.innerHTML = '';
      const r = view.selected ? rows.find((x) => x.code === view.selected) : null;
      if (!r) { tmPanel.appendChild(h('div', { class: 'cx-panel-empty' }, Scope.icon('info', { size: 16 }), h('p', {}, 'Click a tile to filter every page on that asset. Its details appear here.'))); return; }
      const book = (res.base || res).metrics.total_exposure_m;
      tmPanel.append(
        h('div', { class: 'cx-panel-head' }, h('h3', {}, r.name), h('div', { class: 'small muted' }, r.code + (r.code_name ? ' · ' + r.code_name : ''))),
        UI.dl([
          ['Exposure', `${cfmt(r.exposure_m)} · ${F.pct(book ? r.exposure_m / book : NaN)} of platform`],
          ['Drawn / undrawn', `${F.m(r.drawn_m)} / ${F.m(r.undrawn_m)} ${ccy} m`],
          ['Sector', (r.sector || '–') + (r.subsector ? ' · ' + r.subsector : '')],
          ['Country', r.country || '–'], ['Sponsor', r.sponsor || '–'],
          ['Rating', r.rating_status === 'rated' ? `${r.rating} · ${r.ig_label}` : 'NR'],
          ['Maturity', `${F.date(r.maturity_date)} · ${F.yrs(r.remaining_years)}`],
          ['Margin', F.bps(r.margin_bps)], ['Watchlist', r.watchlist || '–'],
        ]),
        h('div', { class: 'cx-panel-actions' },
          h('button', { class: 'btn btn-primary btn-sm', onClick: () => Scope.navigate('asset', r.code) }, Scope.icon('eye', { size: 14 }), 'Open asset'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { view.selected = null; renderPanel(); drawTreemap(); } }, 'Clear selection')));
    }
    el.appendChild(UI.section({ title: 'Exposure by asset', subtitle: 'tile area = exposure · click a tile to filter on the asset',
      actions: h('label', { class: 'cx-ctrl' }, 'Group by', select(GROUPINGS, grouping().id, (v) => { view.group = v; saveView(); drawTreemap(); })),
      body: h('div', { class: 'cx-tm' }, tmChart, tmPanel) }));
    renderPanel();
    draws.push({ body: tmChart, fn: drawTreemap });

    // ---------- pareto + maturity ladder ----------
    const parBody = h('div'), ladBody = h('div');
    const single = thById.single_name;
    const buckets = (res.distributions && res.distributions.maturity_bucket) || [];
    const bucketTable = h('div', { class: 'compact cx-buckets' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Remaining tenor'), h('th', { class: 'num' }, `Exposure ${ccy}m`), h('th', { class: 'num' }, 'Share'), h('th', { class: 'num' }, 'Assets'))),
      h('tbody', {}, buckets.map((d) => h('tr', { class: 'clickable', title: 'Filter on ' + d.label, onClick: () => addFilter('maturity_bucket', d.label) },
        h('td', {}, d.label), h('td', { class: 'num' }, F.m(d.exposure_m)), h('td', { class: 'num' }, F.pct(d.share)), h('td', { class: 'num' }, F.int(d.count)))))));
    const unk = M.ladder.unknown;
    el.appendChild(h('div', { class: 'charts' },
      UI.section({ title: 'Single-name concentration', subtitle: 'top 15 assets as % of exposure, cumulative share on the same axis · click a bar to filter', body: parBody }),
      UI.section({ title: 'Maturity ladder', subtitle: `${ccy} m maturing per calendar year · cumulative share below · click a bar to filter`,
        body: h('div', {}, ladBody, bucketTable, unk.value > 0 ? h('p', { class: 'cx-hint' }, `${mfmt(unk.value)} (${F.pct(unk.share)}) has no maturity date and is not in the ladder.`) : null) })));
    draws.push({ body: parBody, fn: () => Ch.pareto(parBody, {
      items: rows.map((r) => ({ label: r.name, value: r.exposure_m, key: r.code })), total: M.total, max: 15, format: mfmt,
      threshold: single && isNum(single.limit) ? { value: single.limit, label: 'Illustrative threshold' } : null,
      onClick: (it) => addFilter('asset_code', it.key) }) });
    draws.push({ body: ladBody, fn: () => Ch.ladder(ladBody, {
      items: M.ladder.years.map((y) => ({ label: y.label, value: y.value, year: y.year, sub: `${y.count} asset${y.count === 1 ? '' : 's'}` })), total: M.total, format: mfmt,
      onClick: (it) => addFilter('maturity_year', String(it.year)) }) });

    // ---------- cross-concentration heatmap ----------
    const DS = Scope.engine && Scope.engine.dataset, P = Scope.pivot;
    const ds = DS && P ? DS.build(res) : null;
    const undrawnField = { id: 'cx_undrawn', label: 'Undrawn', kind: 'measure', type: 'number', agg: 'sum', get: (r) => r.exposure - r.exposure_drawn };
    const MEASURES = [
      { id: 'exposure', label: 'Exposure', field: 'exposure' }, { id: 'drawn', label: 'Drawn', field: 'exposure_drawn' }, { id: 'undrawn', label: 'Undrawn', field: undrawnField },
      { id: 'attributed', label: A + ' attributed', field: 'attributed' }, { id: 'third_party', label: 'Third party', field: 'third_party' },
    ];
    const dims = ds ? HEAT_DIMS.filter((id) => ds.fieldById[id]).map((id) => ({ id, label: ds.fieldById[id].label })) : [];
    if (!dims.some((d) => d.id === view.rowDim)) view.rowDim = 'rating';
    if (!dims.some((d) => d.id === view.colDim)) view.colDim = 'maturity_bucket';
    if (!MEASURES.some((m) => m.id === view.measure)) view.measure = 'exposure';
    const heatBody = h('div'), heatNote = h('p', { class: 'cx-hint' });
    // cross-tab of the selected measure over the two dimensions (positions of the assets on this page, excluded ones left out)
    const heatData = () => {
      const codes = new Set(rows.map((r) => r.code));
      const recs = ds.records.filter((r) => r.excluded === 'No' && codes.has(r.asset_code));
      const m = MEASURES.find((x) => x.id === view.measure) || MEASURES[0];
      const out = P.run({ records: recs, fieldById: ds.fieldById, rowDims: [view.rowDim], colDims: [view.colDim], values: [{ field: m.field }], filters: [], subtotals: false, grandTotal: true });
      const unit = ds.unit || 1e6, byLabel = new Map();
      out.rows.filter((r) => r.kind === 'group').forEach((r) => byLabel.set(r.label, r));
      return { rows: Array.from(byLabel.keys()), cols: out.colKeys.map((c) => c.label), cell: (r, c) => { const row = byLabel.get(r); const v = row && row.cells[c] ? row.cells[c][0] : NaN; return isNum(v) ? v / unit : NaN; } };
    };
    const drawHeat = () => {
      if (!ds) { heatBody.innerHTML = '<div class="chart-empty">Dataset engine not loaded</div>'; return; }
      const d = heatData();
      const m = MEASURES.find((x) => x.id === view.measure) || MEASURES[0];
      heatNote.textContent = `${m.label} in ${ccy} m` + (m.id === 'attributed' || m.id === 'third_party' ? ` · ${A} attributed and third party are book amounts across all investors, as on the AUM page` : '') + ' · click a cell to filter on both dimensions, a total to filter on one';
      Ch.heatmap(heatBody, { rows: d.rows, cols: d.cols, cell: d.cell, format: (v) => F.m(v), onClick: (r, c) => addFilters([r !== null ? { field: view.rowDim, value: [r] } : null, c !== null ? { field: view.colDim, value: [c] } : null]) });
    };
    const heatCtl = (labelText, options, key) => h('label', { class: 'cx-ctrl' }, labelText, select(options, view[key], (v) => { view[key] = v; saveView(); drawHeat(); }));
    el.appendChild(UI.section({ title: 'Cross-concentration', subtitle: 'two dimensions at a time, shaded by size',
      actions: ds ? h('div', { class: 'cx-controls' }, heatCtl('Rows', dims, 'rowDim'), heatCtl('Columns', dims, 'colDim'), heatCtl('Measure', MEASURES, 'measure')) : null,
      body: h('div', {}, heatBody, heatNote) }));
    draws.push({ body: heatBody, fn: drawHeat });

    // ---------- sponsors + currency mix ----------
    const spBody = h('div'), cyBody = h('div');
    const spTh = thById.sponsor;
    el.appendChild(h('div', { class: 'charts' },
      UI.section({ title: 'Sponsor concentration', subtitle: `top 10 sponsors · ${ccy} m` + (spTh && isNum(spTh.limit) ? ` · illustrative threshold from config.csv ${F.pct(spTh.limit, 0)}` : '') + ' · click to filter', body: spBody }),
      UI.section({ title: 'Currency mix', subtitle: `position currency · base ${base} · click to filter`, body: cyBody })));
    draws.push({ body: spBody, fn: () => Ch.hbar(spBody, { items: M.sponsors.slice(0, 10).map((s) => ({ label: s.label, value: s.value, sub: `${F.pct(s.share)} of exposure · ${s.count} asset${s.count === 1 ? '' : 's'}` })), format: mfmt, onClick: (it) => addFilter('sponsor', it.label) }) });
    draws.push({ body: cyBody, fn: () => Ch.donut(cyBody, { items: M.currencies.map((c) => ({ label: c.label, value: c.value })), format: mfmt, centre: { value: F.pct(M.nonBaseShare, 0), label: 'non-' + base }, onClick: (it) => addFilter('currency', it.other ? it.other.map((o) => o.label) : it.label) }) });

    // ---------- top exposures ----------
    let cum = 0;
    const ranked = rows.slice().sort((a, b) => expo(b) - expo(a)).map((r, i) => {
      cum += expo(r);
      return { rank: i + 1, code: r.code, name: r.name, sponsor: r.sponsor, sector: r.sector, country: r.country, rating: r.rating_status === 'rated' ? r.rating : 'NR', rating_numeric: r.rating_status === 'rated' ? r.rating_numeric : NaN,
        exposure_m: r.exposure_m, share: M.total ? expo(r) / M.total : NaN, cum: M.total ? cum / M.total : NaN, maturity_date: r.maturity_date, watchlist: r.watchlist || '' };
    });
    const watchBadge = (r) => (!r.watchlist || r.watchlist === 'No' ? h('span', { class: 'muted' }, r.watchlist || '–') : UI.badge(r.watchlist, /intensive/i.test(r.watchlist) ? 'error' : 'warn'));
    el.appendChild(UI.section({ title: 'Top exposures', subtitle: `ranked by exposure · ${ccy} m · click a row to open the asset`, body: UI.table({
      rows: ranked, compact: true, pageSize: 25, filterPlaceholder: 'Filter assets…', onRow: (r) => Scope.navigate('asset', r.code),
      exportName: `scope_concentration_${res.platformId}_${ccy}_${U.isoDate(res.reportingDate)}.csv`, columns: [
        { key: 'rank', label: '#', align: 'right', format: F.int },
        { key: 'name', label: 'Asset', class: 'strong' }, { key: 'sponsor', label: 'Sponsor' }, { key: 'sector', label: 'Sector' }, { key: 'country', label: 'Country' },
        { key: 'rating', label: 'Rating', sortValue: (r) => r.rating_numeric },
        { key: 'exposure_m', label: `Exposure ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
        { key: 'share', label: '% of total', align: 'right', format: (v) => F.pct(v), total: (rs) => F.pct(sumOf(rs, (r) => r.share)) },
        { key: 'cum', label: 'Cumulative %', align: 'right', format: (v) => F.pct(v), title: 'Cumulative share in rank order' },
        { key: 'maturity_date', label: 'Maturity', format: (v) => F.date(v), sortValue: (r) => (r.maturity_date ? r.maturity_date.getTime() : NaN) },
        { key: 'watchlist', label: 'Watchlist', render: watchBadge },
      ] }) }));

    // ---------- draw charts once laid out, and again when the width changes ----------
    const drawAll = () => { for (const d of draws) { try { d.fn(); } catch (e) { console.error(e); d.body.innerHTML = '<div class="chart-empty">Chart unavailable</div>'; } } };
    requestAnimationFrame(drawAll);
    let lastW = el.clientWidth;
    const onResize = U.debounce(() => { if (!el.isConnected || el.clientWidth === lastW) return; lastW = el.clientWidth; drawAll(); }, 150);
    global.addEventListener('resize', onResize);
    return () => { global.removeEventListener('resize', onResize); if (Ch.hideTip) Ch.hideTip(); };
  }

  Scope.registerModule({ id: 'concentration', layer: 2, order: 1, title: 'Concentration & risk', status: 'built', icon: 'target', render });
})(typeof window !== 'undefined' ? window : globalThis);
