/* Scope · AUM calculation (the single, auditable calculation file for the AUM coverage task).
 *
 * INPUTS: exactly four sheets of the AUM workbook, as cell grids (rows[r][c] = Excel row r+1, column c+1):
 *   Holdings       position extract; headers in row 3, output names in row 2 (= XLOOKUP(row 3, Mapping!C:D)); formula columns
 *                  B–E = Unique Identifier, Investor Code, Identification ID, Code Name; Security ID in I
 *   Mapping        six tables side by side, title in row 2, headers in row 3: References (C:D), Active Assets (H:M),
 *                  Security Mapping (P helper, Q:U), Funding Name (Y:AA), Investment Grade Mapping (AC:AE), Fund Check (AH:AI…)
 *   Hardcoded      manual deal fields keyed by Security ID (headers in row 3 from column C; lookup labels in row 2)
 *   ESG Hardcoded  ESG scores, taxonomy and GHG keyed by Security ID (same layout)
 *   Scope Settings OPTIONAL fifth sheet: the group's ownership of each investor column (the Output header row) and a formula per view,
 *                  investor types and display names, the FX exception and a few settings (§1b)
 *
 * The sheets may keep their formulas: the reader takes each formula's saved result, and §12 compares the workbook's own
 * formula columns with this file's values (a formula that failed in the workbook, e.g. #REF!, is skipped, not counted).
 *
 * The file reads top to bottom in the same order as the workbook:
 *   §1  Defaults for what the four sheets do not hold (views, investor types and weights, FX exception, thresholds)
 *   §1b The optional Scope Settings sheet, which overrides those defaults per workbook (and is overridden by changes in the app)
 *   §2  Where each input lives: sheet layouts and column roles (matched by header name, so column moves do not break it)
 *   §3  Reading the sheets: locate header rows and the six Mapping tables
 *   §4  Mapping lookups (References, Active Assets, Security Mapping, Funding Name, Investment Grade, Fund Check)
 *   §5  Holdings: the workbook's formula columns B–E recomputed, then one position per row
 *   §6  Ratings branch (internal unless NR, else worst agency; IG ≤ threshold)
 *   §7  FX: one rate per currency from the reference investor's first row (as the workbook) or each row's own rate; amounts ÷ rate
 *   §8  Hardcoded and ESG Hardcoded lookups per asset
 *   §9  Investor columns and attribution weights
 *   §10 Views (the Output!G8 platform choices) = Σ weight × investor column; the fund look-through register derived from the
 *       "<investor> incl. part in funds" views; asset × investor matrices and the Output rows
 *   §11 Portfolio metrics and distributions (exposure-weighted)
 *   §12 Checks: the workbook's own formula columns against this file's results
 *
 * Every number keeps its source cell (e.g. Holdings!AK57) so any figure can be traced back to the workbook.
 * Problems never become silent zeros: they become issues, and a position that cannot be valued is excluded and listed.
 * Pure JavaScript, no DOM: runs in the browser and in Node (tests).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const AUM = ((Scope.calc = Scope.calc || {}).aum = {});
  (Scope.engine = Scope.engine || {}).aum = AUM; // pages refer to Scope.engine.aum

  // =====================================================================================================================
  // §1  SETTINGS THE FOUR SHEETS DO NOT HOLD
  // In the workbook these live inside Calculations / Output formulas (header-row weights, the "incl. part in funds"
  // columns, the hard-coded FX exception). They are collected here so they can be read, reviewed and changed in one place.
  // The Data page can override views, investor types, column roles and the FX quote per browser (shown as overrides).
  // =====================================================================================================================
  const CONFIG = {
    baseCurrency: 'EUR',
    // 'ccy_per_eur': EUR amount = amount ÷ rate (the workbook's formula); 'eur_per_ccy': amount × rate;
    // 'auto': test both against the RC (reference-currency) column and use the one that reproduces it.
    fxQuote: 'auto',
    // 'workbook': every position in a currency is converted with ONE rate, the one on the reference investor's first
    // Holdings row in that currency (Calculations CU:CW); 'position': each row's own rate.
    fxRateSource: 'workbook',
    fxReferenceInvestor: '',          // investor column (Mapping!Z name or display name); blank = the first column of Funding Name
    igThreshold: 610,                 // rating score strictly above this = SUB IG (Mapping!AC:AD scale; higher = weaker)
    singleToken: 'SINGLE',            // Holdings: Model Portfolio = SINGLE → use Portfolio as the investor code
    unit: 1e6,                        // Output amounts in millions
    maturityBuckets: ['0-3', '3-5', '5-10', '10-20', '20+'],
    attributionLabel: 'Group',        // name of the attributed investor group in every label ("Group attributed", …)
    spreadUnit: 'auto',               // 'bps' | 'percent' | 'auto' (values below 20 are read as percent and × 100)
    // ---- The settings below are DEFAULTS. A workbook can carry its own in an optional fifth sheet, "Scope Settings" (§1b),
    // and anything changed on the Data page overrides both. Precedence: changed in the app > Scope Settings sheet > here.
    // Views (Mapping!H, the Output!G8 choices). A view equal to an investor column needs no entry. Others are defined here:
    //   '*' = every investor column · 'group' = Σ attribution weight × column · [[investor, weight], …] or [investor, …] (weight 1)
    //   A view named "<investor> incl. part in funds" also defines the look-through: its fund weights are the investor's
    //   share of each fund's units.
    views: { 'Total platform': '*' },
    // Investor column (Mapping!Z holdings name) → [type, attribution weight] (the workbook's row-3 weights: 1 = group
    // entity, 0 = third party, 0.35 = a fund 35% held by the group). Types: Group entity, Fund, Third party, Mandate.
    investors: {},
    // The workbook's FX exception, as data: positions of `investor` (column name or portfolio code) in `currency` use
    // `rate` (a number) or `column` (the name of a Hardcoded column holding one rate per asset) when `view` is selected.
    fxOverrides: [],
    // Country → region for the region breakdown (countries not listed fall into 'Rest of world').
    regions: {
      'United Kingdom': 'UK & Ireland', Ireland: 'UK & Ireland',
      France: 'Continental Europe', Germany: 'Continental Europe', Spain: 'Continental Europe', Italy: 'Continental Europe', Netherlands: 'Continental Europe',
      Belgium: 'Continental Europe', Portugal: 'Continental Europe', Finland: 'Continental Europe', Sweden: 'Continental Europe', Denmark: 'Continental Europe',
      Norway: 'Continental Europe', Switzerland: 'Continental Europe', Austria: 'Continental Europe', Poland: 'Continental Europe', Luxembourg: 'Continental Europe',
    },
    // ILLUSTRATIVE concentration thresholds for the Concentration page (not mandate limits).
    thresholds: { limit_single_name_pct: 10, limit_sponsor_pct: 20, limit_sector_pct: 35, limit_country_pct: 30, limit_sub_ig_pct: 25, limit_non_base_ccy_pct: 40 },
  };
  AUM.CONFIG = CONFIG;

  // =====================================================================================================================
  // §1b THE OPTIONAL "SCOPE SETTINGS" SHEET
  // Two small tables say what the four sheets cannot: which share of each investor column the group owns (the workbook's
  // Output header row / Calculations row 3), and how each view that is not a plain investor column is built (the
  // workbook's Calculations formulas, written with names instead of column letters):
  //
  //   Investors   Investor column · Type · Display name · Group ownership     one row per column of Mapping › Funding Name (Z)
  //               a group entity → 1, third party or mandate → 0, a fund 45% owned → 0.45 (or 45%, or 9/20)
  //   Views       View · Formula                                                 Region A = Investor 4 + Investor 5
  //                                                                              Investor 1 incl. part in funds = Investor 1 + 1/4 × Fund 1 + 3/20 × Fund 2 + Fund 6
  //               A formula adds investor columns (or other views) with a coefficient: "7/20 × Fund 1", "25% of Fund 1",
  //               "Fund 1 × 0.25" or "(1/4)*Fund 1". A view named "<investor> incl. part in funds" also says who holds
  //               the funds' units: its fund coefficients are that investor's share of each fund (the look-through).
  //   FX Exception  Investor · Currency · View · Rate · Note                    Rate = a number, or a Hardcoded column holding one rate per asset
  //   Settings      Setting · Value                                             Attribution label, IG threshold, FX rate source, …
  //
  // Each table has its title in a cell, headers on the next row and rows until a blank row; tables are found by title, so
  // they may sit side by side or below one another. The older "matrix" form (a Views table with the investor columns
  // across and one row of weights per view, Type and Display name rows) is still read.
  // =====================================================================================================================
  const SETTINGS_SHEET = 'Scope Settings';
  AUM.SETTINGS_SHEET = SETTINGS_SHEET;
  const SETTINGS_TITLES = { investors: ['Investors', 'Investor columns', 'Group ownership', 'Ownership'], views: ['Views', 'Weights', 'View weights', 'Investor weights', 'View formulas'], fxException: ['FX Exception', 'FX Exceptions'], settings: ['Settings'] };
  const SETTINGS_COLS = {
    investors: { column: ['Investor column', 'Investor', 'Holdings Name', 'Column'], type: ['Type', 'Investor type', 'Class'], name: ['Display name', 'Name', 'Shown as'], weight: [/ownership|weight|attribut|share|%/] },
    viewFormulas: { view: ['View'], formula: ['Formula', 'Definition', 'Composition'] },
    fxException: { investor: ['Investor', 'Portfolio', 'Investor or portfolio code', 'Investor code'], currency: ['Currency'], view: ['View'], rate: ['Rate', 'Rate or Hardcoded column'], note: ['Note'] },
    settings: { setting: ['Setting'], value: ['Value'] },
  };
  const SPECIAL_ROWS = { type: ['Type', 'Investor type', 'Class'], name: ['Display name', 'Display names', 'Name', 'Shown as'] };
  const ATTRIBUTION_ROW = ['Group', 'Group weights', 'Group weight', 'Attribution', 'Attribution weights', 'Attributed'];
  AUM.INVESTOR_TYPES = ['Group entity', 'Fund', 'Third party', 'Mandate'];
  // Settings table rows the calculation understands (case and spacing ignored) → CONFIG key and parser.
  const SETTING_KEYS = {
    attributionlabel: ['attributionLabel', (v) => String(v).trim()], igthreshold: ['igThreshold', (v) => U.toNumber(v)], basecurrency: ['baseCurrency', (v) => String(v).trim().toUpperCase()],
    fxquote: ['fxQuote', (v) => { const n = String(v).toLowerCase(); return /auto/.test(n) ? 'auto' : /eur per|×|multiply|eurperccy/.test(n) ? 'eur_per_ccy' : /per eur|÷|divide|ccyper/.test(n) ? 'ccy_per_eur' : null; }],
    fxratesource: ['fxRateSource', (v) => { const n = String(v).toLowerCase(); return /position|own|each|row/.test(n) ? 'position' : /workbook|reference|first|one/.test(n) ? 'workbook' : null; }],
    fxreferenceinvestor: ['fxReferenceInvestor', (v) => String(v).trim()],
    spreadunit: ['spreadUnit', (v) => { const n = String(v).toLowerCase(); return /bp/.test(n) ? 'bps' : /per/.test(n) ? 'percent' : /auto/.test(n) ? 'auto' : null; }],
    singleportfoliotoken: ['singleToken', (v) => String(v).trim()], maturitybuckets: ['maturityBuckets', (v) => String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean)],
  };
  /** Weight or share from a cell: 0.35, "35%", 35 (a whole number above 1 is read as percent), "7/20" or "=7/20"; NaN when not a number. */
  const parseWeight = (v, plain) => {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v > 1 && !plain ? v / 100 : v;
    const t = String(v).trim().replace(/^=\s*/, '');
    const m = t.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/);
    if (m) { const a = +m[1].replace(',', '.'), b = +m[2].replace(',', '.'); return b ? a / b : NaN; }
    const n = U.toNumber(t);
    if (!U.isNum(n)) return NaN;
    return /%$/.test(t) || (n > 1 && !plain) ? n / 100 : n;
  };
  AUM.parseWeight = parseWeight;
  // "<investor> incl. part in funds", "<investor> including funds", "<investor> look-through": the investor (or view) whose
  // look-through the row defines. Everything else in the row is the investor's share of a fund's units.
  const LT_ROW = /^(.+?)\s*(?:[(\-–:]\s*)?(?:(?:incl\.?|including|with)\s+(?:(?:its\s+)?(?:part|share|units?|holdings?)\s+(?:in|of)\s+)?funds?|look[\s-]?through(?:\s+funds?)?)\s*\)?\s*$/i;
  AUM.lookThroughBase = (name) => { const m = String(name || '').match(LT_ROW); return m ? m[1].trim() : null; };
  // A view formula: terms added with "+", each an investor column or another view with an optional coefficient:
  //   "Investor 1 + 1/4 × Fund 1 + 25% of Fund 2 + Fund 6 × 1 + (3/20)*Fund 3"
  const COEF = '\\(?\\s*(-?\\d+(?:[.,]\\d+)?\\s*(?:\\/\\s*\\d+(?:[.,]\\d+)?)?%?)\\s*\\)?';
  const TERM_PRE = new RegExp('^' + COEF + '\\s*(?:[×*]\\s*|x\\s+|of\\s+)(.+)$', 'i'), TERM_POST = new RegExp('^(.+?)\\s*[×*]\\s*' + COEF + '$', 'i');
  /** Parse a view formula into terms [{ name, weight, text }] (text = the coefficient as typed, '' for 1). Returns { terms, error }. */
  AUM.parseFormula = function (text) {
    const t = String(text === null || text === undefined ? '' : text).trim().replace(/^=\s*/, '');
    if (!t) return { terms: [], error: null };
    const terms = [];
    for (const part of t.split(/\s+\+\s+|(?<=[\d)%\s])\+(?=\s*[A-Za-z(\d])/).map((x) => x.trim()).filter(Boolean)) {
      let m = part.match(TERM_PRE), coef = '', name = part;
      if (m) { coef = m[1]; name = m[2]; } else { m = part.match(TERM_POST); if (m) { name = m[1]; coef = m[2]; } }
      if (!m && /[×*]/.test(part)) return { terms, error: `"${part}" is not "<number> × <name>" or "<name> × <number>"` };
      const w = coef ? parseWeight(coef, true) : 1;
      if (!U.isNum(w)) return { terms, error: `"${coef}" is not a number, percentage or fraction` };
      name = name.trim().replace(/^\((.*)\)$/, '$1').trim();
      if (!name) return { terms, error: `a term has no investor column or view name: "${part}"` };
      terms.push({ name, weight: w, text: coef.replace(/^\(|\)$/g, '').trim() });
    }
    return { terms, error: null };
  };
  /** A formula back as text from terms [{ name, weight, text }]: "Investor 1 + 7/20 × Fund 1". */
  AUM.formulaText = (terms) => (terms || []).map((x) => (x.weight === 1 && !x.text ? x.name : `${x.text || +(+x.weight).toPrecision(6)} × ${x.name}`)).join(' + ');
  /** Is this name the attribution row / view ("Group", "Group weights", or the configured attribution label)? */
  const isAttributionName = (name, label) => ATTRIBUTION_ROW.concat([label || CONFIG.attributionLabel]).some((x) => norm(x) === norm(name));
  /** First cell whose text is one of `names` (a title), scanning rows from `fromRow` (first 300 rows, first 60 columns); { r, c } or null. */
  function findTitle(g, names, fromRow) {
    const want = new Set(names.map(norm));
    for (let r = fromRow || 0; r < Math.min(300, g.rows.length); r++) { const row = g.rows[r] || []; for (let c = 0; c < Math.min(row.length, 60); c++) if (want.has(norm(row[c]))) return { r, c }; }
    return null;
  }
  /** A small vertical table: headers on row `hr` from column `c0` (matched by name), records until the first blank row. */
  function readVertical(g, hr, c0, colsSpec, cEnd) {
    const cols = {}, head = g.rows[hr] || [];
    for (let c = c0; c < Math.min(head.length, c0 + 20, cEnd === undefined ? Infinity : cEnd); c++) for (const [k, names] of Object.entries(colsSpec)) if (!(k in cols) && !blank(head[c]) && names.some((n) => (n instanceof RegExp ? n.test(norm(head[c])) : norm(n) === norm(head[c])))) cols[k] = c;
    const rows = [];
    for (let r = hr + 1; r < g.rows.length; r++) {
      const rec = { __row: r + 1 }; let any = false;
      for (const [k, c] of Object.entries(cols)) { const v = at(g, r, c); rec[k] = v; if (!blank(v)) any = true; }
      if (!any) break;
      rows.push(rec);
    }
    return { cols, rows };
  }
  /**
   * Read the Scope Settings sheet. Returns { columns: [investor column names], investors: Map(norm(column) → { column, name,
   * group (type), weight, row }), views: Map(norm(view) → { view, def: 'group' | [[column, weight], …] | null (to fill in),
   * row, lookThroughOf }), groupRow, fxException: [{ investor, currency, view, rate, column, note, row }], scalars, diag }.
   * Names are not resolved against the workbook here: run() does that, where the investor columns and overrides are known.
   */
  function readSettingsSheet(g, issue) {
    const out = { columns: [], investors: new Map(), views: new Map(), groupRow: null, fxException: [], scalars: {}, diag: {} };
    // the tables sit side by side: each one's headers are read only up to the next table's title column
    const titleCols = Object.values(SETTINGS_TITLES).map((names) => findTitle(g, names)).filter(Boolean).map((t) => t.c);
    const endOf = (t) => { const next = titleCols.filter((c) => c > t.c); return next.length ? Math.min(...next) : undefined; };
    // the Settings table first: it may name the attribution label, which identifies the attribution row of the matrix
    const st = findTitle(g, SETTINGS_TITLES.settings);
    if (st) {
      const v = readVertical(g, st.r + 1, st.c, SETTINGS_COLS.settings, endOf(st));
      for (const r of v.rows) {
        const spec = SETTING_KEYS[norm(r.setting)]; if (!spec || blank(r.value)) continue;
        const val = spec[1](r.value);
        if (val === null || val === undefined || (typeof val === 'number' && !U.isNum(val))) { issue('warn', SETTINGS_SHEET, r.__row, `Settings: "${str(r.value)}" is not a valid value for ${str(r.setting)}; ignored`); continue; }
        out.scalars[spec[0]] = val;
      }
      out.diag.settings = { found: true, titleCell: cellRef(st.r, st.c), rows: v.rows.length };
    } else out.diag.settings = { found: false };
    const attribution = out.scalars.attributionLabel || CONFIG.attributionLabel;
    // the Investors table: one row per investor column with its type, display name and group ownership
    const it = findTitle(g, SETTINGS_TITLES.investors);
    if (it) {
      const v = readVertical(g, it.r + 1, it.c, SETTINGS_COLS.investors, endOf(it));
      for (const r of v.rows) {
        const column = str(r.column); if (!column) continue;
        if (out.investors.has(norm(column))) { issue('warn', SETTINGS_SHEET, r.__row, `Investors: "${column}" appears twice; the first row is used`); continue; }
        const w = blank(r.weight) ? NaN : parseWeight(r.weight);
        if (!blank(r.weight) && !U.isNum(w)) issue('warn', SETTINGS_SHEET, r.__row, `Investors: "${str(r.weight)}" is not a weight (1, 0.35, 35% or 7/20) for ${column}; read as 0`);
        out.investors.set(norm(column), { column, name: str(r.name), group: str(r.type), weight: U.isNum(w) ? w : blank(r.weight) ? NaN : 0, weightText: typeof r.weight === 'string' ? r.weight.trim() : '', row: r.__row });
      }
      out.columns = Array.from(out.investors.values()).map((x) => x.column);
      if (!out.investors.size) issue('warn', SETTINGS_SHEET, it.r + 2, 'Investors: no rows under the headers (Investor column · Type · Display name · Group ownership)');
      out.groupRow = { view: attribution, row: it.r + 1 };
      out.diag.investors = { found: true, titleCell: cellRef(it.r, it.c), rows: out.investors.size, columns: Object.keys(v.cols) };
    } else out.diag.investors = { found: false };
    // the Views table: "View · Formula" rows, or the matrix form (investor columns across, one row of weights per view)
    const t = findTitle(g, SETTINGS_TITLES.views);
    const vHead = t ? (g.rows[t.r + 1] || []) : [];
    const isFormulaForm = t && vHead.some((x) => SETTINGS_COLS.viewFormulas.formula.some((n) => norm(n) === norm(x)));
    if (!t) { out.diag.views = { found: false }; if (!it) issue('warn', SETTINGS_SHEET, null, `${SETTINGS_SHEET}: no "Investors" or "Views" table found`); }
    else if (isFormulaForm) {
      const v = readVertical(g, t.r + 1, t.c, SETTINGS_COLS.viewFormulas, endOf(t));
      for (const r of v.rows) {
        const view = str(r.view); if (!view) continue;
        const k = norm(view);
        if (isAttributionName(view, attribution)) { out.views.set(k, { view, def: 'group', row: r.__row, lookThroughOf: null }); continue; }
        if (out.views.has(k)) { issue('warn', SETTINGS_SHEET, r.__row, `Views: "${view}" appears twice; the first row is used`); continue; }
        const f = AUM.parseFormula(r.formula);
        if (f.error) { issue('warn', SETTINGS_SHEET, r.__row, `Views: the formula of "${view}" could not be read (${f.error}); the view is left undefined`); out.views.set(k, { view, def: null, row: r.__row, lookThroughOf: AUM.lookThroughBase(view) }); continue; }
        out.views.set(k, { view, def: f.terms.length ? f.terms.map((x) => [x.name, x.weight, x.text]) : null, formula: str(r.formula), row: r.__row, lookThroughOf: AUM.lookThroughBase(view) });
      }
      out.diag.views = { found: true, form: 'formulas', titleCell: cellRef(t.r, t.c), headerRow: t.r + 2, rows: out.views.size, columns: out.columns.length, groupRow: out.groupRow ? out.groupRow.row : null };
    } else {
      const hr = t.r + 1, head = g.rows[hr] || [], cols = [];
      for (let c = t.c + 1; c < head.length && !blank(head[c]); c++) cols.push({ name: str(head[c]), c });
      out.columns = cols.map((x) => x.name);
      for (const x of cols) if (!out.investors.has(norm(x.name))) out.investors.set(norm(x.name), { column: x.name, name: '', group: '', weight: NaN, weightText: '', row: hr + 1 });
      if (!cols.length) issue('warn', SETTINGS_SHEET, hr + 1, 'Views: the header row holds no investor columns to the right of "View"');
      for (let r = hr + 1; r < g.rows.length; r++) {
        const name = str(at(g, r, t.c)), vals = cols.map((x) => at(g, r, x.c));
        if (!name && vals.every(blank)) break; // the first blank row ends the table
        if (!name) { issue('warn', SETTINGS_SHEET, r + 1, 'Views: a row without a name in the first column is ignored'); continue; }
        const k = norm(name);
        if (SPECIAL_ROWS.type.some((x) => norm(x) === k)) { cols.forEach((x, i) => { out.investors.get(norm(x.name)).group = str(vals[i]); }); continue; }
        if (SPECIAL_ROWS.name.some((x) => norm(x) === k)) { cols.forEach((x, i) => { out.investors.get(norm(x.name)).name = str(vals[i]); }); continue; }
        const weights = [];
        cols.forEach((x, i) => {
          if (blank(vals[i])) return;
          const w = parseWeight(vals[i]);
          if (!U.isNum(w)) { issue('warn', SETTINGS_SHEET, r + 1, `Views: "${str(vals[i])}" for ${x.name} in "${name}" is not a weight (1, 0.35, 35% or 7/20); read as 0`); return; }
          if (w) weights.push([x.name, w, typeof vals[i] === 'string' ? vals[i].trim() : '']);
        });
        if (isAttributionName(name, attribution)) { // the attribution row: each column's weight; the view itself = Σ weight × column
          cols.forEach((x, i) => { const w = blank(vals[i]) ? 0 : parseWeight(vals[i]); const inv = out.investors.get(norm(x.name)); inv.weight = U.isNum(w) ? w : 0; inv.weightText = typeof vals[i] === 'string' ? vals[i].trim() : ''; });
          out.groupRow = { view: name, row: r + 1 };
          out.views.set(k, { view: name, def: 'group', row: r + 1, lookThroughOf: null });
          continue;
        }
        if (out.views.has(k)) { issue('warn', SETTINGS_SHEET, r + 1, `Views: "${name}" appears twice; the first row is used`); continue; }
        out.views.set(k, { view: name, def: vals.every(blank) ? null : weights, row: r + 1, lookThroughOf: AUM.lookThroughBase(name) });
      }
      if (!out.groupRow) issue('info', SETTINGS_SHEET, hr + 1, `Views: no "${attribution}" row, so no attribution weights come from the sheet`);
      out.diag.views = { found: true, form: 'matrix', titleCell: cellRef(t.r, t.c), headerRow: hr + 1, columns: cols.length, rows: out.views.size, groupRow: out.groupRow ? out.groupRow.row : null };
    }
    // the FX exception table
    const fx = findTitle(g, SETTINGS_TITLES.fxException);
    if (fx) {
      const v = readVertical(g, fx.r + 1, fx.c, SETTINGS_COLS.fxException, endOf(fx));
      for (const r of v.rows) {
        if (!str(r.investor) || !str(r.currency)) continue;
        const rate = U.toNumber(r.rate), column = U.isNum(rate) ? '' : str(r.rate);
        if (!U.isNum(rate) && !column) { issue('warn', SETTINGS_SHEET, r.__row, `FX Exception: no rate for ${str(r.investor)} in ${str(r.currency)}; row ignored`); continue; }
        out.fxException.push({ investor: str(r.investor), currency: str(r.currency).toUpperCase(), view: str(r.view), rate: U.isNum(rate) ? rate : NaN, column, note: str(r.note) || `${SETTINGS_SHEET} sheet`, row: r.__row });
      }
      out.diag.fxException = { found: true, titleCell: cellRef(fx.r, fx.c), rows: out.fxException.length };
    } else out.diag.fxException = { found: false };
    return out;
  }

  // =====================================================================================================================
  // §2  WHERE EACH INPUT LIVES
  // Columns are found by name: the output name in row 2 (from Mapping References) or the header in row 3. Candidates are
  // compared after lower-casing and removing everything but letters and digits ("RA_Commitment QC" = "racommitmentqc").
  // =====================================================================================================================
  const norm = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  /** One role: the column a calculation needs. out = output names (row 2), hdr = headers (row 3), re = header patterns. */
  const role = (label, required, out, hdr, re) => ({ label, required: !!required, out: out || [], hdr: hdr || [], re: re || [] });
  /** A key role: its row-3 header is tried before any row-2 output name (an output name such as "Security ID" may sit on another column). */
  const keyRole = (label, required, out, hdr, re) => Object.assign(role(label, required, out, hdr, re), { hdrFirst: true, key: true });
  const ROLES = {
    Holdings: {
      model_portfolio: keyRole('Model portfolio', true, ['Model Portfolio'], ['Model Portfolio']),
      portfolio: keyRole('Portfolio', true, ['Portfolio'], ['Portfolio']),
      security_id: keyRole('Security ID (holding ID)', true, ['Security ID'], ['Security ID']),
      security_name: keyRole('Security name', false, ['Security Name'], ['Security Name']),
      portfolio_name: role('Portfolio name', false, ['Portfolio name'], ['Portfolio Name', 'Model Portfolio Name']),
      project_code: role('Project code', false, ['Project code'], ['Project Code']),
      reporting_date: role('Reporting date', true, ['Reporting Date'], ['Reporting Date']),
      currency: role('Position currency', true, ['Currency', 'Quotation Currency'], ['Quotation Currency', 'Currency']),
      fx_rate: role('FX rate', true, ['Forex', 'FX Rate', 'FX', 'FX rate (QC per EUR)'], ['FX Rate EC', 'FX Rate', 'FX Rate EUR']),
      nominal: role('Nominal (exposure)', true, ['Amount nominal (QC)', 'Amount nominal', 'Nominal', 'Nominal Amount', 'Exposure'], ['RA_Commitment QC', 'RA Commitment QC']),
      drawn: role('Drawn amount', true, ['Current drawn amount (QC)', 'Current drawn amount', 'Current drawn', 'Drawn', 'Drawn Amount'], ['Current Drawn Amount CCY', 'Current Drawn Amount QC']),
      commitment: role('Commitment', false, ['Initial commitment (QC)', 'Initial commitment', 'Commitment'], ['Initial Commitment Amount CCY']),
      amount_eur: role('Amount in EUR (as exported)', false, ['Amount (EUR)'], []),
      nominal_rc: role('Nominal in reference currency (FX check)', false, ['Nominal RC'], ['RA Commitment RC']),
      maturity_date: role('Maturity date', false, ['Maturity Date'], ['Maturity Date']),
      purchase_date: role('Purchase date', false, ['Purchase Date'], ['Purchase Date']),
      rate_type: role('Rate type', false, ['Fixed / Floating', 'Rate Type'], ['Rate Type']),
      spread: role('Spread', false, ['All-in spread (bps)', 'All-in spread', 'Spread at Acquisition', 'Spread'], ['All-in Spread at Acquisition', 'Spread']),
      wal: role('WAL', false, ['Current WAL', 'WAL'], ['WAL']),
      yield_pct: role('Yield', false, ['Yield'], ['Yield']),
      internal_rating: role('Internal rating', false, ['Internal Rating'], ['Internal Current Rating', 'Internal Rating']),
      closing_rating: role('Closing rating', false, ['Initial Rating', 'Closing Rating'], [], [/ratingclosing$/]),
      fitch: role('Fitch rating', false, ['External Rating Fitch', 'Fitch'], ['Rating Fitch']),
      sp: role('S&P rating', false, ['External Rating S&P', 'S&P'], ['Rating S&P', 'Rating SP']),
      moodys: role("Moody's rating", false, ['External Rating Moodys', "External Rating Moody's", "Moody's"], ["Rating Moody's", 'Rating Moody', 'Rating Moodys']),
      country: role('Country', false, ['Country'], ['RA Asset Country Name', 'Issuer Country', 'RA Country']),
      country_code: role('Country code', false, ['Country code'], ['RA Country', 'Country Code']),
      sector: role('Sector (Holdings)', false, ['Sector'], ['Sector']),
      greenfield: role('Brownfield / Greenfield', false, ['Brownfield / Greenfield'], ['Brownfield / Greenfield']),
      origination_ps: role('Primary / Secondary', false, ['Primary / Secondary'], ['Primary / Secondary']),
      instrument: role('Instrument', false, ['Instrument', 'Format'], ['Security Type Name']),
      bullet: role('Bullet flag', false, ['Bullet / Amortizing', 'Bullet / Amortising', 'Bullet'], ['RA_Bullet']),
      parent_issuer: role('Parent issuer', false, ['Borrower name', 'Parent Issuer'], ['Parent Issuer Name']),
      seniority: role('Seniority', false, ['Seniority'], ['Seniority']),
      // the workbook's own formula columns B–E, used only to reconcile against this file (§12)
      wb_unique_id: role('Workbook: Unique Identifier (B)', false, [], ['Unique Identifier']),
      wb_investor_code: role('Workbook: Investor Code (C)', false, [], ['Investor Code']),
      wb_identification_id: role('Workbook: Identification ID (D)', false, [], ['Identification ID']),
      wb_code_name: role('Workbook: Code Name (E)', false, [], ['Code Name']),
    },
    Hardcoded: {
      security_id: role('Security ID', true, [], ['Security ID']),
      project_name: role('Project name', false, ['Project Code'], ['Project Name']),
      code_name: role('Code name', false, [], ['Code Name']),
      chronological_order: role('Chronological order', false, ['Chronological Order'], ['Chronological Order']),
      subsector: role('Subsector', false, ['Subsector'], ['Subsector']),
      cashflow_type: role('Cash-flow type', false, ['Cashflow Type'], ['Cashflow Type', 'Cash Flow Type']),
      description: role('Description', false, ['Description'], ['Description']),
      shareholders: role('Shareholders', false, ['Shareholders'], ['Shareholders']),
      origination: role('Origination', false, ['Origination'], ['Origination']),
      staff_closing: role('Staff closing', false, ['Staff Closing'], ['Staff Closing']),
      upfront: role('Upfront fee', false, ['Upfront'], ['Upfront']),
      protection_end: role('End of NC / MW', false, ['End of NC / MW'], ['End of NC / MW', 'End of NC MW']),
      ic_date: role('IC date', false, ['IC Date'], ['IC Date']),
      funding_date: role('Funding date', false, ['Funding Date'], ['Funding Date']),
      total_debt: role('Total debt offering', false, ['Total Debt Offering'], ['Total Debt Offering']),
      watchlist: role('Watchlist', false, ['Watchlist'], ['Watchlist']),
      prepayment_1: role('Prepayment protection (1)', false, ['Prepayment protection (1)'], ['Prepayment Protection (1)']),
      prepayment_2: role('Prepayment protection (2)', false, ['Prepayment protection (2)'], ['Prepayment Protection (2)']),
      expected_cod: role('Expected COD if greenfield', false, ['Expected COD if greenfield'], ['Expected COD if greenfield', 'Expected COD']),
      jurisdiction_tier: role('Jurisdiction tier', false, [], [], [/^jurisdictiontier/]),
      ticcs_code: role('TICCS code', false, ['TICCS Code', 'TICS Code'], ['TICCS Code', 'TICS Code']),
      sector_class: role('Sector classification', false, [], [], [/sectorclassification$/]), // any "<investor> Sector Classification" column
      country_tier: role('Country tier', false, [], [], [/countrytier$/]),
      compliance: role('Covenant compliance', false, ['Compliance with Financial Covenants'], ['Compliance with Financial Covenants', 'Compliance (with Financial Covenants)', 'Compliance']),
    },
    'ESG Hardcoded': {
      security_id: role('Security ID', true, [], ['Security ID']),
      project_name: role('Project name', false, ['Project Name'], ['Project Name']),
      code_name: role('Code name', false, ['Code Name'], ['Code Name']),
      e_score: role('E score', false, ['E Score'], ['E Score']),
      s_score: role('S score', false, ['S Score'], ['S Score']),
      g_score: role('G score', false, ['G Score'], ['G Score']),
      esg_score: role('ESG score', false, ['ESG Score'], ['ESG Score']),
      shareholders: role('Shareholders', false, ['Shareholders'], ['Shareholders']),
      chi_sector: role('Sector (taxonomy)', false, ['CBI sector', 'CHI Sector'], ['CBI Sector', 'CHI Sector']),
      chi_subsector: role('Subsector (taxonomy)', false, ['CBI subsector', 'CHI Subsector'], ['CBI Subsector', 'CHI Subsector']),
      chi_subsubsector: role('Sub-subsector (taxonomy)', false, ['CBI subsubsector', 'CHI Subsubsector'], ['CBI Subsubsector', 'CHI Subsubsector']),
      chi_asset_type: role('Asset type (taxonomy)', false, ['CBI asset type', 'CHI Asset Type'], ['CBI Asset Type', 'CHI Asset Type']),
      chi_asset_specific: role('Asset specific (taxonomy)', false, ['CBI asset specific', 'CHI Asset Specific'], ['CBI Asset Specific', 'CHI Asset Specific']),
      infra_code: role('Infra code', false, ['Infra code'], ['Infra Code']),
      fm_monitoring: role('FM monitoring', false, ['Staff Monitoring', 'FM Monitoring'], ['FM Monitoring']),
      ghg1: role('GHG scope 1', false, ['GHG Scope 1'], ['GHG Scope 1']),
      ghg2: role('GHG scope 2', false, ['GHG Scope 2'], ['GHG Scope 2']),
      ghg3: role('GHG scope 3', false, ['GHG Scope 3'], ['GHG Scope 3']),
    },
  };
  AUM.ROLES = ROLES;
  AUM.SHEETS = ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'];
  // Headers that identify each sheet's header row (the row with the most matches among the first rows wins).
  const HEADER_HINTS = {
    Holdings: ['Security ID', 'Security Name', 'Model Portfolio', 'Portfolio', 'Reporting Date', 'Quotation Currency', 'Maturity Date', 'Rate Type'],
    Hardcoded: ['Security ID', 'Project Name', 'Code Name', 'Subsector', 'Watchlist', 'Funding Date', 'Shareholders', 'Description'],
    'ESG Hardcoded': ['Security ID', 'Project Name', 'ESG Score', 'E Score', 'GHG Scope 1', 'CBI Sector', 'CHI Sector'],
  };
  // The six Mapping tables: title (row 2) and expected headers (row 3), with the columns the workbook uses as a fallback.
  // `order` is the workbook's column order from the title column, used when none of the headers is recognised.
  const MAPPING_TABLES = {
    references: { title: ['References'], cols: { holdingsColumn: ['Columns in Holdings tab', 'Columns in Holdings', 'Holdings column', 'Column'], outputName: ['Output Names', 'Output Name', 'Output'] }, order: ['holdingsColumn', 'outputName'], fallback: 'C' },
    activeAssets: { title: ['Active Assets', 'Active assets list'], cols: { views: ['Views (Portfolios / Investors)', 'Views', 'Views (Portfolios/Investors)', 'Portfolios / Investors'], list: ['List'], mapping: ['Mapping'], activeOutput: ['Active Assets Output', 'Active assets'], selected: ['Selected Assets', 'Selected'], number: ['Number', 'No', 'Order'] }, order: ['views', 'list', 'mapping', 'activeOutput', 'selected', 'number'], fallback: 'H' },
    securityMapping: { title: ['Security Mapping', 'Securities Mapping', 'Security mapping table'], cols: { codeName: ['Code Name', 'Code'], holdingsName: ['Holdings Name', 'Holding Name', 'Project Name', 'Name'], identificationId: ['Identification ID', 'Identification', 'Asset ID', 'Ident ID'], holdingId: ['Holding ID', 'Holdings ID', 'Security ID', 'Holding'], transactionGroup: ['Transaction Group', 'Group'] }, order: ['codeName', 'holdingsName', 'identificationId', 'holdingId', 'transactionGroup'], fallback: 'Q' },
    fundingName: { title: ['Funding Name', 'Funding Names', 'Investors'], cols: { fundName: ['Fund Name', 'Funding Name', 'Fund'], holdingsName: ['Holdings Name', 'Holding Name', 'Investor', 'Investor column'], holdingsId: ['Holdings ID', 'Holding ID', 'Portfolio ID', 'Investor code', 'Code'] }, order: ['fundName', 'holdingsName', 'holdingsId'], fallback: 'Y' },
    investmentGrade: { title: ['Investment Grade Mapping', 'Investment Grade', 'Rating Mapping', 'Ratings'], cols: { rating: ['Rating', 'Grade'], score: ['Score', 'Numeric', 'Value'], extra: ['Scale', 'Agency', 'Type'] }, order: ['rating', 'score', 'extra'], fallback: 'AC' },
    fundCheck: { title: ['Fund Check', 'Funds Check'], cols: { mapping: ['Mapping'], holdings: ['Holdings'] }, order: ['mapping', 'holdings'], fallback: 'AH' },
  };

  // =====================================================================================================================
  // §3  READING THE SHEETS
  // =====================================================================================================================
  /** Excel column letters for a 0-based index (0 → A, 27 → AB). */
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  /** 0-based column index of Excel letters. */
  const colIndex = (l) => String(l).toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  /** "AK57" for 0-based row and column. */
  const cellRef = (r, c) => colName(c) + (r + 1);
  /** Cell value or null (rows may be ragged). */
  const at = (g, r, c) => { const row = g.rows[r]; if (!row) return null; const v = row[c]; return v === undefined ? null : v; };
  /** True for blanks and Excel error values (#N/A, #REF!, …), which the workbook would show instead of data. */
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!)$/i.test(v.trim())));
  const str = (v) => (blank(v) ? '' : String(v).trim());
  /** Comparison key of an identifier: trimmed, inner spaces collapsed, "100200.0" = "100200", case ignored (an ID typed as text in one
   *  sheet and stored as a number in another still matches). The display value keeps the sheet's own spelling. */
  const idKey = (v) => { let t = str(v); if (/^-?\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, ''); return t.replace(/\s+/g, ' ').toUpperCase(); };
  /** Comparison key of a name (security names, column headers): trimmed, inner spaces collapsed, case ignored. */
  const nameKey = (v) => str(v).replace(/\s+/g, ' ').toLowerCase();
  AUM.idKey = idKey;
  /** Excel-style number: numbers pass through; strings lose thousands separators, currency symbols and a trailing %. */
  const num = (v) => (typeof v === 'number' ? v : U.toNumber(v));
  /** Date from an ISO string, dd/mm/yyyy, or an Excel serial number (whole or fractional). */
  const date = (v) => {
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return U.parseDate(v);
  };

  /**
   * Find the header row among the first 15 rows: the row matching the most DISTINCT hint headers (a name repeated on
   * several columns counts once). The row of output names sits directly above the headers and often repeats them, so
   * when two adjacent rows both qualify the lower one is the header row.
   */
  function findHeaderRow(g, hints) {
    const want = new Set(hints.map(norm)); const scores = [];
    for (let r = 0; r < Math.min(15, g.rows.length); r++) { const seen = new Set(); for (const v of g.rows[r] || []) { const n = norm(v); if (want.has(n)) seen.add(n); } scores.push(seen.size); }
    let best = -1; scores.forEach((sc, r) => { if (sc >= 2 && sc > (best < 0 ? 0 : scores[best])) best = r; });
    if (best < 0) return -1;
    while (best + 1 < scores.length && scores[best + 1] >= 2) best++;
    return best;
  }

  /** Describe a sheet with a header row: every non-empty header with its letter, row-3 header and row-2 label. */
  function readHeaders(g, headerRow) {
    const out = [], row = g.rows[headerRow] || [], above = headerRow > 0 ? g.rows[headerRow - 1] || [] : [];
    for (let c = 0; c < row.length; c++) {
      const header = str(row[c]); if (!header) continue;
      out.push({ index: c, letter: colName(c), header, output: str(above[c]) });
    }
    return out;
  }

  /**
   * Resolve every role of a sheet to a column: an override (Data page) first, then an output name in row 2, then a
   * header in row 3, then a header pattern. Returns { role: column|null } plus a description for the Data page.
   */
  function resolveRoles(sheet, columns, overrides) {
    const defs = ROLES[sheet] || {}, map = {}, report = [];
    for (const [key, def] of Object.entries(defs)) {
      let col = null, via = null;
      const ov = overrides && overrides[sheet + '.' + key];
      if (ov) { col = columns.find((c) => c.header === ov || c.letter === ov) || null; if (col) via = 'override'; }
      const byHeader = () => { for (const hd of def.hdr) { const c = columns.find((x) => norm(x.header) === norm(hd)); if (c) return c; } return null; };
      const byOutput = () => { for (const o of def.out) { const c = columns.find((x) => x.output && norm(x.output) === norm(o)); if (c) return c; } return null; };
      if (!col && def.hdrFirst) { col = byHeader(); if (col) via = 'header (row 3)'; }
      if (!col) { col = byOutput(); if (col) via = 'output name (row 2)'; }
      if (!col && !def.hdrFirst) { col = byHeader(); if (col) via = 'header (row 3)'; }
      if (!col) for (const re of def.re) { col = columns.find((c) => re.test(norm(c.header))); if (col) { via = 'header pattern'; break; } }
      map[key] = col;
      report.push({ sheet, role: key, label: def.label, required: def.required, letter: col ? col.letter : null, header: col ? col.header : null, output: col ? col.output : null, via, candidates: def.out.concat(def.hdr) });
    }
    return { map, report };
  }

  /**
   * Locate side-by-side tables (the six Mapping tables, the Scope Settings tables). A table is found by its title in the first rows (headers on the next row) or, failing
   * that, at the workbook's default column. Each table's columns are searched only between its own title and the next
   * table's title, because names repeat across tables ("Mapping", "Holdings Name").
   */
  function locateTables(g, SPEC) {
    const titles = [];
    for (let r = 0; r < Math.min(30, g.rows.length); r++) {
      const row = g.rows[r] || [];
      for (let c = 0; c < row.length; c++) for (const [key, t] of Object.entries(SPEC)) if (t.title.some((x) => norm(x) === norm(row[c]))) titles.push({ key, r, c });
    }
    const found = {};
    for (const [key, t] of Object.entries(SPEC)) {
      const hit = titles.filter((x) => x.key === key).sort((a, b) => a.r - b.r || a.c - b.c)[0];
      const titleRow = hit ? hit.r : 1, titleCol = hit ? hit.c : colIndex(t.fallback);
      const headerRow = titleRow + 1;
      const others = titles.filter((x) => x.key !== key && x.c > titleCol).map((x) => x.c);
      const stop = others.length ? Math.min(...others) : titleCol + 12;
      const start = Math.max(0, titleCol - 1); // the Security Mapping helper column (P) sits left of its title
      const cols = {};
      for (const [ck, names] of Object.entries(t.cols)) {
        for (let c = start; c < stop; c++) { if (names.some((n) => norm(n) === norm(at(g, headerRow, c)))) { cols[ck] = c; break; } }
      }
      const headersSeen = []; for (let c = titleCol; c < Math.min(stop, titleCol + 8); c++) { const v = str(at(g, headerRow, c)); if (v) headersSeen.push(`${colName(c)}=${v}`); }
      let foundBy = hit ? 'title' : 'default column';
      // no header recognised: take the columns in the workbook's order from the title column, and say so
      if (!Object.keys(cols).length && t.order && (hit || headersSeen.length)) { t.order.forEach((ck, k) => { if (titleCol + k < stop) cols[ck] = titleCol + k; }); foundBy += ', columns by position (headers not recognised)'; }
      found[key] = { key, title: t.title[0], foundBy, titleCell: cellRef(titleRow, titleCol), headerRow, cols, headersSeen, rows: [] };
      const keyCols = Object.values(cols);
      if (!keyCols.length) continue;
      const added = new Set(g.addedRows || []); // rows appended by the app (Scope.store edits)
      for (let r = headerRow + 1; r < g.rows.length; r++) {
        const rec = { __row: r + 1, __added: added.has(r) }; let any = false;
        for (const [ck, c] of Object.entries(cols)) { const v = at(g, r, c); rec[ck] = v; rec['__' + ck] = cellRef(r, c); if (!blank(v)) any = true; }
        if (any) found[key].rows.push(rec);
      }
      found[key].range = keyCols.length ? `${colName(Math.min(...keyCols))}${headerRow + 2}:${colName(Math.max(...keyCols))}${headerRow + 1 + (found[key].rows.length ? found[key].rows[found[key].rows.length - 1].__row - headerRow - 1 : 0)}` : '';
    }
    return found;
  }
  /** The six Mapping tables. */
  const locateMapping = (g) => locateTables(g, MAPPING_TABLES);

  /** Remaining years → maturity bucket ("3-5 y"; "Matured" if negative; "Unknown" without a date). */
  AUM.bucketOf = function (years, buckets) {
    if (!U.isNum(years)) return 'Unknown';
    for (const b of buckets) {
      const m = b.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
      if (m && years >= +m[1] && years < +m[2]) return b + ' y';
      const p = b.match(/^(\d+(?:\.\d+)?)\s*\+$/);
      if (p && years >= +p[1]) return b + ' y';
    }
    return years < 0 ? 'Matured' : 'Unknown';
  };

  // Field lists used by the asset page (canonical names of asset attributes, ESG fields and adjustable position fields).
  AUM.ASSET_ATTRIBUTE_FIELDS = ['sector', 'subsector', 'country', 'region', 'sponsor', 'repayment_type', 'cash_flow_type', 'instrument', 'origination', 'deal_year', 'deal_lead',
    'watchlist', 'covenant_compliance', 'ic_date', 'funding_date', 'protection_end_date', 'upfront_fee_bps', 'total_transaction_size', 'transaction_group', 'chronological_order', 'description'];
  AUM.ESG_FIELDS = ['esg_score', 'e_score', 's_score', 'g_score', 'ghg_scope1_t', 'ghg_scope2_t', 'ghg_scope3_t', 'ghg_intensity_t_per_eurm', 'chi_sector', 'chi_subsector'];
  AUM.ADJUSTABLE_POSITION_FIELDS = ['nominal', 'drawn', 'commitment', 'currency', 'fx_rate', 'internal_grade', 'fitch', 'moodys', 'sp', 'maturity_date', 'purchase_date', 'rate_type', 'spread'];
  AUM.NUMERIC_ASSET_FIELDS = ['upfront_fee_bps', 'total_transaction_size', 'deal_year', 'wal_years', 'chronological_order', 'esg_score', 'e_score', 's_score', 'g_score', 'ghg_scope1_t', 'ghg_scope2_t', 'ghg_scope3_t', 'ghg_intensity_t_per_eurm'];

  // =====================================================================================================================
  // RUN: the whole AUM calculation. input = { sheets, sources, adjustments, platform (view), currency, includeLines,
  // overrides: { roles: { 'Holdings.nominal': header }, views: { name: composition }, investors: { label: [group, weight] }, fxQuote } }
  // =====================================================================================================================
  AUM.run = function (input) {
    const sheets = (input && input.sheets) || {};
    const ov = (input && input.overrides) || {};
    const issues = [];
    /** Record a data issue: severity error (position excluded) / warn (kept, flagged) / info (context). */
    const issue = (severity, sheet, row, message, extra) => { issues.push(Object.assign({ severity, table: sheet, row, message }, extra || {})); };
    const adjIndex = new Map();
    for (const a of input.adjustments || []) adjIndex.set(`${a.table}|${a.key}|${a.field}`, a);
    const diag = { sheets: {}, tables: {}, roles: [], checks: [], views: [], investors: [], fx: {}, settings: { present: false }, gaps: { securities: [], investors: [], inactive: [] } };
    // §1b the optional Scope Settings sheet, and the settings in force: app changes > sheet > §1 defaults
    const settingsGrid = sheets[SETTINGS_SHEET] && sheets[SETTINGS_SHEET].rows && sheets[SETTINGS_SHEET].rows.length ? sheets[SETTINGS_SHEET] : null;
    const SS = settingsGrid ? readSettingsSheet(settingsGrid, issue) : null;
    diag.settings = { present: !!SS, source: (input.sources || {})[SETTINGS_SHEET] || null, tables: SS ? SS.diag : {} };
    const S = Object.assign({}, CONFIG, SS ? SS.scalars : {}, ov.settings || {}); // app changes to a setting win over the sheet
    if (typeof S.maturityBuckets === 'string') S.maturityBuckets = SETTING_KEYS.maturitybuckets[1](S.maturityBuckets);
    if (!Array.isArray(S.maturityBuckets) || !S.maturityBuckets.length) S.maturityBuckets = CONFIG.maturityBuckets;
    if (ov.fxQuote) S.fxQuote = ov.fxQuote; // an override (including 'auto') wins

    // ---------- §3 sheets present? header rows and columns ----------
    const layout = {};
    for (const name of AUM.SHEETS) {
      const g = sheets[name];
      const d = { present: !!(g && g.rows && g.rows.length), source: (input.sources || {})[name] || null, rowCount: g && g.rows ? g.rows.length : 0 };
      diag.sheets[name] = d;
      if (!d.present) { issue('error', name, null, `Sheet "${name}" is missing: load the workbook or paste the sheet on the Data page`); continue; }
      if (name === 'Mapping') continue;
      const hr = findHeaderRow(g, HEADER_HINTS[name]);
      d.headerRow = hr >= 0 ? hr + 1 : null;
      if (hr < 0) { issue('error', name, null, `Header row not found in "${name}" (expected headers such as ${HEADER_HINTS[name].slice(0, 3).join(', ')})`); continue; }
      const columns = readHeaders(g, hr);
      const { map, report } = resolveRoles(name, columns, ov.roles);
      d.columns = columns; d.dataStart = hr + 2;
      diag.roles.push(...report);
      for (const rep of report) if (rep.required && !rep.letter) issue('error', name, hr + 1, `Required column for "${rep.label}" not found (looked for ${rep.candidates.slice(0, 3).join(' / ')}); choose it on the Data page`);
      layout[name] = { g, hr, columns, map };
    }

    // ---------- §4 Mapping lookups ----------
    const mapping = sheets.Mapping && sheets.Mapping.rows ? locateMapping(sheets.Mapping) : {};
    diag.tables = Object.fromEntries(Object.entries(mapping).map(([k, t]) => [k, { title: t.title, foundBy: t.foundBy, titleCell: t.titleCell, headerRow: t.headerRow + 1, columns: Object.fromEntries(Object.entries(t.cols).map(([ck, c]) => [ck, colName(c)])), headersSeen: t.headersSeen || [], rows: t.rows.length, range: t.range,
      samples: Object.fromEntries(Object.entries(t.cols).map(([ck]) => [ck, t.rows.slice(0, 3).map((r) => str(r[ck])).filter(Boolean)])) }]));
    for (const [k, t] of Object.entries(mapping)) if (/by position/.test(t.foundBy)) issue('warn', 'Mapping', t.headerRow + 1, `Mapping › ${t.title}: none of its headers was recognised (found: ${(t.headersSeen || []).join(', ') || 'none'}); the columns are taken in the workbook's order from ${t.titleCell}. Check the Mapping tab`);
    for (const [k, t] of Object.entries(MAPPING_TABLES)) if (sheets.Mapping && (!mapping[k] || !mapping[k].rows.length)) issue(k === 'fundCheck' ? 'info' : 'warn', 'Mapping', null, `Mapping table "${t.title[0]}" not found or empty`);
    const T = (k) => (mapping[k] ? mapping[k].rows : []);
    // References (C:D): Holdings column → output name (Holdings row 2 = XLOOKUP(row 3, C, D))
    const refs = new Map(T('references').filter((r) => !blank(r.holdingsColumn)).map((r) => [norm(r.holdingsColumn), str(r.outputName)]));
    // Active Assets (H:M): views list (H) and the security-name → asset mapping (I → J); the Output universe = UNIQUE(J)
    let viewNames = U.uniq(T('activeAssets').map((r) => str(r.views)).filter(Boolean));
    const nameToMapped = new Map(T('activeAssets').filter((r) => !blank(r.list)).map((r) => [nameKey(r.list), { value: str(r.mapping), cell: r.__mapping }]));
    const activeCodes = U.uniq(T('activeAssets').map((r) => str(r.mapping)).filter(Boolean));
    const activeSet = new Set(activeCodes.map(idKey));
    // Security Mapping (Q:U): holding ID (T) → code name (Q), holdings name (R), identification ID (S), transaction group (U)
    const secById = new Map(); // keyed by idKey(holding ID)
    for (const r of T('securityMapping')) {
      const id = str(r.holdingId); if (!id) continue;
      if (secById.has(idKey(id))) { issue('warn', 'Mapping', r.__row, `Holding ID ${id} appears twice in Security Mapping; the first row is used`); continue; }
      secById.set(idKey(id), { holdingId: id, codeName: str(r.codeName), holdingsName: str(r.holdingsName), identificationId: str(r.identificationId) || id, transactionGroup: str(r.transactionGroup), row: r.__row, cells: r, added: !!r.__added });
    }
    const codeToIdent = new Map(); for (const s of secById.values()) if (s.codeName && !codeToIdent.has(idKey(s.codeName))) codeToIdent.set(idKey(s.codeName), s.identificationId);
    // Funding Name (Y:AA): holdings ID (AA, the investor code) → fund name (Y) and holdings name (Z, the investor column)
    // Several holdings IDs (portfolio codes) usually point at the same investor column (holdings name, column Z): one
    // investor column per name, in first-seen order, each knowing every code that feeds it.
    const fundById = new Map(), columns = new Map(), codeFund = new Map(); // code → column; norm(holdings name) → column; code → fund name (Calculations K)
    for (const r of T('fundingName')) {
      const id = str(r.holdingsId); if (!id) continue;
      if (fundById.has(idKey(id))) { issue('warn', 'Mapping', r.__row, `Holdings ID ${id} appears twice in Funding Name; the first row (${fundById.get(idKey(id)).original}) is used`); continue; }
      const original = str(r.holdingsName) || str(r.fundName) || id;
      let col = columns.get(norm(original));
      if (!col) { col = { id, ids: [], fundName: str(r.fundName), fundNames: [], original, row: r.__row, added: !!r.__added }; columns.set(norm(original), col); }
      col.ids.push(id); if (str(r.fundName) && !col.fundNames.includes(str(r.fundName))) col.fundNames.push(str(r.fundName));
      fundById.set(idKey(id), col); codeFund.set(idKey(id), str(r.fundName));
    }
    // display names: changed in the app > Scope Settings › Investors › Display Name > the workbook's own name (column Z).
    // resolve() maps an original, display or fund name to the display name, so settings may use any of them. A settings
    // name that is a unique prefix or part of one column name ("Fund One" for "Fund One Units") is accepted and reported.
    const alias = new Map(), looseMatches = new Map();
    /**
     * The one column a loose name refers to (4+ characters): the only column whose name begins with it ("Fund One" for
     * "Fund One Units"), else the longest column name the name begins with ("Investor 13 Mandate" for "Investor 13"),
     * else the only column whose name contains it. Returns the column object, or null when none or several.
     */
    const loose = (name) => {
      const k = norm(name); if (k.length < 4) return null;
      const all = Array.from(columns.values());
      const starts = all.filter((c) => norm(c.original).startsWith(k)); if (starts.length === 1) return starts[0];
      if (!starts.length) { const pre = all.filter((c) => norm(c.original).length >= 4 && k.startsWith(norm(c.original))).sort((x, y) => norm(y.original).length - norm(x.original).length); if (pre.length && (pre.length === 1 || norm(pre[0].original).length > norm(pre[1].original).length)) return pre[0]; }
      const inc = all.filter((c) => norm(c.original).includes(k)); return inc.length === 1 ? inc[0] : null;
    };
    const resolve = (x) => { const k = norm(x); if (alias.has(k)) return alias.get(k); const c = loose(x); if (c) { const l = c.label || c.original; if (!looseMatches.has(k)) { looseMatches.set(k, l); issue('info', SETTINGS_SHEET, null, `"${str(x)}" taken as the investor column "${l}"`); } return l; } return String(x); };
    /** The display name of a column named exactly (any of its names), else the text as given: never a loose match. View names go through this one. */
    const strict = (x) => { const k = norm(x); return alias.has(k) ? alias.get(k) : String(x); };
    /** Settings-sheet investor row for a column: by its workbook name, display name or fund name, else by a unique loose match. */
    function looseKey(map, original) { const col = columns.get(norm(original)); for (const [k, v] of map) if (!columns.has(k) && (!alias.has(k) || alias.get(k) === (col.label || col.original)) && loose(v.column) === col) return v; return null; }
    const sheetRowOf = (f) => (SS ? SS.investors.get(norm(f.original)) || (f.label && SS.investors.get(norm(f.label))) || f.fundNames.map((fn) => SS.investors.get(norm(fn))).find(Boolean) || looseKey(SS.investors, f.original) : null);
    for (const f of columns.values()) {
      const o = ov.names && (ov.names[f.original] || ov.names[norm(f.original)]);
      const sh = sheetRowOf(f);
      f.label = o ? String(o) : sh && sh.name ? sh.name : f.original;
      f.nameSource = o ? 'override' : sh && sh.name ? 'sheet' : 'workbook';
      alias.set(norm(f.original), f.label); alias.set(norm(f.label), f.label); for (const fn of f.fundNames) if (!alias.has(norm(fn))) alias.set(norm(fn), f.label);
    }
    if (SS) for (const sh of SS.investors.values()) if (!alias.has(norm(sh.column)) && !loose(sh.column)) issue('info', SETTINGS_SHEET, sh.row, `Investors: "${sh.column}" is not an investor column in Mapping › Funding Name (column Z); its row is ignored`);
    if (SS) for (const f of columns.values()) { const sh = sheetRowOf(f); if (sh && norm(sh.column) !== norm(f.original)) issue('info', SETTINGS_SHEET, sh.row, `Investors: "${sh.column}" taken as the investor column "${f.original}"`); }
    // Investment Grade Mapping (AC:AE): rating → score
    const scale = [];
    for (const r of T('investmentGrade')) { const g = U.normalizeGrade(str(r.rating)); const s = num(r.score); if (g && U.isNum(s)) scale.push({ grade: g, up: g.toUpperCase(), numeric: s, scale: str(r.extra), row: r.__row }); }
    const gradeExact = new Map(scale.map((x) => [x.grade, x])), gradeUpper = new Map(scale.map((x) => [x.up, x]));
    if (!scale.length && sheets.Mapping) issue('warn', 'Mapping', null, 'Investment Grade Mapping is empty: every position is treated as not rated');
    // the S&P / Fitch style grades label the weighted rating; Moody's grades share the numeric scale
    const ratingScaleSP = scale.filter((x) => /^(AAA|AA|A|BBB|BB|B|CCC|CC|C|D)[+-]?$/.test(x.grade)).sort((a, b) => a.numeric - b.numeric);
    const fundCheck = T('fundCheck');

    // ---------- §5 Holdings: the formula columns recomputed, then one position per row ----------
    const H = layout.Holdings;
    // Key columns checked against Mapping: Security IDs must exist in Security Mapping (Holding ID) and investor codes in
    // Funding Name (Holdings ID). When the column a key resolved to matches almost nothing while another column matches
    // almost everything, that column is used instead and the correction is reported: a workbook whose row-2 output names
    // repeat "Security ID" on another column would otherwise exclude every position.
    const keyChecks = [];
    if (H) {
      const dataRows = []; for (let r = H.hr + 1; r < Math.min(H.g.rows.length, H.hr + 3001); r++) dataRows.push(r);
      const pctOf = (x) => `${Math.round(x * 100)}%`;
      /** Share of a column's non-blank values (over the rows `use` accepts) found in `keys`. */
      const rateOf = (ci, keys, use) => { let n = 0, hit = 0; const samples = []; for (const r of dataRows) { if (use && !use(r)) continue; const v = str(at(H.g, r, ci)); if (!v || v === '0') continue; n++; if (keys.has(idKey(v))) hit++; else if (samples.length < 3) samples.push(v); } return { n, hit, rate: n ? hit / n : 0, samples }; };
      const check = (roleKey, keys, label, where, use) => {
        const cur = H.map[roleKey], manual = !!(ov.roles && ov.roles['Holdings.' + roleKey]);
        const r0 = cur ? rateOf(cur.index, keys, use) : { n: 0, hit: 0, rate: 0, samples: [] };
        const rec = { role: roleKey, label, column: cur ? cur.letter : null, header: cur ? cur.header : null, matched: r0.hit, tested: r0.n, rate: r0.rate, corrected: null, manual };
        let best = null;
        if (!manual && r0.n && r0.rate < 0.5) for (const c of H.columns) {
          if (cur && c.index === cur.index) continue;
          if (Object.entries(H.map).some(([k, m]) => k !== roleKey && m && m.index === c.index && (ROLES.Holdings[k] || {}).key)) continue; // another key's column
          const x = rateOf(c.index, keys, use);
          if (x.n >= Math.max(5, r0.n * 0.5) && x.rate >= 0.8 && (!best || x.rate > best.x.rate)) best = { c, x };
        }
        if (best) {
          H.map[roleKey] = best.c;
          rec.corrected = { column: best.c.letter, header: best.c.header, matched: best.x.hit, tested: best.x.n, rate: best.x.rate };
          const rep = diag.roles.find((x) => x.sheet === 'Holdings' && x.role === roleKey);
          if (rep) { rep.letter = best.c.letter; rep.header = best.c.header; rep.output = best.c.output; rep.via = `values match ${where} (corrected from column ${cur ? cur.letter : 'none'})`; }
          issue('warn', 'Holdings', H.hr + 1, `${label}: column ${cur ? cur.letter + ' "' + cur.header + '"' : '(not found)'} matched ${pctOf(r0.rate)} of ${where} (e.g. ${r0.samples.join(', ')}); column ${best.c.letter} "${best.c.header}" matches ${pctOf(best.x.rate)} and is used instead. Choose the column yourself on Data › Columns if this is wrong`, { kind: 'key_corrected' });
        } else if (r0.n && r0.rate < 0.5) issue('warn', 'Holdings', H.hr + 1, `${label}: only ${pctOf(r0.rate)} of the values in column ${cur.letter} "${cur.header}" exist in ${where} (e.g. ${r0.samples.join(', ')}). Check the column on Data › Columns, or the Mapping table`, { kind: 'key_mismatch' });
        keyChecks.push(rec);
      };
      const single = (r) => H.map.model_portfolio && str(at(H.g, r, H.map.model_portfolio.index)).toUpperCase() === S.singleToken.toUpperCase();
      if (secById.size) check('security_id', new Set(secById.keys()), 'Security ID', 'Mapping › Security Mapping (Holding ID)');
      if (fundById.size) {
        check('model_portfolio', new Set(fundById.keys()), 'Model Portfolio (investor code)', 'Mapping › Funding Name (Holdings ID)', (r) => !single(r));
        if (dataRows.some(single)) check('portfolio', new Set(fundById.keys()), 'Portfolio (investor code of SINGLE rows)', 'Mapping › Funding Name (Holdings ID)', single);
      }
    }
    diag.keyChecks = keyChecks;
    const positions = [];
    let paddingRows = 0;
    const checks = {
      investorCode: { label: 'Holdings C (Investor Code) = IF(Model Portfolio = "SINGLE", Portfolio, Model Portfolio)', total: 0, matched: 0, examples: [] },
      uniqueId: { label: 'Holdings B (Unique Identifier) = Investor Code & "x" & Security ID', total: 0, matched: 0, examples: [] },
      identificationId: { label: 'Holdings D (Identification ID) = XLOOKUP(Security ID, Mapping!T, Mapping!S)', total: 0, matched: 0, examples: [] },
      codeName: { label: 'Holdings E (Code Name) = XLOOKUP(Security ID, Mapping!T, Mapping!Q)', total: 0, matched: 0, examples: [] },
      row2: { label: 'Holdings row 2 = XLOOKUP(row-3 header, Mapping!C, Mapping!D)', total: 0, matched: 0, examples: [] },
    };
    /** Compare a value the workbook computed with this file's value (blank workbook cells are not compared). */
    // Excel error values (#N/A, #REF!, …) all read as "#N/A" here, so a lookup that fails in both places matches.
    const canon = (v) => (v === null || v === undefined ? '' : typeof v === 'string' && /^#/.test(v.trim()) ? '#N/A' : String(v).trim());
    // A formula that failed in the workbook (#REF!, #VALUE!, #NAME?, …) is not compared: typically it pointed at a sheet that was
    // not exported with the four. Scope computes the value itself either way; the check reports how many were skipped.
    const FAILED = /^#(REF!|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/i;
    const compare = (chk, wbVal, ours, cell) => {
      if (canon(wbVal) === '') return; // the workbook cell is empty: nothing to compare
      if (typeof wbVal === 'string' && FAILED.test(wbVal.trim())) { chk.failed = (chk.failed || 0) + 1; return; }
      chk.total++;
      const a = canon(wbVal), b = canon(ours);
      if (a === b || (U.isNum(num(a)) && U.isNum(num(b)) && Math.abs(num(a) - num(b)) < 1e-9)) chk.matched++;
      else if (chk.examples.length < 25) chk.examples.push({ cell, workbook: a || '(blank)', scope: b || '(blank)' });
    };
    if (H) {
      // row 2 of Holdings is the workbook's XLOOKUP into References: recompute and compare
      if (H.hr > 0) for (const c of H.columns) { const want = refs.get(norm(c.header)); compare(checks.row2, c.output || '#N/A', want || '#N/A', cellRef(H.hr - 1, c.index)); }
      const m = H.map;
      /** Value and cell of a role on row r ({ v, cell } or blank). */
      const cell = (r, key) => (m[key] ? { v: at(H.g, r, m[key].index), cell: cellRef(r, m[key].index), col: m[key].header } : { v: null, cell: null, col: null });
      const seenKeys = new Map(), blankIdRows = [];
      for (let r = H.hr + 1; r < H.g.rows.length; r++) {
        const secCell = cell(r, 'security_id');
        if (blank(secCell.v) || str(secCell.v) === '0') { // copied formula rows ("0x0") or empty rows
          if ((H.g.rows[r] || []).some((v) => !blank(v))) { paddingRows++; const nv = m.nominal ? num(at(H.g, r, m.nominal.index)) : NaN; if (U.isNum(nv) && nv !== 0) blankIdRows.push(r + 1); }
          continue;
        }
        const line = r + 1;
        const src = {}, raw = {};
        for (const key of Object.keys(ROLES.Holdings)) { const c = cell(r, key); raw[key] = c.v; if (c.cell) src[key] = { table: 'Holdings', row: line, col: c.col, cell: c.cell }; }
        // every column of the row, for the explorer and the asset page
        const sheetRow = {}; for (const c of H.columns) sheetRow[c.header] = at(H.g, r, c.index);
        const p = { line, src, raw, sheet: sheetRow, excluded: false, exclusionReason: null, flags: [] };
        // Holdings C: investor code (the SINGLE rule)
        const model = str(raw.model_portfolio), port = str(raw.portfolio);
        p.investor_id = model.toUpperCase() === S.singleToken.toUpperCase() ? port : model;
        if (model.toUpperCase() === S.singleToken.toUpperCase()) src.investor_id = { table: 'calc', note: `Model Portfolio = ${S.singleToken} → Portfolio (${src.portfolio ? src.portfolio.cell : ''})` };
        p.holding_id = str(raw.security_id);
        p.key = p.investor_id + 'x' + p.holding_id; // Holdings B
        p.security_name = str(raw.security_name);
        p.tranche = p.security_name;
        // Holdings D / E: identification ID and code name from Security Mapping
        const sec = secById.get(idKey(p.holding_id));
        compare(checks.investorCode, raw.wb_investor_code, p.investor_id, src.wb_investor_code && src.wb_investor_code.cell);
        compare(checks.uniqueId, raw.wb_unique_id, p.key, src.wb_unique_id && src.wb_unique_id.cell);
        compare(checks.identificationId, raw.wb_identification_id, sec ? sec.identificationId : '#N/A', src.wb_identification_id && src.wb_identification_id.cell);
        compare(checks.codeName, raw.wb_code_name, sec ? sec.codeName : '#N/A', src.wb_code_name && src.wb_code_name.cell);
        // manual corrections (Data page / asset page) replace the imported value; the original is kept for the badge
        for (const f of AUM.ADJUSTABLE_POSITION_FIELDS) {
          const roleKey = { internal_grade: 'internal_rating' }[f] || f;
          const a = adjIndex.get(`positions|${p.key}|${f}`);
          if (a) { p.flags.push('adjusted'); src[roleKey] = { table: 'manual', adjustment: a, original: raw[roleKey] }; raw[roleKey] = a.value; }
        }
        // amounts
        p.nominal = num(raw.nominal);
        if (!U.isNum(p.nominal)) { issue('error', 'Holdings', line, `Nominal "${str(raw.nominal)}" is not a number`, { key: p.key, cell: src.nominal && src.nominal.cell }); p.excluded = true; p.exclusionReason = 'nominal not numeric'; }
        p.drawn = num(raw.drawn);
        if (!U.isNum(p.drawn)) { if (str(raw.drawn)) issue('warn', 'Holdings', line, `Drawn "${str(raw.drawn)}" is not a number; treated as 0`, { key: p.key }); p.drawn = 0; src.drawn = { table: 'calc', note: 'blank or invalid drawn treated as 0' }; }
        p.commitment = num(raw.commitment);
        if (!U.isNum(p.commitment)) { p.commitment = U.isNum(p.nominal) ? p.nominal : 0; src.commitment = { table: 'calc', note: 'commitment blank → equals nominal' }; }
        if (U.isNum(p.nominal) && p.drawn > p.nominal * 1.000001) issue('warn', 'Holdings', line, `Drawn (${U.fmt.int(p.drawn)}) exceeds nominal (${U.fmt.int(p.nominal)})`, { key: p.key });
        p.currency = str(raw.currency).toUpperCase();
        if (!p.currency && !p.excluded) { issue('error', 'Holdings', line, 'Currency blank', { key: p.key }); p.excluded = true; p.exclusionReason = 'currency blank'; }
        p.fx_input = num(raw.fx_rate);
        // dates
        p.as_of_date = date(raw.reporting_date);
        p.maturity_date = date(raw.maturity_date);
        if (!p.maturity_date) issue('warn', 'Holdings', line, 'Maturity date missing; tenor and maturity bucket unavailable', { key: p.key });
        p.purchase_date = date(raw.purchase_date);
        p.funding_date = p.purchase_date; // replaced by the Hardcoded funding date when present (§8)
        // terms
        p.fixed_floating = norm(raw.rate_type) === 'fixed' ? 'Fixed' : 'Floating';
        let spread = num(raw.spread);
        if (U.isNum(spread) && (S.spreadUnit === 'percent' || (S.spreadUnit === 'auto' && Math.abs(spread) < 20))) spread *= 100;
        p.margin_bps = spread; p.coupon = NaN;
        p.wal = num(raw.wal);
        p.instrument_type = str(raw.instrument);
        // asset (Security Mapping) and investor (Funding Name)
        if (sec) { p.asset_code = sec.identificationId; p.asset_name = sec.holdingsName || sec.codeName; p.code_name = sec.codeName; src.asset_code = { table: 'Mapping', row: sec.row, col: 'Identification ID', cell: sec.cells.__identificationId }; }
        else { p.asset_code = null; p.asset_name = p.security_name || '(unmapped)'; p.flags.push('unmapped_security'); if (!p.excluded) { p.excluded = true; p.exclusionReason = 'Security ID not in Mapping Security Mapping'; } } // one issue per security, raised below
        if (sec && activeCodes.length && !activeSet.has(idKey(sec.codeName)) && !p.excluded) { p.excluded = true; p.exclusionReason = 'asset not in Mapping Active Assets list'; } // one issue per asset, raised below
        const inv = fundById.get(idKey(p.investor_id));
        if (inv) { p.investor_label = inv.label; p.investor_key = codeFund.get(idKey(p.investor_id)) || inv.fundName; src.investor_label = { table: 'Mapping', row: inv.row, col: 'Holdings Name' }; }
        else { p.investor_label = 'Unmapped investor ' + p.investor_id; p.investor_key = ''; p.flags.push('unmapped_investor'); } // one issue per code, raised below
        p.matrixKey = p.investor_label + p.asset_code; // Calculations F
        if (seenKeys.has(p.key)) issue('warn', 'Holdings', line, `Duplicate position ${p.key} (also row ${seenKeys.get(p.key)}); both rows are counted`, { key: p.key }); else seenKeys.set(p.key, line);
        positions.push(p);
      }
      if (blankIdRows.length) issue('warn', 'Holdings', blankIdRows[0], `${blankIdRows.length} row(s) carry a nominal but no Security ID (rows ${blankIdRows.slice(0, 6).join(', ')}${blankIdRows.length > 6 ? ', …' : ''}): skipped, as the workbook would`);
    }
    // ---------- mapping gaps: one issue per security, investor code or asset (not per row), with what is needed to close it ----------
    const gaps = { securities: [], investors: [], inactive: [] };
    const nPos = (n) => `${n} position${n === 1 ? '' : 's'}`;
    const rawSum = (ps) => ps.reduce((t, p) => t + (U.isNum(p.nominal) ? p.nominal : 0), 0);
    for (const [id, ps] of U.groupBy(positions.filter((p) => p.flags.includes('unmapped_security')), (p) => p.holding_id)) {
      const first = ps[0], ccy = U.uniq(ps.map((p) => p.currency)).filter(Boolean).join(' / ');
      gaps.securities.push({ holdingId: id, securityName: first.security_name, investors: U.uniq(ps.map((p) => p.investor_label)), investorIds: U.uniq(ps.map((p) => p.investor_id)),
        positions: ps.length, lines: ps.map((p) => p.line), nominal: rawSum(ps), currency: ccy, mappedName: (nameToMapped.get(nameKey(first.security_name)) || {}).value || '' });
      issue('error', 'Holdings', first.line, `Security ID ${id}${first.security_name ? ' (' + first.security_name + ')' : ''} (column ${H.map.security_id.letter} "${H.map.security_id.header}") is not in Mapping › Security Mapping (Holding ID): ${nPos(ps.length)} excluded, ${ccy} ${U.fmt.int(rawSum(ps))}. Add it on Data › Setup`, { key: first.key, kind: 'unmapped_security' });
    }
    for (const [id, ps] of U.groupBy(positions.filter((p) => p.flags.includes('unmapped_investor')), (p) => p.investor_id)) {
      const first = ps[0];
      gaps.investors.push({ investorId: id, portfolioName: str(first.raw.portfolio_name), positions: ps.length, lines: ps.map((p) => p.line), nominal: rawSum(ps), currency: U.uniq(ps.map((p) => p.currency)).filter(Boolean).join(' / '),
        securities: U.uniq(ps.map((p) => p.security_name || p.holding_id)) });
      issue('error', 'Holdings', first.line, `Investor code ${id}${first.raw.portfolio_name ? ' (' + str(first.raw.portfolio_name) + ')' : ''} is not in Mapping › Funding Name (Holdings ID): ${nPos(ps.length)} counted in asset totals but in no investor column. Add it on Data › Setup`, { key: first.key, kind: 'unmapped_investor' });
    }
    // when most keys fail, one plain statement of what was compared with what (the usual cause is a wrong column or table)
    const diagnosis = [];
    if (H && positions.length) {
      const secCol = H.map.security_id, secTable = mapping.securityMapping, invCol = H.map.model_portfolio, fundTable = mapping.fundingName;
      const sample = (ps, f) => U.uniq(ps.map(f).filter(Boolean)).slice(0, 4).join(', ');
      if (gaps.securities.length && gaps.securities.reduce((n, g) => n + g.positions, 0) >= positions.length / 2) {
        const msg = `${gaps.securities.length} of ${U.uniq(positions.map((p) => p.holding_id)).length} Security IDs were not found in Security Mapping. Scope read them from Holdings column ${secCol ? secCol.letter + ' "' + secCol.header + '"' : '?'} (e.g. ${sample(positions, (p) => p.holding_id)}) and compared them with Mapping column ${secTable && secTable.cols.holdingId !== undefined ? colName(secTable.cols.holdingId) : '?'} "Holding ID" (${secById.size} rows, e.g. ${Array.from(secById.values()).slice(0, 4).map((x) => x.holdingId).join(', ') || 'none'}). ${secById.size ? 'If these are different kinds of ID, choose the right Holdings column on Data › Columns.' : 'The Security Mapping table was not read: see Data › Mapping.'}`;
        diagnosis.push(msg); issue('error', 'Holdings', null, msg, { kind: 'diagnosis' });
      }
      if (gaps.investors.length && gaps.investors.reduce((n, g) => n + g.positions, 0) >= positions.length / 2) {
        const msg = `${gaps.investors.length} investor codes were not found in Funding Name. Scope read them from Holdings column ${invCol ? invCol.letter + ' "' + invCol.header + '"' : '?'} (e.g. ${sample(positions, (p) => p.investor_id)}) and compared them with Mapping column ${fundTable && fundTable.cols.holdingsId !== undefined ? colName(fundTable.cols.holdingsId) : '?'} "Holdings ID" (${fundById.size} rows, e.g. ${Array.from(fundById.values()).slice(0, 4).map((x) => x.id).join(', ') || 'none'}). ${fundById.size ? 'If these are different kinds of code, choose the right Holdings column on Data › Columns.' : 'The Funding Name table was not read: see Data › Mapping.'}`;
        diagnosis.push(msg); issue('error', 'Holdings', null, msg, { kind: 'diagnosis' });
      }
    }
    diag.diagnosis = diagnosis;
    // assets held in Holdings but absent from Active Assets (Mapping column J): one warning per asset, with its size
    const inactive = U.groupBy(positions.filter((p) => p.exclusionReason === 'asset not in Mapping Active Assets list'), (p) => p.code_name);
    for (const [codeName, ps] of inactive) {
      gaps.inactive.push({ codeName, identificationId: ps[0].asset_code, securityNames: U.uniq(ps.map((p) => p.security_name).filter(Boolean)), positions: ps.length, lines: ps.map((p) => p.line), nominal: rawSum(ps), currency: U.uniq(ps.map((p) => p.currency)).filter(Boolean).join(' / ') });
      issue('warn', 'Mapping', null, `${codeName} is held in Holdings (${nPos(ps.length)}, rows ${ps.map((p) => p.line).join(', ')}) but is not in Active Assets (column J): left out of the Output, as in the workbook. Add it on Data › Setup`, { key: ps[0].asset_code, kind: 'inactive_asset' });
    }
    const asOf = positions.map((p) => p.as_of_date).filter(Boolean);
    const reportingDate = asOf.length ? new Date(Math.min(...asOf.map((d) => +d))) : null; // MIN(Holdings reporting date)

    // ---------- §6 Ratings branch ----------
    /** Score of a grade via Investment Grade Mapping; NR / blank = 0; unknown grades are flagged and scored 0. */
    const lookupGrade = (rawGrade, p, field) => {
      const g = U.normalizeGrade(str(rawGrade));
      if (!g || g.toUpperCase() === 'NR') return { grade: 'NR', numeric: 0, known: true };
      const hit = gradeExact.get(g) || gradeUpper.get(g.toUpperCase());
      if (!hit) { issue('warn', 'Holdings', p.line, `${field} grade "${rawGrade}" is not in Mapping › Investment Grade Mapping; treated as NR`, { key: p.key }); return { grade: g, numeric: 0, known: false }; }
      return { grade: hit.grade, numeric: hit.numeric, known: true };
    };
    for (const p of positions) {
      const int = lookupGrade(p.raw.internal_rating, p, 'Internal'), fi = lookupGrade(p.raw.fitch, p, 'Fitch'), mo = lookupGrade(p.raw.moodys, p, "Moody's"), sp = lookupGrade(p.raw.sp, p, 'S&P');
      const external_numeric = Math.max(fi.numeric, mo.numeric, sp.numeric, 0);
      const external_grade = external_numeric > 0 ? [fi, mo, sp].find((x) => x.numeric === external_numeric).grade : 'NR'; // Fitch → Moody's → S&P priority
      const current_grade = int.known && int.grade !== 'NR' && int.numeric > 0 ? int.grade : external_grade;
      const current_numeric = Math.max(int.numeric, external_numeric);
      p.rating = { internal: int.grade, internal_numeric: int.numeric, fitch: fi.grade, moodys: mo.grade, sp: sp.grade, fitch_numeric: fi.numeric, moodys_numeric: mo.numeric, sp_numeric: sp.numeric, external_grade, external_numeric, current_grade, current_numeric,
        ig_label: current_numeric > S.igThreshold ? 'SUB IG' : 'IG', status: current_numeric === 0 ? 'NR' : 'rated', closing: str(p.raw.closing_rating) };
      p.src.rating = { table: 'calc', note: `internal unless NR, else worst of Fitch / Moody's / S&P; score = MAX(internal, external); IG if ≤ ${S.igThreshold}` };
      p.initial_tenor = p.funding_date && p.maturity_date ? U.yearfrac(p.funding_date, p.maturity_date) : 0;
      p.remaining_years = reportingDate && p.maturity_date ? U.yearsBetween(reportingDate, p.maturity_date) : NaN;
      p.maturity_bucket = AUM.bucketOf(p.remaining_years, S.maturityBuckets);
    }

    // ---------- §8 Hardcoded and ESG Hardcoded, keyed by Security ID (= identification ID) ----------
    /** Index a keyed sheet: key → { values by role, every column with its cell, row number }. */
    const indexSheet = (name) => {
      const L = layout[name], out = new Map(); if (!L || !L.map.security_id) return out;
      for (let r = L.hr + 1; r < L.g.rows.length; r++) {
        const id = str(at(L.g, r, L.map.security_id.index)); if (!id) continue;
        if (out.has(idKey(id))) { issue('warn', name, r + 1, `Security ID ${id} appears twice in ${name}; the first row is used`); continue; }
        const roles = {}, cells = {}, all = {};
        for (const [k, c] of Object.entries(L.map)) if (c) { roles[k] = at(L.g, r, c.index); cells[k] = cellRef(r, c.index); }
        for (const c of L.columns) all[c.header] = { value: at(L.g, r, c.index), cell: `${name}!${cellRef(r, c.index)}`, label: c.output };
        out.set(idKey(id), { roles, cells, all, row: r + 1 });
      }
      return out;
    };
    const hcById = indexSheet('Hardcoded'), esgById = indexSheet('ESG Hardcoded');
    // Hardcoded D/E are lookups to Mapping (P→R, P→Q): recompute and compare
    const hcChecks = { hcProjectName: { label: 'Hardcoded D (Project Name) = XLOOKUP(Security ID, Mapping!P, Mapping!R)', total: 0, matched: 0, examples: [] }, hcCodeName: { label: 'Hardcoded E (Code Name) = XLOOKUP(Security ID, Mapping!P, Mapping!Q)', total: 0, matched: 0, examples: [] } };
    const secByIdent = new Map(); for (const x of secById.values()) if (!secByIdent.has(idKey(x.identificationId))) secByIdent.set(idKey(x.identificationId), x);
    for (const [id, rec] of hcById) {
      const s = secById.get(idKey(id)) || secByIdent.get(idKey(id));
      compare(hcChecks.hcProjectName, rec.roles.project_name, s ? s.holdingsName : '#N/A', 'Hardcoded!' + (rec.cells.project_name || ''));
      compare(hcChecks.hcCodeName, rec.roles.code_name, s ? s.codeName : '#N/A', 'Hardcoded!' + (rec.cells.code_name || ''));
    }

    // ---------- §7 FX ----------
    // Each Holdings row carries a rate. The workbook converts every position in a currency with ONE rate: the one on the
    // reference investor's first row in that currency (Calculations CU:CW look up "<reference investor>&<currency>"); a
    // currency the reference investor does not hold becomes 0 there. Scope reproduces the one-rate rule (fxRateSource
    // 'workbook'), falls back to the row's own rate instead of 0 (with a warning), or uses each row's own rate ('position').
    // Direction: the quote is tested against the RC (reference-currency) column; by default amount ÷ rate = EUR.
    const rateCounts = new Map();
    for (const p of positions) if (p.currency && U.isNum(p.fx_input) && p.fx_input > 0) { const k = p.currency; if (!rateCounts.has(k)) rateCounts.set(k, new Map()); const m = rateCounts.get(k); m.set(p.fx_input, (m.get(p.fx_input) || 0) + 1); }
    const fxTable = new Map(Array.from(rateCounts, ([ccy, m]) => [ccy, Array.from(m).sort((a, b) => b[1] - a[1])[0][0]])); // most frequent rate per currency
    const firstLabel = columns.size ? columns.values().next().value.label : '';
    const refKnown = S.fxReferenceInvestor && (alias.has(norm(S.fxReferenceInvestor)) || loose(S.fxReferenceInvestor));
    const refLabel = refKnown ? resolve(S.fxReferenceInvestor) : firstLabel;
    if (S.fxReferenceInvestor && !refKnown) issue('warn', SETTINGS_SHEET, null, `FX reference investor "${S.fxReferenceInvestor}" is not an investor column; the first column of Funding Name (${firstLabel || 'none'}) is used`);
    const wbRate = new Map(); // currency → the reference investor's first rate
    if (S.fxRateSource === 'workbook' && refLabel) for (const p of positions) if (!wbRate.has(p.currency) && p.investor_label === refLabel && U.isNum(p.fx_input) && p.fx_input > 0) wbRate.set(p.currency, { rate: p.fx_input, line: p.line, cell: p.src.fx_rate ? p.src.fx_rate.cell : '' });
    let fxQuote = S.fxQuote; // changed in the app > Scope Settings sheet > §1
    const fxTest = { tested: 0, divide: 0, multiply: 0 };
    for (const p of positions) {
      const rc = num(p.raw.nominal_rc);
      if (!U.isNum(rc) || !rc || !U.isNum(p.nominal) || !U.isNum(p.fx_input) || p.fx_input <= 0 || p.currency === S.baseCurrency) continue;
      fxTest.tested++;
      if (Math.abs(p.nominal / p.fx_input - rc) / Math.abs(rc) < 0.01) fxTest.divide++;
      if (Math.abs(p.nominal * p.fx_input - rc) / Math.abs(rc) < 0.01) fxTest.multiply++;
    }
    if (fxQuote === 'auto') {
      if (fxTest.tested && fxTest.multiply > fxTest.divide && fxTest.multiply >= fxTest.tested * 0.6) fxQuote = 'eur_per_ccy';
      else fxQuote = 'ccy_per_eur';
      if (!fxTest.tested) issue('info', 'Holdings', null, 'FX direction could not be checked (no reference-currency column); amounts are divided by the rate as in the workbook');
    }
    /** A Holdings rate as units per EUR under the quote in force. */
    const toPerEur = (r) => (fxQuote === 'ccy_per_eur' ? r : 1 / r);
    const perEur = (ccy) => { if (ccy === S.baseCurrency) return 1; const w = wbRate.get(ccy); const r = w ? w.rate : fxTable.get(ccy); return U.isNum(r) ? toPerEur(r) : NaN; };
    diag.fx = { quote: fxQuote, source: S.fxRateSource, reference: refLabel, test: fxTest,
      table: Array.from(fxTable, ([currency, rate]) => { const w = wbRate.get(currency); return { currency, rate: w ? w.rate : rate, perEur: toPerEur(w ? w.rate : rate), source: w ? `${refLabel} row ${w.line}` : S.fxRateSource === 'workbook' && currency !== S.baseCurrency ? 'most frequent (no reference row)' : 'most frequent', frequent: rate }; }) };
    const displayCcy = input.currency && U.isNum(perEur(input.currency)) ? input.currency : S.baseCurrency;
    if (input.currency && displayCcy !== input.currency) issue('warn', 'Holdings', null, `Display currency ${input.currency} has no FX rate in Holdings; amounts shown in ${S.baseCurrency}`);
    const dispRate = perEur(displayCcy);
    const viewId = input.platform;
    // the exception: changed in the app > Scope Settings › FX Exception > §1. Rate = a number, or a Hardcoded column with one rate per asset.
    const fxExceptions = (ov.fxOverrides || (SS && SS.fxException.length ? SS.fxException : S.fxOverrides) || []).map((x) => Object.assign({ column: '' }, x));
    diag.fxException = fxExceptions.map((x) => Object.assign({}, x));
    const missingRef = new Set(), missingCol = new Set();
    for (const p of positions) {
      if (p.excluded) continue;
      let fxIn = p.fx_input, note = U.isNum(p.fx_input) ? `rate ${p.fx_input} from ${p.src.fx_rate ? p.src.fx_rate.cell : 'Holdings'}` : '';
      if (S.fxRateSource === 'workbook' && p.currency !== S.baseCurrency) {
        const w = wbRate.get(p.currency);
        if (w) { fxIn = w.rate; note = `rate ${w.rate}: ${refLabel}'s first ${p.currency} row (Holdings!${w.cell || w.line})`; }
        else if (U.isNum(p.fx_input) && p.fx_input > 0 && !missingRef.has(p.currency)) { missingRef.add(p.currency); issue('warn', 'Holdings', p.line, `${refLabel || 'The reference investor'} holds nothing in ${p.currency}: the workbook would convert every ${p.currency} position to 0; Scope uses each row's own rate`); }
      }
      let rate = U.isNum(fxIn) && fxIn > 0 ? toPerEur(fxIn) : p.currency === S.baseCurrency ? 1 : NaN;
      if (!U.isNum(rate) && U.isNum(perEur(p.currency))) { rate = perEur(p.currency); note = `rate for ${p.currency} taken from other Holdings rows`; issue('info', 'Holdings', p.line, `FX rate blank; ${p.currency} rate taken from other rows`, { key: p.key }); }
      const o = fxExceptions.find((x) => x.currency === p.currency && (resolve(x.investor) === p.investor_label || idKey(x.investor) === idKey(p.investor_id)) && (!x.view || x.view === viewId || strict(x.view) === strict(viewId)));
      if (o && o.column) { // one rate per asset, from a Hardcoded column (the workbook's INDEX into Hardcoded)
        const hc = p.asset_code ? hcById.get(idKey(p.asset_code)) || hcById.get(idKey(p.holding_id)) : null;
        const hd = hc ? Object.keys(hc.all).find((k) => norm(k) === norm(o.column)) || Object.keys(hc.all).find((k) => norm(hc.all[k].label) === norm(o.column)) : null;
        const v = hd ? num(hc.all[hd].value) : NaN;
        if (U.isNum(v) && v > 0) { rate = toPerEur(v); note = `exception: ${o.column} = ${v} (${hc.all[hd].cell})`; }
        else if (!missingCol.has(p.asset_code || p.holding_id)) { missingCol.add(p.asset_code || p.holding_id); issue('warn', 'Hardcoded', hc ? hc.row : null, `FX exception for ${p.investor_label} in ${p.currency}: no rate in Hardcoded "${o.column}" for ${p.code_name || p.holding_id}; the standard rate is used (the workbook would show 0)`, { key: p.key }); }
      } else if (o) { rate = U.isNum(o.rate) && o.rate > 0 ? toPerEur(o.rate) : NaN; note = `exception: rate ${o.rate}` + (o.note ? ` (${o.note})` : ''); } // quoted like the Holdings rates
      if (!U.isNum(rate) || rate <= 0) { p.excluded = true; p.exclusionReason = `no FX rate for ${p.currency}`; issue('error', 'Holdings', p.line, `No FX rate for ${p.currency}: position excluded (the workbook's IFERROR would show 0)`, { key: p.key }); continue; }
      p.fx_rate = rate; p.src.fx_rate = Object.assign({}, p.src.fx_rate || { table: 'calc' }, { note });
      p.nominal_eur = p.nominal / rate; p.drawn_eur = p.drawn / rate; p.commitment_eur = p.commitment / rate;
      p.nominal_base = p.nominal_eur * dispRate; p.drawn_base = p.drawn_eur * dispRate; p.commitment_base = p.commitment_eur * dispRate;
      p.src.nominal_base = { table: 'calc', note: `${p.currency} ${U.fmt.int(p.nominal)} ÷ ${rate} (per EUR) × ${dispRate} (${displayCcy} per EUR)` };
    }

    // ---------- global filter: positions outside input.includeLines are left out of every total ----------
    const keepLines = input.includeLines instanceof Set ? input.includeLines : null;
    let filteredOutCount = 0;
    if (keepLines) for (const p of positions) if (!p.excluded && !keepLines.has(p.line)) { p.filteredOut = true; filteredOutCount++; }
    const inView = (p) => !p.excluded && !p.filteredOut;

    // ---------- §9 Investor columns and attribution weights ----------
    /** Type and weight of an investor column: changed in the app > Scope Settings sheet > §1 defaults > unknown (inferred below). */
    const pickKey = (obj, f) => (obj ? obj[f.label] || obj[f.original] : undefined);
    const classOf = (f) => {
      const o = pickKey(ov.investors, f); if (o) return { group: o[0] || '', weight: U.isNum(+o[1]) ? +o[1] : 0, weightText: o[2] ? String(o[2]) : '', source: 'override' };
      const sh = sheetRowOf(f);
      if (sh && (sh.group || U.isNum(sh.weight))) return { group: sh.group || '', weight: U.isNum(sh.weight) ? sh.weight : 0, source: 'sheet' };
      const c = pickKey(S.investors, f); if (c) return { group: c[0] || '', weight: +c[1] || 0, source: 'settings' };
      return { group: '', weight: 0, source: 'default' };
    };
    const investorOrder = Array.from(columns.values()).map((f) => Object.assign({ key: f.fundName, label: f.label, original: f.original, nameSource: f.nameSource }, classOf(f), { id: f.ids.join(', '), ids: f.ids, fundName: f.fundName, added: f.added }));
    const unmappedLabels = U.uniq(positions.filter((p) => p.flags.includes('unmapped_investor') && inView(p)).map((p) => p.investor_label));
    const investorMeta = new Map(investorOrder.map((i) => [i.label, i]));
    unmappedLabels.forEach((l) => investorMeta.set(l, { id: '', key: '', label: l, group: 'Unmapped', weight: 0, source: 'default' }));
    const investorColumns = investorOrder.map((i) => i.label).concat(unmappedLabels);

    // ---------- §10 Views (Output!G8): each view = Σ weight × investor column ----------
    // The list: Mapping column H first (the workbook's selector), then rows of the Scope Settings sheet, views changed in the
    // app and §1 defaults ("Total platform" is always there). Without column H: Total platform and one view per investor.
    // Mapping column H is often a copy of Calculations row 2: section titles ("Split Calculations AUM", "Ratings", …) and
    // the measure columns ("Commitment") come along with the investor columns. They are not views and are left out.
    const notAView = (n) => /^(splitcalculation|aumdata|forex|ratings|additionalaumdata|esgdata|geography|formulabar)/.test(norm(n)) || (/^(commitment|drawn|nominal|exposure)/.test(norm(n)) && !/platform|total/.test(norm(n)));
    const skippedH = viewNames.filter(notAView);
    if (skippedH.length) issue('info', 'Mapping', null, `Mapping column H also lists ${skippedH.join(', ')}: section titles or measure columns, not views; left out of the View selector`);
    viewNames = viewNames.filter((n) => !notAView(n));
    const sheetViews = SS ? Array.from(SS.views.values()) : [];
    diag.mappingViews = viewNames.slice(); // the workbook's own selector list (Mapping column H)
    const viewList = U.uniq((viewNames.length ? viewNames : ['Total platform'].concat(investorOrder.map((i) => i.label)))
      .concat(sheetViews.map((v) => v.view), Object.keys(ov.views || {}), Object.keys(S.views)).map((v) => str(v)).filter(Boolean));
    if (!viewNames.length) issue('info', 'Mapping', null, 'No views in Mapping › Active Assets column H; showing Total platform and one view per investor');
    /** Settings-sheet row of a view, by its exact name (or the display name of the column it is named after); never a loose match. */
    const sheetViewOf = (name) => (SS ? SS.views.get(norm(name)) || sheetViews.find((v) => strict(v.view) === strict(name)) : null);
    const viewKeys = new Map(viewList.map((v) => [norm(v), v]));
    /** A formula term: an investor column named exactly (any of its names), else a view named exactly, else a loosely named column. */
    const resolveTerm = (x) => { const k = norm(x); if (alias.has(k)) return alias.get(k); if (viewKeys.has(k)) return viewKeys.get(k); return resolve(x); };
    const platforms = [];
    for (const name of viewList) {
      // definition: changed in the app > Scope Settings › Views > §1 defaults > the attribution row > the view is an investor column
      const shView = sheetViewOf(name);
      let def, kind = null;
      if (ov.views && ov.views[name] !== undefined) { def = ov.views[name]; kind = 'override'; }
      else if (shView && shView.def) { def = shView.def; kind = 'sheet'; }
      else if (S.views[name] !== undefined) { def = S.views[name]; kind = 'settings'; }
      else if (isAttributionName(name, S.attributionLabel)) { def = 'group'; kind = 'settings'; }
      // a definition written as a formula ("Investor 1 + 7/20 × Fund 1"), from the app or §1
      if (typeof def === 'string' && def !== '*' && def !== 'group') { const f = AUM.parseFormula(def); if (f.error) { issue('warn', 'Mapping', null, `View "${name}": its formula could not be read (${f.error}); the view shows nothing`); def = []; } else def = f.terms.map((x) => [x.name, x.weight, x.text]); }
      let composition = null;
      if (def === '*') composition = [{ label: '*', weight: 1, text: '' }];
      else if (def === 'group') composition = investorColumns.map((l) => ({ label: l, weight: (investorMeta.get(l) || { weight: 0 }).weight, text: '' })).filter((c) => c.weight);
      else if (Array.isArray(def)) composition = def.map((x) => (Array.isArray(x) ? { label: resolveTerm(x[0]), weight: +x[1], text: x[2] || '' } : { label: resolveTerm(x), weight: 1, text: '' }));
      else if (investorMeta.has(AUM.lookThroughBase(name) ? strict(name) : resolve(name))) { composition = [{ label: resolve(name), weight: 1, text: '' }]; kind = 'investor column'; } // an "incl. part in funds" view is never just its base column
      else { const f = investorOrder.find((i) => i.fundName === name); if (f) { composition = [{ label: f.label, weight: 1, text: '' }]; kind = 'investor column'; } }
      // the workbook's own selector lists the platform total and its measure columns among the investor columns
      if (!composition && /platform|total|commitment|drawn|nominal|exposure/.test(norm(name))) { composition = [{ label: '*', weight: 1, text: '' }]; kind = 'settings'; def = '*'; }
      if (!composition) { kind = 'undefined'; composition = []; issue('info', 'Mapping', null, `View "${name}" (Mapping column H) is neither an investor column nor defined by a formula: it shows nothing until given one on Data › Setup or in the Scope Settings sheet`); }
      platforms.push({ id: name, label: name, composition, rawComposition: composition.map((c) => Object.assign({}, c)), kind, lookThroughOf: AUM.lookThroughBase(name), isGroup: def === 'group' });
    }
    // a formula may name another view ("Region A incl. part in funds = Region A + 1/4 × Fund 1"): expand it to columns
    const expandView = (p, depth, stack) => {
      const out = [];
      for (const c of p.composition) {
        if (c.label === '*' || investorMeta.has(c.label)) { out.push(c); continue; }
        const ref = platforms.find((x) => x.id !== p.id && (x.id === c.label || strict(x.id) === strict(c.label)));
        if (!ref) { issue('warn', 'Mapping', null, `View "${p.id}" refers to "${c.label}", which is neither an investor column nor a view`); continue; }
        if (depth >= 5 || stack.includes(ref.id)) { issue('error', 'Mapping', null, `View "${p.id}" refers to "${ref.id}" in a circle; that term is ignored`); continue; }
        for (const x of expandView(ref, depth + 1, stack.concat(p.id))) out.push({ label: x.label, weight: x.weight * c.weight, text: '', via: ref.id });
      }
      return out;
    };
    for (const p of platforms) if (p.composition.some((c) => c.label !== '*' && !investorMeta.has(c.label))) {
      const merged = new Map();
      for (const c of expandView(p, 0, [])) { const k = c.label; if (!merged.has(k)) merged.set(k, { label: k, weight: 0, text: '', via: c.via }); merged.get(k).weight += c.weight; }
      p.composition = Array.from(merged.values()).filter((c) => c.weight);
    }
    const shows = (p) => p.composition.length > 0;
    const platformId = platforms.some((p) => p.id === viewId && shows(p)) ? viewId : (platforms.find((p) => p.composition.some((c) => c.label === '*')) || platforms.find(shows) || platforms[0] || { id: '' }).id;
    const platform = platforms.find((p) => p.id === platformId) || { id: '', label: 'No view', composition: [] };

    // ---------- the fund look-through register, from the "<investor> incl. part in funds" views ----------
    // Such a view = the investor's own column(s) plus a weight on each fund it holds units of; that weight is the investor's
    // share of the fund. A column other investors hold units of is a fund. The remainder of each fund is held outside the platform.
    const fundRegister = [], registerFunds = [], byFund = new Map();
    for (const p of platforms) {
      if (!p.lookThroughOf || !p.composition.length || p.composition.some((c) => c.label === '*')) continue;
      const base = resolveTerm(p.lookThroughOf);
      let baseCols = [];
      if (investorMeta.has(base)) baseCols = [base];
      else { const bp = platforms.find((x) => x.id !== p.id && (x.id === p.lookThroughOf || x.id === base || strict(x.id) === strict(base))); if (bp) baseCols = bp.composition.filter((c) => c.weight && c.label !== '*').map((c) => c.label); }
      if (!baseCols.length) { issue('warn', 'Mapping', null, `View "${p.id}": "${p.lookThroughOf}" is neither an investor column nor another view, so its fund weights are not used for look-through`); continue; }
      const baseSet = new Set(baseCols), ws = U.uniq(baseCols.map((l) => (investorMeta.get(l) || { weight: 0 }).weight));
      const holderWeight = ws.length === 1 ? ws[0] : NaN, holderGroup = investorMeta.has(base) ? investorMeta.get(base).group : 'View';
      p.lookThroughBase = base;
      for (const c of p.composition) {
        if (baseSet.has(c.label) || !(c.weight > 0)) continue;
        if (!byFund.has(c.label)) byFund.set(c.label, []);
        byFund.get(c.label).push({ holder: base, share: c.weight, source: p.kind, holderWeight, holderGroup });
      }
    }
    for (const [fund, holders] of byFund) {
      const meta = investorMeta.get(fund);
      if (!meta) { issue('warn', 'Mapping', null, `Look-through: "${fund}" is not an investor column in Funding Name; the units held in it are ignored`); continue; }
      if (!meta.group) { meta.group = 'Fund'; meta.typeInferred = true; } // a column other investors hold units of
      for (const x of holders) fundRegister.push({ fund_label: fund, holder_label: x.holder, share: +x.share, note: x.source, holder_weight: x.holderWeight, holder_group: x.holderGroup });
      registerFunds.push({ fund, holders: holders.map((x) => [x.holder, +x.share]), source: holders[0].source, known: true });
    }
    // types not given anywhere: inferred from the attribution weight (1 = group entity, between = fund, 0 = third party)
    for (const i of investorOrder) if (!i.group) { const m = investorMeta.get(i.label); i.group = m.group = i.source === 'default' ? 'Unclassified' : i.weight >= 1 ? 'Group entity' : i.weight > 0 ? 'Fund' : 'Third party'; if (m.group !== 'Unclassified') i.typeInferred = m.typeInferred = true; }
    const unclassified = investorOrder.filter((i) => i.group === 'Unclassified').map((i) => i.label);
    if (unclassified.length) issue('warn', 'Mapping', null, `No type or attribution weight for ${unclassified.length} investor column(s) (${unclassified.slice(0, 4).join(', ')}${unclassified.length > 4 ? ', …' : ''}): treated as third party, weight 0. Set them on Data › Setup or in the Scope Settings sheet`);
    for (const p of positions) { const m = investorMeta.get(p.investor_label); p.investor_group = m ? m.group : 'Unmapped'; p.group_weight = m ? m.weight : 0; }
    const fundsWithoutRegister = investorOrder.filter((i) => /fund/i.test(i.group) && !registerFunds.some((f) => f.fund === i.label)).map((i) => i.label);
    if (fundsWithoutRegister.length) issue('info', 'Mapping', null, `Look-through: nobody is listed as holding units of ${fundsWithoutRegister.join(', ')} (no "<investor> incl. part in funds" view gives them a weight); their exposure is shown directly only`);
    diag.fundHolders = registerFunds;
    diag.funds = U.uniq(investorOrder.filter((i) => /fund/i.test(i.group)).map((i) => i.label).concat(registerFunds.map((f) => f.fund)));
    diag.investors = investorOrder.map((i) => { const sh = sheetRowOf(columns.get(norm(i.original)) || { original: i.original, label: i.label, fundNames: [] }); return { id: i.id, ids: i.ids, original: i.original, label: i.label, fundName: i.fundName, group: i.group, weight: i.weight, weightText: i.source === 'override' ? i.weightText || '' : i.source === 'sheet' && sh && sh.weightText ? sh.weightText : '', source: i.source, nameSource: i.nameSource, sheetName: sh && sh.name ? sh.name : '', typeInferred: !!i.typeInferred, added: !!i.added }; });
    for (const p of platforms) diag.views.push({ view: p.id, kind: p.kind, composition: p.composition, raw: p.rawComposition, formula: p.composition.some((c) => c.label === '*') ? '' : p.isGroup ? '' : AUM.formulaText(p.rawComposition.map((c) => ({ name: c.label, weight: c.weight, text: c.text }))),
      def: p.composition.some((c) => c.label === '*') ? '*' : p.isGroup ? 'group' : p.kind === 'investor column' ? 'column' : p.kind === 'undefined' ? null : 'list', lookThroughOf: p.lookThroughOf, lookThroughBase: p.lookThroughBase || null, inMapping: viewNames.includes(p.id) });

    // assets: every identification ID in Security Mapping, in Active Assets order first
    const assetOrder = U.uniq(activeCodes.map((c) => codeToIdent.get(idKey(c))).filter(Boolean).concat(Array.from(secById.values()).map((s) => s.identificationId)));
    const assetMeta = new Map();
    for (const s of secById.values()) {
      if (!assetMeta.has(s.identificationId)) assetMeta.set(s.identificationId, { code: s.identificationId, name: s.holdingsName || s.codeName, code_name: s.codeName, transaction_group: s.transactionGroup, holdings: [] });
      assetMeta.get(s.identificationId).holdings.push(s.holdingId);
    }
    const posByAsset = U.groupBy(positions.filter((p) => inView(p) && p.asset_code), (p) => p.asset_code);
    const assets = [];
    for (const code of assetOrder) {
      const meta = assetMeta.get(code); if (!meta) continue;
      const ps = posByAsset.get(code) || [];
      const a = { code, name: meta.name, code_name: meta.code_name, holdings: meta.holdings, positions: ps, positionCount: ps.length, excludedCount: positions.filter((p) => p.asset_code === code && p.excluded).length,
        active: false, inActiveList: activeSet.has(idKey(meta.code_name)) || !activeCodes.length, src: {}, attrs: {}, esg: {}, sheets: {}, byInvestor: new Map(), platform: {}, flags: [] };
      const sum = (f) => ps.reduce((s, p) => s + (p[f] || 0), 0);
      a.nominal = sum('nominal_base'); a.drawn = sum('drawn_base'); a.commitment = sum('commitment_base'); a.nominal_eur = sum('nominal_eur'); a.drawn_eur = sum('drawn_eur');
      // investor columns: SUMIF by investor & asset (Calculations F)
      for (const p of ps) {
        if (!a.byInvestor.has(p.investor_label)) a.byInvestor.set(p.investor_label, { nominal: 0, drawn: 0, commitment: 0, positions: 0 });
        const c = a.byInvestor.get(p.investor_label); c.nominal += p.nominal_base; c.drawn += p.drawn_base; c.commitment += p.commitment_base; c.positions++;
      }
      // group attributed = SUMPRODUCT(investor columns, weights); third party = total − attributed
      a.group_nominal = 0; a.group_drawn = 0;
      for (const [label, c] of a.byInvestor) { const w = (investorMeta.get(label) || { weight: 0 }).weight; a.group_nominal += c.nominal * w; a.group_drawn += c.drawn * w; }
      a.third_party_nominal = a.nominal - a.group_nominal; a.third_party_drawn = a.drawn - a.group_drawn; a.group_invested = a.group_nominal > 0;
      // view columns = Σ weight × investor column
      for (const pl of platforms) {
        let n = 0, d = 0, cm = 0;
        for (const comp of pl.composition) {
          if (comp.label === '*') for (const [, c] of a.byInvestor) { n += c.nominal * comp.weight; d += c.drawn * comp.weight; cm += c.commitment * comp.weight; }
          else { const c = a.byInvestor.get(comp.label); if (c) { n += c.nominal * comp.weight; d += c.drawn * comp.weight; cm += c.commitment * comp.weight; } }
        }
        a.platform[pl.id] = { nominal: n, drawn: d, commitment: cm };
      }
      // §8 attributes: Hardcoded and ESG rows (keyed by identification ID, else by any of the asset's holding IDs)
      const hc = hcById.get(idKey(code)) || meta.holdings.map((h) => hcById.get(idKey(h))).find(Boolean);
      const eg = esgById.get(idKey(code)) || meta.holdings.map((h) => esgById.get(idKey(h))).find(Boolean);
      if (hc) a.sheets.Hardcoded = hc.all; else if (ps.length) { a.flags.push('no_hardcoded'); issue('warn', 'Hardcoded', null, `No Hardcoded row for ${meta.code_name || code} (${code})`, { key: code }); }
      if (eg) a.sheets['ESG Hardcoded'] = eg.all; else if (ps.length) { a.flags.push('no_esg'); issue('info', 'ESG Hardcoded', null, `No ESG Hardcoded row for ${meta.code_name || code} (${code})`, { key: code }); }
      const first = ps[0];
      const hv = (k) => (hc ? hc.roles[k] : null), ev = (k) => (eg ? eg.roles[k] : null);
      const hsrc = (k) => (hc && hc.cells[k] ? { table: 'Hardcoded', row: hc.row, col: (ROLES.Hardcoded[k] || {}).label, cell: hc.cells[k] } : null);
      const esrc = (k) => (eg && eg.cells[k] ? { table: 'ESG Hardcoded', row: eg.row, col: (ROLES['ESG Hardcoded'][k] || {}).label, cell: eg.cells[k] } : null);
      const fundingDate = date(hv('funding_date')) || (first && first.purchase_date) || null;
      const set = (field, value, source) => { a.attrs[field] = value === null || value === undefined ? '' : value; if (source) a.src[field] = source; };
      set('sector', str(ev('chi_sector')) || str(hv('sector_class')) || (first ? str(first.raw.sector) : ''), esrc('chi_sector') || hsrc('sector_class') || (first && first.src.sector));
      set('subsector', str(hv('subsector')) || str(ev('chi_subsector')), hsrc('subsector') || esrc('chi_subsector'));
      set('country', first ? str(first.raw.country) : '', first && first.src.country);
      set('region', a.attrs.country ? S.regions[a.attrs.country] || 'Rest of world' : '', { table: 'calc', note: 'country → region (S.regions)' });
      set('sponsor', str(hv('shareholders')) || str(ev('shareholders')) || (first ? str(first.raw.parent_issuer) : ''), hsrc('shareholders') || esrc('shareholders'));
      set('repayment_type', first ? (/^(y|yes|true|1|bullet)$/i.test(str(first.raw.bullet)) ? 'Bullet' : str(first.raw.bullet) ? 'Amortising' : '') : '', first && first.src.bullet);
      set('cash_flow_type', str(hv('cashflow_type')), hsrc('cashflow_type'));
      set('instrument', first ? first.instrument_type : '', first && first.src.instrument);
      set('origination', str(hv('origination')) || (first ? str(first.raw.origination_ps) : ''), hsrc('origination') || (first && first.src.origination_ps));
      set('deal_year', fundingDate ? fundingDate.getUTCFullYear() : '', hsrc('funding_date'));
      set('deal_lead', str(hv('staff_closing')), hsrc('staff_closing'));
      set('watchlist', str(hv('watchlist')), hsrc('watchlist'));
      set('covenant_compliance', str(hv('compliance')), hsrc('compliance'));
      set('ic_date', U.isoDate(date(hv('ic_date'))), hsrc('ic_date'));
      set('funding_date', U.isoDate(fundingDate), hsrc('funding_date'));
      set('protection_end_date', U.isoDate(date(hv('protection_end'))) || str(hv('protection_end')), hsrc('protection_end'));
      set('upfront_fee_bps', num(hv('upfront')), hsrc('upfront'));
      set('total_transaction_size', num(hv('total_debt')), hsrc('total_debt'));
      set('transaction_group', meta.transaction_group, { table: 'Mapping', col: 'Transaction Group' });
      set('chronological_order', num(hv('chronological_order')), hsrc('chronological_order'));
      set('description', str(hv('description')), hsrc('description'));
      set('wal_years', first ? first.wal : NaN, first && first.src.wal);
      set('greenfield_brownfield', first ? str(first.raw.greenfield) : '', first && first.src.greenfield);
      // ESG
      const es = (field, value, source) => { a.esg[field] = value; if (source) a.src[field] = source; };
      es('esg_score', num(ev('esg_score')), esrc('esg_score')); es('e_score', num(ev('e_score')), esrc('e_score')); es('s_score', num(ev('s_score')), esrc('s_score')); es('g_score', num(ev('g_score')), esrc('g_score'));
      es('ghg_scope1_t', num(ev('ghg1')), esrc('ghg1')); es('ghg_scope2_t', num(ev('ghg2')), esrc('ghg2')); es('ghg_scope3_t', num(ev('ghg3')), esrc('ghg3'));
      const s12 = (U.isNum(a.esg.ghg_scope1_t) ? a.esg.ghg_scope1_t : 0) + (U.isNum(a.esg.ghg_scope2_t) ? a.esg.ghg_scope2_t : 0);
      es('ghg_intensity_t_per_eurm', U.isNum(a.attrs.total_transaction_size) && a.attrs.total_transaction_size > 0 && eg ? s12 / (a.attrs.total_transaction_size / 1e6) : NaN, { table: 'calc', note: 'GHG scope 1+2 ÷ total debt offering (m)' });
      es('chi_sector', str(ev('chi_sector')), esrc('chi_sector')); es('chi_subsector', str(ev('chi_subsector')), esrc('chi_subsector'));
      es('chi_subsubsector', str(ev('chi_subsubsector')), esrc('chi_subsubsector')); es('chi_asset_type', str(ev('chi_asset_type')), esrc('chi_asset_type')); es('chi_asset_specific', str(ev('chi_asset_specific')), esrc('chi_asset_specific'));
      es('green_loan', '', null); es('cbi_taxonomy', '', null); es('sfdr_article', '', null); es('data_coverage', eg ? 'Reported' : '', null);
      // position-level terms shared by the asset (first position; inconsistent ratings are flagged)
      if (first) {
        a.currency = U.uniq(ps.map((p) => p.currency)).length > 1 ? 'Multi' : first.currency;
        a.fixed_floating = first.fixed_floating; a.instrument_type = first.instrument_type;
        a.funding_date = fundingDate; a.maturity_date = first.maturity_date; a.margin_bps = first.margin_bps; a.coupon = NaN;
        a.initial_tenor = fundingDate && a.maturity_date ? U.yearfrac(fundingDate, a.maturity_date) : 0; a.remaining_years = first.remaining_years; a.maturity_bucket = first.maturity_bucket;
        a.rating = first.rating; a.src.rating = first.src.rating;
        const grades = U.uniq(ps.map((p) => p.rating.current_grade));
        if (grades.length > 1) { a.flags.push('rating_inconsistent'); issue('warn', 'Holdings', first.line, `${meta.code_name || code}: positions carry different ratings (${grades.join(', ')}); the first position's rating is used`, { key: code }); }
        const pe = date(a.attrs.protection_end_date);
        a.protected_life_fraction = pe && fundingDate && a.maturity_date && a.maturity_date > fundingDate ? (pe - fundingDate) / (a.maturity_date - fundingDate) : '';
        a.src.nominal = { table: 'calc', note: `Σ nominal over ${ps.length} position(s)` };
      }
      a.active = a.nominal > 0;
      assets.push(a);
    }

    // ---------- Output rows for the selected view ----------
    const unit = S.unit;
    const rows = assets.filter((a) => a.inActiveList && a.platform[platformId] && a.platform[platformId].nominal > 0).map((a) => {
      const pv = a.platform[platformId];
      const r = {
        code: a.code, name: a.name, code_name: a.code_name, transaction_group: a.attrs.transaction_group, asset: a,
        exposure_m: pv.nominal / unit, drawn_m: pv.drawn / unit, commitment_m: pv.commitment / unit, undrawn_m: (pv.nominal - pv.drawn) / unit, drawn_pct: pv.nominal ? pv.drawn / pv.nominal : NaN,
        total_nominal_m: a.nominal / unit, total_drawn_m: a.drawn / unit, total_commitment_m: a.commitment / unit,
        group_nominal_m: a.group_nominal / unit, third_party_nominal_m: a.third_party_nominal / unit, group_drawn_m: a.group_drawn / unit, third_party_drawn_m: a.third_party_drawn / unit,
        group_invested: a.group_invested ? 'Yes' : 'No',
        sector: a.attrs.sector, subsector: a.attrs.subsector, country: a.attrs.country, region: a.attrs.region, sponsor: a.attrs.sponsor, greenfield_brownfield: a.attrs.greenfield_brownfield || '',
        repayment_type: a.attrs.repayment_type, instrument: a.instrument_type || '', watchlist: a.attrs.watchlist, wal_years: U.isNum(a.attrs.wal_years) ? a.attrs.wal_years : NaN,
        deal_year: a.attrs.deal_year, covenant_type: '', covenant_compliance: a.attrs.covenant_compliance, cash_flow_type: a.attrs.cash_flow_type,
        currency: a.currency, fixed_floating: a.fixed_floating, margin_bps: a.margin_bps, coupon: NaN, funding_date: a.funding_date, maturity_date: a.maturity_date,
        initial_tenor: a.initial_tenor, remaining_years: a.remaining_years, maturity_bucket: a.maturity_bucket,
        rating: a.rating ? a.rating.current_grade : '', rating_numeric: a.rating ? a.rating.current_numeric : NaN, ig_label: a.rating ? a.rating.ig_label : '', rating_status: a.rating ? a.rating.status : '',
        internal_grade: a.rating ? a.rating.internal : '', external_grade: a.rating ? a.rating.external_grade : '',
        esg_score: U.isNum(a.esg.esg_score) ? a.esg.esg_score : NaN, green_loan: '', cbi_taxonomy: '', sfdr_article: '',
        ghg_scope12_t: (U.isNum(a.esg.ghg_scope1_t) ? a.esg.ghg_scope1_t : 0) + (U.isNum(a.esg.ghg_scope2_t) ? a.esg.ghg_scope2_t : 0),
        investors: {}, investors_drawn: {}, positions: a.positions.length, flags: a.flags,
      };
      for (const [label, c] of a.byInvestor) { r.investors[label] = c.nominal / unit; r.investors_drawn[label] = c.drawn / unit; }
      return r;
    }).sort((x, y) => y.exposure_m - x.exposure_m);
    rows.forEach((r, i) => { r.rank = i + 1; });

    // ---------- §11 metrics ----------
    const cfgOut = {
      base_currency: S.baseCurrency, ig_threshold: S.igThreshold, single_token: S.singleToken, unit, buckets: S.maturityBuckets,
      attribution_label: S.attributionLabel, dataset_label: input.datasetLabel || '', raw: Object.assign({ base_currency: S.baseCurrency }, S.thresholds),
    };
    const { metrics, distributions } = AUM.summarise(rows, ratingScaleSP, cfgOut);
    const investors = investorColumns.map((label) => {
      const meta = investorMeta.get(label);
      let nominal = 0, drawn = 0, commitment = 0, n = 0, selN = 0, selD = 0;
      for (const a of assets) { const c = a.byInvestor.get(label); if (c) { nominal += c.nominal; drawn += c.drawn; commitment += c.commitment; n += c.positions; } }
      for (const r of rows) { selN += r.investors[label] || 0; selD += r.investors_drawn[label] || 0; }
      return { label, key: meta.key, group: meta.group, group_weight: meta.weight, id: meta.id, nominal_m: nominal / unit, drawn_m: drawn / unit, commitment_m: commitment / unit, positions: n, selected_nominal_m: selN, selected_drawn_m: selD };
    });

    // ---------- §12 checks ----------
    for (const [id, c] of Object.entries(Object.assign({}, checks, hcChecks))) {
      if (!c.total && !c.failed) continue;
      if (!c.total) { // every workbook value was a formula error: nothing to compare
        diag.checks.push({ id, label: c.label, total: 0, matched: 0, failed: c.failed, status: 'skipped', examples: [] });
        issue('info', id.startsWith('hc') ? 'Hardcoded' : 'Holdings', null, `Workbook formula check skipped: ${c.label}: all ${c.failed} workbook values are formula errors (e.g. #REF!, usually a reference to a sheet not exported with the four). Scope calculates these itself`);
        continue;
      }
      const status = c.matched === c.total ? 'ok' : c.matched / c.total > 0.95 ? 'warn' : 'error';
      diag.checks.push({ id, label: c.label, total: c.total, matched: c.matched, failed: c.failed || 0, status, examples: c.examples });
      if (c.failed) issue('info', id.startsWith('hc') ? 'Hardcoded' : 'Holdings', null, `Workbook formula check: ${c.label}: ${c.failed} workbook value(s) are formula errors and were not compared`);
      if (status !== 'ok') issue(status === 'warn' ? 'warn' : 'error', id.startsWith('hc') ? 'Hardcoded' : 'Holdings', null, `Workbook formula check: ${c.label}: ${c.total - c.matched} of ${c.total} differ (see Data › Checks)`);
    }
    const fcUnknown = fundCheck.filter((fc) => !blank(fc.holdings) && !investorMeta.has(resolve(str(fc.holdings))) && !/platform|total|commitment|drawn|nominal|exposure/.test(norm(fc.holdings))).map((fc) => str(fc.holdings));
    if (fcUnknown.length) issue('info', 'Mapping', null, `Fund Check lists names that are not investor columns in Funding Name: ${fcUnknown.join(', ')}`);
    diag.fundCheck = fundCheck.map((r) => ({ row: r.__row, mapping: str(r.mapping), holdings: str(r.holdings), known: investorMeta.has(resolve(str(r.holdings))) }));
    diag.gaps = gaps;
    if (paddingRows) issue('info', 'Holdings', null, `${paddingRows} row(s) below the data hold only copied formulas (e.g. "0x0") and are ignored`);
    if (reportingDate && asOf.some((d) => +d !== +reportingDate)) issue('info', 'Holdings', null, `Reporting dates differ between rows; the earliest (${U.isoDate(reportingDate)}) is used, as in the workbook`);

    const excludedPositions = positions.filter((p) => p.excluded);
    const sev = { error: 0, warn: 0, info: 0 }; issues.forEach((i) => { sev[i.severity] = (sev[i.severity] || 0) + 1; });
    const fatal = !H || !H.map.security_id || !H.map.nominal || !H.map.currency;
    return {
      config: cfgOut, ratingScale: ratingScaleSP, displayCurrency: displayCcy, currencies: [S.baseCurrency].concat(Array.from(fxTable.keys()).filter((c) => c !== S.baseCurrency && U.isNum(perEur(c)))).filter((c, i, a) => a.indexOf(c) === i),
      reportingDate, quarter: U.quarterCaption(reportingDate),
      platform, platformId, platforms, investors, investorColumns, assets, positions, rows, metrics, distributions, issues, issueCounts: sev,
      stats: { holdingsRows: H ? H.g.rows.length - H.hr - 1 : 0, paddingRows, positions: positions.length, excluded: excludedPositions.length, included: positions.length - excludedPositions.length,
        assetsMapped: assets.length, assetsActive: assets.filter((a) => a.active).length, assetsSelected: rows.length, filteredOut: filteredOutCount, inView: positions.filter(inView).length },
      excludedPositions, fatal, filtered: !!keepLines, inputs: diag, fundRegister,
    };
  };
  AUM.compute = AUM.run; // older callers

  // =====================================================================================================================
  // §11  PORTFOLIO METRICS AND DISTRIBUTIONS (used for the full Output and for any filtered subset of rows)
  // =====================================================================================================================
  /** Dimensions for filters and breakdowns of Output rows (labels match the distributions below). */
  AUM.DIMENSIONS = {
    sector: { label: 'Sector', key: (r) => r.sector }, subsector: { label: 'Subsector', key: (r) => r.subsector }, country: { label: 'Country', key: (r) => r.country }, region: { label: 'Region', key: (r) => r.region },
    currency: { label: 'Currency', key: (r) => r.currency }, rating: { label: 'Rating', key: (r) => (r.rating_status === 'rated' ? r.rating : 'NR') }, ig: { label: 'IG / Sub-IG', key: (r) => (r.rating_status === 'rated' ? r.ig_label : 'NR') },
    fixed_floating: { label: 'Fixed / floating', key: (r) => r.fixed_floating }, repayment_type: { label: 'Repayment', key: (r) => r.repayment_type }, instrument: { label: 'Instrument', key: (r) => r.instrument },
    watchlist: { label: 'Watchlist', key: (r) => r.watchlist }, maturity_bucket: { label: 'Maturity bucket', key: (r) => r.maturity_bucket }, sponsor: { label: 'Sponsor', key: (r) => r.sponsor },
    cash_flow_type: { label: 'Cash-flow type', key: (r) => r.cash_flow_type }, covenant_compliance: { label: 'Covenant compliance', key: (r) => r.covenant_compliance },
    transaction_group: { label: 'Transaction group', key: (r) => r.transaction_group }, deal_year: { label: 'Deal year', key: (r) => String(r.deal_year || '') },
  };

  /**
   * Exposure-weighted metrics and distributions for a set of Output rows. Weighted averages skip rows without a value
   * (coverage is reported); the weighted rating uses rated rows and takes the nearest S&P/Fitch-style label; sub-IG
   * excludes NR exposure, which is reported separately.
   */
  AUM.summarise = function (rows, ratingScaleSP, cfg) {
    const total = U.sum(rows, (r) => r.exposure_m), drawn = U.sum(rows, (r) => r.drawn_m);
    const wavg = (f) => { let n = 0, d = 0; for (const r of rows) { const v = f(r); if (U.isNum(v)) { n += v * r.exposure_m; d += r.exposure_m; } } return d ? n / d : NaN; };
    const coverage = (f) => { let d = 0; for (const r of rows) if (U.isNum(f(r))) d += r.exposure_m; return total ? d / total : 0; };
    const rated = rows.filter((r) => r.rating_status === 'rated');
    const wRating = (() => { let n = 0, d = 0; for (const r of rated) { n += r.rating_numeric * r.exposure_m; d += r.exposure_m; } return d ? n / d : NaN; })();
    let wRatingLabel = 'NR';
    if (U.isNum(wRating) && ratingScaleSP.length) { let best = null; for (const s of ratingScaleSP) if (!best || Math.abs(s.numeric - wRating) < Math.abs(best.numeric - wRating)) best = s; wRatingLabel = best.grade; }
    const ig = U.sum(rows.filter((r) => r.ig_label === 'IG' && r.rating_status === 'rated'), (r) => r.exposure_m);
    const nr = U.sum(rows.filter((r) => r.rating_status !== 'rated'), (r) => r.exposure_m);
    const share = (pred) => (total ? U.sum(rows.filter(pred), (r) => r.exposure_m) / total : NaN);
    const book = U.sum(rows, (r) => r.total_nominal_m);
    const metrics = {
      total_exposure_m: total, total_drawn_m: drawn, total_undrawn_m: total - drawn, drawn_pct: total ? drawn / total : NaN, total_commitment_m: U.sum(rows, (r) => r.commitment_m),
      n_assets: rows.length, n_positions: U.sum(rows, (r) => r.positions),
      book_total_m: book, book_group_m: U.sum(rows, (r) => r.group_nominal_m), book_third_party_m: U.sum(rows, (r) => r.third_party_nominal_m),
      group_share_of_book: book ? U.sum(rows, (r) => r.group_nominal_m) / book : NaN,
      w_margin_bps: wavg((r) => r.margin_bps), margin_coverage: coverage((r) => r.margin_bps), w_wal_years: wavg((r) => r.wal_years), wal_coverage: coverage((r) => r.wal_years),
      w_remaining_years: wavg((r) => r.remaining_years), w_initial_tenor: wavg((r) => r.initial_tenor),
      w_rating_numeric: wRating, w_rating_label: wRatingLabel, rated_share: total ? 1 - nr / total : NaN, sub_ig_share: total ? 1 - ig / total - nr / total : NaN, nr_share: total ? nr / total : NaN,
      fixed_share: share((r) => r.fixed_floating === 'Fixed'), green_share: NaN, watchlist_share: share((r) => r.watchlist && !/^(no|n|none)$/i.test(r.watchlist)),
      w_esg_score: wavg((r) => r.esg_score), esg_coverage: coverage((r) => r.esg_score), ghg_scope12_t: U.sum(rows, (r) => r.ghg_scope12_t),
    };
    /** Exposure by category: explicit order, label order, or exposure descending. */
    const dist = (keyFn, opts) => {
      const m = new Map();
      for (const r of rows) { const k = keyFn(r) || '(blank)'; if (!m.has(k)) m.set(k, { label: k, exposure_m: 0, drawn_m: 0, count: 0 }); const d = m.get(k); d.exposure_m += r.exposure_m; d.drawn_m += r.drawn_m; d.count++; }
      const arr = Array.from(m.values()); arr.forEach((d) => { d.share = total ? d.exposure_m / total : 0; d.value = d.exposure_m; });
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
      watchlist: dist((r) => r.watchlist, { order: ['No', 'Watch', 'Intensive'] }), maturity_bucket: dist((r) => r.maturity_bucket, { order: cfg.buckets.map((b) => b + ' y').concat(['Matured', 'Unknown']) }),
      sponsor: dist((r) => r.sponsor), cash_flow_type: dist((r) => r.cash_flow_type), covenant_compliance: dist((r) => r.covenant_compliance), transaction_group: dist((r) => r.transaction_group),
      deal_year: dist((r) => String(r.deal_year || ''), { sortLabel: true }), greenfield: dist(() => ''), green_loan: dist(() => ''), cbi_taxonomy: dist(() => ''), sfdr_article: dist(() => ''),
      group_split: [{ label: `${cfg.attribution_label} attributed`, value: metrics.book_group_m, exposure_m: metrics.book_group_m }, { label: 'Third party', value: metrics.book_third_party_m, exposure_m: metrics.book_third_party_m }],
    };
    return { metrics, distributions };
  };

  /** Output rows as flat records for CSV export (one column per investor for nominal and drawn). */
  AUM.outputRecords = function (res) {
    const f = U.isoDate;
    return res.rows.map((r) => {
      const o = { rank: r.rank, identification_id: r.code, project_name: r.name, code_name: r.code_name, transaction_group: r.transaction_group, view: res.platform.label, currency_display: res.displayCurrency,
        exposure_m: r.exposure_m, drawn_m: r.drawn_m, undrawn_m: r.undrawn_m, drawn_pct: r.drawn_pct, commitment_m: r.commitment_m,
        total_nominal_m: r.total_nominal_m, group_nominal_m: r.group_nominal_m, third_party_nominal_m: r.third_party_nominal_m, total_drawn_m: r.total_drawn_m, group_drawn_m: r.group_drawn_m, third_party_drawn_m: r.third_party_drawn_m, group_invested: r.group_invested,
        sector: r.sector, subsector: r.subsector, country: r.country, region: r.region, sponsor: r.sponsor, repayment_type: r.repayment_type, instrument: r.instrument, cash_flow_type: r.cash_flow_type,
        position_currency: r.currency, fixed_floating: r.fixed_floating, spread_bps: r.margin_bps, funding_date: f(r.funding_date), maturity_date: f(r.maturity_date), initial_tenor: r.initial_tenor, remaining_years: r.remaining_years,
        maturity_bucket: r.maturity_bucket, wal_years: r.wal_years, internal_grade: r.internal_grade, external_grade: r.external_grade, current_rating: r.rating, rating_score: r.rating_numeric,
        ig_label: r.rating_status === 'rated' ? r.ig_label : 'NR', watchlist: r.watchlist, covenant_compliance: r.covenant_compliance, esg_score: r.esg_score, ghg_scope12_t: r.ghg_scope12_t, positions: r.positions, flags: r.flags.join('|') };
      for (const label of res.investorColumns) o['nominal_m: ' + label] = r.investors[label] || 0;
      for (const label of res.investorColumns) o['drawn_m: ' + label] = r.investors_drawn[label] || 0;
      return o;
    });
  };

  /** Positions as flat records for CSV export (the workbook's Calculations sheet, with the source row of each). */
  AUM.positionRecords = function (res) {
    const f = U.isoDate;
    return res.positions.filter((p) => !p.filteredOut).map((p) => ({ holdings_row: p.line, unique_identifier: p.key, investor_code: p.investor_id, investor: p.investor_label, investor_group: p.investor_group,
      security_id: p.holding_id, security_name: p.security_name, identification_id: p.asset_code || '', project_name: p.asset_name, code_name: p.code_name || '',
      currency: p.currency, nominal: p.nominal, drawn: p.drawn, commitment: p.commitment, fx_rate_per_eur: p.fx_rate, nominal_eur: p.nominal_eur, drawn_eur: p.drawn_eur,
      ['nominal_' + res.displayCurrency]: p.nominal_base, ['drawn_' + res.displayCurrency]: p.drawn_base,
      internal_grade: p.rating.internal, fitch: p.rating.fitch, moodys: p.rating.moodys, sp: p.rating.sp, external_grade: p.rating.external_grade, current_grade: p.rating.current_grade, rating_score: p.rating.current_numeric,
      ig_label: p.rating.status === 'rated' ? p.rating.ig_label : 'NR', maturity_date: f(p.maturity_date), fixed_floating: p.fixed_floating, spread_bps: p.margin_bps, remaining_years: p.remaining_years, maturity_bucket: p.maturity_bucket,
      excluded: p.excluded ? 'Y' : '', exclusion_reason: p.exclusionReason || '', flags: p.flags.join('|') }));
  };

  // =====================================================================================================================
  // SETTINGS OUT: the settings in force, as data and as a ready-to-use "Scope Settings" sheet (the layout of §1b)
  // =====================================================================================================================
  /**
   * The settings in force for a result (app changes, Scope Settings sheet and §1 defaults merged), named by the workbook's
   * own investor names so the sheet stays valid if display names change:
   * { attribution, columns: [{ column, name, type, weight, weightText }], views: [{ view, formula, defined, lookThroughOf }],
   *   fxException: [{ investor, currency, view, rate, note }], settings: [{ setting, value }] }
   * "Total platform" (every column), the attribution view and single investor columns are not listed as views.
   */
  AUM.effectiveSettings = function (res) {
    const d = (res && res.inputs) || {}, inv = d.investors || [], cfg = (res && res.config) || {};
    const byLabel = new Map(inv.map((i) => [i.label, i]));
    const orig = (label) => (byLabel.has(label) ? byLabel.get(label).original || label : label);
    const columns = inv.map((i) => ({ column: i.original || i.label, name: i.label !== (i.original || i.label) ? i.label : '', type: i.group && i.group !== 'Unclassified' && i.group !== 'Unmapped' ? i.group : '', weight: i.source === 'default' ? '' : i.weight, weightText: i.weightText || '' }));
    const views = [];
    for (const v of d.views || []) {
      if (v.def === '*' || v.def === 'column' || v.def === 'group') continue;
      const terms = (v.raw || v.composition || []).filter((c) => c.label !== '*' && c.weight).map((c) => ({ name: orig(c.label), weight: c.weight, text: c.text || '' }));
      views.push({ view: v.view, formula: AUM.formulaText(terms), terms, defined: v.kind !== 'undefined', lookThroughOf: v.lookThroughOf || null });
    }
    const fxException = (d.fxException || []).map((x) => ({ investor: x.investor, currency: x.currency, view: x.view || '', rate: x.column ? x.column : x.rate, note: x.note || '' }));
    const fx = d.fx || {}, quote = fx.quote;
    const settings = [
      { setting: 'Attribution label', value: cfg.attribution_label || CONFIG.attributionLabel },
      { setting: 'IG threshold', value: U.isNum(cfg.ig_threshold) ? cfg.ig_threshold : CONFIG.igThreshold },
      { setting: 'Base currency', value: cfg.base_currency || CONFIG.baseCurrency },
      { setting: 'FX quote', value: quote === 'eur_per_ccy' ? 'EUR per unit' : quote === 'ccy_per_eur' ? 'Units per EUR' : 'Auto' },
      { setting: 'FX rate source', value: fx.source === 'position' ? "Each position's own rate" : 'Workbook: one rate per currency, from the reference investor' },
      { setting: 'FX reference investor', value: fx.reference || '' },
      { setting: 'Single portfolio token', value: cfg.single_token || CONFIG.singleToken },
      { setting: 'Maturity buckets', value: (cfg.buckets || CONFIG.maturityBuckets).join(', ') },
    ];
    return { attribution: cfg.attribution_label || CONFIG.attributionLabel, columns, views, fxException, settings };
  };

  /**
   * Lay settings (from effectiveSettings) out as the "Scope Settings" sheet: four tables side by side, titles in row 2 and
   * headers in row 3: Investors (B:E), Views (G:H, one formula per view), FX Exception (J:N), Settings (P:Q). A note sits
   * in B1. Returns a grid { name, rows } for the workbook writer or CSV export.
   */
  AUM.settingsGrid = function (eff) {
    const e = eff || { attribution: CONFIG.attributionLabel, columns: [], views: [], fxException: [], settings: [] };
    const rows = [];
    const put = (r, c, v) => { while (rows.length <= r) rows.push([]); rows[r][c] = v === undefined || v === '' ? null : v; };
    /** One table: title in row 2, headers in row 3, records from row 4, starting at an Excel column letter. */
    const table = (letter, title, headers, records) => { const c0 = colIndex(letter); put(1, c0, title); headers.forEach((hd, k) => put(2, c0 + k, hd)); records.forEach((rec, i) => rec.forEach((v, k) => put(3 + i, c0 + k, v))); };
    const label = e.attribution || CONFIG.attributionLabel;
    put(0, colIndex('B'), `${SETTINGS_SHEET}: how much of each investor column the ${label} owns (as in the workbook's Output header row), and a formula for each view that is not a plain investor column (as in the Calculations sheet, with names instead of column letters). Weights: 1, 0.35, 35% or 7/20. A view named "<investor> incl. part in funds" also says which share of each fund's units that investor holds.`);
    table('B', 'Investors', ['Investor column', 'Type', 'Display name', `${label} ownership`], e.columns.map((c) => [c.column, c.type || null, c.name || null, c.weightText ? c.weightText : c.weight === '' || c.weight === undefined || c.weight === null ? null : c.weight]));
    table('G', 'Views', ['View', 'Formula'], e.views.map((v) => [v.view, v.formula || (v.terms ? AUM.formulaText(v.terms) : '') || null]));
    table('J', 'FX Exception', ['Investor', 'Currency', 'View', 'Rate', 'Note'], e.fxException.map((x) => [x.investor, x.currency, x.view, x.rate, x.note]));
    table('P', 'Settings', ['Setting', 'Value'], e.settings.map((x) => [x.setting, x.value]));
    return { name: SETTINGS_SHEET, rows };
  };

  /**
   * A plain-text diagnostics report of how a result's inputs were read: sheets, header rows, column roles, key checks,
   * Mapping tables (with the headers actually found and sample values), settings tables, views, investors, FX, the
   * workbook checks and the issues grouped by cause. Headers, titles, names and a few sample IDs appear; amounts do not.
   */
  AUM.diagnosticsText = function (res) {
    const d = (res && res.inputs) || {}, L = [];
    const push = (x) => L.push(x);
    push(`Scope diagnostics · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · dataset: ${(res.config || {}).dataset_label || ''}`);
    if ((d.diagnosis || []).length) { push('\n== DIAGNOSIS'); for (const m of d.diagnosis) push('  ' + m); }
    push('\n== SHEETS'); for (const [k, x] of Object.entries(d.sheets || {})) push(`  ${k.padEnd(15)} ${x.present ? (k === 'Mapping' ? 'present' : 'header row ' + (x.headerRow || 'NOT FOUND') + ' · ' + ((x.columns || []).length) + ' headers · data from row ' + (x.dataStart || '?')) : 'MISSING'}${x.source ? ' · ' + (x.source.kind || '') + ' ' + (x.source.file || '') + (x.source.sheetName ? ' [' + x.source.sheetName + ']' : '') : ''}`);
    push('\n== KEY COLUMNS (values checked against Mapping)'); for (const k of d.keyChecks || []) push(`  ${k.label.padEnd(40)} column ${k.column} "${k.header}": ${k.tested ? Math.round(k.rate * 100) + '% of ' + k.tested + ' values found' : 'nothing to test'}${k.corrected ? ' → corrected to column ' + k.corrected.column + ' "' + k.corrected.header + '" (' + Math.round(k.corrected.rate * 100) + '%)' : ''}${k.manual ? ' (chosen on the Columns tab)' : ''}`);
    push('\n== COLUMN ROLES'); for (const r of d.roles || []) if (!r.role.startsWith('wb_')) push(`  ${(r.sheet + '.' + r.role).padEnd(36)} ${r.letter ? r.letter + ' "' + r.header + '"' + (r.output ? ' (row 2: "' + r.output + '")' : '') + ' via ' + r.via : (r.required ? 'MISSING (required)' : 'missing (optional)') + ' · looked for: ' + (r.candidates || []).slice(0, 6).join(' | ')}`);
    push('\n== MAPPING TABLES'); for (const [k, t] of Object.entries(d.tables || {})) push(`  ${k.padEnd(16)} "${t.title}" ${t.foundBy} at ${t.titleCell} · header row ${t.headerRow} · columns ${JSON.stringify(t.columns)} · ${t.rows} rows · headers found: ${(t.headersSeen || []).join(', ') || 'none'}${t.samples ? ' · samples: ' + Object.entries(t.samples).map(([c, v]) => c + '=' + v.join('/')).join(' ') : ''}`);
    const st = d.settings || {}; push(`\n== SCOPE SETTINGS ${st.present ? 'present: ' + Object.entries(st.tables || {}).map(([k, t]) => k + ' ' + (t.found ? (t.rows !== undefined ? t.rows + ' rows' : 'found') + (t.form ? ' (' + t.form + ')' : '') : 'not found')).join(' · ') : 'absent'}`);
    push('\n== VIEWS'); for (const v of d.views || []) push(`  ${v.view.padEnd(34)} ${(v.kind || '').padEnd(16)} ${v.def === '*' ? 'every column' : v.def === 'group' ? 'attribution weights' : v.formula || '(undefined)'}${v.lookThroughBase ? '  [look-through of ' + v.lookThroughBase + ']' : ''}`);
    push(`\n== INVESTOR COLUMNS ${(d.investors || []).length}`); for (const i of d.investors || []) push(`  ${String(i.id).padEnd(10)} ${String(i.original).padEnd(32)} ${(i.group || '').padEnd(14)} ownership ${i.weightText || i.weight}${i.typeInferred ? ' (type inferred)' : ''}${i.label !== i.original ? ' shown as "' + i.label + '"' : ''}`);
    push(`\n== LOOK-THROUGH ${(res.fundRegister || []).length} row(s): ` + (res.fundRegister || []).map((x) => `${x.holder_label} holds ${(x.share * 100).toFixed(2)}% of ${x.fund_label}`).join(' · '));
    const g = d.gaps || { securities: [], investors: [], inactive: [] };
    push(`\n== MAPPING GAPS securities ${g.securities.length} (${g.securities.slice(0, 10).map((x) => x.holdingId).join(', ')}${g.securities.length > 10 ? ', …' : ''}) · investor codes ${g.investors.length} (${g.investors.slice(0, 10).map((x) => x.investorId).join(', ')}) · assets outside Active Assets ${g.inactive.length} (${g.inactive.slice(0, 10).map((x) => x.codeName).join(', ')})`);
    const fx = d.fx || {}; push(`\n== FX quote ${fx.quote} · source ${fx.source} · reference investor "${fx.reference}" · RC check ${JSON.stringify(fx.test)} · rates ${(fx.table || []).map((x) => x.currency + '=' + x.rate + ' (' + x.source + ')').join(' ')}`);
    push('\n== WORKBOOK FORMULA CHECKS'); for (const c of d.checks || []) push(`  ${c.status.padEnd(8)} ${c.matched}/${c.total}${c.failed ? ' (' + c.failed + ' formula errors skipped)' : ''}  ${c.label}`);
    const groups = new Map(); for (const i of res.issues || []) { const k = i.severity + ' | ' + i.table + ' | ' + i.message.replace(/\d[\d,.]*/g, '#').slice(0, 140); groups.set(k, (groups.get(k) || 0) + 1); }
    push(`\n== ISSUES ${JSON.stringify(res.issueCounts || {})}`); for (const [k, n] of Array.from(groups).sort((a, b) => b[1] - a[1]).slice(0, 40)) push(`  ${String(n).padStart(4)} × ${k}`);
    const s = res.stats || {}; push(`\n== RESULT view "${res.platformId}" · positions ${s.positions} (${s.excluded} excluded) · assets mapped ${s.assetsMapped}, in Output ${(res.rows || []).length} · reporting date ${U.isoDate(res.reportingDate)}${res.fatal ? ' · FATAL: a required column or sheet is missing' : ''}`);
    return L.join('\n') + '\n';
  };

  AUM.colName = colName; AUM.colIndex = colIndex; AUM.cellRef = cellRef; AUM.norm = norm;
  AUM.locateMapping = locateMapping; AUM.MAPPING_TABLES = MAPPING_TABLES; AUM.isAttributionName = isAttributionName; AUM.SETTING_KEYS = SETTING_KEYS;
})(typeof window !== 'undefined' ? window : globalThis);
