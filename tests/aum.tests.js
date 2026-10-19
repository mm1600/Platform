/* Scope AUM calculation tests (js/calc/aum.js). Run in the browser (tests/index.html) or Node (node tests/run-node.js).
 *
 * Creates Scope.tests = { cases, add, run, demoSheets, demo(opts) } and registers the calculation cases; the other suites
 * (pivot, look-through, concentration) load next and add theirs to the same list. The fixture is the synthetic demo
 * workbook (window.SCOPE_DEMO from data/demo.js): the four input sheets and the Ownership grid as cell grids,
 * exactly as a user would load them.
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
  /** The demo with the older Scope Settings sheet (views, ownership, FX exception, settings) instead of the Ownership grid. */
  T.legacySheets = () => { const s = T.demoSheets(); delete s.Ownership; s['Scope Settings'] = clone(global.SCOPE_TEST_SETTINGS); return s; };

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
    assert(d.checks.length === 10, 'all ten checks run: ' + d.checks.map((c) => c.id).join(', '));
    for (const c of d.checks) assert(c.matched === c.total && c.status === 'ok', `${c.label}: ${c.matched}/${c.total} ` + JSON.stringify(c.examples.slice(0, 2)));
  });

  add('exclusions: unmapped securities, a currency without FX and an asset outside Active Assets are excluded with reasons', () => {
    const r = demo();
    const reasons = r.excludedPositions.map((p) => p.exclusionReason);
    assert(reasons.filter((x) => /Security Mapping/.test(x)).length === 2, 'two unmapped securities');
    assert(reasons.some((x) => /NOK/.test(x)), 'NOK without FX');
    const inactiveN = reasons.filter((x) => /Active Assets/.test(x)).length;
    assert(inactiveN >= 2 && inactiveN === r.inputs.gaps.inactive[0].positions, 'inactive asset positions: ' + inactiveN);
    assert(r.issues.filter((i) => /not in Active Assets/.test(i.message)).length === 1, 'one issue per inactive asset');
    assert(r.issues.filter((i) => i.kind === 'unmapped_security').length === 2 && r.inputs.gaps.securities.length === 2, 'one issue per unmapped security, with what is needed to add it');
    const inv = r.issues.filter((i) => i.kind === 'unmapped_investor');
    assert(inv.length === 1 && /99999/.test(inv[0].message) && inv[0].severity === 'error' && r.inputs.gaps.investors[0].investorId === '99999', 'one issue per unmapped investor code');
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

  add('views: each view is a row of weights over the investor columns (the settings sheet); group + third party = total per asset', () => {
    const r = demo();
    const col = (a, l) => (a.byInvestor.get(l) || { nominal: 0 }).nominal;
    for (const a of r.assets) {
      close(a.platform['Total platform'].nominal, a.nominal, 1e-6, a.code + ' total');
      close(a.platform['Region A'].nominal, col(a, 'Investor 3') + col(a, 'Investor 4'), 1e-6, a.code + ' Region A');
      close(a.platform['Investor 1 incl. part in funds'].nominal, col(a, 'Investor 1') + 0.25 * col(a, 'Fund 1') + 0.15 * col(a, 'Fund 2'), 1e-6, a.code + ' incl. part in funds');
      close(a.platform['Investor 11'].nominal, col(a, 'Investor 11'), 1e-6, a.code + ' investor column view');
      close(a.platform['Group'].nominal, a.group_nominal, 1e-6, a.code + ' group view');
      close(a.group_nominal, ['Investor 1', 'Investor 2', 'Investor 3', 'Investor 4', 'Investor 7', 'Investor 8', 'Investor 9', 'Investor 10'].reduce((s, l) => s + col(a, l), 0) + 0.1 * col(a, 'Investor 5') + 0.35 * col(a, 'Investor 6') + 0.45 * col(a, 'Fund 1') + 0.4 * col(a, 'Fund 2') + 0.6 * col(a, 'Fund 3'), 1e-6, a.code + ' attribution weights: the group owns 100% of its entities, 10% of Investor 5, 35% of Investor 6, 45 / 40 / 60% of Funds 1–3 and nothing of the rest');
      close(a.group_nominal + a.third_party_nominal, a.nominal, 1e-6, a.code + ' split');
    }
    assert(r.platforms.every((p) => p.kind !== 'undefined'), 'every demo view resolves');
    assert(r.rows.every((x) => x.exposure_m > 0), 'Output rows only where the view has exposure');
    const types = Object.fromEntries(r.inputs.investors.map((i) => [i.label, i.group]));
    assert(types['Investor 1'] === 'Group entity' && types['Investor 5'] === 'Partly owned' && types['Investor 11'] === 'Third party' && types['Investor 13'] === 'Third party' && types['Fund 1'] === 'Fund', 'types worked out from the Ownership grid: ' + JSON.stringify(types));
  });

  add('weights: 1, 0.35, 35%, 7/20 and =7/20 are all read; types are inferred from the ownership when the Type column is blank', () => {
    const PW = AUM.parseWeight;
    close(PW(1), 1); close(PW('0.35'), 0.35); close(PW('35%'), 0.35); close(PW(35), 0.35); close(PW("7/20"), 0.35, 1e-12); close(PW('=7/20'), 0.35, 1e-12); close(PW(' 3 / 5 '), 0.6, 1e-12);
    assert(isNaN(PW('abc')) && isNaN(PW('')) && isNaN(PW(null)), 'non-weights are NaN');
    const s = T.legacySheets(), g = s['Scope Settings'];
    const hr = g.rows.findIndex((r) => (r || []).includes('Investor column')), cT = g.rows[hr].indexOf('Type'), cW = g.rows[hr].findIndex((x) => /ownership/i.test(String(x)));
    for (let r = hr + 1; r < g.rows.length; r++) { const row = g.rows[r] || []; if (row[cT]) row[cT] = null; if (String(row[cW]) === '0.45') row[cW] = '=45/100'; } // no types; a fraction
    const r = demo({ sheets: s });
    const by = (l) => r.inputs.investors.find((i) => i.label === l), f1 = by('Fund 1'), i1 = by('Investor 1'), i13 = by('Investor 13');
    close(f1.weight, 0.45, 1e-12, 'fraction read');
    assert(f1.group === 'Fund' && f1.typeInferred && i1.group === 'Group entity' && i1.typeInferred && i13.group === 'Third party', 'types inferred: ' + [f1.group, i1.group, i13.group].join(', '));
    // a share of ownership never makes a column a fund: only being held through a look-through view does
    assert(by('Investor 5').group === 'Partly owned' && by('Investor 6').group === 'Partly owned' && by('Fund 4').group === 'Third party', 'partly owned, not fund: ' + ['Investor 5', 'Investor 6', 'Fund 4'].map((l) => by(l).group).join(', '));
    assert(r.fundRegister.length === demo().fundRegister.length, 'look-through unchanged without the types');
  });

  add('view formulas: parsed as the workbook writes them, may name another view, keep their coefficients as typed, and fail loudly', () => {
    const PF = AUM.parseFormula;
    const f = PF('Investor 1 + 7/20 × Fund 1 + 25% of Fund 2 + Fund 6 × 1 + (0.5)*Fund 7');
    assert(!f.error && f.terms.length === 5 && f.terms[1].weight === 0.35 && f.terms[1].text === '7/20' && f.terms[2].weight === 0.25 && f.terms[4].weight === 0.5, JSON.stringify(f));
    assert(PF('abc × Fund 1').error && PF('').terms.length === 0, 'errors and blanks');
    const r = demo();
    const ra = r.inputs.views.find((v) => v.view === 'Region A incl. part in funds');
    assert(ra.formula === 'Region A + 0.1 × Fund 1 + 0.05 × Fund 2', 'formula shown as written: ' + ra.formula);
    assert(ra.composition.some((c) => c.label === 'Investor 4' && c.weight === 1 && c.via === 'Region A') && ra.composition.some((c) => c.label === 'Fund 1' && c.weight === 0.1), 'the view reference is expanded to columns');
    assert(r.fundRegister.some((x) => x.fund_label === 'Fund 2' && x.holder_label === 'Region A' && x.share === 0.05), 'look-through still finds the base view');
    // a formula changed in the app (a string override), with a fraction
    const o = demo({ overrides: { views: { 'Region A': 'Investor 4 + Investor 5 + 1/2 × Investor 6' } } });
    const v = o.inputs.views.find((x) => x.view === 'Region A');
    assert(v.kind === 'override' && v.composition.find((c) => c.label === 'Investor 6').weight === 0.5 && v.formula.includes('1/2 × Investor 6'), 'string override parsed and shown with its fraction');
    const col = (a, l) => (a.byInvestor.get(l) || { nominal: 0 }).nominal;
    for (const a of o.assets) close(a.platform['Region A'].nominal, col(a, 'Investor 4') + col(a, 'Investor 5') + 0.5 * col(a, 'Investor 6'), 1e-6, a.code);
    // a circular reference is reported, not looped
    const c = demo({ overrides: { views: { 'Loop A': 'Loop B + Investor 1', 'Loop B': 'Loop A' } } });
    assert(c.issues.some((i) => /circle/.test(i.message)) && c.platforms.find((p) => p.id === 'Loop A').composition.length === 1, 'cycle guarded');
    // a settings scalar changed in the app
    const t = demo({ overrides: { settings: { igThreshold: 400 } } });
    assert(t.config.ig_threshold === 400 && t.positions.some((p) => p.rating.current_numeric > 400 && p.rating.current_numeric <= 610 && p.rating.ig_label === 'SUB IG'), 'IG threshold override applies');
  });

  add('FX: direction verified against the RC column; display currency scales; the exceptions apply only where configured', () => {
    const e = demo(), g = demo({ currency: 'GBP' });
    assert(e.inputs.fx.quote === 'ccy_per_eur' && e.inputs.fx.test.tested > 0 && e.inputs.fx.test.divide === e.inputs.fx.test.tested, JSON.stringify(e.inputs.fx.test));
    assert(e.inputs.fx.source === 'workbook' && e.inputs.fx.reference === 'Investor 1', 'workbook rule with Investor 1 as the reference investor');
    close(g.metrics.total_exposure_m, e.metrics.total_exposure_m * 0.855, 1e-6, 'GBP total');
    // a fixed rate for one investor, one currency, one view
    const ra = demo({ platform: 'Region A', sheets: T.legacySheets() });
    const p5 = ra.positions.find((p) => p.investor_label === 'Investor 5' && p.currency === 'GBP' && !p.excluded);
    assert(p5, 'a GBP position of Investor 5 exists');
    close(p5.fx_rate, 0.86, 1e-12, 'exception on the Region A view');
    close(e.positions.find((p) => p.key === p5.key).fx_rate, 0.855, 1e-12, 'standard rate on other views');
    const other = ra.positions.find((p) => p.currency === 'GBP' && p.investor_label !== 'Investor 5' && !p.excluded);
    if (other) close(other.fx_rate, 0.855, 1e-12, 'other investors unaffected');
    // one rate per asset from a Hardcoded column, for a portfolio code on one view (the workbook's hard-coded case)
    const v12 = demo({ platform: 'Investor 12', sheets: T.legacySheets() });
    const p12 = v12.positions.find((p) => p.investor_id === '61012' && p.currency === 'GBP' && !p.excluded);
    assert(p12, 'a GBP position of portfolio 61012 exists');
    const hc = v12.assets.find((a) => a.code === p12.asset_code).sheets.Hardcoded['Investor 21 FX for GBP / EUR'];
    close(p12.fx_rate, +hc.value, 1e-12, 'rate from the Hardcoded column ' + hc.cell);
    assert(/exception/.test(p12.src.fx_rate.note) && /Hardcoded!/.test(p12.src.fx_rate.note), 'provenance names the Hardcoded cell');
    close(e.positions.find((p) => p.key === p12.key).fx_rate, 0.855, 1e-12, 'standard rate on the Total platform view');
  });

  add('FX: the workbook rule uses one rate per currency (the reference investor\'s first row); a currency it does not hold falls back with a warning', () => {
    const s = T.legacySheets(), g = s.Holdings, hr = g.rows.findIndex((r) => (r || []).includes('Quotation Currency'));
    const head = g.rows[hr], cI = head.indexOf('Investor Code'), cC = head.indexOf('Quotation Currency'), cF = head.indexOf('FX Rate EC'), cR = head.indexOf('RA Commitment RC');
    // perturb every GBP rate except Investor 1's first GBP row: the workbook ignores the others
    let firstGbp = -1;
    for (let r = hr + 1; r < g.rows.length; r++) { const row = g.rows[r] || []; if (String(row[cC]) !== 'GBP' || String(row[cI]) !== '61001') continue; if (firstGbp < 0) firstGbp = r; else row[cF] = 0.9; }
    for (let r = hr + 1; r < g.rows.length; r++) { const row = g.rows[r] || []; if (String(row[cC]) === 'GBP' && String(row[cI]) !== '61001') { row[cF] = 0.95; row[cR] = ''; } }
    const wb = demo({ sheets: s }), own = demo({ sheets: s, overrides: { fxQuote: 'ccy_per_eur' } }); // overrides only the quote; the source comes from the sheet
    for (const p of wb.positions.filter((p) => p.currency === 'GBP' && !p.excluded)) close(p.fx_rate, 0.855, 1e-12, `${p.key} uses the reference row`);
    assert(wb.inputs.fx.table.find((x) => x.currency === 'GBP').source.startsWith('Investor 1 row'), 'rate source reported');
    // the same sheets with "each position's own rate"
    const sheet = s['Scope Settings'], rr = sheet.rows.findIndex((r) => (r || []).includes('FX rate source')); sheet.rows[rr][sheet.rows[rr].indexOf('FX rate source') + 1] = "Each position's own rate";
    const pos = demo({ sheets: s });
    assert(pos.inputs.fx.source === 'position' && pos.positions.some((p) => p.currency === 'GBP' && !p.excluded && Math.abs(p.fx_rate - 0.95) < 1e-12), 'own rates used');
    // a currency the reference investor does not hold: converted with its own rate, with a warning (the workbook would show 0)
    const s2 = T.demoSheets(), g2 = s2.Holdings;
    for (let r = hr + 1; r < g2.rows.length; r++) { const row = g2.rows[r] || []; if (String(row[cC]) === 'CHF' && String(row[cI]) === '61001') { row[cC] = 'EUR'; row[cF] = 1; row[cR] = row[head.indexOf('RA_Commitment QC')]; } }
    const r2 = demo({ sheets: s2 });
    assert(r2.positions.some((p) => p.currency === 'CHF' && !p.excluded && p.fx_rate > 0), 'CHF positions still valued');
    assert(r2.issues.some((i) => i.severity === 'warn' && /holds nothing in CHF/.test(i.message)), 'warning about the workbook zeroing CHF');
    assert(!own.fatal, 'quote override alone does not break anything');
  });

  add('rate type and currency: any spelling read, an asset whose positions differ split position by position; the sector is the Holdings one', () => {
    for (const [v, k] of [['Fixed', 'Fixed'], ['FIXED RATE', 'Fixed'], ['Taux fixe', 'Fixed'], ['Zero coupon', 'Fixed'], ['F', 'Fixed'], ['Floating', 'Floating'], ['FLOATING RATE', 'Floating'],
      ['Variable', 'Floating'], ['FRN', 'Floating'], ['Euribor 6M', 'Floating'], ['V', 'Floating'], ['Inflation-linked', 'Inflation-linked'], ['', 'Not stated'], [null, 'Not stated']]) assert(AUM.rateKind(v) === k, `${v} → ${AUM.rateKind(v)}`);
    const r0 = demo(), a0 = r0.rows.map((r) => r.asset).find((a) => a.positions.length >= 2 && a.positions.every((p) => p.currency === 'EUR'));
    assert(a0, 'an asset with two EUR positions');
    assert(r0.rows.every((r) => r.sector && r.sector === r.asset.positions.find((p) => p.raw.sector).raw.sector), 'sector = Holdings › Sector (Underlying Asset Type)');
    const s = T.demoSheets(), g = s.Holdings, head = g.rows[2].map((x) => String(x)), cRate = head.indexOf('Rate Type'), cCcy = head.indexOf('Quotation Currency'), cFx = head.indexOf('FX Rate EC');
    const usdFx = g.rows.find((row) => row && row[cCcy] === 'USD')[cFx], p1 = a0.positions[1], row = g.rows[p1.line - 1];
    assert(String(row[head.indexOf('Security ID')]) === String(p1.holding_id), 'position row found');
    row[cRate] = a0.positions[0].fixed_floating === 'Fixed' ? 'FLOATING RATE' : 'FIXED RATE'; row[cCcy] = 'USD'; row[cFx] = usdFx;
    const r1 = demo({ sheets: s }), x = r1.rows.find((r) => r.code === a0.code), D = r1.distributions;
    assert(x.fixed_floating === 'Mixed' && x.currency === 'Multi' && Object.keys(x.split.currency).length === 2 && Object.keys(x.split.fixed_floating).length === 2, 'the asset is mixed: ' + JSON.stringify(x.split));
    close(Object.values(x.split.currency).reduce((t, v) => t + v, 0), x.exposure_m, 1e-9, 'the split adds up to the exposure');
    close(D.currency.reduce((t, d) => t + d.exposure_m, 0), r1.metrics.total_exposure_m, 1e-9, 'currencies add up');
    assert(!D.currency.some((d) => d.label === 'Multi'), 'no "Multi" slice');
    const usd = r1.rows.reduce((t, r) => t + (r.split.currency.USD || 0), 0); close(D.currency.find((d) => d.label === 'USD').exposure_m, usd, 1e-9, 'USD = Σ USD positions');
    const fixed = r1.rows.reduce((t, r) => t + (r.split.fixed_floating.Fixed || 0), 0); close(r1.metrics.fixed_share, fixed / r1.metrics.total_exposure_m, 1e-9, 'fixed share position by position');
    assert(r1.issues.some((i) => /^Rate type \(column/.test(i.message) && /FLOATING RATE|FIXED RATE/.test(i.message)), 'the rate types seen are listed');
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

  add('fund look-through register: derived from the "<investor> incl. part in funds" views; a view changed in the app changes the register', () => {
    const r = demo();
    const key = (x) => `${x.fund_label}|${x.holder_label}|${x.share}`;
    assert(r.fundRegister.length === 6 && r.fundRegister.every((x) => x.note === 'sheet'), 'six demo rows from the three look-through views: ' + r.fundRegister.map(key).join(' '));
    assert(r.fundRegister.some((x) => key(x) === 'Fund 1|Investor 1|0.25') && r.fundRegister.some((x) => key(x) === 'Fund 2|Investor 2|0.1') && r.fundRegister.some((x) => key(x) === 'Fund 3|Investor 2|0.5'), 'investor shares');
    const ra = r.fundRegister.filter((x) => x.holder_label === 'Region A');
    assert(ra.length === 2 && ra.every((x) => x.holder_group === 'View' && x.holder_weight === 1), 'a composite view holds units too, with its entities\' weight');
    assert(r.inputs.views.find((v) => v.view === 'Investor 1 incl. part in funds').lookThroughBase === 'Investor 1', 'the view knows whose look-through it is');
    // changed in the app: Investor 1 now holds 35% of Fund 1 and nothing of Fund 2
    const o = demo({ overrides: { views: { 'Investor 1 incl. part in funds': [['Investor 1', 1], ['Fund 1', 0.35], ['Fund 6', 1]] } } });
    const f1 = o.fundRegister.filter((x) => x.fund_label === 'Fund 1' && x.holder_label === 'Investor 1');
    assert(f1.length === 1 && f1[0].share === 0.35 && f1[0].note === 'override', 'override changes the share');
    assert(!o.fundRegister.some((x) => x.fund_label === 'Fund 2' && x.holder_label === 'Investor 1') && o.fundRegister.filter((x) => x.fund_label === 'Fund 2').length === 2, 'Fund 2 loses that holder, keeps the others');
    // a new look-through view for a third party
    const n = demo({ overrides: { views: { 'Investor 13 incl. part in funds': [['Investor 13', 1], ['Fund 5', 0.3]] } } });
    assert(n.fundRegister.some((x) => x.fund_label === 'Fund 5' && x.holder_label === 'Investor 13' && x.share === 0.3), 'new view adds a holder');
    const lt = Scope.engine.lookthrough;
    if (lt) assert(lt.compute(r, r.fundRegister).available && lt.compute(r, r.fundRegister).reconciles, 'look-through available and reconciling on the demo');
  });

  add('mapping gaps closed in the app: rows appended to Security Mapping, Funding Name and Active Assets are read like any other row', () => {
    const base = demo(), gaps = base.inputs.gaps;
    const sec = gaps.securities[0], invCode = gaps.investors[0], inact = gaps.inactive[0];
    assert(sec && invCode && inact, 'the demo has one of each gap');
    // the store appends the rows below the right table; the calculation then finds them (rows are marked as added)
    const grid = T.demoSheets().Mapping, tables = AUM.locateMapping(grid);
    const append = (table, values) => { const t = tables[table], r = t.rows.length ? t.rows[t.rows.length - 1].__row : t.headerRow + 1; while (grid.rows.length <= r) grid.rows.push([]); for (const [k, c] of Object.entries(t.cols)) if (values[k] !== undefined) grid.rows[r][c] = values[k]; t.rows.push({ __row: r + 1 }); (grid.addedRows = grid.addedRows || []).push(r); };
    append('securityMapping', { codeName: 'NEWX01', holdingsName: sec.securityName, identificationId: sec.holdingId, holdingId: sec.holdingId, transactionGroup: 'TG-NEW' });
    append('activeAssets', { list: sec.securityName, mapping: 'NEWX01' });
    append('fundingName', { fundName: 'Investor 99 Mandate', holdingsName: 'Investor 99', holdingsId: invCode.investorId });
    for (const name of inact.securityNames) append('activeAssets', { list: name, mapping: inact.codeName });
    const sheets = Object.assign(T.demoSheets(), { Mapping: grid });
    const r = demo({ sheets });
    assert(!r.inputs.gaps.securities.some((g) => g.holdingId === sec.holdingId) && !r.inputs.gaps.investors.length && !r.inputs.gaps.inactive.length, 'gaps closed: ' + JSON.stringify(r.inputs.gaps).slice(0, 200));
    assert(r.investorColumns.includes('Investor 99') && r.inputs.investors.find((i) => i.label === 'Investor 99').added, 'new investor column, marked as added');
    const a = r.assets.find((x) => x.code === sec.holdingId);
    assert(a && a.positionCount === sec.positions && a.nominal > 0, 'the unmapped security is now an asset with its positions');
    const nowActive = r.assets.find((x) => x.code_name === inact.codeName);
    close(r.metrics.total_exposure_m - base.metrics.total_exposure_m, (a.nominal + nowActive.nominal) / 1e6, 1e-6, 'total grew by exactly the newly mapped positions');
  });

  add('view names are exact: "Investor 1" is its column although "Investor 1 incl. part in funds" exists; a formula may add two incl. views; an FX exception on "Region A" leaves the incl. view alone', () => {
    const r = demo(), one = demo({ platform: 'Investor 1' });
    const v = r.inputs.views.find((x) => x.view === 'Investor 1');
    assert(v.kind === 'investor column' && v.composition.length === 1 && v.composition[0].label === 'Investor 1' && v.composition[0].weight === 1, JSON.stringify(v));
    const colTotal = r.assets.reduce((s, a) => s + (a.byInvestor.get('Investor 1') || { nominal: 0 }).nominal, 0) / 1e6;
    close(one.metrics.total_exposure_m, colTotal, 1e-6, 'view Investor 1 = the Investor 1 column');
    const incl = r.inputs.views.find((x) => x.view === 'Investor 1 incl. part in funds');
    assert(incl.composition.some((c) => c.label === 'Fund 1' && Math.abs(c.weight - 0.25) < 1e-12) && one.metrics.total_exposure_m < demo({ platform: 'Investor 1 incl. part in funds' }).metrics.total_exposure_m, 'the incl. view keeps its fund weights and is larger');
    const ev = AUM.effectiveSettings(r).views.find((x) => x.view === 'Investor 1');
    assert(!ev || !ev.formula, 'no formula is written back for a plain-column view: ' + JSON.stringify(ev));
    // a formula adding two incl. views keeps both as views (expanded to their columns), not collapsed to the base columns
    const o = demo({ overrides: { views: { Both: 'Investor 1 incl. part in funds + Investor 2 incl. part in funds' } } });
    const b = o.inputs.views.find((x) => x.view === 'Both'), w = (l) => (b.composition.find((c) => c.label === l) || { weight: 0 }).weight;
    assert(w('Investor 1') === 1 && w('Investor 2') === 1 && Math.abs(w('Fund 1') - 0.25) < 1e-12 && Math.abs(w('Fund 2') - 0.25) < 1e-12 && w('Fund 3') === 0.5, JSON.stringify(b.composition));
    assert(!o.issues.some((i) => /taken as the investor column/.test(i.message) && /incl\. part in funds/.test(i.message)), 'no loose match of an incl. view to a column');
    // the FX exception scoped to the Region A view does not fire on Region A incl. part in funds
    const ri = demo({ platform: 'Region A incl. part in funds', sheets: T.legacySheets() });
    const p5 = ri.positions.find((p) => p.investor_label === 'Investor 5' && p.currency === 'GBP' && !p.excluded);
    assert(p5, 'a GBP position of Investor 5 exists'); close(p5.fx_rate, 0.855, 1e-12, 'standard rate on the incl. view');
  });
  add('Active Assets codes match the Security Mapping code names whatever their case or spacing; Hardcoded rows are found for the same assets', () => {
    const grid = T.demoSheets().Mapping, t = AUM.locateMapping(grid).activeAssets, c = t.cols.mapping;
    let changed = 0;
    for (const row of t.rows) { const r = row.__row - 1, v = grid.rows[r][c]; if (typeof v === 'string' && v) { grid.rows[r][c] = ' ' + v.toLowerCase() + ' '; changed++; } }
    assert(changed > 3, 'codes rewritten');
    const base = demo(), r = demo({ sheets: Object.assign(T.demoSheets(), { Mapping: grid }) });
    const n = (res, f) => res.assets.filter(f).length;
    assert(n(r, (a) => a.active) === n(base, (a) => a.active) && n(r, (a) => a.inActiveList) === n(base, (a) => a.inActiveList) && n(r, (a) => a.sheets.Hardcoded) === n(base, (a) => a.sheets.Hardcoded), 'same active assets and Hardcoded rows');
    close(r.metrics.total_exposure_m, base.metrics.total_exposure_m, 1e-9, 'same total');
    assert(JSON.stringify(r.rows.map((x) => x.code)) === JSON.stringify(base.rows.map((x) => x.code)), 'same Output rows in the same order');
  });
  add('settings: a duplicated Investors row is reported and the first kept; a formula coefficient above 1 is a multiple while an ownership above 1 is a percentage; maturity buckets typed as text work', () => {
    assert(AUM.parseWeight(35) === 0.35 && AUM.parseWeight('35') === 0.35 && AUM.parseWeight('35%') === 0.35 && AUM.parseWeight(2, true) === 2 && AUM.parseFormula('2 × Fund 1').terms[0].weight === 2 && AUM.parseFormula('35% of Fund 1').terms[0].weight === 0.35, 'weights');
    const t = demo({ overrides: { settings: { maturityBuckets: '0-5, 5-10, 10+' } } });
    assert(JSON.stringify(t.config.buckets) === JSON.stringify(['0-5', '5-10', '10+']) && t.positions.every((p) => p.excluded || !p.maturity_bucket || ['0-5 y', '5-10 y', '10+ y', 'Matured', 'Unknown'].includes(p.maturity_bucket)), 'buckets from text: ' + JSON.stringify(t.config.buckets));
    const ss = T.legacySheets()['Scope Settings']; let tr = -1, tc = -1;
    ss.rows.some((row, r) => (row || []).some((v, c) => { if (String(v || '').trim() === 'Investors') { tr = r; tc = c; return true; } return false; }));
    assert(tr >= 0, 'Investors table found');
    let r = tr + 2; while (ss.rows[r] && ss.rows[r][tc]) r++;
    while (ss.rows.length <= r) ss.rows.push([]);
    for (let k = 0; k < 4; k++) ss.rows[r][tc + k] = ss.rows[tr + 2][tc + k];
    const base = demo({ sheets: T.legacySheets() }), d = demo({ sheets: Object.assign(T.legacySheets(), { 'Scope Settings': ss }) });
    assert(d.issues.some((i) => /Investors: ".+" appears twice/.test(i.message)) && d.inputs.investors.length === base.inputs.investors.length, 'duplicate reported, nothing else changes');
    close(d.metrics.book_group_m, base.metrics.book_group_m, 1e-9, 'same attributed total');
  });
  add('the group view is "my portfolio": Σ the group\'s ownership × each investor column (funds included); every other view takes its columns at 100%', () => {
    const g = demo({ platform: 'Group' }), f1 = demo({ platform: 'Fund 1' }), f2 = demo({ platform: 'Fund 2' });
    const own = Object.fromEntries(g.investors.map((i) => [i.label, i.group_weight]));
    assert(own['Investor 5'] === 0.1 && own['Investor 6'] === 0.35 && own['Fund 1'] === 0.45 && own['Fund 3'] === 0.6 && own['Fund 6'] === 0 && own['Investor 13'] === 0, 'ownership as entered');
    const colTotal = (r, l) => r.assets.reduce((s, a) => s + (a.byInvestor.get(l) || { nominal: 0 }).nominal, 0) / 1e6;
    close(g.metrics.total_exposure_m, g.investorColumns.reduce((s, l) => s + (own[l] || 0) * colTotal(g, l), 0), 1e-6, 'group view = Σ ownership × column');
    close(f1.metrics.total_exposure_m, colTotal(f1, 'Fund 1'), 1e-6, 'Fund 1 view = the whole Fund 1 column, not 45% of it');
    close(f2.metrics.total_exposure_m, colTotal(f2, 'Fund 2'), 1e-6, 'Fund 2 view = the whole column, not 40% of it');
    assert(g.platform.isGroup && !f1.platform.isGroup, 'only the group view is the group view');
  });
  add('Ownership grid: rows are views (Group = its ownership, a column\'s row = its incl. part in funds view, other rows = composites); it beats the older sheet, app changes beat it, and the download reads back the same', () => {
    const r = demo(), legacy = demo({ sheets: T.legacySheets() });
    assert(r.inputs.ownership.present && !r.inputs.settings.present, 'the demo carries the Ownership grid only');
    const comp = (res) => JSON.stringify(res.inputs.views.map((v) => [v.view, v.composition.map((c) => [c.label, c.weight])]));
    assert(comp(r) === comp(legacy), 'the same views as the older sheet');
    assert(JSON.stringify(r.fundRegister.map((x) => [x.fund_label, x.holder_label, x.share])) === JSON.stringify(legacy.fundRegister.map((x) => [x.fund_label, x.holder_label, x.share])), 'the same look-through');
    assert(JSON.stringify(r.inputs.investors.map((i) => [i.label, i.weight])) === JSON.stringify(legacy.inputs.investors.map((i) => [i.label, i.weight])), 'the same ownership');
    // both sheets: the grid wins for ownership and views
    const both = T.legacySheets(); both.Ownership = T.demoSheets().Ownership;
    const ss = both['Scope Settings'], ir = ss.rows.findIndex((x) => (x || []).includes('Investor column')), cW = ss.rows[ir].findIndex((x) => /ownership/i.test(String(x)));
    for (let k = ir + 1; k < ss.rows.length; k++) if (ss.rows[k] && ss.rows[k][cW] !== null && ss.rows[k][cW] !== undefined) ss.rows[k][cW] = 0;
    const b = demo({ sheets: both });
    close(demo({ sheets: both, platform: 'Group' }).metrics.total_exposure_m, demo({ platform: 'Group' }).metrics.total_exposure_m, 1e-9, 'grid ownership wins over the older sheet');
    // an app change beats the grid
    const o = demo({ platform: 'Group', overrides: { investors: { 'Investor 5': ['', 1] } } }), g = demo({ platform: 'Group' });
    const col5 = g.assets.reduce((t, a) => t + (a.byInvestor.get('Investor 5') || { nominal: 0 }).nominal, 0) / 1e6;
    close(o.metrics.total_exposure_m - g.metrics.total_exposure_m, 0.9 * col5, 1e-6, 'Investor 5 at 100% instead of 10%');
    // the download is the same grid: same views, register and ownership when read back
    const out = AUM.ownershipGrid(r), s2 = T.demoSheets(); s2.Ownership = out;
    const back = demo({ sheets: s2 });
    assert(out.rows[0].length === out.rows.length && out.rows.every((x, k) => k === 0 || x[0] === out.rows[0][k]), 'square: the same names across and down');
    assert(JSON.stringify(back.inputs.views.map((v) => [v.view, v.composition])) === JSON.stringify(r.inputs.views.map((v) => [v.view, v.composition])), 'views read back');
    assert(JSON.stringify(back.fundRegister) === JSON.stringify(r.fundRegister) && JSON.stringify(back.inputs.investors.map((i) => [i.label, i.weight])) === JSON.stringify(r.inputs.investors.map((i) => [i.label, i.weight])), 'register and ownership read back');
    // bad cells are reported and read as 0; a row without a name is reported
    const s3 = T.demoSheets(); s3.Ownership.rows[1][5] = 'lots'; s3.Ownership.rows.push([null, 0.5]);
    const bad = demo({ sheets: s3 });
    assert(bad.issues.some((i) => i.table === 'Ownership' && /is not a share/.test(i.message)) && bad.issues.some((i) => i.table === 'Ownership' && /no name/.test(i.message)), 'reported');
  });
  add('IDs match whether stored as numbers or text: "100200", 100200 and "100200.0" are the same holding, investor or asset', () => {
    const s = T.demoSheets(), g = s.Holdings, hr = g.rows.findIndex((r) => (r || []).includes('Quotation Currency'));
    const head = g.rows[hr], cS = head.indexOf('Security ID'), cM = head.indexOf('Model Portfolio'), cP = head.indexOf('Portfolio');
    for (let r = hr + 1; r < g.rows.length; r++) { const row = g.rows[r] || []; if (row[cS] !== undefined && row[cS] !== null && row[cS] !== '' && /^\d+$/.test(String(row[cS]))) row[cS] = String(row[cS]) + '.0'; if (/^\d+$/.test(String(row[cM]))) row[cM] = ' ' + row[cM] + ' '; if (/^\d+$/.test(String(row[cP]))) row[cP] = +row[cP]; }
    const hc = s.Hardcoded; for (let r = 3; r < hc.rows.length; r++) if (hc.rows[r] && hc.rows[r][2] !== undefined && hc.rows[r][2] !== null) hc.rows[r][2] = +hc.rows[r][2];
    const a = demo(), b = demo({ sheets: s });
    close(b.metrics.total_exposure_m, a.metrics.total_exposure_m, 1e-9, 'total');
    assert(b.stats.excluded === a.stats.excluded && b.rows.length === a.rows.length, 'same exclusions and rows');
    assert(b.assets.filter((x) => x.sheets && x.sheets.Hardcoded).length === a.assets.filter((x) => x.sheets && x.sheets.Hardcoded).length, 'Hardcoded rows still found');
  });

  // tests/fixtures/formulas.xlsx: the demo's four sheets saved by a spreadsheet application with LIVE formulas (Holdings row 2
  // and columns B–E, Mapping P, Hardcoded D–E as XLOOKUP / IF / IFNA formulas, numbers and real dates). One column (Holdings E)
  // points at a sheet that is not in the file, as happens when sheets are copied out of a workbook, so it shows #NAME?.
  /** Bytes of the formula fixture: from disk in Node, over HTTP in the browser (null when opened as a file). */
  async function formulaFixture() {
    if (typeof require === 'function' && typeof __dirname !== 'undefined') { const b = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'formulas.xlsx')); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) { const r = await fetch('fixtures/formulas.xlsx'); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; }
    return null;
  }
  add('a workbook saved with live formulas gives the same results; failed formula columns are skipped, not reported as differences', async () => {
    const bytes = await formulaFixture(); if (!bytes) return; // opened as a file in the browser: nothing to fetch
    const read = await Scope.inputs.readFiles([{ name: 'AUM workbook.xlsx', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }]);
    assert(['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'].every((n) => read.sheets[n]), 'four sheets read');
    const a = demo(), b = demo({ sheets: Object.assign({}, read.sheets, { Ownership: T.demoSheets().Ownership }) });
    close(b.metrics.total_exposure_m, a.metrics.total_exposure_m, 1e-9, 'total');
    close(b.metrics.w_remaining_years, a.metrics.w_remaining_years, 1e-9, 'dates (Excel serials)');
    assert(b.rows.length === a.rows.length && b.stats.excluded === a.stats.excluded, 'rows and exclusions');
    const byId = Object.fromEntries(b.inputs.checks.map((c) => [c.id, c]));
    assert(byId.identificationId.status === 'skipped' && byId.identificationId.failed > 100, 'the broken column is skipped');
    for (const c of b.inputs.checks.filter((x) => x.status !== 'skipped')) assert(c.matched === c.total, `${c.label}: ${c.matched}/${c.total}`);
    assert(!b.issues.some((i) => i.severity !== 'info' && /formula/i.test(i.message)), 'no warning or error about formulas');
  });

  add('Scope Settings sheet: app changes beat the sheet, the sheet beats the defaults, and names can be changed everywhere', () => {
    const r = demo({ sheets: T.legacySheets() });
    assert(r.inputs.settings.present && r.inputs.settings.tables.views.found && r.inputs.investors.every((i) => i.source === 'sheet'), 'investors from the sheet');
    assert(r.inputs.settings.tables.views.groupRow && r.inputs.settings.tables.fxException.rows === 2 && r.inputs.settings.tables.settings.found, 'all three tables read');
    // without the sheet: neutral defaults (only Total platform is defined; everyone unclassified; the attribution view still exists, empty)
    const s0 = T.demoSheets(); delete s0['Scope Settings']; delete s0.Ownership;
    const none = demo({ sheets: s0 });
    assert(!none.inputs.settings.present && none.inputs.investors.every((i) => i.source === 'default' && i.group === 'Unclassified'), 'defaults without the sheet');
    assert(none.inputs.views.find((v) => v.view === 'Region A').kind === 'undefined' && none.inputs.views.find((v) => v.view === 'Group').def === 'group', 'views need the sheet; the attribution view is always known');
    assert(none.platforms.some((p) => p.id === 'Investor 11' && p.kind === 'investor column'), 'single investor columns work without the sheet');
    close(none.metrics.total_exposure_m, r.metrics.total_exposure_m, 1e-9, 'Total platform unaffected');
    assert(none.fundRegister.length === 0, 'no look-through without the views');
    // an app change wins over the sheet
    const o = demo({ overrides: { investors: { 'Fund 1': ['Fund', 0.5] } } });
    const f1 = o.inputs.investors.find((i) => i.original === 'Fund 1');
    assert(f1.weight === 0.5 && f1.source === 'override', 'override wins');
    close(o.assets[0].platform.Group.nominal, o.assets[0].group_nominal, 1e-9, 'the Group view follows the changed weight');
    // renaming: the display name replaces the workbook name everywhere, and settings written with either name still apply
    const n = demo({ overrides: { names: { 'Fund 1': 'Infra Debt Fund I' } } });
    assert(n.investorColumns.includes('Infra Debt Fund I') && !n.investorColumns.includes('Fund 1'), 'renamed column');
    assert(n.inputs.investors.find((i) => i.original === 'Fund 1').nameSource === 'override', 'name source');
    assert(n.fundRegister.some((x) => x.fund_label === 'Infra Debt Fund I'), 'look-through follows the new name');
    close(n.metrics.total_exposure_m, r.metrics.total_exposure_m, 1e-9, 'totals unchanged by a rename');
    close(n.assets.reduce((s, a) => s + a.platform['Investor 1 incl. part in funds'].nominal, 0), r.assets.reduce((s, a) => s + a.platform['Investor 1 incl. part in funds'].nominal, 0), 1e-6, 'views still resolve');
    // the sheet's Display name column renames too
    const s1 = T.legacySheets(), g1 = s1['Scope Settings'], hr = g1.rows.findIndex((x) => (x || []).includes('Investor column')), cN = g1.rows[hr].indexOf('Display name'), cC = g1.rows[hr].indexOf('Investor column');
    for (let r = hr + 1; r < g1.rows.length; r++) if ((g1.rows[r] || [])[cC] === 'Investor 11') g1.rows[r][cN] = 'Mandate Eleven';
    const d = demo({ sheets: s1 });
    assert(d.investorColumns.includes('Mandate Eleven') && d.platforms.some((p) => p.id === 'Investor 11' && p.composition[0].label === 'Mandate Eleven'), 'sheet display name applies and Mapping H view still resolves');
    // the older matrix form (investor columns across, one row of weights per view) is still read
    const m = { name: 'Scope Settings', rows: [[], [null, 'Views'], [null, 'View', 'Investor 1', 'Investor 4', 'Investor 5', 'Fund 1'], [null, 'Type', 'Group entity', 'Group entity', 'Group entity', 'Fund'], [null, 'Group', 1, 1, 1, '45%'], [null, 'Region A', null, 1, 1], [null, 'Investor 1 incl. part in funds', 1, null, null, '1/4']] };
    const mx = demo({ sheets: Object.assign(T.demoSheets(), { 'Scope Settings': m }) });
    assert(mx.inputs.settings.tables.views.form === 'matrix' && mx.inputs.investors.find((i) => i.label === 'Fund 1').weight === 0.45 && mx.platforms.find((p) => p.id === 'Region A').composition.length === 2, 'matrix form read');
    assert(mx.fundRegister.some((x) => x.fund_label === 'Fund 1' && x.holder_label === 'Investor 1' && x.share === 0.25), 'matrix look-through');
  });

  add('Scope Settings sheet: what the app downloads reads back to the same configuration', () => {
    const r = demo({ sheets: T.legacySheets() }), eff = AUM.effectiveSettings(r), grid = AUM.settingsGrid(eff);
    const s1 = T.legacySheets(); s1['Scope Settings'] = grid;
    const b = demo({ sheets: s1 });
    close(b.metrics.total_exposure_m, r.metrics.total_exposure_m, 1e-9, 'total');
    assert(JSON.stringify(b.inputs.views.map((v) => [v.view, v.kind, v.composition])) === JSON.stringify(r.inputs.views.map((v) => [v.view, v.kind, v.composition])), 'views');
    assert(JSON.stringify(b.fundRegister.map((x) => [x.fund_label, x.holder_label, x.share])) === JSON.stringify(r.fundRegister.map((x) => [x.fund_label, x.holder_label, x.share])), 'look-through');
    assert(JSON.stringify(b.inputs.investors.map((i) => [i.label, i.group, i.weight])) === JSON.stringify(r.inputs.investors.map((i) => [i.label, i.group, i.weight])), 'types and weights');
    assert(JSON.stringify(b.inputs.fxException) === JSON.stringify(r.inputs.fxException) && b.inputs.fx.source === r.inputs.fx.source && b.inputs.fx.reference === r.inputs.fx.reference, 'FX settings');
    assert(b.positions.find((p) => p.investor_label === 'Investor 5' && p.currency === 'GBP') !== undefined, 'positions');
    // the sheet is two tables (plus FX Exception and Settings): Investors with the group ownership, Views with one formula each
    assert(grid.rows[1].includes('Investors') && grid.rows[1].includes('Views') && grid.rows[2].includes('Group ownership') && grid.rows[2].includes('Formula'), 'layout');
    assert(grid.rows.filter((x) => x && x[1] && x[1] !== 'Investors' && x[1] !== 'Investor column' && typeof x[1] === 'string' && !/^Scope Settings/.test(x[1])).length === r.inputs.investors.length, 'one row per investor column');
    const f = grid.rows.find((x) => x && x[6] === 'Investor 1 incl. part in funds');
    assert(f && f[7] === 'Investor 1 + 1/4 × Fund 1 + 15% × Fund 2', 'formula written with its coefficients as typed: ' + (f && f[7]));
  });

  add('robust Mapping: unrecognised headers fall back to the workbook column order; a missing table gives one plain diagnosis', () => {
    const s = T.demoSheets(), M = s.Mapping, row3 = M.rows[2];
    const cQ = row3.indexOf('Code Name'); ['Kode', 'Nom', 'Ident', 'Hold', 'Grp'].forEach((x, k) => { row3[cQ + k] = x; }); // Security Mapping headers nobody expects
    const r = demo({ sheets: s }), base = demo();
    assert(/by position/.test(r.inputs.tables.securityMapping.foundBy) && r.inputs.tables.securityMapping.columns.holdingId === 'T', 'columns by position: ' + r.inputs.tables.securityMapping.foundBy);
    close(r.metrics.total_exposure_m, base.metrics.total_exposure_m, 1e-9, 'same total');
    assert(r.issues.some((i) => /headers was recognised/.test(i.message)) && r.inputs.tables.securityMapping.headersSeen.join(',').includes('Q=Kode'), 'headers seen are reported');
    // the whole table gone: every Security ID fails, and one diagnosis says what was compared with what
    const s2 = T.demoSheets(); for (const row of s2.Mapping.rows) for (let c = cQ - 1; c <= cQ + 4; c++) if (row) row[c] = null;
    const r2 = demo({ sheets: s2 });
    assert(r2.inputs.diagnosis.length >= 1 && /Security IDs were not found/.test(r2.inputs.diagnosis[0]) && /Holdings column I/.test(r2.inputs.diagnosis[0]), 'diagnosis: ' + r2.inputs.diagnosis[0]);
    assert(r2.issues.filter((i) => i.kind === 'diagnosis').length >= 1 && r2.stats.included === 0, 'nothing valued, one diagnosis issue');
    const text = AUM.diagnosticsText(r2);
    assert(/== DIAGNOSIS/.test(text) && /== MAPPING TABLES/.test(text) && /samples:/.test(AUM.diagnosticsText(base)) && !/\d{3},\d{3}/.test(text), 'report has the sections and no amounts');
  });

  add('real-workbook shapes: several codes per investor column, the platform and measures in Mapping H, a settings name that is a prefix of the column', () => {
    const s = T.legacySheets(), M = s.Mapping;
    // Funding Name: two more codes for Investor 1 and one for Investor 13 (as a real table has one row per portfolio code)
    const hr = 2, cY = M.rows[hr].indexOf('Fund Name'), last = M.rows.length;
    M.rows.push(Object.assign([], { [cY]: 'Investor 1 Portfolio B', [cY + 1]: 'Investor 1', [cY + 2]: 61098 }));
    M.rows.push(Object.assign([], { [cY]: 'Investor 1 Portfolio C', [cY + 1]: 'Investor 1', [cY + 2]: '61099' }));
    M.rows.push(Object.assign([], { [cY]: 'Investor 13 Mandate 2', [cY + 1]: 'Investor 13', [cY + 2]: 61097 }));
    // Mapping H: the workbook's selector starts with the platform total and the commitment column
    const cH = M.rows[hr].indexOf('Views (Portfolios / Investors)');
    const views = []; for (let r = hr + 1; r < last; r++) if (M.rows[r] && M.rows[r][cH]) { views.push(M.rows[r][cH]); M.rows[r][cH] = null; }
    ['Infrastructure debt platform', 'Commitment'].concat(views).forEach((v, k) => { while (M.rows.length <= hr + 1 + k) M.rows.push([]); M.rows[hr + 1 + k][cH] = v; });
    // Holdings: one position moved to the new code 61098, one to 61099
    const H = s.Holdings, hh = H.rows.findIndex((r) => (r || []).includes('Quotation Currency')), cM = H.rows[hh].indexOf('Model Portfolio'), cP = H.rows[hh].indexOf('Portfolio');
    let moved = 0; for (let r = hh + 1; r < H.rows.length && moved < 2; r++) { const row = H.rows[r] || []; if (String(row[cM]) === '61001') { row[cM] = moved ? '61099' : 61098; row[cP] = row[cM]; moved++; } }
    // settings sheet: Investor 13 written as a prefix of its name
    const g = s['Scope Settings'], ir = g.rows.findIndex((r) => (r || []).includes('Investor column')), cC = g.rows[ir].indexOf('Investor column');
    for (let r = ir + 1; r < g.rows.length; r++) if ((g.rows[r] || [])[cC] === 'Investor 13') g.rows[r][cC] = 'Investor 13 Mand';
    g.rows.find((r) => r && r[cC] === 'Investor 1')[cC] = 'Investor 1'; // unchanged
    const r = demo({ sheets: s }), base = demo({ sheets: T.legacySheets() });
    assert(r.investorColumns.length === base.investorColumns.length && r.investorColumns.filter((l) => l === 'Investor 1').length === 1, 'one column per investor name: ' + r.investorColumns.join(', '));
    const i1 = r.inputs.investors.find((i) => i.label === 'Investor 1');
    assert(i1.ids.length === 3 && i1.id.includes('61098'), 'all codes kept: ' + i1.id);
    assert(JSON.stringify(i1.segments.map((x) => x.name)) === JSON.stringify(['Investor 1 Portfolio', 'Investor 1 Portfolio B', 'Investor 1 Portfolio C']) && i1.segments[1].code === '61098', 'segments (fund name + code) for the Look-through dropdown: ' + JSON.stringify(i1.segments));
    close(r.assets.reduce((t, a) => t + ((a.byInvestor.get('Investor 1') || {}).nominal || 0), 0), base.assets.reduce((t, a) => t + ((a.byInvestor.get('Investor 1') || {}).nominal || 0), 0), 1e-6, 'the moved positions still count in Investor 1');
    assert(!r.issues.some((i) => /Investor 13 Mand/.test(i.message) && /ignored/.test(i.message)) && r.inputs.investors.find((i) => i.label === 'Investor 13').source === 'sheet', 'a unique prefix in the settings sheet matches the column');
    const plat = r.platforms.find((p) => p.id === 'Infrastructure debt platform'), com = r.platforms.find((p) => p.id === 'Commitment');
    assert(plat && plat.composition[0].label === '*' && !com && r.issues.some((i) => i.severity === 'info' && /Commitment/.test(i.message) && /not views/.test(i.message)), 'the platform total shows everything; the measure column is not a view');
    const first = demo({ sheets: s, platform: 'Infrastructure debt platform' }), none = demo({ sheets: s, platform: 'No such view' });
    assert(first.platformId === 'Infrastructure debt platform' && first.rows.length === base.rows.length && none.rows.length === base.rows.length, 'the platform view and the fallback view show the book, not 0');
    assert(!r.issues.some((i) => i.severity === 'warn' && /not an investor column/.test(i.message)), 'no warnings about names that are not investor columns: ' + r.issues.filter((i) => /not an investor column/.test(i.message)).map((i) => i.severity + ' ' + i.message).join(' | '));
  });

  add('end to end in the real workbook\'s shape: row-2 names as in Calculations, Mapping H = Calculations row 2, several codes per column, a loosely named settings row: no new errors, every view shows the book', () => {
    const base = demo({ sheets: T.legacySheets() }), s = T.legacySheets();
    // Holdings row 2: the output names the Calculations sheet looks up (instead of the demo's short names)
    const H = s.Holdings, hr = H.rows.findIndex((r) => (r || []).includes('Quotation Currency')), head = H.rows[hr], out = H.rows[hr - 1];
    const rename = { 'RA_Commitment QC': 'Amount nominal (QC)', 'Current Drawn Amount CCY': 'Current drawn amount (QC)', 'Initial Commitment Amount CCY': 'Initial commitment (QC)', 'FX Rate EC': 'Forex', 'Quotation Currency': 'Currency',
      'Rating Fitch': 'External Rating Fitch', "Rating Moody's": 'External Rating Moodys', 'Rating S&P': 'External Rating S&P', 'Internal Current Rating': 'Internal Rating', 'Rate Type': 'Fixed / Floating', 'All-in Spread at Acquisition': 'All-in spread (bps)', 'WAL': 'Current WAL',
      'RA_Bullet': 'Bullet / Amortizing', 'RA Asset Country Name': 'Country', 'Parent Issuer Name': 'Borrower name', 'Security Type Name': 'Format', 'Ext Sec Group_Rating_Closing': 'Initial Rating', 'Identification ID': 'Security ID' }; // the last one is the trap: a row-2 "Security ID" on the wrong column
    head.forEach((hd, c) => { if (rename[hd]) out[c] = rename[hd]; });
    // … and the References table that produces row 2, so the workbook's own row-2 check still reconciles
    const M = s.Mapping, mh = 2, cH = M.rows[mh].indexOf('Views (Portfolios / Investors)'), cY = M.rows[mh].indexOf('Fund Name'), cRef = M.rows[mh].indexOf('Columns in Holdings tab');
    for (const [hd, name] of Object.entries(rename)) { const row = M.rows.find((x, i) => i > mh && x && x[cRef] === hd); if (row) row[cRef + 1] = name; else { const nr = []; nr[cRef] = hd; nr[cRef + 1] = name; M.rows.push(nr); } }
    for (let r = mh + 1; r < M.rows.length; r++) if (M.rows[r]) M.rows[r][cH] = null;
    ['Split Calculations AUM', 'Commitment', 'Infrastructure debt platform', 'Investor 1', 'Investor 2', 'Region A', 'Fund 1', 'Group', 'Investor 1 incl. part in funds', 'Investor 2 incl. part in funds', 'Region A incl. part in funds', 'Split calculations Drawn Amount', 'Ratings', 'Additional AUM Data', 'ESG Data', 'Geography']
      .forEach((v, k) => { while (M.rows.length <= mh + 1 + k) M.rows.push([]); M.rows[mh + 1 + k][cH] = v; });
    // Funding Name: a second and third code for Investor 1, written as numbers
    M.rows.push(Object.assign([], { [cY]: 'Investor 1 Portfolio B', [cY + 1]: 'Investor 1', [cY + 2]: 61098 }));
    M.rows.push(Object.assign([], { [cY]: 'Investor 1 Portfolio C', [cY + 1]: 'Investor 1', [cY + 2]: 61099 }));
    const cM = head.indexOf('Model Portfolio'), cP = head.indexOf('Portfolio'); let moved = 0;
    for (let r = hr + 1; r < H.rows.length && moved < 3; r++) { const row = H.rows[r] || []; if (String(row[cM]) === '61001') { row[cM] = 61098 + (moved % 2); row[cP] = row[cM]; moved++; } }
    // settings: one investor written loosely, one view formula with a fraction and "of"
    const g = s['Scope Settings'], ir = g.rows.findIndex((r) => (r || []).includes('Investor column')), cC = g.rows[ir].indexOf('Investor column');
    for (let r = ir + 1; r < g.rows.length; r++) if ((g.rows[r] || [])[cC] === 'Investor 13') g.rows[r][cC] = 'Investor 13 Mandate';
    const r = demo({ sheets: s });
    const errs = (x) => x.issues.filter((i) => i.severity === 'error').map((i) => i.message.replace(/column [A-Z]+ "[^"]*"/, '').slice(0, 60));
    assert(JSON.stringify(errs(r)) === JSON.stringify(errs(base)), 'the same errors as the demo (the planted ones only): ' + JSON.stringify(errs(r)));
    assert(!r.issues.some((i) => i.severity === 'warn' && /not an investor column|not found in Security Mapping|matched 0%/.test(i.message)), 'no spurious warnings: ' + r.issues.filter((i) => i.severity === 'warn').map((i) => i.message).join(' | '));
    const sec = r.inputs.roles.find((x) => x.sheet === 'Holdings' && x.role === 'security_id');
    assert(sec.header === 'Security ID' && !r.inputs.keyChecks.some((k) => k.corrected), 'Security ID still read from the right column despite the row-2 trap: ' + sec.header);
    close(r.metrics.total_exposure_m, base.metrics.total_exposure_m, 1e-9, 'same total');
    assert(r.investorColumns.length === base.investorColumns.length && r.platforms.length === 9, 'one column per investor, nine views (titles, Commitment and the default Total platform, which the workbook\'s own total name stands for, skipped): ' + r.platforms.map((p) => p.id).join(', '));
    for (const p of r.platforms) { const n = r.assets.reduce((t, a) => t + ((a.platform[p.id] || {}).nominal || 0), 0); assert(n > 0, `view ${p.id} shows something`); }
    const pl = r.platforms.find((p) => p.id === 'Infrastructure debt platform'); assert(pl.composition[0].label === '*', 'the platform is every column');
    assert(r.inputs.investors.find((i) => i.label === 'Investor 13').source === 'sheet', 'loosely named settings row applied');
    assert(r.issues.some((i) => i.severity === 'info' && /Split Calculations AUM/.test(i.message)), 'the skipped titles are listed once as information');
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
  add('an "incl. part in funds" view whose row gives no fund shares is the column alone, never the whole platform', () => {
    const s = T.demoSheets(), M = s.Mapping.rows;
    let last = -1; for (let r = 3; r < M.length; r++) if (M[r] && M[r][7]) last = r;
    M[last + 1] = M[last + 1] || []; M[last + 1][7] = 'Fund 1 incl. part in funds'; // listed in Mapping H, Fund 1's grid row has no other cell
    const incl = demo({ platform: 'Fund 1 incl. part in funds', sheets: s }), alone = demo({ platform: 'Fund 1', sheets: T.demoSheets() });
    assert(incl.platformId === 'Fund 1 incl. part in funds', 'shown: ' + incl.platformId);
    close(incl.metrics.total_exposure_m, alone.metrics.total_exposure_m, 1e-9, 'equals Fund 1 alone');
    assert(incl.issues.some((x) => /no share in any fund is given for Fund 1/.test(x.message)), 'says why');
    // a view that cannot be shown is a warning, not a quiet switch
    const gone = demo({ platform: 'No such view', sheets: T.demoSheets() });
    assert(gone.platformId === 'Total platform' && gone.issues.some((x) => x.severity === 'warn' && /No such view/.test(x.message)), 'fallback flagged');
  });

  add('an "incl. part in funds" view in Mapping H spelled with another of the column\'s names uses that column\'s grid row, listed once', () => {
    const ref = demo({ platform: 'Investor 1 incl. part in funds' });
    const s = T.demoSheets();
    for (const r of s.Mapping.rows) if (r && r[7] === 'Investor 1 incl. part in funds') r[7] = 'Investor 1 Portfolio incl. part in funds'; // the fund name (Mapping Y)
    const res = demo({ platform: 'Investor 1 Portfolio incl. part in funds', sheets: s });
    assert(res.platformId === 'Investor 1 Portfolio incl. part in funds', 'shown: ' + res.platformId);
    close(res.metrics.total_exposure_m, ref.metrics.total_exposure_m, 1e-9, 'same as the grid row (column + its fund shares)');
    assert(res.platforms.filter((p) => /^Investor 1( Portfolio)? incl/.test(p.id)).length === 1, 'listed once: ' + res.platforms.map((p) => p.id).join(', '));
    assert(res.fundRegister.some((x) => x.holder_label === 'Investor 1'), 'look-through register kept');
  });

  add('Ownership grid: only the "incl. part in funds" views the workbook lists exist; a platform-total row is ignored; FX reference = first column in Mapping H', () => {
    const s = T.demoSheets(), g = s.Ownership.rows, head = g[0];
    const col = (n) => head.indexOf(n), row = (n) => g.find((r) => r[0] === n);
    // a 1 typed under the wrong name in Investor 7's row (as happens when the names across and down are not in the same order)
    row('Investor 7')[col('Investor 8')] = 1;
    // a row for the platform total filled with 1 everywhere
    g.push(['Total platform'].concat(head.slice(1).map(() => 1)));
    const res = demo({ platform: 'Investor 7', sheets: s }), ids = res.platforms.map((p) => p.id);
    assert(!ids.some((x) => /^Investor 7 incl/.test(x)), 'no view invented: ' + ids.filter((x) => /incl/.test(x)).join(', '));
    assert(ids.filter((x) => /incl/.test(x)).length === 3, 'exactly the three incl. views of Mapping H');
    close(res.metrics.total_exposure_m, demo({ platform: 'Investor 7' }).metrics.total_exposure_m, 1e-9, 'Investor 7 unchanged');
    const tp = demo({ platform: 'Total platform', sheets: s });
    close(tp.metrics.total_exposure_m, demo({ platform: 'Total platform' }).metrics.total_exposure_m, 1e-9, 'the platform total cannot be redefined by the grid');
    assert(res.issues.some((x) => /Investor 7's row has cells under Investor 8/.test(x.message)) && res.issues.some((x) => /platform total/.test(x.message)), 'both explained');
    // the FX reference investor follows Mapping H's first investor column (the workbook's FX table keys), not Funding Name's first row
    const s2 = T.demoSheets(), M = s2.Mapping.rows;
    const hr = M.findIndex((r) => r && r[7] === 'Total platform'); const i2 = M.findIndex((r, i) => i > hr && r && r[7] === 'Investor 2');
    M[i2][7] = M[hr + 1][7]; M[hr + 1][7] = 'Investor 2';
    assert(demo({ sheets: s2 }).inputs.fx.reference === 'Investor 2', 'reference follows Mapping H');
    assert(demo({}).inputs.fx.reference === 'Investor 1', 'demo reference unchanged');
  });

  add('Ownership grid in Calculations row-2 order: the platform row first and the group row named "Demo Group"-style are told apart; a view that shows nothing stays selected', () => {
    const s = T.demoSheets(), g = s.Ownership.rows, head = g[0];
    const grp = g.findIndex((r) => r[0] === 'Group'); const groupRow = g.splice(grp, 1)[0]; groupRow[0] = 'Demo Group';
    g.splice(1, 0, ['Total platform'].concat(head.slice(1).map(() => 1))); // the platform row comes first, full of 1s
    g.push(groupRow);                                                       // the group row last, under another name
    const res = demo({ platform: 'Demo Group', sheets: s }), ref = demo({ platform: 'Group' });
    assert(res.platformId === 'Demo Group', 'shown: ' + res.platformId);
    close(res.metrics.total_exposure_m, ref.metrics.total_exposure_m, 1e-9, 'the group view = the group row, not the platform row');
    close(res.metrics.book_group_m, ref.metrics.book_group_m, 1e-9, 'attribution from the group row');
    assert(res.inputs.investors.find((i) => i.label === 'Investor 11').weight === 0 && res.inputs.investors.find((i) => i.label === 'Investor 1').weight === 1, 'ownership per column from the group row');
    // a listed view whose definition names nothing known: stays selected, shows nothing, says why
    const s2 = T.demoSheets(), g2 = s2.Ownership.rows, h2 = g2[0]; const ra = g2.find((r) => r[0] === 'Region A');
    ra[h2.indexOf('Investor 3')] = null; ra[h2.indexOf('Investor 4')] = null; ra.push(1); h2.push('No Such Column');
    const bad = demo({ platform: 'Region A', sheets: s2 });
    assert(bad.platformId === 'Region A' && bad.rows.length === 0, 'kept the chosen view, empty: ' + bad.platformId + ' ' + bad.rows.length);
    assert(bad.issues.some((x) => x.severity === 'warn' && /View "Region A" shows nothing/.test(x.message)), 'explained');
  });

  add('watchlist: only values that say watch / intensive / yes count; Performing, Not on watchlist, blank do not; the values seen are listed', () => {
    const on = AUM.onWatchlist;
    for (const v of ['Watch', 'Watchlist', 'Intensive', 'Intensive care', 'Yes', 'Y', 'Amber', 'Red', 'Under review', 'On watchlist']) assert(on(v), v + ' should be on');
    for (const v of ['No', 'N', 'None', 'OK', 'Performing', 'Green', 'Normal', 'Not on watchlist', 'No watch', 'N/A', '-', '', null, 'Level 2']) assert(!on(v), JSON.stringify(v) + ' should be off');
    // a workbook that writes "Performing" instead of "No": the share stays what the Watch / Intensive assets are
    const s = T.demoSheets(), g = s.Hardcoded.rows, hr = g.findIndex((r) => (r || []).includes('Watchlist')), c = g[hr].indexOf('Watchlist');
    for (let r = hr + 1; r < g.length; r++) if (g[r] && g[r][c] === 'No') g[r][c] = 'Performing';
    const a = demo({ sheets: s }), b = demo({});
    close(a.metrics.watchlist_share, b.metrics.watchlist_share, 1e-12, 'share unchanged by the wording of "off"');
    assert(a.issues.some((x) => /Watchlist \(column/.test(x.message) && /"Performing" × \d+ = not on it/.test(x.message) && /"Watch" × \d+ = on the watchlist/.test(x.message)), 'values listed with their meaning');
  });

  add("FX check: the extract's own EUR amount (Amount (EUR)) is compared row by row; a row converted at another rate is an example; several rates per currency are noted", () => {
    const s = T.demoSheets(), g = s.Holdings.rows, hr = g.findIndex((r) => (r || []).includes('Quotation Currency')), head = g[hr];
    const cRC = head.indexOf('RA Commitment RC'), cF = head.indexOf('FX Rate EC'), cC = head.indexOf('Quotation Currency');
    g[hr - 1][cRC] = 'Amount (EUR)'; head[cRC] = 'Amount EUR'; // the real extract's names
    const gbp = []; for (let r = hr + 1; r < g.length; r++) if (g[r] && g[r][cC] === 'GBP' && U.isNum(g[r][cF])) gbp.push(r);
    assert(gbp.length > 2, 'GBP rows in the demo');
    g[gbp[1]][cRC] = +(g[gbp[1]][cRC] * 1.1).toFixed(2); // one row's own EUR amount 10% off
    g[gbp[2]][cF] = +(g[gbp[2]][cF] * 1.1).toFixed(6);   // one row carries another GBP rate
    const res = demo({ sheets: s }), c = res.inputs.checks.find((x) => x.id === 'fxConversion');
    assert(c && c.total > 100 && c.matched === c.total - 1, 'one row differs: ' + (c && c.matched + '/' + c.total));
    assert(c.examples.length === 1 && /^[A-Z]+\d+$/.test(c.examples[0].cell) && /first GBP row/.test(c.examples[0].scope), 'the example names the cell and the rate used: ' + JSON.stringify(c.examples[0]));
    assert(res.issues.some((x) => /GBP: Holdings rows carry 2 different rates/.test(x.message)), 'several rates noted');
    assert(res.inputs.roles.some((r) => r.role === 'nominal_rc' && r.header === 'Amount EUR'), 'Amount (EUR) found as the RC column');
  });

  add('Ownership grid filled "column owns row": transposed, mirrored (symmetric) and region-in-column grids all give the demo\'s views; "Group" is never a term', () => {
    const views = ['Total platform', 'Group', 'Region A', 'Investor 1 incl. part in funds', 'Investor 2 incl. part in funds', 'Region A incl. part in funds', 'Investor 1', 'Fund 1'];
    const totals = (sheets) => views.map((v) => { const r = demo({ platform: v, sheets: T.demoSheets() && sheets() }); return r.platformId + ':' + r.metrics.total_exposure_m.toFixed(6) + ':' + r.metrics.book_group_m.toFixed(6); });
    const ref = totals(() => T.demoSheets());
    // 1. the whole grid transposed (every cell = the share the COLUMN owns of the ROW)
    const transposed = () => { const s = T.demoSheets(), g = s.Ownership.rows, W = Math.max.apply(null, g.map((r) => r.length)); const Tt = []; for (let c = 0; c < W; c++) { const row = []; for (let r = 0; r < g.length; r++) row.push(g[r][c] === undefined ? null : g[r][c]); Tt.push(row); } s.Ownership.rows = Tt; return s; };
    assert(JSON.stringify(totals(transposed)) === JSON.stringify(ref), 'transposed grid = demo: ' + totals(transposed).join(' | '));
    const tr = demo({ sheets: transposed() });
    assert(tr.issues.some((x) => x.severity === 'warn' && /read the other way round/.test(x.message)), 'transposition said');
    assert(tr.platforms.filter((p) => /incl/.test(p.id)).length === 3, 'still three incl. views');
    // 2. the Group row AND the Group column both filled (mirrored), plus a stray 1 under Group in Investor 1's row
    const mirrored = () => { const s = T.demoSheets(), g = s.Ownership.rows, head = g[0], gi = g.findIndex((r) => r[0] === 'Group'), gc = head.indexOf('Group'); for (let c = 1; c < head.length; c++) { const v = g[gi][c]; if (v === null || v === undefined || v === '') continue; const ri = g.findIndex((r) => r[0] === head[c]); if (ri > 0) g[ri][gc] = v; } return s; };
    assert(JSON.stringify(totals(mirrored)) === JSON.stringify(ref), 'mirrored grid = demo: ' + totals(mirrored).join(' | '));
    assert(demo({ sheets: mirrored() }).issues.some((x) => /under the "Group" column read as the group/.test(x.message)), 'mirror said');
    // 3. a region whose row is empty and whose column holds its members
    const regionCol = () => { const s = T.demoSheets(), g = s.Ownership.rows, head = g[0], ra = g.find((r) => r[0] === 'Region A'), rc = head.indexOf('Region A'); const i3 = head.indexOf('Investor 3'), i4 = head.indexOf('Investor 4'); ra[i3] = null; ra[i4] = null; g.find((r) => r[0] === 'Investor 3')[rc] = 1; g.find((r) => r[0] === 'Investor 4')[rc] = 1; return s; };
    assert(JSON.stringify(totals(regionCol)) === JSON.stringify(ref), 'region column = demo: ' + totals(regionCol).join(' | '));
    // 4. "Group" written as a term of a formula view: dropped, with a warning, not every column again
    const r4 = demo({ platform: 'Investor 1 incl. part in funds', overrides: { views: { 'Investor 1 incl. part in funds': 'Investor 1 + Group + 1/4 × Fund 1' } } });
    const r1 = demo({ platform: 'Investor 1', sheets: T.demoSheets() }), f1 = demo({ platform: 'Fund 1', sheets: T.demoSheets() });
    close(r4.metrics.total_exposure_m, r1.metrics.total_exposure_m + f1.metrics.total_exposure_m / 4, 1e-6, 'Group dropped from the formula');
    assert(r4.issues.some((x) => x.severity === 'warn' && /"Group" cannot be a term/.test(x.message)), 'warned');
  });

  add('Mapping H in the workbook\'s own words: "Demo Group" = the Group view, "Infrastructure debt platform" = the total, "… draw" headers are not views', () => {
    const s = T.demoSheets(), M = s.Mapping.rows;
    for (const r of M) if (r) { if (r[7] === 'Group') r[7] = 'Demo Group'; if (r[7] === 'Total platform') r[7] = 'Infrastructure debt platform'; }
    let last = -1; for (let r = 3; r < M.length; r++) if (M[r] && M[r][7]) last = r;
    for (const n of ['Investor 1 draw', 'Investor 2 draw', 'Region A draw']) { last++; M[last] = M[last] || []; M[last][7] = n; }
    const res = demo({ platform: 'Demo Group', sheets: s }), ids = res.platforms.map((p) => p.id);
    assert(res.platformId === 'Demo Group' && res.config.attribution_label === 'Demo Group', 'label follows Mapping H: ' + res.config.attribution_label);
    close(res.metrics.total_exposure_m, demo({ platform: 'Group' }).metrics.total_exposure_m, 1e-9, 'same figures as the Group view');
    assert(!ids.includes('Group') && !ids.includes('Total platform'), 'no duplicate group / total views: ' + ids.join(', '));
    assert(ids.includes('Infrastructure debt platform') && !ids.some((x) => /draw$/.test(x)), 'total kept, draw headers left out: ' + ids.join(', '));
    const tp = demo({ platform: 'Infrastructure debt platform', sheets: s });
    close(tp.metrics.total_exposure_m, demo({}).metrics.total_exposure_m, 1e-9, 'the total is every column');
    assert(res.inputs.investors.find((i) => i.label === 'Investor 1').weight === 1, 'ownership still read from the grid\'s Group row');
  });

  add('FX currency check: a row whose Currency cell says the portfolio currency while its Ccy and PC amounts differ (or the reverse) is listed with its row', () => {
    const s = T.demoSheets(), g = s.Holdings.rows, hr = g.findIndex((r) => (r || []).includes('Quotation Currency')), head = g[hr];
    const cQ = head.indexOf('Quotation Currency'), cP = head.indexOf('Portfolio Currency'), cDC = head.indexOf('Current Drawn Amount CCY'), cDP = head.indexOf('Current Drawn Amount PC');
    assert(cQ > 0 && cP > 0 && cDC > 0 && cDP > 0, 'demo has the four columns');
    const clean = demo({}).inputs.checks.find((x) => x.id === 'fxCurrency');
    assert(clean && clean.total > 100 && clean.matched === clean.total, 'demo rows consistent: ' + (clean && clean.matched + '/' + clean.total));
    // a EUR-quoted loan in a GBP portfolio whose Currency cell wrongly says GBP: Ccy and PC amounts differ, cells say the same currency
    const r = g.findIndex((row, i) => i > hr && row && row[cQ] === 'EUR' && row[cP] === 'EUR' && U.isNum(row[cDC]) && row[cDC] > 0);
    g[r][cQ] = 'GBP'; g[r][cP] = 'GBP'; g[r][cDP] = +(g[r][cDC] * 0.855).toFixed(2);
    const res = demo({ sheets: s }), c = res.inputs.checks.find((x) => x.id === 'fxCurrency');
    assert(c.matched === c.total - 1 && c.examples.length === 1 && c.examples[0].cell.indexOf('row ' + (r + 1)) >= 0, 'the row is listed: ' + JSON.stringify(c.examples[0]));
    assert(/quotation currency is not GBP/.test(c.examples[0].scope), 'says what the amounts imply');
    assert(res.issues.some((x) => x.severity === 'warn' && /disagree with the Ccy \/ PC amounts/.test(x.message)), 'warned');
    assert(res.positions.find((p) => p.line === r + 1).flags.includes('fx_currency_mismatch'), 'position flagged');
  });

  add('amount currency: a nominal column already in EUR on non-EUR rows is detected (nominal × rate = drawn + unfunded), read as EUR and not converted twice; the setting overrides', () => {
    const s = T.demoSheets(), g = s.Holdings.rows, hr = g.findIndex((r) => (r || []).includes('Quotation Currency')), head = g[hr];
    const cQ = head.indexOf('Quotation Currency'), cN = head.indexOf('RA_Commitment QC'), cF = head.indexOf('FX Rate EC');
    let n = 0; for (let r = hr + 1; r < g.length; r++) if (g[r] && g[r][cQ] !== 'EUR' && U.isNum(g[r][cN]) && U.isNum(g[r][cF]) && g[r][cF] > 0) { g[r][cN] = +(g[r][cN] / g[r][cF]).toFixed(2); n++; } // the extract already converted the nominal
    assert(n > 10, 'non-EUR rows changed: ' + n);
    const ref = demo({}), auto = demo({ sheets: s }), forced = demo({ sheets: s, overrides: { settings: { nominalIn: 'qc' } } });
    const c = auto.inputs.checks.find((x) => x.id === 'amountCurrency');
    assert(c && c.total > 10 && c.matched === 0 && /already in EUR/.test(c.examples[0].scope), 'rows listed: ' + (c && c.matched + '/' + c.total) + ' ' + JSON.stringify(c && c.examples[0]));
    assert(auto.inputs.amountsIn.nominal === 'rc' && auto.issues.some((x) => x.severity === 'warn' && /nominal is already in EUR/.test(x.message)), 'detected and said: ' + JSON.stringify(auto.inputs.amountsIn));
    close(auto.metrics.total_exposure_m, ref.metrics.total_exposure_m, 1e-6, 'read as EUR: the same total as the untouched demo');
    close(auto.metrics.total_drawn_m, ref.metrics.total_drawn_m, 1e-9, 'drawn untouched');
    assert(forced.inputs.amountsIn.nominal === 'qc' && forced.metrics.total_exposure_m > ref.metrics.total_exposure_m * 1.01, 'forced to the rule: converted twice, higher');
    const clean = demo({}).inputs.checks.find((x) => x.id === 'amountCurrency'); assert(clean.matched === clean.total && clean.total > 10, 'demo: every non-EUR nominal is in the quotation currency');
  });

  add('FX: a EUR loan in a GBP portfolio is never converted (the row\'s Forex is the EUR→GBP rate); a GBP loan in a GBP portfolio takes the reference rate even in position mode', () => {
    const s = T.demoSheets(), g = s.Holdings.rows, hr = g.findIndex((r) => (r || []).includes('Quotation Currency')), head = g[hr], c = (n) => head.indexOf(n);
    const rows = []; for (let i = hr + 1; i < g.length && rows.length < 2; i++) if (g[i] && String(g[i][c('Investor Code')]) === '61007' && U.isNum(g[i][c('RA_Commitment QC')])) rows.push(i); // Investor 7: a GBP portfolio
    assert(rows.length === 2, 'two Investor 7 rows');
    const set = (r, q, pc, fx, n) => { const row = g[r]; row[c('Quotation Currency')] = q; row[c('Portfolio Currency')] = pc; row[c('FX Rate EC')] = fx; row[c('RA_Commitment QC')] = n; row[c('Current Drawn Amount CCY')] = n; row[c('Current Drawn Amount PC')] = q === pc ? n : +(n * 0.855).toFixed(2); row[c('Balance Unfunded Amount')] = 0; };
    set(rows[0], 'EUR', 'GBP', 0.855, 7972533.06); // the real case: EUR loan, GBP portfolio, Forex = EUR→GBP
    set(rows[1], 'GBP', 'GBP', 1, 6893222.01);     // GBP loan in the GBP portfolio: the row's Forex is 1 (GBP→GBP)
    for (const src of ['workbook', 'position']) {
      const res = demo({ platform: 'Investor 7', sheets: s, overrides: { settings: { fxRateSource: src } } });
      const a = res.positions.find((p) => p.line === rows[0] + 1), b = res.positions.find((p) => p.line === rows[1] + 1);
      close(a.nominal_base, 7972533.06, 0.01, src + ': EUR loan untouched');
      close(b.nominal_base, 6893222.01 / 0.855, 1, src + ': GBP loan ÷ the reference GBP rate');
      assert(res.issues.some((x) => /EUR position\(s\) carry a Forex other than 1/.test(x.message)), src + ': said');
    }
  });

  add('incl. part in funds, as filled in practice: shares in the column row plus "100%" of itself in the incl. row; a region\'s incl. row without the region; drawn blank as the workbook', () => {
    const ref1 = demo({ platform: 'Investor 1 incl. part in funds' }), refR = demo({ platform: 'Region A incl. part in funds' });
    const s = T.demoSheets(), g = s.Ownership.rows, head = g[0], col = (n) => { let i = head.indexOf(n); if (i < 0) { head.push(n); i = head.length - 1; } return i; };
    // Investor 1: its fund shares stay in its own row; an extra row "Investor 1 incl. part in funds" holds only "Investor 1 = 100%"
    const r1 = ['Investor 1 incl. part in funds']; r1[col('Investor 1')] = 1; g.push(r1);
    // Region A incl.: only the fund shares, the region itself not named
    const ri = g.find((r) => r[0] === 'Region A incl. part in funds'); ri[col('Region A')] = null;
    const a = demo({ platform: 'Investor 1 incl. part in funds', sheets: s }), b = demo({ platform: 'Region A incl. part in funds', sheets: s });
    close(a.metrics.total_exposure_m, ref1.metrics.total_exposure_m, 1e-9, 'Investor 1 incl. = its column + its fund shares (rows combined)');
    close(b.metrics.total_exposure_m, refR.metrics.total_exposure_m, 1e-9, 'Region A incl. includes Region A');
    assert(a.issues.some((x) => /filled in two rows/.test(x.message)) && b.issues.some((x) => /does not name Region A itself/.test(x.message)), 'both explained');
    assert(!U.isNum(ref1.metrics.total_drawn_m) && ref1.rows.every((r) => !U.isNum(r.drawn_m)), 'drawn blank on an incl. view');
    assert(U.isNum(demo({ platform: 'Investor 1' }).metrics.total_drawn_m), 'drawn shown on a plain view');
    const shown = demo({ platform: 'Investor 1 incl. part in funds', overrides: { settings: { lookThroughDrawn: 'show' } } });
    assert(U.isNum(shown.metrics.total_drawn_m) && shown.metrics.total_drawn_m > 0, 'drawn shown when set');
  });

  add('incl. part in funds filled down its column ("the column owns the row"): read as its row, no circle, same figures', () => {
    const ref1 = demo({ platform: 'Investor 1 incl. part in funds' }), refR = demo({ platform: 'Region A incl. part in funds' });
    const s = T.demoSheets(), g = s.Ownership.rows, head = g[0];
    const col = (n) => { let i = head.indexOf(n); if (i < 0) { head.push(n); i = head.length - 1; } return i; };
    const row = (n) => { let r = g.find((x) => x[0] === n); if (!r) { r = [n]; g.push(r); } return r; };
    // Investor 1: its shares move from its row to the column "Investor 1 incl. part in funds"
    const i1 = row('Investor 1'), ci = col('Investor 1 incl. part in funds'); row('Investor 1 incl. part in funds');
    for (const f of ['Fund 1', 'Fund 2']) { const k = head.indexOf(f); row(f)[ci] = i1[k]; i1[k] = null; }
    i1[ci] = 1;
    // Region A incl.: its row emptied, the same cells written down its column
    const ri = row('Region A incl. part in funds'), cr = col('Region A incl. part in funds');
    for (let k = 1; k < head.length; k++) if (k !== cr && ri[k] !== null && ri[k] !== undefined && ri[k] !== '') { row(head[k])[cr] = ri[k]; ri[k] = null; }
    const a = demo({ platform: 'Investor 1 incl. part in funds', sheets: s }), b = demo({ platform: 'Region A incl. part in funds', sheets: s });
    close(a.metrics.total_exposure_m, ref1.metrics.total_exposure_m, 1e-9, 'Investor 1 incl. from its column');
    close(b.metrics.total_exposure_m, refR.metrics.total_exposure_m, 1e-9, 'Region A incl. from its column');
    assert(!a.issues.some((x) => /circle/.test(x.message)) && a.issues.some((x) => /filled down its column/.test(x.message)), 'read from the column, no circle');
    close(demo({ platform: 'Investor 1', sheets: s }).metrics.total_exposure_m, demo({ platform: 'Investor 1' }).metrics.total_exposure_m, 1e-9, 'Investor 1 itself unchanged');
  });

})(typeof window !== 'undefined' ? window : globalThis);
