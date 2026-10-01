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
 *   Setup              guided steps: load, columns, investors (names, groups, weights), views, look-through grid, checks;
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
  const TABS = [['setup', 'Setup'], ['inputs', 'Inputs'], ['columns', 'Columns'], ['mapping', 'Mapping'], ['views', 'Views & investors'], ['checks', 'Checks'], ['issues', 'Issues'], ['corrections', 'Corrections'], ['settings', 'Settings']];
  const ALIASES = { overview: 'inputs', adjustments: 'corrections', config: 'settings', start: 'setup' }; // earlier tab names keep working
  const GROUPS = ['Group entity', 'Fund', 'Third party', 'Unclassified'];
  const SEV = { error: 'error', warn: 'warning', info: 'info' };
  const STATUS = { ok: ['reproduced', 'ok'], warn: ['minor differences', 'warn'], error: ['differs', 'error'], skipped: ['skipped', 'muted'] };
  const SETTINGS_GROUPS = ['names', 'investors', 'views', 'fundHolders']; // override groups the Scope Settings sheet can hold
  const STEP_STATUS = { done: ['done', 'ok'], attention: ['needs attention', 'warn'], optional: ['optional', 'muted'], waiting: ['after step 1', 'muted'] };
  const STEP_ALIASES = { 'look-through': 'lookthrough', funds: 'lookthrough', workbook: 'load' }; // #/data/setup/<step>
  const SETTINGS_TABLES = { investors: 'Investors', views: 'Views', lookThrough: 'Look Through', fxException: 'FX Exception', settings: 'Settings' };
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
  const CONFIG_TITLES = { views: 'Views', investors: 'Investors', fundHolders: 'Fund unit holders (look-through)', fxOverrides: 'FX exception', regions: 'Regions', thresholds: 'Concentration thresholds (illustrative)' };

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
  /** Share as percent text: 0.15 → "15%", 1/3 → "33.33%" (empty for non-numbers). */
  const fmtShare = (v) => (U.isNum(v) ? `${+(v * 100).toFixed(2)}%` : '');

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
    for (const g of ['investors', 'fundHolders', 'views']) {
      const o = ov[g]; if (!o) continue;
      for (const key of Object.keys(o)) {
        let val = o[key];
        if (g === 'fundHolders' && Array.isArray(val)) val = val.map(([hl, sh]) => [fix(hl), sh]);
        if (g === 'views' && Array.isArray(val)) val = val.map((x) => (Array.isArray(x) ? [fix(x[0]), x[1]] : fix(x)));
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

  /** Number of overrides saved in this browser (columns, display names, views, investors, look-through, FX quote). */
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
  /** "Investors 12 rows · Views 6 rows · Look Through not found …" for the tables of the settings sheet. */
  function settingsTablesText(res) {
    const T = (diag(res).settings || {}).tables || {};
    const parts = Object.keys(SETTINGS_TABLES).filter((k) => T[k]).map((k) => (T[k].found ? `${SETTINGS_TABLES[k]} ${plural(T[k].rows || 0, 'row')}` : `${SETTINGS_TABLES[k]} not found`));
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
    const inv = D.investors || [], unclassified = inv.filter((i) => i.source === 'default' || i.group === 'Unclassified');
    const views = D.views || [], undef = views.filter((v) => v.kind === 'undefined');
    const checks = D.checks || [], differs = checks.filter((c) => c.status === 'warn' || c.status === 'error'), skipped = checks.filter((c) => c.status === 'skipped');
    const lt = ltModel(D);
    const status = !res ? { load: 'attention', columns: 'waiting', investors: 'waiting', views: 'waiting', lookthrough: 'waiting', checks: 'waiting' } : {
      load: !missing.length && !res.fatal ? 'done' : 'attention',
      columns: req.length && reqOk === req.length ? 'done' : 'attention',
      investors: !inv.length || unclassified.length ? 'attention' : 'done',
      views: !views.length ? 'optional' : undef.length ? 'attention' : 'done',
      lookthrough: lt.status,
      checks: !checks.length ? 'optional' : differs.length ? 'attention' : 'done',
    };
    return { D, missing, req, reqOk, inv, unclassified, views, undef, checks, differs, skipped, lt, status };
  }

  /** Setup tab: the Scope Settings card, then six numbered steps from loading the workbook to the checks. */
  function setupTab(el, res, params) {
    const S = setupFacts(res);
    el.appendChild(settingsIntro(res));
    const steps = h('div', { class: 'dp-steps' }, loadStep(res, S), columnsStep(res, S), investorsStep(res, S), viewsStep(res, S), lookThroughStep(res, S), checksStep(res, S));
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

  /** The Scope Settings card at the top of Setup: what the sheet is, where the settings in force come from, and its actions. */
  function settingsIntro(res) {
    const n = countSettingsChanges(), A = calc();
    const canBuild = !!(res && typeof A.effectiveSettings === 'function' && typeof A.settingsGrid === 'function');
    const picker = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv', class: 'hidden', 'aria-label': 'Settings file',
      onChange: (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; loadSettingsFile(files); } });
    return UI.section({ class: 'dp-intro', title: settingsName(), subtitle: 'display names, groups, weights, views and look-through in one optional sheet',
      body: h('div', {},
        h('p', { class: 'dp-intro-text' }, `Settings live in an optional fifth sheet, ${settingsName()}. Download it pre-filled, fill it in Excel, add it to your workbook, and every drop is configured automatically. Changes you make here apply at once in this browser; download the sheet again to keep them.`),
        h('div', { class: 'dp-intro-status' }, h('b', {}, 'Settings: '), h('span', {}, settingsSourceText(res)),
          n ? [h('span', { class: 'muted' }, ' · '), UI.badge(`${n} changed here`, 'manual', 'saved in this browser; they take precedence over the sheet')] : null),
        h('div', { class: 'dp-intro-actions' },
          h('button', { class: 'btn btn-primary btn-sm', disabled: !canBuild, onClick: () => downloadSettings('xlsx') }, ic('download'), `Download ${settingsName()} sheet (.xlsx)`),
          h('button', { class: 'btn btn-sm', disabled: !canBuild, onClick: () => downloadSettings('csv') }, ic('download'), 'Download as CSV'),
          h('button', { class: 'btn btn-sm', onClick: () => picker.click() }, ic('upload'), 'Load settings file'), picker,
          h('button', { class: 'btn btn-sm btn-danger', disabled: !n, onClick: clearSettingsChanges }, ic('x'), 'Clear changes made here')),
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
    if (!global.confirm(`Clear the ${plural(n, 'change')} made here (display names, groups, weights, views, look-through, FX quote)? The ${settingsName()} sheet, or the calculation file's defaults, apply again. Column choices are kept.`)) return;
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
      state.lastLoad ? lastLoadNotice() : null, fatal, dropZone(true), list,
      h('div', { class: 'dp-step-foot' },
        h('span', {}, h('b', {}, 'Settings: '), settingsSourceText(res), n ? ` · ${n} changed here` : '', setS.present === false && setG ? h('span', { class: 'muted' }, ' (the sheet was loaded but none of its tables was read)') : null),
        h('a', { href: Scope.href('data', 'inputs') }, 'Inputs tab: paste a sheet, download the sheets'))));
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

  // ---------- step 3: investors ----------
  /** Step 3: the investor columns, with editable display name, group and attribution weight. */
  function investorsStep(res, S) {
    const attr = attrLabel(res);
    const line = `Rename investor columns, and set each one's group and the share attributed to the ${attr} (1 = all of it, 0 = none, 0.35 or 35% = 35%).`;
    if (!res) return stepCard(3, 'investors', 'Investors', S.status.investors, line, waitBody());
    if (!S.inv.length) return stepCard(3, 'investors', 'Investors', 'attention', line, UI.empty('No investor columns: the Funding Name table of Mapping (columns Y to AA) is empty or was not found.'));
    const unc = S.unclassified;
    const tools = h('div', { class: 'dp-step-tools' },
      h('button', { class: 'btn btn-sm', disabled: !unc.length, onClick: () => bulkThirdParty(unc) }, ic('users'), 'Set every unclassified investor to Third party, weight 0'),
      h('span', { class: 'small muted' }, unc.length ? `${plural(unc.length, 'investor')} not classified yet` : 'Every investor has a group.'));
    return stepCard(3, 'investors', 'Investors', S.status.investors, line, h('div', {}, tools, investorsTable(S.inv),
      h('p', { class: 'small muted dp-step-hint' }, 'Leave the display name blank to use the workbook name. Enter or leaving a cell saves it; Escape undoes the typing.')));
  }

  /** The editable investors table: holdings ID, workbook name, display name, group, weight and source. */
  function investorsTable(inv) {
    const head = h('thead', {}, h('tr', {}, ['Holdings ID', 'Workbook name', 'Display name', 'Group', 'Attribution weight', 'Source'].map((l, i) => h('th', { class: ['dp-inv-id', 'dp-inv-name', '', '', 'num', ''][i] }, l))));
    const body = h('tbody', {}, inv.map((r, idx) => {
      const orig = origOf(r), shown = r.label !== orig ? r.label : '', changedGroup = r.source === 'override';
      const nameIn = h('input', { type: 'text', class: 'input dp-in dp-in-name' + (r.nameSource === 'override' ? ' dp-changed' : ''), value: shown, placeholder: orig, autocomplete: 'off', spellcheck: 'false',
        'aria-label': `Display name of ${orig}`, dataset: { focus: `inv|${orig}|name`, text: shown, r: String(idx), c: 'name' },
        onChange: (e) => commitName(r, e.target, inv), onKeydown: cellKeys });
      const sel = h('select', { class: 'input dp-select' + (changedGroup ? ' dp-changed' : ''), 'aria-label': `Group of ${r.label}`, dataset: { focus: `inv|${orig}|group` },
        onChange: (e) => { const g = e.target.value; deferSave(() => setInvestor(r, g, r.weight)); } },
        U.uniq(GROUPS.concat([r.group])).map((g) => h('option', { value: g, selected: g === r.group }, g)));
      const wText = fmtW(r.weight);
      const wIn = h('input', { type: 'text', inputmode: 'decimal', class: 'input dp-in dp-num' + (changedGroup ? ' dp-changed' : ''), value: wText, autocomplete: 'off',
        'aria-label': `Attribution weight of ${r.label}`, title: '1 = all of it, 0 = none, 0.35 or 35% = 35%', dataset: { focus: `inv|${orig}|weight`, text: wText, r: String(idx), c: 'weight' },
        onFocus: (e) => e.target.select(), onChange: (e) => commitWeight(r, e.target), onKeydown: cellKeys });
      return h('tr', { class: r.source === 'default' ? 'dp-row-warn' : '' },
        h('td', { class: 'mono dp-inv-id' }, r.id || ''), h('td', { class: 'dp-inv-name' }, orig), h('td', {}, nameIn), h('td', {}, sel), h('td', { class: 'num' }, wIn), h('td', {}, investorSourceCell(r)));
    }));
    return h('div', { class: 'tbl-scroll compact dp-inv-scroll', dataset: { keepScroll: 'inv' } }, h('table', { class: 'tbl dp-inv' }, head, body));
  }

  /** Source badge of one investor row, with Reset when something was changed here. */
  function investorSourceCell(r) {
    const changed = r.source === 'override' || r.nameSource === 'override';
    const badge = changed ? UI.badge('changed here', 'manual', 'saved in this browser')
      : r.source === 'sheet' || r.nameSource === 'sheet' ? UI.badge('from your sheet', 'info', `the ${settingsName()} sheet`)
        : r.source === 'settings' ? UI.badge('settings', 'muted', '§1 defaults in the calculation file')
          : UI.badge('not set', 'warn', 'treated as Unclassified, weight 0');
    return h('div', { class: 'dp-row-actions dp-left' }, badge,
      changed ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Undo the changes made here for this investor', 'aria-label': `Reset ${r.label}`, onClick: () => resetInvestor(r, true) }, ic('refresh-cw'), 'Reset') : null);
  }

  /** Save a display name typed in the investors table (blank or the workbook name = show the workbook name). */
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

  /** Save an attribution weight typed in the investors table (1, 0.35 or 35%). */
  function commitWeight(r, input) {
    const cur = input.dataset.text || '', txt = input.value.trim();
    if (txt === cur) return;
    const w = parseShare(txt);
    if (!isFinite(w) || w < 0 || w > 1) { UI.toast('Enter a weight between 0 and 1: 1, 0.35 or 35%', 'warn'); input.value = cur; return; }
    input.value = fmtW(w); input.dataset.text = input.value;
    if (r.source !== 'default' && Math.abs(w - (+r.weight || 0)) < 1e-12) return;
    deferSave(() => setInvestor(r, r.group, w));
  }

  /** Remove the changes made here for one investor: group and weight, and with `withName` its display name too. */
  function resetInvestor(r, withName) {
    const orig = origOf(r);
    writeOverrides((ov) => { if (ov.investors) dropAliases(ov.investors, [orig, r.label]); if (withName && ov.names) dropAliases(ov.names, [orig]); });
    UI.toast(`${orig}: changes made here undone`);
  }

  /** Set every unclassified investor to Third party with weight 0, in one update. */
  function bulkThirdParty(unc) {
    if (!unc.length) return;
    writeOverrides((ov) => { ov.investors = ov.investors || {}; for (const r of unc) { dropAliases(ov.investors, [r.label, origOf(r)]); ov.investors[origOf(r)] = ['Third party', 0]; } });
    UI.toast(`${plural(unc.length, 'investor')} set to Third party, weight 0`);
  }

  // ---------- step 4: views ----------
  /** Step 4: each view of Mapping column H, how it is defined, with Edit (and Reset for changes made here). */
  function viewsStep(res, S) {
    const line = 'Each view in Mapping column H is an investor column, or a combination you define: all investors, the group weights or a list of columns.';
    if (!res) return stepCard(4, 'views', 'Views', S.status.views, line, waitBody());
    if (!S.views.length) return stepCard(4, 'views', 'Views', 'optional', line, UI.empty('No views are listed in Mapping column H.'));
    const rows = S.views.map((v) => h('tr', { class: v.kind === 'undefined' ? 'dp-row-bad' : '' },
      h('td', { class: 'strong' }, v.view), h('td', {}, kindBadge(v.kind)), h('td', { class: 'wrap' }, compositionText(v)),
      h('td', {}, h('div', { class: 'dp-row-actions' },
        h('button', { class: 'btn btn-sm' + (v.kind === 'undefined' ? ' btn-primary' : ''), onClick: () => editView(v, S.D) }, ic('edit-2'), v.kind === 'undefined' ? 'Define' : 'Edit'),
        v.kind === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Back to the sheet or the calculation file', onClick: () => { store.setOverride('views', v.view, null); UI.toast(`${v.view}: changes made here undone`); } }, ic('refresh-cw'), 'Reset') : null))));
    const table = h('div', { class: 'tbl-scroll compact dp-views-scroll' }, h('table', { class: 'tbl dp-views' },
      h('thead', {}, h('tr', {}, ['View', 'Defined by', 'Composition', ''].map((l) => h('th', {}, l)))), h('tbody', {}, rows)));
    return stepCard(4, 'views', 'Views', S.status.views, line, h('div', {},
      S.undef.length ? h('p', { class: 'dp-step-fig' }, h('b', {}, plural(S.undef.length, 'view')), ` not defined yet: ${S.undef.map((v) => v.view).join(', ')}. They show nothing until defined.`) : null,
      table));
  }

  // ---------- step 5: look-through ----------
  /**
   * The look-through grid's model: fund columns (with their shares by holder, totals and checks), the investor rows
   * (plus any holder that is not an investor column) and the step status. Names may be workbook or display names.
   */
  function ltModel(D) {
    const inv = D.investors || [], byName = new Map();
    inv.forEach((i) => byName.set(nk(i.label), i));
    inv.forEach((i) => { const k = nk(origOf(i)); if (!byName.has(k)) byName.set(k, i); });
    inv.forEach((i) => { const k = nk(i.fundName); if (i.fundName && !byName.has(k)) byName.set(k, i); });
    /** The investor column a name refers to (display, workbook or fund name), or null. */
    const find = (name) => byName.get(nk(name)) || null;
    const labels = Array.isArray(D.funds) ? D.funds
      : inv.filter((i) => /fund/i.test(i.group)).map((i) => i.label).concat((D.fundHolders || []).filter((f) => f.known !== false).map((f) => f.fund));
    const fundInv = U.uniq(labels.map((l) => find(l)).filter(Boolean));
    const shares = new Map(), regSource = new Map(), extra = [];
    for (const f of D.fundHolders || []) {
      const fi = find(f.fund); if (!fi) continue;
      const m = new Map();
      for (const [hl, sh] of f.holders || []) {
        const hi = find(hl), key = hi ? hi.label : String(hl);
        if (!hi && !extra.includes(key)) extra.push(key);
        m.set(key, (m.get(key) || 0) + (+sh || 0));
      }
      shares.set(fi.label, m); regSource.set(fi.label, f.source);
    }
    const ovFH = Object.keys(overrides().fundHolders || {}).map(nk);
    const funds = fundInv.map((fi) => {
      const m = shares.get(fi.label) || new Map(), names = [fi.label, origOf(fi), fi.fundName].filter(Boolean);
      let listed = 0, groupHeld = 0;
      for (const [hl, sh] of m) { listed += sh; const hi = find(hl); groupHeld += sh * (hi && U.isNum(+hi.weight) ? +hi.weight : 0); }
      const weight = U.isNum(+fi.weight) ? +fi.weight : 0, has = m.size > 0;
      return { inv: fi, label: fi.label, key: origOf(fi), names, shares: m, listed, groupHeld, weight, has,
        consistent: !has || Math.abs(groupHeld - weight) < 1e-6, over: listed > 1 + 1e-9,
        source: names.some((x) => ovFH.includes(nk(x))) ? 'override' : regSource.get(fi.label) || 'none' };
    });
    const rows = inv.map((i) => ({ label: i.label, key: origOf(i), inv: i, known: true })).concat(extra.map((x) => ({ label: x, key: x, inv: null, known: false })));
    const status = !funds.length ? 'optional' : funds.some((f) => f.over || !f.consistent) ? 'attention' : funds.every((f) => f.has) ? 'done' : 'optional';
    return { funds, rows, find, status };
  }

  /** Step 5: the look-through grid (investors down, funds across) with its tools and the per-fund checks. */
  function lookThroughStep(res, S) {
    const line = 'Who holds each fund\'s units, entered from the investor\'s side: Investor 1 owns 15% of Fund A. Whatever is not listed is held outside the platform.';
    if (!res) return stepCard(5, 'lookthrough', 'Look-through', S.status.lookthrough, line, waitBody());
    const M = S.lt, attr = attrLabel(res);
    if (!M.funds.length) return stepCard(5, 'lookthrough', 'Look-through', 'optional', line, h('div', { class: 'dp-step-help' },
      h('p', {}, 'No investor column is marked as a fund, so there is nothing to look through.'),
      h('p', {}, 'To add one, set its Group to Fund in ', h('a', { href: Scope.href('data', 'setup', 'investors') }, 'step 3'), '. Its column then appears here, ready for the share each investor holds.')));
    const nOv = Object.keys(overrides().fundHolders || {}).length;
    const tools = h('div', { class: 'dp-step-tools' },
      h('button', { class: 'btn btn-sm', onClick: () => ltPasteModal(M) }, ic('clipboard'), 'Paste from Excel'),
      h('button', { class: 'btn btn-sm', onClick: () => copyText(ltAsText(M)).then((ok) => UI.toast(ok ? 'Look-through copied: paste it into Excel' : 'The browser did not allow copying', ok ? '' : 'warn')) }, ic('grid'), 'Copy as table'),
      nOv ? h('button', { class: 'btn btn-sm', onClick: undoLookThrough }, ic('refresh-cw'), 'Undo changes made here') : null,
      h('span', { class: 'dp-spacer' }),
      h('button', { class: 'btn btn-sm btn-danger', onClick: () => clearLookThrough(M) }, ic('x'), 'Clear look-through'));
    const bad = M.funds.filter((f) => f.over || !f.consistent), none = M.funds.filter((f) => !f.has);
    const notes = [];
    if (bad.length) notes.push(h('li', {}, UI.badge('check', 'warn'), ' ', bad.map((f) => f.label).join(', '), `: ${bad.some((f) => f.over) ? 'more than 100% listed, or ' : ''}the ${attr} share differs from the fund's weight.`));
    if (none.length) notes.push(h('li', {}, UI.badge('empty', 'muted'), ' ', none.map((f) => f.label).join(', '), ': no holders listed, so shown directly only.'));
    return stepCard(5, 'lookthrough', 'Look-through', M.status, line, h('div', {}, tools,
      h('p', { class: 'small muted dp-step-hint' }, 'Each cell is the share of the fund (column) that the investor (row) holds. Type 15, 15% or 0.15; blank is 0. Enter moves down, and a block copied from Excel can be pasted straight into a cell.'),
      ltGrid(M, attr), notes.length ? h('ul', { class: 'dp-step-list dp-lt-notes' }, notes) : null));
  }

  /** The grid itself: sticky investor names, one share input per investor × fund, and per-fund totals and checks. */
  function ltGrid(M, attr) {
    const head = h('tr', {}, h('th', { class: 'dp-lt-rowh dp-lt-corner', scope: 'col' }, 'Investor', h('span', { class: 'dp-lt-sub' }, 'share of each fund held')),
      M.funds.map((f) => h('th', { scope: 'col', title: f.key !== f.label ? `workbook name: ${f.key}` : null }, f.label, h('span', { class: 'dp-lt-sub' }, `weight ${fmtShare(f.weight)}`))));
    const body = M.rows.map((row, ri) => h('tr', { class: row.known ? '' : 'dp-lt-unknown' },
      h('th', { class: 'dp-lt-rowh', scope: 'row', title: row.known && row.key !== row.label ? `workbook name: ${row.key}` : null }, row.label,
        h('span', { class: 'dp-lt-sub' }, row.known ? `${row.inv.group} · weight ${fmtW(row.inv.weight)}` : 'not an investor column')),
      M.funds.map((f, ci) => {
        if (row.known && row.inv === f.inv) return h('td', { class: 'dp-lt-self', title: 'A fund cannot hold its own units' });
        const v = f.shares.get(row.label) || 0, text = v ? fmtShare(v) : '';
        return h('td', { class: v ? 'dp-lt-has' : '' }, h('input', { type: 'text', inputmode: 'decimal', class: 'dp-lt-cell', value: text, autocomplete: 'off', spellcheck: 'false',
          'aria-label': `Share of ${f.label} held by ${row.label}`,
          dataset: { focus: `lt|${row.key}|${f.key}`, text, val: String(v), r: String(ri), c: String(ci), fund: f.key, holder: row.key },
          onFocus: (e) => e.target.select(), onChange: (e) => commitShare(e.target, M), onKeydown: cellKeys, onPaste: (e) => pasteBlock(e, M) }));
      })));
    /** Placeholder for a footer cell with nothing to show. */
    const dash = () => h('span', { class: 'muted' }, '–');
    const foot = [
      ['Total listed', (f) => (f.has ? h('span', { class: f.over ? 'dp-neg' : '' }, fmtShare(f.listed)) : dash())],
      ['Held outside the platform', (f) => (f.has ? h('span', { class: f.listed > 1 + 1e-9 ? 'dp-neg' : '' }, fmtShare(1 - f.listed)) : h('span', { class: 'muted' }, '100%'))],
      [`${attr} check`, (f) => (f.has ? h('span', { class: 'dp-lt-check', title: `Σ share × the holder's attribution weight, against the fund's own weight` }, `${fmtShare(f.groupHeld)} vs ${fmtShare(f.weight)} `, UI.badge(f.consistent ? 'OK' : 'differs', f.consistent ? 'ok' : 'warn')) : dash())],
      ['Source', (f) => fundSourceCell(f)],
    ].map(([label, fn]) => h('tr', {}, h('th', { class: 'dp-lt-rowh', scope: 'row' }, label), M.funds.map((f) => h('td', {}, fn(f)))));
    return h('div', { class: 'dp-lt-wrap', dataset: { keepScroll: 'lt' } }, h('table', { class: 'dp-lt' }, h('thead', {}, head), h('tbody', {}, body), h('tfoot', {}, foot)));
  }

  /** Where one fund's holders come from, with Reset when they were changed here. */
  function fundSourceCell(f) {
    const b = f.source === 'override' ? UI.badge('changed here', 'manual', 'saved in this browser') : f.source === 'sheet' ? UI.badge('from your sheet', 'info', `the ${settingsName()} sheet`)
      : f.source === 'settings' ? UI.badge('settings', 'muted', '§1 defaults in the calculation file') : UI.badge('none listed', 'muted');
    return h('span', { class: 'dp-lt-src' }, b, f.source === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Undo the changes made here for this fund', 'aria-label': `Reset ${f.label}`,
      onClick: () => { writeOverrides((ov) => dropAliases(ov.fundHolders, f.names)); UI.toast(`${f.label}: changes made here undone`); } }, ic('refresh-cw')) : null);
  }

  /** Value of one grid input: the exact stored share while its text is unchanged, else the typed text parsed (blank = 0). */
  function cellValue(inp) {
    const t = inp.value.trim();
    if (t === (inp.dataset.text || '')) return +inp.dataset.val || 0;
    return t === '' ? 0 : parseShare(t);
  }

  /** Validate a typed share and save its fund's column (no save when the value did not change). */
  function commitShare(input, M) {
    const prev = input.dataset.text || '', txt = input.value.trim();
    if (txt === prev) return;
    const v = txt === '' ? 0 : parseShare(txt);
    if (!isFinite(v) || v < 0 || v > 1) { UI.toast('Enter a share such as 15, 15% or 0.15 (blank is 0)', 'warn'); input.value = prev; return; }
    const same = Math.abs(v - (+input.dataset.val || 0)) < 1e-12;
    input.value = v ? fmtShare(v) : ''; input.dataset.text = input.value; input.dataset.val = String(v);
    if (same) return;
    const table = input.closest('table'), fund = input.dataset.fund;
    deferSave(() => saveFundColumns([fund], table, M));
  }

  /** Rebuild the holder list of each given fund from its grid column and save them all in one update. */
  function saveFundColumns(fundKeys, table, M) {
    const lists = new Map(fundKeys.map((k) => [k, []]));
    for (const inp of table.querySelectorAll('input.dp-lt-cell')) {
      const list = lists.get(inp.dataset.fund); if (!list) continue;
      const v = cellValue(inp);
      if (U.isNum(v) && v > 0) list.push([inp.dataset.holder, +v.toFixed(10)]);
    }
    writeOverrides((ov) => {
      ov.fundHolders = ov.fundHolders || {};
      for (const [k, list] of lists) { const f = M.funds.find((x) => x.key === k); dropAliases(ov.fundHolders, f ? f.names : [k]); ov.fundHolders[k] = list; }
    });
  }

  /** Paste a block copied from Excel into the grid, starting at the cell pasted into (a single value pastes normally). */
  function pasteBlock(e, M) {
    const cd = e.clipboardData || global.clipboardData, text = cd ? cd.getData('text') : '';
    if (!/[\t\n\r]/.test(String(text).replace(/[\r\n]+$/, ''))) return;
    e.preventDefault();
    const t = e.target, table = t.closest('table'), r0 = +t.dataset.r, c0 = +t.dataset.c;
    const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    const changed = new Set(); let bad = 0;
    lines.forEach((cells, i) => cells.forEach((raw, j) => {
      const inp = table.querySelector(`input.dp-lt-cell[data-r="${r0 + i}"][data-c="${c0 + j}"]`); if (!inp) return;
      const s = String(raw).trim(), v = s === '' ? 0 : parseShare(s);
      if (!isFinite(v) || v < 0 || v > 1) { bad++; return; }
      if (Math.abs(v - (+inp.dataset.val || 0)) < 1e-12) return;
      inp.value = v ? fmtShare(v) : ''; inp.dataset.text = inp.value; inp.dataset.val = String(v); changed.add(inp.dataset.fund);
    }));
    if (bad) UI.toast(`${plural(bad, 'cell')} skipped: not a share between 0 and 100%`, 'warn');
    if (changed.size) deferSave(() => { saveFundColumns(Array.from(changed), table, M); UI.toast(`Pasted into ${plural(changed.size, 'fund')}`); });
  }

  /** The grid as tab-separated text (fund names across, investors down, shares as percent) for Excel. */
  function ltAsText(M) {
    const lines = [['Investor'].concat(M.funds.map((f) => f.label))];
    for (const row of M.rows) lines.push([row.label].concat(M.funds.map((f) => { const v = f.shares.get(row.label); return v ? fmtShare(v) : ''; })));
    return lines.map((l) => l.join('\t')).join('\n') + '\n';
  }

  /**
   * Read a pasted look-through block: a matrix (fund names across the first row, investor names down the first column),
   * or the three columns Investor, Fund and Share of the settings sheet. Returns { updates: fund key → Map(holder key →
   * share), unknown names, bad cells, cells } or { error }.
   */
  function parseLtBlock(text, M) {
    const parse = IN('parseText');
    let rows;
    try { rows = parse ? parse(text).rows : String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.split('\t')); }
    catch (e) { return { error: String((e && e.message) || e) }; }
    rows = (rows || []).map((r) => (r || []).map((c) => (c === null || c === undefined ? '' : String(c).trim()))).filter((r) => r.some(Boolean));
    if (rows.length < 2) return { error: 'Paste a header row and at least one row of shares.' };
    /** The fund column a pasted name refers to, or null. */
    const fundOf = (name) => { const i = name ? M.find(name) : null; return i ? M.funds.find((f) => f.inv === i) || null : null; };
    /** The grid row a pasted investor name refers to, or null. */
    const rowOf = (name) => { if (!name) return null; const i = M.find(name); return i ? M.rows.find((r) => r.inv === i) || null : M.rows.find((r) => !r.known && nk(r.label) === nk(name)) || null; };
    const updates = new Map(), unknown = new Set();
    let bad = 0, cells = 0;
    /** Record one share (blank = 0) for a fund and holder row. */
    const put = (f, row, s) => {
      if (row.known && row.inv === f.inv) return;
      const v = s === '' ? 0 : parseShare(s);
      if (!isFinite(v) || v < 0 || v > 1) { bad++; return; }
      if (!updates.has(f.key)) updates.set(f.key, new Map());
      updates.get(f.key).set(row.key, v); cells++;
    };
    const hdr = rows[0].map(nk);
    const li = hdr.findIndex((x) => /^(investor|holder)/.test(x)), fi = hdr.findIndex((x) => /^fund/.test(x)), si = hdr.findIndex((x) => /^(share|ownership)/.test(x));
    if (li >= 0 && fi >= 0 && si >= 0 && !fundOf(rows[0][fi])) {
      for (const r of rows.slice(1)) {
        const f = fundOf(r[fi]), row = rowOf(r[li]);
        if (!f) { if (r[fi]) unknown.add(r[fi]); continue; }
        if (!row) { if (r[li]) unknown.add(r[li]); continue; }
        put(f, row, r[si] || '');
      }
    } else {
      const cols = rows[0].map((name, j) => (j === 0 ? null : fundOf(name)));
      rows[0].forEach((name, j) => { if (j && name && !cols[j]) unknown.add(name); });
      if (!cols.some(Boolean)) return { error: 'None of the names in the first row is a fund column: put the fund names across the first row, or paste the Investor, Fund and Share columns.' };
      for (const r of rows.slice(1)) {
        const row = rowOf(r[0]);
        if (!row) { if (r[0]) unknown.add(r[0]); continue; }
        cols.forEach((f, j) => { if (f) put(f, row, r[j] || ''); });
      }
    }
    return { updates, unknown: Array.from(unknown), bad, cells };
  }

  /** Merge parsed shares into the current look-through (cells not in the block keep their value) and save in one update. */
  function mergeLookThrough(updates, M) {
    writeOverrides((ov) => {
      ov.fundHolders = ov.fundHolders || {};
      for (const [fk, upd] of updates) {
        const f = M.funds.find((x) => x.key === fk); if (!f) continue;
        const cur = new Map();
        for (const [label, sh] of f.shares) { const row = M.rows.find((r) => r.label === label); cur.set(row ? row.key : label, sh); }
        for (const [hk, v] of upd) cur.set(hk, v);
        dropAliases(ov.fundHolders, f.names);
        ov.fundHolders[f.key] = Array.from(cur).filter(([, v]) => v > 0).map(([k, v]) => [k, +v.toFixed(10)]);
      }
    });
  }

  /** "Paste from Excel" dialog: a block of shares merged into the grid and saved. */
  function ltPasteModal(M) {
    const ta = h('textarea', { class: 'input dp-paste', placeholder: 'Paste here (Ctrl+V, or Cmd+V on a Mac)', spellcheck: 'false', wrap: 'off', 'aria-label': 'Look-through block' });
    const msg = h('div', { class: 'small dp-paste-foot' });
    /** Parse, merge and save; problems stay in the dialog. */
    const apply = () => {
      if (!ta.value.trim()) { msg.textContent = 'Nothing pasted yet.'; ta.focus(); return; }
      const r = parseLtBlock(ta.value, M);
      if (r.error) { msg.textContent = r.error; msg.className = 'small dp-paste-foot dp-neg'; return; }
      if (!r.cells) { msg.textContent = `Nothing to merge.${r.unknown.length ? ` Not recognised: ${r.unknown.join(', ')}.` : ''}`; msg.className = 'small dp-paste-foot dp-neg'; return; }
      m.close();
      mergeLookThrough(r.updates, M);
      const extra = [r.unknown.length ? `not recognised: ${r.unknown.join(', ')}` : '', r.bad ? `${plural(r.bad, 'cell')} skipped (not a share)` : ''].filter(Boolean).join('; ');
      UI.toast(`Look-through updated for ${plural(r.updates.size, 'fund')}${extra ? '; ' + extra : ''}`, extra ? 'warn' : '');
    };
    const m = UI.modal({ title: 'Paste look-through from Excel', wide: true,
      body: h('div', {},
        h('p', { class: 'small' }, 'Copy a block from Excel with the fund names across the first row and the investor names down the first column, shares as 15%, 15 or 0.15. The three columns Investor, Fund and Share (the Look Through table of the settings sheet) work too. Names may be workbook or display names.'),
        h('p', { class: 'small muted' }, 'Cells in the block replace the grid\'s cells, and a blank cell counts as 0; cells outside the block keep their value.'),
        ta, msg),
      actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: apply }, ic('check'), 'Merge and save')] });
    setTimeout(() => ta.focus(), 0);
  }

  /** Remove every holder of every fund (each fund then shows directly only), after confirmation. */
  function clearLookThrough(M) {
    if (!global.confirm(`Clear every look-through share? Each fund is then shown directly only until shares are entered again. The ${settingsName()} sheet itself is not changed; Undo changes made here brings its shares back.`)) return;
    writeOverrides((ov) => { ov.fundHolders = {}; for (const f of M.funds) ov.fundHolders[f.key] = []; });
    UI.toast('Look-through cleared');
  }

  /** Remove the look-through changes made here, so the sheet or the calculation file's register applies again. */
  function undoLookThrough() {
    if (!global.confirm('Undo every look-through change made here? The shares from the settings sheet, or the calculation file, apply again.')) return;
    writeOverrides((ov) => { delete ov.fundHolders; });
    UI.toast('Look-through changes undone');
  }

  // ---------- step 6: checks ----------
  /** Step 6: the workbook formula checks in brief, with a link to the Checks tab. */
  function checksStep(res, S) {
    const line = 'The workbook\'s own formula columns (Holdings B to F and row 2, Hardcoded D and E) worked out again and compared cell by cell.';
    if (!res) return stepCard(6, 'checks', 'Checks', S.status.checks, line, waitBody());
    if (!S.checks.length) return stepCard(6, 'checks', 'Checks', 'optional', line, UI.empty('None of the workbook\'s formula columns were found, so there is nothing to compare.'));
    const ok = S.checks.filter((c) => c.status === 'ok').length;
    const figs = h('div', { class: 'dp-check-sum' },
      h('span', {}, UI.badge(String(ok), 'ok'), ' reproduce the workbook'),
      h('span', {}, UI.badge(String(S.differs.length), S.differs.length ? 'warn' : 'muted'), ' differ'),
      h('span', {}, UI.badge(String(S.skipped.length), 'muted'), ' skipped because the workbook\'s formulas returned errors'));
    const list = h('ul', { class: 'dp-step-list' }, S.checks.map((c) => {
      const i = c.label.indexOf(' = '), name = i > 0 ? c.label.slice(0, i) : c.label, st = STATUS[c.status] || [c.status, 'muted'];
      return h('li', {}, UI.badge(st[0], st[1]), ' ', name, h('span', { class: 'muted' }, c.status === 'skipped' ? ` (${F.int(c.failed || 0)} formula errors in the workbook)` : ` (${F.int(c.matched)} of ${F.int(c.total)} cells)`));
    }));
    return stepCard(6, 'checks', 'Checks', S.status.checks, line, h('div', {}, figs, list,
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
      class: 'dp-sheet' + (loaded ? '' : ' dp-optional'), title: name, subtitle: 'optional: names, groups, views, look-through',
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
        h('button', { class: 'btn btn-sm', disabled: !anyLoaded, onClick: () => downloadWorkbook(store.state.sheets, `Scope-input-sheets-${today()}.xlsx`) }, ic('download'), 'Download current sheets (.xlsx)'),
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
        h('li', {}, h('b', {}, 'Settings travel with the workbook. '), `An optional fifth sheet, ${settingsName()}, holds display names, groups, weights, views and look-through. Download it pre-filled on the `, h('a', { href: Scope.href('data', 'setup') }, 'Setup'), ' tab, fill it in Excel and keep it in the workbook.'),
        h('li', {}, h('b', {}, 'Check the result. '), 'The Checks tab compares the workbook\'s own formula columns with this calculation; the Issues tab lists anything that could not be read.'),
        h('li', {}, h('b', {}, 'Nothing leaves the browser. '), 'Files are read on this computer and kept in this browser only, until you reset to the demo.')),
      h('div', { class: 'dp-need-title' }, 'What each sheet must contain'),
      h('dl', { class: 'dl dp-need' }, SHEETS.map((n) => [h('dt', {}, n), h('dd', {}, SHEET_INFO[n].need)]),
        h('dt', {}, `${settingsName()} (optional)`), h('dd', {}, 'Five small tables side by side, titles in row 2 and headers in row 3: Investors, Views, Look Through, FX Exception and Settings. Download it pre-filled on the Setup tab.'))) });
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
        h('td', {}, t.foundBy === 'title' ? UI.badge('title', 'ok', 'found by its title') : UI.badge('default column', 'warn', 'title not found: read at the workbook\'s usual column')),
        h('td', { class: 'mono' }, t.titleCell || '–'),
        h('td', { class: 'num' }, t.headerRow ? String(t.headerRow) : '–'),
        h('td', {}, cols.length ? h('div', { class: 'dp-cols-list' }, cols.map(([k, l]) => h('span', {}, h('span', { class: 'dp-letter' }, l), ' ', COL_LABEL[k] || k))) : UI.badge('no headers found', 'error')),
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
    el.appendChild(h('div', { class: 'notice info dp-bar' }, h('div', {}, h('b', {}, 'Easier on the Setup tab: '), 'rename investors, set groups and weights in one table, and enter look-through as a grid of investors against funds.'),
      h('div', { class: 'dp-row-actions' }, h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'investors') }, ic('users'), 'Investors'), h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'lookthrough') }, ic('grid'), 'Look-through'))));
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
    el.appendChild(UI.section({ title: 'Investors', subtitle: `investor columns from the Funding Name table. The weight is the share attributed to the ${attr} (1 = group entity, 0 = third party, 0.35 = a fund 35% held by the group); it drives the group-weights views and the ${attr} / third-party split`,
      body: inv.length ? UI.table({ rows: inv, compact: true, filter: false, pageSize: 500, columns: [
        { key: 'id', label: 'Holdings ID', class: 'mono' },
        { key: 'label', label: 'Investor column', class: 'strong', render: (r) => h('span', { title: origOf(r) !== r.label ? `workbook name: ${origOf(r)}` : null }, r.label) },
        { key: 'fundName', label: 'Fund name' },
        { key: 'group', label: 'Group', render: (r) => h('select', { class: 'input dp-select', 'aria-label': `Group of ${r.label}`, onChange: (e) => setInvestor(r, e.target.value, r.weight) },
          U.uniq(GROUPS.concat([r.group])).map((g) => h('option', { value: g, selected: g === r.group }, g))) },
        { key: 'weight', label: 'Weight', align: 'right', render: (r) => h('input', { type: 'text', inputmode: 'decimal', class: 'input dp-num', value: fmtW(r.weight), 'aria-label': `Weight of ${r.label}`, title: '1, 0.35 or 35%',
          onChange: (e) => {
            const w = parseShare(e.target.value);
            if (!isFinite(w) || w < 0 || w > 1) { UI.toast('Enter a weight between 0 and 1: 1, 0.35 or 35%', 'warn'); e.target.value = fmtW(r.weight); return; }
            setInvestor(r, r.group, w);
          } }) },
        { key: 'source', label: 'Source', render: (r) => h('div', { class: 'dp-row-actions dp-left' }, sourceBadge(r.source),
          r.source === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Undo the change made here', onClick: () => resetInvestor(r, false) }, ic('refresh-cw'), 'Reset') : null) },
      ] }) : UI.empty('No investor columns: the Funding Name table is empty') }));
    el.appendChild(fundHoldersSection(D, attr));
    el.appendChild(fxSection(D));
  }

  /**
   * Fund unit holders (the look-through register): for each fund investor column, who holds its units and what share.
   * The remainder is held outside the platform. Group-entity holders' shares should equal the fund's attribution weight.
   */
  function fundHoldersSection(D, attr) {
    const inv = D.investors || [], M = ltModel(D);
    const rows = M.funds.map((f) => ({ fund: f.label, f, holders: Array.from(f.shares), listed: f.listed, external: 1 - f.listed, groupHeld: f.groupHeld, weight: f.weight, consistent: f.consistent, source: f.source }));
    /** Share as a one-decimal percentage. */
    const pctx = (v) => (U.isNum(v) ? F.pct(v, 1) : '–');
    return UI.section({ title: 'Fund unit holders (look-through)', subtitle: `who holds the units of each fund investor column, as a share of the fund; the rest is held outside the platform. ${attr}-entity holders' shares should add up to the fund's weight. Drives the investor pages' look-through and the investor book's ultimate holders`,
      actions: [h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'lookthrough') }, ic('grid'), 'Edit as a grid')],
      body: rows.length ? UI.table({ rows, compact: true, filter: false, pageSize: 200, columns: [
        { key: 'fund', label: 'Fund column', class: 'strong' },
        { key: 'holders', label: 'Unit holders', class: 'wrap', render: (r) => h('span', {}, r.holders.length ? r.holders.map(([hl, sh]) => `${hl} ${pctx(+sh)}`).join(' · ') : h('span', { class: 'muted' }, 'none listed: shown directly only')) },
        { key: 'listed', label: 'Listed', align: 'right', format: pctx },
        { key: 'external', label: 'Outside the platform', align: 'right', format: (v, r) => (r.holders.length ? pctx(v) : '–') },
        { key: 'groupHeld', label: `${attr} share vs weight`, align: 'right', render: (r) => h('span', {}, r.holders.length ? `${pctx(r.groupHeld)} / ${pctx(r.weight)} ` : '–', r.holders.length ? UI.badge(r.consistent ? 'OK' : 'Differs', r.consistent ? 'ok' : 'warn', r.consistent ? 'matches the attribution weight' : `the ${attr}-entity holders' shares differ from this fund's weight`) : null) },
        { key: 'source', label: 'Source', render: (r) => h('div', { class: 'dp-row-actions dp-left' }, fundSourceCell(r.f),
          h('button', { class: 'btn btn-sm', onClick: () => editFundHolders(r.f, inv) }, ic('edit-2'), 'Edit')) },
      ] }) : UI.empty('No fund investor columns. Set an investor\'s group to "Fund" above to list its unit holders.') });
  }

  /** Edit one fund's unit holders (f from ltModel): a row per holder (investor column) with its share of the fund's units. */
  function editFundHolders(f, inv) {
    const labels = inv.map((i) => i.label).filter((l) => l !== f.label);
    const keyOf = new Map(inv.map((i) => [i.label, origOf(i)])); // saved by workbook name, so later renames keep working
    const list = h('div', { class: 'dp-holders' });
    const total = h('p', { class: 'small' });
    /** Recompute the listed share and the remainder shown under the rows. */
    const refresh = () => {
      let t = 0; for (const row of list.querySelectorAll('.dp-holder')) { const v = parseShare(row.querySelector('input').value); if (isFinite(v)) t += v; }
      total.textContent = `Listed ${F.pct(t, 1)} · held outside the platform ${F.pct(1 - t, 1)}${t > 1 + 1e-9 ? ' · more than 100%: check the shares' : ''}`;
    };
    /** One editable holder row. */
    const addRow = (holder, share) => {
      const sel = h('select', { class: 'input dp-select', 'aria-label': 'Holder' }, U.uniq(labels.concat(holder ? [holder] : [])).map((l) => h('option', { value: l, selected: l === holder }, l)));
      const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'input dp-num', value: share === undefined ? '' : fmtShare(share), 'aria-label': 'Share of the fund', onInput: refresh });
      const row = h('div', { class: 'dp-holder dp-field-row' }, sel, inp, h('span', { class: 'small muted' }, 'share: 15%, 15 or 0.15'),
        h('button', { class: 'btn btn-sm btn-ghost', 'aria-label': 'Remove holder', onClick: () => { row.remove(); refresh(); } }, ic('x')));
      list.appendChild(row);
    };
    const holders = Array.from(f.shares);
    (holders.length ? holders : [[labels[0], '']]).forEach(([hl, sh]) => addRow(hl, sh === '' ? undefined : +sh));
    refresh();
    const m = UI.modal({ title: `Unit holders of ${f.label}`, body: h('div', {},
      h('p', { class: 'small muted' }, `Each row is an investor column holding units of this fund, with its share of the fund. Whatever is not listed is held outside the platform. Changes are saved in this browser; download the ${settingsName()} sheet on the Setup tab to keep them.`),
      list, h('button', { class: 'btn btn-sm', onClick: () => { addRow(labels[0], undefined); refresh(); } }, ic('plus'), 'Add holder'), total),
      actions: [
        h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onClick: () => {
          const out = [];
          for (const row of list.querySelectorAll('.dp-holder')) {
            const hl = row.querySelector('select').value, s = row.querySelector('input').value.trim(), v = s === '' ? 0 : parseShare(s);
            if (!hl) continue;
            if (!isFinite(v) || v < 0 || v > 1) { UI.toast(`Enter a share between 0 and 100% for ${hl}`, 'warn'); return; }
            if (v > 0) out.push([keyOf.get(hl) || hl, v]);
          }
          m.close();
          writeOverrides((ov) => { ov.fundHolders = ov.fundHolders || {}; dropAliases(ov.fundHolders, f.names); ov.fundHolders[f.key] = out; });
          UI.toast(`${f.label}: ${plural(out.length, 'unit holder')} saved`);
        } }, 'Save')] });
  }

  /** Save an investor's group and attribution weight, keyed by its workbook name (replacing any key by display name). */
  function setInvestor(r, group, weight) {
    const orig = origOf(r);
    writeOverrides((ov) => { ov.investors = ov.investors || {}; dropAliases(ov.investors, [orig, r.label]); ov.investors[orig] = [group, +weight]; });
    UI.toast(`${r.label}: ${group}, weight ${fmtW(weight)}`);
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
      exc.length ? h('div', { class: 'dp-sub' }, h('h3', {}, 'FX exception'), UI.table({ rows: exc, compact: true, filter: false, columns: [
        { key: 'investor', label: 'Investor' }, { key: 'currency', label: 'Currency' }, { key: 'view', label: 'View', format: (v) => v || 'every view' },
        { key: 'rate', label: 'Rate', align: 'right', format: fmtRate }, { key: 'note', label: 'Note', class: 'wrap' }] })) : null) });
  }

  /** Banner for the override tabs: changes apply at once in this browser; keep them in the settings sheet, export or clear them. */
  function overridesBar() {
    const ov = overrides(), n = countOverrides();
    const parts = [['roles', 'column'], ['names', 'display name'], ['views', 'view'], ['investors', 'investor'], ['fundHolders', 'fund register']].map(([k, w]) => { const c = Object.keys(ov[k] || {}).length; return c ? plural(c, w) : null; }).filter(Boolean);
    if (ov.fxQuote) parts.push('FX quote');
    return h('div', { class: 'notice info dp-bar' },
      h('div', {}, h('b', {}, 'Changes here apply at once and are saved in this browser only. '), n ? `In force: ${parts.join(', ')}. ` : 'No overrides in force. ', `Download the ${settingsName()} sheet to keep them with the workbook.`),
      h('div', { class: 'dp-row-actions' },
        h('button', { class: 'btn btn-sm btn-primary', onClick: () => downloadSettings('xlsx') }, ic('download'), `Download ${settingsName()} sheet`),
        h('button', { class: 'btn btn-sm', title: 'The overrides as a snippet for §1 of the calculation file', onClick: exportSettings }, ic('file-text'), 'Export settings'),
        n ? h('button', { class: 'btn btn-sm btn-danger', onClick: clearOverrides }, ic('x'), 'Clear all overrides') : null));
  }

  /** Remove every override (columns, display names, views, investors, look-through, FX quote) after confirmation. */
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
    block('fundHolders', C.fundHolders, ov.fundHolders);
    const names = Object.entries(ov.names || {});
    if (names.length) {
      out.push('');
      out.push(`// Display names. CONFIG has no entry for these: keep them in the ${settingsName()} sheet (Investors, Display Name).`);
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
  // Checks
  // =====================================================================================================================
  /** Checks tab: each of the workbook's formula columns recomputed by the calculation file, with the differing cells. */
  function checksTab(el, res) {
    if (!res) { el.appendChild(noData()); return; }
    const checks = diag(res).checks || [];
    el.appendChild(h('div', { class: 'notice info' }, h('b', {}, 'Reconciliation with the workbook. '),
      'These compare the workbook\'s own formula columns (Holdings B to F and row 2, Hardcoded D and E) with the same values worked out by the calculation file, js/calc/aum.js. 100% means the web calculation reproduces the workbook. Blank workbook cells are not compared; up to 25 differing cells are listed per check.'));
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
    if (state.issueSheet !== 'all' && !sheets.includes(state.issueSheet)) state.issueSheet = 'all';
    const bySheet = all.filter((i) => state.issueSheet === 'all' || i.table === state.issueSheet);
    const rows = bySheet.filter((i) => state.sev === 'all' || i.severity === state.sev);
    const cnt = (sv) => bySheet.filter((i) => i.severity === sv).length; // issues of one severity on the chosen sheet
    const sevChips = h('div', { class: 'chips' }, ['all', 'error', 'warn', 'info'].map((sv) => UI.chip(sv === 'all' ? `All (${bySheet.length})` : `${SEV[sv]} (${cnt(sv)})`, state.sev === sv, () => { state.sev = sv; Scope.app.render(true); })));
    const sheetChips = h('div', { class: 'chips' }, ['all'].concat(sheets).map((s) => UI.chip(s === 'all' ? 'All sheets' : `${s} (${all.filter((i) => i.table === s).length})`, state.issueSheet === s, () => { state.issueSheet = s; Scope.app.render(true); })));
    el.appendChild(UI.section({ title: 'Data issues', subtitle: 'errors leave a position out of AUM, warnings keep it but flag it, info is context; nothing is silently set to zero',
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
        h('a', { href: Scope.href('data', 'setup') }, 'Setup'), ' and ', h('a', { href: Scope.href('data', 'views') }, 'Views & investors'), ' tabs (names, groups, weights, views, look-through, FX quote) and the ', h('a', { href: Scope.href('data', 'columns') }, 'Columns'), ' tab (which column each role reads) override both, in this browser.'),
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
  const TAB_RENDER = { setup: setupTab, inputs: inputsTab, columns: columnsTab, mapping: mappingTab, views: viewsTab, checks: checksTab, issues: issuesTab, corrections: correctionsTab, settings: settingsTab };
})(window);
