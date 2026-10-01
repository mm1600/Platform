/* Scope · AUM calculation (the single, auditable calculation file for the AUM coverage task).
 *
 * INPUTS: exactly four sheets of the AUM workbook, as cell grids (rows[r][c] = Excel row r+1, column c+1):
 *   Holdings       position extract; headers in row 3 (from column B), output names in row 2 (= XLOOKUP(row 3, Mapping!C:D))
 *   Mapping        six tables side by side, title in row 2, headers in row 3: References (C:D), Active Assets (H:M),
 *                  Security Mapping (P helper, Q:U), Funding Name (Y:AA), Investment Grade Mapping (AC:AE), Fund Check (AH:AI…)
 *   Hardcoded      manual deal fields keyed by Security ID (headers in row 3 from column C; lookup labels in row 2)
 *   ESG Hardcoded  ESG scores, taxonomy and GHG keyed by Security ID (same layout)
 *   Scope Settings OPTIONAL fifth sheet: investor names, groups and weights, view definitions, fund look-through, FX exception (§1b)
 *
 * The sheets may keep their formulas: the reader takes each formula's saved result, and §12 compares the workbook's own
 * formula columns with this file's values (a formula that failed in the workbook, e.g. #REF!, is skipped, not counted).
 *
 * The file reads top to bottom in the same order as the workbook:
 *   §1  Defaults for what the four sheets do not hold (views, investor groups and weights, look-through, FX exception, thresholds)
 *   §1b The optional Scope Settings sheet, which overrides those defaults per workbook (and is overridden by changes in the app)
 *   §2  Where each input lives: sheet layouts and column roles (matched by header name, so column moves do not break it)
 *   §3  Reading the sheets: locate header rows and the six Mapping tables
 *   §4  Mapping lookups (References, Active Assets, Security Mapping, Funding Name, Investment Grade, Fund Check)
 *   §5  Holdings: the workbook's formula columns B–F recomputed, then one position per row
 *   §6  Ratings branch (internal unless NR, else worst agency; IG ≤ threshold)
 *   §7  FX: amounts ÷ rate (units per EUR), direction verified against the RC column
 *   §8  Hardcoded and ESG Hardcoded lookups per asset
 *   §9  Investor columns, asset × investor matrices, group attribution, the fund look-through register
 *   §10 Views (the Output!G8 platform choices) and the Output rows
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
  // In the workbook these live inside Calculations / Output formulas (header-row weights, special look-through columns,
  // the hard-coded FX exception). They are collected here so they can be read, reviewed and changed in one place.
  // The Data page can override views, investor classes, column roles and the FX quote per browser (shown as overrides).
  // =====================================================================================================================
  const CONFIG = {
    baseCurrency: 'EUR',
    // 'ccy_per_eur': EUR amount = amount ÷ rate (the workbook's formula); 'eur_per_ccy': amount × rate;
    // 'auto': test both against the RC (reference-currency) column and use the one that reproduces it.
    fxQuote: 'auto',
    igThreshold: 610,                 // rating score strictly above this = SUB IG (Mapping!AC:AD scale; higher = weaker)
    singleToken: 'SINGLE',            // Holdings: Model Portfolio = SINGLE → use Portfolio as the investor code
    unit: 1e6,                        // Output amounts in millions
    maturityBuckets: ['0-3', '3-5', '5-10', '10-20', '20+'],
    attributionLabel: 'Group',        // name of the attributed investor group in every label ("Group attributed", …)
    spreadUnit: 'auto',               // 'bps' | 'percent' | 'auto' (values below 20 are read as percent and × 100)
    // ---- The settings below are DEFAULTS. A workbook can carry its own in an optional fifth sheet, "Scope Settings" (§1b),
    // and anything changed on the Data page overrides both. Precedence: changed in the app > Scope Settings sheet > here.
    // Views (Mapping!H, the Output!G8 choices). A view equal to an investor column needs no entry. Others are defined here:
    //   '*' = every investor column · 'group' = Σ group weight × column · [[investor, weight], …] or [investor, …] (weight 1)
    views: { 'Total platform': '*' },
    // Investor column (Mapping!Z holdings name) → [group, attribution weight] (the workbook's row-3/row-4 inclusion
    // weights: 1 = group entity, 0 = third party, 0.35 = fund 35% held by the group). Unlisted investors: 'Unclassified', 0.
    investors: {},
    // Fund look-through: who holds the units of each fund investor column, as shares of the fund (the remainder is held
    // outside the platform): { fund: [[holder, share], …] }. Group-entity holders' shares should equal the fund's weight.
    fundHolders: {},
    // The workbook's FX exception, as data: positions of `investor` in `currency` use `rate` when `view` is selected.
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
  // A fifth sheet a workbook can carry so every drop is configured: five tables side by side, title in row 2, headers in
  // row 3 (same convention as Mapping). Names refer to the workbook's investor columns (Mapping!Z) or their display names.
  //   Investors     (B:E)  Investor Column · Display Name · Group · Attribution Weight
  //   Views         (G:I)  View · Investor Column · Weight            one row per component; "All investors" = '*', "Group weights" = 'group'
  //   Look Through  (K:M)  Investor · Fund · Share                    Investor 1 holds 15% of Fund A → Investor 1 | Fund A | 15%
  //   FX Exception  (O:S)  Investor · Currency · View · Rate · Note
  //   Settings      (U:V)  Setting · Value                            Attribution label, IG threshold, FX quote, Spread unit, …
  // =====================================================================================================================
  const SETTINGS_SHEET = 'Scope Settings';
  AUM.SETTINGS_SHEET = SETTINGS_SHEET;
  const SETTINGS_TABLES = {
    investors: { title: ['Investors'], cols: { column: ['Investor Column', 'Investor', 'Holdings Name'], name: ['Display Name', 'Name'], group: ['Group'], weight: ['Attribution Weight', 'Weight', 'Group Weight'] }, fallback: 'B' },
    views: { title: ['Views'], cols: { view: ['View'], column: ['Investor Column', 'Investor', 'Component'], weight: ['Weight'] }, fallback: 'G' },
    lookThrough: { title: ['Look Through', 'Look-through', 'Fund Look Through'], cols: { investor: ['Investor', 'Holder'], fund: ['Fund'], share: ['Share', 'Ownership'] }, fallback: 'K' },
    fxException: { title: ['FX Exception', 'FX Exceptions'], cols: { investor: ['Investor'], currency: ['Currency'], view: ['View'], rate: ['Rate'], note: ['Note'] }, fallback: 'O' },
    settings: { title: ['Settings'], cols: { setting: ['Setting'], value: ['Value'] }, fallback: 'U' },
  };
  // Settings table rows the calculation understands (case and spacing ignored) → CONFIG key and parser.
  const SETTING_KEYS = {
    attributionlabel: ['attributionLabel', (v) => String(v).trim()], igthreshold: ['igThreshold', (v) => U.toNumber(v)], basecurrency: ['baseCurrency', (v) => String(v).trim().toUpperCase()],
    fxquote: ['fxQuote', (v) => { const n = String(v).toLowerCase(); return /auto/.test(n) ? 'auto' : /eur per|×|multiply|eurperccy/.test(n) ? 'eur_per_ccy' : /per eur|÷|divide|ccyper/.test(n) ? 'ccy_per_eur' : null; }],
    spreadunit: ['spreadUnit', (v) => { const n = String(v).toLowerCase(); return /bp/.test(n) ? 'bps' : /per/.test(n) ? 'percent' : /auto/.test(n) ? 'auto' : null; }],
    singleportfoliotoken: ['singleToken', (v) => String(v).trim()], maturitybuckets: ['maturityBuckets', (v) => String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean)],
  };
  /** Share from a cell: 0.15, "15%", or a whole number above 1 read as percent (15 → 0.15). */
  const shareOf = (v) => { if (v === null || v === undefined || v === '') return NaN; const t = String(v).trim(); const n = U.toNumber(t); if (!U.isNum(n)) return NaN; return /%$/.test(t) || n > 1 ? n / 100 : n; };
  /**
   * Read the Scope Settings sheet into { investors: Map(normName → {column, name, group, weight, row}), views: Map(normView →
   * {view, def}), lookThrough: [{investor, fund, share, row}], fxException: [...], scalars: {CONFIG key: value}, diag }.
   */
  function readSettingsSheet(g, issue) {
    const t = locateTables(g, SETTINGS_TABLES), out = { investors: new Map(), views: new Map(), lookThrough: [], fxException: [], scalars: {}, diag: {} };
    for (const [k, tb] of Object.entries(t)) out.diag[k] = { title: tb.title, found: tb.rows.length > 0 || Object.keys(tb.cols).length > 0, foundBy: tb.foundBy, titleCell: tb.titleCell, headerRow: tb.headerRow + 1, rows: tb.rows.length };
    for (const r of t.investors.rows) {
      const column = str(r.column); if (!column) continue;
      const w = blank(r.weight) ? NaN : shareOf(r.weight);
      out.investors.set(norm(column), { column, name: str(r.name), group: str(r.group), weight: w, row: r.__row });
    }
    for (const r of t.views.rows) {
      const view = str(r.view); if (!view) continue;
      const k = norm(view), comp = str(r.column), w = blank(r.weight) ? 1 : U.toNumber(r.weight);
      const cur = out.views.get(k) || { view, def: null, row: r.__row };
      if (!comp) { out.views.set(k, cur); continue; } // a view listed without components stays undefined (to fill in)
      if (/^(\*|all|all investors|total)$/i.test(comp)) cur.def = '*';
      else if (/^group( weights?)?$/i.test(comp)) cur.def = 'group';
      else { if (!Array.isArray(cur.def)) cur.def = []; cur.def.push([comp, U.isNum(w) ? w : 1]); }
      out.views.set(k, cur);
    }
    for (const r of t.lookThrough.rows) {
      const investor = str(r.investor), fund = str(r.fund), share = shareOf(r.share);
      if (!investor || !fund) continue;
      if (!U.isNum(share)) { issue('warn', SETTINGS_SHEET, r.__row, `Look Through: share "${str(r.share)}" for ${investor} in ${fund} is not a number; row ignored`); continue; }
      out.lookThrough.push({ investor, fund, share, row: r.__row });
    }
    for (const r of t.fxException.rows) {
      const rate = U.toNumber(r.rate); if (!str(r.investor) || !str(r.currency) || !U.isNum(rate)) continue;
      out.fxException.push({ investor: str(r.investor), currency: str(r.currency).toUpperCase(), view: str(r.view), rate, note: str(r.note) || 'Scope Settings sheet', row: r.__row });
    }
    for (const r of t.settings.rows) {
      const spec = SETTING_KEYS[norm(r.setting)]; if (!spec || blank(r.value)) continue;
      const v = spec[1](r.value); if (v === null || v === undefined || (typeof v === 'number' && !U.isNum(v))) { issue('warn', SETTINGS_SHEET, r.__row, `Settings: "${str(r.value)}" is not a valid value for ${str(r.setting)}; ignored`); continue; }
      out.scalars[spec[0]] = v;
    }
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
  const ROLES = {
    Holdings: {
      model_portfolio: role('Model portfolio', true, ['Model Portfolio'], ['Model Portfolio']),
      portfolio: role('Portfolio', true, ['Portfolio'], ['Portfolio']),
      security_id: role('Security ID (holding ID)', true, ['Security ID'], ['Security ID']),
      security_name: role('Security name', false, ['Security Name'], ['Security Name']),
      reporting_date: role('Reporting date', true, ['Reporting Date'], ['Reporting Date']),
      currency: role('Position currency', true, ['Currency', 'Quotation Currency'], ['Quotation Currency', 'Currency']),
      fx_rate: role('FX rate', true, ['FX Rate', 'FX'], ['FX Rate EC', 'FX Rate', 'FX Rate EUR']),
      nominal: role('Nominal (exposure)', true, ['Nominal', 'Nominal Amount', 'Exposure'], ['RA_Commitment QC', 'RA Commitment QC']),
      drawn: role('Drawn amount', true, ['Drawn', 'Drawn Amount'], ['Current Drawn Amount CCY', 'Current Drawn Amount QC']),
      commitment: role('Commitment', false, ['Commitment', 'Initial Commitment'], ['Initial Commitment Amount CCY']),
      nominal_rc: role('Nominal in reference currency (FX check)', false, ['Nominal RC'], ['RA Commitment RC']),
      maturity_date: role('Maturity date', false, ['Maturity Date'], ['Maturity Date']),
      purchase_date: role('Purchase date', false, ['Purchase Date'], ['Purchase Date']),
      rate_type: role('Rate type', false, ['Rate Type'], ['Rate Type']),
      spread: role('Spread', false, ['Spread at Acquisition', 'Spread'], ['All-in Spread at Acquisition', 'Spread']),
      wal: role('WAL', false, ['WAL'], ['WAL']),
      internal_rating: role('Internal rating', false, ['Internal Rating'], ['Internal Current Rating', 'Internal Rating']),
      closing_rating: role('Closing rating', false, ['Closing Rating'], [], [/ratingclosing$/]),
      fitch: role('Fitch rating', false, ['Fitch'], ['Rating Fitch']),
      sp: role('S&P rating', false, ['S&P'], ['Rating S&P', 'Rating SP']),
      moodys: role("Moody's rating", false, ["Moody's"], ["Rating Moody's", 'Rating Moody', 'Rating Moodys']),
      country: role('Country', false, ['Country'], ['RA Asset Country Name', 'Issuer Country', 'RA Country']),
      instrument: role('Instrument', false, ['Instrument'], ['Security Type Name']),
      bullet: role('Bullet flag', false, ['Bullet'], ['RA_Bullet']),
      parent_issuer: role('Parent issuer', false, ['Parent Issuer'], ['Parent Issuer Name']),
      seniority: role('Seniority', false, ['Seniority'], ['Seniority']),
      // the workbook's own formula columns B–F, used only to reconcile against this file (§12)
      wb_mapping: role('Workbook: Mapping (B)', false, [], ['Mapping']),
      wb_unique_id: role('Workbook: Unique Identifier (C)', false, [], ['Unique Identifier']),
      wb_investor_code: role('Workbook: Investor Code (D)', false, [], ['Investor Code']),
      wb_identification_id: role('Workbook: Identification ID (E)', false, [], ['Identification ID']),
      wb_code_name: role('Workbook: Code Name (F)', false, [], ['Code Name']),
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
      sector_class: role('Sector classification', false, ['Investor 2 Sector Classification'], ['Investor 2 Sector Classification', 'MN Sector Classification']),
      compliance: role('Covenant compliance', false, ['Compliance with Financial Covenants'], ['Compliance with Financial Covenants', 'Compliance']),
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
      chi_sector: role('Sector (CHI)', false, ['CHI Sector'], ['CHI Sector']),
      chi_subsector: role('Subsector (CHI)', false, ['CHI Subsector'], ['CHI Subsector']),
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
    'ESG Hardcoded': ['Security ID', 'Project Name', 'ESG Score', 'E Score', 'GHG Scope 1', 'CHI Sector'],
  };
  // The six Mapping tables: title (row 2) and expected headers (row 3), with the columns the workbook uses as a fallback.
  const MAPPING_TABLES = {
    references: { title: ['References'], cols: { holdingsColumn: ['Columns in Holdings tab', 'Columns in Holdings'], outputName: ['Output Names', 'Output Name'] }, fallback: 'C' },
    activeAssets: { title: ['Active Assets'], cols: { views: ['Views (Portfolios / Investors)', 'Views'], list: ['List'], mapping: ['Mapping'], activeOutput: ['Active Assets Output'], selected: ['Selected Assets'], number: ['Number'] }, fallback: 'H' },
    securityMapping: { title: ['Security Mapping'], cols: { codeName: ['Code Name'], holdingsName: ['Holdings Name'], identificationId: ['Identification ID'], holdingId: ['Holding ID'], transactionGroup: ['Transaction Group'] }, fallback: 'Q' },
    fundingName: { title: ['Funding Name', 'Fund Name'], cols: { fundName: ['Fund Name'], holdingsName: ['Holdings Name'], holdingsId: ['Holdings ID'] }, fallback: 'Y' },
    investmentGrade: { title: ['Investment Grade Mapping', 'Investment Grade'], cols: { rating: ['Rating'], score: ['Score'], extra: ['Scale', 'Agency', 'Type'] }, fallback: 'AC' },
    fundCheck: { title: ['Fund Check'], cols: { mapping: ['Mapping'], holdings: ['Holdings'] }, fallback: 'AH' },
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
  /** Excel-style number: numbers pass through; strings lose thousands separators, currency symbols and a trailing %. */
  const num = (v) => (typeof v === 'number' ? v : U.toNumber(v));
  /** Date from an ISO string, dd/mm/yyyy, or an Excel serial number (whole or fractional). */
  const date = (v) => {
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return U.parseDate(v);
  };

  /** Find the header row: among the first 15 rows, the one matching the most hint headers. */
  function findHeaderRow(g, hints) {
    const want = new Set(hints.map(norm)); let best = { row: -1, hits: 0 };
    for (let r = 0; r < Math.min(15, g.rows.length); r++) {
      const row = g.rows[r] || []; let hits = 0;
      for (const v of row) if (want.has(norm(v))) hits++;
      if (hits > best.hits) best = { row: r, hits };
    }
    return best.hits >= 2 ? best.row : -1;
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
      if (!col) for (const o of def.out) { col = columns.find((c) => c.output && norm(c.output) === norm(o)); if (col) { via = 'output name (row 2)'; break; } }
      if (!col) for (const hd of def.hdr) { col = columns.find((c) => norm(c.header) === norm(hd)); if (col) { via = 'header (row 3)'; break; } }
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
    for (let r = 0; r < Math.min(10, g.rows.length); r++) {
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
      found[key] = { key, title: t.title[0], foundBy: hit ? 'title' : 'default column', titleCell: cellRef(titleRow, titleCol), headerRow, cols, rows: [] };
      const keyCols = Object.values(cols);
      if (!keyCols.length) continue;
      for (let r = headerRow + 1; r < g.rows.length; r++) {
        const rec = { __row: r + 1 }; let any = false;
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
    const diag = { sheets: {}, tables: {}, roles: [], checks: [], views: [], investors: [], fx: {}, settings: { present: false } };
    // §1b the optional Scope Settings sheet, and the settings in force: app changes > sheet > §1 defaults
    const settingsGrid = sheets[SETTINGS_SHEET] && sheets[SETTINGS_SHEET].rows && sheets[SETTINGS_SHEET].rows.length ? sheets[SETTINGS_SHEET] : null;
    const SS = settingsGrid ? readSettingsSheet(settingsGrid, issue) : null;
    diag.settings = { present: !!SS, source: (input.sources || {})[SETTINGS_SHEET] || null, tables: SS ? SS.diag : {} };
    const S = Object.assign({}, CONFIG, SS ? SS.scalars : {});
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
    diag.tables = Object.fromEntries(Object.entries(mapping).map(([k, t]) => [k, { title: t.title, foundBy: t.foundBy, titleCell: t.titleCell, headerRow: t.headerRow + 1, columns: Object.fromEntries(Object.entries(t.cols).map(([ck, c]) => [ck, colName(c)])), rows: t.rows.length, range: t.range }]));
    for (const [k, t] of Object.entries(MAPPING_TABLES)) if (sheets.Mapping && (!mapping[k] || !mapping[k].rows.length)) issue(k === 'fundCheck' ? 'info' : 'warn', 'Mapping', null, `Mapping table "${t.title[0]}" not found or empty`);
    const T = (k) => (mapping[k] ? mapping[k].rows : []);
    // References (C:D): Holdings column → output name (Holdings row 2 = XLOOKUP(row 3, C, D))
    const refs = new Map(T('references').filter((r) => !blank(r.holdingsColumn)).map((r) => [norm(r.holdingsColumn), str(r.outputName)]));
    // Active Assets (H:M): views list (H) and the security-name → asset mapping (I → J); the Output universe = UNIQUE(J)
    const viewNames = U.uniq(T('activeAssets').map((r) => str(r.views)).filter(Boolean));
    const nameToMapped = new Map(T('activeAssets').filter((r) => !blank(r.list)).map((r) => [str(r.list), { value: str(r.mapping), cell: r.__mapping }]));
    const activeCodes = U.uniq(T('activeAssets').map((r) => str(r.mapping)).filter(Boolean));
    const activeSet = new Set(activeCodes);
    // Security Mapping (Q:U): holding ID (T) → code name (Q), holdings name (R), identification ID (S), transaction group (U)
    const secById = new Map();
    for (const r of T('securityMapping')) {
      const id = str(r.holdingId); if (!id) continue;
      if (secById.has(id)) { issue('warn', 'Mapping', r.__row, `Holding ID ${id} appears twice in Security Mapping; the first row is used`); continue; }
      secById.set(id, { holdingId: id, codeName: str(r.codeName), holdingsName: str(r.holdingsName), identificationId: str(r.identificationId) || id, transactionGroup: str(r.transactionGroup), row: r.__row, cells: r });
    }
    const codeToIdent = new Map(); for (const s of secById.values()) if (s.codeName && !codeToIdent.has(s.codeName)) codeToIdent.set(s.codeName, s.identificationId);
    // Funding Name (Y:AA): holdings ID (AA, the investor code) → fund name (Y) and holdings name (Z, the investor column)
    const fundById = new Map();
    for (const r of T('fundingName')) { const id = str(r.holdingsId); if (id && !fundById.has(id)) fundById.set(id, { id, fundName: str(r.fundName), original: str(r.holdingsName) || str(r.fundName) || id, row: r.__row }); }
    // display names: changed in the app > Scope Settings › Investors › Display Name > the workbook's own name (column Z).
    // resolve() maps an original or display name to the display name, so settings may use either.
    const alias = new Map();
    for (const f of fundById.values()) {
      const o = ov.names && (ov.names[f.original] || ov.names[norm(f.original)]);
      const sh = SS && SS.investors.get(norm(f.original));
      f.label = o ? String(o) : sh && sh.name ? sh.name : f.original;
      f.nameSource = o ? 'override' : sh && sh.name ? 'sheet' : 'workbook';
      alias.set(norm(f.original), f.label); alias.set(norm(f.label), f.label); if (f.fundName) alias.set(norm(f.fundName), alias.get(norm(f.fundName)) || f.label);
    }
    const resolve = (x) => alias.get(norm(x)) || String(x);
    if (SS) for (const sh of SS.investors.values()) if (!alias.has(norm(sh.column))) issue('info', SETTINGS_SHEET, sh.row, `Investors: "${sh.column}" is not an investor column in Mapping › Funding Name; row ignored`);
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
    const positions = [];
    let paddingRows = 0;
    const checks = {
      investorCode: { label: 'Holdings D (Investor Code) = IF(Model Portfolio = "SINGLE", Portfolio, Model Portfolio)', total: 0, matched: 0, examples: [] },
      uniqueId: { label: 'Holdings C (Unique Identifier) = Investor Code & "x" & Security ID', total: 0, matched: 0, examples: [] },
      identificationId: { label: 'Holdings E (Identification ID) = XLOOKUP(Security ID, Mapping!T, Mapping!S)', total: 0, matched: 0, examples: [] },
      codeName: { label: 'Holdings F (Code Name) = XLOOKUP(Security ID, Mapping!T, Mapping!Q)', total: 0, matched: 0, examples: [] },
      mapping: { label: 'Holdings B (Mapping) = XLOOKUP(Security Name, Mapping!I, Mapping!J)', total: 0, matched: 0, examples: [] },
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
      for (const c of H.columns) { const want = refs.get(norm(c.header)); compare(checks.row2, c.output || '#N/A', want || '#N/A', cellRef(H.hr - 1, c.index)); }
      const m = H.map;
      /** Value and cell of a role on row r ({ v, cell } or blank). */
      const cell = (r, key) => (m[key] ? { v: at(H.g, r, m[key].index), cell: cellRef(r, m[key].index), col: m[key].header } : { v: null, cell: null, col: null });
      const seenKeys = new Map();
      for (let r = H.hr + 1; r < H.g.rows.length; r++) {
        const secCell = cell(r, 'security_id');
        if (blank(secCell.v) || str(secCell.v) === '0') { if ((H.g.rows[r] || []).some((v) => !blank(v))) paddingRows++; continue; } // copied formula rows ("0x0") or empty rows
        const line = r + 1;
        const src = {}, raw = {};
        for (const key of Object.keys(ROLES.Holdings)) { const c = cell(r, key); raw[key] = c.v; if (c.cell) src[key] = { table: 'Holdings', row: line, col: c.col, cell: c.cell }; }
        // every column of the row, for the explorer and the asset page
        const sheetRow = {}; for (const c of H.columns) sheetRow[c.header] = at(H.g, r, c.index);
        const p = { line, src, raw, sheet: sheetRow, excluded: false, exclusionReason: null, flags: [] };
        // Holdings D: investor code (the SINGLE rule)
        const model = str(raw.model_portfolio), port = str(raw.portfolio);
        p.investor_id = model.toUpperCase() === S.singleToken.toUpperCase() ? port : model;
        if (model.toUpperCase() === S.singleToken.toUpperCase()) src.investor_id = { table: 'calc', note: `Model Portfolio = ${S.singleToken} → Portfolio (${src.portfolio ? src.portfolio.cell : ''})` };
        p.holding_id = str(raw.security_id);
        p.key = p.investor_id + 'x' + p.holding_id; // Holdings C
        p.security_name = str(raw.security_name);
        p.tranche = p.security_name;
        // Holdings E / F: identification ID and code name from Security Mapping
        const sec = secById.get(p.holding_id);
        const mappedName = nameToMapped.get(p.security_name);
        compare(checks.investorCode, raw.wb_investor_code, p.investor_id, src.wb_investor_code && src.wb_investor_code.cell);
        compare(checks.uniqueId, raw.wb_unique_id, p.key, src.wb_unique_id && src.wb_unique_id.cell);
        compare(checks.identificationId, raw.wb_identification_id, sec ? sec.identificationId : '#N/A', src.wb_identification_id && src.wb_identification_id.cell);
        compare(checks.codeName, raw.wb_code_name, sec ? sec.codeName : '#N/A', src.wb_code_name && src.wb_code_name.cell);
        compare(checks.mapping, raw.wb_mapping, mappedName ? mappedName.value : '#N/A', src.wb_mapping && src.wb_mapping.cell);
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
        else { p.asset_code = null; p.asset_name = p.security_name || '(unmapped)'; if (!p.excluded) { p.excluded = true; p.exclusionReason = 'Security ID not in Mapping Security Mapping'; } issue('error', 'Holdings', line, `Security ID ${p.holding_id} is not in Mapping › Security Mapping (column T): position excluded (the workbook would show a broken or zero row)`, { key: p.key }); }
        if (sec && activeCodes.length && !activeSet.has(sec.codeName) && !p.excluded) { p.excluded = true; p.exclusionReason = 'asset not in Mapping Active Assets list'; } // one issue per asset, raised below
        const inv = fundById.get(p.investor_id);
        if (inv) { p.investor_label = inv.label; p.investor_key = inv.fundName; src.investor_label = { table: 'Mapping', row: inv.row, col: 'Holdings Name' }; }
        else { p.investor_label = 'Unmapped investor ' + p.investor_id; p.investor_key = ''; p.flags.push('unmapped_investor'); issue('error', 'Holdings', line, `Investor code ${p.investor_id} is not in Mapping › Funding Name (column AA): counted in asset totals but in no investor column`, { key: p.key }); }
        p.matrixKey = p.investor_label + p.asset_code; // Calculations F
        if (seenKeys.has(p.key)) issue('warn', 'Holdings', line, `Duplicate position ${p.key} (also row ${seenKeys.get(p.key)}); both rows are counted`, { key: p.key }); else seenKeys.set(p.key, line);
        positions.push(p);
      }
    }
    // assets held in Holdings but absent from Active Assets (Mapping column J): one warning per asset, with its size
    const inactive = U.groupBy(positions.filter((p) => p.exclusionReason === 'asset not in Mapping Active Assets list'), (p) => p.code_name);
    for (const [codeName, ps] of inactive) issue('warn', 'Mapping', null, `${codeName} is held in Holdings (${ps.length} position${ps.length === 1 ? '' : 's'}, rows ${ps.map((p) => p.line).join(', ')}) but is not in Active Assets (column J): left out of the Output, as in the workbook`, { key: ps[0].asset_code });
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
      p.rating = { internal: int.grade, internal_numeric: int.numeric, fitch: fi.grade, moodys: mo.grade, sp: sp.grade, external_grade, external_numeric, current_grade, current_numeric,
        ig_label: current_numeric > S.igThreshold ? 'SUB IG' : 'IG', status: current_numeric === 0 ? 'NR' : 'rated', closing: str(p.raw.closing_rating) };
      p.src.rating = { table: 'calc', note: `internal unless NR, else worst of Fitch / Moody's / S&P; score = MAX(internal, external); IG if ≤ ${S.igThreshold}` };
      p.initial_tenor = p.funding_date && p.maturity_date ? U.yearfrac(p.funding_date, p.maturity_date) : 0;
      p.remaining_years = reportingDate && p.maturity_date ? U.yearsBetween(reportingDate, p.maturity_date) : NaN;
      p.maturity_bucket = AUM.bucketOf(p.remaining_years, S.maturityBuckets);
    }

    // ---------- §7 FX ----------
    // Rate table per currency from Holdings (the workbook's CU:CW): the most frequent rate per currency.
    const rateCounts = new Map();
    for (const p of positions) if (p.currency && U.isNum(p.fx_input) && p.fx_input > 0) { const k = p.currency; if (!rateCounts.has(k)) rateCounts.set(k, new Map()); const m = rateCounts.get(k); m.set(p.fx_input, (m.get(p.fx_input) || 0) + 1); }
    const fxTable = new Map(Array.from(rateCounts, ([ccy, m]) => [ccy, Array.from(m).sort((a, b) => b[1] - a[1])[0][0]]));
    // Direction: does amount ÷ rate (or × rate) reproduce the reference-currency column?
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
    diag.fx = { quote: fxQuote, test: fxTest, table: Array.from(fxTable, ([currency, rate]) => ({ currency, rate, perEur: fxQuote === 'ccy_per_eur' ? rate : 1 / rate })) };
    /** Units of `ccy` per 1 EUR from the table (EUR = 1). */
    const perEur = (ccy) => { if (ccy === S.baseCurrency) return 1; const r = fxTable.get(ccy); return U.isNum(r) ? (fxQuote === 'ccy_per_eur' ? r : 1 / r) : NaN; };
    const displayCcy = input.currency && U.isNum(perEur(input.currency)) ? input.currency : S.baseCurrency;
    if (input.currency && displayCcy !== input.currency) issue('warn', 'Holdings', null, `Display currency ${input.currency} has no FX rate in Holdings; amounts shown in ${S.baseCurrency}`);
    const dispRate = perEur(displayCcy);
    const viewId = input.platform;
    const overrides = ov.fxOverrides || (SS && SS.fxException.length ? SS.fxException : S.fxOverrides) || []; // app > sheet > §1
    diag.fxException = overrides.map((x) => Object.assign({}, x));
    for (const p of positions) {
      if (p.excluded) continue;
      let rate = U.isNum(p.fx_input) && p.fx_input > 0 ? (fxQuote === 'ccy_per_eur' ? p.fx_input : 1 / p.fx_input) : p.currency === S.baseCurrency ? 1 : NaN;
      let note = U.isNum(p.fx_input) ? `rate ${p.fx_input} from ${p.src.fx_rate ? p.src.fx_rate.cell : 'Holdings'}` : '';
      if (!U.isNum(rate) && U.isNum(perEur(p.currency))) { rate = perEur(p.currency); note = `rate for ${p.currency} taken from other Holdings rows`; issue('info', 'Holdings', p.line, `FX rate blank; ${p.currency} rate taken from other rows`, { key: p.key }); }
      const o = overrides.find((x) => x.currency === p.currency && (resolve(x.investor) === p.investor_label || String(x.investor) === p.investor_id) && (!x.view || x.view === viewId));
      if (o) { rate = o.rate; note = 'override: ' + (o.note || 'configured FX exception'); }
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

    // ---------- §8 Hardcoded and ESG Hardcoded, keyed by Security ID (= identification ID) ----------
    /** Index a keyed sheet: key → { values by role, every column with its cell, row number }. */
    const indexSheet = (name) => {
      const L = layout[name], out = new Map(); if (!L || !L.map.security_id) return out;
      for (let r = L.hr + 1; r < L.g.rows.length; r++) {
        const id = str(at(L.g, r, L.map.security_id.index)); if (!id) continue;
        if (out.has(id)) { issue('warn', name, r + 1, `Security ID ${id} appears twice in ${name}; the first row is used`); continue; }
        const roles = {}, cells = {}, all = {};
        for (const [k, c] of Object.entries(L.map)) if (c) { roles[k] = at(L.g, r, c.index); cells[k] = cellRef(r, c.index); }
        for (const c of L.columns) all[c.header] = { value: at(L.g, r, c.index), cell: `${name}!${cellRef(r, c.index)}`, label: c.output };
        out.set(id, { roles, cells, all, row: r + 1 });
      }
      return out;
    };
    const hcById = indexSheet('Hardcoded'), esgById = indexSheet('ESG Hardcoded');
    // Hardcoded D/E are lookups to Mapping (P→R, P→Q): recompute and compare
    const hcChecks = { hcProjectName: { label: 'Hardcoded D (Project Name) = XLOOKUP(Security ID, Mapping!P, Mapping!R)', total: 0, matched: 0, examples: [] }, hcCodeName: { label: 'Hardcoded E (Code Name) = XLOOKUP(Security ID, Mapping!P, Mapping!Q)', total: 0, matched: 0, examples: [] } };
    for (const [id, rec] of hcById) {
      const s = secById.get(id);
      compare(hcChecks.hcProjectName, rec.roles.project_name, s ? s.holdingsName : '#N/A', 'Hardcoded!' + (rec.cells.project_name || ''));
      compare(hcChecks.hcCodeName, rec.roles.code_name, s ? s.codeName : '#N/A', 'Hardcoded!' + (rec.cells.code_name || ''));
    }

    // ---------- §9 Investor columns, asset × investor matrices, group attribution ----------
    /** Group and weight of an investor column: changed in the app > Scope Settings sheet > §1 defaults > Unclassified, 0. */
    const pickKey = (obj, f) => (obj ? obj[f.label] || obj[f.original] : undefined);
    const classOf = (f) => {
      const o = pickKey(ov.investors, f); if (o) return { group: o[0], weight: +o[1], source: 'override' };
      const sh = SS && (SS.investors.get(norm(f.original)) || SS.investors.get(norm(f.label)));
      if (sh && (sh.group || U.isNum(sh.weight))) return { group: sh.group || 'Unclassified', weight: U.isNum(sh.weight) ? sh.weight : 0, source: 'sheet' };
      const c = pickKey(S.investors, f); if (c) return { group: c[0], weight: +c[1], source: 'settings' };
      return { group: 'Unclassified', weight: 0, source: 'default' };
    };
    const investorOrder = Array.from(fundById.values()).map((f) => Object.assign({ key: f.fundName, label: f.label, original: f.original, nameSource: f.nameSource }, classOf(f), { id: f.id, fundName: f.fundName }));
    const unclassified = investorOrder.filter((i) => i.source === 'default').map((i) => i.label);
    if (unclassified.length) issue('warn', 'Mapping', null, `No group or attribution weight for ${unclassified.length} investor column(s) (${unclassified.slice(0, 4).join(', ')}${unclassified.length > 4 ? ', …' : ''}): treated as third party, weight 0. Set them on Data › Setup or in the Scope Settings sheet`);
    const unmappedLabels = U.uniq(positions.filter((p) => p.flags.includes('unmapped_investor') && inView(p)).map((p) => p.investor_label));
    const investorMeta = new Map(investorOrder.map((i) => [i.label, i]));
    unmappedLabels.forEach((l) => investorMeta.set(l, { id: '', key: '', label: l, group: 'Unmapped', weight: 0, source: 'default' }));
    for (const p of positions) { const m = investorMeta.get(p.investor_label); p.investor_group = m ? m.group : 'Unmapped'; p.group_weight = m ? m.weight : 0; }
    const investorColumns = investorOrder.map((i) => i.label).concat(unmappedLabels);
    // fund look-through register (fund → [[holder, share]]): changed in the app > Scope Settings › Look Through > §1 defaults.
    // The sheet is entered per investor ("Investor 1 holds 15% of Fund A"); it is regrouped by fund here.
    const regBy = (src) => { const m = new Map(); for (const [fund, list] of Object.entries(src || {})) m.set(resolve(fund), (list || []).map(([h, sh]) => [resolve(h), +sh])); return m; };
    const regOverride = regBy(ov.fundHolders), regDefault = regBy(S.fundHolders), regSheet = new Map();
    if (SS) for (const r of SS.lookThrough) { const f = resolve(r.fund); if (!regSheet.has(f)) regSheet.set(f, []); regSheet.get(f).push([resolve(r.investor), r.share]); }
    const fundRegister = [], registerFunds = [];
    for (const fund of U.uniq(Array.from(regOverride.keys()).concat(Array.from(regSheet.keys()), Array.from(regDefault.keys())))) {
      const source = regOverride.has(fund) ? 'override' : regSheet.has(fund) ? 'sheet' : 'settings';
      const holders = (source === 'override' ? regOverride : source === 'sheet' ? regSheet : regDefault).get(fund) || [];
      if (!holders.length) continue; // an empty list switches that fund's look-through off
      const known = investorMeta.has(fund);
      if (!known) issue('info', source === 'sheet' ? SETTINGS_SHEET : 'Mapping', null, `Fund look-through: "${fund}" is not an investor column in Funding Name; its unit holders are ignored`);
      else for (const [holder, share] of holders) {
        if (!investorMeta.has(holder)) issue('info', source === 'sheet' ? SETTINGS_SHEET : 'Mapping', null, `Fund look-through: holder "${holder}" of ${fund} is not an investor column; it is kept as a holder outside the investor columns`);
        fundRegister.push({ fund_label: fund, holder_label: holder, share: +share, note: source });
      }
      registerFunds.push({ fund, holders: holders.map(([h, sh]) => [h, +sh]), source, known });
    }
    const fundsWithoutRegister = investorOrder.filter((i) => /fund/i.test(i.group) && !registerFunds.some((f) => f.fund === i.label)).map((i) => i.label);
    if (fundsWithoutRegister.length) issue('info', 'Mapping', null, `Fund look-through: no unit holders listed for ${fundsWithoutRegister.join(', ')}; their exposure is shown directly only. Add them on Data › Setup or in the Scope Settings sheet`);
    diag.fundHolders = registerFunds;
    diag.funds = U.uniq(investorOrder.filter((i) => /fund/i.test(i.group)).map((i) => i.label).concat(registerFunds.filter((f) => f.known).map((f) => f.fund)));
    diag.investors = investorOrder.map((i) => { const sh = SS && SS.investors.get(norm(i.original)); return { id: i.id, original: i.original, label: i.label, fundName: i.fundName, group: i.group, weight: i.weight, source: i.source, nameSource: i.nameSource, sheetName: sh && sh.name ? sh.name : '' }; });

    // ---------- §10 Views (Output!G8) ----------
    const viewList = viewNames.length ? viewNames : ['Total platform'].concat(investorOrder.map((i) => i.label));
    if (!viewNames.length) issue('info', 'Mapping', null, 'No views in Mapping › Active Assets column H; showing Total platform and one view per investor');
    const platforms = [];
    for (const name of viewList) {
      // definition: changed in the app > Scope Settings › Views > §1 defaults > the view is an investor column
      const shView = SS && SS.views.get(norm(name));
      let def, kind = null;
      if (ov.views && ov.views[name] !== undefined) { def = ov.views[name]; kind = 'override'; }
      else if (shView && shView.def) { def = shView.def; kind = 'sheet'; }
      else if (S.views[name] !== undefined) { def = S.views[name]; kind = 'settings'; }
      let composition = null;
      if (def === '*') composition = [{ label: '*', weight: 1 }];
      else if (def === 'group') composition = investorColumns.map((l) => ({ label: l, weight: (investorMeta.get(l) || { weight: 0 }).weight })).filter((c) => c.weight);
      else if (Array.isArray(def)) composition = def.map((x) => (Array.isArray(x) ? { label: resolve(x[0]), weight: +x[1] } : { label: resolve(x), weight: 1 }));
      else if (investorMeta.has(resolve(name))) { composition = [{ label: resolve(name), weight: 1 }]; kind = 'investor column'; }
      else { const f = investorOrder.find((i) => i.fundName === name); if (f) { composition = [{ label: f.label, weight: 1 }]; kind = 'investor column'; } }
      if (!composition) { kind = 'undefined'; composition = []; issue('warn', 'Mapping', null, `View "${name}" (Mapping column H) is not an investor column and has no definition: it shows nothing until defined on the Data page or in the Scope Settings sheet`); }
      for (const c of composition) if (c.label !== '*' && !investorMeta.has(c.label)) issue('warn', 'Mapping', null, `View "${name}" refers to unknown investor column "${c.label}"`);
      platforms.push({ id: name, label: name, composition, kind });
      diag.views.push({ view: name, kind, composition, def: def === '*' || def === 'group' ? def : Array.isArray(def) ? 'list' : kind === 'investor column' ? 'column' : null });
    }
    const platformId = platforms.some((p) => p.id === viewId) ? viewId : platforms.length ? platforms[0].id : '';
    const platform = platforms.find((p) => p.id === platformId) || { id: '', label: 'No view', composition: [] };

    // assets: every identification ID in Security Mapping, in Active Assets order first
    const assetOrder = U.uniq(activeCodes.map((c) => codeToIdent.get(c)).filter(Boolean).concat(Array.from(secById.values()).map((s) => s.identificationId)));
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
        active: false, inActiveList: activeSet.has(meta.code_name) || !activeCodes.length, src: {}, attrs: {}, esg: {}, sheets: {}, byInvestor: new Map(), platform: {}, flags: [] };
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
      const hc = hcById.get(code) || meta.holdings.map((h) => hcById.get(h)).find(Boolean);
      const eg = esgById.get(code) || meta.holdings.map((h) => esgById.get(h)).find(Boolean);
      if (hc) a.sheets.Hardcoded = hc.all; else if (ps.length) { a.flags.push('no_hardcoded'); issue('warn', 'Hardcoded', null, `No Hardcoded row for ${meta.code_name || code} (${code})`, { key: code }); }
      if (eg) a.sheets['ESG Hardcoded'] = eg.all; else if (ps.length) { a.flags.push('no_esg'); issue('info', 'ESG Hardcoded', null, `No ESG Hardcoded row for ${meta.code_name || code} (${code})`, { key: code }); }
      const first = ps[0];
      const hv = (k) => (hc ? hc.roles[k] : null), ev = (k) => (eg ? eg.roles[k] : null);
      const hsrc = (k) => (hc && hc.cells[k] ? { table: 'Hardcoded', row: hc.row, col: (ROLES.Hardcoded[k] || {}).label, cell: hc.cells[k] } : null);
      const esrc = (k) => (eg && eg.cells[k] ? { table: 'ESG Hardcoded', row: eg.row, col: (ROLES['ESG Hardcoded'][k] || {}).label, cell: eg.cells[k] } : null);
      const fundingDate = date(hv('funding_date')) || (first && first.purchase_date) || null;
      const set = (field, value, source) => { a.attrs[field] = value === null || value === undefined ? '' : value; if (source) a.src[field] = source; };
      set('sector', str(ev('chi_sector')) || str(hv('sector_class')), esrc('chi_sector') || hsrc('sector_class'));
      set('subsector', str(hv('subsector')) || str(ev('chi_subsector')), hsrc('subsector') || esrc('chi_subsector'));
      set('country', first ? str(first.raw.country) : '', first && first.src.country);
      set('region', a.attrs.country ? S.regions[a.attrs.country] || 'Rest of world' : '', { table: 'calc', note: 'country → region (S.regions)' });
      set('sponsor', str(hv('shareholders')) || str(ev('shareholders')) || (first ? str(first.raw.parent_issuer) : ''), hsrc('shareholders') || esrc('shareholders'));
      set('repayment_type', first ? (/^(y|yes|true|1|bullet)$/i.test(str(first.raw.bullet)) ? 'Bullet' : str(first.raw.bullet) ? 'Amortising' : '') : '', first && first.src.bullet);
      set('cash_flow_type', str(hv('cashflow_type')), hsrc('cashflow_type'));
      set('instrument', first ? first.instrument_type : '', first && first.src.instrument);
      set('origination', str(hv('origination')), hsrc('origination'));
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
      set('greenfield_brownfield', '', null);
      // ESG
      const es = (field, value, source) => { a.esg[field] = value; if (source) a.src[field] = source; };
      es('esg_score', num(ev('esg_score')), esrc('esg_score')); es('e_score', num(ev('e_score')), esrc('e_score')); es('s_score', num(ev('s_score')), esrc('s_score')); es('g_score', num(ev('g_score')), esrc('g_score'));
      es('ghg_scope1_t', num(ev('ghg1')), esrc('ghg1')); es('ghg_scope2_t', num(ev('ghg2')), esrc('ghg2')); es('ghg_scope3_t', num(ev('ghg3')), esrc('ghg3'));
      const s12 = (U.isNum(a.esg.ghg_scope1_t) ? a.esg.ghg_scope1_t : 0) + (U.isNum(a.esg.ghg_scope2_t) ? a.esg.ghg_scope2_t : 0);
      es('ghg_intensity_t_per_eurm', U.isNum(a.attrs.total_transaction_size) && a.attrs.total_transaction_size > 0 && eg ? s12 / (a.attrs.total_transaction_size / 1e6) : NaN, { table: 'calc', note: 'GHG scope 1+2 ÷ total debt offering (m)' });
      es('chi_sector', str(ev('chi_sector')), esrc('chi_sector')); es('chi_subsector', str(ev('chi_subsector')), esrc('chi_subsector'));
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
        sector: a.attrs.sector, subsector: a.attrs.subsector, country: a.attrs.country, region: a.attrs.region, sponsor: a.attrs.sponsor, greenfield_brownfield: '',
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
    for (const fc of fundCheck) if (!blank(fc.holdings) && !investorMeta.has(str(fc.holdings))) issue('warn', 'Mapping', fc.__row, `Fund Check: "${str(fc.holdings)}" is not an investor column in Funding Name`);
    diag.fundCheck = fundCheck.map((r) => ({ row: r.__row, mapping: str(r.mapping), holdings: str(r.holdings), known: investorMeta.has(str(r.holdings)) }));
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
  // SETTINGS OUT: the settings in force, as data and as a ready-to-use "Scope Settings" sheet (see §1b)
  // =====================================================================================================================
  /**
   * The settings in force for a result (app changes, Scope Settings sheet and §1 defaults merged), named by the workbook's
   * own investor names so the sheet stays valid if display names change:
   * { investors: [{ column, name, group, weight }], views: [{ view, components: '*' | 'group' | [{ column, weight }] | [] }],
   *   lookThrough: [{ investor, fund, share }], fxException: [{ investor, currency, view, rate, note }], settings: [{ setting, value }] }
   */
  AUM.effectiveSettings = function (res) {
    const d = (res && res.inputs) || {}, inv = d.investors || [];
    const original = new Map(inv.map((i) => [i.label, i.original || i.label]));
    const orig = (label) => original.get(label) || label;
    const investors = inv.map((i) => ({ column: i.original || i.label, name: i.label !== (i.original || i.label) ? i.label : '', group: i.source === 'default' ? '' : i.group, weight: i.source === 'default' ? '' : i.weight }));
    const views = (d.views || []).map((v) => ({ view: v.view, components: v.def === '*' || v.def === 'group' ? v.def : v.def === 'list' ? (v.composition || []).map((c) => ({ column: orig(c.label), weight: c.weight })) : v.def === 'column' ? null : [] })).filter((v) => v.components !== null);
    const lookThrough = [];
    for (const f of d.fundHolders || []) for (const [h, sh] of f.holders) lookThrough.push({ investor: orig(h), fund: orig(f.fund), share: sh });
    const fxException = (d.fxException || []).map((x) => ({ investor: x.investor, currency: x.currency, view: x.view || '', rate: x.rate, note: x.note || '' }));
    const cfg = (res && res.config) || {};
    const quote = d.fx && d.fx.quote;
    const settings = [
      { setting: 'Attribution label', value: cfg.attribution_label || CONFIG.attributionLabel },
      { setting: 'IG threshold', value: U.isNum(cfg.ig_threshold) ? cfg.ig_threshold : CONFIG.igThreshold },
      { setting: 'Base currency', value: cfg.base_currency || CONFIG.baseCurrency },
      { setting: 'FX quote', value: quote === 'eur_per_ccy' ? 'EUR per unit' : quote === 'ccy_per_eur' ? 'Units per EUR' : 'Auto' },
      { setting: 'Single portfolio token', value: cfg.single_token || CONFIG.singleToken },
      { setting: 'Maturity buckets', value: (cfg.buckets || CONFIG.maturityBuckets).join(', ') },
    ];
    return { investors, views, lookThrough, fxException, settings };
  };

  /**
   * Lay settings (from effectiveSettings) out as the "Scope Settings" sheet: a note in B1, titles in row 2, headers in row 3,
   * data from row 4; tables at B, G, K, O and U. Returns a grid { name, rows } for the workbook writer or CSV export.
   */
  AUM.settingsGrid = function (eff) {
    const e = eff || { investors: [], views: [], lookThrough: [], fxException: [], settings: [] };
    const rows = [];
    /** Put a value at row r (0-based) and Excel column letter. */
    const put = (r, letter, v) => { while (rows.length <= r) rows.push([]); rows[r][colIndex(letter)] = v === undefined ? null : v; };
    /** One table: title in row 2, headers in row 3, records from row 4. */
    const table = (letter, title, headers, records) => {
      const c0 = colIndex(letter);
      put(1, letter, title);
      headers.forEach((h, k) => put(2, colName(c0 + k), h));
      records.forEach((rec, i) => rec.forEach((v, k) => put(3 + i, colName(c0 + k), v === '' ? null : v)));
    };
    put(0, 'B', 'Scope Settings: names, groups and weights of investor columns, view definitions, fund look-through and the FX exception. Optional sheet; read by name.');
    table('B', 'Investors', ['Investor Column', 'Display Name', 'Group', 'Attribution Weight'], e.investors.map((i) => [i.column, i.name || '', i.group || '', i.weight === '' || i.weight === undefined ? '' : i.weight]));
    const viewRows = [];
    for (const v of e.views) {
      if (v.components === '*') viewRows.push([v.view, 'All investors', '']);
      else if (v.components === 'group') viewRows.push([v.view, 'Group weights', '']);
      else if (Array.isArray(v.components) && v.components.length) for (const c of v.components) viewRows.push([v.view, c.column, c.weight]);
      else viewRows.push([v.view, '', '']);
    }
    table('G', 'Views', ['View', 'Investor Column', 'Weight'], viewRows);
    table('K', 'Look Through', ['Investor', 'Fund', 'Share'], e.lookThrough.map((x) => [x.investor, x.fund, x.share]));
    table('O', 'FX Exception', ['Investor', 'Currency', 'View', 'Rate', 'Note'], e.fxException.map((x) => [x.investor, x.currency, x.view, x.rate, x.note]));
    table('U', 'Settings', ['Setting', 'Value'], e.settings.map((x) => [x.setting, x.value]));
    return { name: SETTINGS_SHEET, rows };
  };

  AUM.colName = colName; AUM.colIndex = colIndex; AUM.cellRef = cellRef; AUM.norm = norm;
})(typeof window !== 'undefined' ? window : globalThis);
