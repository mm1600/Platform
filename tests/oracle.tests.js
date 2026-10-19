/* Scope oracle test — a small synthetic book whose every figure is computed by hand below, checked through every layer:
 * calculation, Output sheet, dataset / pivot, look-through, concentration, custom sheets and both decks. Runs in the
 * browser (tests/index.html) and Node (node tests/run-node.js). Loads after report.tests.js. */
(function (global) {
  'use strict';
  const Scope = global.Scope, AUM = Scope.calc.aum;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const colIndex = (L) => L.toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const grid = () => []; const put = (g, ref, v) => { const m = ref.match(/^([A-Z]+)(\d+)$/); const r = +m[2] - 1, c = colIndex(m[1]); while (g.length <= r) g.push([]); g[r][c] = v; };
  const putRow = (g, ref, vals) => { const m = ref.match(/^([A-Z]+)(\d+)$/); const c0 = colIndex(m[1]), r = +m[2] - 1; while (g.length <= r) g.push([]); vals.forEach((v, i) => { if (v !== undefined && v !== null && v !== '') g[r][c0 + i] = v; }); };

const FX = { EUR: 1, GBP: 0.86, USD: 1.08 }; // units per EUR
const REP = '2026-06-30';
const INV = [ // id, column name, fund name, group weight
  ['7001', 'Investor A', 'Investor A Mandate', 1], ['7002', 'Investor B', 'Investor B Mandate', '0,5'], ['7003', 'Fund X', 'Fund X', 0.4], ['7004', 'Investor C', 'Investor C Mandate', 0]];
const ASSETS = [ // code, name, codeName, group, sector, subsector, maturity, funding, spread, rating, watch, invBSector
  { id: '100301', name: 'Alpha Wind', cn: 'ALPHA', tg: 'TG-A', sector: 'Renewables', sub: 'Onshore wind', mat: '2031-09-30', fund: '2021-06-30', spread: 250, rating: 'BBB', watch: 'No', bsec: 'ENERGY', country: 'Spain', fixed: 'Fixed', ccy: 'EUR' },
  { id: '100302', name: 'Beta Toll', cn: 'BETA', tg: 'TG-B', sector: 'Transport', sub: 'Toll road', mat: '2028-12-31', fund: '2022-03-31', spread: 200, rating: 'BB', watch: 'Watchlist: No', bsec: 'TRANSPORTATION', country: 'France', fixed: 'Floating', ccy: 'USD' },
  { id: '100303', name: 'Gamma Fibre', cn: 'GAMMA', tg: 'TG-C', sector: 'Digital', sub: 'Fibre', mat: '2035-01-31', fund: '2024-09-30', spread: 180, rating: 'A', watch: 'Yes', bsec: 'TELECOMMUNICATIONS', country: 'Germany', fixed: 'Fixed', ccy: 'EUR' },
  { id: '100304', name: 'Delta Hospital', cn: 'DELTA', tg: 'TG-D', sector: 'Social', sub: 'Hospital', mat: '2033-03-31', fund: '2023-01-31', spread: 220, rating: 'BBB', watch: 'No', bsec: 'SOCIAL', country: 'Italy', fixed: 'Floating', ccy: 'EUR', inactive: true }];
const SEC = { S1: ['100301', 'Alpha Wind Tranche A'], S2: ['100301', 'Alpha Wind Tranche B'], S3: ['100302', 'Beta Toll Loan'], S4: ['100303', 'Gamma Fibre A'], S5: ['100303', 'Gamma Fibre B'], S6: ['100304', 'Delta Hospital Loan'] };
// positions: investor, sec, ccy, nominal, drawn, rate type (as the extract spells it), spread, internal rating
const POS = [
  ['7001', 'S1', 'EUR', 100e6, 80e6, 'Fixed Interest Rate', 250, 'BBB', 'Spain'],
  ['7002', 'S2', 'GBP', 43e6, 43e6, 'EURIBOR 6M', 250, 'BBB', 'Spain'],
  ['7003', 'S1', 'EUR', 20e6, 20e6, 'FIXED', 250, 'BBB', 'Spain'],
  ['7004', 'S3', 'USD', 108e6, 108e6, 'Floating', 200, 'BB', 'France'],
  ['7002', 'S4', 'EUR', 60e6, 60e6, 'Fixed', 180, 'A', 'Germany'],
  ['7003', 'S5', 'EUR', 40e6, 40e6, 'Fixed', 180, 'A', 'Germany'],
  ['7001', 'S6', 'EUR', 30e6, 30e6, 'Variable', 220, 'BBB', 'Italy'],   // asset not in Active Assets
  ['7001', 'S9', 'EUR', 10e6, 10e6, 'Fixed', 300, 'BBB', 'Spain'],      // security not in Mapping
  ['7099', 'S4', 'EUR', 5e6, 5e6, 'Fixed', 180, 'A', 'Germany'],        // investor not in Funding Name
];
// ---------- expected (EUR m) ----------
const E = {
  // the 5m of the unknown investor 7099 counts in the asset total (an error is raised) but in no investor column
  rows: { 'Total platform': { 100301: 170, 100302: 100, 100303: 105 }, Group: { 100301: 133, 100303: 46 }, 'Investor A': { 100301: 100 }, 'Investor A incl. part in funds': { 100301: 105, 100303: 10 },
    'Region R': { 100301: 150, 100303: 60 }, 'Fund X': { 100301: 20, 100303: 40 }, 'Investor C': { 100302: 100 }, 'Investor B': { 100301: 50, 100303: 60 } },
  drawn: { 'Total platform': 355 }, currency: { EUR: 225, USD: 100, GBP: 50 }, ff: { Fixed: 225, Floating: 150 }, sector: { Renewables: 170, Digital: 105, Transport: 100 },
  fixedShare: 225 / 375, subIg: 100 / 375, watch: 105 / 375, wSpread: (170 * 250 + 100 * 200 + 105 * 180) / 375, nPositions: { 'Total platform': 7, 'Investor A': 1 },
  lt: { 'Investor A': { indirect: { 100301: 5, 100303: 10 } } }, bucket: { 100301: '5-10 y', 100303: '5-10 y', 100302: '0-3 y' }, // in the rows' order (largest first)
};

// ---------- sheets ----------
const HH = ['Unique Identifier', 'Investor Code', 'Identification ID', 'Code Name', 'Reporting Date', 'Model Portfolio', 'Portfolio', 'Security ID', 'Security Name', 'Portfolio Name', 'Portfolio Currency',
  'Security Type Name', 'RA_Bullet', 'RA Asset Country Name', 'Underlying Asset Type', 'WAL', 'Quotation Currency', 'FX Rate EC', 'Initial Commitment Amount CCY', 'RA_Commitment QC', 'Current Drawn Amount CCY', 'RA Commitment RC',
  'Purchase Date', 'Maturity Date', 'Parent Issuer Name', 'Rate Type', 'Seniority', 'All-in Spread at Acquisition', 'Internal Current Rating', 'Rating Fitch', 'Rating S&P', "Rating Moody's", 'Financial Close'];
const REFS = [['Reporting Date', 'Reporting Date'], ['Model Portfolio', 'Model Portfolio'], ['Portfolio', 'Portfolio'], ['Security ID', 'Security ID'], ['Security Name', 'Security Name'], ['Portfolio Currency', 'Portfolio Currency'], ['Security Type Name', 'Instrument'], ['RA_Bullet', 'Bullet'],
  ['RA Asset Country Name', 'Country'], ['WAL', 'WAL'], ['Quotation Currency', 'Currency'], ['FX Rate EC', 'FX Rate'], ['Initial Commitment Amount CCY', 'Commitment'], ['RA_Commitment QC', 'Nominal'], ['Current Drawn Amount CCY', 'Drawn'], ['RA Commitment RC', 'Nominal RC'],
  ['Purchase Date', 'Purchase Date'], ['Maturity Date', 'Maturity Date'], ['Parent Issuer Name', 'Parent Issuer'], ['Underlying Asset Type', 'Sector'], ['Rate Type', 'Rate Type'], ['Seniority', 'Seniority'], ['All-in Spread at Acquisition', 'Spread at Acquisition'],
  ['Internal Current Rating', 'Internal Rating'], ['Rating Fitch', 'Fitch'], ['Rating S&P', 'S&P'], ["Rating Moody's", "Moody's"], ['Financial Close', 'Financial Close']];
const REFMAP = new Map(REFS);
const H = grid(); putRow(H, 'B2', HH.map((h) => REFMAP.get(h) || '#N/A')); putRow(H, 'B3', HH);
const byId = Object.fromEntries(ASSETS.map((a) => [a.id, a]));
POS.forEach((p, n) => {
  const [inv, sec, ccy, nom, drawn, rt, spread, rating, country] = p, m = SEC[sec], a = m && byId[m[0]], rate = FX[ccy];
  const row = { 'Unique Identifier': inv + 'x' + sec, 'Investor Code': inv, 'Identification ID': m ? m[0] : '#N/A', 'Code Name': a ? a.cn : '#N/A', 'Reporting Date': REP, 'Model Portfolio': n === 2 ? 'SINGLE' : inv, 'Portfolio': inv, 'Security ID': sec,
    'Security Name': m ? m[1] : 'Orphan Loan', 'Portfolio Name': (INV.find((i) => i[0] === inv) || ['', '', 'Unknown'])[2], 'Portfolio Currency': 'EUR', 'Security Type Name': 'Loan', 'RA_Bullet': 'Bullet', 'RA Asset Country Name': country, 'Underlying Asset Type': a ? a.sector : 'Other', 'WAL': 4.5,
    'Quotation Currency': ccy, 'FX Rate EC': rate, 'Initial Commitment Amount CCY': nom, 'RA_Commitment QC': nom, 'Current Drawn Amount CCY': drawn, 'RA Commitment RC': +(nom / rate).toFixed(2), 'Purchase Date': a ? a.fund : '2021-01-01', 'Maturity Date': a ? a.mat : '2030-01-01',
    'Parent Issuer Name': 'Sponsor ' + (a ? a.cn : 'Z'), 'Rate Type': rt, 'Seniority': 'Senior', 'All-in Spread at Acquisition': spread, 'Internal Current Rating': rating, 'Rating Fitch': rating, 'Rating S&P': '', "Rating Moody's": '', 'Financial Close': a ? a.fund : '' };
  putRow(H, 'B' + (4 + n), HH.map((h) => (row[h] === undefined ? '' : row[h])));
});
putRow(H, 'B' + (4 + POS.length), ['0x0', 0, '#N/A', '#N/A']);
const M = grid();
put(M, 'C2', 'References'); putRow(M, 'C3', ['Columns in Holdings tab', 'Output Names']); REFS.forEach((r, n) => putRow(M, 'C' + (4 + n), r));
put(M, 'H2', 'Active Assets'); putRow(M, 'H3', ['Views (Portfolios / Investors)', 'List', 'Mapping', 'Active Assets Output', 'Selected Assets', 'Number']);
['Total platform', 'Group', 'Region R', 'Investor A incl. part in funds', 'Investor A', 'Investor B', 'Fund X', 'Investor C'].forEach((v, n) => put(M, 'H' + (4 + n), v));
let r = 4; for (const [sec, m] of Object.entries(SEC)) { if (byId[m[0]].inactive) continue; putRow(M, 'I' + r, [m[1], byId[m[0]].cn]); r++; } // UNIQUE(J) = the active assets
ASSETS.filter((a) => !a.inactive).forEach((a, n) => putRow(M, 'K' + (4 + n), [a.cn, '', n + 1]));
put(M, 'Q2', 'Security Mapping'); putRow(M, 'P3', ['', 'Code Name', 'Holdings Name', 'Identification ID', 'Holding ID', 'Transaction Group']);
r = 4; for (const [sec, m] of Object.entries(SEC)) { const a = byId[m[0]]; putRow(M, 'P' + r, [sec, a.cn, a.name, a.id, sec, a.tg]); r++; }
put(M, 'Y2', 'Funding Name'); putRow(M, 'Y3', ['Fund Name', 'Holdings Name', 'Holdings ID']); INV.forEach((i, n) => putRow(M, 'Y' + (4 + n), [i[2], i[1], i[0]]));
put(M, 'AC2', 'Investment Grade Mapping'); putRow(M, 'AC3', ['Rating', 'Score', 'Scale']);
[['AAA', 100], ['AA', 200], ['A', 500], ['BBB+', 590], ['BBB', 600], ['BBB-', 610], ['BB+', 620], ['BB', 650], ['B', 800], ['NR', 0]].forEach((g, n) => putRow(M, 'AC' + (4 + n), [g[0], g[1], 'S&P / Fitch']));
put(M, 'AH2', 'Fund Check'); putRow(M, 'AH3', ['Mapping', 'Holdings', 'Check']); putRow(M, 'AH4', ['Fund X', 'Fund X', 'OK']);
const HC = grid(); const HC3 = ['Security ID', 'Project Name', 'Code Name', 'Chronological Order', 'Subsector', 'Cashflow Type', 'Description', 'Shareholders', 'Origination', 'Funding Date', 'Watchlist', 'Investor B Sector Classification', 'Subsector Classification', 'Investor B Classification', 'Compliance with Financial Covenants'];
putRow(HC, 'C2', HC3.map((h) => (h === 'Project Name' ? 'Project Code' : h))); putRow(HC, 'C3', HC3);
ASSETS.forEach((a, n) => putRow(HC, 'C' + (4 + n), [a.id, a.name, a.cn, n + 1, a.sub, 'Contracted', 'Synthetic ' + a.sub, 'Sponsor ' + a.cn, 'Primary', a.fund, a.watch, a.bsec, 'SUB ' + a.sub.toUpperCase(), 'Core', 'Yes']));
const ES = grid(); const ES3 = ['Security ID', 'Project Name', 'Code Name', 'E Score', 'S Score', 'G Score', 'ESG Score', 'CBI Sector', 'CBI Subsector', 'GHG Scope 1', 'GHG Scope 2'];
putRow(ES, 'C2', ES3); putRow(ES, 'C3', ES3); ASSETS.forEach((a, n) => putRow(ES, 'C' + (4 + n), [a.id, a.name, a.cn, 70, 60, 80, 70, 'Energy', a.sub, 1000 * (n + 1), 500 * (n + 1)]));
const names = ['Group', 'Region R'].concat(INV.map((i) => i[1]));
const OWNROWS = { Group: { 'Investor A': 1, 'Investor B': '0,5', 'Fund X': 0.4 }, 'Region R': { 'Investor A': 1, 'Investor B': 1 }, 'Investor A': { 'Investor A': 1, 'Fund X': '25%' }, 'Investor B': { 'Investor B': 1, 'Fund X': 0.1 }, 'Fund X': { 'Fund X': 1 }, 'Investor C': { 'Investor C': 1 } };
const OWN = [['Owner / owns'].concat(names)]; for (const n of names) OWN.push([n].concat(names.map((c) => ((OWNROWS[n] || {})[c] === undefined ? null : OWNROWS[n][c]))));
  const sheets = { Holdings: { name: 'Holdings', rows: H }, Mapping: { name: 'Mapping', rows: M }, Hardcoded: { name: 'Hardcoded', rows: HC }, 'ESG Hardcoded': { name: 'ESG Hardcoded', rows: ES }, Ownership: { name: 'Ownership', rows: OWN } };

  let cache = null;
  const run = (platform) => AUM.run({ sheets, adjustments: [], platform, currency: 'EUR' });
  const base = () => cache || (cache = run('Total platform'));
  const close = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);
  const dmap = (d) => Object.fromEntries(d.map((x) => [x.label, +x.exposure_m.toFixed(6)]));

  T.add('oracle: every view\'s rows and totals equal the hand-computed book (unknown investor counted in the asset total, inactive asset and orphan security out)', () => {
    const b = base();
    assert(b.issueCounts.error === 2 && b.stats.excluded === 2 && !b.rows.some((x) => x.code === '100304'), 'two errors, two exclusions, no inactive asset: ' + JSON.stringify(b.issueCounts) + ' ' + b.stats.excluded);
    for (const [view, rows] of Object.entries(E.rows)) {
      const res = run(view), got = Object.fromEntries(res.rows.map((x) => [x.code, +x.exposure_m.toFixed(6)]));
      assert(JSON.stringify(got) === JSON.stringify(rows), `${view}: ${JSON.stringify(got)} vs ${JSON.stringify(rows)}`);
      assert(close(res.metrics.total_exposure_m, Object.values(rows).reduce((a, c) => a + c, 0)), view + ' total');
      if (E.nPositions[view] !== undefined) assert(res.metrics.n_positions === E.nPositions[view], `${view} positions ${res.metrics.n_positions}`);
    }
  });
  T.add('oracle: distributions, shares and labels (position-level currency and rate type, Mixed / Multi, buckets, watchlist, decimal-comma weight)', () => {
    const b = base(), D = b.distributions;
    assert(close(b.metrics.total_drawn_m, E.drawn['Total platform']), 'drawn');
    assert(JSON.stringify(dmap(D.currency)) === JSON.stringify(E.currency) && JSON.stringify(dmap(D.fixed_floating)) === JSON.stringify(E.ff) && JSON.stringify(dmap(D.sector)) === JSON.stringify(E.sector), 'splits: ' + JSON.stringify([dmap(D.currency), dmap(D.fixed_floating), dmap(D.sector)]));
    assert(close(b.metrics.fixed_share, E.fixedShare) && close(b.metrics.sub_ig_share, E.subIg, 1e-9) && close(b.metrics.watchlist_share, E.watch, 1e-9) && close(b.metrics.w_margin_bps, E.wSpread), 'shares');
    assert(b.rows.map((x) => x.code + ':' + x.fixed_floating).join() === '100301:Mixed,100303:Fixed,100302:Floating' && b.rows.map((x) => x.currency).join() === 'Multi,EUR,USD', 'asset labels');
    assert(b.rows.map((x) => x.code + ':' + x.maturity_bucket).sort().join() === Object.entries(E.bucket).map(([k, v]) => k + ':' + v).sort().join(), 'buckets');
    assert(b.rows.map((x) => (AUM.onWatchlist(x.watchlist) ? 1 : 0)).join('') === '010', 'watchlist: "Watchlist: No" is off');
    assert(JSON.stringify(AUM.sectorColumns(b)) === JSON.stringify(['Investor B Sector Classification']) && AUM.sectorColumnFor(run('Investor B'), '') === 'Investor B Sector Classification', 'sector column (not the Subsector one), picked for Investor B');
    assert(AUM.withSectorColumn(run('Investor B'), 'Investor B Sector Classification').rows.map((x) => x.sector).join() === 'TELECOMMUNICATIONS,ENERGY', 'Investor B sectors');
  });
  T.add('oracle: Output sheet, dataset, pivot, look-through, concentration, custom sheet and decks all carry the same figures', () => {
    const b = base(), S = Scope;
    const out = AUM.outputRecords(b); assert(out.length === 3 && close(out.reduce((t, o) => t + o.exposure_m, 0), 375), 'Output sheet');
    const ds = S.engine.dataset.build(b), incl = [{ field: 'excluded', op: 'in', value: ['No'] }];
    const pv = S.pivot.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['asset_code'], colDims: [], values: [{ field: 'exposure' }], filters: incl });
    assert(close(pv.grandTotal[0] / 1e6, 375) && pv.rows.filter((x) => x.kind === 'group').map((x) => x.label + '=' + x.rowTotal[0] / 1e6).sort().join() === '100301=170,100302=100,100303=105', 'pivot by asset');
    const pvInv = S.pivot.run({ records: ds.records, fieldById: ds.fieldById, rowDims: ['investor_label'], colDims: [], values: [{ field: 'exposure' }], filters: incl });
    assert(pvInv.rows.filter((x) => x.kind === 'group').map((x) => x.label + '=' + x.rowTotal[0] / 1e6).sort().join() === 'Fund X=60,Investor A=100,Investor B=110,Investor C=100,Unmapped investor 7099=5', 'pivot by investor');
    const LT = S.engine.lookthrough.compute(b, b.fundRegister || []), a = LT.byInvestor.get('Investor A');
    assert(LT.reconciles && a && close(a.perAsset.get('100301').indirect.nominal / 1e6, 5) && close(a.perAsset.get('100303').indirect.nominal / 1e6, 10) && close(a.perAsset.get('100301').direct.nominal / 1e6, 100), 'look-through: Investor A holds 25 % of Fund X');
    const CX = S.concentration || S.cx, M = CX && CX.metrics ? CX.metrics(b) : null;
    if (M) assert(close(M.total, 375) && close(M.floatingShare, 150 / 375, 1e-9) && close(M.fixedShare, 225 / 375, 1e-9) && close(M.nonBaseShare, 150 / 375, 1e-9) && JSON.stringify(M.currencies.map((c) => [c.label, +c.value.toFixed(6)])) === JSON.stringify([['EUR', 225], ['USD', 100], ['GBP', 50]]), 'concentration by position split');
    if (S.sheets) { const sh = S.sheets.build(b, { name: 't', grain: 'assets', columns: [{ id: 'code_name', header: 'X' }, { id: 'exposure', header: 'X' }] }); assert(sh.count === 3 && S.inputs.gridToCsv([sh.headers].concat(sh.values)).split(/\r?\n/)[0] === 'X,X', 'custom sheet keeps two same-heading columns'); }
    if (S.report && S.report.investor) {
      const txt = (d) => d.deck.slides.map((s) => Array.from(s.shapes.join('').matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1])).flat();
      const f = txt(S.report.investor({ res: b, inputs: {} })); assert(['€375m', '217bps', 'ALPHA', 'BETA', 'GAMMA', '170m', '105m', 'Renewables'].every((k) => f.some((x) => x.includes(k))), 'investor deck figures');
      const fb = txt(S.report.investor({ res: AUM.withSectorColumn(run('Investor B'), 'Investor B Sector Classification'), inputs: {} })); assert(fb.some((x) => /ENERGY|TELECOMMUNICATIONS/.test(x)) && !fb.some((x) => /^(Renewables|Digital)$/.test(x)) && fb.some((x) => x.includes('€110m')), 'Investor B deck in its own sectors');
      const q = txt(S.report.quarterly({ res: b })); assert(q.some((x) => /375/.test(x)), 'quarterly deck total');
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
