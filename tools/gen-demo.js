#!/usr/bin/env node
/*
 * Scope — synthetic demo dataset generator (zero dependencies).
 * Writes data/demo/*.csv and data/demo.js (embedded copy for file:// use).
 * EVERYTHING here is SYNTHETIC. No real investors, mandates, assets or amounts.
 * Deterministic: same seed → same files.  Run:  node tools/gen-demo.js
 *
 * Produces one CSV per workbook sheet in the shapes documented in data/SCHEMA.md: 48 assets across six
 * sectors, 1–2 tranches each, held by 2–6 of 12 investors, plus the reference tables (mappings,
 * platforms, ratings, FX, config, fund look-through). A handful of deliberate data quirks are injected
 * at the end so the validation page and the engine tests (tests/engine.tests.js) have known issues to
 * find; changing this script changes the expected counts in those tests.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'demo');
fs.mkdirSync(OUT, { recursive: true });

// ---------- deterministic PRNG ----------
/** mulberry32: small fast 32-bit seeded PRNG returning floats in [0, 1). */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260930);
// Random helpers (all draw from the single seeded stream, so call order matters for reproducibility):
// pick an element, uniform float in [a, b), round to a step, weighted choice, ISO date, add (fractional) years by whole months.
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);
const roundTo = (x, step) => Math.round(x / step) * step;
const weighted = (pairs) => { // [[value, weight], ...]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
};
const iso = (d) => d.toISOString().slice(0, 10);
const addYears = (d, y) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + Math.round(y * 12)); return x; };

// ---------- CSV writer ----------
/** Records → CSV text in the given column order (same quoting rules as Scope.csv.serialize, kept local so the tool has no dependencies). */
function csv(rows, headers) {
  // One cell: blank for null / undefined, quoted when it contains a quote, comma or line break.
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return lines.join('\n') + '\n';
}

// ---------- reference data ----------
// mapping_investors.csv: six group entities (fully attributed), two funds (partly attributed through
// group_weight) and four third parties. Row order = the workbook's investor-column order.
const INVESTORS = [
  { investor_id: 94301, investor_key: 'INV01', investor_label: 'Investor 1', investor_group: 'Group entity', group_weight: 1 },
  { investor_id: 94302, investor_key: 'INV02', investor_label: 'Investor 2', investor_group: 'Group entity', group_weight: 1 },
  { investor_id: 94303, investor_key: 'INV03', investor_label: 'Investor 3', investor_group: 'Group entity', group_weight: 1 },
  { investor_id: 94304, investor_key: 'INV04', investor_label: 'Investor 4', investor_group: 'Group entity', group_weight: 1 },
  { investor_id: 94305, investor_key: 'INV05', investor_label: 'Investor 5', investor_group: 'Group entity', group_weight: 1 },
  { investor_id: 94306, investor_key: 'INV06', investor_label: 'Investor 6', investor_group: 'Group entity', group_weight: 1 },
  { investor_id: 94310, investor_key: 'INV07', investor_label: 'Investor 7', investor_group: 'Fund', group_weight: 0.35 },
  { investor_id: 94311, investor_key: 'INV08', investor_label: 'Investor 8', investor_group: 'Fund', group_weight: 0.20 },
  { investor_id: 94320, investor_key: 'INV09', investor_label: 'Investor 9', investor_group: 'Third party', group_weight: 0 },
  { investor_id: 94321, investor_key: 'INV10', investor_label: 'Investor 10', investor_group: 'Third party', group_weight: 0 },
  { investor_id: 94322, investor_key: 'INV11', investor_label: 'Investor 11', investor_group: 'Third party', group_weight: 0 },
  { investor_id: 94323, investor_key: 'INV12', investor_label: 'Investor 12', investor_group: 'Third party', group_weight: 0 },
];

// platform = weighted combination of investor columns (long format)
const PLATFORMS = [
  ['TOTAL', 'Total platform', '*', 1],
  ['GROUP', 'Group (attributed)', 'Investor 1', 1], ['GROUP', 'Group (attributed)', 'Investor 2', 1],
  ['GROUP', 'Group (attributed)', 'Investor 3', 1], ['GROUP', 'Group (attributed)', 'Investor 4', 1],
  ['GROUP', 'Group (attributed)', 'Investor 5', 1], ['GROUP', 'Group (attributed)', 'Investor 6', 1],
  ['GROUP', 'Group (attributed)', 'Investor 7', 0.35], ['GROUP', 'Group (attributed)', 'Investor 8', 0.20],
  ['ALPHA', 'Platform Alpha', 'Investor 1', 1], ['ALPHA', 'Platform Alpha', 'Investor 2', 1],
  ['ALPHA', 'Platform Alpha', 'Investor 3', 1], ['ALPHA', 'Platform Alpha', 'Investor 4', 1],
  ['BETA', 'Platform Beta', 'Investor 5', 1], ['BETA', 'Platform Beta', 'Investor 6', 1], ['BETA', 'Platform Beta', 'Investor 7', 1],
  ['FUND1LT', 'Fund I look-through (35%)', 'Investor 7', 0.35],
  ['TPA', 'Investor 9', 'Investor 9', 1],
  ['TPB', 'Investor 10', 'Investor 10', 1],
  ['TPCD', 'Investors 11+12', 'Investor 11', 1], ['TPCD', 'Investors 11+12', 'Investor 12', 1],
].map(([platform_id, platform_label, investor_label, weight]) => ({ platform_id, platform_label, investor_label, weight }));

// ratings.csv: S&P / Fitch grades double as the internal scale; Moody's grades map notch for notch onto the same
// numerics. Numeric rises as credit weakens; 610 (config ig_threshold) sits between BBB- (600) and BB+ (700).
const RATINGS = [];
const SP = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC'];
const MO = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2'];
const NUM = [100, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 750, 800, 850, 900, 950, 1000, 1050];
SP.forEach((g, i) => { RATINGS.push({ grade: g, numeric: NUM[i], scale: 'SP_FITCH' }); RATINGS.push({ grade: g, numeric: NUM[i], scale: 'INTERNAL' }); });
MO.forEach((g, i) => RATINGS.push({ grade: g, numeric: NUM[i], scale: 'MOODYS' }));
RATINGS.push({ grade: 'NR', numeric: 0, scale: 'ALL' });

// fx.csv: units of currency per 1 EUR; NOK is deliberately absent (see quirk 4 below).
const FX = [
  { currency: 'EUR', rate_per_eur: 1, investor_id: '', platform_id: '', note: 'base currency' },
  { currency: 'GBP', rate_per_eur: 0.855, investor_id: '', platform_id: '', note: '' },
  { currency: 'USD', rate_per_eur: 1.08, investor_id: '', platform_id: '', note: '' },
  { currency: 'AUD', rate_per_eur: 1.63, investor_id: '', platform_id: '', note: '' },
  { currency: 'SEK', rate_per_eur: 11.3, investor_id: '', platform_id: '', note: '' },
  { currency: 'CHF', rate_per_eur: 0.96, investor_id: '', platform_id: '', note: '' },
  { currency: 'GBP', rate_per_eur: 0.86, investor_id: 94305, platform_id: 'BETA', note: 'SYNTHETIC override: hedged rate for one investor on one platform (mirrors the workbook exception)' },
];

// config.csv: engine settings plus illustrative thresholds for planned pages; each row carries an explanatory note.
const CONFIG = [
  ['base_currency', 'EUR', 'All FX rates are quoted as units of currency per 1 EUR'],
  ['ig_threshold', '610', 'Rating numeric strictly above this = SUB IG (workbook rule)'],
  ['rating_selection', 'worst', 'External grade = MAX numeric across Fitch/Moodys/S&P (numeric rises as credit weakens); current = MAX(internal, external) unless internal is NR'],
  ['single_portfolio_token', 'SINGLE', 'When portfolio_id equals this token, use portfolio_alt_id'],
  ['amount_display_unit', '1000000', 'Output amounts are shown in millions'],
  ['maturity_buckets', '0-3,3-5,5-10,10-20,20+', 'Years to maturity from reporting date'],
  ['reporting_date_rule', 'min_as_of', 'Reporting date = MIN(position as_of_date), as in the workbook'],
  ['dataset_label', 'SYNTHETIC DEMO', 'Shown in the UI so demo data is never mistaken for production'],
  ['attribution_label', 'Group', 'Name of the attributed investor group used in every UI label (e.g. "Group attributed", "Group share of book")'],
  ['limit_single_name_pct', '10', 'ILLUSTRATIVE threshold for the concentration page: largest single asset as % of exposure (not a real mandate limit)'],
  ['limit_sponsor_pct', '20', 'ILLUSTRATIVE: largest sponsor as % of exposure'],
  ['limit_sector_pct', '35', 'ILLUSTRATIVE: largest sector as % of exposure'],
  ['limit_country_pct', '30', 'ILLUSTRATIVE: largest country as % of exposure'],
  ['limit_sub_ig_pct', '25', 'ILLUSTRATIVE: sub-investment-grade share of exposure'],
  ['limit_non_base_ccy_pct', '40', 'ILLUSTRATIVE: share of exposure not in the base currency'],
].map(([key, value, note]) => ({ key, value, note }));

// mapping_columns.csv: source-system header → canonical field (the workbook's Mapping C:D renames), with required flags.
const COLUMNS = [
  ['Portfolio', 'portfolio_id', 'Y', 'Investor/portfolio identifier (Holdings col G)'],
  ['Alt Portfolio', 'portfolio_alt_id', 'N', 'Used when Portfolio = SINGLE (Holdings col H)'],
  ['Security ID', 'holding_id', 'Y', 'Holding identifier (Holdings col I)'],
  ['Security Name', 'security_name', 'N', 'Holdings col J'],
  ['Position Date', 'as_of_date', 'Y', 'Holdings col F'],
  ['Ccy', 'currency', 'Y', ''],
  ['Nominal Amount', 'nominal', 'Y', 'Calculations CO'],
  ['Drawn Amount', 'drawn', 'Y', 'Calculations CQ'],
  ['Commitment Amount', 'commitment', 'N', 'Calculations CS'],
  ['Internal Rating', 'internal_grade', 'N', ''],
  ['Fitch Rating', 'fitch', 'N', ''],
  ['Moodys Rating', 'moodys', 'N', ''],
  ['S&P Rating', 'sp', 'N', ''],
  ['Funding Date', 'funding_date', 'N', ''],
  ['Maturity Date', 'maturity_date', 'N', ''],
  ['Rate Type', 'coupon_type', 'N', 'Fixed → Fixed, anything else → Floating'],
  ['Coupon Rate', 'coupon', 'N', 'percent'],
  ['Margin Bps', 'margin_bps', 'N', ''],
  ['Instrument', 'instrument_type', 'N', ''],
].map(([source_header, canonical_field, required, note]) => ({ source_header, canonical_field, required, note }));

// ---------- assets ----------
// Sector → subsectors, country → local currency, and name pools for sponsors and asset names (all fictional).
const SECTORS = {
  'Renewables': ['Onshore wind', 'Offshore wind', 'Solar PV', 'Hydro'],
  'Transport': ['Toll roads', 'Airports', 'Ports', 'Rail rolling stock'],
  'Digital': ['Fibre networks', 'Data centres', 'Telecom towers'],
  'Utilities': ['Electricity networks', 'Water', 'Gas distribution'],
  'Energy transition': ['District heating', 'Battery storage', 'EV charging'],
  'Social': ['Hospitals (PPP)', 'Education (PPP)', 'Student accommodation'],
};
const COUNTRIES = [['United Kingdom', 'GBP'], ['France', 'EUR'], ['Germany', 'EUR'], ['Spain', 'EUR'], ['Netherlands', 'EUR'], ['Italy', 'EUR'], ['Ireland', 'EUR'], ['Sweden', 'SEK'], ['Australia', 'AUD'], ['United States', 'USD'], ['Switzerland', 'CHF'], ['Belgium', 'EUR'], ['Portugal', 'EUR'], ['Finland', 'EUR']];
const SPONSORS = ['Northwind Capital', 'Meridian Infrastructure', 'Helios Partners', 'Atlas Core Funds', 'Boreal Energy', 'Silverline Transport', 'Corvus Digital', 'Aquila Utilities', 'Terra Social Infra', 'Lumen Grid'];
const NAMES1 = ['Aurora', 'Beacon', 'Cascade', 'Delta', 'Ember', 'Falcon', 'Granite', 'Harbour', 'Iris', 'Juniper', 'Kestrel', 'Lumen', 'Meridian', 'Nimbus', 'Orion', 'Pioneer', 'Quartz', 'Ridge', 'Summit', 'Tidal', 'Umbra', 'Vertex', 'Willow', 'Zenith', 'Alder', 'Birch', 'Cobalt', 'Dune', 'Echo', 'Fjord', 'Glacier', 'Horizon', 'Indigo', 'Jade', 'Kite', 'Lantern', 'Mistral', 'Nova', 'Opal', 'Prism', 'Quill', 'Rowan', 'Sable', 'Tundra', 'Ultra', 'Vale', 'Wren', 'Yarrow'];

// Reporting date of the synthetic extract (every position's as_of_date).
const REPORTING = new Date(Date.UTC(2026, 5, 30));
const assets = [];
const mappingAssets = [];
const hardcoded = [];
const esg = [];
const holdingsRows = [];
let holdingSeq = 100200;
let isinSeq = 4400100;

const sectorKeys = Object.keys(SECTORS);
// One iteration per asset: terms, ratings, mapping rows (one per tranche), hardcoded and ESG attributes, then holdings rows.
for (let i = 0; i < 48; i++) {
  const code = 'INF-' + String(i + 1).padStart(3, '0');
  const sector = sectorKeys[i % sectorKeys.length];
  const subsector = pick(SECTORS[sector]);
  const [country, ccy] = pick(COUNTRIES);
  const name = NAMES1[i] + ' ' + subsector.split(' ')[0];
  const greenfield = weighted([['Brownfield', 3], ['Greenfield', 1]]);
  const funding = new Date(Date.UTC(2015 + Math.floor(rnd() * 11), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)));
  let tenor = roundTo(between(5, 28), 0.5);
  // a live book holds no matured assets: push maturity at least ~1.5y past the reporting date
  while (addYears(funding, tenor) < addYears(REPORTING, 1.5)) tenor += 1;
  const maturity = addYears(funding, tenor);
  const rateType = weighted([['Fixed', 1], ['Floating', 1]]);
  const repayment = weighted([['Amortising', 3], ['Bullet', 2]]);
  const instrument = weighted([['Loan', 3], ['Notes', 1]]);
  // Internal grade skewed towards the BBB area; external grades, where present, sit within a notch of it.
  const internalIdx = Math.floor(weighted([[3, 1], [5, 2], [7, 3], [8, 4], [9, 4], [10, 2], [11, 1], [12, 1]]));
  const internalGrade = SP[internalIdx];
  const hasExt = rnd() < 0.55;
  // External grade index: the internal notch, or one notch either side.
  const extIdx = () => Math.max(0, Math.min(SP.length - 1, internalIdx + Math.floor(between(-1, 2))));
  const fitch = hasExt && rnd() < 0.6 ? SP[extIdx()] : 'NR';
  const moodys = hasExt && rnd() < 0.5 ? MO[extIdx()] : 'NR';
  const sp = hasExt && rnd() < 0.5 ? SP[extIdx()] : 'NR';
  // Margin moves ~22 bps per notch relative to BBB+ (wider for weaker grades), so margin and rating correlate as in a real book.
  const spread = roundTo(between(120, 340) + (internalIdx - 7) * 22, 5);
  const coupon = rateType === 'Fixed' ? +(between(2.2, 5.6)).toFixed(3) : '';
  const totalSize = roundTo(between(80, 900), 10) * 1e6; // total transaction size
  const tranches = rnd() < 0.2 ? 2 : 1;
  const protectionEnd = repayment === 'Bullet' && rnd() < 0.5 ? iso(addYears(funding, tenor * 0.4)) : '';
  const watch = weighted([['No', 10], ['Watch', 2], ['Intensive', 1]]);
  const ghgScope12 = Math.round(between(500, 90000));
  const asset = { code, name, sector, subsector, country, ccy, funding, maturity, tenor, rateType, repayment, instrument, internalGrade, fitch, moodys, sp, spread, coupon, totalSize, tranches, greenfield, watch };
  assets.push(asset);

  const holdingIds = [];
  for (let t = 0; t < tranches; t++) {
    const hid = 'H' + (holdingSeq++);
    holdingIds.push(hid);
    mappingAssets.push({ holding_id: hid, asset_code: code, asset_name: name, code_name: NAMES1[i].toUpperCase().slice(0, 4) + String(i + 1).padStart(2, '0'), security_id: 'XS' + (isinSeq++) + (t ? 'B' : 'A'), tranche: tranches > 1 ? 'Tranche ' + String.fromCharCode(65 + t) : '' });
  }
  hardcoded.push({
    asset_code: code, sector, subsector, country, region: ['United Kingdom', 'Ireland'].includes(country) ? 'UK & Ireland' : ['Australia', 'United States'].includes(country) ? 'Rest of world' : 'Continental Europe',
    sponsor: pick(SPONSORS), greenfield_brownfield: greenfield, repayment_type: repayment, cash_flow_type: repayment === 'Bullet' ? 'Bullet' : (rnd() < 0.5 ? 'Sculpted' : 'Annuity'),
    instrument, origination: weighted([['Primary', 4], ['Secondary', 1]]), deal_year: funding.getUTCFullYear(), upfront_fee_bps: roundTo(between(25, 150), 5),
    protection_end_date: protectionEnd, watchlist: watch, deal_lead: pick(['A. Martin', 'B. Okoro', 'C. Dubois', 'D. Schäfer', 'E. Rossi', 'F. Lindqvist']),
    covenant_type: weighted([['DSCR', 5], ['LLCR', 2], ['Leverage', 2]]), lockup_level: (1.05 + rnd() * 0.25).toFixed(2), default_level: (1.0 + rnd() * 0.1).toFixed(2),
    wal_years: roundTo(Math.max(1, tenor * between(0.45, 0.75)), 0.1), total_transaction_size: totalSize,
    description: `${greenfield} ${subsector.toLowerCase()} ${instrument.toLowerCase()} financing in ${country}. SYNTHETIC.`,
  });
  esg.push({
    asset_code: code, esg_score: Math.round(between(45, 92)), cbi_taxonomy: sector === 'Renewables' ? 'Aligned' : weighted([['Aligned', 1], ['Partially aligned', 2], ['Not aligned', 2]]),
    ghg_scope1_t: Math.round(ghgScope12 * 0.6), ghg_scope2_t: Math.round(ghgScope12 * 0.4), ghg_scope3_t: Math.round(ghgScope12 * between(1.5, 6)),
    ghg_intensity_t_per_eurm: Math.round(ghgScope12 / (totalSize / 1e6)), green_loan: sector === 'Renewables' || (sector === 'Energy transition' && rnd() < 0.7) ? 'Y' : 'N',
    sfdr_article: weighted([['Article 8', 3], ['Article 9', 1], ['Article 6', 1]]), data_coverage: weighted([['Reported', 3], ['Estimated', 2]]),
  });

  // positions: 2..6 investors participate; the platform holds 15–55 % of the transaction, split between the chosen
  // investors by random weights and, for two-tranche assets, 60 / 40 between tranches. Greenfield assets are partly drawn.
  const nInv = 2 + Math.floor(rnd() * 5);
  const chosen = [...INVESTORS].sort(() => rnd() - 0.5).slice(0, nInv);
  const platformShare = between(0.15, 0.55); // share of total transaction held by the platform
  const platformAmt = totalSize * platformShare;
  const rawW = chosen.map(() => between(0.5, 2));
  const wSum = rawW.reduce((a, b) => a + b, 0);
  const drawnRatio = greenfield === 'Greenfield' ? between(0.35, 0.8) : between(0.9, 1);
  chosen.forEach((inv, k) => {
    holdingIds.forEach((hid, t) => {
      const share = (rawW[k] / wSum) * (tranches > 1 ? (t === 0 ? 0.6 : 0.4) : 1);
      const nominal = roundTo(platformAmt * share, 1000);
      const drawn = roundTo(nominal * drawnRatio, 1000);
      const commitment = repayment === 'Bullet' && greenfield === 'Greenfield' ? roundTo(nominal * 1.05, 1000) : nominal;
      holdingsRows.push({
        'Portfolio': inv.investor_id, 'Alt Portfolio': '', 'Security ID': hid, 'Security Name': name + (tranches > 1 ? ' ' + String.fromCharCode(65 + t) : ''),
        'Position Date': iso(REPORTING), 'Ccy': ccy, 'Nominal Amount': nominal, 'Drawn Amount': drawn, 'Commitment Amount': commitment,
        'Internal Rating': internalGrade, 'Fitch Rating': fitch, 'Moodys Rating': moodys, 'S&P Rating': sp,
        'Funding Date': iso(funding), 'Maturity Date': iso(maturity), 'Rate Type': rateType, 'Coupon Rate': coupon, 'Margin Bps': spread,
        'Instrument': instrument, 'Custodian': 'CUST-' + (1 + Math.floor(rnd() * 3)), 'Book': 'IDB',
      });
    });
  });
}

// ---------- deliberate data quirks (so validation has something to show) ----------
// 1) SINGLE portfolio token with alt id
holdingsRows[5]['Portfolio'] = 'SINGLE'; holdingsRows[5]['Alt Portfolio'] = 94303;
// 2) two positions whose holding id is not in mapping (the "broken rows" case)
holdingsRows.push({ ...holdingsRows[10], 'Security ID': 'H999001', 'Security Name': 'Unmapped holding 1', 'Nominal Amount': 25000000, 'Drawn Amount': 25000000, 'Commitment Amount': 25000000 });
holdingsRows.push({ ...holdingsRows[11], 'Security ID': 'H999002', 'Security Name': 'Unmapped holding 2', 'Nominal Amount': 18000000, 'Drawn Amount': 18000000, 'Commitment Amount': 18000000 });
// 3) investor not in mapping
holdingsRows.push({ ...holdingsRows[20], 'Portfolio': 99999 });
// 4) currency without FX rate
holdingsRows.push({ ...holdingsRows[30], 'Security ID': mappingAssets[3].holding_id, 'Security Name': mappingAssets[3].asset_name, 'Ccy': 'NOK', 'Portfolio': 94321, 'Nominal Amount': 12000000, 'Drawn Amount': 12000000, 'Commitment Amount': 12000000 });
// 5) drawn > nominal on one row
holdingsRows[40]['Drawn Amount'] = holdingsRows[40]['Nominal Amount'] + 500000;
// 6) rating inconsistency across positions of one asset
holdingsRows[60]['Internal Rating'] = 'BB';
// 7) rating grade string with odd spacing / dash ("BBB –" must normalise to the known grade BBB-)
holdingsRows[70]['Fitch Rating'] = 'BBB –';
// 8) missing maturity date
holdingsRows[80]['Maturity Date'] = '';


// fund look-through: who owns the units of each fund investor column (SYNTHETIC).
// Group-entity holder shares sum to the fund's group_weight so attribution and look-through agree.
const LOOKTHROUGH = [
  ['Investor 7', 'Investor 1', 0.15, 'Group entity units'], ['Investor 7', 'Investor 3', 0.10, 'Group entity units'], ['Investor 7', 'Investor 5', 0.10, 'Group entity units'],
  ['Investor 7', 'Investor 9', 0.25, 'Third-party units'],
  ['Investor 8', 'Investor 2', 0.12, 'Group entity units'], ['Investor 8', 'Investor 6', 0.08, 'Group entity units'],
  ['Investor 8', 'Investor 10', 0.30, 'Third-party units'],
].map(([fund_label, holder_label, share, note]) => ({ fund_label, holder_label, share, note }));

// ---------- write ----------
// Holdings keep the source-system headers (renamed by mapping_columns.csv); extra columns such as Custodian and Book
// are deliberately unmapped so the engine reports them as ignored.
const HOLD_HEADERS = Object.keys(holdingsRows[0]);
const files = {
  'holdings.csv': csv(holdingsRows, HOLD_HEADERS),
  'mapping_columns.csv': csv(COLUMNS, ['source_header', 'canonical_field', 'required', 'note']),
  'mapping_assets.csv': csv(mappingAssets, ['holding_id', 'asset_code', 'asset_name', 'code_name', 'security_id', 'tranche']),
  'mapping_investors.csv': csv(INVESTORS, ['investor_id', 'investor_key', 'investor_label', 'investor_group', 'group_weight']),
  'platforms.csv': csv(PLATFORMS, ['platform_id', 'platform_label', 'investor_label', 'weight']),
  'ratings.csv': csv(RATINGS, ['grade', 'numeric', 'scale']),
  'fx.csv': csv(FX, ['currency', 'rate_per_eur', 'investor_id', 'platform_id', 'note']),
  'hardcoded.csv': csv(hardcoded, Object.keys(hardcoded[0])),
  'esg.csv': csv(esg, Object.keys(esg[0])),
  'config.csv': csv(CONFIG, ['key', 'value', 'note']),
  'fund_lookthrough.csv': csv(LOOKTHROUGH, ['fund_label', 'holder_label', 'share', 'note']),
};
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), text);

// data/demo.js: the same CSV texts as window.SCOPE_DEMO, so the app and tests/index.html work from file:// where fetch is unavailable.
const embedded = '/* AUTO-GENERATED by tools/gen-demo.js — SYNTHETIC demo dataset embedded for file:// use. Do not edit by hand. */\n' +
  'window.SCOPE_DEMO = ' + JSON.stringify(files, null, 0) + ';\n';
fs.writeFileSync(path.join(ROOT, 'data', 'demo.js'), embedded);

console.log('assets', assets.length, '| holdings rows', holdingsRows.length, '| files', Object.keys(files).join(', '));
