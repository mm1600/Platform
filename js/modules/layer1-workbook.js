/* Scope · the workbook's Calculations and Output sheets (js/modules/layer1-workbook.js).
 *
 * Two pages that show the calculation the way the workbook does, column for column, so every number can be followed
 * and checked against the sheet:
 *   #/calculations   the Calculations sheet, rows 5 onwards: columns A to JG in the workbook's order, each headed by its
 *                    letters, its row-3 label and its formula (written with names where the workbook uses cell references);
 *                    a second tab holds the per-asset split, Calculations DB to GK.
 *   #/output         the Output sheet for the selected view: the header row in the workbook's order and names.
 * The layouts are the workbook's (Calculations rows 2 to 5 and the Output header row). Nothing is calculated here: every
 * value comes from the AUM result (js/calc/aum.js). Parameters are changed on Data › Formulas, the ownership and the
 * "incl. part in funds" formulas on Data › Setup.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, UI = Scope.ui, h = UI.h, F = U.fmt, store = Scope.store;
  const ic = (name, size) => Scope.icon(name, { size: size || 14 });
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const nk = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const today = () => new Date().toISOString().slice(0, 10);
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const colIndex = (l) => String(l).toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

  // ---------- raw sheet values by the workbook's own labels ----------
  /** Holdings column header for a row-2 output name (what Calculations' MATCH(label, Holdings!2:2) finds), else by header. */
  function holdingsLookup(res) {
    const cols = ((((res.inputs || {}).sheets || {}).Holdings || {}).columns) || [];
    const byOut = new Map(), byHdr = new Map();
    for (const c of cols) { if (c.output && !byOut.has(nk(c.output))) byOut.set(nk(c.output), c.header); if (!byHdr.has(nk(c.header))) byHdr.set(nk(c.header), c.header); }
    return (label) => byOut.get(nk(label)) || byHdr.get(nk(label)) || null;
  }
  const rawOf = (p, header) => (header && p && p.sheet ? (p.sheet[header] === null || p.sheet[header] === undefined ? '' : p.sheet[header]) : '');
  /**
   * The Hardcoded column headers of the loaded workbook, so a column the workbook names after a client ("Jurisdiction
   * Tier - <group>", "<client> Classification") is labelled here exactly as the workbook labels it: hcHeader(res)(part, nth)
   * gives the nth header (row-2 label, else row-3 header) containing `part`, or null when the workbook has none.
   */
  function hcHeader(res) {
    const cols = ((((res.inputs || {}).sheets || {}).Hardcoded || {}).columns) || [];
    return (part, nth, exclude) => { const k = nk(part); const hits = cols.filter((c) => (nk(c.output).includes(k) || nk(c.header).includes(k)) && !(exclude && (nk(c.output).includes(nk(exclude)) || nk(c.header).includes(nk(exclude))))); const hit = hits[nth || 0]; return hit ? (hit.output || hit.header) : null; };
  }
  /** The generic labels of the Hardcoded classification columns, as the workbook names them when it does. */
  function classificationLabels(res) {
    const hh = hcHeader(res), attribution = ((res.config || {}).attribution_label) || 'Group';
    return {
      'Part of Global Strategy': hh('global strategy') || `Part of ${attribution} Global Strategy`,
      'Jurisdiction Tier': hh('jurisdiction') || `Jurisdiction Tier - ${attribution}`,
      Compartment: hh('compartment') || 'Compartment',
      Classification: hh('classification', 0, 'sector') || 'Classification',
      'Sector classification': hh('sector classification') || 'Sector classification',
      'Sector classification (investor)': hh('sector classification', 1) || 'Sector classification (investor)',
      'Country Tier': hh('country tier') || 'Country Tier',
    };
  }
  /** A keyed-sheet value (Hardcoded, ESG Hardcoded) of an asset by its row-2 label or header (what MATCH(label, sheet!2:2) finds). */
  function sheetValue(a, sheet, label) {
    const all = a && a.sheets && a.sheets[sheet]; if (!all) return '';
    const k = nk(label);
    for (const [hd, x] of Object.entries(all)) if (nk(x.label) === k) return x.value === null || x.value === undefined ? '' : x.value;
    for (const [hd, x] of Object.entries(all)) if (nk(hd) === k) return x.value === null || x.value === undefined ? '' : x.value;
    return '';
  }
  const grade = (R, k) => (R ? R[k] : '');

  // The Calculations sheet's row-3 labels of the Holdings lookups, J to CG (76 columns), as printed.
  const HOLDINGS_LABELS = ['Project code', 'Model portfolio code', 'Amount (EUR)', 'Amount nominal (QC)', 'All-in spread (bps)', 'Internal / External', 'Amount (EUR)', 'Infra code', 'Current Maturity', 'Staff Monitoring',
    'Spread', 'Internal Rating', 'Rating Calculation', 'Borrower name', 'Listed / Unlisted', 'Portfolio name', 'Current duration', 'Primary / Secondary', 'Yield', 'Portfolio group code (short)', 'Portfolio currency',
    'Portfolio group code (long)', 'Financial Close', 'Currency', 'Country', 'Country code', 'Bullet / Amortizing', 'Current Maturity', 'Sector', 'Maturity date', 'Format', 'Borrower Name', 'Fixed / Floating', 'Business model',
    'Brownfield / Greenfield', 'Floored', 'Current WAL', 'IG / Sub IG', 'Initial Rating', 'External Rating Fitch', 'External Rating Moodys', 'External Rating S&P',
    'DSCR - 1 year', 'DSCR - 2 year', 'DSCR - 3 months', 'DSCR - 6 months', 'DSCR - 9 months', 'DSCR Lock-up', 'DSCR inception', 'DSCR Covenant', 'DSCR test', 'DSCR trend',
    'ICR - 1 year', 'ICR - 2 year', 'ICR - 3 months', 'ICR - 6 months', 'ICR - 9 months', 'ICR today', 'ICR inception', 'ICR Covenant', 'ICR test', 'ICR trend', 'Latest leverage', 'Leverage covenant', 'Leverage lock-up',
    'LTV - 1 year', 'LTV - 2 year', 'LTV - 3 months', 'LTV - 6 months', 'LTV - 9 months', 'LTV today', 'LTV inception', 'LTV Covenant', 'LTV test', 'LTV trend', 'FMCG monitoring'];
  // Additional AUM Data, HE to ID (26 columns): Hardcoded lookups except HW and ID, which are calculated.
  const HARDCODED_LABELS = ['Chronological order', 'Subsector', 'Cashflow Type', 'Detailed format (1)', 'Detailed format (2)', 'Description', 'Origination', 'Staff Closing', 'Upfront', 'Prepayment protection (1)',
    'Prepayment protection (2)', 'End of NC/MW', 'IC date', 'Funding date', 'Expected COD if greenfield', 'Total debt offering', 'Watchlist', 'End of NC / MW', '% of time protected', 'Jurisdiction Tier',
    'Classification', 'Sector classification', 'TICCS Code', 'Sector classification (investor)', 'Country Tier', 'Maturity at inception'];
  // ESG Data, II to IU (13 columns): ESG Hardcoded lookups except Shareholders, which the workbook reads from Hardcoded.
  const ESG_LABELS = ['E score', 'S score', 'G score', 'ESG score', 'Shareholders', 'CBI sector', 'CBI subsector', 'CBI subsubsector', 'CBI asset type', 'CBI asset specific', 'GHG Scope 1', 'GHG Scope 2', 'GHG Scope 3'];

  // ---------- the Calculations sheet: positions (rows 5 onwards) ----------
  /** Every column A to JG: { letters, label, formula, get, type, group }. */
  function positionColumns(res) {
    const H = holdingsLookup(res), assetByCode = new Map((res.assets || []).map((a) => [a.code, a]));
    const attr = (res.config || {}).attribution_label || 'Group', refInv = (res.inputs && res.inputs.fx && res.inputs.fx.reference) || 'the reference investor', disp = res.displayCurrency || 'EUR';
    const asset = (p) => assetByCode.get(p.asset_code);
    const hl = (label, key) => `=IFNA(INDEX(Holdings!$1:$1048576, MATCH(${key || '$C5'}, Holdings!$B:$B, 0), MATCH("${label}", Holdings!$2:$2, 0)), "")`;
    const hc = (label) => `=IFNA(INDEX(Hardcoded!$1:$1048576, MATCH($D5, Hardcoded!$C:$C, 0), MATCH("${label}", Hardcoded!$2:$2, 0)), "")`;
    const es = (label) => `=IFNA(INDEX('ESG Hardcoded'!$1:$1048576, MATCH($D5, 'ESG Hardcoded'!$C:$C, 0), MATCH("${label}", 'ESG Hardcoded'!$2:$2, 0)), "")`;
    const numLabel = /amount|spread|calculation|yield|duration|wal|dscr|icr|ltv|leverage/i;
    const col = (letters, label, formula, get, opts) => Object.assign({ letters, label, formula, get, type: 'text', group: 'Keys' }, opts || {});
    const out = [
      col('A', 'Portfolio ID', '=Holdings!C4', (p) => p.investor_id),
      col('B', 'Holdings ID', '=Holdings!I4', (p) => p.holding_id),
      col('C', 'Backend identifier', '=A5 & "x" & B5', (p) => p.key),
      col('D', 'Identifier ID', '=XLOOKUP($B5, Mapping!$T:$T, Mapping!$S:$S)', (p) => p.asset_code || '#N/A'),
      col('E', 'Unique identifier', '=A5 & "x" & D5', (p) => (p.asset_code ? p.investor_id + 'x' + p.asset_code : '#N/A')),
      col('F', 'Group ID', '=G5 & D5', (p) => (p.asset_code ? p.investor_label + p.asset_code : '#N/A')),
      col('G', 'Mandate', '=XLOOKUP($K5, Mapping!$Y:$Y, Mapping!$Z:$Z)', (p) => p.investor_label),
      col('H', 'Mandate / Security ID', '=G5 & D5', (p) => (p.asset_code ? p.investor_label + p.asset_code : '#N/A')),
      col('I', '', '(blank)', () => ''),
    ];
    HOLDINGS_LABELS.forEach((label, k) => {
      const letters = colName(colIndex('J') + k);
      let formula = hl(label), get = (p) => rawOf(p, H(label)), type = numLabel.test(label) && !/trend|test|status|covenant$/i.test(label) ? 'number' : 'text';
      if (letters === 'K') { formula = '=IFERROR(XLOOKUP($A5, Mapping!$AA:$AA, Mapping!$Y:$Y), "")'; get = (p) => p.investor_key; type = 'text'; }
      if (letters === 'V') { formula = '=IFNA(XLOOKUP($U5, Mapping!$AC$4:$AC$43, Mapping!$AD$4:$AD$43), 0)'; get = (p) => grade(p.rating, 'internal_numeric'); type = 'number'; }
      if (letters === 'AP') { formula = `=IF(${hl('Fixed / Floating').slice(1)} = "Fixed", "Fixed", "Floating")`; get = (p) => p.fixed_floating; }
      if (letters === 'M') get = (p) => p.nominal;
      if (letters === 'AG') get = (p) => p.currency;
      if (letters === 'AM') { get = (p) => p.maturity_date; type = 'date'; }
      if (letters === 'U') get = (p) => rawOf(p, H(label)) || grade(p.rating, 'internal');
      out.push(col(letters, label, formula, get, { type, group: 'AUM Data (Holdings)' }));
    });
    const fx = (letters, label, formula, get, type) => col(letters, label, formula, get, { type: type || 'text', group: 'Forex / Drawn Amounts' });
    out.push(fx('CH', '', hl('', '$E5') + ' (blank label)', () => ''));
    out.push(fx('CI', 'Currency', hl('Currency'), (p) => p.currency));
    out.push(fx('CJ', '', '=IF(CI5 > 0, "EUR", 0)', (p) => (p.currency ? 'EUR' : 0)));
    out.push(fx('CK', 'Forex', hl('Forex'), (p) => p.fx_input, 'number'));
    out.push(fx('CL', '', `=IF(AND(A5 = <exception code>, CI5 = "GBP", $DI$3 = "<exception view>"), CX5, XLOOKUP($CI5, $CU$5:$CU$10, $CW$5:$CW$10)): the rate of ${refInv}'s first row in CI, or the exception`, (p) => p.fx_rate, 'number'));
    out.push(fx('CM', '', '=G5 & CI5', (p) => p.investor_label + p.currency));
    const dispRate = (((res.inputs || {}).fx || {}).table || []).find((x) => x.currency === res.displayCurrency);
    out.push(fx('CN', '', '=XLOOKUP($CP$3, $CU$5:$CU$10, $CW$5:$CW$10): the rate of the reporting currency', () => (dispRate && isNum(dispRate.perEur) ? dispRate.perEur : 1), 'number'));
    out.push(fx('CO', 'Amount nominal (QC)', hl('Amount nominal (QC)'), (p) => p.nominal, 'number'));
    out.push(fx('CP', `=Output!$G$6 (${disp})`, '=IFERROR(CO5 / $CL5 × CN5, 0)', (p) => p.nominal_base, 'number'));
    out.push(fx('CQ', 'Current drawn amount (QC)', hl('Current drawn amount (QC)'), (p) => p.drawn, 'number'));
    out.push(fx('CR', `=Output!$G$6 (${disp})`, '=IFERROR(CQ5 / $CL5 × CN5, 0)', (p) => p.drawn_base, 'number'));
    out.push(fx('CS', 'Initial commitment (QC)', hl('Initial commitment (QC)'), (p) => p.commitment, 'number'));
    out.push(fx('CT', `=Output!$G$6 (${disp})`, '=IFERROR(CS5 / $CL5 × CN5, 0)', (p) => p.commitment_base, 'number'));
    out.push(fx('CU', '', 'rows 5–10: the currency list (EUR first)', () => ''));
    out.push(fx('CV', 'EUR conversion rates', `rows 5–10: "${refInv}" & currency, the key looked up in CM`, () => ''));
    out.push(fx('CW', '', '=XLOOKUP($CV5, $CM$5:$CM$6590, $CK$5:$CK$6590): the first rate of that key', () => ''));
    out.push(fx('CX', 'FX exception column', '=IFNA(INDEX(Hardcoded!$X:$X, MATCH(Calculations!J5, Hardcoded!$D:$D, 0)), 0)', (p) => { const a = asset(p); const ex = (res.inputs && res.inputs.fxException || []).find((x) => x.column); return ex && a ? sheetValue(a, 'Hardcoded', ex.column) : ''; }, 'number'));
    out.push(fx('CY', 'Drawn amount (reporting currency)', '=IFERROR(CQ5 / $CL5 × CN5, 0)', (p) => p.drawn_base, 'number'));
    out.push(fx('CZ', '', '(blank)', () => ''));
    out.push(fx('DA', '', hl('', '$E5') + ' (blank label)', () => ''));
    const rt = (letters, label, formula, get, type) => col(letters, label, formula, get, { type: type || 'text', group: 'Ratings' });
    out.push(rt('GQ', 'External Rating Fitch', '=AW5', (p) => grade(p.rating, 'fitch')));
    out.push(rt('GR', 'External Rating Moodys', '=AX5', (p) => grade(p.rating, 'moodys')));
    out.push(rt('GS', 'External Rating S&P', '=AY5', (p) => grade(p.rating, 'sp')));
    out.push(rt('GT', 'Fitch calc', '=IFNA(VLOOKUP(GQ5, Mapping!$AC$4:$AD$43, 2, 0), "")', (p) => grade(p.rating, 'fitch_numeric'), 'number'));
    out.push(rt('GU', 'Moodys calc', '=IFNA(VLOOKUP(GR5, Mapping!$AC$4:$AD$43, 2, 0), "")', (p) => grade(p.rating, 'moodys_numeric'), 'number'));
    out.push(rt('GV', 'SP calc', '=IFNA(VLOOKUP(GS5, Mapping!$AC$4:$AD$43, 2, 0), "")', (p) => grade(p.rating, 'sp_numeric'), 'number'));
    out.push(rt('GW', 'External calc', '=MAX(GT5:GV5)', (p) => grade(p.rating, 'external_numeric'), 'number'));
    out.push(rt('GX', 'External rating', '=IF(GW5 > 0, IF(GT5 = GW5, GQ5, IF(GU5 = GW5, GR5, GS5)), "NR")', (p) => grade(p.rating, 'external_grade')));
    out.push(rt('GY', 'Current rating', '=IF(U5 <> "NR", U5, GX5)', (p) => grade(p.rating, 'current_grade')));
    out.push(rt('GZ', 'Internal calc', '=IFNA(VLOOKUP(U5, Mapping!$AC$4:$AD$43, 2, 0), "")', (p) => grade(p.rating, 'internal_numeric'), 'number'));
    out.push(rt('HA', 'Current calc', '=MAX(GZ5, GW5)', (p) => grade(p.rating, 'current_numeric'), 'number'));
    out.push(rt('HB', 'INVGRD', `=IF(HA5 > ${(res.config || {}).ig_threshold}, "SUB IG", "IG") (Scope shows unrated as NR)`, (p) => (p.rating ? (p.rating.status === 'rated' ? p.rating.ig_label : 'NR') : '')));
    const CL = classificationLabels(res);
    HARDCODED_LABELS.forEach((label, k) => {
      const letters = colName(colIndex('HE') + k);
      let formula = hc(label), get = (p) => sheetValue(asset(p), 'Hardcoded', label), type = /order|upfront|offering/i.test(label) ? 'number' : 'text';
      if (letters === 'HW') { formula = '=IF(HV5 > 0, (HV5 − HR5) / (AM5 − HR5), "")'; get = (p) => { const a = asset(p); return a && isNum(a.protected_life_fraction) ? a.protected_life_fraction : ''; }; type = 'number'; }
      if (letters === 'ID') { formula = '=IFERROR(YEARFRAC(HR5, AM5), 0)'; get = (p) => { const a = asset(p); return a ? a.initial_tenor : ''; }; type = 'number'; }
      if (/jurisdiction|classification|country tier/i.test(label)) get = (p) => { const a = asset(p); const all = (a && a.sheets && a.sheets.Hardcoded) || {}; const k2 = nk(label.replace(' (investor)', '')); const hit = Object.entries(all).find(([hd, x]) => nk(x.label) === k2 || nk(hd) === k2) || Object.entries(all).find(([hd, x]) => nk(hd).includes(k2) || nk(x.label).includes(k2)); return hit ? (hit[1].value === null ? '' : hit[1].value) : ''; };
      out.push(col(letters, CL[label] || label, formula, get, { type, group: 'Additional AUM Data (Hardcoded)' }));
    });
    ESG_LABELS.forEach((label, k) => {
      const letters = colName(colIndex('II') + k);
      const fromHc = label === 'Shareholders';
      out.push(col(letters, label, fromHc ? hc(label) : es(label), (p) => sheetValue(asset(p), fromHc ? 'Hardcoded' : 'ESG Hardcoded', label), { type: /score|ghg/i.test(label) ? 'number' : 'text', group: 'ESG Data' }));
    });
    const ge = (letters, label, formula, get, type) => col(letters, label, formula, get, { type: type || 'text', group: 'Geography' });
    out.push(ge('IY', 'Group code', '=XLOOKUP($D5, Mapping!$S:$S, Mapping!$U:$U)', (p) => { const a = asset(p); return a ? a.attrs.transaction_group : ''; }));
    out.push(ge('IZ', `${attr} territory`, '=XLOOKUP($A5, Mapping!$AA:$AA, Mapping!$Z:$Z)', (p) => p.investor_label));
    out.push(ge('JA', 'EUR exposure', '=SUM(CP5)', (p) => p.nominal_base, 'number'));
    out.push(ge('JB', 'EUR funded', '=SUM(CR5)', (p) => p.drawn_base, 'number'));
    out.push(ge('JC', 'Country', hl('Country'), (p) => rawOf(p, H('Country'))));
    out.push(ge('JD', 'Sector', hl('Sector'), (p) => rawOf(p, H('Sector'))));
    out.push(ge('JE', 'Subsector', hc('Subsector'), (p) => sheetValue(asset(p), 'Hardcoded', 'Subsector')));
    out.push(ge('JF', '', '(blank)', () => ''));
    out.push(ge('JG', 'Description', hc('Description'), (p) => sheetValue(asset(p), 'Hardcoded', 'Description')));
    out.push(col('—', 'Excluded (Scope)', 'not in the workbook: a row the workbook would zero or break, with its reason (Data › Issues)', (p) => (p.excluded ? p.exclusionReason : ''), { group: 'Scope' }));
    return out;
  }

  // ---------- the Calculations sheet: the per-asset split (DB to GK) ----------
  function assetColumns(res) {
    const attr = (res.config || {}).attribution_label || 'Group', disp = res.displayCurrency || 'EUR';
    const viewsDef = Object.fromEntries((res.inputs && res.inputs.views || []).map((v) => [v.view, v]));
    const lists = (res.platforms || []).filter((p) => viewsDef[p.id] && viewsDef[p.id].def === 'list');
    const order = new Map((res.assets || []).filter((a) => a.inActiveList).map((a, i) => [a.code, i + 1])), outRank = new Map((res.rows || []).map((r) => [r.code, r.rank]));
    const col = (letters, label, formula, get, opts) => Object.assign({ letters, label, formula, get, type: 'number', group: 'Split Calculations AUM' }, opts || {});
    const out = [
      col('DB', '', '=Active_Assets_Unique (the code names of Mapping › Active Assets)', (a) => a.code_name, { type: 'text', group: 'Assets' }),
      col('DC', '', '=IFERROR(XLOOKUP($DB5, Mapping!$Q:$Q, Mapping!$S:$S), "")', (a) => a.code, { type: 'text', group: 'Assets' }),
      col('DD', '', '=FILTER($DB$5:$DB$6590, $DI$5:$DI$6590 > 0): the assets with exposure in the selected view (the Output list)', (a) => ((a.platform[res.platformId] || {}).nominal > 0 ? a.code_name : ''), { type: 'text', group: 'Assets' }),
      col('DE', '', '=IFERROR(XLOOKUP(DD5, $DB$5:$DB$1149, $DF$5:$DF$1149), 0): the listed asset\'s number', (a) => (outRank.has(a.code) ? order.get(a.code) : ''), { group: 'Assets' }),
      col('DF', '', '=IFERROR(IF(NOT(ISBLANK(DB5)), 1, NA()) + DF4, 0): running number', (a) => order.get(a.code) || '', { group: 'Assets' }),
      col('DH', '', '=$K5 & $D5 (position level)', () => '', { type: 'text', group: 'Assets' }),
      col('DI', `=Output!G8 (${res.platform ? res.platform.label : ''})`, '=INDEX($DL5:$EU5,, MATCH(DI$3, Calculations!$DL$2:$EU$2, 0))', (a) => (a.platform[res.platformId] || {}).nominal),
      col('DK', 'Commitment', '=SUMIF($D:$D, $DC5, $CT:$CT)', (a) => a.commitment),
      col('DL', 'Infrastructure debt platform', '=SUMIF($D:$D, $DC5, $CP:$CP)', (a) => a.nominal),
    ];
    for (const label of res.investorColumns || []) out.push(col('DM…EN', label, `=SUMIF($F:$F, "${label}" & $DC5, $CP:$CP)`, (a) => (a.byInvestor.get(label) || {}).nominal || 0, { investor: label }));
    for (const p of lists) if (!p.lookThroughOf) out.push(col('DM…EN', p.id, '= ' + (viewsDef[p.id].formula || ''), (a) => (a.platform[p.id] || {}).nominal || 0));
    out.push(col('EO', attr, `=SUMPRODUCT(DL5:EN5, $DL$3:$EN$3): each column × its ${attr} ownership`, (a) => a.group_nominal));
    for (const p of lists) if (p.lookThroughOf) out.push(col('EQ…ES', p.id, '= ' + (viewsDef[p.id].formula || ''), (a) => (a.platform[p.id] || {}).nominal || 0));
    const dr = { group: 'Split calculations Drawn Amount' };
    out.push(col('FA', `=DI4 (${res.platform ? res.platform.label : ''})`, '=INDEX($FB5:$GK5,, MATCH(DI$3, Calculations!$FB$2:$GK$2, 0))', (a) => (a.platform[res.platformId] || {}).drawn, dr));
    out.push(col('FC', 'Infrastructure debt platform', '=SUMIF($D:$D, $DC5, $CY:$CY)', (a) => a.drawn, dr));
    for (const label of res.investorColumns || []) out.push(col('FD…GE', label, `=SUMIF($F:$F, "${label}" & $DC5, $CY:$CY)`, (a) => (a.byInvestor.get(label) || {}).drawn || 0, Object.assign({ investor: label }, dr)));
    for (const p of lists) if (!p.lookThroughOf) out.push(col('FD…GE', p.id, '= the same formula over the drawn columns', (a) => (a.platform[p.id] || {}).drawn || 0, dr));
    out.push(col('GF', attr, '=SUMPRODUCT(FB5:GE5, $FB$3:$GE$3)', (a) => a.group_drawn, dr));
    for (const p of lists) if (p.lookThroughOf) out.push(col('GH…GJ', p.id + ' draw', '= the same formula over the drawn columns', (a) => (a.platform[p.id] || {}).drawn || 0, dr));
    return out.map((c) => Object.assign(c, { unitLabel: c.type === 'number' ? disp : undefined }));
  }

  // ---------- the Output sheet: the header row in the workbook's order ----------
  function outputColumns(res) {
    const H = holdingsLookup(res), unit = (res.config || {}).unit || 1e6, disp = res.displayCurrency || 'EUR';
    const viewsDef = Object.fromEntries((res.inputs && res.inputs.views || []).map((v) => [v.view, v]));
    const lts = (res.platforms || []).filter((p) => viewsDef[p.id] && viewsDef[p.id].def === 'list' && p.lookThroughOf);
    const first = (r) => (r.asset && r.asset.positions && r.asset.positions[0]) || null;
    const hv = (label) => (r) => rawOf(first(r), H(label));
    const hcv = (label) => (r) => sheetValue(r.asset, 'Hardcoded', label);
    const esv = (label) => (r) => sheetValue(r.asset, 'ESG Hardcoded', label);
    const anyHc = (part) => (r) => { const all = (r.asset.sheets || {}).Hardcoded || {}; const k = nk(part); const hit = Object.entries(all).find(([hd, x]) => nk(x.label).includes(k) || nk(hd).includes(k)); return hit ? (hit[1].value === null ? '' : hit[1].value) : ''; };
    const col = (label, get, opts) => Object.assign({ label, get, type: 'text', group: 'Output' }, opts || {});
    const m = (source) => ({ type: 'number', unitLabel: `${disp} m`, source });
    const R = (r, k) => (r.asset && r.asset.rating ? r.asset.rating[k] : '');
    const out = [
      col('Code name', (r) => r.code_name, { source: 'Scope: the asset (Calculations DD)' }),
      col('Project name', (r) => r.name, { source: 'Scope: Mapping › Security Mapping R' }),
      col('Selection exposure', (r) => r.exposure_m, m('Calculations DI ÷ 1,000,000')),
      col('Selection exposure - drawn', (r) => r.drawn_m, m('Calculations FA ÷ 1,000,000')),
      col('IC date', (r) => r.asset.attrs.ic_date, { type: 'date', source: 'Calculations HQ' }),
      col('Chronological order', (r) => r.asset.attrs.chronological_order, { type: 'number', source: 'Calculations HE' }),
      col('Country Code', hv('Country code'), { source: 'Calculations AI' }),
      col('Jurisdiction Tier', anyHc('jurisdiction'), { source: 'Calculations HX' }),
      col('Sector', hv('Sector'), { source: 'Calculations AL' }), col('Subsector', hcv('Subsector'), { source: 'Calculations HF' }), col('Cashflow Type', hcv('Cashflow Type'), { source: 'Calculations HG' }),
      col('Brownfield / Greenfield', hv('Brownfield / Greenfield'), { source: 'Calculations AR' }), col('Primary / Secondary', hv('Primary / Secondary'), { source: 'Calculations AA' }),
      col('Currency', (r) => r.currency, { source: 'Calculations AG' }), col('Bullet / Amortizing', hv('Bullet / Amortizing'), { source: 'Calculations AJ' }), col('Maturity date', (r) => r.maturity_date, { type: 'date', source: 'Calculations AM' }),
      col('Fixed / Floating', (r) => r.fixed_floating, { source: 'Calculations AP' }), col('Description', hcv('Description'), { source: 'Calculations HJ' }), col('Listed / Unlisted', hv('Listed / Unlisted'), { source: 'Calculations X' }),
      col('Format', hv('Format'), { source: 'Calculations AN' }), col('Shareholders', hcv('Shareholders'), { source: 'Calculations IM' }), col('Origination', hcv('Origination'), { source: 'Calculations HK' }),
      col('Staff Closing', hcv('Staff Closing'), { source: 'Calculations HL' }), col('Staff Monitoring', hv('Staff Monitoring'), { source: 'Calculations S' }), col('FMCG monitoring', hv('FMCG monitoring'), { source: 'Calculations CG' }),
      col('Infra code', hv('Infra code'), { source: 'Calculations Q' }), col('Project code', hv('Project code'), { source: 'Calculations J' }), col('Borrower Name', hv('Borrower Name'), { source: 'Calculations AO' }),
      col('Infrastructure debt platform', (r) => r.total_nominal_m, m('Calculations DL')),
      col('Initial commitment (QC)', (r) => r.total_commitment_m, m('Calculations DK')),
    ];
    for (const label of res.investorColumns || []) out.push(col(label, (r) => r.investors[label] || 0, Object.assign(m('Calculations DM:EN'), { investor: label })));
    for (const label of res.investorColumns || []) out.push(col(label + ' (drawn)', (r) => r.investors_drawn[label] || 0, Object.assign(m('Calculations FD:GE'), { investor: label, group: 'Drawn' })));
    for (const p of lts) out.push(col(p.id.replace(/\s*incl.*$/i, '') + ' draw', (r) => ((r.asset.platform[p.id] || {}).drawn || 0) / unit, Object.assign(m('Calculations GH:GJ · ' + (viewsDef[p.id].formula || '')), { group: 'Drawn' })));
    const T = { group: 'Terms' };
    out.push(col('All-in spread (bps)', hv('All-in spread (bps)'), Object.assign({ type: 'number', source: 'Calculations N' }, T)), col('Spread', hv('Spread'), Object.assign({ source: 'Calculations T' }, T)),
      col('Upfront', hcv('Upfront'), Object.assign({ type: 'number', source: 'Calculations HM' }, T)), col('Floored', hv('Floored'), Object.assign({ source: 'Calculations AS' }, T)), col('Yield', hv('Yield'), Object.assign({ type: 'number', source: 'Calculations AB' }, T)),
      col('Prepayment protection (1)', hcv('Prepayment protection (1)'), Object.assign({ source: 'Calculations HN' }, T)), col('Prepayment protection (2)', hcv('Prepayment protection (2)'), Object.assign({ source: 'Calculations HO' }, T)),
      col('End of NC / MW', (r) => hcv('End of NC / MW')(r) || hcv('End of NC/MW')(r), Object.assign({ source: 'Calculations HV' }, T)), col('% of time protected', (r) => (isNum(r.asset.protected_life_fraction) ? r.asset.protected_life_fraction : ''), Object.assign({ type: 'number', decimals: 4, source: 'Calculations HW' }, T)),
      col('Current Maturity', hv('Current Maturity'), Object.assign({ source: 'Calculations R' }, T)), col('Maturity at inception', (r) => r.initial_tenor, Object.assign({ type: 'number', decimals: 2, source: 'Calculations ID' }, T)),
      col('Current WAL', hv('Current WAL'), Object.assign({ type: 'number', source: 'Calculations AT' }, T)), col('Current duration', hv('Current duration'), Object.assign({ type: 'number', source: 'Calculations Z' }, T)),
      col('IC date', (r) => r.asset.attrs.ic_date, Object.assign({ type: 'date', source: 'Calculations HQ' }, T)), col('Financial Close', hv('Financial Close'), Object.assign({ source: 'Calculations AF' }, T)),
      col('Funding date', (r) => r.funding_date, Object.assign({ type: 'date', source: 'Calculations HR' }, T)), col('Expected COD if greenfield', hcv('Expected COD if greenfield'), Object.assign({ source: 'Calculations HS' }, T)),
      col('Total debt offering', (r) => r.asset.attrs.total_transaction_size, Object.assign({ type: 'number', source: 'Calculations HT' }, T)));
    const G = { group: 'Ratings' };
    out.push(col('Current rating', (r) => r.rating, Object.assign({ source: 'Calculations GY' }, G)), col('Current calc', (r) => r.rating_numeric, Object.assign({ type: 'number', source: 'Calculations HA' }, G)),
      col('Internal rating', (r) => r.internal_grade, Object.assign({ source: 'Calculations U' }, G)), col('Internal calc', (r) => R(r, 'internal_numeric'), Object.assign({ type: 'number', source: 'Calculations GZ' }, G)),
      col('External rating', (r) => r.external_grade, Object.assign({ source: 'Calculations GX' }, G)), col('External calc', (r) => R(r, 'external_numeric'), Object.assign({ type: 'number', source: 'Calculations GW' }, G)),
      col('External Rating Fitch', (r) => R(r, 'fitch'), Object.assign({ source: 'Calculations GQ' }, G)), col('External Rating Moodys', (r) => R(r, 'moodys'), Object.assign({ source: 'Calculations GR' }, G)), col('External Rating S&P', (r) => R(r, 'sp'), Object.assign({ source: 'Calculations GS' }, G)),
      col('INVGRD', (r) => r.ig_label, Object.assign({ source: 'Calculations HB' }, G)), col('Initial Rating', hv('Initial Rating'), Object.assign({ source: 'Calculations AV' }, G)),
      col('Watchlist', hcv('Watchlist'), Object.assign({ source: 'Calculations HU' }, G)));
    const C = { group: 'Covenants' };
    // the Output lists the covenant columns in the Calculations order except that Leverage lock-up comes before Leverage covenant
    const covenantLabels = HOLDINGS_LABELS.slice(HOLDINGS_LABELS.indexOf('DSCR - 1 year'), HOLDINGS_LABELS.indexOf('LTV trend') + 1);
    const li = covenantLabels.indexOf('Leverage covenant'); if (li >= 0 && covenantLabels[li + 1] === 'Leverage lock-up') { covenantLabels[li] = 'Leverage lock-up'; covenantLabels[li + 1] = 'Leverage covenant'; }
    for (const label of covenantLabels) out.push(col(label, hv(label), Object.assign({ source: 'Calculations AZ:CF', exists: !!H(label) }, C)));
    const X = { group: 'Classification' }, CL = classificationLabels(res);
    out.push(col(CL['Part of Global Strategy'], anyHc('global strategy'), Object.assign({ source: 'Hardcoded' }, X)), col(CL['Jurisdiction Tier'], anyHc('jurisdiction'), Object.assign({ source: 'Calculations HX' }, X)),
      col('STEC', anyHc('stec'), Object.assign({ source: 'Hardcoded' }, X)), col('Spread / STEC', anyHc('spread / stec'), Object.assign({ source: 'Hardcoded' }, X)), col(CL.Compartment, anyHc('compartment'), Object.assign({ source: 'Hardcoded' }, X)),
      col(CL.Classification, (r) => { const all = (r.asset.sheets || {}).Hardcoded || {}; const hit = Object.entries(all).find(([hd, x]) => /classification$/i.test(hd) && !/sector/i.test(hd)); return hit ? (hit[1].value === null ? '' : hit[1].value) : ''; }, Object.assign({ source: 'Calculations HY' }, X)),
      col(CL['Sector classification'], (r) => { const all = (r.asset.sheets || {}).Hardcoded || {}; const hit = Object.entries(all).find(([hd]) => /sector classification/i.test(hd)); return hit ? (hit[1].value === null ? '' : hit[1].value) : ''; }, Object.assign({ source: 'Calculations HZ' }, X)),
      col('TICCS Code', anyHc('ticcs code'), Object.assign({ source: 'Calculations IA' }, X)), col('TICCS Sector', anyHc('ticcs sector'), Object.assign({ source: 'Hardcoded' }, X)), col('TICCS Subsector', anyHc('ticcs subsector'), Object.assign({ source: 'Hardcoded' }, X)),
      col(CL['Sector classification (investor)'], (r) => { const all = (r.asset.sheets || {}).Hardcoded || {}; const hits = Object.entries(all).filter(([hd]) => /sector classification/i.test(hd)); return hits.length > 1 ? (hits[1][1].value === null ? '' : hits[1][1].value) : ''; }, Object.assign({ source: 'Calculations IB' }, X)),
      col(CL['Country Tier'], anyHc('country tier'), Object.assign({ source: 'Calculations IC' }, X)));
    return out;
  }

  // ---------- rendering ----------
  function gridColumn(c, i, millions) {
    const key = 'c' + i;
    const col = { key, label: c.label || (c.letters ? '(' + c.letters + ')' : ''), type: c.type || 'text', group: c.group || '', title: `${c.letters ? c.letters + ' · ' : ''}${c.formula || c.source || ''}`, get: c.get, width: c.type === 'number' ? 112 : 140 };
    // amounts in millions with one decimal; otherwise integers as such and rates, fractions, ratios with up to four decimals
    if (c.type === 'number') col.format = (v) => (isNum(v) ? (c.decimals !== undefined ? v.toFixed(c.decimals) : millions ? F.n1(v) : Number.isInteger(v) ? F.int(v) : Math.abs(v) >= 1000 ? F.n2(v) : String(+v.toFixed(4))) : v === 0 ? '0' : '');
    if (c.type === 'date') col.format = (v) => (v ? F.date(v instanceof Date ? v : U.parseDate(v)) : '');
    if (c.unitLabel) col.unit = c.unitLabel;
    if (c.type === 'number' && c.decimals === undefined) col.total = 'sum';
    return col;
  }
  function formulaStrip(cols, title) {
    return h('details', { class: 'wb-formulas' }, h('summary', {}, ic('file-text'), ` ${title}: ${cols.length} columns in the workbook's order, with their letters, row-3 labels and formulas`),
      h('div', { class: 'wb-formula-list' }, cols.map((c) => h('div', { class: 'wb-formula' }, h('span', { class: 'wb-letters' }, c.letters || ''), h('b', {}, c.label || h('span', { class: 'muted' }, '(no label)')), h('code', {}, c.formula || c.source || '')))));
  }
  function downloadSheet(name, cols, rows) {
    const write = Scope.inputs && Scope.inputs.writeXlsx, save = Scope.inputs && Scope.inputs.downloadBytes;
    if (!write || !save) { UI.toast('The workbook writer is not available in this copy of Scope', 'warn'); return; }
    const grid = [cols.map((c) => c.letters || ''), cols.map((c) => c.label), cols.map((c) => c.formula || c.source || '')];
    rows.forEach((r, i) => grid.push(cols.map((c) => { const v = c.get(r, i); return v instanceof Date ? U.isoDate(v) : isNum(v) ? v : v === null || v === undefined || typeof v === 'number' ? null : String(v); })));
    try { save(`${name}-${today()}.xlsx`, write({ [name]: { name, rows: grid } })); UI.toast(`${name}.xlsx downloaded`); } catch (e) { UI.toast(`Could not write the workbook: ${(e && e.message) || e}`, 'warn'); }
  }
  const links = () => h('div', { class: 'wb-links' },
    h('a', { class: 'btn btn-sm', href: Scope.href('data', 'formulas') }, ic('sliders'), 'Parameters (Data › Formulas)'),
    h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'weights') }, ic('edit-2'), 'Ownership and the incl. part in funds formulas (Data › Setup)'));

  Scope.registerModule({
    id: 'calculations', layer: 1, order: 1.2, title: 'Calculations sheet', status: 'built', icon: 'hash',
    render(el, ctx) {
      const res = ctx.result, tab = ctx.params[0] === 'assets' ? 'assets' : 'positions';
      el.appendChild(Scope.app.pageHead({ title: 'Calculations · ' + (tab === 'assets' ? 'assets split (DB to GK)' : 'positions (rows 5 onwards)'),
        sub: 'the workbook\'s Calculations sheet as Scope computes it: columns in the workbook\'s order, each headed by its letters, row-3 label and formula',
        actions: h('div', { class: 'chips' }, UI.chip('Positions · A to JG', tab === 'positions', () => Scope.navigate('calculations', 'positions')), UI.chip('Assets split · DB to GK', tab === 'assets', () => Scope.navigate('calculations', 'assets'))) }));
      el.appendChild(links());
      if (tab === 'positions') {
        const cols = positionColumns(res), rows = res.positions || [];
        el.appendChild(formulaStrip(cols, 'Columns'));
        const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, false)), rows, rowKey: 'key', height: '64vh', storageKey: 'wb-calc2', ariaLabel: 'Calculations sheet', exportName: `Calculations-${today()}.csv`, onRow: (r) => { if (r && r.asset_code) Scope.navigate('asset', r.asset_code); } });
        el.appendChild(UI.section({ title: `One row per Holdings row · ${F.int(rows.length)} rows`, subtitle: 'Calculations rows 5 onwards; hover a header for the formula; the last column is Scope\'s: why a row is excluded',
          actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Calculations', cols, rows) }, ic('download'), 'Download as Calculations.xlsx')], body: grid }));
      } else {
        const cols = assetColumns(res), rows = (res.assets || []).filter((a) => a.inActiveList);
        el.appendChild(formulaStrip(cols, 'Columns'));
        const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, false)), rows, rowKey: 'code', height: '64vh', storageKey: 'wb-split2', ariaLabel: 'Calculations asset split', exportName: `Calculations-assets-${today()}.csv`, onRow: (r) => { if (r && r.code) Scope.navigate('asset', r.code); } });
        el.appendChild(UI.section({ title: `One row per active asset · ${F.int(rows.length)} assets · amounts in ${res.displayCurrency}`, subtitle: 'Split Calculations AUM (DB to ES) and Split calculations Drawn Amount (FA to GK)',
          actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Calculations-assets', cols, rows) }, ic('download'), 'Download as .xlsx')], body: grid }));
      }
    },
  });

  Scope.registerModule({
    id: 'output', layer: 1, order: 1.4, title: 'Output sheet', status: 'built', icon: 'columns',
    render(el, ctx) {
      const res = ctx.result, cols = outputColumns(res), rows = res.rows || [];
      el.appendChild(Scope.app.pageHead({ title: 'Output · ' + (res.platform ? res.platform.label : ''), sub: `the workbook's Output sheet for the selected view (Output!G8): ${F.int(rows.length)} assets with exposure, amounts in ${res.displayCurrency} millions, the header row in the workbook's order and names` }));
      el.appendChild(links());
      const missing = cols.filter((c) => c.exists === false).map((c) => c.label);
      if (missing.length) el.appendChild(h('div', { class: 'notice info' }, h('b', {}, 'Blank here: '), missing.join(', '), ' (the workbook reads them from Holdings by their row-2 names, which this Holdings sheet does not carry).'));
      const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, true)), rows, rowKey: 'code', height: '66vh', storageKey: 'wb-output2', ariaLabel: 'Output sheet', exportName: `Output-${(res.platform ? res.platform.label : 'view').replace(/[^\w]+/g, '-')}-${today()}.csv`, onRow: (r) => { if (r && r.code) Scope.navigate('asset', r.code); } });
      el.appendChild(UI.section({ title: 'Output rows', subtitle: 'hover a column header for the Calculations column it comes from; the first two columns name the asset and are Scope\'s',
        actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Output', cols, rows) }, ic('download'), 'Download as Output.xlsx')], body: grid }));
    },
  });
})(window);
