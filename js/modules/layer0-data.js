/* Module: Layer 0 · Data & validation — the four AUM input sheets, how the calculation read them, and every check,
 * issue and correction.
 *
 * Registers the 'data' page (route #/data/<tab>, sidebar Layer 0). It works without a result (needsData: false)
 * because this is where the inputs are loaded. The AUM inputs are exactly four sheets of the workbook: Holdings,
 * Mapping, Hardcoded and ESG Hardcoded. They arrive by dropping the workbook (or one CSV per sheet) or by pasting a
 * range copied from Excel; Scope.inputs (js/inputs/workbook.js) turns them into cell grids and Scope.store keeps them.
 * The calculation (js/calc/aum.js) finds columns by header name and reports how everything resolved in
 * result.inputs. An optional fifth sheet, Scope Settings, holds what the four sheets do not (display names, groups and
 * weights, views, look-through, the FX exception); precedence: changes made here > that sheet > §1 defaults in aum.js.
 * The tabs show that report:
 *   Setup              guided steps: load (and monthly Holdings updates), columns, mapping gaps (rows added here), ownership and views
 *                      (views × investor columns, as in the workbook's Output header rows), checks;
 *                      download / load the Scope Settings sheet
 *   Inputs             drop zone, one card per sheet (status, source, size, header row, paste, CSV), how it works
 *   Columns            the column each calculation role reads, with a per-browser choice; every column of the sheet
 *   Mapping            the six Mapping tables: where each was found, with a preview of its first rows
 *   Views & investors  view compositions, investor groups and weights, FX quote; export as a CONFIG snippet
 *   Checks             the workbook's own formula columns reproduced by the calculation, cell by cell
 *   Issues             every data issue, by severity and sheet, with links to asset pages
 *   Corrections        the manual-correction audit trail, with revert
 *   Settings           CONFIG (§1 of the calculation file), read-only
 * Overrides (columns, display names, views, investors, look-through, FX quote) are saved in this browser
 * (settings.calcOverrides) and apply at once; nothing is sent anywhere. Calls into Scope.inputs and the settings-sheet
 * functions of the calculation are guarded, so the page still renders without them.
 * Page styles: css/data.css (dp- classes).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, store = Scope.store;
  const SHEETS = ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'];
  const KEYED = ['Holdings', 'Hardcoded', 'ESG Hardcoded']; // sheets with a header row and column roles
  const TABS = [['setup', 'Setup'], ['inputs', 'Inputs'], ['columns', 'Columns'], ['mapping', 'Mapping'], ['views', 'Views & investors'], ['formulas', 'Formulas'], ['checks', 'Checks'], ['issues', 'Issues'], ['corrections', 'Corrections'], ['settings', 'Settings']];
  const ALIASES = { overview: 'inputs', adjustments: 'corrections', config: 'settings', start: 'setup' }; // earlier tab names keep working
  const GROUPS = ['Group entity', 'Fund', 'Third party', 'Mandate', 'Unclassified'];
  const SEV = { error: 'error', warn: 'warning', info: 'info' };
  const STATUS = { ok: ['reproduced', 'ok'], warn: ['minor differences', 'warn'], error: ['differs', 'error'], skipped: ['skipped', 'muted'] };
  const SETTINGS_GROUPS = ['names', 'investors', 'views', 'settings']; // override groups the Scope Settings sheet can hold
  const STEP_STATUS = { done: ['done', 'ok'], attention: ['needs attention', 'warn'], optional: ['optional', 'muted'], waiting: ['after step 1', 'muted'] };
  const STEP_ALIASES = { 'look-through': 'weights', lookthrough: 'weights', funds: 'weights', investors: 'weights', views: 'weights', workbook: 'load', mapping: 'gaps' }; // #/data/setup/<step>
  const SETTINGS_TABLES = { investors: 'Investors', views: 'Views', fxException: 'FX Exception', settings: 'Settings' };
  const QUOTES = { auto: 'Automatic (tested against the RC column)', ccy_per_eur: 'Units per EUR: amount ÷ rate (workbook formula)', eur_per_ccy: 'EUR per unit: amount × rate' };
  const QUOTE_SHORT = { ccy_per_eur: 'units per EUR (amount ÷ rate)', eur_per_ccy: 'EUR per unit (amount × rate)' };
  const SHEET_INFO = {
    Holdings: { short: 'position extract', hint: 'Security ID, Security Name, Model Portfolio',
      need: 'The position extract: headers in row 3 from column B (Security ID, Model Portfolio, Portfolio, currency, FX rate, nominal, drawn and the rest), output names in row 2.' },
    Mapping: { short: 'six lookup tables', hint: '',
      need: 'Six tables side by side, titles in row 2 and headers in row 3: References, Active Assets, Security Mapping, Funding Name, Investment Grade Mapping and Fund Check.' },
    Hardcoded: { short: 'manual deal fields', hint: 'Security ID, Project Name, Code Name',
      need: 'One row per asset keyed by Security ID, headers in row 3 from column C: subsector, watchlist, funding date, shareholders and the other deal fields.' },
    'ESG Hardcoded': { short: 'ESG data', hint: 'Security ID, Project Name, ESG Score',
      need: 'One row per asset keyed by Security ID: E, S, G and ESG scores, CHI sector and subsector, GHG scopes 1 to 3.' },
  };
  const TABLE_INFO = {
    references: ['References', 'Holdings header to output name (fills Holdings row 2)'],
    activeAssets: ['Active Assets', 'the views (column H) and security name to asset (I to J): the assets in the Output'],
    securityMapping: ['Security Mapping', 'holding ID to code name, project name, identification ID and transaction group'],
    fundingName: ['Funding Name', 'investor code to fund name and investor column'],
    investmentGrade: ['Investment Grade Mapping', 'rating to score, compared with the IG threshold'],
    fundCheck: ['Fund Check', 'fund names checked against the investor columns'],
  };
  const COL_LABEL = { holdingsColumn: 'Columns in Holdings tab', outputName: 'Output Names', views: 'Views', list: 'List', mapping: 'Mapping', activeOutput: 'Active Assets Output',
    selected: 'Selected Assets', number: 'Number', codeName: 'Code Name', holdingsName: 'Holdings Name', identificationId: 'Identification ID', holdingId: 'Holding ID',
    transactionGroup: 'Transaction Group', fundName: 'Fund Name', holdingsId: 'Holdings ID', rating: 'Rating', score: 'Score', extra: 'Scale', holdings: 'Holdings' };
  const CONFIG_INFO = {
    baseCurrency: 'every amount is converted to this currency first',
    fxQuote: 'how Holdings FX rates are quoted; auto tests both directions against the RC column',
    igThreshold: 'a rating score above this is sub-investment grade (higher score = weaker)',
    singleToken: 'Model Portfolio value meaning "use Portfolio as the investor code"',
    unit: 'Output amounts are divided by this (1,000,000 = millions)',
    maturityBuckets: 'remaining-life bands in years',
    attributionLabel: 'name of the attributed investor group in labels',
    spreadUnit: 'bps, percent, or auto (values below 20 are read as percent)',
  };
  const CONFIG_TITLES = { views: 'Views', investors: 'Investors', fxOverrides: 'FX exception', regions: 'Regions', thresholds: 'Concentration thresholds (illustrative)' };

  // Page state that survives re-renders within the session.
  // focus: data-focus key of the edited cell (put back after a save re-renders); anchorPending / lastHash: scroll to a
  // Setup step once per navigation.
  const state = { sev: 'all', issueSheet: 'all', open: new Set(), lastLoad: null, tab: null, focus: null, anchorPending: true, lastHash: null };
  global.addEventListener('hashchange', () => { state.anchorPending = true; });

  // ---------- small helpers ----------
  /** The calculation module (Scope.calc.aum; older builds exposed it as Scope.engine.aum). */
  const calc = () => (Scope.calc && Scope.calc.aum) || (Scope.engine && Scope.engine.aum) || {};
  /** CONFIG (§1 of the calculation file), or an empty object. */
  const cfg = () => calc().CONFIG || {};
  /** Calculation overrides saved in this browser. */
  const overrides = () => store.state.settings.calcOverrides || {};
  /** The result's input diagnostics (empty without a result). */
  const diag = (res) => (res && res.inputs) || {};
  /** A Scope.inputs function by name, or null when the workbook reader is not loaded. */
  const IN = (fn) => (Scope.inputs && typeof Scope.inputs[fn] === 'function' ? Scope.inputs[fn] : null);
  /** Icon element for buttons and badges. */
  const ic = (name, size) => Scope.icon(name, { size: size || 14 });
  /** Excel column letters to a 0-based index (-1 when not letters). */
  const colIndex = (l) => (/^[A-Z]+$/i.test(String(l || '')) ? String(l).toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1 : -1);
  /** 0-based index to Excel column letters (0 = A, 27 = AB). */
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  /** Integers a..b inclusive (empty when b < a). */
  const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  /** Weight as short text (1, 0.35, 0.3333). */
  const fmtW = (w) => (U.isNum(+w) ? String(+(+w).toFixed(4)) : String(w));
  /** FX rate as short text (six significant digits). */
  const fmtRate = (v) => (U.isNum(v) ? String(+v.toPrecision(6)) : '–');
  /** ISO timestamp as "yyyy-mm-dd hh:mm". */
  const when = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');
  /** Today as yyyy-mm-dd, for file names. */
  const today = () => new Date().toISOString().slice(0, 10);
  /** Cell value as display text. */
  const cellText = (v) => (v === null || v === undefined ? '' : v instanceof Date ? U.isoDate(v) : String(v));
  /** True for plain objects and arrays. */
  const isObj = (v) => v !== null && typeof v === 'object';
  /** Plural helper: "1 sheet", "2 sheets". */
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  /** Name of the optional settings sheet (Scope.calc.aum.SETTINGS_SHEET). */
  const settingsName = () => calc().SETTINGS_SHEET || 'Scope Settings';
  /** Every sheet the page loads: the four inputs, then the optional settings sheet. */
  const allSheets = () => SHEETS.concat([settingsName()]);
  /** Comparison form of a name, as the calculation compares them (lower case, letters and digits only). */
  const nk = (s) => (calc().norm || ((x) => String(x === null || x === undefined ? '' : x).toLowerCase().replace(/[^a-z0-9]/g, '')))(s);
  /** An investor's workbook name (Funding Name column Z); builds without display names only report the label. */
  const origOf = (i) => (i ? String(i.original || i.label || '') : '');
  /** The attribution label used in the result ("Group" by default). */
  const attrLabel = (res) => (res && res.config && res.config.attribution_label) || cfg().attributionLabel || 'Group';
  /** Escape text for an attribute selector. */
  const cssEsc = (s) => (global.CSS && global.CSS.escape ? global.CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));
  /** The current result (fresh at click time), or null. */
  const currentRes = () => { try { return Scope.app && Scope.app.safeResult ? Scope.app.safeResult() : store.result(); } catch (e) { return null; } };
  /** Share or weight typed by the user: 0.15, 15% or 15 (a number above 1 is read as percent); NaN when not a number. */
  function parseShare(s) {
    const t = String(s === null || s === undefined ? '' : s).replace(/\s/g, '').replace(/,/g, '.');
    if (!t) return NaN;
    const pct = /%$/.test(t), n = Number(t.replace(/%$/, ''));
    if (!t.replace(/%$/, '') || !isFinite(n)) return NaN;
    return pct || n > 1 ? n / 100 : n;
  }

  /** Change several overrides in one update (one recalculation): fn edits a copy of calcOverrides; empty groups are dropped. */
  function writeOverrides(fn) {
    const ov = JSON.parse(JSON.stringify(overrides()));
    fn(ov);
    for (const k of Object.keys(ov)) if (isObj(ov[k]) && !Array.isArray(ov[k]) && !Object.keys(ov[k]).length) delete ov[k];
    store.setSetting('calcOverrides', ov);
  }
  /** Delete every key of an override group naming the same investor as one of `names` (workbook, display or fund name). */
  function dropAliases(group, names) {
    if (!group) return;
    const want = new Set(names.filter(Boolean).map(nk));
    for (const k of Object.keys(group)) if (want.has(nk(k))) delete group[k];
  }
  /** After a rename, point overrides that used the old display name at the workbook name, which never changes. */
  function migrateLabel(ov, from, to) {
    if (!from || !to || nk(from) === nk(to)) return;
    const k = nk(from), fix = (x) => (nk(x) === k ? to : x);
    for (const g of ['investors', 'views']) {
      const o = ov[g]; if (!o) continue;
      for (const key of Object.keys(o)) {
        let val = o[key];
        if (g === 'views' && Array.isArray(val)) val = val.map((x) => (Array.isArray(x) ? [fix(x[0]), x[1]] : fix(x)));
        else if (g === 'views' && typeof val === 'string' && calc().parseFormula) { const f = calc().parseFormula(val); if (!f.error) val = calc().formulaText(f.terms.map((t) => ({ name: fix(t.name), weight: t.weight, text: t.text }))); }
        const nkey = g === 'views' ? key : fix(key);
        if (nkey !== key) delete o[key];
        o[nkey] = val;
      }
    }
  }
  /**
   * Save after the current event has finished (so Tab, Enter or a click has moved focus first), then put back the focus
   * and the scroll positions that the re-render loses. fn makes the store change; the page re-renders inside it.
   */
  function deferSave(fn) {
    setTimeout(() => {
      const main = document.querySelector('.main'), top = main ? main.scrollTop : 0, want = state.focus;
      const scrolls = Array.from(document.querySelectorAll('[data-keep-scroll]')).map((e) => [e.dataset.keepScroll, e.scrollLeft, e.scrollTop]);
      try { fn(); } catch (e) { console.error(e); UI.toast(`Could not save: ${(e && e.message) || e}`, 'warn'); }
      if (main) main.scrollTop = top;
      for (const [k, l, t] of scrolls) { const e = document.querySelector(`[data-keep-scroll="${cssEsc(k)}"]`); if (e) { e.scrollLeft = l; e.scrollTop = t; } }
      if (want) {
        const e = document.querySelector(`[data-focus="${cssEsc(want)}"]`);
        if (e && document.activeElement !== e) { try { e.focus({ preventScroll: true }); } catch (x) { e.focus(); } if (e.select) e.select(); }
      }
    }, 0);
  }
  /** Remember which editable cell has focus, so it can be focused again after a save re-renders the page. */
  function trackFocus(root) {
    root.addEventListener('focusin', (e) => { const t = e.target; state.focus = (t && t.dataset && t.dataset.focus) || null; });
    root.addEventListener('focusout', (e) => { const t = e.relatedTarget; if (!t || !root.contains(t) || !(t.dataset && t.dataset.focus)) state.focus = null; });
  }
  /** Excel-like keys in an editable table: Enter or Down moves to the cell below, Shift+Enter or Up above, Escape undoes the typing. */
  function cellKeys(e) {
    const t = e.target;
    if (e.key === 'Escape') { t.value = t.dataset.text || ''; if (t.select) t.select(); return; }
    const down = (e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown', up = (e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp';
    if (!down && !up) return;
    e.preventDefault();
    const table = t.closest('table'); if (!table) return;
    const col = Array.from(table.querySelectorAll(`input[data-c="${cssEsc(t.dataset.c)}"]`));
    const next = col[col.indexOf(t) + (down ? 1 : -1)];
    if (next) next.focus(); else t.blur();
  }

  const sizeCache = new WeakMap();
  /** Rows up to the last non-blank row and columns up to the last used column of a grid (cached per grid). */
  function gridSize(g) {
    if (!g || !g.rows) return { rows: 0, cols: 0 };
    if (sizeCache.has(g.rows)) return sizeCache.get(g.rows);
    let rows = 0, cols = 0;
    g.rows.forEach((row, r) => {
      if (!row) return;
      for (let c = row.length - 1; c >= 0; c--) { const v = row[c]; if (v !== null && v !== undefined && v !== '') { rows = r + 1; if (c + 1 > cols) cols = c + 1; break; } }
    });
    const out = { rows, cols };
    sizeCache.set(g.rows, out);
    return out;
  }

  /** One line saying where a sheet came from. */
  function sourceText(src) {
    if (!src) return '–';
    if (src.kind === 'demo') return 'Synthetic demo';
    if (src.kind === 'xlsx') return `${src.file || 'workbook'}, tab "${src.sheetName || ''}"`;
    if (src.kind === 'csv') return src.file || 'CSV file';
    if (src.kind === 'paste') return `Pasted${src.origin && src.origin !== 'A1' ? ' at ' + src.origin : ''}`;
    return src.file || src.kind || '–';
  }

  /** Number of overrides saved in this browser (columns, display names, views, investors, FX quote). */
  function countOverrides() {
    const ov = overrides();
    return ['roles'].concat(SETTINGS_GROUPS).reduce((n, k) => n + Object.keys(ov[k] || {}).length, 0) + (ov.fxQuote ? 1 : 0);
  }
  /** Number of changes made here that the Scope Settings sheet can hold (every override except column choices). */
  function countSettingsChanges() {
    const ov = overrides();
    return SETTINGS_GROUPS.reduce((n, k) => n + Object.keys(ov[k] || {}).length, 0) + (ov.fxQuote ? 1 : 0);
  }

  /** Required sheets holding the synthetic demo that are not part of a load of `supplied`. */
  const demoSheetsKept = (supplied) => SHEETS.filter((n) => !supplied.includes(n) && store.sheet(n) && (store.state.sources[n] || {}).kind === 'demo');
  /** True when any required sheet is still the synthetic demo. */
  const demoLoaded = () => SHEETS.some((n) => store.sheet(n) && (store.state.sources[n] || {}).kind === 'demo');
  /** Warning that some sheets are still the synthetic demo (empty string when none). */
  function demoWarning(kept) {
    if (!kept.length) return '';
    const one = kept.length === 1;
    return `${kept.join(', ')} ${one ? 'is' : 'are'} still the synthetic demo ${one ? 'sheet' : 'sheets'}: load ${one ? 'it' : 'them'} too, or use Clear all sheets to start from blank.`;
  }
  /**
   * Notes after a load, given the demo sheets in place before it: loading your own sheets removes the demo ones, so say
   * which required sheets are still to load (or, with a store that keeps them, which are still the demo).
   */
  function afterLoadWarnings(demoBefore) {
    const out = [], cleared = demoBefore.filter((n) => !store.sheet(n)), kept = demoBefore.filter((n) => store.sheet(n));
    if (cleared.length) {
      const one = cleared.length === 1;
      out.push(`${cleared.join(', ')} ${one ? 'is' : 'are'} not loaded yet: the synthetic demo ${one ? 'sheet was' : 'sheets were'} removed so your data does not mix with ${one ? 'it' : 'them'}. Load ${one ? 'it' : 'them'} too.`);
    }
    const other = store.missingSheets().filter((n) => !cleared.includes(n));
    if (other.length) out.push(`Still to load: ${other.join(', ')}.`);
    if (kept.length) out.push(demoWarning(kept));
    return out;
  }
  /** Ask before a settings sheet alone replaces the synthetic demo (the store removes demo sheets when your own data arrives). */
  function confirmSettingsOverDemo(supplied) {
    if (supplied.some((n) => SHEETS.includes(n)) || !demoLoaded()) return true;
    return global.confirm(`The loaded sheets are the synthetic demo. Loading your own ${settingsName()} sheet removes the demo sheets, so drop your workbook next. Continue?`);
  }

  /** Placeholder for tabs that need loaded sheets. */
  const noData = () => UI.section({ title: 'Nothing to show', body: h('div', { class: 'empty' }, 'No sheets are loaded. ', h('a', { href: Scope.href('data', 'inputs') }, 'Load the workbook on the Inputs tab'), '.') });
  /** Notice that one sheet is not loaded, with a link to the Inputs tab. */
  const missingNotice = (name) => h('div', { class: 'notice' }, h('b', {}, `${name} is not loaded. `), 'Drop the workbook or paste the sheet on the ', h('a', { href: Scope.href('data', 'inputs') }, 'Inputs'), ' tab.');

  // ---------- page ----------
  /** Tab bar, with a count badge where something needs attention. */
  function tabBar(active, res) {
    const D = diag(res), counts = (res && res.issueCounts) || {};
    const missing = store.missingSheets().length;
    const rolesMissing = (D.roles || []).filter((r) => r.required && !r.letter).length;
    const checksOff = (D.checks || []).filter((c) => c.status === 'warn' || c.status === 'error').length;
    const nIssues = res && res.issues ? res.issues.length : 0, nAdj = store.activeAdjustments().length;
    let todo = 0;
    try { const st = setupFacts(res).status; todo = Object.values(st).filter((s) => s === 'attention').length; } catch (e) { todo = 0; }
    const badge = {
      setup: todo ? UI.badge(String(todo), 'warn', `${plural(todo, 'step')} needing attention`) : null,
      inputs: missing ? UI.badge(`${missing} missing`, 'error') : null,
      columns: rolesMissing ? UI.badge(String(rolesMissing), 'error', 'required columns not found') : null,
      checks: checksOff ? UI.badge(String(checksOff), 'warn', 'checks with differences') : null,
      issues: nIssues ? UI.badge(String(nIssues), counts.error ? 'error' : counts.warn ? 'warn' : 'muted') : null,
      corrections: nAdj ? UI.badge(String(nAdj), 'muted', 'corrections in force') : null,
    };
    return h('div', { class: 'tabs dp-tabs' }, TABS.map(([id, label]) => h('a', { class: 'tab' + (active === id ? ' active' : ''), href: Scope.href('data', id) }, label, badge[id] || null)));
  }

  Scope.registerModule({
    id: 'data', layer: 0, order: 1, title: 'Data & validation', status: 'built', icon: 'database', needsData: false,
    /** Page head, tab bar and the active tab (no tab or an unknown one shows Setup). */
    render(el, ctx) {
      const res = ctx.result;
      let tab = ALIASES[ctx.params[0]] || ctx.params[0];
      if (!TABS.some((t) => t[0] === tab)) tab = 'setup';
      el.appendChild(Scope.app.pageHead({ title: 'Data & validation', sub: 'Layer 0: the four input sheets and the optional Scope Settings sheet, how the calculation read them, and every check, issue and correction' }));
      el.appendChild(tabBar(tab, res));
      if (state.tab && state.tab !== tab) { const main = document.querySelector('.main'); if (main) main.scrollTop = 0; } // a new tab starts at the top
      state.tab = tab;
      const body = h('div', { class: 'dp-page' });
      el.appendChild(body);
      try { TAB_RENDER[tab](body, res, ctx.params); }
      catch (e) { console.error(e); body.appendChild(h('div', { class: 'notice error' }, h('b', {}, 'This tab could not be shown: '), String((e && e.message) || e))); }
    },
  });

  // =====================================================================================================================
  // Setup
  // =====================================================================================================================
  /** Where the settings in force come from, as a short phrase ("from your workbook's Scope Settings sheet"). */
  function settingsSourceText(res) {
    const name = settingsName(), S = diag(res).settings || {}, src = store.state.sources[name] || S.source || null;
    if (!(S.present || store.sheet(name))) return 'from the calculation file';
    if (src && src.kind === 'demo') return `from the demo workbook's ${name} sheet`;
    if (src && src.kind === 'csv') return `from ${src.file || name + '.csv'}`;
    if (src && src.kind === 'paste') return `from the pasted ${name} sheet`;
    const wb = store.state.sources.Holdings;
    if (src && src.file && !(wb && wb.file === src.file)) return `from the ${name} sheet in ${src.file}`;
    return `from your workbook's ${name} sheet`;
  }
  /** "Views 27 columns, 4 rows · FX Exception 2 rows · Settings 8 rows" for the tables of the settings sheet. */
  function settingsTablesText(res) {
    const T = (diag(res).settings || {}).tables || {};
    const parts = Object.keys(SETTINGS_TABLES).filter((k) => T[k]).map((k) => (T[k].found ? `${SETTINGS_TABLES[k]} ${plural(T[k].rows || 0, 'row')}${k === 'views' && T[k].form === 'matrix' ? ' (matrix form)' : ''}` : `${SETTINGS_TABLES[k]} not found`));
    return parts.join(' · ');
  }
  /** Workbook checks as one phrase: "5 of 5 compared reproduce the workbook, 2 skipped". */
  function checkSummaryText(checks) {
    const skipped = checks.filter((c) => c.status === 'skipped').length, compared = checks.length - skipped, ok = checks.filter((c) => c.status === 'ok').length;
    return `${ok} of ${compared} reproduce the workbook${skipped ? `, ${skipped} skipped` : ''}`;
  }

  /** Everything the Setup steps and their status badges are built from. */
  function setupFacts(res) {
    const D = diag(res), missing = store.missingSheets();
    const req = (D.roles || []).filter((r) => r.required), reqOk = req.filter((r) => r.letter).length;
    const checks = D.checks || [], differs = checks.filter((c) => c.status === 'warn' || c.status === 'error'), skipped = checks.filter((c) => c.status === 'skipped');
    const gaps = D.gaps || { securities: [], investors: [], inactive: [] }, nGaps = gaps.securities.length + gaps.investors.length + gaps.inactive.length;
    const wt = wtModel(D, res);
    const status = !res ? { load: 'attention', columns: 'waiting', gaps: 'waiting', weights: 'waiting', checks: 'waiting' } : {
      load: !missing.length && !res.fatal ? 'done' : 'attention',
      columns: req.length && reqOk === req.length ? 'done' : 'attention',
      gaps: nGaps ? 'attention' : 'done',
      weights: wt.status,
      checks: !checks.length ? 'optional' : differs.length ? 'attention' : 'done',
    };
    return { D, missing, req, reqOk, checks, differs, skipped, gaps, nGaps, wt, status };
  }

  /** Setup tab: the Scope Settings card, then five numbered steps from loading the workbook to the checks. */
  function setupTab(el, res, params) {
    const S = setupFacts(res);
    const dn = diagnosisNotice(res); if (dn) el.appendChild(dn);
    el.appendChild(settingsIntro(res));
    const steps = h('div', { class: 'dp-steps' }, loadStep(res, S), columnsStep(res, S), gapsStep(res, S), weightsStep(res, S), checksStep(res, S));
    trackFocus(steps);
    el.appendChild(steps);
    const id = STEP_ALIASES[params[1]] || params[1];
    scrollToStep(id);
  }

  /** Bring a step into view when the route names one (#/data/setup/lookthrough), once per navigation. */
  function scrollToStep(id) {
    const fresh = state.anchorPending || state.lastHash !== location.hash;
    state.anchorPending = false; state.lastHash = location.hash;
    if (!id || !fresh) return;
    setTimeout(() => {
      const e = document.getElementById('dp-step-' + id), main = document.querySelector('.main'); if (!e) return;
      if (!main) { if (e.scrollIntoView) e.scrollIntoView({ block: 'start' }); return; }
      const bar = document.querySelector('.navbar'), barH = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0;
      main.scrollTop += e.getBoundingClientRect().top - main.getBoundingClientRect().top - barH - 16; // clear the sticky top bar
    }, 0);
  }

  /** One numbered step: number, title, one-line explanation, status badge and body. */
  function stepCard(n, id, title, status, line, body) {
    const st = STEP_STATUS[status] || STEP_STATUS.optional;
    return h('section', { class: `section dp-step dp-step-${status}`, id: 'dp-step-' + id },
      h('div', { class: 'section-head dp-step-head' },
        h('span', { class: 'dp-step-num', 'aria-hidden': 'true' }, String(n)),
        h('div', { class: 'dp-step-titles' }, h('h2', {}, title), h('p', { class: 'section-sub' }, line)),
        h('div', { class: 'section-actions' }, UI.badge(st[0], st[1]))),
      h('div', { class: 'dp-step-body' }, body));
  }
  /** Placeholder body for a step that needs the workbook first. */
  const waitBody = () => h('p', { class: 'small muted dp-step-wait' }, 'Load the workbook in step 1 first.');

  /** The diagnostics report (headers, columns, tables, samples, issues; no amounts) as text, or '' without a result. */
  function diagnosticsText() { const res = currentRes(), A = calc(); if (!res || typeof A.diagnosticsText !== 'function') return ''; try { return A.diagnosticsText(res.base || res); } catch (e) { console.error(e); return ''; } }
  /** Buttons: copy the diagnostics report, or download it as a text file, to send when something is read wrongly. */
  function diagnosticsButtons() {
    return [h('button', { class: 'btn btn-sm', title: 'What Scope read: header rows, columns, Mapping tables with sample IDs, settings, issues. No amounts.', onClick: () => { const t = diagnosticsText(); if (!t) { UI.toast('Load the workbook first', 'warn'); return; } copyText(t).then((ok) => UI.toast(ok ? 'Diagnostics copied: paste them where you need help' : 'The browser did not allow copying; use Download', ok ? '' : 'warn')); } }, ic('clipboard'), 'Copy diagnostics'),
      h('button', { class: 'btn btn-sm', onClick: () => { const t = diagnosticsText(); if (!t) { UI.toast('Load the workbook first', 'warn'); return; } UI.downloadText(`scope-diagnostics-${today()}.txt`, t, 'text/plain;charset=utf-8'); } }, ic('download'), 'Download diagnostics')];
  }
  /** The plain-language diagnosis when most keys failed, with the diagnostics actions. */
  function diagnosisNotice(res) {
    const list = (diag(res).diagnosis || []);
    if (!list.length) return null;
    return h('div', { class: 'notice error dp-diagnosis' }, h('div', {}, h('b', {}, 'Most positions could not be matched. '), list.map((m) => h('p', { class: 'dp-diagnosis-line' }, m)),
      h('p', { class: 'small' }, 'Copy the diagnostics and send them to whoever maintains Scope: they show which column was read and what it was compared with, without any amounts.')),
      h('div', { class: 'dp-row-actions' }, diagnosticsButtons()));
  }

  /** The Scope Settings card at the top of Setup: what the sheet is, where the settings in force come from, and its actions. */
  function settingsIntro(res) {
    const n = countSettingsChanges(), A = calc();
    const canBuild = !!(res && typeof A.effectiveSettings === 'function' && typeof A.settingsGrid === 'function');
    const picker = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv', class: 'hidden', 'aria-label': 'Settings file',
      onChange: (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; loadSettingsFile(files); } });
    return UI.section({ class: 'dp-intro', title: settingsName(), subtitle: 'group ownership per investor column, one formula per view, the FX exception and a few settings, in one optional sheet',
      body: h('div', {},
        h('p', { class: 'dp-intro-text' }, `Settings live in an optional fifth sheet, ${settingsName()}, with two small tables: how much of each investor column the ${attrLabel(res)} owns (the Output header row), and a formula for each view that is not a plain column (the Calculations formulas, with names: "Investor 1 + 1/4 × Fund 1 + …"). Download it pre-filled, adjust it in Excel or in step 4, keep it in your workbook, and every drop is configured automatically.`),
        h('div', { class: 'dp-intro-status' }, h('b', {}, 'Settings: '), h('span', {}, settingsSourceText(res)),
          n ? [h('span', { class: 'muted' }, ' · '), UI.badge(`${n} changed here`, 'manual', 'saved in this browser; they take precedence over the sheet')] : null),
        h('div', { class: 'dp-intro-actions' },
          h('button', { class: 'btn btn-primary btn-sm', disabled: !canBuild, onClick: () => downloadSettings('xlsx') }, ic('download'), `Download ${settingsName()} sheet (.xlsx)`),
          h('button', { class: 'btn btn-sm', disabled: !canBuild, onClick: () => downloadSettings('csv') }, ic('download'), 'Download as CSV'),
          h('button', { class: 'btn btn-sm', onClick: () => picker.click() }, ic('upload'), 'Load settings file'), picker,
          h('button', { class: 'btn btn-sm btn-danger', disabled: !n, onClick: clearSettingsChanges }, ic('x'), 'Clear changes made here'),
          h('span', { class: 'dp-spacer' }), diagnosticsButtons()),
        canBuild ? null : h('p', { class: 'small muted dp-intro-note' }, res ? 'This copy of the calculation cannot write the settings sheet.' : 'Load the workbook to download a pre-filled sheet.')) });
  }

  /** The settings in force laid out as the Scope Settings sheet (grid), or null when the calculation cannot build it. */
  function settingsGridNow() {
    const A = calc(), res = currentRes();
    if (!res || typeof A.effectiveSettings !== 'function' || typeof A.settingsGrid !== 'function') return null;
    try { const g = A.settingsGrid(A.effectiveSettings(res.base || res)); return g && g.rows ? g : null; }
    catch (e) { console.error(e); return null; }
  }

  /** Download the pre-filled Scope Settings sheet as a one-tab workbook or as CSV (named so it loads back by name). */
  function downloadSettings(kind) {
    const grid = settingsGridNow(), name = settingsName();
    if (!grid) { UI.toast(`The ${name} sheet cannot be built: load the workbook first`, 'warn'); return; }
    if (kind === 'csv') {
      const toCsv = IN('gridToCsv');
      if (!toCsv) { UI.toast('The CSV writer is not available in this copy of Scope', 'warn'); return; }
      UI.downloadText(`${name}.csv`, '﻿' + toCsv(grid), 'text/csv;charset=utf-8');
      return;
    }
    const write = IN('writeXlsx'), save = IN('downloadBytes');
    if (!write || !save) { UI.toast('The workbook writer is not available in this copy of Scope', 'warn'); return; }
    try { save(`${name}.xlsx`, write({ [name]: grid })); UI.toast(`${name}.xlsx downloaded: copy its tab into your workbook, or drop it with the workbook`); }
    catch (e) { UI.toast(`Could not write the sheet: ${(e && e.message) || e}`, 'warn'); }
  }

  /** Load a settings file (a workbook with a Scope Settings tab, or Scope Settings.csv); only that sheet is taken. */
  async function loadSettingsFile(files) {
    if (!files.length) return;
    const read = IN('readFiles'), name = settingsName(), from = files.map((f) => f.name).join(', ');
    if (!read) { UI.toast('The workbook reader is not available in this copy of Scope', 'warn'); return; }
    let out;
    try { out = await read(files); } catch (e) { UI.toast(`Could not read ${from}: ${(e && e.message) || e}`, 'warn'); return; }
    const g = out && out.sheets && out.sheets[name];
    if (!g) { UI.toast(`No ${name} sheet in ${from}: use a workbook with a tab called "${name}", or a CSV file named "${name}.csv"`, 'warn'); return; }
    if (!confirmSettingsOverDemo([name])) return;
    const others = SHEETS.filter((n) => out.sheets[n]), before = demoSheetsKept([name]);
    const src = (out.sources && out.sources[name]) || { kind: 'csv', file: from };
    state.lastLoad = { at: new Date().toISOString(), from: `from ${src.file || from}`, sheets: [name], warnings: others.length ? [`Only the ${name} sheet was taken from ${from}; drop the workbook in step 1 to load ${others.join(', ')} as well.`] : [] };
    store.setSheets({ [name]: g }, { [name]: src }, { merge: true });
    if (!store.sheet(name)) { UI.toast(`This copy of Scope cannot keep the ${name} sheet`, 'warn'); return; }
    const notes = afterLoadWarnings(before);
    if (notes.length) { state.lastLoad.warnings = state.lastLoad.warnings.concat(notes); Scope.app.render(true); }
    const n = countSettingsChanges();
    UI.toast(`${name} loaded from ${src.file || from}${n ? `; the ${plural(n, 'change')} made here still take precedence` : ''}`, n ? 'warn' : '');
  }

  /** Remove every change made here that the settings sheet can hold (column choices are kept), after confirmation. */
  function clearSettingsChanges() {
    const n = countSettingsChanges(); if (!n) return;
    if (!global.confirm(`Clear the ${plural(n, 'change')} made here (display names, types, weights, views, FX quote)? The ${settingsName()} sheet, or the calculation file's defaults, apply again. Column choices are kept.`)) return;
    writeOverrides((ov) => { SETTINGS_GROUPS.forEach((k) => { delete ov[k]; }); delete ov.fxQuote; });
    UI.toast('Changes made here cleared');
  }

  // ---------- step 1: load ----------
  /** Step 1: compact drop zone, the four sheets' status and where the settings come from. */
  function loadStep(res, S) {
    const name = settingsName(), D = S.D, setG = store.sheet(name), setS = D.settings || {};
    const list = h('div', { class: 'dp-sheetlist' });
    for (const n of SHEETS) {
      const g = store.sheet(n), src = store.state.sources[n];
      list.append(UI.badge(g ? 'loaded' : 'missing', g ? 'ok' : 'error'), h('span', { class: 'dp-sl-name' }, n), h('span', { class: 'dp-sl-src' }, g ? sourceText(src) : SHEET_INFO[n].short));
    }
    const tables = setG && res ? settingsTablesText(res) : '';
    list.append(UI.badge(setG ? 'loaded' : 'optional', setG ? 'ok' : 'muted'), h('span', { class: 'dp-sl-name' }, name),
      h('span', { class: 'dp-sl-src' }, setG ? sourceText(store.state.sources[name]) : 'not in the workbook: settings come from the calculation file', tables ? h('span', { class: 'dp-sl-tables' }, tables) : null));
    const n = countSettingsChanges();
    const fatal = res && res.fatal && store.sheet('Holdings')
      ? h('div', { class: 'notice error dp-step-notice' }, h('b', {}, 'Holdings cannot be valued: '), 'a required column was not found. See step 2.') : null;
    const line = 'Drop the AUM workbook: the four sheets are picked by name, and a Scope Settings tab, if present, configures everything below.';
    return stepCard(1, 'load', 'Load the workbook', S.status.load, line, h('div', {},
      state.lastLoad ? lastLoadNotice() : null, fatal, dropZone(true), list, holdingsVersion(res),
      h('div', { class: 'dp-step-foot' },
        h('span', {}, h('b', {}, 'Settings: '), settingsSourceText(res), n ? ` · ${n} changed here` : '', setS.present === false && setG ? h('span', { class: 'muted' }, ' (the sheet was loaded but none of its tables was read)') : null),
        h('a', { href: Scope.href('data', 'inputs') }, 'Inputs tab: paste a sheet, download the sheets'))));
  }

  /** The Holdings sheet in use (source, date, size), how to load a new month, the previous month's undo, and the working-workbook download. */
  function holdingsVersion(res) {
    const g = store.sheet('Holdings'); if (!g) return null;
    const src = store.state.sources.Holdings, size = gridSize(g), prev = store.state.previousHoldings, edits = (store.state.edits || []).length;
    const base = res && res.base ? res.base : res;
    return h('div', { class: 'dp-month' },
      h('div', {}, h('b', {}, 'Holdings in use: '), sourceText(src), src && src.loadedAt ? `, loaded ${when(src.loadedAt)}` : '', base && base.reportingDate ? `, reporting date ${F.date(base.reportingDate)}` : '', `, ${F.int(size.rows)} rows.`),
      h('div', { class: 'small muted' }, 'New month? Drop just the new Holdings sheet above (a workbook with a Holdings tab, or Holdings.csv). Mapping, Hardcoded, ESG Hardcoded, the rows added in step 3 and every setting stay as they are, and the previous Holdings is kept for one step of undo.'),
      prev ? h('div', { class: 'dp-month-prev' }, h('span', {}, `Previous Holdings kept: ${sourceText(prev.source)}, replaced ${when(prev.replacedAt)}. `),
        h('button', { class: 'btn btn-sm', onClick: () => { if (global.confirm('Put back the previous Holdings sheet? The current one is dropped.')) { store.restorePreviousHoldings(); UI.toast('Previous Holdings restored'); } } }, ic('refresh-cw'), 'Restore previous Holdings')) : null,
      h('div', { class: 'dp-step-tools' }, downloadWorkingBtn(res), h('span', { class: 'small muted' }, `The file to keep: the four sheets as loaded${edits ? ` plus the ${plural(edits, 'row')} added here` : ''}, with the ${settingsName()} sheet.`)));
  }

  // ---------- step 2: columns ----------
  /** Step 2: how many required inputs were matched to a column, with the ones that were not. */
  function columnsStep(res, S) {
    const line = 'Every input the calculation needs is found by its column name in Holdings, Hardcoded and ESG Hardcoded.';
    if (!res) return stepCard(2, 'columns', 'Columns', S.status.columns, line, waitBody());
    const miss = S.req.filter((r) => !r.letter);
    return stepCard(2, 'columns', 'Columns', S.status.columns, line, h('div', {},
      h('p', { class: 'dp-step-fig' }, h('b', {}, `${S.reqOk} of ${S.req.length}`), ' required inputs resolved', miss.length ? '' : '.'),
      miss.length ? h('ul', { class: 'dp-step-list' }, miss.map((r) => h('li', {}, UI.badge('not found', 'error'), ' ', h('b', {}, r.sheet), `: ${r.label}`))) : null,
      h('a', { class: 'btn btn-sm', href: Scope.href('data', 'columns', miss.length ? miss[0].sheet : 'Holdings') }, ic('columns'), 'Review columns')));
  }

  // ---------- step 3: mapping gaps ----------
  /** Step 3: securities, investor codes and assets that Holdings uses but Mapping does not know, each with an Add button that appends the row here. */
  function gapsStep(res, S) {
    const line = 'Every Security ID must be in Security Mapping, every investor code in Funding Name and every asset in Active Assets. Whatever is missing can be added here: the row is appended to Mapping, kept with the workbook, and read like any other row.';
    if (!res) return stepCard(3, 'gaps', 'Mapping gaps', S.status.gaps, line, waitBody());
    const G = S.gaps, n = G.securities.length + G.investors.length + G.inactive.length, edits = store.state.edits || [];
    const body = h('div', {});
    const fmtAmt = (g) => `${g.currency || ''} ${F.int(g.nominal)}`.trim();
    if (!n) body.appendChild(h('p', { class: 'dp-step-fig' }, h('b', {}, 'Every Holdings row is mapped.'), edits.length ? ` ${plural(edits.length, 'row')} added here.` : ' Nothing to add.'));
    else body.appendChild(h('p', { class: 'dp-step-fig' }, h('b', {}, plural(n, 'gap')), ' to close: ', [G.securities.length ? plural(G.securities.length, 'security') : '', G.investors.length ? plural(G.investors.length, 'investor code') : '', G.inactive.length ? plural(G.inactive.length, 'asset') + ' outside Active Assets' : ''].filter(Boolean).join(', '), '.'));
    if (G.securities.length) body.appendChild(gapSection('Securities not in Security Mapping', 'positions excluded until the Security ID is mapped to an asset', UI.table({ rows: G.securities, compact: true, filter: false, pageSize: 200, columns: [
      { key: 'holdingId', label: 'Security ID', class: 'mono strong' }, { key: 'securityName', label: 'Security name', class: 'wrap' },
      { key: 'investors', label: 'Held by', class: 'wrap', format: (v) => v.join(', ') }, { key: 'positions', label: 'Positions', align: 'right' },
      { key: 'nominal', label: 'Nominal', align: 'right', render: (g) => h('span', {}, fmtAmt(g)) },
      { key: '_a', label: '', render: (g) => h('div', { class: 'dp-row-actions' }, h('button', { class: 'btn btn-sm btn-primary', onClick: () => addSecurityModal(g, res) }, ic('plus'), 'Add to Security Mapping')) }] })));
    if (G.investors.length) body.appendChild(gapSection('Investor codes not in Funding Name', 'positions counted in asset totals but in no investor column', UI.table({ rows: G.investors, compact: true, filter: false, pageSize: 200, columns: [
      { key: 'investorId', label: 'Investor code', class: 'mono strong' }, { key: 'portfolioName', label: 'Portfolio name', class: 'wrap' },
      { key: 'securities', label: 'Holds', class: 'wrap', format: (v) => v.slice(0, 4).join(', ') + (v.length > 4 ? ', …' : '') }, { key: 'positions', label: 'Positions', align: 'right' },
      { key: 'nominal', label: 'Nominal', align: 'right', render: (g) => h('span', {}, fmtAmt(g)) },
      { key: '_a', label: '', render: (g) => h('div', { class: 'dp-row-actions' }, h('button', { class: 'btn btn-sm btn-primary', onClick: () => addInvestorModal(g, res) }, ic('plus'), 'Add to Funding Name')) }] })));
    if (G.inactive.length) body.appendChild(gapSection('Assets held but not in Active Assets', 'left out of the Output, as in the workbook, until listed in column J', UI.table({ rows: G.inactive, compact: true, filter: false, pageSize: 200, columns: [
      { key: 'codeName', label: 'Code name', class: 'strong' }, { key: 'securityNames', label: 'Security names', class: 'wrap', format: (v) => v.join(', ') },
      { key: 'positions', label: 'Positions', align: 'right' }, { key: 'nominal', label: 'Nominal', align: 'right', render: (g) => h('span', {}, fmtAmt(g)) },
      { key: '_a', label: '', render: (g) => h('div', { class: 'dp-row-actions' }, h('button', { class: 'btn btn-sm btn-primary', onClick: () => addActive(g) }, ic('plus'), 'Add to Active Assets')) }] })));
    if (edits.length) body.appendChild(editsSection(edits, res));
    body.appendChild(h('div', { class: 'dp-step-tools' }, downloadWorkingBtn(res), h('span', { class: 'small muted' }, 'The workbook as it is now: the four sheets with the rows added here, plus the settings sheet.')));
    return stepCard(3, 'gaps', 'Mapping gaps', S.status.gaps, line, body);
  }
  /** A titled block inside the gaps step. */
  const gapSection = (title, sub, table) => h('div', { class: 'dp-gap' }, h('h3', { class: 'dp-gap-title' }, title, h('span', { class: 'dp-gap-sub' }, sub)), table);

  /** Dialog: add a Security ID to Security Mapping, as a new asset or as another holding of an existing asset. */
  function addSecurityModal(g, res) {
    const assets = (res.assets || []).slice().sort((a, b) => String(a.code_name).localeCompare(String(b.code_name)));
    const code = h('input', { class: 'input', value: suggestCode(g.securityName, res), 'aria-label': 'Code name', spellcheck: 'false' });
    const name = h('input', { class: 'input', value: g.securityName || '', 'aria-label': 'Project name' });
    const ident = h('input', { class: 'input mono', value: g.holdingId, 'aria-label': 'Identification ID', spellcheck: 'false' });
    const tg = h('input', { class: 'input', value: '', placeholder: 'optional', 'aria-label': 'Transaction group' });
    const active = h('input', { type: 'checkbox', checked: true });
    const existing = h('select', { class: 'input', 'aria-label': 'Existing asset', onChange: (e) => {
      const a = assets.find((x) => x.code === e.target.value);
      if (a) { ident.value = a.code; code.value = a.code_name || ''; name.value = a.name || ''; tg.value = (a.attrs && a.attrs.transaction_group) || ''; }
      else { ident.value = g.holdingId; code.value = suggestCode(g.securityName, res); name.value = g.securityName || ''; }
    } }, h('option', { value: '' }, 'A new asset'), assets.map((a) => h('option', { value: a.code }, `${a.code_name || a.code} · ${a.name || ''}`)));
    const field = (label, el, note) => h('div', { class: 'dp-form-row' }, h('label', {}, label), el, note ? h('span', { class: 'small muted' }, note) : null);
    const m = UI.modal({ title: `Add Security ID ${g.holdingId} to Security Mapping`, body: h('div', {},
      h('p', { class: 'small' }, `${g.securityName || 'This security'} is held by ${g.investors.join(', ')} (${plural(g.positions, 'position')}). The row is appended to Mapping › Security Mapping and kept with the workbook; it is not written to the original file.`),
      field('Belongs to', existing, 'another holding of an asset already mapped, or a new asset'),
      field('Code name', code, 'Mapping column Q'), field('Project name', name, 'column R'), field('Identification ID', ident, 'column S: the asset key, equal to the Security ID for a new asset'), field('Transaction group', tg, 'column U'),
      h('label', { class: 'dp-check' }, active, ' Also list it in Active Assets, so the asset appears in the Output')),
      actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => {
        const codeName = code.value.trim(), identificationId = ident.value.trim();
        if (!codeName || !identificationId) { UI.toast('Code name and identification ID are needed', 'warn'); return; }
        const list = [{ table: 'securityMapping', values: { codeName, holdingsName: name.value.trim(), identificationId, holdingId: g.holdingId, transactionGroup: tg.value.trim() }, note: `Security ID ${g.holdingId} added on Data › Setup` }];
        if (active.checked) list.push({ table: 'activeAssets', values: { list: g.securityName || g.holdingId, mapping: codeName }, note: `${codeName} listed in Active Assets on Data › Setup` });
        m.close(); store.addEdits(list); UI.toast(`${g.holdingId} mapped to ${codeName}`);
      } }, ic('check'), 'Add')] });
  }
  /** A code name suggestion for a new asset: the first word of its name in capitals plus a number not yet used. */
  function suggestCode(securityName, res) {
    const used = new Set((res.assets || []).map((a) => String(a.code_name || '').toUpperCase()));
    const stem = (String(securityName || 'NEW').match(/[A-Za-z]+/) || ['NEW'])[0].toUpperCase().slice(0, 4).padEnd(4, 'X');
    for (let i = 1; i < 1000; i++) { const c = stem + String(i).padStart(2, '0'); if (!used.has(c)) return c; }
    return stem + Date.now() % 1000;
  }
  /** Dialog: add an investor code to Funding Name, as a new investor column or under an existing one. */
  function addInvestorModal(g, res) {
    const inv = diag(res).investors || [];
    const stem = String(g.portfolioName || '').replace(/\s*(portfolio|mandate|fund|units?)\s*$/i, '').trim();
    const fund = h('input', { class: 'input', value: g.portfolioName || '', 'aria-label': 'Fund name' });
    const colNew = h('input', { class: 'input', value: stem, placeholder: 'Name of the new investor column', 'aria-label': 'New investor column' });
    const colSel = h('select', { class: 'input', 'aria-label': 'Investor column', onChange: (e) => { colNew.disabled = !!e.target.value; } },
      h('option', { value: '' }, 'A new investor column'), inv.map((i) => h('option', { value: origOf(i) }, i.label)));
    const field = (label, el, note) => h('div', { class: 'dp-form-row' }, h('label', {}, label), el, note ? h('span', { class: 'small muted' }, note) : null);
    const m = UI.modal({ title: `Add investor code ${g.investorId} to Funding Name`, body: h('div', {},
      h('p', { class: 'small' }, `Code ${g.investorId}${g.portfolioName ? ' (' + g.portfolioName + ')' : ''} holds ${plural(g.positions, 'position')}. The row is appended to Mapping › Funding Name and kept with the workbook.`),
      field('Investor column', colSel, 'column Z: the column these positions count in'), field('New column name', colNew, 'when it is a new column; set its type and weight in step 4 afterwards'),
      field('Fund name', fund, 'column Y'), field('Holdings ID', h('input', { class: 'input mono', value: g.investorId, readonly: true }), 'column AA: the investor code')),
      actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => {
        const holdingsName = colSel.value || colNew.value.trim();
        if (!holdingsName) { UI.toast('Name the investor column', 'warn'); return; }
        m.close();
        store.addEdit({ table: 'fundingName', values: { fundName: fund.value.trim() || holdingsName, holdingsName, holdingsId: g.investorId }, note: `Investor code ${g.investorId} added on Data › Setup` });
        UI.toast(colSel.value ? `${g.investorId} now counts in ${holdingsName}` : `${holdingsName} added: set its type and weight in step 4`, colSel.value ? '' : 'warn');
      } }, ic('check'), 'Add')] });
  }
  /** List an asset's security names in Active Assets (column I → J), so the asset enters the Output. */
  function addActive(g) {
    const names = g.securityNames.length ? g.securityNames : [g.codeName];
    store.addEdits(names.map((n) => ({ table: 'activeAssets', values: { list: n, mapping: g.codeName }, note: `${g.codeName} listed in Active Assets on Data › Setup` })));
    UI.toast(`${g.codeName} listed in Active Assets`);
  }
  /** The rows added here, with Undo. */
  function editsSection(edits, res) {
    const tableName = { securityMapping: 'Security Mapping', fundingName: 'Funding Name', activeAssets: 'Active Assets' };
    const unapplied = new Set(((store.effectiveSheets() || {}).unapplied || []).map((e) => e.id));
    const rows = edits.slice().reverse().map((e) => ({ e, table: tableName[e.table] || e.table, values: Object.entries(e.values || {}).map(([k, v]) => `${COL_LABEL[k] || k}: ${v}`).join(' · '), at: when(e.at), ok: !unapplied.has(e.id) }));
    return gapSection(`Rows added here (${edits.length})`, 'appended below the table in Mapping; part of the downloaded workbook', UI.table({ rows, compact: true, filter: false, pageSize: 200, columns: [
      { key: 'table', label: 'Mapping table', class: 'strong' }, { key: 'values', label: 'Row', class: 'wrap' }, { key: 'at', label: 'Added', class: 'dim' },
      { key: 'ok', label: '', render: (r) => (r.ok ? h('span') : UI.badge('table not found', 'error', 'the Mapping table this row belongs to was not located, so the row is not applied')) },
      { key: '_a', label: '', render: (r) => h('div', { class: 'dp-row-actions' }, h('button', { class: 'btn btn-sm btn-ghost', title: 'Remove this added row', onClick: () => { store.removeEdit(r.e.id); UI.toast('Row removed'); } }, ic('x'), 'Undo')) }] }));
  }
  /** Button: download the working workbook (the sheets with the app's additions, plus the settings sheet). */
  function downloadWorkingBtn(res) {
    return h('button', { class: 'btn btn-sm', disabled: !store.sheet('Holdings'), onClick: downloadWorkingWorkbook }, ic('download'), 'Download working workbook (.xlsx)');
  }
  /** The four sheets with the rows added here, plus the Scope Settings sheet as it is in force, as one .xlsx. */
  function downloadWorkingWorkbook() {
    const sheets = Object.assign({}, store.effectiveSheets());
    const grid = settingsGridNow(); if (grid) sheets[settingsName()] = grid;
    downloadWorkbook(sheets, `Scope-workbook-${today()}.xlsx`);
  }

  // ---------- step 4: ownership and views (the workbook's Output header row and its Calculations formulas) ----------
  /**
   * The model behind step 4 and the Formulas tab: the investor columns with type, display name and group ownership, and the
   * views that are not plain columns, each as a formula. Keys are workbook names, so changes survive renames.
   */
  function wtModel(D, res) {
    const inv = D.investors || [], attr = attrLabel(res), mappingViews = D.mappingViews || [];
    const cols = inv.map((i) => ({ label: i.label, key: origOf(i), type: i.group || 'Unclassified', weight: U.isNum(+i.weight) ? +i.weight : 0, weightText: i.weightText || '', source: i.source, nameSource: i.nameSource, inferred: !!i.typeInferred, added: !!i.added, inv: i }));
    const rows = [];
    for (const v of D.views || []) {
      if (v.def === '*' || v.def === 'column' || v.def === 'group') continue;
      const weights = new Map(); for (const c of v.composition || []) if (c.label !== '*') weights.set(c.label, c.weight);
      rows.push({ view: v.view, kind: v.kind, formula: v.formula || '', weights, lt: v.lookThroughOf || null, base: v.lookThroughBase || null, undefined: v.kind === 'undefined', inMapping: mappingViews.includes(v.view) });
    }
    const columnViews = (D.views || []).filter((v) => v.def === 'column').map((v) => v.view), allViews = (D.views || []).filter((v) => v.def === '*').map((v) => v.view);
    const groupSource = cols.some((c) => c.source === 'override') ? 'override' : cols.some((c) => c.source === 'sheet') ? 'sheet' : cols.some((c) => c.source === 'settings') ? 'settings' : 'default';
    const unclassified = cols.filter((c) => c.type === 'Unclassified');
    const status = !cols.length ? 'attention' : unclassified.length || rows.some((r) => r.undefined) || groupSource === 'default' ? 'attention' : 'done';
    return { cols, rows, attr, groupSource, columnViews, allViews, unclassified, status, find: (name) => cols.find((c) => nk(c.label) === nk(name) || nk(c.key) === nk(name)) || null };
  }

  /** Step 4: the ownership table and the view formulas. */
  function weightsStep(res, S) {
    const attr = attrLabel(res);
    const line = `Two short tables, as in the workbook: how much of each investor column the ${attr} owns (the Output header row), and a formula for each view that is not a plain column (the Calculations formulas, with names instead of column letters). "<investor> incl. part in funds" formulas also give that investor's share of each fund.`;
    if (!res) return stepCard(4, 'weights', 'Ownership and views', S.status.weights, line, waitBody());
    const M = S.wt;
    if (!M.cols.length) return stepCard(4, 'weights', 'Ownership and views', 'attention', line, UI.empty('No investor columns: the Funding Name table of Mapping (columns Y to AA) is empty or was not found.'));
    const nOv = ['investors', 'names', 'views'].reduce((n, k) => n + Object.keys(overrides()[k] || {}).length, 0);
    const tools = h('div', { class: 'dp-step-tools' },
      h('button', { class: 'btn btn-sm btn-primary', onClick: () => addViewModal(M) }, ic('plus'), 'Add view'),
      h('button', { class: 'btn btn-sm', onClick: () => wtPasteModal(M) }, ic('clipboard'), 'Paste the Output header rows'),
      M.unclassified.length ? h('button', { class: 'btn btn-sm', onClick: () => bulkThirdParty(M.unclassified.map((c) => c.inv)) }, ic('users'), `Set the ${plural(M.unclassified.length, 'unclassified column')} to Third party, 0`) : null,
      h('span', { class: 'dp-spacer' }),
      nOv ? h('button', { class: 'btn btn-sm btn-danger', onClick: undoWeights }, ic('refresh-cw'), 'Undo changes made here') : null);
    const notes = [];
    const undef = M.rows.filter((r) => r.undefined);
    if (undef.length) notes.push(h('li', {}, UI.badge('empty', 'warn'), ' ', undef.map((r) => r.view).join(', '), ': listed in Mapping column H but no formula yet, so the view shows nothing.'));
    if (M.groupSource === 'default') notes.push(h('li', {}, UI.badge('no ownership', 'warn'), ` Nothing is attributed to the ${attr} until the ownership is entered (or the Scope Settings sheet is loaded).`));
    if (M.unclassified.length) notes.push(h('li', {}, UI.badge('unclassified', 'warn'), ' ', M.unclassified.map((c) => c.label).join(', '), ': no type yet (treated as third party, 0).'));
    const implicit = [];
    if (M.allViews.length) implicit.push(`${M.allViews.join(', ')}: every column`);
    if (M.columnViews.length) implicit.push(`plain investor columns, no formula needed: ${M.columnViews.join(', ')}`);
    return stepCard(4, 'weights', 'Ownership and views', M.status, line, h('div', {}, tools,
      h('h3', { class: 'dp-gap-title' }, `${attr} ownership`, h('span', { class: 'dp-gap-sub' }, '1 = fully owned, 0 = not owned, 0.45, 45% or 7/20 for a fund partly owned. Enter or leaving a cell saves it; Escape undoes.')),
      ownershipTable(M),
      h('h3', { class: 'dp-gap-title dp-gap-title-2' }, 'Views and the "incl. part in funds" calculations', h('span', { class: 'dp-gap-sub' }, 'the Calculations sheet\'s formulas with names instead of column letters: investor columns or other views, each with an optional coefficient (7/20 × Fund 1, 25% of Fund 1). Most workbooks need only the three "incl. part in funds" rows')),
      viewFormulaList(M),
      notes.length ? h('ul', { class: 'dp-step-list dp-lt-notes' }, notes) : null,
      implicit.length ? h('p', { class: 'small muted dp-step-hint' }, implicit.join(' · ') + '.') : null));
  }

  /** The ownership table: workbook name, display name, type and the group's share per investor column. */
  function ownershipTable(M) {
    const head = h('thead', {}, h('tr', {}, ['Investor column', 'Display name', 'Type', `${M.attr} ownership`, 'Source'].map((l, i) => h('th', { class: ['dp-inv-name', '', '', 'num', ''][i] }, l))));
    const invs = M.cols.map((c) => ({ label: c.label, original: c.key }));
    const body = h('tbody', {}, M.cols.map((c, idx) => {
      const shown = c.label !== c.key ? c.label : '';
      const nameIn = h('input', { type: 'text', class: 'input dp-in dp-in-name' + (c.nameSource === 'override' ? ' dp-changed' : ''), value: shown, placeholder: c.key, autocomplete: 'off', spellcheck: 'false',
        'aria-label': `Display name of ${c.key}`, dataset: { focus: `own|${c.key}|name`, text: shown, r: String(idx), c: 'name' },
        onChange: (e) => commitName({ label: c.label, original: c.key, nameSource: c.nameSource }, e.target, invs), onKeydown: cellKeys });
      const sel = h('select', { class: 'input dp-select' + (c.source === 'override' ? ' dp-changed' : ''), 'aria-label': `Type of ${c.label}`, dataset: { focus: `own|${c.key}|type` },
        onChange: (e) => { const t = e.target.value; deferSave(() => setInvestor(c.inv, t, c.weight)); } },
        U.uniq((calc().INVESTOR_TYPES || GROUPS).concat(['Unclassified'])).map((t) => h('option', { value: t, selected: t === c.type }, t)));
      const wText = c.source === 'default' ? '' : c.weightText || fmtWeight(c.weight);
      const wIn = h('input', { type: 'text', inputmode: 'decimal', class: 'input dp-in dp-num' + (c.source === 'override' ? ' dp-changed' : ''), value: wText, autocomplete: 'off', placeholder: c.source === 'default' ? 'not set' : '',
        'aria-label': `${M.attr} ownership of ${c.label}`, title: '1, 0.35, 35% or 7/20', dataset: { focus: `own|${c.key}|weight`, text: wText, r: String(idx), c: 'weight' },
        onFocus: (e) => e.target.select(), onChange: (e) => commitOwnership(c, e.target), onKeydown: cellKeys });
      const src = c.source === 'override' || c.nameSource === 'override' ? UI.badge('changed here', 'manual', 'saved in this browser') : c.source === 'sheet' ? UI.badge('from your sheet', 'info', `the ${settingsName()} sheet`) : c.source === 'settings' ? UI.badge('settings', 'muted') : UI.badge('not set', 'warn');
      return h('tr', { class: c.type === 'Unclassified' ? 'dp-row-warn' : '' },
        h('td', { class: 'dp-inv-name strong' }, c.key, c.added ? h('span', { class: 'small muted' }, ' (added in step 3)') : c.inferred ? h('span', { class: 'small muted' }, ' (type inferred)') : null),
        h('td', {}, nameIn), h('td', {}, sel), h('td', { class: 'num' }, wIn),
        h('td', {}, h('div', { class: 'dp-row-actions dp-left' }, src, c.source === 'override' || c.nameSource === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Undo the changes made here for this column', onClick: () => resetInvestor(c.inv, true) }, ic('refresh-cw')) : null)));
    }));
    return h('div', { class: 'tbl-scroll compact dp-inv-scroll', dataset: { keepScroll: 'own' } }, h('table', { class: 'tbl dp-inv' }, head, body));
  }
  /** Weight as short text: 1, 0.35, 0.2481 (six significant digits). */
  const fmtWeight = (w) => (U.isNum(+w) ? String(+(+w).toPrecision(6)) : String(w));
  /** Save an ownership typed in the table (1, 0.35, 35% or 7/20); the type is inferred when the column has none. */
  function commitOwnership(c, input) {
    const prev = input.dataset.text || '', txt = input.value.trim();
    if (txt === prev) return;
    const w = txt === '' ? 0 : calc().parseWeight(txt);
    if (!isFinite(w) || w < 0) { UI.toast('Enter an ownership such as 1, 0.35, 35% or 7/20', 'warn'); input.value = prev; return; }
    input.dataset.text = txt;
    deferSave(() => setInvestor(c.inv, c.type === 'Unclassified' ? inferType(w) : c.type, w, txt));
  }
  /** A type for a column that has none, from the ownership just given to it. */
  const inferType = (w) => (w >= 1 ? 'Group entity' : w > 0 ? 'Fund' : 'Third party');

  /** The views as editable formulas: name, badges, the formula box, Reset or Remove. */
  function viewFormulaList(M) {
    if (!M.rows.length) return h('p', { class: 'small muted' }, 'No views beyond the plain investor columns yet. Add one, or paste the Output header rows.');
    return h('div', { class: 'dp-formulas' }, M.rows.map((r) => {
      const inp = h('input', { type: 'text', class: 'input dp-formula-in' + (r.kind === 'override' ? ' dp-changed' : '') + (r.undefined ? ' dp-formula-empty' : ''), value: r.formula, placeholder: 'e.g. Investor 1 + 7/20 × Fund 1 + Fund 6', spellcheck: 'false', autocomplete: 'off',
        'aria-label': `Formula of ${r.view}`, dataset: { focus: `view|${r.view}`, text: r.formula }, onChange: (e) => commitFormula(r, e.target, M), onKeydown: (e) => { if (e.key === 'Escape') { e.target.value = r.formula; } else if (e.key === 'Enter') e.target.blur(); } });
      return h('div', { class: 'dp-formula-row' + (r.undefined ? ' dp-formula-row-empty' : '') },
        h('div', { class: 'dp-formula-name' }, h('b', {}, r.view), h('span', { class: 'dp-lt-sub' },
          r.lt ? h('span', { title: r.base ? `look-through of ${r.base}: the fund coefficients are its share of each fund's units` : `"${r.lt}" is not an investor column or a view` }, ic('git-merge', 12), ' ', r.base ? `look-through of ${r.base}` : 'look-through (name not recognised)', ' · ') : null,
          rowSourceBadge(r.kind), r.inMapping ? ' · Mapping H' : null)),
        h('div', { class: 'dp-formula-eq' }, '='), inp,
        h('div', { class: 'dp-formula-tools' }, r.kind === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: r.inMapping ? 'Undo the changes made here' : 'Remove this view (added here)', 'aria-label': `Reset ${r.view}`, onClick: () => { store.setOverride('views', r.view, null); UI.toast(`${r.view}: ${r.inMapping ? 'changes made here undone' : 'removed'}`); } }, ic(r.inMapping ? 'refresh-cw' : 'x')) : null));
    }));
  }
  /** Where a row's definition comes from. */
  function rowSourceBadge(kind) {
    if (kind === 'override') return UI.badge('changed here', 'manual', 'saved in this browser');
    if (kind === 'sheet') return UI.badge('from your sheet', 'info', `the ${settingsName()} sheet`);
    if (kind === 'settings') return UI.badge('settings', 'muted', '§1 defaults in the calculation file');
    if (kind === 'undefined') return UI.badge('empty', 'warn', 'no formula yet');
    return UI.badge('not set', 'warn');
  }
  /** Validate a typed formula (names must be investor columns or views) and save it as this view's definition. */
  function commitFormula(r, input, M) {
    const prev = input.dataset.text || '', txt = input.value.trim();
    if (txt === prev) return;
    const f = calc().parseFormula(txt);
    if (f.error) { UI.toast(`Formula not read: ${f.error}`, 'warn'); input.value = prev; return; }
    const views = M.rows.map((x) => x.view);
    const unknown = f.terms.filter((t) => !M.find(t.name) && !views.some((v) => nk(v) === nk(t.name)) && nk(t.name) !== nk(M.attr)).map((t) => t.name);
    if (unknown.length) { UI.toast(`Not an investor column or a view: ${unknown.join(', ')}`, 'warn'); input.value = prev; return; }
    input.dataset.text = txt;
    deferSave(() => { store.setOverride('views', r.view, txt); UI.toast(`${r.view} = ${txt || '(nothing)'}`); });
  }
  /** Undo every ownership, type, name and formula change made here (the sheet or the calculation file applies again). */
  function undoWeights() {
    if (!global.confirm(`Undo every change made here to ownership, types, display names and view formulas? The ${settingsName()} sheet, or the calculation file's defaults, apply again.`)) return;
    writeOverrides((ov) => { delete ov.investors; delete ov.names; delete ov.views; });
    UI.toast('Changes made here undone');
  }

  /** "Add view" dialog: a name and a formula; a look-through view is named after its investor and starts from its column. */
  function addViewModal(M) {
    const name = h('input', { class: 'input', placeholder: 'e.g. Region A, or Investor 1 incl. part in funds', 'aria-label': 'View name' });
    const formula = h('input', { class: 'input', placeholder: 'e.g. Investor 4 + Investor 5, or Investor 1 + 7/20 × Fund 1 + Fund 6', 'aria-label': 'Formula', spellcheck: 'false' });
    const who = h('select', { class: 'input', 'aria-label': 'Look-through for', onChange: (e) => { const c = M.cols.find((x) => x.key === e.target.value); if (c) { name.value = `${c.label} incl. part in funds`; formula.value = c.label; } } },
      h('option', { value: '' }, 'A plain view'), M.cols.map((c) => h('option', { value: c.key }, `Look-through of ${c.label}`)));
    const field = (label, el, note) => h('div', { class: 'dp-form-row' }, h('label', {}, label), el, note ? h('span', { class: 'small muted' }, note) : null);
    const m = UI.modal({ title: 'Add view', wide: true, body: h('div', {},
      field('Kind', who, 'a look-through view is named after the investor and starts with its own column; add its share of each fund to the formula'),
      field('Name', name, 'as it should appear in the View selector'),
      field('Formula', formula, 'investor columns or other views, each with an optional coefficient: 7/20 × Fund 1, 25% of Fund 1, Fund 1 × 0.25')),
      actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => {
        const v = name.value.trim(); if (!v) { UI.toast('Name the view', 'warn'); name.focus(); return; }
        if (M.rows.some((r) => nk(r.view) === nk(v)) || M.find(v) || nk(v) === nk(M.attr)) { UI.toast(`"${v}" already exists`, 'warn'); return; }
        const f = calc().parseFormula(formula.value);
        if (f.error) { UI.toast(`Formula not read: ${f.error}`, 'warn'); formula.focus(); return; }
        m.close(); store.setOverride('views', v, formula.value.trim()); UI.toast(`${v} added`);
      } }, ic('check'), 'Add view')] });
    setTimeout(() => name.focus(), 0);
  }

  /**
   * Read a pasted block of the workbook's Output header rows: the investor column names across the first row, then one row
   * per view with its weights (the attribution row gives the ownership; "Type" and "Display name" rows are read too).
   * Returns { group, views, types, names, unknown, bad, cells }.
   */
  function parseWeightBlock(text, M) {
    const parse = IN('parseText');
    let rows;
    try { rows = parse ? parse(text).rows : String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.split('\t')); } catch (e) { return { error: String((e && e.message) || e) }; }
    rows = (rows || []).map((r) => (r || []).map((x) => (x === null || x === undefined ? '' : String(x).trim()))).filter((r) => r.some(Boolean));
    if (rows.length < 2) return { error: 'Paste the row of investor names and at least one row of weights under it.' };
    const out = { group: new Map(), views: new Map(), types: new Map(), names: new Map(), unknown: [], bad: 0, cells: 0 };
    const first = rows[0].slice(1).map((n) => M.find(n));
    if (!first.filter(Boolean).length) return { error: 'None of the names in the first row is an investor column: paste the block with the investor names across the first row.' };
    rows[0].slice(1).forEach((n, i) => { if (n && !first[i]) out.unknown.push(n); });
    const PW = calc().parseWeight;
    for (const r of rows.slice(1)) {
      const name = r[0]; if (!name) continue;
      const k = nk(name);
      if (k === 'type' || k === 'investortype') { r.slice(1).forEach((v, j) => { const c = first[j]; if (c && v) { out.types.set(c.key, v); out.cells++; } }); continue; }
      if (k === 'displayname' || k === 'name') { r.slice(1).forEach((v, j) => { const c = first[j]; if (c) { out.names.set(c.key, v); out.cells++; } }); continue; }
      const isGroup = calc().isAttributionName && calc().isAttributionName(name, M.attr);
      const ex = M.rows.find((x) => nk(x.view) === k), viewName = ex ? ex.view : name;
      const target = isGroup ? out.group : (out.views.get(viewName) || out.views.set(viewName, new Map()).get(viewName));
      r.slice(1).forEach((v, j) => {
        const c = first[j]; if (!c) return;
        const w = v === '' ? 0 : PW(v);
        if (!isFinite(w) || w < 0) { out.bad++; return; }
        target.set(c.key, { w, text: v }); out.cells++;
      });
    }
    return out;
  }
  /** Save a parsed block in one update: types, names, ownership and view formulas (cells not pasted keep their value). */
  function applyWeightBlock(p, M) {
    writeOverrides((ov) => {
      ov.investors = ov.investors || {}; ov.names = ov.names || {}; ov.views = ov.views || {};
      const keys = new Set([].concat(Array.from(p.group.keys()), Array.from(p.types.keys())));
      for (const key of keys) {
        const c = M.cols.find((x) => x.key === key); if (!c) continue;
        const g = p.group.get(key), w = g ? g.w : c.weight, t = p.types.has(key) ? p.types.get(key) : c.type === 'Unclassified' ? inferType(w) : c.type;
        dropAliases(ov.investors, [c.key, c.label]); ov.investors[key] = [t, +(+w).toFixed(10), g && /[\/%]/.test(g.text) ? g.text : ''];
      }
      for (const [key, nm] of p.names) { const c = M.cols.find((x) => x.key === key); if (!c) continue; dropAliases(ov.names, [c.key]); if (nm && nm !== c.key) ov.names[key] = nm; else if (c.nameSource === 'sheet') ov.names[key] = key; }
      for (const [view, upd] of p.views) {
        const row = M.rows.find((x) => x.view === view), cur = new Map();
        if (row) for (const [label, w] of row.weights) { const c = M.cols.find((x) => x.label === label); cur.set(c ? c.key : label, { w, text: '' }); }
        for (const [key, v] of upd) cur.set(key, v);
        const terms = Array.from(cur).filter(([, v]) => v.w > 0).map(([key, v]) => ({ name: key, weight: v.w, text: /[\/%]/.test(v.text) ? v.text : '' }));
        ov.views[view] = calc().formulaText(terms);
      }
    });
  }
  /** "Paste the Output header rows" dialog. */
  function wtPasteModal(M) {
    const ta = h('textarea', { class: 'input dp-paste', placeholder: 'Paste here (Ctrl+V, or Cmd+V on a Mac)', spellcheck: 'false', wrap: 'off', 'aria-label': 'Output header rows' });
    const msg = h('div', { class: 'small dp-paste-foot' });
    const apply = () => {
      if (!ta.value.trim()) { msg.textContent = 'Nothing pasted yet.'; ta.focus(); return; }
      const p = parseWeightBlock(ta.value, M);
      if (p.error) { msg.textContent = p.error; msg.className = 'small dp-paste-foot dp-neg'; return; }
      if (!p.cells) { msg.textContent = `Nothing to merge.${p.unknown.length ? ` Not recognised: ${p.unknown.join(', ')}.` : ''}`; msg.className = 'small dp-paste-foot dp-neg'; return; }
      m.close(); applyWeightBlock(p, M);
      const extra = [p.unknown.length ? `not recognised: ${p.unknown.join(', ')}` : '', p.bad ? `${plural(p.bad, 'cell')} skipped (not a weight)` : ''].filter(Boolean).join('; ');
      UI.toast(`Updated (${plural(p.cells, 'cell')}${p.views.size ? `, ${plural(p.views.size, 'view')}` : ''})${extra ? '; ' + extra : ''}`, extra ? 'warn' : '');
    };
    const m = UI.modal({ title: 'Paste the Output header rows', wide: true,
      body: h('div', {},
        h('p', { class: 'small' }, `Copy the block from your workbook's Output sheet: the investor column names across the first row and, below them, the row named "${M.attr}" (the ownership) and any other view rows with their weights. Names may be workbook or display names; weights may be 1, 0.35, 35% or 7/20.`),
        h('p', { class: 'small muted' }, 'Rows that exist are updated (cells not in the block keep their value); new names become new views, written as formulas.'),
        ta, msg),
      actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: apply }, ic('check'), 'Merge and save')] });
    setTimeout(() => ta.focus(), 0);
  }

  /** Save an investor's type and ownership, keyed by its workbook name (replacing any key by display name); `text` keeps a fraction as typed. */
  function setInvestor(r, group, weight, text) {
    const orig = origOf(r);
    writeOverrides((ov) => { ov.investors = ov.investors || {}; dropAliases(ov.investors, [orig, r.label]); ov.investors[orig] = text && /[\/%]/.test(text) ? [group, +weight, text] : [group, +weight]; });
    UI.toast(`${r.label}: ${group}, ownership ${text || fmtWeight(weight)}`);
  }
  /** Remove the changes made here for one investor: type and ownership, and with `withName` its display name too. */
  function resetInvestor(r, withName) {
    const orig = origOf(r);
    writeOverrides((ov) => { if (ov.investors) dropAliases(ov.investors, [orig, r.label]); if (withName && ov.names) dropAliases(ov.names, [orig]); });
    UI.toast(`${orig}: changes made here undone`);
  }
  /** Set every unclassified investor to Third party with ownership 0, in one update. */
  function bulkThirdParty(unc) {
    if (!unc.length) return;
    writeOverrides((ov) => { ov.investors = ov.investors || {}; for (const r of unc) { dropAliases(ov.investors, [r.label, origOf(r)]); ov.investors[origOf(r)] = ['Third party', 0]; } });
    UI.toast(`${plural(unc.length, 'investor')} set to Third party, 0`);
  }
  /** Save a display name typed for a column (blank or the workbook name = show the workbook name). */
  function commitName(r, input, inv) {
    const orig = origOf(r), cur = input.dataset.text || '', v = input.value.trim();
    if (v === cur) { input.value = cur; return; }
    const target = v && v !== orig ? v : '';
    if (target) {
      const clash = inv.find((x) => origOf(x) !== orig && (nk(x.label) === nk(target) || nk(origOf(x)) === nk(target)));
      if (clash) { UI.toast(`"${target}" is already the name of another investor column (${origOf(clash)})`, 'warn'); input.value = cur; return; }
    }
    input.dataset.text = v;
    deferSave(() => {
      writeOverrides((ov) => {
        migrateLabel(ov, r.label, orig);
        ov.names = ov.names || {}; dropAliases(ov.names, [orig]);
        if (target) ov.names[orig] = target; else if (r.nameSource === 'sheet') ov.names[orig] = orig;
      });
      // blank means the workbook name: if the settings sheet still renames the column, keep the workbook name explicitly
      if (!target) { const now = (diag(currentRes()).investors || []).find((x) => origOf(x) === orig); if (now && now.label !== orig) store.setOverride('names', orig, orig); }
      UI.toast(target ? `${orig} is shown as ${target}` : `${orig} is shown by its workbook name`);
    });
  }

  // ---------- step 5: checks ----------
  /** Step 5: the workbook formula checks in brief, with a link to the Checks tab. */
  function checksStep(res, S) {
    const line = 'The workbook\'s own formula columns (Holdings B to E and row 2, Hardcoded D and E) worked out again and compared cell by cell.';
    if (!res) return stepCard(5, 'checks', 'Checks', S.status.checks, line, waitBody());
    if (!S.checks.length) return stepCard(5, 'checks', 'Checks', 'optional', line, UI.empty('None of the workbook\'s formula columns were found, so there is nothing to compare.'));
    const ok = S.checks.filter((c) => c.status === 'ok').length;
    const figs = h('div', { class: 'dp-check-sum' },
      h('span', {}, UI.badge(String(ok), 'ok'), ' reproduce the workbook'),
      h('span', {}, UI.badge(String(S.differs.length), S.differs.length ? 'warn' : 'muted'), ' differ'),
      h('span', {}, UI.badge(String(S.skipped.length), 'muted'), ' skipped because the workbook\'s formulas returned errors'));
    const list = h('ul', { class: 'dp-step-list' }, S.checks.map((c) => {
      const i = c.label.indexOf(' = '), name = i > 0 ? c.label.slice(0, i) : c.label, st = STATUS[c.status] || [c.status, 'muted'];
      return h('li', {}, UI.badge(st[0], st[1]), ' ', name, h('span', { class: 'muted' }, c.status === 'skipped' ? ` (${F.int(c.failed || 0)} formula errors in the workbook)` : ` (${F.int(c.matched)} of ${F.int(c.total)} cells)`));
    }));
    return stepCard(5, 'checks', 'Checks', S.status.checks, line, h('div', {}, figs, list,
      h('a', { class: 'btn btn-sm', href: Scope.href('data', 'checks') }, ic('check-circle'), 'Open the checks')));
  }

  /** The Scope Settings card on the Inputs tab: status, source, tables read, and Paste / Download. */
  function settingsSheetCard(res) {
    const name = settingsName(), g = store.sheet(name), src = store.state.sources[name];
    const loaded = !!(g && g.rows && g.rows.length), size = gridSize(g), n = countSettingsChanges();
    const pairs = [['Source', loaded ? sourceText(src) : 'Not loaded (optional)'], ['Size', loaded ? `${F.int(size.rows)} rows × ${F.int(size.cols)} columns` : '–']];
    if (loaded && res) pairs.push(['Tables', settingsTablesText(res) || '–']);
    pairs.push(['Settings', `${settingsSourceText(res)}${n ? `, ${n} changed here` : ''}`]);
    if (loaded && src && src.loadedAt) pairs.push(['Loaded', when(src.loadedAt)]);
    return UI.section({
      class: 'dp-sheet' + (loaded ? '' : ' dp-optional'), title: name, subtitle: 'optional: ownership, view formulas, names, FX exception',
      actions: [UI.badge(loaded ? 'loaded' : 'optional', loaded ? 'ok' : 'muted')],
      body: h('div', {}, UI.dl(pairs), h('div', { class: 'dp-sheet-actions' },
        h('button', { class: 'btn btn-sm', onClick: () => pasteModal(name) }, ic('clipboard'), 'Paste'),
        h('button', { class: 'btn btn-sm', disabled: !res, title: 'The settings in force, laid out as the sheet', onClick: () => downloadSettings('xlsx') }, ic('download'), 'Download pre-filled'),
        h('a', { class: 'btn btn-sm btn-ghost', href: Scope.href('data', 'setup') }, 'Setup'))),
    });
  }

  // =====================================================================================================================
  // Inputs
  // =====================================================================================================================
  /** Inputs tab: last-load report, drop zone, one card per sheet, how it works and the dataset summary. */
  function inputsTab(el, res) {
    const D = diag(res), H = (D.sheets || {}).Holdings;
    if (state.lastLoad) el.appendChild(lastLoadNotice());
    if (res && res.fatal && store.sheet('Holdings')) {
      const why = H && !H.headerRow ? 'its header row was not found' : 'a required column (Security ID, nominal or currency) was not found';
      el.appendChild(h('div', { class: 'notice error' }, h('b', {}, 'Holdings cannot be valued: '), why + '. ', h('a', { href: Scope.href('data', 'columns', 'Holdings') }, 'See the Columns tab'), '.'));
    }
    el.appendChild(loadSection());
    el.appendChild(h('div', { class: 'dp-sheets' }, SHEETS.map((n) => sheetCard(n, res, D)), settingsSheetCard(res)));
    el.appendChild(h('div', { class: 'grid-2 dp-grid' }, howSection(), datasetSection(res)));
  }

  /** Report of the last load: which sheets came from where, and any reader warnings (shown until dismissed). */
  function lastLoadNotice() {
    const L = state.lastLoad;
    return h('div', { class: 'notice dp-notice' + (L.warnings.length ? '' : ' info') },
      h('div', { class: 'dp-notice-head' },
        h('div', {}, h('b', {}, L.sheets.length ? `Loaded ${L.sheets.join(', ')}` : 'No sheet loaded'), ` ${L.from} at ${when(L.at).slice(11)}.`),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Dismiss', 'aria-label': 'Dismiss', onClick: () => { state.lastLoad = null; Scope.app.render(true); } }, ic('x'))),
      L.warnings.length ? h('ul', { class: 'dp-notice-list' }, L.warnings.map((w) => h('li', {}, w))) : null);
  }

  /**
   * Drop zone with a file picker for the workbook, per-sheet CSVs or the Scope Settings sheet. compact: a one-line
   * version for the Setup tab. Both read files with loadFiles().
   */
  function dropZone(compact) {
    const idle = 'Drop the AUM workbook here';
    const title = h('div', { class: 'dp-drop-title' }, idle);
    const picker = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xlsm,.csv,.tsv,.txt', class: 'hidden',
      onChange: (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; loadFiles(files, ui); } });
    const sub = compact
      ? 'The .xlsx or .xlsm workbook (Holdings, Mapping, Hardcoded, ESG Hardcoded and, if you have it, Scope Settings), or one CSV per sheet named after it.'
      : 'The .xlsx or .xlsm workbook with its four sheets and the optional Scope Settings sheet, or one CSV per sheet named after it (Holdings.csv, Mapping.csv, Hardcoded.csv, ESG Hardcoded.csv, Scope Settings.csv). Other tabs are ignored.';
    const drop = h('div', {
      class: 'dp-drop' + (compact ? ' dp-drop-compact' : ''),
      onDragOver: (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; drop.classList.add('over'); },
      onDragLeave: (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); },
      onDrop: (e) => { e.preventDefault(); drop.classList.remove('over'); loadFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []), ui); },
    },
    h('div', { class: 'dp-drop-icon' }, ic('upload', compact ? 22 : 30)),
    h('div', { class: 'dp-drop-text' }, title, h('div', { class: 'dp-drop-sub' }, sub)),
    h('div', { class: 'dp-drop-actions' }, h('button', { class: 'btn btn-primary' + (compact ? ' btn-sm' : ''), onClick: () => picker.click() }, ic('folder'), 'Choose files'), picker));
    // Busy state while a large workbook is read; the page re-renders once the sheets are loaded.
    const ui = {
      busy: (text) => { drop.classList.add('busy'); title.textContent = text; },
      idle: () => { drop.classList.remove('busy'); title.textContent = idle; },
    };
    return drop;
  }

  /** The drop zone with the reset, clear and download actions. */
  function loadSection() {
    const demo = global.SCOPE_DEMO;
    const drop = dropZone(false);
    const anyLoaded = allSheets().some((n) => store.sheet(n));
    return UI.section({
      title: 'Load the input sheets', subtitle: 'Holdings, Mapping, Hardcoded and ESG Hardcoded from the AUM workbook, and the optional Scope Settings sheet',
      actions: [
        h('button', { class: 'btn btn-sm', title: 'Forget the loaded sheets and use the synthetic demo workbook', onClick: () => { state.lastLoad = null; Scope.app.resetToDemo(); } }, ic('refresh-cw'), 'Reset to demo'),
        anyLoaded ? h('button', { class: 'btn btn-sm btn-danger', title: 'Remove every sheet, to build up a workbook sheet by sheet', onClick: clearSheets }, ic('x'), 'Clear all sheets') : null,
      ],
      body: h('div', {}, drop, h('div', { class: 'dp-downloads' },
        h('button', { class: 'btn btn-sm', disabled: !(demo && demo.sheets), onClick: () => downloadWorkbook(demo.sheets, 'Scope-demo-workbook.xlsx') }, ic('download'), 'Download demo workbook (.xlsx)'),
        h('button', { class: 'btn btn-sm', disabled: !anyLoaded, onClick: downloadWorkingWorkbook }, ic('download'), 'Download working workbook (.xlsx)'),
        h('span', { class: 'small muted' }, `The demo workbook shows the expected layout of every sheet, including ${settingsName()} (synthetic data).`))),
    });
  }

  /**
   * Read dropped or chosen files (a workbook, or CSVs named after their sheets) and load the sheets found, including the
   * optional Scope Settings sheet. Sheets not supplied are kept, so CSVs can arrive one at a time; the summary and any
   * reader warnings stay on the page until dismissed.
   */
  async function loadFiles(files, ui) {
    if (!files.length) return;
    const read = IN('readFiles');
    if (!read) { UI.toast('The workbook reader is not available in this copy of Scope', 'warn'); return; }
    const names = files.map((f) => f.name), from = names.length === 1 ? names[0] : plural(names.length, 'file');
    ui.busy(`Reading ${names.join(', ')}…`);
    await new Promise((r) => setTimeout(r, 30)); // let the busy state paint before a large workbook is parsed
    let out;
    try { out = await read(files); }
    catch (e) { ui.idle(); UI.toast(`Could not read ${from}: ${(e && e.message) || e}`, 'warn'); return; }
    const found = allSheets().filter((n) => out && out.sheets && out.sheets[n]);
    const warnings = ((out && out.warnings) || []).slice();
    if (!found.length) {
      ui.idle();
      state.lastLoad = { at: new Date().toISOString(), from: `from ${from}`, sheets: [], warnings: warnings.length ? warnings : [`No sheet called Holdings, Mapping, Hardcoded, ESG Hardcoded or ${settingsName()} was found.`] };
      Scope.app.render(true);
      UI.toast(`No input sheet found in ${from}`, 'warn');
      return;
    }
    if (!confirmSettingsOverDemo(found)) { ui.idle(); return; }
    const before = demoSheetsKept(found);
    const used = U.uniq(found.map((n) => (out.sources && out.sources[n] && out.sources[n].file) || '').filter(Boolean)); // the files that supplied sheets
    const usedText = used.length ? used.join(', ') : from;
    const sheets = {}, sources = {};
    for (const n of found) { sheets[n] = out.sheets[n]; if (out.sources && out.sources[n]) sources[n] = out.sources[n]; }
    state.lastLoad = { at: new Date().toISOString(), from: `from ${usedText}`, sheets: found, warnings: warnings.slice() };
    store.setSheets(sheets, sources, { merge: true });
    if (found.includes(settingsName()) && !store.sheet(settingsName())) warnings.push(`The ${settingsName()} sheet was read but this copy of Scope cannot keep it; its settings do not apply.`);
    const all = warnings.concat(afterLoadWarnings(before));
    if (all.length !== state.lastLoad.warnings.length) { state.lastLoad.warnings = all; Scope.app.render(true); }
    summaryToast(found, usedText, state.lastLoad.warnings.length);
  }

  /** Toast summarising a load: sheets read, positions valued, and the errors and warnings the calculation raised. */
  function summaryToast(sheets, from, nNotes) {
    let r = null;
    try { r = Scope.app && Scope.app.safeResult ? Scope.app.safeResult() : store.result(); } catch (e) { r = null; }
    const parts = [`${sheets.join(', ')} loaded from ${from}`];
    if (r && r.stats) parts.push(`${F.int(r.stats.included)} positions valued`, `${plural(r.issueCounts.error || 0, 'error')}, ${plural(r.issueCounts.warn || 0, 'warning')}`);
    if (nNotes) parts.push(plural(nNotes, 'note') + ' on the Data page');
    UI.toast(parts.join(' · '), nNotes || (r && r.issueCounts && r.issueCounts.error) ? 'warn' : '');
  }

  /** Remove every loaded sheet (after confirmation), so a workbook can be built up sheet by sheet. */
  function clearSheets() {
    if (!global.confirm(`Remove every sheet (the four input sheets and ${settingsName()}) from this browser? The demo stays available through Reset to demo.`)) return;
    state.lastLoad = null;
    store.setSheets({}, {}, { merge: false });
    if (store.clearSavedSheets) store.clearSavedSheets();
    UI.toast('All sheets cleared');
  }

  /** One input sheet: status, source, size, header row, required columns, issues, and the Paste / Download CSV actions. */
  function sheetCard(name, res, D) {
    const g = store.sheet(name), src = store.state.sources[name], d = (D.sheets || {})[name] || {};
    const loaded = !!(g && g.rows && g.rows.length), size = gridSize(g);
    const pairs = [['Source', loaded ? sourceText(src) : 'Not loaded'], ['Size', loaded ? `${F.int(size.rows)} rows × ${F.int(size.cols)} columns` : '–']];
    if (name === 'Mapping') {
      const tables = Object.values(D.tables || {}), ok = tables.filter((t) => t.rows > 0).length;
      pairs.push(['Tables', !loaded || !res ? '–' : h('a', { href: Scope.href('data', 'mapping') }, ok === 6 ? '6 of 6 found' : UI.badge(`${ok} of 6 found`, 'warn'))]);
    } else {
      pairs.push(['Header row', !loaded || !res ? '–' : d.headerRow ? `row ${d.headerRow}, data from row ${d.dataStart}` : UI.badge('not found', 'error')]);
      if (loaded && d.headerRow) {
        const req = (D.roles || []).filter((r) => r.sheet === name && r.required), miss = req.filter((r) => !r.letter).length;
        pairs.push(['Required columns', h('a', { href: Scope.href('data', 'columns', name) }, miss ? UI.badge(`${miss} of ${req.length} missing`, 'error') : `${req.length} of ${req.length} found`)]);
      }
    }
    if (loaded && res) {
      const iss = (res.issues || []).filter((i) => i.table === name), ne = iss.filter((i) => i.severity === 'error').length, nw = iss.filter((i) => i.severity === 'warn').length;
      pairs.push(['Issues', iss.length ? h('a', { href: Scope.href('data', 'issues'), onClick: () => { state.issueSheet = name; state.sev = 'all'; } }, `${plural(ne, 'error')}, ${plural(nw, 'warning')}, ${iss.length - ne - nw} info`) : 'none']);
    }
    if (loaded && src && src.loadedAt) pairs.push(['Loaded', when(src.loadedAt)]);
    return UI.section({
      class: 'dp-sheet' + (loaded ? '' : ' dp-missing'), title: name, subtitle: SHEET_INFO[name].short,
      actions: [UI.badge(loaded ? 'loaded' : 'missing', loaded ? 'ok' : 'error')],
      body: h('div', {}, UI.dl(pairs), h('div', { class: 'dp-sheet-actions' },
        h('button', { class: 'btn btn-sm', onClick: () => pasteModal(name) }, ic('clipboard'), 'Paste'),
        h('button', { class: 'btn btn-sm', disabled: !loaded, onClick: () => downloadCsv(name) }, ic('download'), 'Download CSV'))),
    });
  }

  /** Paste dialog for one sheet: Excel clipboard text (or CSV) placed at a start cell, then loaded as that sheet. */
  function pasteModal(name) {
    const ta = h('textarea', { class: 'input dp-paste', placeholder: `Paste the ${name} sheet here (Ctrl+V, or Cmd+V on a Mac)`, spellcheck: 'false', wrap: 'off', 'aria-label': `${name} cells` });
    const origin = h('input', { class: 'input dp-origin', value: 'A1', maxlength: '8', 'aria-label': 'Pasted range starts at cell' });
    const info = h('span', { class: 'small muted' }, 'Nothing pasted yet');
    /** Line count and format of the pasted text. */
    const count = () => {
      const t = ta.value;
      if (!t) { info.textContent = 'Nothing pasted yet'; return; }
      const lines = t.split(/\r\n|\r|\n/), cells = lines[0].split('\t').length;
      info.textContent = `${F.int(lines.length)} lines${cells > 1 ? `, ${cells} tab-separated cells in the first line (copied from Excel)` : ''}`;
    };
    ta.addEventListener('input', U.debounce(count, 200));
    /** Fill the box from the clipboard where the browser allows it. */
    const readClipboard = async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('unavailable');
        ta.value = await navigator.clipboard.readText(); count();
      } catch (e) { UI.toast('The browser did not allow reading the clipboard: click in the box and press Ctrl+V (Cmd+V on a Mac)', 'warn'); ta.focus(); }
    };
    /** Parse the text at the start cell and load it as this sheet (other sheets are kept). */
    const apply = () => {
      const parse = IN('parseText');
      if (!parse) { UI.toast('The paste reader is not available in this copy of Scope', 'warn'); return; }
      if (!ta.value.trim()) { UI.toast('Nothing to load: paste the copied cells first', 'warn'); ta.focus(); return; }
      const start = (origin.value || '').trim().toUpperCase() || 'A1';
      let grid;
      try { grid = parse(ta.value, { origin: start, name }); }
      catch (e) { UI.toast(String((e && e.message) || e), 'warn'); origin.focus(); return; }
      const size = gridSize(grid);
      if (!size.rows) { UI.toast('The pasted text holds no cells', 'warn'); return; }
      if (!confirmSettingsOverDemo([name])) return;
      const before = demoSheetsKept([name]);
      state.lastLoad = { at: new Date().toISOString(), from: `(pasted at ${start})`, sheets: [name], warnings: [] };
      m.close();
      store.setSheets({ [name]: { name, rows: grid.rows } }, { [name]: { kind: 'paste', origin: start } }, { merge: true });
      const notes = afterLoadWarnings(before);
      if (notes.length) { state.lastLoad.warnings = notes; Scope.app.render(true); }
      UI.toast(`${name} pasted: ${F.int(size.rows)} rows × ${F.int(size.cols)} columns`, notes.length ? 'warn' : '');
    };
    const m = UI.modal({
      title: `Paste ${name}`, wide: true,
      body: h('div', {},
        h('p', { class: 'small' }, `In Excel, open the ${name} sheet, select every cell (Ctrl+A, or the corner button above row 1), copy, then paste below. ${name === settingsName() ? 'Tables are found by their titles in row 2' : 'Headers are found by name'}; the start cell keeps cell references such as ${name}!B4 identical to the workbook.`),
        h('div', { class: 'dp-field-row' }, h('label', { class: 'strong' }, 'Pasted range starts at cell'), origin, h('span', { class: 'small muted' }, 'A1 when the whole sheet was copied')),
        ta, h('div', { class: 'dp-paste-foot' }, info)),
      actions: [
        h('button', { class: 'btn', onClick: readClipboard }, ic('clipboard'), 'Paste from clipboard'), h('span', { class: 'dp-spacer' }),
        h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onClick: apply }, ic('check'), `Load as ${name}`),
      ],
    });
    setTimeout(() => ta.focus(), 0);
  }

  /** Download one loaded sheet as CSV (UTF-8 with a byte-order mark, so Excel keeps accents and currency signs). */
  function downloadCsv(name) {
    const g = store.sheet(name), toCsv = IN('gridToCsv');
    if (!g) return;
    if (!toCsv) { UI.toast('The CSV writer is not available in this copy of Scope', 'warn'); return; }
    UI.downloadText(`${name}.csv`, '\ufeff' + toCsv(g), 'text/csv;charset=utf-8');
  }

  /** Download sheets ({ name: grid }) as one .xlsx workbook, tabs in the canonical order (the settings sheet last). */
  function downloadWorkbook(sheets, filename) {
    const write = IN('writeXlsx'), save = IN('downloadBytes');
    if (!write || !save) { UI.toast('The workbook writer is not available in this copy of Scope', 'warn'); return; }
    const ordered = {};
    for (const n of allSheets()) if (sheets && sheets[n] && sheets[n].rows) ordered[n] = { name: n, rows: sheets[n].rows };
    if (!Object.keys(ordered).length) { UI.toast('No sheets to download', 'warn'); return; }
    try { save(filename, write(ordered)); }
    catch (e) { UI.toast(`Could not write the workbook: ${(e && e.message) || e}`, 'warn'); }
  }

  /** Short guide: how to bring the four sheets in, what each must contain, and that nothing leaves the browser. */
  function howSection() {
    return UI.section({ class: 'dp-how', title: 'How it works', body: h('div', {},
      h('ol', {},
        h('li', {}, h('b', {}, 'Bring in the four sheets. '), 'Drop the whole AUM workbook, or copy each sheet in Excel (select all, copy) and use Paste on its card. CSV files named after their sheet work too.'),
        h('li', {}, h('b', {}, 'Columns are found by name. '), 'Headers are matched by name, not position, so columns can move or be added. The Columns tab shows what each name resolved to and lets you choose another column.'),
        h('li', {}, h('b', {}, 'Settings travel with the workbook. '), `An optional fifth sheet, ${settingsName()}, holds the group's ownership of each investor column, one formula per view, investor types and display names, and the FX exception. Download it pre-filled on the `, h('a', { href: Scope.href('data', 'setup') }, 'Setup'), ' tab, adjust it in Excel and keep it in the workbook.'),
        h('li', {}, h('b', {}, 'Month after month. '), 'Drop just the new Holdings sheet: the other sheets, the rows you added to Mapping and the settings stay. Download the working workbook whenever you want the file itself.'),
        h('li', {}, h('b', {}, 'Check the result. '), 'The Checks tab compares the workbook\'s own formula columns with this calculation; the Issues tab lists anything that could not be read.'),
        h('li', {}, h('b', {}, 'Nothing leaves the browser. '), 'Files are read on this computer and kept in this browser only, until you reset to the demo.')),
      h('div', { class: 'dp-need-title' }, 'What each sheet must contain'),
      h('dl', { class: 'dl dp-need' }, SHEETS.map((n) => [h('dt', {}, n), h('dd', {}, SHEET_INFO[n].need)]),
        h('dt', {}, `${settingsName()} (optional)`), h('dd', {}, 'Four small tables, titles in row 2 and headers in row 3: Investors (ownership per column), Views (one formula each), FX Exception and Settings. Download it pre-filled on the Setup tab.'))) });
  }

  /** What the calculation made of the loaded sheets: dataset, reporting date, positions, assets, issues and checks. */
  function datasetSection(res) {
    if (!res) return UI.section({ title: 'Dataset', body: UI.empty('Nothing loaded yet. Drop the workbook above, or use Reset to demo.') });
    const base = res.base || res, s = base.stats || {}, counts = res.issueCounts || {}, checks = diag(res).checks || [];
    const label = store.state.datasetLabel || 'Dataset', synthetic = /synthetic/i.test(label), nOv = countOverrides();
    return UI.section({ title: 'Dataset', subtitle: 'what the calculation made of the loaded sheets', body: UI.dl([
      ['Dataset', h('span', {}, UI.badge(label, synthetic ? 'synthetic' : 'primary'), synthetic ? h('span', { class: 'small muted' }, ' no real investors, assets or amounts') : null)],
      ['Reporting date', res.reportingDate ? `${F.date(res.reportingDate)}${res.quarter ? ' (' + res.quarter + ')' : ''}` : '–'],
      ['Holdings', `${F.int(s.holdingsRows)} rows read, ${F.int(s.positions)} positions, ${F.int(s.included)} valued, ${F.int(s.excluded)} excluded`],
      ['Assets', `${F.int(s.assetsMapped)} mapped, ${F.int(s.assetsActive)} with exposure, ${F.int(s.assetsSelected)} in ${base.platform ? base.platform.label : 'the view'}`],
      ['Issues', h('a', { href: Scope.href('data', 'issues') }, `${plural(counts.error || 0, 'error')}, ${plural(counts.warn || 0, 'warning')}, ${counts.info || 0} info`)],
      ['Workbook checks', checks.length ? h('a', { href: Scope.href('data', 'checks') }, checkSummaryText(checks)) : 'no formula columns to compare'],
      ['Settings', h('a', { href: Scope.href('data', 'setup') }, `${settingsSourceText(res)}${nOv ? `, ${nOv} changed here` : ''}`)],
      ['Calculation time', U.isNum(res.computeMs) ? `${res.computeMs.toFixed(0)} ms` : '–'],
    ]) });
  }

  // =====================================================================================================================
  // Columns
  // =====================================================================================================================
  /** The column a role resolves to without an override (the calculation's order: row-2 name, row-3 header, pattern). */
  function autoColumn(sheet, role, cols) {
    const def = ((calc().ROLES || {})[sheet] || {})[role];
    if (!def) return null;
    const n = calc().norm || ((s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''));
    for (const o of def.out || []) { const c = cols.find((x) => x.output && n(x.output) === n(o)); if (c) return c; }
    for (const hd of def.hdr || []) { const c = cols.find((x) => n(x.header) === n(hd)); if (c) return c; }
    for (const re of def.re || []) { const c = cols.find((x) => re.test(n(x.header))); if (c) return c; }
    return null;
  }

  /** Columns tab: per sheet, the column each calculation role reads (with a choice per browser), then every column. */
  function columnsTab(el, res, params) {
    const D = diag(res), sheet = KEYED.includes(params[1]) ? params[1] : 'Holdings';
    el.appendChild(h('div', { class: 'chips dp-subnav' }, KEYED.map((n) => {
      const miss = (D.roles || []).filter((r) => r.sheet === n && r.required && !r.letter).length;
      return UI.chip(miss ? `${n} (${miss} missing)` : n, n === sheet, () => Scope.navigate('data', 'columns', n));
    })));
    const d = (D.sheets || {})[sheet];
    if (!res || !d || !d.present) { el.appendChild(missingNotice(sheet)); return; }
    if (!d.columns) {
      el.appendChild(h('div', { class: 'notice error' }, h('b', {}, `Header row not found in ${sheet}. `), `The calculation looks in the first 15 rows for the row holding headers such as ${SHEET_INFO[sheet].hint}. Check that the sheet was pasted at cell A1, or paste it again on the `, h('a', { href: Scope.href('data', 'inputs') }, 'Inputs'), ' tab.'));
      return;
    }
    const cols = d.columns, hr = d.headerRow, saved = overrides().roles || {};
    const freq = new Map();
    cols.forEach((c) => freq.set(c.header, (freq.get(c.header) || 0) + 1));
    const valueOf = (c) => (freq.get(c.header) > 1 ? c.letter : c.header); // a repeated header is chosen by its letter
    const rows = (D.roles || []).filter((r) => r.sheet === sheet).map((r) => {
      const id = `${sheet}.${r.role}`, sv = saved[id];
      return Object.assign({}, r, { id, saved: sv, manual: r.via === 'override', stale: !!sv && r.via !== 'override', auto: autoColumn(sheet, r.role, cols) });
    });
    const nManual = rows.filter((r) => r.manual || r.stale).length;
    const reqMissing = rows.filter((r) => r.required && !r.letter).length;
    if (reqMissing) el.appendChild(h('div', { class: 'notice error' }, h('b', {}, `${plural(reqMissing, 'required column')} not found in ${sheet}. `), 'Choose the column in the table below; the choice is saved in this browser.'));
    el.appendChild(UI.section({
      title: `Column roles · ${sheet}`,
      subtitle: `Header row ${hr}, data from row ${d.dataStart}, ${cols.length} columns. Each role is matched by its output name in row ${hr - 1} first, then by its header in row ${hr}.`,
      actions: nManual ? [h('button', { class: 'btn btn-sm', onClick: () => resetSheetRoles(sheet) }, ic('refresh-cw'), 'All back to automatic')] : null,
      body: UI.table({ rows, compact: true, filter: false, pageSize: 500, columns: [
        { key: 'label', label: 'Role', render: (r) => h('div', {}, h('div', { class: 'strong' }, r.label), h('code', { class: 'dp-key' }, r.role)) },
        { key: 'required', label: 'Required', sortValue: (r) => (r.required ? 0 : 1), render: (r) => (r.required ? UI.badge('required', r.letter ? 'info' : 'error') : h('span', { class: 'dim' }, 'optional')) },
        { key: 'letter', label: 'Column', sortValue: (r) => (r.letter ? colIndex(r.letter) : 1e9), render: (r) => (r.letter ? colCell(r, hr) : h('div', {}, UI.badge('not found', r.required ? 'error' : 'muted'), h('div', { class: 'small muted dp-wrap' }, `looked for ${U.uniq(r.candidates || []).join(', ') || 'a pattern'}`))) },
        { key: 'via', label: 'Found by', render: (r) => (r.manual ? UI.badge('manual', 'manual', 'chosen on this page (saved in this browser)') : h('span', {}, r.via || '–', r.stale ? [' ', UI.badge(`saved choice "${r.saved}" not in this sheet`, 'warn')] : null)) },
        { key: 'id', label: 'Choose column', render: (r) => roleSelect(r, cols, valueOf) },
      ] }),
    }));
    const used = new Map();
    rows.forEach((r) => { if (r.letter) used.set(r.letter, (used.get(r.letter) || []).concat(r.label)); });
    const colRows = cols.map((c) => ({ letter: c.letter, index: c.index, output: c.output, header: c.header, used: (used.get(c.letter) || []).join(', ') }));
    el.appendChild(UI.section({ title: `All columns · ${sheet}`, subtitle: `every non-blank header in row ${hr}, with the output name above it and the roles that read it`,
      body: UI.table({ rows: colRows, compact: true, pageSize: 1000, filterPlaceholder: 'Search columns…', exportName: `${sheet} columns.csv`, columns: [
        { key: 'letter', label: 'Column', sortValue: (r) => r.index, render: (r) => h('span', { class: 'dp-letter' }, r.letter) },
        { key: 'output', label: `Row ${hr - 1} (output name)`, format: (v) => v || '' },
        { key: 'header', label: `Row ${hr} (header)`, class: 'strong' },
        { key: 'used', label: 'Read by the calculation as', class: 'wrap' },
      ] }) }));
  }

  /** A resolved column: letter, header, and the row-2 output name when it differs. */
  function colCell(r, hr) {
    const n = calc().norm || ((s) => String(s || '').toLowerCase());
    return h('span', { class: 'dp-col' }, h('span', { class: 'dp-letter' }, r.letter), ' ', r.header || '',
      r.output && n(r.output) !== n(r.header) ? h('span', { class: 'muted small' }, ` (row ${hr - 1}: ${r.output})`) : null);
  }

  /** Column picker for one role: Automatic (the name match) or any header of the sheet; manual choices get a reset. */
  function roleSelect(r, cols, valueOf) {
    const current = r.manual ? cols.find((c) => c.letter === r.letter) : null;
    const sel = h('select', { class: 'input dp-select', 'aria-label': `Column for ${r.label}`, onChange: (e) => chooseRole(r, e.target.value) },
      h('option', { value: '', selected: !current }, r.auto ? `Automatic: ${r.auto.letter}, ${r.auto.header}` : 'Automatic: not found'),
      cols.map((c) => h('option', { value: valueOf(c), selected: !!current && c.letter === current.letter }, `${c.letter}   ${c.header}${c.output && c.output !== c.header ? ' (' + c.output + ')' : ''}`)));
    return h('div', { class: 'dp-pick' }, sel, r.manual || r.stale ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Back to automatic', onClick: () => chooseRole(r, '') }, ic('refresh-cw'), 'Reset') : null);
  }

  /** Save or remove a column choice; choosing the automatic column removes the override. */
  function chooseRole(r, value) {
    const isAuto = !value || (r.auto && (value === r.auto.header || value === r.auto.letter));
    store.setOverride('roles', r.id, isAuto ? null : value);
    UI.toast(isAuto ? `${r.label}: automatic` : `${r.label}: reads ${value}`);
  }

  /** Remove every column choice of one sheet in a single update. */
  function resetSheetRoles(sheet) {
    const ov = JSON.parse(JSON.stringify(overrides()));
    for (const k of Object.keys(ov.roles || {})) if (k.slice(0, k.lastIndexOf('.')) === sheet) delete ov.roles[k];
    store.setSetting('calcOverrides', ov);
    UI.toast(`${sheet}: every role back to automatic`);
  }

  // =====================================================================================================================
  // Mapping
  // =====================================================================================================================
  /** Mapping tab: where each of the six tables was found, each expandable to a preview of its first rows. */
  function mappingTab(el, res) {
    const D = diag(res), g = store.sheet('Mapping');
    if (!g) { el.appendChild(missingNotice('Mapping')); return; }
    if (!res) { el.appendChild(noData()); return; }
    if (res.fatal && store.sheet('Holdings')) el.appendChild(h('div', { class: 'notice' }, h('b', {}, 'Holdings cannot be valued. '), 'Required Holdings columns are chosen on the ', h('a', { href: Scope.href('data', 'columns', 'Holdings') }, 'Columns'), ' tab.'));
    const tables = D.tables || {};
    const keys = Object.keys(TABLE_INFO).filter((k) => tables[k]).concat(Object.keys(tables).filter((k) => !TABLE_INFO[k]));
    const tbody = h('tbody');
    for (const key of keys) {
      const t = tables[key], info = TABLE_INFO[key] || [t.title, ''], open = state.open.has(key);
      const holder = h('td', { colspan: '8' }, open ? previewGrid(g, t) : null);
      const detail = h('tr', { class: 'dp-preview-row' + (open ? '' : ' hidden') }, holder);
      const btn = h('button', { class: 'btn btn-sm btn-ghost dp-toggle' + (open ? ' dp-open' : ''), 'aria-expanded': String(open), title: 'Preview the first 20 rows',
        onClick: () => {
          const now = !state.open.has(key);
          if (now) state.open.add(key); else state.open.delete(key);
          btn.classList.toggle('dp-open', now); btn.setAttribute('aria-expanded', String(now)); detail.classList.toggle('hidden', !now);
          if (now && !holder.firstChild) holder.appendChild(previewGrid(g, t));
        } }, ic('chevron-down'));
      const cols = Object.entries(t.columns || {});
      tbody.append(h('tr', {},
        h('td', {}, btn),
        h('td', {}, h('div', { class: 'strong' }, t.title || info[0]), h('div', { class: 'small muted dp-wrap' }, info[1])),
        h('td', {}, /by position/.test(t.foundBy) ? UI.badge('columns by position', 'warn', 'none of the headers was recognised: columns taken in the workbook\'s order') : t.foundBy === 'title' ? UI.badge('title', 'ok', 'found by its title') : UI.badge('default column', 'warn', 'title not found: read at the workbook\'s usual column')),
        h('td', { class: 'mono' }, t.titleCell || '–'),
        h('td', { class: 'num' }, t.headerRow ? String(t.headerRow) : '–'),
        h('td', {}, cols.length ? h('div', { class: 'dp-cols-list' }, cols.map(([k, l]) => h('span', { title: t.samples && t.samples[k] && t.samples[k].length ? 'e.g. ' + t.samples[k].join(', ') : null }, h('span', { class: 'dp-letter' }, l), ' ', COL_LABEL[k] || k))) : UI.badge('no headers found', 'error'),
          t.headersSeen && t.headersSeen.length ? h('div', { class: 'small muted dp-wrap' }, 'headers in the sheet: ', t.headersSeen.join(', ')) : null),
        h('td', { class: 'num' }, t.rows ? F.int(t.rows) : UI.badge('empty', 'warn')),
        h('td', { class: 'mono' }, t.range || '–')), detail);
    }
    const head = h('thead', {}, h('tr', {}, ['', 'Table', 'Found by', 'Title cell', 'Header row', 'Columns', 'Rows', 'Range'].map((l, i) => h('th', { class: i === 4 || i === 6 ? 'num' : '' }, l))));
    el.appendChild(UI.section({ title: 'Mapping tables', subtitle: 'six tables side by side, each found by its title in row 2 with headers on the next row; a table whose title is missing is read at the workbook\'s usual column',
      body: keys.length ? h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl dp-maptable' }, head, tbody)) : UI.empty('No Mapping table was found') }));
    const fc = D.fundCheck || [];
    if (fc.length) el.appendChild(UI.section({ title: 'Fund Check', subtitle: 'each fund in the Fund Check table should be an investor column of Funding Name', body: UI.table({ rows: fc, compact: true, filter: false, columns: [
      { key: 'row', label: 'Row', align: 'right' }, { key: 'mapping', label: 'Mapping' }, { key: 'holdings', label: 'Holdings' },
      { key: 'known', label: 'Investor column', render: (r) => (r.known ? UI.badge('found', 'ok') : r.holdings ? UI.badge('not found', 'warn') : h('span', { class: 'dim' }, '–')) }] }) }));
  }

  /** First rows of one Mapping table as a small grid with Excel row numbers and column letters (header row first). */
  function previewGrid(g, t) {
    const idx = Object.values(t.columns || {}).map(colIndex).filter((i) => i >= 0);
    if (!idx.length) return UI.empty('None of this table\'s headers were found, so there is nothing to preview.');
    const tc = colIndex(String(t.titleCell || '').replace(/\d+$/, ''));
    const c0 = Math.min.apply(null, tc >= 0 ? idx.concat([tc]) : idx), c1 = Math.max.apply(null, idx);
    const r0 = Math.max(0, (t.headerRow || 1) - 1), r1 = Math.min(g.rows.length - 1, r0 + 20), cs = range(c0, c1);
    const head = h('tr', {}, h('th', { class: 'dp-rownum' }), cs.map((c) => h('th', {}, colName(c))));
    const body = range(r0, r1).map((r) => h('tr', { class: r === r0 ? 'dp-hdr' : '' }, h('td', { class: 'dp-rownum' }, String(r + 1)),
      cs.map((c) => { const v = cellText((g.rows[r] || [])[c]); return h('td', { title: v.length > 24 ? v : null }, v); })));
    return h('div', {}, h('div', { class: 'small muted dp-preview-cap' }, `Rows ${r0 + 1} to ${r1 + 1} of the Mapping sheet; the table spans ${t.range || 'an unknown range'}.`),
      h('div', { class: 'dp-preview' }, h('table', { class: 'tbl' }, h('thead', {}, head), h('tbody', {}, body))));
  }

  // =====================================================================================================================
  // Views & investors
  // =====================================================================================================================
  /** A view's definition changed here, else the calculation file's (CONFIG.views); undefined for neither. */
  function viewDef(name) {
    const ov = overrides().views || {};
    return ov[name] !== undefined ? ov[name] : (cfg().views || {})[name];
  }
  /** How a view is defined: '*' (all investors), 'group' (group weights), 'list', 'column' (an investor column) or null. */
  function viewMode(v) {
    if (v.def === '*' || v.def === 'group' || v.def === 'list' || v.def === 'column') return v.def; // reported by the calculation
    if (v.kind === 'override' || v.kind === 'settings') { const def = viewDef(v.view); if (def === '*' || def === 'group') return def; if (Array.isArray(def)) return 'list'; }
    if (v.kind === 'investor column') return 'column';
    return v.kind === 'undefined' ? null : (v.composition || []).length ? 'list' : null;
  }
  /** A view's composition as text: "all investors", "group weights" or "Investor 1 × 1 + Investor 7 × 0.35". */
  function compositionText(v) {
    const mode = viewMode(v);
    if (mode === '*') return 'all investors';
    if (mode === 'group') return 'group weights';
    const parts = (v.composition || []).map((c) => (c.label === '*' ? 'all investors' : `${c.label} × ${fmtW(c.weight)}`));
    return parts.length ? parts.join(' + ') : 'nothing (not defined)';
  }
  /** Badge for how a view is defined. */
  function kindBadge(kind) {
    if (kind === 'settings') return UI.badge('settings', 'muted', '§1 defaults in the calculation file');
    if (kind === 'sheet') return UI.badge('from your sheet', 'info', `the ${settingsName()} sheet`);
    if (kind === 'override') return UI.badge('changed here', 'manual', 'saved in this browser');
    if (kind === 'investor column') return UI.badge('investor column', 'info', 'the view name is an investor column');
    return UI.badge('not defined', 'error', 'shows nothing until defined');
  }
  /** Badge for where an investor's group and weight come from. */
  function sourceBadge(source) {
    if (source === 'override') return UI.badge('changed here', 'manual', 'saved in this browser');
    if (source === 'sheet') return UI.badge('from your sheet', 'info', `the ${settingsName()} sheet`);
    if (source === 'settings') return UI.badge('settings', 'muted', '§1 defaults in the calculation file');
    return UI.badge('not set', 'warn', 'not in the settings: treated as Unclassified, weight 0');
  }

  /** Views & investors tab: override banner, views, investors and FX. */
  function viewsTab(el, res) {
    if (!res) { el.appendChild(noData()); return; }
    const D = diag(res), attr = attrLabel(res);
    el.appendChild(overridesBar());
    el.appendChild(h('div', { class: 'notice info dp-bar' }, h('div', {}, h('b', {}, 'Easier on the Setup tab: '), 'the ownership table and one formula per view, as in the workbook; look-through comes from the "incl. part in funds" formulas. The Formulas tab shows every calculation step.'),
      h('div', { class: 'dp-row-actions' }, h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'weights') }, ic('edit-2'), 'Ownership and views'), h('a', { class: 'btn btn-sm', href: Scope.href('data', 'formulas') }, ic('file-text'), 'Formulas'))));
    const views = (D.views || []).map((v) => {
      const expanded = viewMode(v) === 'group' ? (v.composition || []).map((c) => `${c.label} × ${fmtW(c.weight)}`).join(' + ') : '';
      return { view: v.view, kind: v.kind, text: compositionText(v), expanded, v };
    });
    el.appendChild(UI.section({ title: 'Views', subtitle: 'the view choices listed in Mapping column H (the Output!G8 selector): which investor columns count, and with what weight',
      body: views.length ? UI.table({ rows: views, compact: true, filter: false, pageSize: 500, columns: [
        { key: 'view', label: 'View', class: 'strong' },
        { key: 'kind', label: 'Defined by', render: (r) => kindBadge(r.kind) },
        { key: 'text', label: 'Composition', class: 'wrap', render: (r) => h('span', { title: r.expanded || null }, r.text, r.expanded ? h('span', { class: 'small muted' }, ` (${r.expanded})`) : null) },
        { key: '_actions', label: '', render: (r) => h('div', { class: 'dp-row-actions' },
          h('button', { class: 'btn btn-sm', onClick: () => editView(r.v, D) }, ic('edit-2'), 'Edit'),
          r.kind === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Back to the sheet or the calculation file', onClick: () => { store.setOverride('views', r.view, null); UI.toast(`${r.view}: changes made here undone`); } }, ic('refresh-cw'), 'Reset') : null) },
      ] }) : UI.empty('No views: Mapping column H is empty') }));
    const inv = D.investors || [];
    el.appendChild(UI.section({ title: 'Investors', subtitle: `investor columns from the Funding Name table. The weight is the share attributed to the ${attr} (1 = group entity, 0 = third party or mandate, 0.35 = a fund 35% held by the group); it is the "${attr} ownership" column of the Investors table and drives the ${attr} / third-party split`,
      body: inv.length ? UI.table({ rows: inv, compact: true, filter: false, pageSize: 500, columns: [
        { key: 'id', label: 'Holdings ID', class: 'mono' },
        { key: 'label', label: 'Investor column', class: 'strong', render: (r) => h('span', { title: origOf(r) !== r.label ? `workbook name: ${origOf(r)}` : null }, r.label) },
        { key: 'fundName', label: 'Fund name' },
        { key: 'group', label: 'Type', render: (r) => h('select', { class: 'input dp-select', 'aria-label': `Type of ${r.label}`, onChange: (e) => setInvestor(r, e.target.value, r.weight) },
          U.uniq(GROUPS.concat([r.group])).map((g) => h('option', { value: g, selected: g === r.group }, g))) },
        { key: 'weight', label: 'Weight', align: 'right', render: (r) => h('input', { type: 'text', inputmode: 'decimal', class: 'input dp-num', value: fmtW(r.weight), 'aria-label': `Weight of ${r.label}`, title: '1, 0.35, 35% or 7/20',
          onChange: (e) => {
            const w = calc().parseWeight(e.target.value);
            if (!isFinite(w) || w < 0) { UI.toast('Enter a weight: 1, 0.35, 35% or 7/20', 'warn'); e.target.value = fmtW(r.weight); return; }
            setInvestor(r, r.group, w);
          } }) },
        { key: 'source', label: 'Source', render: (r) => h('div', { class: 'dp-row-actions dp-left' }, sourceBadge(r.source),
          r.source === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Undo the change made here', onClick: () => resetInvestor(r, false) }, ic('refresh-cw'), 'Reset') : null) },
      ] }) : UI.empty('No investor columns: the Funding Name table is empty') }));
    el.appendChild(fxSection(D));
  }

  /** Edit one view: all investors, group weights, or a custom list of investor columns with weights. */
  function editView(v, D) {
    const vm = viewMode(v), invs = (D.investors || []).map((i) => i.label);
    const keyOf = new Map((D.investors || []).map((i) => [i.label, origOf(i)])); // saved by workbook name
    let mode = vm === '*' ? 'all' : vm === 'group' ? 'group' : 'custom';
    const eff = new Map(); // the current effective weights, to start the custom list from
    if (vm === '*') invs.forEach((l) => eff.set(l, 1));
    else if (vm !== 'group') (v.composition || []).forEach((c) => { if (c.label !== '*') eff.set(c.label, c.weight); });
    const labels = invs.concat(Array.from(eff.keys()).filter((l) => !invs.includes(l)));
    const inputs = new Map();
    const list = h('div', { class: 'dp-custom compact' },
      h('p', { class: 'small muted' }, 'Weight per investor column: 1 counts all of it, 0.35 or 35% counts 35%. Leave a weight empty to leave the column out.'),
      h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Investor column'), h('th', {}, 'Group'), h('th', { class: 'num' }, 'Weight'))),
        h('tbody', {}, labels.map((l) => {
          const meta = (D.investors || []).find((i) => i.label === l);
          const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'input dp-num', value: eff.has(l) ? fmtW(eff.get(l)) : null, 'aria-label': `Weight of ${l}` });
          inputs.set(l, inp);
          return h('tr', {}, h('td', { class: 'strong' }, l), h('td', { class: 'dim' }, meta ? meta.group : 'not an investor column'), h('td', { class: 'num' }, inp));
        }))));
    /** Switch between the three ways of defining the view. */
    const setMode = (m) => { mode = m; list.classList.toggle('dp-disabled', m !== 'custom'); };
    const radios = [['all', 'All investors', 'every investor column, weight 1'], ['group', 'Group weights', 'each investor column times its weight in the Investors table'], ['custom', 'Custom list', 'the investor columns and weights below']]
      .map(([val, title, note]) => h('label', {}, h('input', { type: 'radio', name: 'dp-view-mode', value: val, checked: mode === val, onChange: () => setMode(val) }), h('span', {}, h('b', {}, title), h('span', { class: 'muted' }, ' ' + note))));
    setMode(mode);
    /** Validate and save the definition as an override for this view. */
    const save = () => {
      let value;
      if (mode === 'all') value = '*';
      else if (mode === 'group') value = 'group';
      else {
        value = [];
        for (const [l, inp] of inputs) {
          const s = String(inp.value).trim(); if (!s) continue;
          const w = /%$/.test(s) ? parseShare(s) : Number(s.replace(',', '.'));
          if (!isFinite(w)) { UI.toast(`The weight of ${l} is not a number`, 'warn'); inp.focus(); return; }
          if (w !== 0) value.push([keyOf.get(l) || l, w]);
        }
        if (!value.length) { UI.toast('Enter a weight for at least one investor column', 'warn'); return; }
      }
      m.close();
      store.setOverride('views', v.view, value);
      UI.toast(`${v.view} updated (saved in this browser)`);
    };
    const m = UI.modal({ title: `Edit view: ${v.view}`, wide: true, body: h('div', {}, h('div', { class: 'dp-modes' }, radios), list),
      actions: [
        v.kind === 'override' ? h('button', { class: 'btn', onClick: () => { m.close(); store.setOverride('views', v.view, null); UI.toast(`${v.view}: changes made here undone`); } }, ic('refresh-cw'), 'Undo changes made here') : null,
        h('span', { class: 'dp-spacer' }),
        h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onClick: save }, ic('check'), 'Save view'),
      ] });
  }

  /** FX card: quote direction (with the RC-column test behind "automatic"), the rate table and the settings exception. */
  function fxSection(D) {
    const fx = D.fx || {}, t = fx.test || {}, C = cfg(), ov = overrides(), base = C.fxQuote || 'auto', cur = ov.fxQuote || base;
    const sel = h('select', { class: 'input dp-select', 'aria-label': 'FX quote', onChange: (e) => { const v = e.target.value; store.setOverride('fxQuote', null, v === base ? null : v); UI.toast('FX quote: ' + QUOTES[v]); } },
      Object.entries(QUOTES).map(([k, l]) => h('option', { value: k, selected: k === cur }, l)));
    const test = t.tested ? `Checked against the RC column on ${F.int(t.tested)} non-EUR rows: ÷ matched ${F.int(t.divide)}, × matched ${F.int(t.multiply)}.` : 'Not checked: no reference-currency (RC) column was found, or every position is in the base currency.';
    const rates = (fx.table || []).map((r) => ({ currency: r.currency, rate: r.rate, perEur: r.perEur, eurPer: U.isNum(r.perEur) && r.perEur ? 1 / r.perEur : NaN }));
    const exc = Array.isArray(D.fxException) ? D.fxException : C.fxOverrides || []; // the exception in force (sheet or §1)
    return UI.section({ title: 'FX', subtitle: 'Holdings carries a rate on every row; each amount is divided (or multiplied) by it to reach EUR', body: h('div', {},
      h('div', { class: 'dp-field-row' }, h('label', { class: 'strong' }, 'Quote'), sel, ov.fxQuote ? UI.badge('changed here', 'manual') : null),
      h('p', { class: 'small' }, test, ' In use: ', h('b', {}, QUOTE_SHORT[fx.quote] || fx.quote || '–'), '.'),
      rates.length ? UI.table({ rows: rates, compact: true, filter: false, columns: [
        { key: 'currency', label: 'Currency', class: 'strong' },
        { key: 'rate', label: 'Rate in Holdings (most frequent)', align: 'right', format: fmtRate },
        { key: 'perEur', label: 'Units per EUR', align: 'right', format: fmtRate },
        { key: 'eurPer', label: 'EUR per unit', align: 'right', format: fmtRate }] }) : UI.empty('No FX rates found in Holdings'),
      exc.length ? h('div', { class: 'dp-sub' }, h('h3', {}, 'FX exception'), UI.table({ rows: exc.map((x) => Object.assign({}, x, { rateText: x.column ? `Hardcoded "${x.column}" (one rate per asset)` : fmtRate(x.rate) })), compact: true, filter: false, columns: [
        { key: 'investor', label: 'Investor' }, { key: 'currency', label: 'Currency' }, { key: 'view', label: 'View', format: (v) => v || 'every view' },
        { key: 'rateText', label: 'Rate (quoted like the Holdings rates)', align: 'right' }, { key: 'note', label: 'Note', class: 'wrap' }] })) : null) });
  }

  /** Banner for the override tabs: changes apply at once in this browser; keep them in the settings sheet, export or clear them. */
  function overridesBar() {
    const ov = overrides(), n = countOverrides();
    const parts = [['roles', 'column'], ['names', 'display name'], ['views', 'view'], ['investors', 'investor']].map(([k, w]) => { const c = Object.keys(ov[k] || {}).length; return c ? plural(c, w) : null; }).filter(Boolean);
    if (ov.fxQuote) parts.push('FX quote');
    const ns = Object.keys(ov.settings || {}).length; if (ns) parts.push(plural(ns, 'setting'));
    return h('div', { class: 'notice info dp-bar' },
      h('div', {}, h('b', {}, 'Changes here apply at once and are saved in this browser only. '), n ? `In force: ${parts.join(', ')}. ` : 'No overrides in force. ', `Download the ${settingsName()} sheet to keep them with the workbook.`),
      h('div', { class: 'dp-row-actions' },
        h('button', { class: 'btn btn-sm btn-primary', onClick: () => downloadSettings('xlsx') }, ic('download'), `Download ${settingsName()} sheet`),
        h('button', { class: 'btn btn-sm', title: 'The overrides as a snippet for §1 of the calculation file', onClick: exportSettings }, ic('file-text'), 'Export settings'),
        n ? h('button', { class: 'btn btn-sm btn-danger', onClick: clearOverrides }, ic('x'), 'Clear all overrides') : null));
  }

  /** Remove every override (columns, display names, views, investors, FX quote) after confirmation. */
  function clearOverrides() {
    if (!global.confirm(`Remove every override saved in this browser, column choices included? The ${settingsName()} sheet, or the settings in the calculation file, apply again.`)) return;
    store.setSetting('calcOverrides', {});
    UI.toast('All overrides cleared');
  }

  /** JavaScript literal for a settings value (single-quoted strings, arrays and plain objects). */
  function lit(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
    if (typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : lit(k)}: ${lit(x)}`).join(', ') + ' }';
    return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'";
  }

  /** The overrides as a snippet for CONFIG in js/calc/aum.js §1: merged with the current CONFIG, changes marked. */
  function configSnippet() {
    const C = cfg(), ov = overrides(), I = '    ', out = [];
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    out.push(`// Scope settings exported from the Data page on ${stamp} UTC (dataset: ${store.state.datasetLabel || 'none'}).`);
    out.push('// Paste over the matching entries of CONFIG in js/calc/aum.js (§1), then clear the overrides on the Data page.');
    out.push('// Entries marked "changed" or "added" differ from the CONFIG this export was made against.');
    out.push('');
    const fxq = ov.fxQuote || C.fxQuote || 'auto';
    out.push(`${I}fxQuote: ${lit(fxq)},${ov.fxQuote && ov.fxQuote !== C.fxQuote ? `  // changed (was ${lit(C.fxQuote)})` : ''}`);
    /** One object entry of CONFIG (views, investors) with the overrides applied. */
    const block = (key, baseObj, changes) => {
      out.push(`${I}${key}: {`);
      const merged = Object.assign({}, baseObj || {}, changes || {});
      for (const [k, v] of Object.entries(merged)) {
        const changed = !!changes && Object.prototype.hasOwnProperty.call(changes, k);
        const note = !changed ? '' : baseObj && Object.prototype.hasOwnProperty.call(baseObj, k) ? `  // changed (was ${lit(baseObj[k])})` : '  // added';
        out.push(`${I}  ${lit(k)}: ${lit(v)},${note}`);
      }
      out.push(`${I}},`);
    };
    block('views', C.views, ov.views);
    block('investors', C.investors, ov.investors);
    const names = Object.entries(ov.names || {});
    if (names.length) {
      out.push('');
      out.push(`// Display names. CONFIG has no entry for these: keep them in the ${settingsName()} sheet (the Display name column of Investors).`);
      for (const [k, v] of names) out.push(`//   ${lit(k)} is shown as ${lit(v)}`);
    }
    const roles = Object.entries(ov.roles || {});
    if (roles.length) {
      out.push('');
      out.push('// Column choices. CONFIG has no entry for these: to make one permanent, put the header first in that role\'s');
      out.push('// list in §2 (ROLES), or rename the column in the workbook.');
      for (const [k, v] of roles) {
        const i = k.lastIndexOf('.'), sheet = k.slice(0, i), role = k.slice(i + 1);
        const def = ((calc().ROLES || {})[sheet] || {})[role];
        out.push(`//   ${sheet}, ${def ? def.label : role} (${role}): ${lit(v)}`);
      }
    }
    out.push('');
    out.push('// Overrides as saved in this browser (audit copy):');
    out.push('// ' + JSON.stringify(ov));
    return out.join('\n') + '\n';
  }

  /** Copy text to the clipboard (Clipboard API, else a hidden text area); resolves true when it worked. */
  async function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back below */ }
    try {
      const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return !!ok;
    } catch (e) { return false; }
  }

  /** Export the overrides as a CONFIG snippet: copied to the clipboard and shown with Copy and Download. */
  function exportSettings() {
    const text = configSnippet();
    /** Copy and report the outcome. */
    const copy = () => copyText(text).then((ok) => UI.toast(ok ? 'Settings snippet copied to the clipboard' : 'Select the text in the box and copy it', ok ? '' : 'warn'));
    copy();
    const ta = h('textarea', { class: 'input dp-code', readonly: true, wrap: 'off', spellcheck: 'false', 'aria-label': 'Settings snippet' });
    ta.value = text;
    const m = UI.modal({ title: 'Export settings', wide: true,
      body: h('div', {}, h('p', { class: 'small' }, `Paste this over the matching entries of CONFIG in js/calc/aum.js (§1), then clear the overrides here. To keep settings with the workbook instead, download the ${settingsName()} sheet from the Setup tab.`), ta),
      actions: [
        h('button', { class: 'btn', onClick: copy }, ic('clipboard'), 'Copy'),
        h('button', { class: 'btn btn-primary', onClick: () => UI.downloadText(`scope-settings-${today()}.js`, text, 'text/javascript;charset=utf-8') }, ic('download'), 'Download'),
        h('button', { class: 'btn', onClick: () => m.close() }, 'Close'),
      ] });
  }

  // =====================================================================================================================
  // Formulas: every calculation as implemented, next to its workbook cell, with the parameters editable in place
  // =====================================================================================================================
  /** A settings scalar changed here, or the value in force. */
  function settingValue(res, key, fallback) {
    const ov = overrides().settings || {};
    if (ov[key] !== undefined) return ov[key];
    return fallback;
  }
  /** Save a settings scalar typed here (parsed like the Settings table of the sheet); blank removes the change. */
  function commitSetting(sheetKey, ovKey, text, label) {
    const spec = (calc().SETTING_KEYS || {})[sheetKey];
    if (!spec) return;
    const t = String(text || '').trim();
    if (!t) { store.setOverride('settings', ovKey, null); UI.toast(`${label}: back to the sheet or the defaults`); return; }
    const v = spec[1](t);
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) { UI.toast(`"${t}" is not a valid ${label}`, 'warn'); return; }
    store.setOverride('settings', ovKey, v);
    UI.toast(`${label}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }
  /** Formulas tab. */
  function formulasTab(el, res) {
    if (!res) { el.appendChild(noData()); return; }
    const D = diag(res), cfg = res.config || {}, attr = attrLabel(res), M = wtModel(D, res), fx = D.fx || {};
    const ovS = overrides().settings || {};
    const changed = (k) => (ovS[k] !== undefined ? UI.badge('changed here', 'manual') : null);
    const text = (sheetKey, ovKey, value, label, width) => h('span', { class: 'dp-param' }, h('input', { type: 'text', class: 'input dp-in' + (ovS[ovKey] !== undefined ? ' dp-changed' : ''), value: value === undefined || value === null ? '' : String(value), style: { width: width || '120px' }, 'aria-label': label,
      onChange: (e) => commitSetting(sheetKey, ovKey, e.target.value, label), onKeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } }), changed(ovKey));
    const select = (sheetKey, ovKey, value, options, label) => h('span', { class: 'dp-param' }, h('select', { class: 'input dp-select' + (ovS[ovKey] !== undefined ? ' dp-changed' : ''), 'aria-label': label, onChange: (e) => commitSetting(sheetKey, ovKey, e.target.value, label) },
      options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))), changed(ovKey));
    const invNames = (D.investors || []).map((i) => i.label);
    const own = M.cols.filter((c) => c.weight).map((c) => (c.weight === 1 && !c.weightText ? c.label : `${c.weightText || fmtWeight(c.weight)} × ${c.label}`));
    el.appendChild(h('div', { class: 'notice info dp-bar' }, h('div', {}, h('b', {}, 'Every formula the calculation applies, in the order of the workbook. '), 'Parameters change here at once, in this browser; the view formulas are the ones of step 4. Download the ', settingsName(), ' sheet on the Setup tab to keep them.'),
      h('div', { class: 'dp-row-actions' }, h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'weights') }, ic('edit-2'), 'Ownership and views'), h('button', { class: 'btn btn-sm btn-primary', onClick: () => downloadSettings('xlsx') }, ic('download'), `Download ${settingsName()}`))));
    // 1. views and attribution
    el.appendChild(UI.section({ title: 'Views', subtitle: 'the view selector: each view = its formula, with the fund coefficients of "incl. part in funds" views doubling as the look-through',
      body: h('div', {}, h('div', { class: 'dp-formula-row dp-formula-fixed' }, h('div', { class: 'dp-formula-name' }, h('b', {}, attr), h('span', { class: 'dp-lt-sub' }, 'attributed exposure (Calculations EO, Output AO3:BO3)')), h('div', { class: 'dp-formula-eq' }, '='), h('div', { class: 'dp-formula-text' }, own.length ? own.join(' + ') : h('span', { class: 'muted' }, 'no ownership entered yet'))),
        h('div', { class: 'dp-formula-row dp-formula-fixed' }, h('div', { class: 'dp-formula-name' }, h('b', {}, 'Total platform'), h('span', { class: 'dp-lt-sub' }, 'Calculations DL')), h('div', { class: 'dp-formula-eq' }, '='), h('div', { class: 'dp-formula-text' }, 'every investor column')),
        viewFormulaList(M)) }));
    // 2. the fixed steps with their parameters
    const rows = [
      ['Investor code', `IF(Model Portfolio = "${cfg.single_token}", Portfolio, Model Portfolio)`, 'Holdings C · Calculations A', h('span', {}, 'token ', text('singleportfoliotoken', 'singleToken', cfg.single_token, 'Single portfolio token', '90px'))],
      ['Unique identifier', 'Investor code & "x" & Security ID', 'Holdings B · Calculations C', null],
      ['Asset (identification ID)', 'XLOOKUP(Security ID, Mapping!T, Mapping!S); code name from Q, project name from R', 'Holdings D, E · Calculations D', null],
      ['Investor column', 'XLOOKUP(investor code, Mapping!AA, Mapping!Z)', 'Calculations G', null],
      ['Hardcoded and ESG fields', 'INDEX / MATCH on the asset\'s Security ID in Hardcoded and ESG Hardcoded, columns by their row-2 label', 'Calculations HE:IU', null],
      ['FX rate', fx.source === 'position' ? "each row's own rate" : `one rate per currency: the first ${fx.reference || 'reference investor'} row in that currency (a currency it does not hold uses the row's own rate, with a warning)`, 'Calculations CL, CU:CW', h('span', {}, select('fxratesource', 'fxRateSource', fx.source || 'workbook', [['workbook', 'Workbook: one rate per currency'], ['position', "Each position's own rate"]], 'FX rate source'), ' reference ', select('fxreferenceinvestor', 'fxReferenceInvestor', fx.reference || '', [['', '(first column of Funding Name)']].concat(invNames.map((n) => [n, n])), 'FX reference investor'))],
      ['Amount in EUR', fx.quote === 'eur_per_ccy' ? 'amount × rate (rate = EUR per unit)' : 'amount ÷ rate (rate = units per EUR)', 'Calculations CP, CR, CT', h('span', {}, 'quote ', h('a', { href: Scope.href('data', 'views') }, 'on the Views & investors tab'))],
      ['FX exception', (D.fxException || []).length ? (D.fxException || []).map((x) => `${x.investor} in ${x.currency}${x.view ? ' on ' + x.view : ''}: ${x.column ? 'rate per asset from Hardcoded "' + x.column + '"' : 'rate ' + x.rate}`).join(' · ') : 'none', 'Calculations CL, CX', h('span', { class: 'small muted' }, `in the ${settingsName()} sheet`)],
      ['Rating', "internal rating unless NR, else the worst of Fitch, Moody's and S&P; score = MAX(internal, external) via Mapping › Investment Grade Mapping", 'Calculations GT:HA', null],
      ['IG / Sub-IG', `score > ${cfg.ig_threshold} → SUB IG; unrated → NR (the workbook shows IG)`, 'Calculations HB', h('span', {}, 'threshold ', text('igthreshold', 'igThreshold', cfg.ig_threshold, 'IG threshold', '80px'))],
      ['Exposure per asset and investor column', 'SUMIF(investor column & asset, amount in EUR)', 'Calculations DK:EN, FC:GE', null],
      [`${attr} attributed`, `SUMPRODUCT(investor columns, ${attr} ownership); third party = total − attributed`, 'Calculations EO', h('a', { href: Scope.href('data', 'setup', 'weights') }, 'ownership in step 4')],
      ['Views', 'Σ coefficient × investor column (a view named in a formula is expanded to its columns)', 'Calculations DI, EQ:ES', h('span', { class: 'small muted' }, 'above')],
      ['Look-through', 'from each "<investor> incl. part in funds" formula: its fund coefficients are the investor\'s share of that fund\'s units; the rest is held outside the platform', 'Calculations EQ:ES', null],
      ['Output rows', 'active assets (Mapping › Active Assets) with exposure in the selected view', 'Calculations DD · Output rows', null],
      ['Maturity buckets', (cfg.buckets || []).join(', '), 'Quarterly reporting', h('span', {}, text('maturitybuckets', 'maturityBuckets', (cfg.buckets || []).join(', '), 'Maturity buckets', '200px'))],
      ['Attribution label', cfg.attribution_label, 'every label', h('span', {}, text('attributionlabel', 'attributionLabel', cfg.attribution_label, 'Attribution label', '120px'))],
    ];
    el.appendChild(UI.section({ title: 'Calculation steps', subtitle: 'as implemented in js/calc/aum.js, with the workbook cell each step reproduces; parameters can be changed here',
      body: h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl dp-steps-table' }, h('thead', {}, h('tr', {}, ['Step', 'Formula', 'Workbook', 'Parameters'].map((l) => h('th', {}, l)))),
        h('tbody', {}, rows.map(([a, b, c, d]) => h('tr', {}, h('td', { class: 'strong' }, a), h('td', { class: 'wrap dp-formula-cell' }, b), h('td', { class: 'dim' }, c), h('td', {}, d || h('span', { class: 'dim' }, 'fixed'))))))) }));
  }

  // =====================================================================================================================
  // Checks
  // =====================================================================================================================
  /** Checks tab: each of the workbook's formula columns recomputed by the calculation file, with the differing cells. */
  function checksTab(el, res) {
    if (!res) { el.appendChild(noData()); return; }
    const checks = diag(res).checks || [];
    el.appendChild(h('div', { class: 'notice info' }, h('b', {}, 'Reconciliation with the workbook. '),
      'These compare the workbook\'s own formula columns (Holdings B to E and row 2, Hardcoded D and E) with the same values worked out by the calculation file, js/calc/aum.js. 100% means the web calculation reproduces the workbook. Blank workbook cells are not compared; up to 25 differing cells are listed per check.'));
    if (!checks.length) { el.appendChild(UI.section({ title: 'Workbook checks', body: UI.empty('None of the workbook\'s formula columns were found, so there is nothing to compare.') })); return; }
    const ok = checks.filter((c) => c.status === 'ok').length, skipped = checks.filter((c) => c.status === 'skipped').length, compared = checks.length - skipped;
    el.appendChild(h('div', { class: 'dp-summary' }, h('b', {}, `${ok} of ${compared}`), ` compared checks reproduce the workbook exactly${ok === compared ? '.' : '; the others list the cells that differ.'}`,
      skipped ? ` ${plural(skipped, 'check')} skipped because the workbook's formulas returned errors (such as #REF!); Scope works these values out itself.` : ''));
    el.appendChild(h('div', { class: 'dp-checks' }, checks.map(checkCard)));
  }

  /** One reconciliation check: name and formula, status, matched / total with a bar, and the differing cells. */
  function checkCard(c) {
    const i = c.label.indexOf(' = '), name = i > 0 ? c.label.slice(0, i) : c.label, formula = i > 0 ? c.label.slice(i + 1).trim() : '';
    const pct = c.total ? c.matched / c.total : 0, st = STATUS[c.status] || [c.status, 'muted'];
    if (c.status === 'skipped') return UI.section({ class: 'dp-check', title: name, actions: [UI.badge(st[0], st[1])], body: h('div', {},
      formula ? h('div', { class: 'dp-formula' }, formula) : null,
      h('div', { class: 'small muted' }, `Not compared: all ${F.int(c.failed || 0)} workbook values are formula errors (such as #REF!, usually a reference to a sheet not exported with the four). Scope works these values out itself.`)) });
    return UI.section({ class: 'dp-check', title: name, actions: [UI.badge(st[0], st[1])], body: h('div', {},
      formula ? h('div', { class: 'dp-formula' }, formula) : null,
      h('div', { class: 'dp-check-figs' }, h('span', { class: 'dp-check-pct' }, pct === 1 ? '100%' : F.pct(Math.floor(pct * 1000) / 1000, 1)), h('span', { class: 'muted' }, `${F.int(c.matched)} of ${F.int(c.total)} cells match`)),
      h('div', { class: 'dp-meter dp-meter-' + c.status }, h('span', { style: { width: (pct * 100).toFixed(1) + '%' } })),
      c.examples && c.examples.length ? UI.table({ rows: c.examples, compact: true, filter: false, columns: [
        { key: 'cell', label: 'Cell', class: 'mono' }, { key: 'workbook', label: 'Workbook value' }, { key: 'scope', label: 'Scope value' }] })
        : h('div', { class: 'small muted' }, 'Every compared cell matches.')) });
  }

  // =====================================================================================================================
  // Issues and corrections
  // =====================================================================================================================
  /** Issues tab: every data issue, by severity and sheet; keys link to the asset page when they name an asset or position. */
  function issuesTab(el, res) {
    if (!res) { el.appendChild(noData()); return; }
    const all = res.issues || [];
    const assetCodes = new Set((res.assets || []).map((a) => a.code));
    const posAsset = new Map((res.positions || []).map((p) => [p.key, p.asset_code]));
    /** Asset code behind an issue key (an asset code or a position key), or null. */
    const assetOf = (key) => (!key ? null : assetCodes.has(key) ? key : posAsset.get(key) || null);
    const sheets = U.uniq(all.map((i) => i.table).filter(Boolean));
    const dn = diagnosisNotice(res); if (dn) el.appendChild(dn);
    if (state.issueSheet !== 'all' && !sheets.includes(state.issueSheet)) state.issueSheet = 'all';
    const bySheet = all.filter((i) => state.issueSheet === 'all' || i.table === state.issueSheet);
    const rows = bySheet.filter((i) => state.sev === 'all' || i.severity === state.sev);
    const cnt = (sv) => bySheet.filter((i) => i.severity === sv).length; // issues of one severity on the chosen sheet
    const sevChips = h('div', { class: 'chips' }, ['all', 'error', 'warn', 'info'].map((sv) => UI.chip(sv === 'all' ? `All (${bySheet.length})` : `${SEV[sv]} (${cnt(sv)})`, state.sev === sv, () => { state.sev = sv; Scope.app.render(true); })));
    const sheetChips = h('div', { class: 'chips' }, ['all'].concat(sheets).map((s) => UI.chip(s === 'all' ? 'All sheets' : `${s} (${all.filter((i) => i.table === s).length})`, state.issueSheet === s, () => { state.issueSheet = s; Scope.app.render(true); })));
    el.appendChild(UI.section({ title: 'Data issues', subtitle: 'errors leave a position out of AUM, warnings keep it but flag it, info is context; nothing is silently set to zero. The Key column is the position (investor code x Security ID) the issue belongs to, not what was looked up',
      actions: diagnosticsButtons(),
      body: h('div', {}, h('div', { class: 'dp-toolbar' }, sevChips, sheetChips), UI.table({ rows, compact: true, exportName: 'scope-issues.csv', pageSize: 500, columns: [
        { key: 'severity', label: 'Severity', render: (r) => UI.badge(SEV[r.severity] || r.severity, r.severity) },
        { key: 'table', label: 'Sheet' },
        { key: 'row', label: 'Row', align: 'right', format: (v) => (v === null || v === undefined ? '' : String(v)) },
        { key: 'cell', label: 'Cell', class: 'mono', format: (v, r) => (v ? (String(v).includes('!') ? String(v) : `${r.table}!${v}`) : '') },
        { key: 'key', label: 'Key', render: (r) => { const code = assetOf(r.key); return code ? h('a', { href: Scope.href('asset', code) }, r.key) : h('span', { class: 'dim' }, r.key || ''); } },
        { key: 'message', label: 'Message', class: 'wrap' }] })) }));
  }

  /** Corrections tab: the full audit trail, newest first, including reverted and superseded entries; active ones can be reverted. */
  function correctionsTab(el) {
    const rows = store.state.adjustments.slice().reverse().map((a) => Object.assign({}, a, { status: a.reverted ? 'reverted' : a.superseded ? 'superseded' : 'active' }));
    const text = (v) => (v === null || v === undefined ? '' : String(v)); // a value as table text
    el.appendChild(UI.section({ title: 'Manual corrections', subtitle: 'the original value, new value, reason, user and time are kept; a reverted correction stays in the history',
      body: rows.length ? UI.table({ rows, compact: true, filter: false, exportName: 'scope-corrections.csv', columns: [
        { key: 'status', label: 'Status', render: (r) => UI.badge(r.status, r.status === 'active' ? 'manual' : 'muted') },
        { key: 'table', label: 'Table' },
        { key: 'key', label: 'Key', render: (r) => (r.table === 'assets' ? h('a', { href: Scope.href('asset', r.key) }, r.key) : h('span', { class: 'mono' }, r.key)) },
        { key: 'field', label: 'Field', class: 'mono' },
        { key: 'original', label: 'Original', format: text }, { key: 'value', label: 'New value', class: 'strong', format: text },
        { key: 'reason', label: 'Reason', class: 'wrap' }, { key: 'user', label: 'User' },
        { key: 'at', label: 'When', format: (v) => when(v), class: 'dim' },
        { key: 'id', label: '', render: (r) => (r.status === 'active' ? h('button', { class: 'btn btn-sm btn-danger', onClick: () => { store.revertAdjustment(r.id); UI.toast('Correction reverted'); } }, 'Revert') : h('span')) }] })
        : UI.empty('No corrections yet. Use the edit icon on an asset page to correct a value with a recorded reason.') }));
  }

  // =====================================================================================================================
  // Settings
  // =====================================================================================================================
  /** A settings value as display text. */
  function fmtVal(v) {
    if (Array.isArray(v)) return v.map(fmtVal).join(', ');
    if (typeof v === 'number') return v.toLocaleString('en-GB');
    if (isObj(v)) return JSON.stringify(v);
    return String(v);
  }
  /** A CONFIG.views definition as text. */
  function viewDefText(def) {
    if (def === '*') return 'all investors';
    if (def === 'group') return 'group weights';
    if (Array.isArray(def)) return def.map((x) => (Array.isArray(x) ? `${x[0]} × ${fmtW(x[1])}` : `${x} × 1`)).join(' + ');
    return fmtVal(def);
  }

  /** Settings tab: CONFIG (§1 of the calculation file), read-only, with per-browser overrides marked. */
  function settingsTab(el) {
    const C = cfg(), ov = overrides();
    el.appendChild(h('div', { class: 'notice info dp-bar' },
      h('div', {}, h('b', {}, 'Read-only defaults. '), `These settings live in js/calc/aum.js, §1 (CONFIG). The workbook's ${settingsName()} sheet overrides them, and changes made on the `,
        h('a', { href: Scope.href('data', 'setup') }, 'Setup'), ' and ', h('a', { href: Scope.href('data', 'views') }, 'Views & investors'), ' tabs (names, types, weights, views, FX quote) and the ', h('a', { href: Scope.href('data', 'columns') }, 'Columns'), ' tab (which column each role reads) override both, in this browser.'),
      h('div', { class: 'dp-row-actions' }, h('button', { class: 'btn btn-sm', onClick: exportSettings }, ic('download'), 'Export settings'))));
    if (!Object.keys(C).length) { el.appendChild(UI.empty('The calculation file is not loaded.')); return; }
    const changed = () => UI.badge('overridden here', 'manual', 'an override saved in this browser applies instead'); // a new badge per use
    const scalars = Object.entries(C).filter(([, v]) => !isObj(v) || (Array.isArray(v) && v.every((x) => !isObj(x))));
    const sections = [UI.section({ title: 'General', subtitle: 'single values', body: UI.dl(scalars.map(([k, v]) => [h('code', {}, k),
      h('span', {}, h('b', {}, fmtVal(v)), CONFIG_INFO[k] ? h('span', { class: 'muted' }, ' ' + CONFIG_INFO[k]) : null, k === 'fxQuote' && ov.fxQuote ? [' ', changed()] : null)])) })];
    for (const [k, v] of Object.entries(C)) {
      if (!isObj(v) || scalars.some(([s]) => s === k)) continue;
      const title = CONFIG_TITLES[k] || k;
      let body;
      if (k === 'views') body = UI.table({ rows: Object.entries(v).map(([name, def]) => ({ name, def: viewDefText(def), over: !!(ov.views && ov.views[name] !== undefined) })), compact: true, filter: false, columns: [
        { key: 'name', label: 'View', class: 'strong' }, { key: 'def', label: 'Definition', class: 'wrap' }, { key: 'over', label: '', render: (r) => (r.over ? changed() : h('span')) }] });
      else if (k === 'investors') body = UI.table({ rows: Object.entries(v).map(([label, x]) => ({ label, group: x[0], weight: x[1], over: !!(ov.investors && ov.investors[label]) })), compact: true, filter: false, columns: [
        { key: 'label', label: 'Investor column', class: 'strong' }, { key: 'group', label: 'Group' }, { key: 'weight', label: 'Weight', align: 'right', format: fmtW }, { key: 'over', label: '', render: (r) => (r.over ? changed() : h('span')) }] });
      else if (k === 'regions') {
        const by = new Map();
        Object.entries(v).forEach(([country, region]) => by.set(region, (by.get(region) || []).concat(country)));
        body = UI.table({ rows: Array.from(by, ([region, cs]) => ({ region, countries: cs.join(', ') })).concat([{ region: 'Rest of world', countries: 'every other country' }]), compact: true, filter: false, columns: [
          { key: 'region', label: 'Region', class: 'strong' }, { key: 'countries', label: 'Countries', class: 'wrap' }] });
      } else if (Array.isArray(v)) {
        const keys = U.uniq(v.flatMap((x) => Object.keys(x || {})));
        body = v.length ? UI.table({ rows: v, compact: true, filter: false, columns: keys.map((kk) => ({ key: kk, label: kk, format: (x) => (x === undefined || x === null ? '' : fmtVal(x)) })) }) : UI.empty('none');
      } else body = UI.table({ rows: Object.entries(v).map(([key, val]) => ({ key, val: fmtVal(val) })), compact: true, filter: false, columns: [{ key: 'key', label: 'Key', class: 'mono' }, { key: 'val', label: 'Value', align: 'right' }] });
      sections.push(UI.section({ title, subtitle: `CONFIG.${k}`, body }));
    }
    el.appendChild(h('div', { class: 'dp-settings' }, sections));
  }

  // Tab id → renderer (defined last: the functions above are hoisted, the page renders after this file has run).
  const TAB_RENDER = { setup: setupTab, inputs: inputsTab, columns: columnsTab, mapping: mappingTab, views: viewsTab, formulas: formulasTab, checks: checksTab, issues: issuesTab, corrections: correctionsTab, settings: settingsTab };
})(window);
