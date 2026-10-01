/* Scope engine tests — run in the browser (tests/index.html) or Node (node tests/run-node.js).
 *
 * Creates Scope.tests = { cases, files, run, tablesFrom } and registers the AUM engine cases; pivot.tests.js
 * (loaded next) adds the dataset / pivot cases to the same list. The host page sets Scope.tests.files to
 * the demo CSV texts before calling run(). Two fixtures: demo() runs the full synthetic demo dataset
 * (expected counts below are properties of that dataset), and tiny() runs a hand-written minimal set of
 * tables so a single workbook rule can be checked with exact numbers.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, AUM = Scope.engine.aum;
  const T = (Scope.tests = { cases: [], files: null });
  // Minimal test kit: register a case; assert a condition; assert two numbers agree within eps (default 1e-6).
  const add = (name, fn) => T.cases.push({ name, fn });
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };
  /** CSV texts by file name → engine input { tables, tableInfo }, as the store builds it (blank padding rows dropped from tables). */
  T.tablesFrom = function (files) { const tables = {}, tableInfo = {}; for (const [n, t] of Object.entries(files)) { const p = Scope.csv.parse(t); tables[n] = p.records.filter(Boolean); tableInfo[n] = { parsed: p }; } return { tables, tableInfo }; };
  /** Engine result for the demo dataset (TOTAL platform, EUR) with optional input overrides. */
  const demo = (opts) => AUM.compute(Object.assign({ adjustments: [], platform: 'TOTAL', currency: 'EUR' }, T.tablesFrom(T.files), opts || {}));
  /**
   * Engine result for a given holdings CSV over small fixed reference tables: assets A1 (holdings H1, H2) and
   * A2 (H3); investors 1 (weight 1), 2 (0.5), 3 (0); platforms TOTAL and P1; GBP at 0.8 with a 0.9 override
   * for investor 1 on P1. `extra` replaces whole tables; extra._opts overrides compute() input.
   */
  const tiny = (holdingsCsv, extra) => AUM.compute(Object.assign({ adjustments: [], platform: 'TOTAL', currency: 'EUR' }, T.tablesFrom(Object.assign({
    'holdings.csv': holdingsCsv,
    'mapping_columns.csv': 'source_header,canonical_field,required,note\n',
    'mapping_assets.csv': 'holding_id,asset_code,asset_name,code_name,security_id,tranche\nH1,A1,Asset One,ONE,XS1,\nH2,A1,Asset One,ONE,XS2,Tranche B\nH3,A2,Asset Two,TWO,XS3,\n',
    'mapping_investors.csv': 'investor_id,investor_key,investor_label,investor_group,group_weight\n1,I1,Investor One,Group entity,1\n2,I2,Fund X,Fund,0.5\n3,I3,Third Party,Third party,0\n',
    'platforms.csv': 'platform_id,platform_label,investor_label,weight\nTOTAL,Total,*,1\nP1,Platform One,Investor One,1\nP1,Platform One,Fund X,0.5\n',
    'ratings.csv': 'grade,numeric,scale\nAAA,100,SP_FITCH\nA-,450,SP_FITCH\nBBB+,500,SP_FITCH\nBBB,550,SP_FITCH\nBBB-,600,SP_FITCH\nBB+,700,SP_FITCH\nBB,750,SP_FITCH\nBa1,700,MOODYS\nBaa2,550,MOODYS\nA-,450,INTERNAL\nBBB,550,INTERNAL\nBB,750,INTERNAL\nNR,0,ALL\n',
    'fx.csv': 'currency,rate_per_eur,investor_id,platform_id,note\nEUR,1,,,\nGBP,0.8,,,\nGBP,0.9,1,P1,override\n',
    'hardcoded.csv': 'asset_code,sector,country,wal_years\nA1,Renewables,France,5\nA2,Transport,Spain,7\n',
    'esg.csv': 'asset_code,esg_score,green_loan\nA1,80,Y\n',
    'config.csv': 'key,value,note\nig_threshold,610,\n',
  }, extra || {})), extra && extra._opts));
  // Header row of a holdings extract in canonical column names (so no mapping_columns renames are needed).
  const H = 'portfolio_id,portfolio_alt_id,holding_id,security_name,as_of_date,currency,nominal,drawn,commitment,internal_grade,fitch,moodys,sp,funding_date,maturity_date,coupon_type,coupon,margin_bps,instrument_type\n';

  add('csv: quotes, CRLF, BOM and blank padding rows', () => {
    const p = Scope.csv.parse('﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n,,\r\n2,z,\r\n');
    assert(p.headers.join('|') === 'a|b|c', 'headers'); assert(p.records.length === 3 && p.records[1] === null, 'padding row → null');
    assert(p.records[0].b === 'x, y' && p.records[0].c === 'he said "hi"', 'quoted fields');
  });
  add('util: yearfrac 30/360, date parsing, grade normalisation, buckets', () => {
    close(U.yearfrac(U.parseDate('2024-03-27'), U.parseDate('2049-09-27')), 25.5, 1e-9, 'yearfrac');
    assert(U.isoDate(U.parseDate('31/12/2026')) === '2026-12-31' && U.isoDate(U.parseDate('46022')) === '2025-12-31', 'dates');
    assert(U.normalizeGrade('BBB –') === 'BBB-' && U.normalizeGrade(' Baa1 ') === 'Baa1', 'grades');
    assert(AUM.bucketOf(4.2, ['0-3', '3-5', '5-10', '10-20', '20+']) === '3-5 y' && AUM.bucketOf(25, ['0-3', '20+']) === '20+ y', 'buckets');
  });
  // The demo dataset deliberately contains two unmapped holdings, one NOK position with no FX rate, an unmapped
  // investor (99999), a rating inconsistency, a drawn > nominal row and a missing maturity date.
  add('demo: positions read, three excluded with named reasons', () => {
    const r = demo();
    assert(r.stats.positions === 227 && r.stats.excluded === 3, `positions ${r.stats.positions}, excluded ${r.stats.excluded}`);
    const reasons = r.excludedPositions.map((p) => p.exclusionReason).sort();
    assert(reasons.filter((x) => /mapping_assets/.test(x)).length === 2 && reasons.some((x) => /NOK/.test(x)), reasons.join('; '));
    assert(r.issues.some((i) => /99999/.test(i.message) && i.severity === 'error'), 'unmapped investor flagged');
    assert(r.issues.some((i) => /different ratings/.test(i.message)), 'rating inconsistency flagged');
    assert(r.issues.some((i) => /exceeds nominal/.test(i.message)), 'drawn > nominal flagged');
    assert(r.issues.some((i) => /Maturity date missing/.test(i.message)), 'missing maturity flagged');
  });
  add('demo: TOTAL exposure equals Σ included positions ÷ FX', () => {
    const r = demo();
    const expected = r.positions.filter((p) => !p.excluded).reduce((s, p) => s + p.nominal / p.fx_rate, 0) / 1e6;
    close(r.metrics.total_exposure_m, expected, 1e-6, 'total exposure');
    close(r.metrics.book_total_m, expected, 1e-6, 'book total');
  });
  add('demo: group attributed + third party = total for every asset; TOTAL = Σ investor columns', () => {
    const r = demo();
    for (const a of r.assets) {
      close(a.group_nominal + a.third_party_nominal, a.nominal, 1e-6, a.code);
      const colSum = Array.from(a.byInvestor.values()).reduce((s, c) => s + c.nominal, 0);
      close(a.platform.TOTAL.nominal, colSum, 1e-6, a.code + ' TOTAL');
      close(a.platform.TOTAL.nominal, a.nominal, 1e-6, a.code + ' TOTAL=nominal');
    }
  });
  // Platform columns are weighted sums of investor columns (platforms.csv), as the workbook's look-through columns.
  add('demo: platform ALPHA equals the sum of its four entity columns; FUND1LT is 35% of Fund I', () => {
    const r = demo();
    for (const a of r.assets) {
      const sum = ['Investor 1', 'Investor 2', 'Investor 3', 'Investor 4'].reduce((s, l) => s + ((a.byInvestor.get(l) || { nominal: 0 }).nominal), 0);
      close(a.platform.ALPHA.nominal, sum, 1e-6, a.code);
      close(a.platform.FUND1LT.nominal, 0.35 * ((a.byInvestor.get('Investor 7') || { nominal: 0 }).nominal), 1e-6, a.code + ' FUND1LT');
    }
    assert(r.rows.every((x) => x.exposure_m > 0), 'Output rows only where platform exposure > 0');
  });
  // Output!G6: switching the display currency multiplies every EUR amount by the display rate (0.855 GBP per EUR in the demo fx.csv).
  add('demo: display currency GBP scales every amount by the GBP rate', () => {
    const e = demo(), g = demo({ currency: 'GBP' });
    close(g.metrics.total_exposure_m, e.metrics.total_exposure_m * 0.855, 1e-6, 'GBP total');
    assert(g.displayCurrency === 'GBP', 'display currency');
  });
  // fx.csv override rows (investor + platform specific), the demo equivalent of the workbook's FX exception.
  add('demo: FX override applies only to investor 94305 / GBP / platform BETA', () => {
    const t = demo(), b = demo({ platform: 'BETA' });
    const pt = t.positions.find((p) => p.investor_id === '94305' && p.currency === 'GBP' && !p.excluded);
    assert(pt, 'a GBP position for 94305 exists in the demo');
    const pb = b.positions.find((p) => p.key === pt.key);
    close(pt.fx_rate, 0.855, 1e-9, 'standard rate on TOTAL'); close(pb.fx_rate, 0.86, 1e-9, 'override on BETA');
    const other = b.positions.find((p) => p.currency === 'GBP' && p.investor_id !== '94305' && !p.excluded);
    close(other.fx_rate, 0.855, 1e-9, 'other GBP investors unaffected');
  });
  // Position rating branch (Mapping AC:AD), including the workbook quirk that the numeric is MAX(internal, external).
  add('ratings: internal wins unless NR; external = worst of agencies (Fitch → Moody\'s → S&P); numeric = MAX', () => {
    const r = tiny(H + '1,,H1,A,2026-06-30,EUR,100,100,100,NR,BBB+,Ba1,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n' +
      '1,,H3,B,2026-06-30,EUR,100,100,100,A-,BB,NR,NR,2020-01-01,2030-01-01,Floating,,250,Loan\n');
    const [p1, p2] = r.positions;
    assert(p1.rating.external_grade === 'Ba1' && p1.rating.external_numeric === 700, `external ${p1.rating.external_grade}`);
    assert(p1.rating.current_grade === 'Ba1' && p1.rating.ig_label === 'SUB IG', 'NR internal → external grade');
    assert(p2.rating.current_grade === 'A-' && p2.rating.current_numeric === 750 && p2.rating.ig_label === 'SUB IG', 'workbook quirk: grade A- but numeric MAX → SUB IG');
  });
  add('ratings: unknown grade string is flagged and treated as NR; odd dash normalised', () => {
    const r = tiny(H + '1,,H1,A,2026-06-30,EUR,100,100,100,ZZZ,BBB –,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n');
    const p = r.positions[0];
    assert(r.issues.some((i) => /Unknown internal grade "ZZZ"/.test(i.message)), 'unknown flagged');
    assert(p.rating.fitch === 'BBB-' && p.rating.current_grade === 'BBB-', `dash normalised → ${p.rating.fitch}`);
  });
  // Holdings!C: IF portfolio_id = "SINGLE" use portfolio_alt_id as the investor id.
  add('SINGLE token uses the alternate portfolio id', () => {
    const r = tiny(H + 'SINGLE,2,H1,A,2026-06-30,EUR,100,100,100,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n');
    assert(r.positions[0].investor_id === '2' && r.positions[0].investor_label === 'Fund X', 'alt id used');
    assert(r.positions[0].src.investor_id.table === 'calc', 'provenance shows derivation');
  });
  add('platform composition with weights; group attribution uses group_weight', () => {
    const r = tiny(H + '1,,H1,A,2026-06-30,EUR,100,100,100,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n2,,H2,A,2026-06-30,EUR,200,150,200,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n3,,H1,A,2026-06-30,GBP,80,80,80,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n');
    const a = r.assets.find((x) => x.code === 'A1');
    close(a.nominal, 100 + 200 + 100, 1e-9, 'total (GBP 80 ÷ 0.8 = 100)');
    close(a.platform.P1.nominal, 100 + 0.5 * 200, 1e-9, 'P1 = 1×I1 + 0.5×FundX');
    close(a.group_nominal, 100 + 0.5 * 200, 1e-9, 'group attributed'); close(a.third_party_nominal, 200, 1e-9, 'third party = total − attributed (unattributed fund share counts as third party)');
    close(a.platform.P1.nominal, a.group_nominal, 1e-9, 'demo-style GROUP platform ties to the attributed figure');
    assert(a.positionCount === 3 && a.holdings.length === 2, 'two tranches, three positions');
  });
  add('attribution_label defaults to Group, is read from config.csv and drives the group_split label', () => {
    const d = tiny(H + '1,,H1,A,2026-06-30,EUR,100,100,100,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n');
    assert(d.config.attribution_label === 'Group' && d.distributions.group_split[0].label === 'Group attributed', 'default label');
    const c = tiny(H + '1,,H1,A,2026-06-30,EUR,100,100,100,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n', { 'config.csv': 'key,value,note\nig_threshold,610,\nattribution_label,House,\n' });
    assert(c.config.attribution_label === 'House' && c.distributions.group_split[0].label === 'House attributed', 'custom label');
    close(c.metrics.book_group_m, 100 / 1e6, 1e-12, 'book_group_m (millions)'); close(c.metrics.group_share_of_book, 1, 1e-9, 'group_share_of_book');
    const demoRes = demo();
    assert(demoRes.config.attribution_label === 'Group' && demoRes.platforms.some((p) => p.id === 'GROUP') && demoRes.investors.some((i) => i.label === 'Investor 1' && i.key === 'INV01'), 'demo naming');
    assert(demoRes.investors.every((i) => i.group === 'Unmapped' || ['Group entity', 'Fund', 'Third party'].includes(i.group)), 'investor groups');
  });
  // A mapping file without group_weight must not silently attribute anything to the group.
  add('missing group_weight column attributes nothing to the group and raises one warning', () => {
    const csvNew = H + '1,,H1,A,2026-06-30,EUR,100,100,100,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n2,,H2,A,2026-06-30,EUR,200,150,200,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n';
    const fresh = tiny(csvNew);
    const noWeight = tiny(csvNew, { 'mapping_investors.csv': 'investor_id,investor_key,investor_label,investor_group\n1,I1,Investor One,Group entity\n2,I2,Fund X,Fund\n3,I3,Third Party,Third party\n' });
    const a = noWeight.assets.find((x) => x.code === 'A1');
    close(a.group_nominal, 0, 1e-9, 'nothing attributed'); close(a.third_party_nominal, a.nominal, 1e-9, 'all third party');
    assert(noWeight.issues.filter((i) => i.severity === 'warn' && i.table === 'mapping_investors.csv' && /group_weight/.test(i.message)).length === 1, 'one warning');
    assert(!fresh.issues.some((i) => i.table === 'mapping_investors.csv'), 'no issue when group_weight is present');
  });
  // Manual adjustments (brief §11) flow through every total and keep the original value for the provenance badge.
  add('manual adjustment overrides a position amount, keeps provenance, and totals move by the delta', () => {
    const base = demo();
    const p = base.positions.find((x) => !x.excluded && x.currency === 'EUR');
    const adj = demo({ adjustments: [{ id: 'x', table: 'positions', key: p.key, field: 'nominal', original: p.raw.nominal, value: String(p.nominal + 1000000), reason: 'test', user: 't', at: '' }] });
    close(adj.metrics.total_exposure_m - base.metrics.total_exposure_m, 1, 1e-6, 'total moved by 1m');
    const q = adj.positions.find((x) => x.key === p.key);
    assert(q.src.nominal.table === 'manual' && String(q.src.nominal.original) === String(p.raw.nominal) && q.flags.includes('adjusted'), 'provenance manual with original kept');
    const asset = demo({ adjustments: [{ id: 'y', table: 'assets', key: p.asset_code, field: 'sector', original: 'x', value: 'Test sector', reason: 'r', user: 'u', at: '' }] });
    assert(asset.assets.find((a) => a.code === p.asset_code).attrs.sector === 'Test sector', 'asset attribute adjusted');
    assert(asset.distributions.sector.some((d) => d.label === 'Test sector'), 'distribution reflects adjustment');
  });
  // "Nothing is silently zeroed": structural and data gaps surface as issues / exclusions.
  add('missing required column is fatal with an error issue, not a silent empty result', () => {
    const r = tiny('portfolio_id,holding_id,currency\n1,H1,EUR\n');
    assert(r.fatal && r.positions.length === 0 && r.issues.some((i) => i.severity === 'error' && /Required columns missing/.test(i.message)), 'fatal');
  });
  add('missing FX rate excludes the position instead of zeroing it', () => {
    const r = tiny(H + '1,,H1,A,2026-06-30,CHF,100,100,100,BBB,NR,NR,NR,2020-01-01,2030-01-01,Fixed,3,200,Loan\n');
    assert(r.positions[0].excluded && /CHF/.test(r.positions[0].exclusionReason) && r.stats.included === 0, 'excluded');
  });
  add('output records and position records export one row per asset / position with investor columns', () => {
    const r = demo();
    const out = AUM.outputRecords(r), pos = AUM.positionRecords(r);
    assert(out.length === r.rows.length && pos.length === r.positions.length, 'counts');
    assert(Object.keys(out[0]).some((k) => k.startsWith('nominal_m: ')), 'investor columns present');
    close(out.reduce((s, o) => s + o.exposure_m, 0), r.metrics.total_exposure_m, 1e-6, 'export reconciles');
  });
  add('summarise on a filtered subset reconciles with the full result', () => {
    const r = demo();
    const sectors = r.distributions.sector.map((d) => d.label);
    let total = 0;
    for (const s of sectors) total += AUM.summarise(r.rows.filter((x) => x.sector === s), r.ratingScale, r.config).metrics.total_exposure_m;
    close(total, r.metrics.total_exposure_m, 1e-6, 'Σ sector subsets');
  });

  /** Run every registered case in order (async cases are awaited); returns [{ name, ok, error?, ms }] and never throws. */
  T.run = async function () {
    const results = [];
    for (const c of T.cases) { const t0 = Date.now(); try { await c.fn(); results.push({ name: c.name, ok: true, ms: Date.now() - t0 }); } catch (e) { results.push({ name: c.name, ok: false, error: e.message, ms: Date.now() - t0 }); } }
    return results;
  };
})(typeof window !== 'undefined' ? window : globalThis);
