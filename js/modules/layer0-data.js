/* Module: Layer 0 · Data & validation — the four AUM input sheets, how the calculation read them, and every check,
 * issue and correction.
 *
 * Registers the 'data' page (route #/data/<tab>, sidebar Layer 0). It works without a result (needsData: false)
 * because this is where the inputs are loaded. The AUM inputs are exactly four sheets of the workbook: Holdings,
 * Mapping, Hardcoded and ESG Hardcoded. They arrive by dropping the workbook (or one CSV per sheet) or by pasting a
 * range copied from Excel; Scope.inputs (js/inputs/workbook.js) turns them into cell grids and Scope.store keeps them.
 * The calculation (js/calc/aum.js) finds columns by header name and reports how everything resolved in
 * result.inputs. The tabs show that report:
 *   Inputs             drop zone, one card per sheet (status, source, size, header row, paste, CSV), how it works
 *   Columns            the column each calculation role reads, with a per-browser choice; every column of the sheet
 *   Mapping            the six Mapping tables: where each was found, with a preview of its first rows
 *   Views & investors  view compositions, investor groups and weights, FX quote; export as a CONFIG snippet
 *   Checks             the workbook's own formula columns reproduced by the calculation, cell by cell
 *   Issues             every data issue, by severity and sheet, with links to asset pages
 *   Corrections        the manual-correction audit trail, with revert
 *   Settings           CONFIG (§1 of the calculation file), read-only
 * Overrides (columns, views, investors, FX quote) are saved in this browser (settings.calcOverrides) and apply at
 * once; nothing is sent anywhere. Calls into Scope.inputs are guarded, so the page still renders without it.
 * Page styles: css/data.css (dp- classes).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, store = Scope.store;
  const SHEETS = ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'];
  const KEYED = ['Holdings', 'Hardcoded', 'ESG Hardcoded']; // sheets with a header row and column roles
  const TABS = [['inputs', 'Inputs'], ['columns', 'Columns'], ['mapping', 'Mapping'], ['views', 'Views & investors'], ['checks', 'Checks'], ['issues', 'Issues'], ['corrections', 'Corrections'], ['settings', 'Settings']];
  const ALIASES = { overview: 'inputs', adjustments: 'corrections', config: 'settings' }; // earlier tab names keep working
  const GROUPS = ['Group entity', 'Fund', 'Third party', 'Unclassified'];
  const SEV = { error: 'error', warn: 'warning', info: 'info' };
  const STATUS = { ok: ['reproduced', 'ok'], warn: ['minor differences', 'warn'], error: ['differs', 'error'] };
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
  const state = { sev: 'all', issueSheet: 'all', open: new Set(), lastLoad: null, tab: null };

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

  /** Number of overrides saved in this browser (columns, views, investors, FX quote). */
  function countOverrides() {
    const ov = overrides();
    return ['roles', 'views', 'investors'].reduce((n, k) => n + Object.keys(ov[k] || {}).length, 0) + (ov.fxQuote ? 1 : 0);
  }

  /** Sheets still holding the synthetic demo that a load of `supplied` would leave in place. */
  const demoSheetsKept = (supplied) => SHEETS.filter((n) => !supplied.includes(n) && store.sheet(n) && (store.state.sources[n] || {}).kind === 'demo');
  /** Warning that some sheets are still the synthetic demo (empty string when none). */
  function demoWarning(kept) {
    if (!kept.length) return '';
    const one = kept.length === 1;
    return `${kept.join(', ')} ${one ? 'is' : 'are'} still the synthetic demo ${one ? 'sheet' : 'sheets'}: load ${one ? 'it' : 'them'} too, or use Clear all sheets to start from blank.`;
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
    const checksOff = (D.checks || []).filter((c) => c.status !== 'ok').length;
    const nIssues = res && res.issues ? res.issues.length : 0, nAdj = store.activeAdjustments().length;
    const badge = {
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
    /** Page head, tab bar and the active tab (unknown tabs fall back to Inputs). */
    render(el, ctx) {
      const res = ctx.result;
      let tab = ALIASES[ctx.params[0]] || ctx.params[0];
      if (!TABS.some((t) => t[0] === tab)) tab = 'inputs';
      el.appendChild(Scope.app.pageHead({ title: 'Data & validation', sub: 'Layer 0: the four input sheets, how the calculation read them, and every check, issue and correction' }));
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
    el.appendChild(h('div', { class: 'dp-sheets' }, SHEETS.map((n) => sheetCard(n, res, D))));
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

  /** Drop zone and file picker for the workbook or per-sheet CSVs, with the reset, clear and download actions. */
  function loadSection() {
    const demo = global.SCOPE_DEMO;
    const title = h('div', { class: 'dp-drop-title' }, 'Drop the AUM workbook here');
    const picker = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xlsm,.csv,.tsv,.txt', class: 'hidden',
      onChange: (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; loadFiles(files, ui); } });
    const drop = h('div', {
      class: 'dp-drop',
      onDragOver: (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; drop.classList.add('over'); },
      onDragLeave: (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); },
      onDrop: (e) => { e.preventDefault(); drop.classList.remove('over'); loadFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []), ui); },
    },
    h('div', { class: 'dp-drop-icon' }, ic('upload', 30)), title,
    h('div', { class: 'dp-drop-sub' }, 'The .xlsx or .xlsm workbook with its four sheets, or one CSV per sheet named after it (Holdings.csv, Mapping.csv, Hardcoded.csv, ESG Hardcoded.csv). Other tabs are ignored.'),
    h('div', { class: 'dp-drop-actions' }, h('button', { class: 'btn btn-primary', onClick: () => picker.click() }, ic('folder'), 'Choose files'), picker));
    // Busy state while a large workbook is read; the page re-renders once the sheets are loaded.
    const ui = {
      busy: (text) => { drop.classList.add('busy'); title.textContent = text; },
      idle: () => { drop.classList.remove('busy'); title.textContent = 'Drop the AUM workbook here'; },
    };
    const anyLoaded = SHEETS.some((n) => store.sheet(n));
    return UI.section({
      title: 'Load the input sheets', subtitle: 'Holdings, Mapping, Hardcoded and ESG Hardcoded from the AUM workbook',
      actions: [
        h('button', { class: 'btn btn-sm', title: 'Forget the loaded sheets and use the synthetic demo workbook', onClick: () => { state.lastLoad = null; Scope.app.resetToDemo(); } }, ic('refresh-cw'), 'Reset to demo'),
        anyLoaded ? h('button', { class: 'btn btn-sm btn-danger', title: 'Remove every sheet, to build up a workbook sheet by sheet', onClick: clearSheets }, ic('x'), 'Clear all sheets') : null,
      ],
      body: h('div', {}, drop, h('div', { class: 'dp-downloads' },
        h('button', { class: 'btn btn-sm', disabled: !(demo && demo.sheets), onClick: () => downloadWorkbook(demo.sheets, 'Scope-demo-workbook.xlsx') }, ic('download'), 'Download demo workbook (.xlsx)'),
        h('button', { class: 'btn btn-sm', disabled: !anyLoaded, onClick: () => downloadWorkbook(store.state.sheets, `Scope-input-sheets-${today()}.xlsx`) }, ic('download'), 'Download current sheets (.xlsx)'),
        h('span', { class: 'small muted' }, 'The demo workbook shows the expected layout of all four sheets (synthetic data).'))),
    });
  }

  /**
   * Read dropped or chosen files (a workbook, or CSVs named after their sheets) and load the sheets found. Sheets not
   * supplied are kept, so CSVs can arrive one at a time; the summary and any reader warnings stay on the tab.
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
    const found = SHEETS.filter((n) => out && out.sheets && out.sheets[n]);
    const warnings = ((out && out.warnings) || []).slice();
    if (!found.length) {
      ui.idle();
      state.lastLoad = { at: new Date().toISOString(), from: `from ${from}`, sheets: [], warnings: warnings.length ? warnings : ['No sheet called Holdings, Mapping, Hardcoded or ESG Hardcoded was found.'] };
      Scope.app.render(true);
      UI.toast(`No input sheet found in ${from}`, 'warn');
      return;
    }
    const kept = demoWarning(demoSheetsKept(found));
    if (kept) warnings.push(kept);
    const used = U.uniq(found.map((n) => (out.sources && out.sources[n] && out.sources[n].file) || '').filter(Boolean)); // the files that supplied sheets
    const usedText = used.length ? used.join(', ') : from;
    state.lastLoad = { at: new Date().toISOString(), from: `from ${usedText}`, sheets: found, warnings };
    store.setSheets(out.sheets, out.sources, { merge: true });
    summaryToast(found, usedText, warnings.length);
  }

  /** Toast summarising a load: sheets read, positions valued, and the errors and warnings the calculation raised. */
  function summaryToast(sheets, from, nNotes) {
    let r = null;
    try { r = Scope.app && Scope.app.safeResult ? Scope.app.safeResult() : store.result(); } catch (e) { r = null; }
    const parts = [`${sheets.join(', ')} loaded from ${from}`];
    if (r && r.stats) parts.push(`${F.int(r.stats.included)} positions valued`, `${plural(r.issueCounts.error || 0, 'error')}, ${plural(r.issueCounts.warn || 0, 'warning')}`);
    if (nNotes) parts.push(plural(nNotes, 'note') + ' on the Inputs tab');
    UI.toast(parts.join(' · '), nNotes || (r && r.issueCounts && r.issueCounts.error) ? 'warn' : '');
  }

  /** Remove every loaded sheet (after confirmation), so a workbook can be built up sheet by sheet. */
  function clearSheets() {
    if (!global.confirm('Remove all four sheets from this browser? The demo stays available through Reset to demo.')) return;
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
      const kept = demoWarning(demoSheetsKept([name]));
      state.lastLoad = { at: new Date().toISOString(), from: `(pasted at ${start})`, sheets: [name], warnings: kept ? [kept] : [] };
      m.close();
      store.setSheets({ [name]: { name, rows: grid.rows } }, { [name]: { kind: 'paste', origin: start } }, { merge: true });
      UI.toast(`${name} pasted: ${F.int(size.rows)} rows × ${F.int(size.cols)} columns`, kept ? 'warn' : '');
    };
    const m = UI.modal({
      title: `Paste ${name}`, wide: true,
      body: h('div', {},
        h('p', { class: 'small' }, `In Excel, open the ${name} sheet, select every cell (Ctrl+A, or the corner button above row 1), copy, then paste below. Headers are found by name; the start cell keeps cell references such as ${name}!B4 identical to the workbook.`),
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

  /** Download sheets ({ name: grid }) as one .xlsx workbook, tabs in the canonical order. */
  function downloadWorkbook(sheets, filename) {
    const write = IN('writeXlsx'), save = IN('downloadBytes');
    if (!write || !save) { UI.toast('The workbook writer is not available in this copy of Scope', 'warn'); return; }
    const ordered = {};
    for (const n of SHEETS) if (sheets && sheets[n] && sheets[n].rows) ordered[n] = { name: n, rows: sheets[n].rows };
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
        h('li', {}, h('b', {}, 'Check the result. '), 'The Checks tab compares the workbook\'s own formula columns with this calculation; the Issues tab lists anything that could not be read.'),
        h('li', {}, h('b', {}, 'Nothing leaves the browser. '), 'Files are read on this computer and kept in this browser only, until you reset to the demo.')),
      h('div', { class: 'dp-need-title' }, 'What each sheet must contain'),
      h('dl', { class: 'dl dp-need' }, SHEETS.map((n) => [h('dt', {}, n), h('dd', {}, SHEET_INFO[n].need)]))) });
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
      ['Workbook checks', checks.length ? h('a', { href: Scope.href('data', 'checks') }, `${checks.filter((c) => c.status === 'ok').length} of ${checks.length} reproduce the workbook`) : 'no formula columns to compare'],
      ['Overrides', nOv ? h('a', { href: Scope.href('data', 'views') }, `${nOv} saved in this browser`) : 'none'],
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
  /** A view's definition: the override saved here, else CONFIG.views, else undefined (investor-column views). */
  function viewDef(name) {
    const ov = overrides().views || {};
    return ov[name] !== undefined ? ov[name] : (cfg().views || {})[name];
  }
  /** A view's composition as text: "all investors", "group weights" or "Investor 1 × 1 + Investor 7 × 0.35". */
  function compositionText(v) {
    const def = viewDef(v.view);
    if (def === '*') return 'all investors';
    if (def === 'group') return 'group weights';
    const parts = (v.composition || []).map((c) => (c.label === '*' ? 'all investors' : `${c.label} × ${fmtW(c.weight)}`));
    return parts.length ? parts.join(' + ') : 'nothing (not defined)';
  }
  /** Badge for how a view is defined. */
  function kindBadge(kind) {
    if (kind === 'settings') return UI.badge('settings', 'muted', 'CONFIG.views in the calculation file');
    if (kind === 'override') return UI.badge('changed here', 'manual', 'saved in this browser');
    if (kind === 'investor column') return UI.badge('investor column', 'info', 'the view name is an investor column');
    return UI.badge('not defined', 'error', 'shows nothing until defined');
  }
  /** Badge for where an investor's group and weight come from. */
  function sourceBadge(source) {
    if (source === 'override') return UI.badge('changed here', 'manual', 'saved in this browser');
    if (source === 'settings') return UI.badge('settings', 'muted', 'CONFIG.investors in the calculation file');
    return UI.badge('not set', 'warn', 'not in the settings: treated as Unclassified, weight 0');
  }

  /** Views & investors tab: override banner, views, investors and FX. */
  function viewsTab(el, res) {
    if (!res) { el.appendChild(noData()); return; }
    const D = diag(res), attr = cfg().attributionLabel || 'Group';
    el.appendChild(overridesBar());
    const views = (D.views || []).map((v) => {
      const def = viewDef(v.view);
      const expanded = def === 'group' ? (v.composition || []).map((c) => `${c.label} × ${fmtW(c.weight)}`).join(' + ') : '';
      return { view: v.view, kind: v.kind, text: compositionText(v), expanded, v };
    });
    el.appendChild(UI.section({ title: 'Views', subtitle: 'the view choices listed in Mapping column H (the Output!G8 selector): which investor columns count, and with what weight',
      body: views.length ? UI.table({ rows: views, compact: true, filter: false, pageSize: 500, columns: [
        { key: 'view', label: 'View', class: 'strong' },
        { key: 'kind', label: 'Defined by', render: (r) => kindBadge(r.kind) },
        { key: 'text', label: 'Composition', class: 'wrap', render: (r) => h('span', { title: r.expanded || null }, r.text, r.expanded ? h('span', { class: 'small muted' }, ` (${r.expanded})`) : null) },
        { key: '_actions', label: '', render: (r) => h('div', { class: 'dp-row-actions' },
          h('button', { class: 'btn btn-sm', onClick: () => editView(r.v, D) }, ic('edit-2'), 'Edit'),
          r.kind === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Back to the definition in the settings', onClick: () => { store.setOverride('views', r.view, null); UI.toast(`${r.view}: back to the settings`); } }, ic('refresh-cw'), 'Reset to settings') : null) },
      ] }) : UI.empty('No views: Mapping column H is empty') }));
    const inv = D.investors || [];
    el.appendChild(UI.section({ title: 'Investors', subtitle: `investor columns from the Funding Name table. The weight is the share attributed to the ${attr} (1 = group entity, 0 = third party, 0.35 = a fund 35% held by the group); it drives the group-weights views and the ${attr} / third-party split`,
      body: inv.length ? UI.table({ rows: inv, compact: true, filter: false, pageSize: 500, columns: [
        { key: 'id', label: 'Holdings ID', class: 'mono' },
        { key: 'label', label: 'Investor column', class: 'strong' },
        { key: 'fundName', label: 'Fund name' },
        { key: 'group', label: 'Group', render: (r) => h('select', { class: 'input dp-select', 'aria-label': `Group of ${r.label}`, onChange: (e) => setInvestor(r, e.target.value, r.weight) },
          U.uniq(GROUPS.concat([r.group])).map((g) => h('option', { value: g, selected: g === r.group }, g))) },
        { key: 'weight', label: 'Weight', align: 'right', render: (r) => h('input', { type: 'number', step: '0.01', min: '0', class: 'input dp-num', value: fmtW(r.weight), 'aria-label': `Weight of ${r.label}`,
          onChange: (e) => {
            const s = String(e.target.value).trim(), w = Number(s.replace(',', '.'));
            if (!s || !isFinite(w)) { UI.toast('Enter a number, such as 1, 0 or 0.35', 'warn'); e.target.value = fmtW(r.weight); return; }
            setInvestor(r, r.group, w);
          } }) },
        { key: 'source', label: 'Source', render: (r) => h('div', { class: 'dp-row-actions dp-left' }, sourceBadge(r.source),
          r.source === 'override' ? h('button', { class: 'btn btn-sm btn-ghost', title: 'Back to the settings', onClick: () => { store.setOverride('investors', r.label, null); UI.toast(`${r.label}: back to the settings`); } }, ic('refresh-cw'), 'Reset') : null) },
      ] }) : UI.empty('No investor columns: the Funding Name table is empty') }));
    el.appendChild(fxSection(D));
  }

  /** Save an investor's group and weight; matching the settings again removes the override. */
  function setInvestor(r, group, weight) {
    const c = (cfg().investors || {})[r.label];
    const same = c && c[0] === group && +c[1] === +weight;
    store.setOverride('investors', r.label, same ? null : [group, weight]);
    UI.toast(`${r.label}: ${group}, weight ${fmtW(weight)}`);
  }

  /** Edit one view: all investors, group weights, or a custom list of investor columns with weights. */
  function editView(v, D) {
    const def = viewDef(v.view), invs = (D.investors || []).map((i) => i.label);
    let mode = def === '*' ? 'all' : def === 'group' ? 'group' : 'custom';
    const eff = new Map(); // the current effective weights, to start the custom list from
    if (def === '*') invs.forEach((l) => eff.set(l, 1));
    else (v.composition || []).forEach((c) => { if (c.label !== '*') eff.set(c.label, c.weight); });
    const labels = invs.concat(Array.from(eff.keys()).filter((l) => !invs.includes(l)));
    const inputs = new Map();
    const list = h('div', { class: 'dp-custom compact' },
      h('p', { class: 'small muted' }, 'Weight per investor column: 1 counts all of it, 0.35 counts 35%. Leave a weight empty to leave the column out.'),
      h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Investor column'), h('th', {}, 'Group'), h('th', { class: 'num' }, 'Weight'))),
        h('tbody', {}, labels.map((l) => {
          const meta = (D.investors || []).find((i) => i.label === l);
          const inp = h('input', { type: 'number', step: '0.01', min: '0', class: 'input dp-num', value: eff.has(l) ? fmtW(eff.get(l)) : null, 'aria-label': `Weight of ${l}` });
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
          const w = Number(s.replace(',', '.'));
          if (!isFinite(w)) { UI.toast(`The weight of ${l} is not a number`, 'warn'); inp.focus(); return; }
          if (w !== 0) value.push([l, w]);
        }
        if (!value.length) { UI.toast('Enter a weight for at least one investor column', 'warn'); return; }
      }
      m.close();
      store.setOverride('views', v.view, value);
      UI.toast(`${v.view} updated (saved in this browser)`);
    };
    const m = UI.modal({ title: `Edit view: ${v.view}`, wide: true, body: h('div', {}, h('div', { class: 'dp-modes' }, radios), list),
      actions: [
        v.kind === 'override' ? h('button', { class: 'btn', onClick: () => { m.close(); store.setOverride('views', v.view, null); UI.toast(`${v.view}: back to the settings`); } }, ic('refresh-cw'), 'Reset to settings') : null,
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
    const exc = C.fxOverrides || [];
    return UI.section({ title: 'FX', subtitle: 'Holdings carries a rate on every row; each amount is divided (or multiplied) by it to reach EUR', body: h('div', {},
      h('div', { class: 'dp-field-row' }, h('label', { class: 'strong' }, 'Quote'), sel, ov.fxQuote ? UI.badge('changed here', 'manual') : null),
      h('p', { class: 'small' }, test, ' In use: ', h('b', {}, QUOTE_SHORT[fx.quote] || fx.quote || '–'), '.'),
      rates.length ? UI.table({ rows: rates, compact: true, filter: false, columns: [
        { key: 'currency', label: 'Currency', class: 'strong' },
        { key: 'rate', label: 'Rate in Holdings (most frequent)', align: 'right', format: fmtRate },
        { key: 'perEur', label: 'Units per EUR', align: 'right', format: fmtRate },
        { key: 'eurPer', label: 'EUR per unit', align: 'right', format: fmtRate }] }) : UI.empty('No FX rates found in Holdings'),
      exc.length ? h('div', { class: 'dp-sub' }, h('h3', {}, 'FX exception (settings)'), UI.table({ rows: exc, compact: true, filter: false, columns: [
        { key: 'investor', label: 'Investor' }, { key: 'currency', label: 'Currency' }, { key: 'view', label: 'View', format: (v) => v || 'every view' },
        { key: 'rate', label: 'Rate', align: 'right', format: fmtRate }, { key: 'note', label: 'Note', class: 'wrap' }] })) : null) });
  }

  /** Banner for the override tabs: changes apply at once in this browser; export them as a CONFIG snippet or clear them. */
  function overridesBar() {
    const ov = overrides(), n = countOverrides();
    const parts = [['roles', 'column'], ['views', 'view'], ['investors', 'investor']].map(([k, w]) => { const c = Object.keys(ov[k] || {}).length; return c ? plural(c, w) : null; }).filter(Boolean);
    if (ov.fxQuote) parts.push('FX quote');
    return h('div', { class: 'notice info dp-bar' },
      h('div', {}, h('b', {}, 'Changes here apply at once and are saved in this browser only. '), n ? `In force: ${parts.join(', ')}. ` : 'No overrides in force. ', 'Export settings to make them permanent in the calculation file.'),
      h('div', { class: 'dp-row-actions' },
        h('button', { class: 'btn btn-sm btn-primary', onClick: exportSettings }, ic('download'), 'Export settings'),
        n ? h('button', { class: 'btn btn-sm btn-danger', onClick: clearOverrides }, ic('x'), 'Clear all overrides') : null));
  }

  /** Remove every override (columns, views, investors, FX quote) after confirmation. */
  function clearOverrides() {
    if (!global.confirm('Remove every override saved in this browser? The settings in the calculation file apply again.')) return;
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
      body: h('div', {}, h('p', { class: 'small' }, 'Paste this over the matching entries of CONFIG in js/calc/aum.js (§1), then clear the overrides here. Keep the downloaded file with the workbook as the record of what changed.'), ta),
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
    const ok = checks.filter((c) => c.status === 'ok').length;
    el.appendChild(h('div', { class: 'dp-summary' }, h('b', {}, `${ok} of ${checks.length}`), ` checks reproduce the workbook exactly${ok === checks.length ? '.' : '; the others list the cells that differ.'}`));
    el.appendChild(h('div', { class: 'dp-checks' }, checks.map(checkCard)));
  }

  /** One reconciliation check: name and formula, status, matched / total with a bar, and the differing cells. */
  function checkCard(c) {
    const i = c.label.indexOf(' = '), name = i > 0 ? c.label.slice(0, i) : c.label, formula = i > 0 ? c.label.slice(i + 1).trim() : '';
    const pct = c.total ? c.matched / c.total : 0, st = STATUS[c.status] || [c.status, 'muted'];
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
      h('div', {}, h('b', {}, 'Read-only. '), 'These settings live in js/calc/aum.js, §1 (CONFIG): edit them there to change them for everyone. Per-browser overrides are set on the ',
        h('a', { href: Scope.href('data', 'views') }, 'Views & investors'), ' tab (views, investor groups and weights, FX quote) and the ', h('a', { href: Scope.href('data', 'columns') }, 'Columns'), ' tab (which column each role reads).'),
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
  const TAB_RENDER = { inputs: inputsTab, columns: columnsTab, mapping: mappingTab, views: viewsTab, checks: checksTab, issues: issuesTab, corrections: correctionsTab, settings: settingsTab };
})(window);
