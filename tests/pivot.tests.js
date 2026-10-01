/* Scope dataset + pivot tests — run in the browser (tests/index.html) or Node (node tests/run-node.js). Loads after engine.tests.js.
 *
 * Adds cases to Scope.tests (created by engine.tests.js; the fallbacks below let this file load on its own).
 * The theme throughout is reconciliation: whatever the Explorer shows through dataset.js and pivot.js must tie
 * to the AUM engine's own figures (metrics, Output rows, investor columns) on the demo dataset, for every
 * platform, so the pivot can never drift from the AUM page or the Output export.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, AUM = Scope.calc.aum, DS = Scope.engine.dataset, P = Scope.pivot;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const add = T.add;
  // Same minimal assert / close helpers as engine.tests.js (kept local so this file can run alone).
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  // relative tolerance for large amounts (full currency units): summation order changes the last digits
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps) * Math.max(1, Math.abs(b) / 1e6))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };
  /** Demo result for a view (default Total platform) and display currency (default EUR), shared with aum.tests.js. */
  const demo = (platform, currency) => T.demo({ platform: platform || 'Total platform', currency: currency || 'EUR' });
  // The Explorer's default filter (Excluded = No): only included positions count towards AUM.
  const included = [{ field: 'excluded', op: 'eq', value: 'No' }];
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  // ---------- dataset ----------
  add('dataset.build: one record per position, every field resolves, measures numeric, excluded flagged', () => {
    const res = demo(), ds = DS.build(res);
    assert(ds.records.length === res.positions.length, `records ${ds.records.length} vs positions ${res.positions.length}`);
    assert(DS.build(res) === ds, 'memoised on result identity');
    const ids = ['asset_code', 'asset_name', 'code_name', 'tranche', 'holding_id', 'security_name', 'investor_label', 'investor_key', 'investor_group', 'sector', 'subsector', 'country', 'region', 'sponsor', 'greenfield_brownfield', 'repayment_type', 'cash_flow_type', 'instrument', 'origination', 'deal_year', 'deal_lead', 'watchlist', 'covenant_type', 'currency', 'fixed_floating', 'rating', 'ig_label', 'rating_status', 'internal_grade', 'external_grade', 'fitch', 'moodys', 'sp', 'maturity_bucket', 'maturity_year', 'funding_year', 'maturity_date', 'funding_date', 'green_loan', 'cbi_taxonomy', 'sfdr_article', 'data_coverage', 'as_of_date', 'excluded', 'exclusion_reason', 'flags', 'platform_member',
      'nominal', 'drawn', 'undrawn', 'commitment', 'exposure', 'exposure_drawn', 'attributed', 'third_party', 'nominal_ccy', 'drawn_ccy', 'positions', 'assets', 'investors', 'margin_bps', 'coupon', 'wal_years', 'initial_tenor', 'remaining_years', 'rating_numeric', 'esg_score', 'ghg_scope12_t', 'ghg_scope3_t', 'total_transaction_size', 'upfront_fee_bps', 'fx_rate'];
    for (const id of ids) { const f = ds.fieldById[id]; assert(f, `field ${id} missing`); assert(f.kind === 'dimension' || f.kind === 'measure', `${id} kind`); assert(typeof f.get === 'function' && typeof f.format === 'function', `${id} get/format`); assert(['Asset', 'Position', 'Investor', 'Credit', 'Terms', 'ESG', 'Amounts', 'Derived'].includes(f.group), `${id} group ${f.group}`); }
    for (const f of ds.fields) assert(ds.fieldById[f.id] === f, 'fieldById map');
    for (const r of ds.records) {
      for (const f of ds.fields) { const v = f.get(r); if (f.kind === 'dimension') assert(typeof v === 'string', `${f.id} should be a string, got ${typeof v}`); else assert(typeof v === 'number', `${f.id} should be a number`); }
      assert(r._pos && (r._asset === null || typeof r._asset === 'object'), '_pos/_asset');
      close(r.attributed + r.third_party, r.nominal, 1e-6, 'attributed + third party = nominal');
      assert(r.excluded === (r._pos.excluded ? 'Yes' : 'No'), 'excluded flag');
      if (r.excluded === 'Yes') assert(r.exclusion_reason, 'excluded records name a reason');
      assert(/^\d{4}-\d{2}-\d{2}$|^$/.test(r.maturity_date), 'iso date');
    }
    assert(ds.records.filter((r) => r.excluded === 'Yes').length === res.stats.excluded, 'excluded count');
    assert(ds.fieldById.exposure.unit === res.config.unit && /m$/.test(ds.fieldById.exposure.unitLabel), 'amount unit');
    assert(ds.fieldById.attributed.label === 'Group attributed' && ds.fieldById.exposure.format(1234567) === '1.2', 'labels and millions format');
  });

  add('dataset.build: platform weights drive exposure; TOTAL = nominal, look-through platform scales, non-members read No', () => {
    const t = DS.build(demo('Total platform'));
    for (const r of t.records) { close(r.exposure, r.nominal, 1e-9, 'TOTAL exposure = nominal'); assert(r.platform_member === 'Yes', 'everyone is a TOTAL member'); }
    const lt = demo('Fund I look-through (35%)'), d = DS.build(lt);
    const comp = lt.platform.composition;
    for (const r of d.records) {
      const w = comp.filter((c) => c.label === '*' || c.label === r.investor_label).reduce((s, c) => s + c.weight, 0);
      close(r.exposure, r.nominal * w, 1e-9, r.investor_label); assert(r.platform_member === (w > 0 ? 'Yes' : 'No'), 'membership');
    }
    assert(d.records.some((r) => r.platform_member === 'No') && d.records.some((r) => r.platform_member === 'Yes' && r.exposure > 0 && Math.abs(r.exposure - r.nominal) > 1), 'look-through weight < 1 applied');
  });

  add('dataset.build: attribution uses the engine group_weight; a missing weight attributes nothing', () => {
    const res = demo();
    const p0 = res.positions.find((p) => !p.excluded && p.nominal_base > 0);
    // Engine result with a single patched copy of one position, to test the attribution rule in isolation.
    const clone = (patch) => { const p = Object.assign({}, p0, patch); return Object.assign({}, res, { positions: [p] }); };
    const a = DS.build(clone({ group_weight: 0.5 })).records[0];
    close(a.attributed, 0.5 * a.nominal, 1e-9, 'group_weight used'); close(a.third_party, 0.5 * a.nominal, 1e-9, 'third party is the remainder');
    const c = DS.build(clone({ group_weight: undefined })).records[0];
    close(c.attributed, 0, 1e-9, 'no weight → 0 attributed');
    for (const r of DS.build(res).records) { const inv = res.investors.find((i) => i.label === r.investor_label); if (inv) close(r.attributed, r.nominal * inv.group_weight, 1e-6, r.investor_label); }
  });

  // ---------- pivot reconciliation with the AUM engine ----------
  add('pivot.run: exposure by asset_code reconciles with metrics.total_exposure_m for TOTAL, ALPHA, BETA, FUND1LT', () => {
    for (const pid of ['Total platform', 'Platform Alpha', 'Platform Beta', 'Fund I look-through (35%)']) {
      const res = demo(pid), ds = DS.build(res);
      const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['asset_code'], colDims: [], values: [{ field: 'exposure' }], filters: included });
      close(r.grandTotal[0] / res.config.unit, res.metrics.total_exposure_m, 1e-6, pid + ' grand total');
      const active = r.rows.filter((x) => x.kind === 'group' && x.rowTotal[0] > 0);
      assert(active.length === res.rows.length, `${pid}: ${active.length} assets with exposure vs ${res.rows.length} Output rows`);
      for (const row of active) { const out = res.rows.find((o) => o.code === row.label); assert(out, row.label); close(row.rowTotal[0] / res.config.unit, out.exposure_m, 1e-6, pid + ' ' + row.label); }
      assert(r.rows[r.rows.length - 1].kind === 'total', 'grand total last');
      assert(r.filteredCount === res.stats.included && r.recordCount === res.positions.length, 'counts');
    }
  });

  add('pivot.run: attributed + third party reconcile with the book split; nominal ties to book_total_m', () => {
    const res = demo(), ds = DS.build(res), u = res.config.unit;
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['investor_group'], colDims: [], values: [{ field: 'attributed' }, { field: 'third_party' }, { field: 'nominal' }], filters: included });
    close(r.grandTotal[0] / u, res.metrics.book_group_m, 1e-6, 'attributed'); close(r.grandTotal[1] / u, res.metrics.book_third_party_m, 1e-6, 'third party'); close(r.grandTotal[2] / u, res.metrics.book_total_m, 1e-6, 'book');
    for (const row of r.rows) close(row.rowTotal[0] + row.rowTotal[1], row.rowTotal[2], 1e-6, row.label + ' split');
    assert(r.rows.filter((x) => x.kind === 'group').length >= 3, 'three investor groups');
  });

  add('pivot.run: wavg margin per sector (asset grain) equals AUM.summarise on the same Output rows', () => {
    const res = demo(), ds = DS.buildAssets(res);
    assert(ds.records.length === res.rows.length && DS.assetRecords(res) === ds.records, 'asset grain count / alias');
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'margin_bps' }, { field: 'exposure' }, { field: 'rating_numeric' }, { field: 'wal_years' }] });
    assert(r.values[0].agg === 'wavg' && r.values[2].agg === 'wavg', 'defaults to wavg');
    for (const row of r.rows) {
      const rows = row.kind === 'total' ? res.rows : res.rows.filter((o) => (o.sector || '(blank)') === row.label);
      const m = AUM.summarise(rows, res.ratingScale, res.config).metrics;
      close(row.rowTotal[0], m.w_margin_bps, 1e-6, row.label + ' margin'); close(row.rowTotal[1] / res.config.unit, m.total_exposure_m, 1e-6, row.label + ' exposure');
      close(row.rowTotal[2], m.w_rating_numeric, 1e-6, row.label + ' rating'); close(row.rowTotal[3], m.w_wal_years, 1e-6, row.label + ' wal');
    }
    // wavg subtotal is a recomputation from records, not an average of children
    const rr = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector', 'country'], colDims: [], values: [{ field: 'margin_bps' }] });
    const sub = rr.rows.find((x) => x.kind === 'subtotal'); const kids = rr.rows.filter((x) => x.kind === 'group' && x.level === 1 && x.path[0] === sub.path[0]);
    if (kids.length > 1) { const mean = sum(kids, (k) => k.rowTotal[0]) / kids.length; const recs = ds.records.filter((x) => (x.sector || '(blank)') === sub.path[0]); close(sub.rowTotal[0], sum(recs, (x) => x.margin_bps * x.exposure) / sum(recs, (x) => x.exposure), 1e-6, 'subtotal = wavg of records'); assert(Math.abs(mean - sub.rowTotal[0]) > 1e-9 || kids.every((k) => Math.abs(k.rowTotal[0] - mean) < 1e-9), 'not the mean of children'); }
  });

  add('pivot.run: perAsset measures count once per asset across positions; ties to metrics.ghg_scope12_t', () => {
    const res = demo(), ds = DS.build(res);
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: ['investor_group'], values: [{ field: 'ghg_scope12_t' }, { field: 'total_transaction_size' }], filters: included });
    close(r.grandTotal[0], res.metrics.ghg_scope12_t, 1e-6, 'GHG grand total');
    const naive = sum(ds.records.filter((x) => x.excluded === 'No'), (x) => x.ghg_scope12_t);
    assert(naive > r.grandTotal[0] * 1.5, `naive position sum ${naive} should exceed the per-asset total ${r.grandTotal[0]}`);
    for (const row of r.rows.filter((x) => x.kind === 'group')) {
      const assets = new Map(); for (const x of ds.records) if (x.excluded === 'No' && (x.sector || '(blank)') === row.label) assets.set(x.asset_code, x.ghg_scope12_t);
      close(row.rowTotal[0], sum(Array.from(assets.values()), (v) => v), 1e-6, row.label);
      // an asset held by several investor groups appears in each column but once in the row total
      const colSum = sum(r.colKeys, (c) => (row.cells[c.key] ? row.cells[c.key][0] : 0));
      assert(colSum >= row.rowTotal[0] - 1e-6, 'columns are not summed into the row total');
    }
    assert(sum(r.colKeys, (c) => r.colTotals[c.key][0]) > r.grandTotal[0], 'assets shared across investor groups: Σ columns > grand total');
  });

  add('pivot.run: countDistinct assets/investors is never summed across groups', () => {
    const res = demo(), ds = DS.build(res);
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'investors' }, { field: 'assets' }, { field: 'positions' }], filters: included });
    const inc = ds.records.filter((x) => x.excluded === 'No');
    assert(r.grandTotal[0] === new Set(inc.map((x) => x.investor_label)).size, 'distinct investors');
    assert(r.grandTotal[1] === new Set(inc.map((x) => x.asset_code)).size, 'distinct assets');
    assert(r.grandTotal[2] === inc.length, 'positions');
    const groups = r.rows.filter((x) => x.kind === 'group');
    assert(sum(groups, (g) => g.rowTotal[0]) > r.grandTotal[0], 'Σ sector investors > distinct investors (investors span sectors)');
    assert(sum(groups, (g) => g.rowTotal[1]) === r.grandTotal[1], 'each asset is in exactly one sector');
    for (const g of groups) assert(g.rowTotal[0] === new Set(inc.filter((x) => (x.sector || '(blank)') === g.label).map((x) => x.investor_label)).size, g.label);
  });

  // ---------- pivot mechanics: show-as, top-N, layout, filters, sorting ----------
  add('pivot.run: show-as % of total / row / column sum to 100 % within their base', () => {
    const res = demo(), ds = DS.build(res);
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: ['ig_label'], values: [{ field: 'exposure', showAs: 'pctOfTotal' }, { field: 'exposure', showAs: 'pctOfRow' }, { field: 'exposure', showAs: 'pctOfCol' }, { field: 'exposure' }], filters: included });
    const groups = r.rows.filter((x) => x.kind === 'group');
    close(sum(groups, (g) => g.rowTotal[0]), 1, 1e-9, '% of total over rows'); close(r.grandTotal[0], 1, 1e-9, 'grand % of total');
    let cellSum = 0; for (const g of groups) for (const c of r.colKeys) if (g.cells[c.key]) cellSum += g.cells[c.key][0]; close(cellSum, 1, 1e-9, '% of total over cells');
    for (const g of groups) { close(sum(r.colKeys, (c) => (g.cells[c.key] ? g.cells[c.key][1] : 0)), 1, 1e-9, g.label + ' % of row'); close(g.rowTotal[1], 1, 1e-9, 'row total of % of row'); }
    for (const c of r.colKeys) { close(sum(groups, (g) => (g.cells[c.key] ? g.cells[c.key][2] : 0)), 1, 1e-9, c.label + ' % of column'); close(r.colTotals[c.key][2], 1, 1e-9, 'column total of % of column'); }
    assert(r.values[0].format(0.25) === '25.0%' && /% of total/.test(r.values[0].label), 'pct format/label');
    assert(r.values[3].format(2500000) === '2.5', 'plain value keeps the field format');
  });

  add('pivot.run: top-N folds the remainder into "Other (k)", last, and parent totals reconcile', () => {
    const res = demo(), ds = DS.build(res);
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector', 'country'], colDims: [], values: [{ field: 'exposure' }, { field: 'positions' }], filters: included, topN: { n: 2, valueIndex: 0 }, sort: { by: 'value', valueIndex: 0, dir: 'desc' } });
    const full = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector', 'country'], colDims: [], values: [{ field: 'exposure' }, { field: 'positions' }], filters: included });
    let sawOther = false;
    for (const sub of r.rows.filter((x) => x.kind === 'subtotal')) {
      const kids = r.rows.filter((x) => x.kind === 'group' && x.level === 1 && x.path[0] === sub.path[0]);
      assert(kids.length <= 3, sub.path[0] + ' at most n + Other');
      close(sum(kids, (k) => k.rowTotal[0]), sub.rowTotal[0], 1e-6, sub.path[0] + ' children = subtotal'); assert(sum(kids, (k) => k.rowTotal[1]) === sub.rowTotal[1], 'positions reconcile');
      const other = kids.filter((k) => k.other);
      if (other.length) { sawOther = true; assert(kids[kids.length - 1].other && /^Other \(\d+\)$/.test(other[0].label), 'Other last and labelled'); assert(other[0].folded === other[0].foldedLabels.length && other[0].folded + 2 === full.rows.filter((x) => x.kind === 'group' && x.level === 1 && x.path[0] === sub.path[0]).length, 'k = folded count'); assert(kids[0].rowTotal[0] >= kids[1].rowTotal[0], 'kept rows sorted by value desc'); }
      const fullSub = full.rows.find((x) => x.kind === 'subtotal' && x.key === sub.key); close(sub.rowTotal[0], fullSub.rowTotal[0], 1e-6, 'subtotal unchanged by top-N');
    }
    assert(sawOther, 'at least one sector had more than 2 countries');
    close(r.grandTotal[0], full.grandTotal[0], 1e-6, 'grand total unchanged');
    // top-N with a perAsset + countDistinct measure merges without double counting
    const m = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['country'], colDims: [], values: [{ field: 'ghg_scope12_t' }, { field: 'assets' }, { field: 'investors' }], filters: included, topN: { n: 1, valueIndex: 0 } });
    const o = m.rows.find((x) => x.other), rest = ds.records.filter((x) => x.excluded === 'No' && o.foldedLabels.includes(x.country || '(blank)'));
    const perAsset = new Map(); for (const x of rest) perAsset.set(x.asset_code, x.ghg_scope12_t);
    close(o.rowTotal[0], sum(Array.from(perAsset.values()), (v) => v), 1e-6, 'Other GHG per asset'); assert(o.rowTotal[1] === perAsset.size && o.rowTotal[2] === new Set(rest.map((x) => x.investor_label)).size, 'Other distinct counts');
  });

  add('pivot.run: depth-first order with subtotals; subtotal = Σ children for sums; grand total last; column subtotals', () => {
    const res = demo(), ds = DS.build(res);
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['region', 'country', 'asset_code'], colDims: ['fixed_floating', 'ig_label'], values: [{ field: 'exposure' }, { field: 'drawn' }], filters: included });
    let i = 0;
    for (const row of r.rows) { assert(['group', 'subtotal', 'total'].includes(row.kind), 'kind'); assert(row.key === (row.kind === 'subtotal' ? row.path.join('|') + '|__subtotal' : row.kind === 'total' ? '' : row.path.join('|')), 'key = path'); assert(row.level === (row.kind === 'total' ? -1 : row.path.length - 1), 'level'); i++; }
    for (let k = 0; k < r.rows.length; k++) {
      const row = r.rows[k];
      if (row.kind !== 'group' || row.level === 2) continue;
      // the subtotal for this group comes after all its descendants and sums its direct children
      let j = k + 1; const kids = [];
      while (j < r.rows.length && r.rows[j].kind !== 'total' && r.rows[j].path.slice(0, row.level + 1).join('|') === row.key && !(r.rows[j].kind === 'subtotal' && r.rows[j].level === row.level)) { if (r.rows[j].kind === 'group' && r.rows[j].level === row.level + 1) kids.push(r.rows[j]); j++; }
      const sub = r.rows[j]; assert(sub && sub.kind === 'subtotal' && sub.key === row.key + '|__subtotal', 'subtotal follows descendants of ' + row.key);
      close(sum(kids, (x) => x.rowTotal[0]), sub.rowTotal[0], 1e-6, row.key + ' Σ children'); close(sub.rowTotal[0], row.rowTotal[0], 1e-6, 'group row carries its own total');
      for (const c of r.colKeys) close(sum(kids, (x) => (x.cells[c.key] ? x.cells[c.key][0] : 0)), sub.cells[c.key] ? sub.cells[c.key][0] : 0, 1e-6, row.key + ' ' + c.key);
      assert(sub.count === sum(kids, (x) => x.count), 'count');
    }
    assert(r.rows[r.rows.length - 1].kind === 'total' && r.rows[r.rows.length - 1].label === 'Grand total', 'grand total last');
    const leafCols = r.colKeys.filter((c) => c.kind !== 'subtotal'), subCols = r.colKeys.filter((c) => c.kind === 'subtotal');
    assert(subCols.length === 2 && leafCols.every((c) => c.path.length === 2), 'Fixed/Floating column subtotals');
    for (const sc of subCols) close(sum(leafCols.filter((c) => c.path[0] === sc.path[0]), (c) => r.colTotals[c.key][0]), r.colTotals[sc.key][0], 1e-6, sc.label);
    close(sum(leafCols, (c) => r.colTotals[c.key][0]), r.grandTotal[0], 1e-6, 'Σ leaf column totals = grand');
    close(sum(leafCols, (c) => r.colTotals[c.key][0]), sum(r.rows.filter((x) => x.kind === 'group' && x.level === 0), (x) => x.rowTotal[0]), 1e-3, 'rows and columns agree');
    const off = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['region', 'country'], colDims: ['fixed_floating', 'ig_label'], values: [{ field: 'exposure' }], filters: included, subtotals: false, grandTotal: false });
    assert(off.rows.every((x) => x.kind === 'group') && off.colKeys.every((c) => c.kind !== 'subtotal'), 'subtotals and grand total off');
    const none = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: [], colDims: [], values: [{ field: 'exposure' }], filters: included });
    assert(none.rows.length === 1 && none.rows[0].kind === 'total' && none.colKeys.length === 0, 'no dims → grand total only');
    close(none.grandTotal[0] / res.config.unit, res.metrics.total_exposure_m, 1e-6, 'no-dim total');
  });

  add('pivot.applyFilters: every operator, blanks, AND across fields, OR within; distinctValues counts', () => {
    const res = demo(), ds = DS.build(res), R = ds.records, F = ds.fieldById;
    const f = (filters) => P.applyFilters(R, F, filters);
    assert(f([]) === R, 'no filters returns the same array');
    const sectors = P.distinctValues(R, F.sector);
    assert(sum(sectors, (d) => d.count) === R.length && sectors.every((d, i) => i === 0 || sectors[i - 1].count >= d.count), 'distinct counts sum and sort desc');
    const top2 = sectors.slice(0, 2).map((d) => d.value);
    assert(f([{ field: 'sector', op: 'in', value: top2 }]).length === sectors[0].count + sectors[1].count, 'in = OR within a field');
    assert(f([{ field: 'sector', op: 'notIn', value: top2 }]).length === R.length - sectors[0].count - sectors[1].count, 'notIn');
    assert(f([{ field: 'sector', op: 'in', value: top2 }, { field: 'excluded', op: 'eq', value: 'No' }]).length === R.filter((x) => top2.includes(x.sector) && x.excluded === 'No').length, 'AND across fields');
    assert(f([{ field: 'asset_code', op: 'in', value: ['(blank)'] }]).length === R.filter((x) => x.asset_code === '').length && R.some((x) => x.asset_code === ''), '(blank) is a first-class value');
    assert(f([{ field: 'asset_code', op: 'blank' }]).length === R.filter((x) => !x.asset_code).length && f([{ field: 'asset_code', op: 'nonblank' }]).length === R.filter((x) => x.asset_code).length, 'blank / nonblank');
    assert(f([{ field: 'nominal', op: 'between', value: [1e7, 2e7] }]).length === R.filter((x) => x.nominal >= 1e7 && x.nominal <= 2e7).length, 'between numeric inclusive');
    assert(f([{ field: 'nominal', op: 'gte', value: 2e7 }]).length === R.filter((x) => x.nominal >= 2e7).length && f([{ field: 'nominal', op: 'lte', value: 2e7 }]).length === R.filter((x) => x.nominal <= 2e7).length, 'gte/lte');
    assert(f([{ field: 'nominal', op: 'gt', value: 2e7 }]).length + f([{ field: 'nominal', op: 'lte', value: 2e7 }]).length === R.length, 'gt + lte partition');
    assert(f([{ field: 'positions', op: 'eq', value: 1 }]).length === R.length && f([{ field: 'positions', op: 'neq', value: 1 }]).length === 0, 'eq/neq numeric');
    assert(f([{ field: 'margin_bps', op: 'gte', value: 0 }]).length === R.filter((x) => U.isNum(x.margin_bps)).length, 'NaN never satisfies a numeric comparison');
    assert(f([{ field: 'maturity_date', op: 'between', value: ['2030-01-01', '2034-12-31'] }]).length === R.filter((x) => x.maturity_date >= '2030-01-01' && x.maturity_date <= '2034-12-31').length, 'date range');
    assert(f([{ field: 'maturity_date', op: 'gte', value: '2035-01-01' }]).every((x) => x.maturity_date >= '2035-01-01') && f([{ field: 'maturity_date', op: 'between', value: ['2030-01-01', null] }]).length === R.filter((x) => x.maturity_date >= '2030-01-01').length, 'open date range');
    const word = R[0].asset_name.slice(0, 3).toUpperCase();
    assert(f([{ field: 'asset_name', op: 'contains', value: word }]).length === R.filter((x) => x.asset_name.toUpperCase().includes(word)).length && f([{ field: 'asset_name', op: 'contains', value: word }]).length > 0, 'contains case-insensitive');
    assert(f([{ field: 'currency', op: 'eq', value: 'EUR' }]).length + f([{ field: 'currency', op: 'neq', value: 'EUR' }]).length === R.length, 'eq/neq strings partition');
    assert(f([{ field: 'nonexistent', op: 'in', value: ['x'] }]).length === R.length, 'unknown field ignored');
    const dv = P.distinctValues(R, 'investor_label', 'exposure'); close(sum(dv, (d) => d.sum), sum(R, (x) => x.exposure), 1e-3, 'distinct with measure sums');
    const pe = P.parseNumberExpr; assert(pe('>100').op === 'gt' && pe('<=5').value === 5 && pe('100..200').op === 'between' && pe('=0').op === 'eq' && pe('blank').op === 'blank' && pe('nonblank').op === 'nonblank' && pe('<>3').op === 'neq' && pe('abc') === null, 'number expressions');
  });

  add('pivot.run: label sort honours ordinal scales (ratings, maturity buckets); blanks last both ways; value sort NaN last', () => {
    const res = demo(), ds = DS.build(res);
    const scale = res.ratingScale.map((x) => x.grade);
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['rating'], colDims: [], values: [{ field: 'exposure' }], filters: included });
    const labels = r.rows.filter((x) => x.kind === 'group').map((x) => x.label);
    const ranks = labels.map((l) => (l === 'NR' ? 1e9 : ds.fieldById.rating.sortRank(l)));
    for (let i = 1; i < ranks.length; i++) assert(ranks[i - 1] <= ranks[i], `ratings ordered by scale numeric: ${labels.join(' < ')}`);
    assert(labels.length > 3 && labels.every((l) => l === 'NR' || scale.includes(l) || ds.fieldById.rating.sortRank(l) < 1e9), 'demo ratings resolve on the scale');
    const desc = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['rating'], colDims: [], values: [{ field: 'exposure' }], filters: included, sort: { by: 'label', dir: 'desc' } }).rows.filter((x) => x.kind === 'group').map((x) => x.label);
    assert(desc.join() === labels.slice().reverse().join(), 'desc reverses');
    const mb = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['maturity_bucket'], colDims: [], values: [{ field: 'exposure' }] }).rows.filter((x) => x.kind === 'group').map((x) => x.label);
    const order = res.config.buckets.map((b) => b + ' y').concat(['Matured', 'Unknown']);
    assert(mb.every((l, i) => i === 0 || order.indexOf(mb[i - 1]) <= order.indexOf(l)), 'maturity buckets in config order: ' + mb.join(', '));
    const blankAsc = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'exposure' }] }).rows.filter((x) => x.kind === 'group').map((x) => x.label);
    const blankDesc = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'exposure' }], sort: { by: 'label', dir: 'desc' } }).rows.filter((x) => x.kind === 'group').map((x) => x.label);
    assert(blankAsc.includes('(blank)') && blankAsc[blankAsc.length - 1] === '(blank)' && blankDesc[blankDesc.length - 1] === '(blank)', '(blank) last in both directions');
    assert(blankAsc.slice(0, -1).join() === blankDesc.slice(0, -1).reverse().join(), 'non-blank order reversed');
    const cmp = P.labelComparator(ds.fieldById.deal_year, 'asc'); assert(cmp('2019', '2024') < 0 && cmp('2024', '(blank)') < 0 && cmp('', '2019') > 0, 'numeric years');
    const byVal = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'margin_bps' }, { field: 'exposure' }], sort: { by: 'value', valueIndex: 0, dir: 'desc' } }).rows.filter((x) => x.kind === 'group').map((x) => x.rowTotal[0]);
    const nums = byVal.filter(U.isNum); for (let i = 1; i < nums.length; i++) assert(nums[i - 1] >= nums[i], 'value desc');
    assert(byVal.slice(nums.length).every((v) => !U.isNum(v)), 'NaN rows last');
    const byValAsc = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'margin_bps' }], sort: { by: 'value', valueIndex: 0, dir: 'asc' } }).rows.filter((x) => x.kind === 'group').map((x) => x.rowTotal[0]);
    assert(byValAsc.slice(0, nums.length).join() === nums.slice().reverse().join() && byValAsc.slice(nums.length).every((v) => !U.isNum(v)), 'asc: NaN still last');
    const vc = P.valueComparator('asc'); assert([3, NaN, 1, undefined, 2].sort(vc).slice(0, 3).join() === '1,2,3', 'value comparator');
  });

  add('pivot: investor_label sorts in workbook column order; investor_group by attribution weight; unknown dims dropped, not thrown', () => {
    const res = demo(), ds = DS.build(res);
    const inv = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['investor_label'], colDims: [], values: [{ field: 'nominal' }], filters: included }).rows.filter((x) => x.kind === 'group').map((x) => x.label);
    const order = res.investors.map((i) => i.label).filter((l) => inv.includes(l));
    assert(inv.slice(0, order.length).join() === order.join(), 'investor order: ' + inv.join(', '));
    const groups = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['investor_group'], colDims: [], values: [{ field: 'attributed' }, { field: 'nominal' }], filters: included }).rows.filter((x) => x.kind === 'group');
    const share = groups.map((g) => g.rowTotal[0] / g.rowTotal[1]); for (let i = 1; i < share.length; i++) assert(share[i - 1] >= share[i] - 1e-9, 'groups ordered from fully attributed to third party');
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector', 'nope'], colDims: ['also_nope'], values: [{ field: 'exposure' }, { field: 'ghost' }], filters: [{ field: 'phantom', op: 'in', value: ['x'] }] });
    assert(r.dropped.join() === 'nope,also_nope,ghost,phantom' && r.rowDims.length === 1 && r.values.length === 1 && r.rows.length > 1, 'dropped and still rendered');
    const m = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], filters: included, values: [{ field: 'sector' }, { field: 'country', agg: 'countDistinct' }, { field: 'exposure', agg: 'wavg' }, { field: 'exposure', agg: 'max' }, { field: 'exposure', agg: 'min' }, { field: 'fx_rate' }] });
    assert(m.values[0].agg === 'count' && m.values[1].agg === 'countDistinct' && m.values[5].agg === 'avg', 'dimension defaults to count; explicit aggs respected');
    for (const g of m.rows.filter((x) => x.kind === 'group')) { assert(g.rowTotal[0] === (g.label === '(blank)' ? 0 : g.count), 'count = non-blank records'); assert(g.rowTotal[3] >= g.rowTotal[4] && g.rowTotal[4] >= 0, 'min ≤ max'); assert(U.isNum(g.rowTotal[5]), 'avg fx'); }
  });

  add('pivot.aggregate and toRecords: flat aggregates match run(); export headers unique, one column per colKey x value', () => {
    const res = demo(), ds = DS.build(res), inc = P.applyFilters(ds.records, ds.fieldById, included);
    close(P.aggregate(inc, ds.fieldById.exposure, 'sum') / res.config.unit, res.metrics.total_exposure_m, 1e-6, 'sum');
    close(P.aggregate(inc, ds.fieldById.ghg_scope12_t), res.metrics.ghg_scope12_t, 1e-6, 'perAsset default agg');
    assert(P.aggregate(inc, ds.fieldById.assets) === new Set(inc.map((x) => x.asset_code)).size && P.aggregate(inc, 'positions', 'sum', ds.fieldById) === inc.length, 'countDistinct / sum by id');
    close(P.aggregate(inc, ds.fieldById.margin_bps), sum(inc.filter((x) => U.isNum(x.margin_bps)), (x) => x.margin_bps * x.exposure) / sum(inc.filter((x) => U.isNum(x.margin_bps)), (x) => x.exposure), 1e-6, 'wavg');
    const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector', 'country'], colDims: ['ig_label'], values: [{ field: 'exposure' }, { field: 'exposure', showAs: 'pctOfRow' }], filters: included });
    const recs = P.toRecords(r);
    assert(recs.length === r.rows.length, 'one record per row');
    const H = recs.headers; assert(new Set(H).size === H.length, 'unique headers'); assert(H[0] === 'kind' && H[1] === 'Sector' && H[2] === 'Country', 'dimension columns');
    assert(H.length === 3 + 2 * (r.colKeys.length + 1), 'one column per colKey x value plus totals');
    const csv = Scope.csv.serialize(recs, H); assert(csv.split('\n')[0].split(',').length === H.length && csv.split('\n').length === recs.length + 2, 'serialises');
    const total = recs[recs.length - 1]; assert(total.kind === 'total' && total.Sector === 'Grand total', 'total row flagged');
    const sub = recs.find((x) => x.kind === 'subtotal'); assert(/ total$/.test(sub.Sector) && sub.Country === '', 'subtotal row carries its label in its own level column');
  });

  add('dataset: derived bands are dimensions with monotone ordering; asset grain fields and investor columns', () => {
    const res = demo(), ds = DS.build(res);
    for (const id of ['remaining_years_band', 'wal_band', 'spread_band', 'size_band']) {
      const f = ds.fieldById[id]; assert(f && f.kind === 'dimension' && typeof f.sortRank === 'function', id);
      const r = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: [id], colDims: [], values: [{ field: 'positions' }] }).rows.filter((x) => x.kind === 'group').map((x) => x.label);
      assert(r.length > 1, id + ' has several bands');
      for (let i = 1; i < r.length; i++) assert(f.sortRank(r[i - 1]) <= f.sortRank(r[i]), id + ' order ' + r.join(', '));
    }
    assert(DS.band(4.2, ['0-3', '3-5', '5+'], ' y') === '3-5 y' && DS.band(9, ['0-3', '3-5', '5+']) === '5+' && DS.band(NaN, ['0-3']) === '', 'band()');
    const A = DS.buildAssets(res), u = res.config.unit;
    close(sum(A.records, (x) => x.exposure) / u, res.metrics.total_exposure_m, 1e-6, 'asset exposure'); close(sum(A.records, (x) => x.nominal) / u, res.metrics.book_total_m, 1e-6, 'asset nominal');
    close(sum(A.records, (x) => x.attributed) / u, res.metrics.book_group_m, 1e-6, 'asset attributed'); for (const x of A.records) close(x.attributed + x.third_party, x.nominal, 1e-6, x.asset_code + ' split');
    assert(sum(A.records, (x) => x.positions) === res.metrics.n_positions && A.records.every((x) => x.assets === 1), 'positions per asset');
    for (const label of res.investorColumns) { assert(A.fieldById['investor_nominal:' + label] && A.fieldById['investor_drawn:' + label], 'investor columns'); close(sum(A.records, (x) => x['investor_nominal:' + label]) / u, res.investors.find((i) => i.label === label).selected_nominal_m, 1e-6, label); }
    assert(!A.fieldById.investor_label && A.fieldById.group_invested && A.fieldById.rank, 'asset grain has no investor dimension');
    const ar = P.run({ records: A.records, fieldById: A.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'exposure' }] });
    const pr = P.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'exposure' }], filters: included });
    for (const g of ar.rows) close(g.rowTotal[0], pr.rows.find((x) => x.key === g.key).rowTotal[0], 1e-3, 'asset and position grains agree on ' + g.label);
  });

  // ---------- performance ----------
  // 50k records cloned from the demo with synthetic keys (800 assets, 23 countries, 9 sectors, 12 investors).
  add('performance: 50k synthetic records, 2 row dims x 1 col dim x 3 values under 1 s', () => {
    const res = demo(), ds = DS.build(res);
    const base = ds.records.filter((x) => x.excluded === 'No');
    const N = 50000, recs = new Array(N);
    // Deterministic LCG so the synthetic amounts are identical on every run.
    let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < N; i++) {
      const src = base[i % base.length];
      recs[i] = Object.assign({}, src, { asset_code: 'A' + (i % 800), country: 'C' + (i % 23), sector: 'S' + (i % 9), investor_label: 'Investor ' + (1 + (i % 12)), nominal: Math.round(rnd() * 5e7), margin_bps: rnd() < 0.05 ? NaN : Math.round(100 + rnd() * 300), ghg_scope12_t: (i % 800) * 10 });
      recs[i].exposure = recs[i].nominal;
    }
    const t0 = Date.now();
    const r = P.run({ records: recs, fieldById: ds.fieldById, rowDims: ['sector', 'country'], colDims: ['investor_label'], values: [{ field: 'exposure' }, { field: 'margin_bps' }, { field: 'positions' }], filters: [{ field: 'excluded', op: 'eq', value: 'No' }] });
    const ms = Date.now() - t0;
    assert(ms < 1000, `took ${ms} ms`);
    assert(r.filteredCount === N && r.colKeys.length === 12 && r.rows.filter((x) => x.kind === 'group' && x.level === 1).length === 9 * 23, 'shape');
    close(r.grandTotal[0], sum(recs, (x) => x.exposure), 1e-3, '50k sum'); assert(r.grandTotal[2] === N, '50k count');
    const t1 = Date.now(); P.applyFilters(recs, ds.fieldById, [{ field: 'country', op: 'in', value: ['C1', 'C2'] }, { field: 'nominal', op: 'gte', value: 1e7 }]); assert(Date.now() - t1 < 200, 'filter 50k fast');
    const t2 = Date.now(); const pa = P.run({ records: recs, fieldById: ds.fieldById, rowDims: ['sector'], colDims: [], values: [{ field: 'ghg_scope12_t' }, { field: 'assets' }] }); assert(Date.now() - t2 < 1000, 'perAsset + distinct 50k');
    assert(pa.grandTotal[1] === 800, '800 distinct assets'); close(pa.grandTotal[0], sum(Array.from({ length: 800 }, (_, k) => k * 10), (v) => v), 1e-6, 'perAsset sum over 50k');
    T.perfMs = ms;
  });
})(typeof window !== 'undefined' ? window : globalThis);
