/* Scope AUM calculation tests (js/calc/aum.js). Run in the browser (tests/index.html) or Node (node tests/run-node.js).
 *
 * Creates Scope.tests = { cases, add, run, demoSheets, demo(opts) } and registers the calculation cases; the other suites
 * (pivot, look-through, concentration) load next and add theirs to the same list. The fixture is the synthetic demo
 * workbook (window.SCOPE_DEMO from data/demo.js): the four input sheets as cell grids, exactly as a user would load them.
 * The key checks recompute figures straight from the raw Holdings grid, independently of the calculation file.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, AUM = Scope.calc.aum;
  const T = (Scope.tests = Scope.tests || { cases: [] });
  T.cases = T.cases || [];
  T.add = (name, fn) => T.cases.push({ name, fn });
  const add = T.add;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /** The demo sheets (deep copy, so a test can modify them freely). */
  T.demoSheets = () => clone((global.SCOPE_DEMO || {}).sheets || {});
  const cache = {};
  /** Demo result for { platform (view), currency, … }; plain runs are cached so the suites share a few calculations. */
  T.demo = function (opts) {
    const o = Object.assign({ platform: 'Total platform', currency: 'EUR' }, opts || {});
    const simple = !o.sheets && !o.adjustments && !o.overrides && !o.includeLines;
    const k = o.platform + '|' + o.currency;
    if (simple && cache[k]) return cache[k];
    const res = AUM.run(Object.assign({ sheets: (global.SCOPE_DEMO || {}).sheets, adjustments: [] }, o));
    if (simple) cache[k] = res;
    return res;
  };
  const demo = T.demo;

  // ---------- independent reading of the raw Holdings grid (no calc code) ----------
  /** Holdings rows as objects keyed by the row-3 header (the row holding "Quotation Currency"; row 2 has output names). */
  function rawRows(grid) {
    const hr = grid.rows.findIndex((r) => (r || []).includes('Quotation Currency'));
    const head = grid.rows[hr];
    return grid.rows.slice(hr + 1).map((r, i) => { const o = { __row: hr + 2 + i }; head.forEach((h, c) => { if (h) o[h] = (r || [])[c]; }); return o; });
  }
  /** Mapping table columns read straight from the grid by letter (the workbook's layout). */
  function rawMapping(grid) {
    const col = (L) => L.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows = grid.rows.slice(3);
    return {
      holdingToCode: new Map(rows.filter((r) => r && r[col('T')]).map((r) => [String(r[col('T')]), String(r[col('Q')])])),
      activeCodes: new Set(rows.map((r) => r && r[col('J')]).filter(Boolean).map(String)),
      investorIds: new Set(rows.map((r) => r && r[col('AA')]).filter((v) => v !== null && v !== undefined && v !== '').map(String)),
    };
  }

  add('layout: header rows found by name and all six Mapping tables at the workbook columns', () => {
    const r = demo(), d = r.inputs;
    assert(d.sheets.Holdings.headerRow === 3 && d.sheets.Hardcoded.headerRow === 3 && d.sheets['ESG Hardcoded'].headerRow === 3, 'header rows');
    const t = d.tables;
    assert(t.references.columns.holdingsColumn === 'C' && t.references.columns.outputName === 'D', 'References C:D');
    assert(t.activeAssets.columns.views === 'H' && t.activeAssets.columns.list === 'I' && t.activeAssets.columns.mapping === 'J', 'Active Assets H:J');
    assert(t.securityMapping.columns.codeName === 'Q' && t.securityMapping.columns.holdingId === 'T' && t.securityMapping.columns.transactionGroup === 'U', 'Security Mapping Q:U');
    assert(t.fundingName.columns.fundName === 'Y' && t.fundingName.columns.holdingsId === 'AA', 'Funding Name Y:AA');
    assert(t.investmentGrade.columns.rating === 'AC' && t.investmentGrade.columns.score === 'AD', 'Investment Grade AC:AD');
    assert(t.fundCheck.columns.mapping === 'AH' && t.fundCheck.columns.holdings === 'AI', 'Fund Check AH:AI');
    assert(Object.values(t).every((x) => x.foundBy === 'title'), 'every table found by its title');
  });

  add('roles: every required column resolves; amounts via the row-2 output names', () => {
    const d = demo().inputs;
    const missing = d.roles.filter((x) => x.required && !x.letter);
    assert(!missing.length, 'missing: ' + missing.map((x) => x.sheet + '.' + x.role).join(', '));
    const nominal = d.roles.find((x) => x.sheet === 'Holdings' && x.role === 'nominal');
    assert(nominal.header === 'RA_Commitment QC' && nominal.via === 'output name (row 2)', `nominal → ${nominal.header} via ${nominal.via}`);
  });

  add("checks: the workbook's own formula columns are reproduced 100%", () => {
    const d = demo().inputs;
    assert(d.checks.length === 8, 'all eight checks run: ' + d.checks.map((c) => c.id).join(', '));
    for (const c of d.checks) assert(c.matched === c.total && c.status === 'ok', `${c.label}: ${c.matched}/${c.total} ` + JSON.stringify(c.examples.slice(0, 2)));
  });

  add('exclusions: unmapped securities, a currency without FX and an asset outside Active Assets are excluded with reasons', () => {
    const r = demo();
    const reasons = r.excludedPositions.map((p) => p.exclusionReason);
    assert(reasons.filter((x) => /Security Mapping/.test(x)).length === 2, 'two unmapped securities');
    assert(reasons.some((x) => /NOK/.test(x)), 'NOK without FX');
    assert(reasons.filter((x) => /Active Assets/.test(x)).length === 5, 'inactive asset positions: ' + reasons.filter((x) => /Active Assets/.test(x)).length);
    assert(r.issues.filter((i) => /not in Active Assets/.test(i.message)).length === 1, 'one issue per inactive asset');
    assert(r.issues.some((i) => /99999/.test(i.message) && i.severity === 'error'), 'unmapped investor flagged');
    assert(r.issues.some((i) => /exceeds nominal/.test(i.message)), 'drawn > nominal flagged');
    assert(r.issues.some((i) => /Maturity date missing/.test(i.message)), 'missing maturity flagged');
    assert(r.issues.some((i) => /different ratings/.test(i.message)), 'rating inconsistency flagged');
  });

  add('total exposure equals an independent recomputation from the raw Holdings grid (Σ nominal ÷ FX rate)', () => {
    const sheets = T.demoSheets(), r = demo(), m = rawMapping(sheets.Mapping);
    let total = 0, n = 0;
    for (const row of rawRows(sheets.Holdings)) {
      const sec = row['Security ID']; if (sec === null || sec === undefined || sec === '' || String(sec) === '0') continue;
      const code = m.holdingToCode.get(String(sec)); if (!code || !m.activeCodes.has(code)) continue;
      const rate = +row['FX Rate EC']; if (!(rate > 0)) continue;
      total += +row['RA_Commitment QC'] / rate; n++;
    }
    close(r.metrics.total_exposure_m, total / 1e6, 1e-6, 'total exposure (m)');
    assert(r.stats.included === n, `included ${r.stats.included} vs ${n}`);
  });

  add('views: compositions from §1 settings and investor columns; group + third party = total per asset', () => {
    const r = demo();
    const col = (a, l) => (a.byInvestor.get(l) || { nominal: 0 }).nominal;
    for (const a of r.assets) {
      close(a.platform['Total platform'].nominal, a.nominal, 1e-6, a.code + ' total');
      close(a.platform['Platform Alpha'].nominal, ['Investor 1', 'Investor 2', 'Investor 3', 'Investor 4'].reduce((s, l) => s + col(a, l), 0), 1e-6, a.code + ' alpha');
      close(a.platform['Fund I look-through (35%)'].nominal, 0.35 * col(a, 'Investor 7'), 1e-6, a.code + ' fund look-through');
      close(a.platform['Investor 9'].nominal, col(a, 'Investor 9'), 1e-6, a.code + ' investor column view');
      close(a.platform['Group (attributed)'].nominal, a.group_nominal, 1e-6, a.code + ' group view');
      close(a.group_nominal + a.third_party_nominal, a.nominal, 1e-6, a.code + ' split');
    }
    assert(r.platforms.every((p) => p.kind !== 'undefined'), 'every demo view resolves');
    assert(r.rows.every((x) => x.exposure_m > 0), 'Output rows only where the view has exposure');
  });

  add('FX: direction verified against the RC column; display currency scales; the exception applies only where configured', () => {
    const e = demo(), g = demo({ currency: 'GBP' });
    assert(e.inputs.fx.quote === 'ccy_per_eur' && e.inputs.fx.test.tested > 0 && e.inputs.fx.test.divide === e.inputs.fx.test.tested, JSON.stringify(e.inputs.fx.test));
    close(g.metrics.total_exposure_m, e.metrics.total_exposure_m * 0.855, 1e-6, 'GBP total');
    const beta = demo({ platform: 'Platform Beta' });
    const p5 = beta.positions.find((p) => p.investor_label === 'Investor 5' && p.currency === 'GBP' && !p.excluded);
    assert(p5, 'a GBP position of Investor 5 exists');
    close(p5.fx_rate, 0.86, 1e-12, 'override on Platform Beta');
    close(e.positions.find((p) => p.key === p5.key).fx_rate, 0.855, 1e-12, 'standard rate on other views');
    const other = beta.positions.find((p) => p.currency === 'GBP' && p.investor_label !== 'Investor 5' && !p.excluded);
    if (other) close(other.fx_rate, 0.855, 1e-12, 'other investors unaffected');
  });

  add('ratings: internal unless NR, worst agency otherwise, odd dashes normalised, IG threshold 610', () => {
    const r = demo();
    for (const p of r.positions) {
      const R = p.rating;
      assert(R.current_numeric === Math.max(R.internal_numeric, R.external_numeric), p.key + ' score = MAX');
      assert(R.ig_label === (R.current_numeric > 610 ? 'SUB IG' : 'IG'), p.key + ' IG label');
    }
    const odd = r.positions.find((p) => String(p.raw.fitch).includes('–'));
    assert(odd && odd.rating.fitch === 'BBB-', 'dash normalised: ' + (odd && odd.rating.fitch));
    assert(r.metrics.w_rating_label && r.metrics.w_rating_label !== 'NR', 'weighted rating label');
  });

  add('SINGLE: Model Portfolio = SINGLE uses Portfolio as the investor code', () => {
    const p = demo().positions.find((x) => String(x.raw.model_portfolio).toUpperCase() === 'SINGLE');
    assert(p && p.investor_id === String(p.raw.portfolio) && p.src.investor_id.table === 'calc', 'SINGLE rule');
  });

  add('robust to where the sheets are pasted: extra rows and columns before the data give identical results', () => {
    const sheets = T.demoSheets();
    for (const name of Object.keys(sheets)) { sheets[name].rows = [[], []].concat(sheets[name].rows.map((r) => [null, null].concat(r || []))); }
    const a = demo(), b = demo({ sheets });
    close(b.metrics.total_exposure_m, a.metrics.total_exposure_m, 1e-9, 'total');
    assert(b.rows.length === a.rows.length && b.stats.excluded === a.stats.excluded, 'rows and exclusions');
    assert(b.inputs.tables.references.columns.holdingsColumn === 'E', 'References moved to E');
  });

  add('Excel types: numbers and Excel serial dates (as read from .xlsx) give the same results as text', () => {
    const sheets = T.demoSheets();
    const serial = (iso) => Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86400000);
    for (const g of Object.values(sheets)) for (const row of g.rows) if (row) for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) row[c] = serial(v);
      else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) row[c] = +v;
    }
    const a = demo(), b = demo({ sheets });
    close(b.metrics.total_exposure_m, a.metrics.total_exposure_m, 1e-9, 'total');
    close(b.metrics.w_remaining_years, a.metrics.w_remaining_years, 1e-9, 'remaining years (dates)');
    assert(U.isoDate(b.reportingDate) === U.isoDate(a.reportingDate), 'reporting date');
  });

  add('column override: choosing another Holdings column for "nominal" changes the calculation accordingly', () => {
    const a = demo(), b = demo({ overrides: { roles: { 'Holdings.nominal': 'Current Drawn Amount CCY' } } });
    close(b.metrics.total_exposure_m, a.metrics.total_drawn_m, 1e-6, 'nominal now equals drawn');
    assert(b.inputs.roles.find((x) => x.role === 'nominal' && x.sheet === 'Holdings').via === 'override', 'reported as override');
  });

  add('missing inputs: a missing sheet or required column is reported, never a crash or a silent zero', () => {
    const s1 = T.demoSheets(); delete s1.Holdings;
    const r1 = demo({ sheets: s1 });
    assert(r1.fatal && r1.issues.some((i) => i.severity === 'error' && /Holdings/.test(i.message)), 'missing sheet');
    const s2 = T.demoSheets(); const hr = s2.Holdings.rows[2]; const c = hr.indexOf('RA_Commitment QC'); hr[c] = 'Renamed'; s2.Holdings.rows[1][c] = 'Renamed';
    const r2 = demo({ sheets: s2 });
    assert(r2.issues.some((i) => i.severity === 'error' && /Nominal/.test(i.message)), 'missing required column');
  });

  add('corrections: a manual nominal moves the totals by the delta and keeps the original for the badge', () => {
    const base = demo();
    const p = base.positions.find((x) => !x.excluded && x.currency === 'EUR');
    const adj = demo({ adjustments: [{ id: 'x', table: 'positions', key: p.key, field: 'nominal', original: p.raw.nominal, value: String(p.nominal + 1e6), reason: 'test', user: 't', at: '' }] });
    close(adj.metrics.total_exposure_m - base.metrics.total_exposure_m, 1, 1e-6, 'moved by 1m');
    const q = adj.positions.find((x) => x.key === p.key);
    assert(q.src.nominal.table === 'manual' && String(q.src.nominal.original) === String(p.raw.nominal) && q.flags.includes('adjusted'), 'provenance');
  });

  add('provenance: imported values cite their workbook cell', () => {
    const p = demo().positions.find((x) => !x.excluded);
    assert(/^[A-Z]+\d+$/.test(p.src.nominal.cell) && p.src.nominal.table === 'Holdings', 'nominal cell ' + p.src.nominal.cell);
    const a = demo().assets.find((x) => x.sheets && x.sheets.Hardcoded);
    assert(/^Hardcoded![A-Z]+\d+$/.test(Object.values(a.sheets.Hardcoded)[0].cell), 'hardcoded cell');
  });

  add('fund look-through register: from §1 settings, a Data-page override replaces one fund, an empty list switches it off', () => {
    const r = demo();
    assert(r.fundRegister.length === 7 && r.fundRegister.every((x) => x.note === 'settings'), 'seven demo rows from settings');
    const o = demo({ overrides: { fundHolders: { 'Investor 7': [['Investor 2', 0.35]] } } });
    const f7 = o.fundRegister.filter((x) => x.fund_label === 'Investor 7');
    assert(f7.length === 1 && f7[0].holder_label === 'Investor 2' && f7[0].note === 'override', 'override replaces the fund entry');
    assert(o.fundRegister.filter((x) => x.fund_label === 'Investor 8').length === 3, 'other fund unchanged');
    const off = demo({ overrides: { fundHolders: { 'Investor 7': [], 'Investor 8': [] } } });
    assert(off.fundRegister.length === 0 && off.issues.some((i) => /no unit holders listed/.test(i.message)), 'empty lists switch look-through off with a notice');
    const lt = Scope.engine.lookthrough;
    if (lt) assert(lt.compute(r, r.fundRegister).available && lt.compute(r, r.fundRegister).reconciles, 'look-through available and reconciling on the demo');
  });

  add('exports and subsets reconcile with the totals', () => {
    const r = demo();
    close(AUM.outputRecords(r).reduce((s, o) => s + o.exposure_m, 0), r.metrics.total_exposure_m, 1e-6, 'Output export');
    assert(AUM.positionRecords(r).length === r.positions.length, 'position export');
    let t = 0; for (const s of r.distributions.sector.map((d) => d.label)) t += AUM.summarise(r.rows.filter((x) => (x.sector || '(blank)') === s), r.ratingScale, r.config).metrics.total_exposure_m;
    close(t, r.metrics.total_exposure_m, 1e-6, 'Σ sector subsets');
  });

  /** Run every case in order; returns [{ name, ok, error, ms }]. */
  T.run = async function () {
    const results = [];
    for (const c of T.cases) { const t0 = Date.now(); try { await c.fn(); results.push({ name: c.name, ok: true, ms: Date.now() - t0 }); } catch (e) { results.push({ name: c.name, ok: false, error: e.message, ms: Date.now() - t0 }); } }
    return results;
  };
})(typeof window !== 'undefined' ? window : globalThis);
