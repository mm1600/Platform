#!/usr/bin/env node
/* Scope: synthetic demo workbook generator (zero dependencies).
 *
 *   node tools/gen-demo.js
 *
 * Writes the four AUM input sheets in the same layout as the production workbook:
 *   data/demo/Holdings.csv, Mapping.csv, Hardcoded.csv, ESG Hardcoded.csv   (one CSV per sheet, cell A1 = first CSV cell)
 *   data/demo/Scope-demo.xlsx                                              (the same four sheets as one workbook, if the
 *                                                                           workbook writer in js/inputs/workbook.js exists)
 *   data/demo.js                                                           (the same grids embedded, for opening index.html as a file)
 *
 * Layouts (row 2 = labels used by lookups, row 3 = column headers, data from row 4, columns A–B blank unless stated):
 *   Holdings       headers from column B (B–F are the workbook's formula columns: Mapping, Unique Identifier, Investor Code,
 *                  Identification ID, Code Name); row 2 = XLOOKUP(row-3 header, Mapping!C:D) → output name.
 *   Mapping        six side-by-side tables, title in row 2, headers in row 3: References (C:D), Active Assets (H:M),
 *                  Security Mapping (P helper, Q:U), Funding Name (Y:AA), Investment Grade Mapping (AC:AE), Fund Check (AH:AJ).
 *   Hardcoded      headers from column C, keyed by Security ID; D (Project Name) and E (Code Name) are lookups to Mapping.
 *   ESG Hardcoded  headers from column C, keyed by Security ID.
 *
 * EVERYTHING IS SYNTHETIC: no real investors, mandates, assets, limits or amounts. Deterministic (same seed → same files).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'demo');
fs.mkdirSync(OUT, { recursive: true });

// ---------- deterministic random numbers ----------
/** Mulberry32 PRNG: deterministic floats in [0, 1). */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261001);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);
const roundTo = (x, step) => Math.round(x / step) * step;
/** Weighted choice from [[value, weight], …]. */
const weighted = (pairs) => { const t = pairs.reduce((s, p) => s + p[1], 0); let r = rnd() * t; for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[pairs.length - 1][0]; };
/** Fisher–Yates shuffle with the seeded generator (unbiased and independent of the JS engine's sort). */
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const iso = (d) => d.toISOString().slice(0, 10);
const addYears = (d, y) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + Math.round(y * 12)); return x; };

// ---------- grid helpers (rows[r][c] = Excel row r+1, column c+1) ----------
const colIndex = (letters) => letters.toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
/** Empty grid with `rows` rows. */
const grid = (rows) => Array.from({ length: rows }, () => []);
/** Put a value at an Excel cell reference like "C3". */
function put(g, ref, value) {
  const m = ref.match(/^([A-Z]+)(\d+)$/); const r = +m[2] - 1, c = colIndex(m[1]);
  while (g.length <= r) g.push([]);
  g[r][c] = value;
}
/** Write a list of values across a row starting at a cell. */
function putRow(g, startRef, values) {
  const m = startRef.match(/^([A-Z]+)(\d+)$/); const c0 = colIndex(m[1]); const r = +m[2] - 1;
  while (g.length <= r) g.push([]);
  values.forEach((v, i) => { if (v !== undefined && v !== null && v !== '') g[r][c0 + i] = v; });
}
/** RFC 4180 CSV (CRLF) of a grid; trailing empty cells trimmed per row. */
function toCsv(g) {
  const esc = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const width = Math.max(...g.map((r) => r.length));
  return g.map((r) => { const cells = []; for (let c = 0; c < width; c++) cells.push(esc(r[c])); while (cells.length && cells[cells.length - 1] === '') cells.pop(); return cells.join(','); }).join('\r\n') + '\r\n';
}

// ---------- reference data ----------
const REPORTING = new Date(Date.UTC(2026, 5, 30));
const INVESTORS = [
  // holdings id, holdings name (investor column), fund name, portfolio currency
  [94301, 'Investor 1', 'Investor 1 Portfolio', 'EUR'], [94302, 'Investor 2', 'Investor 2 Portfolio', 'EUR'], [94303, 'Investor 3', 'Investor 3 Portfolio', 'EUR'],
  [94304, 'Investor 4', 'Investor 4 Portfolio', 'CHF'], [94305, 'Investor 5', 'Investor 5 Portfolio', 'GBP'], [94306, 'Investor 6', 'Investor 6 Portfolio', 'EUR'],
  [94310, 'Investor 7', 'Investor 7 Fund', 'EUR'], [94311, 'Investor 8', 'Investor 8 Fund', 'EUR'],
  [94320, 'Investor 9', 'Investor 9 Mandate', 'EUR'], [94321, 'Investor 10', 'Investor 10 Mandate', 'EUR'], [94322, 'Investor 11', 'Investor 11 Mandate', 'EUR'], [94323, 'Investor 12', 'Investor 12 Mandate', 'EUR'],
].map(([id, holdingsName, fundName, ccy]) => ({ id, holdingsName, fundName, ccy }));
// Mapping!H "Views (Portfolios / Investors)": the platform choices (Output!G8). Aggregates are defined in js/calc/aum.js CONFIG.views.
const VIEWS = ['Total platform', 'Group (attributed)', 'Platform Alpha', 'Platform Beta', 'Fund I look-through (35%)', 'Investor 9', 'Investor 10', 'Investors 11+12'];
// FX: units of currency per 1 EUR (the workbook divides amounts by this rate)
const FX = { EUR: 1, GBP: 0.855, USD: 1.08, AUD: 1.63, SEK: 11.3, CHF: 0.96 };
// Investment grade mapping (Mapping!AC:AE): S&P/Fitch and Moody's grades on one numeric scale; higher = weaker; IG ≤ 610
const SP = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC'];
const MO = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2'];
const SCORE = [100, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 750, 800, 850, 900, 950, 1000, 1050];

const SECTORS = {
  Renewables: ['Onshore wind', 'Offshore wind', 'Solar PV', 'Hydro'], Transport: ['Toll roads', 'Airports', 'Ports', 'Rail rolling stock'],
  Digital: ['Fibre networks', 'Data centres', 'Telecom towers'], Utilities: ['Electricity networks', 'Water', 'Gas distribution'],
  'Energy transition': ['District heating', 'Battery storage', 'EV charging'], Social: ['Hospitals (PPP)', 'Education (PPP)', 'Student accommodation'],
};
const COUNTRIES = [['United Kingdom', 'GBP', 'GB'], ['France', 'EUR', 'FR'], ['Germany', 'EUR', 'DE'], ['Spain', 'EUR', 'ES'], ['Netherlands', 'EUR', 'NL'], ['Italy', 'EUR', 'IT'], ['Ireland', 'EUR', 'IE'], ['Sweden', 'SEK', 'SE'], ['Australia', 'AUD', 'AU'], ['United States', 'USD', 'US'], ['Switzerland', 'CHF', 'CH'], ['Belgium', 'EUR', 'BE'], ['Portugal', 'EUR', 'PT'], ['Finland', 'EUR', 'FI']];
const SPONSORS = ['Northwind Capital', 'Meridian Infrastructure', 'Helios Partners', 'Atlas Core Funds', 'Boreal Energy', 'Silverline Transport', 'Corvus Digital', 'Aquila Utilities', 'Terra Social Infra', 'Lumen Grid'];
const STAFF = ['A. Martin', 'B. Okoro', 'C. Dubois', 'D. Schäfer', 'E. Rossi', 'F. Lindqvist'];
const NAMES = ['Aurora', 'Beacon', 'Cascade', 'Delta', 'Ember', 'Falcon', 'Granite', 'Harbour', 'Iris', 'Juniper', 'Kestrel', 'Lumen', 'Meridian', 'Nimbus', 'Orion', 'Pioneer', 'Quartz', 'Ridge', 'Summit', 'Tidal', 'Umbra', 'Vertex', 'Willow', 'Zenith', 'Alder', 'Birch', 'Cobalt', 'Dune', 'Echo', 'Fjord', 'Glacier', 'Horizon', 'Indigo', 'Jade', 'Kite', 'Lantern', 'Mistral', 'Nova', 'Opal', 'Prism', 'Quill', 'Rowan', 'Sable', 'Tundra', 'Ultra', 'Vale', 'Wren', 'Yarrow'];

// ---------- Holdings column headers (row 3 from column B) and their output names (row 2, via Mapping!C:D) ----------
const HOLDINGS_HEADERS = [
  'Mapping', 'Unique Identifier', 'Investor Code', 'Identification ID', 'Code Name', 'Reporting Date', 'Model Portfolio', 'Portfolio', 'Security ID', 'Security Name',
  'Portfolio Name', 'Model Portfolio Name', 'Portfolio Group', 'Current Underlying Amount PC', 'Current Underlying Amount RC', 'Portfolio Currency', 'Security Type Name', 'RA_Bullet',
  'Loan Code', 'Asset Type RA', 'RA Country', 'RA Asset Country Name', 'Underlying Asset Type', 'CRDB Code', 'WAL', 'Quotation Currency', 'FX Rate EC', 'Forex',
  'Initial Commitment Amount CCY', 'Gross Notional PC', 'Gross Notional RC', 'Balance Funded %', 'Balance Book Value PC', 'Balance Nominal/Number', 'Balance Unfunded Amount',
  'RA_Commitment QC', 'Current Drawn Amount CCY', 'Current Drawn Amount PC', 'RA_Referentiel Rate', 'Yield', 'Yield EUR', 'Yield GBP', 'Purchase Price %', 'Clean Price for Weight',
  'Purchase Date', 'Maturity Date', 'Next Coupon Date Format', 'Parent Issuer ID', 'Parent Issuer Name', 'RA_Listed Borrower', 'Issuer Name', 'Issuer', 'Issuer Country', 'Group Name',
  'LEI', 'TAB Status', 'CR Status', 'CR Limit', 'Current NDS', 'Underlying Parent Issuer ID', 'RA Commitment PC', 'RA Commitment RC', 'Rate Type', 'Seniority', 'STEF Level',
  'Modified Duration YTM', 'Time to Maturity', 'RA_Floored', 'Make Whole Case', 'Nature', 'RA Ident', 'FM Controller Infra', 'FMCG Controller', 'Next Rate (Index)',
  'Interest Payment Frequency', 'Basis', 'All-in Spread at Acquisition', 'Spread', 'Next Coupon', 'Index', 'Internal Current Rating', 'Ext Sec Group_Rating_Closing',
  'Rating Fitch', 'Rating S&P', "Rating Moody's", 'Last Compliance Certification Date',
  'ICR Limit', 'ICR Current', 'ICR Day One', 'ICR Status', 'ICR Trend', 'ICR -3m', 'ICR -6m', 'ICR -9m', 'ICR -1y', 'ICR -2y',
  'LLCR Cash Trap', 'LLCR Covenant (RA)', 'LLCR Status', 'LTV -3m', 'LTV -6m', 'LTV -9m', 'LTV -1y', 'LTV -2y', 'LTV Current', 'LTV Day One', 'LTV Limit', 'LTV Status', 'LTV Trend',
  'LEV Cash Trap', 'LEV Limit', 'LEV Status', 'RA_LVG_D1', 'RA_COD_LVG', 'RA_NDRAB_CT', 'RA_COD_NDRAB', 'RA_DSC_D1', 'RA_COD_DSC', 'PLCR Cash Trap',
  'Cash Trap LTV Covenant', 'Cash Trap ICR Covenant', 'Cash Trap DY Covenant', 'NAH Cash Trap', 'NDS Cash Trap', 'GR Cash Trap', 'CR Cash Trap', 'RA_CR_D1', 'RA_ICR_D1',
  'RA_COD_ICR', 'RA_COD_CR', 'PLCR Status', 'PLCR Covenant (RA)', 'DSC Trans', 'DSC Status', 'DSC Limit', 'DSC Cash Trap', 'RA_DC_CT', 'RA_DC_COV', 'DSC Day One',
  'DSC -3m', 'DSC -6m', 'DSC -9m', 'DSC -1y', 'DSC -2y', 'RA_COD_DC', 'DC Status', 'RA_COD_DY', 'DY Trend', 'DY Status', 'DY Limit', 'RA_DY_D1', 'DY -3m', 'DY -6m',
  'DY -9m', 'DY -1y', 'DY -2y', 'GR Status', 'GR Covenant', 'RA_LTV_D1', 'RA_Infra Risk Profile', 'RA_Infra Rating', 'RA_COD_LTV', 'NAH Status', 'NAH Covenants', 'Current NAH',
  'NDS Status', 'NDS Covenant', 'Current FAV', 'Current PLCR (RA)', 'Current LLCR (RA)', 'Revenue -1y', 'Revenue -2y', 'RA EBITDA', 'EBITDA -1y', 'EBITDA -2y',
  'FO_RA_LTV Covenant', 'FO_RA_ICR Covenant', 'FO_RA_Current ICR', 'FO_RA_Current LTV', 'RA Revenue', 'FAV Cash Trap', 'FAV Covenant', 'FAV Status',
];
// Mapping!C:D References: Holdings column → output name used by the calculations (row 2 of Holdings). Unlisted columns show #N/A in row 2.
const REFERENCES = [
  ['Reporting Date', 'Reporting Date'], ['Model Portfolio', 'Model Portfolio'], ['Portfolio', 'Portfolio'], ['Security ID', 'Security ID'], ['Security Name', 'Security Name'],
  ['Portfolio Currency', 'Portfolio Currency'], ['Security Type Name', 'Instrument'], ['RA_Bullet', 'Bullet'], ['RA Asset Country Name', 'Country'], ['WAL', 'WAL'],
  ['Quotation Currency', 'Currency'], ['FX Rate EC', 'FX Rate'], ['Initial Commitment Amount CCY', 'Commitment'], ['RA_Commitment QC', 'Nominal'],
  ['Current Drawn Amount CCY', 'Drawn'], ['RA Commitment RC', 'Nominal RC'], ['Purchase Date', 'Purchase Date'], ['Maturity Date', 'Maturity Date'],
  ['Parent Issuer Name', 'Parent Issuer'], ['Issuer Country', 'Issuer Country'], ['Rate Type', 'Rate Type'], ['Seniority', 'Seniority'], ['Time to Maturity', 'Time to Maturity'],
  ['All-in Spread at Acquisition', 'Spread at Acquisition'], ['Spread', 'Spread'], ['Internal Current Rating', 'Internal Rating'], ['Ext Sec Group_Rating_Closing', 'Closing Rating'],
  ['Rating Fitch', 'Fitch'], ['Rating S&P', 'S&P'], ["Rating Moody's", "Moody's"], ['ICR Current', 'ICR'], ['LTV Current', 'LTV'], ['DSC Status', 'DSCR Status'],
];
const REF_MAP = new Map(REFERENCES);

// ---------- assets ----------
const sectorKeys = Object.keys(SECTORS);
const assets = [];
let secSeq = 100200;
for (let i = 0; i < 48; i++) {
  const sector = sectorKeys[i % sectorKeys.length];
  const subsector = pick(SECTORS[sector]);
  const [country, ccy, iso2] = pick(COUNTRIES);
  const project = NAMES[i] + ' ' + subsector.split(' ')[0];
  const codeName = NAMES[i].toUpperCase().slice(0, 4) + String(i + 1).padStart(2, '0');
  const funding = new Date(Date.UTC(2015 + Math.floor(rnd() * 11), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)));
  let tenor = roundTo(between(5, 28), 0.5);
  while (addYears(funding, tenor) < addYears(REPORTING, 1.5)) tenor += 1; // a live book: nothing has matured
  const maturity = addYears(funding, tenor);
  const rateType = weighted([['Fixed', 1], ['Floating', 1]]);
  const bullet = weighted([['N', 3], ['Y', 2]]);
  const instrument = weighted([['Loan', 3], ['Private Placement Note', 1]]);
  const gi = Math.floor(weighted([[3, 1], [5, 2], [7, 3], [8, 4], [9, 4], [10, 2], [11, 1], [12, 1]]));
  const ext = rnd() < 0.55;
  const extIdx = () => Math.max(0, Math.min(SP.length - 1, gi + Math.floor(between(-1, 2))));
  const tranches = rnd() < 0.2 ? 2 : 1;
  const ids = Array.from({ length: tranches }, () => String(secSeq++));
  assets.push({
    i, sector, subsector, country, ccy, iso2, project, codeName, funding, maturity, tenor, rateType, bullet, instrument,
    internal: SP[gi], fitch: ext && rnd() < 0.6 ? SP[extIdx()] : 'NR', moodys: ext && rnd() < 0.5 ? MO[extIdx()] : 'NR', sp: ext && rnd() < 0.5 ? SP[extIdx()] : 'NR',
    spread: roundTo(between(120, 340) + (gi - 7) * 22, 5), size: roundTo(between(80, 900), 10) * 1e6, ids, identificationId: ids[0],
    transactionGroup: 'TG-' + String(Math.floor(i / 2) + 1).padStart(3, '0'), sponsor: pick(SPONSORS), staff: pick(STAFF),
    watch: weighted([['No', 10], ['Watch', 2], ['Intensive', 1]]), greenfield: weighted([['Brownfield', 3], ['Greenfield', 1]]),
    cashflow: bullet === 'Y' ? 'Bullet' : (rnd() < 0.5 ? 'Sculpted' : 'Annuity'), origination: weighted([['Primary', 4], ['Secondary', 1]]),
    upfrontBps: roundTo(between(25, 150), 5), protectionEnd: bullet === 'Y' && rnd() < 0.5 ? iso(addYears(funding, tenor * 0.4)) : '',
    icDate: iso(addYears(funding, -0.15)), wal: +(Math.max(1, tenor * between(0.45, 0.75))).toFixed(1),
    esg: { e: Math.round(between(40, 95)), s: Math.round(between(40, 95)), g: Math.round(between(45, 95)), ghg: Math.round(between(500, 90000)) },
  });
}

// ---------- positions (one Holdings row per investor × security) ----------
const positions = [];
for (const a of assets) {
  const chosen = shuffle(INVESTORS).slice(0, 2 + Math.floor(rnd() * 5));
  const platformShare = between(0.15, 0.55), drawnRatio = a.greenfield === 'Greenfield' ? between(0.35, 0.8) : between(0.9, 1);
  const w = chosen.map(() => between(0.5, 2)), ws = w.reduce((s, x) => s + x, 0);
  chosen.forEach((inv, k) => a.ids.forEach((sec, t) => {
    const share = (w[k] / ws) * (a.ids.length > 1 ? (t === 0 ? 0.6 : 0.4) : 1);
    const nominal = roundTo(a.size * platformShare * share, 1000);
    positions.push({ a, inv, sec, tranche: t, nominal, drawn: roundTo(nominal * drawnRatio, 1000), commitment: a.bullet === 'Y' && a.greenfield === 'Greenfield' ? roundTo(nominal * 1.05, 1000) : nominal,
      modelPortfolio: String(inv.id), portfolio: String(inv.id), ccy: a.ccy, internal: a.internal, fitch: a.fitch, moodys: a.moodys, sp: a.sp, maturity: iso(a.maturity), securityName: a.project + (a.ids.length > 1 ? ' ' + 'AB'[t] : '') });
  }));
}
// ---------- deliberate data quirks, so the validation pages have something to show ----------
positions[5].modelPortfolio = 'SINGLE'; positions[5].portfolio = '94303';                                                   // SINGLE rule → uses Portfolio
const orphan = (p, sec, name) => Object.assign({}, p, { sec, securityName: name, nominal: 25e6, drawn: 25e6, commitment: 25e6, orphan: true });
positions.push(orphan(positions[10], '999001', 'Unmapped Holding One'));                                                     // security not in Mapping
positions.push(orphan(positions[11], '999002', 'Unmapped Holding Two'));
positions.push(Object.assign({}, positions[20], { modelPortfolio: '99999', portfolio: '99999' }));                             // investor not in Funding Name
positions.push(Object.assign({}, positions[30], { ccy: 'NOK', inv: INVESTORS[9], modelPortfolio: '94321', portfolio: '94321', nominal: 12e6, drawn: 12e6, commitment: 12e6 })); // no FX rate
positions[40].drawn = positions[40].nominal + 500000;                                                                         // drawn > nominal
positions[60].internal = 'BB';                                                                                                // ratings differ within one asset
positions[70].fitch = 'BBB –';                                                                                               // odd spacing / dash in a grade
positions[80].maturity = '';                                                                                                  // missing maturity date
const inactiveAsset = assets[47];                                                                                             // in Holdings but not in Active Assets

// ---------- build the Holdings sheet ----------
const H = grid(3);
putRow(H, 'B2', HOLDINGS_HEADERS.map((hd) => (REF_MAP.has(hd) ? REF_MAP.get(hd) : '#N/A')));
putRow(H, 'B3', HOLDINGS_HEADERS);
const secToAsset = new Map(); assets.forEach((a) => a.ids.forEach((s) => secToAsset.set(s, a)));
positions.forEach((p, n) => {
  const a = p.a, rate = FX[p.ccy];
  const investorCode = p.modelPortfolio === 'SINGLE' ? p.portfolio : p.modelPortfolio;
  const mapped = p.orphan ? null : secToAsset.get(p.sec);
  const icr = +(between(1.2, 3.5)).toFixed(2), ltv = +(between(0.45, 0.85)).toFixed(2), dscr = +(between(1.05, 1.9)).toFixed(2);
  const row = {
    'Mapping': mapped && a !== inactiveAsset ? a.codeName : '#N/A', 'Unique Identifier': investorCode + 'x' + p.sec, 'Investor Code': investorCode,
    'Identification ID': mapped ? mapped.identificationId : '#N/A', 'Code Name': mapped ? mapped.codeName : '#N/A',
    'Reporting Date': iso(REPORTING), 'Model Portfolio': p.modelPortfolio, 'Portfolio': p.portfolio, 'Security ID': p.sec, 'Security Name': p.securityName,
    'Portfolio Name': p.inv.fundName, 'Model Portfolio Name': p.inv.fundName, 'Portfolio Group': 'Infra Debt',
    'Current Underlying Amount PC': p.drawn, 'Current Underlying Amount RC': rate ? +(p.drawn / rate).toFixed(2) : '', 'Portfolio Currency': p.inv.ccy,
    'Security Type Name': a.instrument, 'RA_Bullet': a.bullet, 'Loan Code': 'L' + p.sec, 'Asset Type RA': 'Infrastructure Debt', 'RA Country': a.iso2, 'RA Asset Country Name': a.country,
    'Underlying Asset Type': a.subsector, 'CRDB Code': 'CR' + (1000 + a.i), 'WAL': a.wal, 'Quotation Currency': p.ccy, 'FX Rate EC': rate || '', 'Forex': p.ccy === 'EUR' ? 'N' : 'Y',
    'Initial Commitment Amount CCY': p.commitment, 'Gross Notional PC': p.nominal, 'Gross Notional RC': rate ? +(p.nominal / rate).toFixed(2) : '',
    'Balance Funded %': p.nominal ? +(p.drawn / p.nominal).toFixed(4) : '', 'Balance Book Value PC': p.drawn, 'Balance Nominal/Number': p.drawn, 'Balance Unfunded Amount': p.nominal - p.drawn,
    'RA_Commitment QC': p.nominal, 'Current Drawn Amount CCY': p.drawn, 'Current Drawn Amount PC': p.drawn, 'RA_Referentiel Rate': a.rateType === 'Fixed' ? '' : 'EURIBOR 6M',
    'Yield': +(between(2.5, 6.5)).toFixed(3), 'Yield EUR': +(between(2.5, 6.5)).toFixed(3), 'Yield GBP': +(between(2.5, 6.5)).toFixed(3), 'Purchase Price %': 100, 'Clean Price for Weight': 100,
    'Purchase Date': iso(a.funding), 'Maturity Date': p.maturity, 'Next Coupon Date Format': iso(new Date(Date.UTC(2026, 8, 30))), 'Parent Issuer ID': 'PI' + (2000 + a.i), 'Parent Issuer Name': a.sponsor,
    'RA_Listed Borrower': 'N', 'Issuer Name': a.project + ' Finance Ltd', 'Issuer': a.project + ' Finance', 'Issuer Country': a.country, 'Group Name': a.sponsor, 'LEI': '529900SYNTH' + String(a.i).padStart(9, '0'),
    'RA Commitment PC': p.nominal, 'RA Commitment RC': rate ? +(p.nominal / rate).toFixed(2) : '', 'Rate Type': a.rateType, 'Seniority': 'Senior Secured', 'Modified Duration YTM': +(a.tenor * 0.6).toFixed(2), 'Time to Maturity': +((a.maturity - REPORTING) / (365.25 * 864e5)).toFixed(2),
    'RA_Floored': a.rateType === 'Floating' ? 'Y' : 'N', 'Make Whole Case': a.protectionEnd ? 'Y' : 'N', 'Nature': 'Debt', 'RA Ident': 'RA' + p.sec, 'FM Controller Infra': a.staff, 'FMCG Controller': pick(STAFF),
    'Interest Payment Frequency': pick(['Quarterly', 'Semi-annual']), 'Basis': pick(['ACT/360', '30/360']), 'All-in Spread at Acquisition': a.spread, 'Spread': a.spread, 'Index': a.rateType === 'Fixed' ? '' : 'EURIBOR',
    'Internal Current Rating': p.internal, 'Ext Sec Group_Rating_Closing': a.internal, 'Rating Fitch': p.fitch, 'Rating S&P': p.sp, "Rating Moody's": p.moodys,
    'Last Compliance Certification Date': iso(new Date(Date.UTC(2026, 2, 31))),
    'ICR Limit': 1.2, 'ICR Current': icr, 'ICR Day One': +(icr * 1.05).toFixed(2), 'ICR Status': icr > 1.3 ? 'OK' : 'Watch', 'LTV Current': ltv, 'LTV Limit': 0.85, 'LTV Status': ltv < 0.8 ? 'OK' : 'Watch',
    'DSC Status': dscr > 1.15 ? 'OK' : 'Watch', 'DSC Limit': 1.05, 'DSC Day One': +(dscr * 1.04).toFixed(2), 'Current FAV': '', 'RA EBITDA': Math.round(a.size * between(0.08, 0.14)),
  };
  putRow(H, 'B' + (4 + n), HOLDINGS_HEADERS.map((hd) => (row[hd] === undefined ? '' : row[hd])));
});
// workbook padding: copied formula rows below the data, showing "0x0" placeholders in the formula columns
for (let k = 0; k < 15; k++) putRow(H, 'B' + (4 + positions.length + k), ['#N/A', '0x0', 0, '#N/A', '#N/A']);

// ---------- build the Mapping sheet ----------
const M = grid(3);
put(M, 'C2', 'References'); putRow(M, 'C3', ['Columns in Holdings tab', 'Output Names']);
REFERENCES.forEach((r, n) => putRow(M, 'C' + (4 + n), r));
put(M, 'H2', 'Active Assets'); putRow(M, 'H3', ['Views (Portfolios / Investors)', 'List', 'Mapping', 'Active Assets Output', 'Selected Assets', 'Number']);
VIEWS.forEach((v, n) => put(M, 'H' + (4 + n), v));
const listRows = []; positions.forEach((p) => { if (!p.orphan && p.a !== inactiveAsset && !listRows.some((x) => x[0] === p.securityName)) listRows.push([p.securityName, p.a.codeName]); });
listRows.forEach((r, n) => putRow(M, 'I' + (4 + n), r));
const active = assets.filter((a) => a !== inactiveAsset).map((a) => a.codeName);
// J holds the mapping for every listed security; K lists the active assets (the workbook's UNIQUE of J); the inactive asset is left out of K
active.forEach((c, n) => putRow(M, 'K' + (4 + n), [c, '', n + 1]));
put(M, 'Q2', 'Security Mapping'); putRow(M, 'P3', ['', 'Code Name', 'Holdings Name', 'Identification ID', 'Holding ID', 'Transaction Group']);
let sm = 4; for (const a of assets) for (const s of a.ids) { putRow(M, 'P' + sm, [s, a.codeName, a.project, a.identificationId, s, a.transactionGroup]); sm++; }
put(M, 'Y2', 'Funding Name'); putRow(M, 'Y3', ['Fund Name', 'Holdings Name', 'Holdings ID']);
INVESTORS.forEach((inv, n) => putRow(M, 'Y' + (4 + n), [inv.fundName, inv.holdingsName, inv.id]));
put(M, 'AC2', 'Investment Grade Mapping'); putRow(M, 'AC3', ['Rating', 'Score', 'Scale']);
let ig = 4; SP.forEach((g, n) => { putRow(M, 'AC' + ig++, [g, SCORE[n], 'S&P / Fitch']); }); MO.forEach((g, n) => { putRow(M, 'AC' + ig++, [g, SCORE[n], "Moody's"]); }); putRow(M, 'AC' + ig, ['NR', 0, 'Not rated']);
put(M, 'AH2', 'Fund Check'); putRow(M, 'AH3', ['Mapping', 'Holdings', 'Check']);
INVESTORS.filter((x) => /Fund$/.test(x.fundName)).forEach((inv, n) => putRow(M, 'AH' + (4 + n), [inv.fundName, inv.holdingsName, 'OK']));

// ---------- build the Hardcoded sheet (keyed by Security ID = Identification ID) ----------
const HC_ROW3 = ['Security ID', 'Project Name', 'Code Name', 'Chronological Order', 'Subsector', 'Cashflow Type', 'Description', 'Shareholders', 'Origination', 'Staff Closing',
  'Upfront', 'Prepayment Protection (1)', 'Prepayment Protection (2)', 'End of NC / MW', 'IC Date', 'Funding Date', 'Total Debt Offering', 'Watchlist',
  'Jurisdiction Tier - Investor 1', 'MN Classification', 'MN Sector Classification', 'MN FX for GBP / EUR', 'TICS Code', 'Investor 2 Sector Classification', 'Investor 3 Country Tier',
  'Compliance with Financial Covenants'];
const HC_ROW2 = ['', 'Project Code', '', 'Chronological Order', 'Subsector', 'Cashflow Type', 'Description', 'Shareholders', 'Origination', 'Staff Closing',
  'Upfront', 'Prepayment Protection (1)', 'Prepayment Protection (2)', 'End of NC / MW', 'IC Date', 'Funding Date', 'Total Debt Offering', 'Watchlist',
  'Jurisdiction Tier - Investor 1', 'MN Classification', '', 'MN FX for GBP', 'TICS Code', 'Investor 2 Sector Classification', 'Investor 3 Country Tier',
  'Compliance with Financial Covenants'];
const HC = grid(3); putRow(HC, 'C2', HC_ROW2); putRow(HC, 'C3', HC_ROW3);
assets.slice().sort((x, y) => x.funding - y.funding).forEach((a, n) => {
  putRow(HC, 'C' + (4 + n), [a.identificationId, a.project, a.codeName, n + 1, a.subsector, a.cashflow,
    `${a.greenfield} ${a.subsector.toLowerCase()} ${a.instrument.toLowerCase()} financing in ${a.country}. SYNTHETIC.`, a.sponsor, a.origination, a.staff,
    a.upfrontBps, a.protectionEnd ? 'Make-whole' : 'None', a.protectionEnd ? 'Non-call period' : '', a.protectionEnd, a.icDate, iso(a.funding), a.size, a.watch,
    pick(['Tier 1', 'Tier 2']), pick(['Core', 'Core+']), a.sector, a.ccy === 'GBP' ? 'Hedged' : 'n/a', 'TICS-' + (300 + a.i), a.sector, pick(['Tier 1', 'Tier 2', 'Tier 3']),
    weighted([['Yes', 9], ['Waiver', 1]])]);
});

// ---------- build the ESG Hardcoded sheet ----------
const ESG_ROW3 = ['Security ID', 'Project Name', 'Code Name', 'Infra Code', 'FM Monitoring', 'E Score', 'S Score', 'G Score', 'ESG Score', 'Shareholders', 'CHI Sector', 'CHI Subsector',
  'CHI Subsubsector', 'CHI Asset Type', 'CHI Asset Specific', 'GHG Scope 1', 'GHG Scope 2', 'GHG Scope 3'];
const ESG_ROW2 = ['', 'Project Name', 'Code Name', 'Infra Code', 'Staff Monitoring', 'E Score', 'S Score', 'G Score', 'ESG Score', 'Shareholders', 'CHI Sector', 'CHI Subsector',
  'CHI Subsubsector', 'CHI Asset Type', 'CHI Asset Specific', 'GHG Scope 1', 'GHG Scope 2', 'GHG Scope 3'];
const ES = grid(3); putRow(ES, 'C2', ESG_ROW2); putRow(ES, 'C3', ESG_ROW3);
assets.forEach((a, n) => {
  if (n === 13) return; // one asset without an ESG row
  const esgScore = Math.round((a.esg.e + a.esg.s + a.esg.g) / 3);
  putRow(ES, 'C' + (4 + n - (n > 13 ? 1 : 0)), [a.identificationId, a.project, a.codeName, 'INF' + String(a.i + 1).padStart(3, '0'), a.staff, a.esg.e, a.esg.s, a.esg.g, esgScore, a.sponsor,
    a.sector, a.subsector, a.subsector + ' assets', a.greenfield === 'Greenfield' ? 'Construction' : 'Operational', a.instrument, Math.round(a.esg.ghg * 0.6), Math.round(a.esg.ghg * 0.4), Math.round(a.esg.ghg * between(1.5, 6))]);
});

// ---------- write the files ----------
const SHEETS = { Holdings: H, Mapping: M, Hardcoded: HC, 'ESG Hardcoded': ES };
for (const old of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, old)); // the demo folder holds only the four sheets (and the workbook)
for (const [name, g] of Object.entries(SHEETS)) fs.writeFileSync(path.join(OUT, name + '.csv'), toCsv(g));
const embedded = '/* AUTO-GENERATED by tools/gen-demo.js. SYNTHETIC demo workbook (the four AUM input sheets as cell grids) embedded so the app works when\n'
  + '   index.html is opened as a file. rows[r][c] = Excel row r+1, column c+1. Do not edit by hand: run node tools/gen-demo.js. */\n'
  + 'window.SCOPE_DEMO = ' + JSON.stringify({ label: 'SYNTHETIC DEMO', sheets: Object.fromEntries(Object.entries(SHEETS).map(([k, g]) => [k, { name: k, rows: g.map((r) => Array.from(r, (v) => (v === undefined ? null : v))) }])) }) + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'demo.js'), embedded);
// the same four sheets as one workbook, when the workbook writer is available
try {
  require(path.join(ROOT, 'js', 'core', 'util.js')); require(path.join(ROOT, 'js', 'core', 'csv.js')); require(path.join(ROOT, 'js', 'inputs', 'workbook.js'));
  const inputs = globalThis.Scope && globalThis.Scope.inputs;
  if (inputs && inputs.writeXlsx) {
    const bytes = inputs.writeXlsx(Object.fromEntries(Object.entries(SHEETS).map(([k, g]) => [k, { name: k, rows: g }])));
    fs.writeFileSync(path.join(OUT, 'Scope-demo.xlsx'), Buffer.from(bytes));
  }
} catch (e) { console.log('workbook not written:', e.message); }
console.log(`assets ${assets.length} | holdings rows ${positions.length} (+15 padding) | sheets ${Object.keys(SHEETS).join(', ')} | files: ${fs.readdirSync(OUT).join(', ')}`);
