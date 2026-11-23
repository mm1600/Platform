/* Scope core: the data folder (Scope.source).
 *
 * A data folder holds dated copies of the input workbook, one folder per period (Q1 2026, Q2 2026/April, …). Its periods
 * can be loaded without a file drop: the Data page loads one as the working data, and the AUM overview compares two. The
 * folder comes from one of two places:
 *
 *   - picked in the browser (Choose data folder on the Data page): works with index.html opened as a file. Edge and Chrome
 *     remember the folder, and at most ask once per session to read it again (Reconnect); other browsers read the folder
 *     when it is picked and forget it when the page closes.
 *   - named in scope.config.json, when Scope is served by tools/serve.js (start.bat): read by the server, nothing to pick.
 *     It wins over a folder picked in the browser.
 *
 * Either way a period's files are read by Scope.inputs.readFiles, exactly as dropped files are, and which folders are
 * periods is js/core/period-names.js. With no folder, nothing changes: the file drop works as before. Periods read are kept
 * for the session (until their files change).
 *
 * While Scope is open it looks at the files of the period the sheets were loaded from every 20 seconds (and when the tab
 * is shown again): when one changed in the folder, the top bar says so and offers Refresh, which loads that period again.
 * Nothing is replaced until Refresh is clicked. A folder read through a folder upload (browsers other than Edge and
 * Chrome) is a copy taken when picked, so its changes cannot be seen.
 *
 * The Holdings folder (Scope.source.holdings) is a folder of its own, picked on the Data page next to the file box for the
 * other inputs: every input file directly in it is one month's Holdings (Sep 2026.xlsx, Oct 2026.csv), newest by the date
 * its name says (by when it was saved when the names say none). Only its Holdings sheet is taken. Its months are periods
 * like the data folder's (id "h:" + the file name), so Load, Compare periods and the change notice treat them alike.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const PN = Scope.periodNames;
  let listing = null;            // the last listing: { configured, local, needsPermission, canPick, folder, name, periods: [{ id, parts, files }], error }
  const cache = new Map();       // period id → { stamp, out } (readFiles output with .period)
  let picked = null;             // a folder picked in the browser: { name, dir (a directory handle, or the same shape built from a file list), saved }
  let restored = null;           // the promise of restoring a remembered folder (once per page)
  const KEY = 'folder';
  const kv = () => (global.DriveVC && global.DriveVC.localStore ? (kv.s || (kv.s = global.DriveVC.localStore('scope-source'))) : null);

  /** Is the page served by tools/serve.js (and not opened as a file)? */
  const served = () => typeof fetch === 'function' && !(global.location && global.location.protocol === 'file:') && !!global.location;
  /**
   * Has this PC refused the folder window in this session (a work setting)? Then pickers go straight to the folder upload
   * box, which such PCs still allow: the folder is read when picked, for this session, and is not watched for changes.
   */
  const NO_PICKER = 'scope.noFolderWindow';
  const refused = () => { try { return global.sessionStorage && global.sessionStorage.getItem(NO_PICKER) === '1'; } catch (e) { return false; } };
  // only a refusal by the PC's settings counts (NotAllowedError, or no picker at all), and only until the browser is closed:
  // a blocked click (SecurityError) is tried again, and a PC whose settings change is asked again next time
  const markRefused = (e) => { if (e && (e.name === 'NotAllowedError' || e.name === 'TypeError')) { try { global.sessionStorage.setItem(NO_PICKER, '1'); } catch (x) { /* asked again next time */ } } };
  /** Can a folder be remembered (the File System Access API: Edge, Chrome; not on a PC that refuses its window)? */
  const canRemember = () => typeof global.showDirectoryPicker === 'function' && !refused();
  /** Can a folder be picked at all (the API, or a folder upload input)? */
  const canPick = () => canRemember() || (typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input'));

  /**
   * A file list from a folder upload input (each with webkitRelativePath "Quarterly data/Q2 2026/May/AUM.xlsx") as a
   * directory handle's shape: { kind, name, values(), getDirectoryHandle(name), getFileHandle(name) }, so one walker reads both.
   */
  function treeFromFiles(files) {
    const dir = (name) => ({ kind: 'directory', name, dirs: new Map(), files: new Map(),
      async *values() { yield* this.dirs.values(); yield* this.files.values(); },
      async getDirectoryHandle(n) { const d = this.dirs.get(n); if (!d) throw Object.assign(new Error(n + ' not found'), { name: 'NotFoundError' }); return d; },
      async getFileHandle(n) { const f = this.files.get(n); if (!f) throw Object.assign(new Error(n + ' not found'), { name: 'NotFoundError' }); return f; } });
    let root = null;
    for (const f of Array.from(files || [])) {
      const parts = String(f.webkitRelativePath || f.name).split('/');
      if (!root) root = dir(parts.length > 1 ? parts[0] : 'Folder');
      let d = root;
      for (const p of parts.slice(1, -1)) { if (!d.dirs.has(p)) d.dirs.set(p, dir(p)); d = d.dirs.get(p); }
      const name = parts[parts.length - 1];
      d.files.set(name, { kind: 'file', name, getFile: async () => f });
    }
    return root;
  }

  /** Every period under a directory handle, oldest first (the same rules as tools/data-folder.js listPeriods). */
  async function walk(top) {
    const out = [];
    let seen = 0;
    async function visit(d, parts) {
      if (++seen > PN.MAX_FOLDERS) return;
      const files = [], subs = [];
      for await (const e of d.values()) {
        if (!PN.usable(e.name)) continue;
        if (e.kind === 'file' && PN.EXT.test(e.name)) { try { const f = await e.getFile(); files.push({ name: e.name, size: f.size, modified: new Date(f.lastModified || 0).toISOString() }); } catch (err) { /* gone since the listing */ } }
        else if (e.kind === 'directory') subs.push(e);
      }
      if (files.length) out.push({ id: parts.join('/'), parts: parts.slice(), files: files.sort((a, b) => a.name.localeCompare(b.name)) });
      if (parts.length >= PN.MAX_DEPTH) return;
      for (const e of subs.sort((a, b) => a.name.localeCompare(b.name))) await visit(e, parts.concat(e.name));
    }
    await visit(top, []);
    return out.sort(PN.compare);
  }

  /** The bytes of one file of one period in the picked folder. */
  async function localBytes(id, name) {
    let d = picked.dir;
    for (const p of String(id || '').split('/').filter(Boolean)) d = await d.getDirectoryHandle(p);
    const f = await (await d.getFileHandle(name)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  }

  /** The remembered folder, once per page (Edge and Chrome keep the handle in IndexedDB). */
  function restore() {
    if (!restored) restored = (async () => { const s = kv(); const dir = s && canRemember() ? await s.get(KEY) : null; if (dir && !picked) picked = { name: dir.name, dir, saved: true }; })().catch(() => {});
    return restored;
  }

  /** The listing of the picked folder (needsPermission when the browser must ask again before reading it). */
  async function localListing(server) {
    await restore();
    const base = { configured: false, local: true, canPick: canPick(), canRemember: canRemember(), folder: '', name: '', periods: [], error: server && server.error };
    if (!picked) return base;
    Object.assign(base, { configured: true, folder: picked.name, name: picked.name, error: '' });
    if (picked.dir.queryPermission) {
      let perm = 'denied';
      try { perm = await picked.dir.queryPermission({ mode: 'read' }); } catch (e) { /* treated as not allowed */ }
      if (perm !== 'granted') return Object.assign(base, { needsPermission: true });
    }
    try { base.periods = await walk(picked.dir); }
    catch (e) { base.error = `${picked.name} cannot be read (${(e && e.message) || e}). Pick it again.`; }
    return base;
  }

  // ---------- the layout: one folder per period, or each input from its own place ----------
  let raw = null, derivedFor = null;      // the folder listing as found, and the layout the current listing was derived for
  const LAYOUT_SHEETS = ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded', 'Ownership'];
  const stripExt = (n) => String(n).replace(PN.EXT, '');
  /**
   * The layout in force, from the shared setting dataLayout: null (the default: each period folder holds every input), or
   * { mode: 'split', sheets: { Holdings: { folder } (every input file directly in that folder is one month) or { folder, file }
   * (one fixed file), Mapping / Hardcoded / ESG Hardcoded / Ownership: { folder, file } or absent (not from the folder) } }.
   */
  function layout() { const L = Scope.store && Scope.store.state && Scope.store.state.settings && Scope.store.state.settings.dataLayout; return L && L.mode === 'split' && L.sheets ? L : null; }
  const layoutKey = () => JSON.stringify(layout());
  /** Which sheet a file's name says it holds (the CSV rule: the name ends with the sheet name; Sep Holdings.xlsx is Holdings). */
  const sheetOfName = (name) => { const IN = Scope.inputs; return IN && IN.sheetKey ? IN.sheetKey(stripExt(name) + '.csv') : null; };
  /** The listing as the layout sees it: with a split layout, one period per Holdings file, each with the fixed files of the other inputs. */
  function derive(r) {
    const L = layout(); derivedFor = layoutKey();
    if (!r || !L || !r.configured || r.needsPermission) return r;
    const at = new Map((r.periods || []).map((p) => [p.id, p]));
    const fileAt = (folder, name) => { const p = at.get(folder || ''); const f = p && p.files.find((x) => x.name === name); return f ? { folder: folder || '', name: f.name, size: f.size, modified: f.modified } : null; };
    const H = L.sheets.Holdings || {}, hFolder = H.folder || '';
    const months = H.file ? [fileAt(hFolder, H.file)].filter(Boolean) : ((at.get(hFolder) || {}).files || []).map((f) => fileAt(hFolder, f.name));
    const fixed = [], missing = [];
    for (const sh of LAYOUT_SHEETS.slice(1)) {
      const c = L.sheets[sh]; if (!c || !c.file) continue;
      const f = fileAt(c.folder, c.file);
      if (f) fixed.push(Object.assign(f, { sheet: sh })); else missing.push(`${sh}: ${c.file}`);
    }
    const top = hFolder ? hFolder.split('/').pop() : r.name;
    const periods = months.map((m) => ({ id: (hFolder ? hFolder + '/' : '') + m.name, parts: [top, stripExt(m.name)], label: stripExt(m.name), split: true,
      files: [Object.assign({}, m, { sheet: 'Holdings' })].concat(fixed.map((f) => Object.assign({}, f))), missing: missing.slice() })).sort(PN.compare);
    const error = !periods.length ? (H.folder !== undefined || H.file ? `No Holdings file found in ${H.file ? H.file : (hFolder || r.name)}: check the layout on the Data page.` : 'Choose where Holdings comes from in the layout on the Data page.') : r.error;
    return Object.assign({}, r, { periods, split: true, error });
  }
  /** A first guess at a split layout from the names in the folder. */
  function guessLayout() {
    const folders = (raw && raw.periods) || [], sheets = {};
    const named = (f) => sheetOfName(f.name);
    // Holdings: a folder with two or more Holdings files (or named Holdings), else one Holdings file
    const hDir = folders.find((p) => p.files.filter((f) => named(f) === 'Holdings').length >= 2)
      || folders.find((p) => /holdings/i.test(p.id.split('/').pop() || '') && p.files.length);
    if (hDir) sheets.Holdings = { folder: hDir.id };
    else { for (const p of folders) { const f = p.files.find((x) => named(x) === 'Holdings'); if (f) { sheets.Holdings = { folder: p.id, file: f.name }; break; } } }
    for (const sh of LAYOUT_SHEETS.slice(1)) {
      let hit = null;
      for (const p of folders) { if (hDir && p.id === hDir.id) continue; const f = p.files.find((x) => named(x) === sh); if (f) { hit = { folder: p.id, file: f.name }; break; } }
      if (!hit) for (const p of folders) { if (hDir && p.id === hDir.id) continue; const f = p.files.find((x) => new RegExp(sh.replace(' ', '[ _-]?'), 'i').test(x.name) && !(sh === 'Hardcoded' && /esg/i.test(x.name))); if (f) { hit = { folder: p.id, file: f.name }; break; } }
      if (hit) sheets[sh] = hit;
    }
    return { mode: 'split', sheets };
  }
  /** Read one month of a split layout: its Holdings file and each fixed file, taking only the sheet each is chosen for. */
  async function readSplit(p, list, bytes, read) {
    const out = { sheets: {}, sources: {}, warnings: [] }, byFile = new Map();
    for (const f of p.files) { const k = f.folder + '/' + f.name; if (!byFile.has(k)) byFile.set(k, { f, sheets: [] }); byFile.get(k).sheets.push(f.sheet); }
    for (const m of p.missing || []) out.warnings.push(`${m} is not in the data folder any more: that sheet is left as it was. Check the layout on the Data page.`);
    for (const { f, sheets } of byFile.values()) {
      const data = await bytes(f.folder, f.name), csv = !/\.xls[xm]$/i.test(f.name);
      const book = csv ? null : await read([{ name: f.name, data }]); // a workbook is read once for all the sheets taken from it
      for (const sh of sheets) {
        // a CSV is the sheet it is chosen for, whatever its name ("Sep 2026.csv" as Holdings); a workbook gives its tab of that name
        const r = book || await read([{ name: `${sh}.${(/\.([^.]+)$/.exec(f.name) || [, 'csv'])[1]}`, data }]);
        if (csv || sh === sheets[0]) for (const w of r.warnings || []) if (!/no "[^"]+" sheet found/.test(w)) out.warnings.push(csv ? w.split(`${sh}.`).join(f.name.replace(/\.[^.]+$/, '') + '.') : w);
        if (!r.sheets[sh]) { out.warnings.push(`${f.name} has no ${sh} sheet: ${sh} is left as it was. Check the layout on the Data page.`); continue; }
        out.sheets[sh] = r.sheets[sh];
        out.sources[sh] = Object.assign({}, r.sources[sh], { file: f.name, period: p.id, folder: list.name, whole: false, files: [{ folder: f.folder, name: f.name, size: f.size, modified: f.modified }] });
      }
    }
    out.period = p.id;
    return out;
  }

  // ---------- noticing a change to the loaded period's files ----------
  const watch = { timer: null, notice: null, dismissed: '', busy: null, key: '', listeners: new Set() };
  const emit = () => { for (const fn of Array.from(watch.listeners)) { try { fn(); } catch (e) { console.error(e); } } };
  const fileKey = (f) => JSON.stringify([f.name, f.size, f.modified]);
  const stampOf = (files) => files.map(fileKey).sort().join('\n'); // order-free: the folder lists by name, a load keeps its own order
  const keyOf = (ps) => ps.map((p) => p.id + '\u0000' + p.folder + '\u0000' + stampOf(p.files)).join('\n');

  /**
   * What the loaded sheets were read from, grouped by folder: [{ id (the period), folder, whole, files, sheets }]. whole: the
   * folder is one period, so a file added to it is a change too; otherwise only the files read are watched (a new month's
   * file in the Holdings folder is not a change).
   */
  function loadedPeriods() {
    const by = new Map(), store = Scope.store;
    for (const [name, src] of Object.entries((store && store.state && store.state.sources) || {})) {
      if (!src || src.period === undefined || src.period === null || !Array.isArray(src.files)) continue;
      const whole = src.whole !== false;
      const groups = new Map();
      for (const f of src.files) { const folder = f.folder !== undefined ? f.folder : src.period; if (!groups.has(folder)) groups.set(folder, []); groups.get(folder).push({ name: f.name, size: f.size, modified: f.modified }); }
      for (const [folder, files] of groups) {
        const k = src.period + '\u0000' + folder + '\u0000' + whole;
        if (!by.has(k)) by.set(k, { id: src.period, folder, whole, files: [], sheets: [], of: {} });
        const g = by.get(k);
        for (const f of files) { if (!g.files.some((x) => x.name === f.name)) g.files.push(f); (g.of[f.name] || (g.of[f.name] = [])).push(name); }
        if (!g.sheets.includes(name)) g.sheets.push(name);
      }
    }
    return Array.from(by.values());
  }

  /** One period's files as they are now; null when the folder cannot be looked at (no folder, or the browser must ask first). */
  async function filesNow(id) {
    if (id === HF) { await hRestore(); return hPicked && (await allowed(hPicked.dir)) ? listFiles(hPicked.dir).catch(() => []) : null; }
    if (served()) {
      try {
        const r = await fetch('source/periods', { cache: 'no-store' }); const j = r.ok ? await r.json() : null;
        if (j && j.configured) { const p = (j.periods || []).find((x) => x.id === id); return p ? p.files : []; }
      } catch (e) { return null; }
    }
    await restore();
    if (!picked) return null;
    if (picked.dir.queryPermission) { try { if ((await picked.dir.queryPermission({ mode: 'read' })) !== 'granted') return null; } catch (e) { return null; } }
    let d = picked.dir;
    try { for (const p of String(id || '').split('/').filter(Boolean)) d = await d.getDirectoryHandle(p); } catch (e) { return []; }
    return listFiles(d);
  }

  /** The input files directly in a directory handle: [{ name, size, modified }], by name. */
  async function listFiles(d) {
    const files = [];
    for await (const e of d.values()) {
      if (e.kind !== 'file' || !PN.usable(e.name) || !PN.EXT.test(e.name)) continue;
      try { const f = await e.getFile(); files.push({ name: e.name, size: f.size, modified: new Date(f.lastModified || 0).toISOString() }); } catch (err) { /* gone since the listing */ }
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** May the handle be read without asking (a handle from a folder upload always)? */
  async function allowed(dir) {
    if (!dir.queryPermission) return true;
    try { return (await dir.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { return false; }
  }

  // ---------- the Holdings folder: one Holdings file a month ----------
  const HKEY = 'holdings', HF = '\u0001holdings'; // its key in the browser's store, and its folder token in a source's files
  let hPicked = null, hRestored = null, hListing = null;
  function hRestore() {
    if (!hRestored) hRestored = (async () => { const s = kv(); const dir = s && canRemember() ? await s.get(HKEY) : null; if (dir && !hPicked) hPicked = { name: dir.name, dir, saved: true }; })().catch(() => {});
    return hRestored;
  }
  /** Months oldest first: by the date the name says ("Sep 2026", "2026-09"), and by when the file was saved where the names say none. */
  const hOrder = (a, b) => { const ka = PN.key(a.parts), kb = PN.key(b.parts); for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return !ka[0] && a.modified !== b.modified ? (a.modified < b.modified ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); };
  /** The Holdings folder's listing: { configured, canPick, canRemember, name, needsPermission, months: [{ id, name, label, size, modified }], error }. */
  async function hList(force) {
    if (hListing && !force) return hListing;
    await hRestore();
    const base = { configured: false, canPick: canPick(), canRemember: canRemember(), name: '', months: [], error: '' };
    if (hPicked) {
      Object.assign(base, { configured: true, name: hPicked.name });
      if (!(await allowed(hPicked.dir))) base.needsPermission = true;
      else {
        try {
          // a name read as a month still to come (more than a month ahead) is most likely a date written another way round
          // ("300926" day first reads as 2030): flagged, listed last and never picked as the newest
          const now = new Date(), ahead = (now.getUTCFullYear() * 12 + now.getUTCMonth()) + 1;
          base.months = (await listFiles(hPicked.dir)).map((f) => { const m = Object.assign(f, { id: 'h:' + f.name, label: stripExt(f.name), parts: [stripExt(f.name)] }); const k = PN.key(m.parts); m.future = !!(k[0] && k[2] !== 13 && k[0] * 12 + (k[2] - 1) > ahead); return m; })
            .sort((a, b) => (a.future ? 1 : 0) - (b.future ? 1 : 0) || hOrder(a, b));
          const odd = base.months.filter((m) => m.future);
          if (odd.length) base.warning = `${odd.map((m) => m.name).join(', ')} read${odd.length === 1 ? 's' : ''} as a date still to come. Six digits are read year, month, day (260930 is 30 Sep 2026): rename ${odd.length === 1 ? 'it' : 'them'}, or pick ${odd.length === 1 ? 'it' : 'them'} by hand.`;
        }
        catch (e) { base.error = `${hPicked.name} cannot be read (${(e && e.message) || e}). Pick it again.`; }
        if (!base.error && !base.months.length) base.error = `No Holdings file (.xlsx, .xlsm, .csv) directly in ${hPicked.name}.`;
      }
    }
    hListing = base;
    return base;
  }
  /** One month of the Holdings folder: its Holdings sheet only (a CSV is Holdings whatever its name), tagged with its month. */
  async function hRead(m, read) {
    let f;
    try { f = await (await hPicked.dir.getFileHandle(m.name)).getFile(); } catch (e) { throw new Error(`${m.name} is not in ${hPicked.name} any more`); }
    const data = new Uint8Array(await f.arrayBuffer()), csv = !/\.xls[xm]$/i.test(m.name);
    const r = await read([{ name: csv ? `Holdings.${(/\.([^.]+)$/.exec(m.name) || [, 'csv'])[1]}` : m.name, data }]);
    if (!r.sheets || !r.sheets.Holdings) throw new Error(`${m.name} has no Holdings sheet`);
    const warnings = (r.warnings || []).filter((w) => !/no "[^"]+" sheet found/.test(w)).map((w) => (csv ? w.split('Holdings.').join(stripExt(m.name) + '.') : w));
    const held = { folder: HF, name: m.name, size: m.size, modified: m.modified };
    return { sheets: { Holdings: r.sheets.Holdings }, sources: { Holdings: Object.assign({}, r.sources && r.sources.Holdings, { file: m.name, period: m.id, folder: hPicked.name, whole: false, files: [held] }) }, warnings, period: m.id };
  }

  /** Compare each loaded period's files with the folder now; the first that differs becomes the notice. */
  function check() {
    if (watch.busy) return watch.busy;
    watch.busy = (async () => {
      let notice = null;
      for (const L of loadedPeriods()) {
        const all = await filesNow(L.folder);
        if (!all || !all.length) continue; // cannot look, or the folder has gone: nothing to offer
        const files = L.whole ? all : all.filter((f) => L.files.some((x) => x.name === f.name)); // file by file: another month's file is not a change
        const stamp = stampOf(files);
        if (stamp === stampOf(L.files)) continue;
        const was = new Map(L.files.map((f) => [f.name, fileKey(f)]));
        const changed = files.filter((f) => was.has(f.name) && was.get(f.name) !== fileKey(f)), added = files.filter((f) => !was.has(f.name));
        const gone = L.files.filter((f) => !files.some((x) => x.name === f.name)).map((f) => f.name);
        const at = changed.concat(added).map((f) => f.modified).sort().pop() || '';
        const hit = [];
        if (!L.whole) for (const n of changed.map((f) => f.name).concat(gone)) for (const sh of L.of[n] || []) if (!hit.includes(sh)) hit.push(sh); // file by file: only the sheets those files gave
        notice = { id: L.id, folder: L.folder, stamp, changed: changed.map((f) => f.name), added: added.map((f) => f.name), gone, at, sheets: hit.length ? hit : L.sheets.slice() };
        break;
      }
      if (notice && watch.dismissed === notice.id + '\u0000' + notice.folder + '\u0000' + notice.stamp) notice = null;
      const same = JSON.stringify(notice) === JSON.stringify(watch.notice);
      watch.notice = notice;
      if (!same) emit();
      return notice;
    })().catch((e) => { console.error(e); return watch.notice; }).finally(() => { watch.busy = null; });
    return watch.busy;
  }

  const S = (Scope.source = {
    /**
     * The data folder and its periods (oldest first). force: look again (new periods show up). Never null: { configured:
     * false } when there is no folder yet; canPick says whether this browser can pick one.
     */
    async periods(force) {
      if (listing && !force) return listing;
      let server = null;
      if (served()) {
        try { const r = await fetch('source/periods', { cache: 'no-store' }); const j = r.ok ? await r.json() : null; server = j && typeof j.configured === 'boolean' ? j : null; }
        catch (e) { server = null; }
      }
      raw = server && server.configured ? Object.assign(server, { local: false }) : await localListing(server);
      listing = derive(raw);
      return listing;
    },
    /** The last listing, without looking again (laid out again when the layout changed since). */
    cached() { if (raw && layoutKey() !== derivedFor) listing = derive(raw); return listing; },
    /** The folder as found: every folder holding input files, with its files (the choices for a layout). */
    folders() { return (raw && raw.periods) || []; },
    /** The layout in force: null (each period folder holds every input) or { mode: 'split', sheets } (see derive). */
    layout,
    /** A first guess at a split layout from the files' names: a folder of Holdings files, and a file for each other input. */
    guessLayout,
    /** The sheets a layout can name, in order (Ownership optional). */
    LAYOUT_SHEETS,
    /** One period by id, from the last listing. */
    find(id) { if (/^h:/.test(String(id))) return ((hListing && hListing.months) || []).find((m) => m.id === id) || null; return (S.cached() && listing.periods || []).find((p) => p.id === id) || null; },
    /** A period's display name: "Q2 2026 · April" (the data folder's own name for files sitting directly in it); a month of a split layout is its Holdings file's name ("Sep 2026"). */
    label(id) { if (/^h:/.test(String(id))) return stripExt(String(id).slice(2)); const p = listing && (listing.periods || []).find((x) => x.id === id); if (p && p.label) return p.label; return id ? String(id).split('/').join(' · ') : (listing && listing.name) || 'Data folder'; },
    /** A folder's display name ("Q2 2026 · April"; the data folder's own name for its top level). */
    folderLabel(id) { if (id === HF) return `the Holdings folder ${hPicked ? hPicked.name : ''}`.trim(); return id ? String(id).split('/').join(' · ') : (raw && raw.name) || 'Data folder'; },
    /**
     * The periods grouped by their top folder, newest first: [{ top, periods }] (for a quarter → month picker). A top
     * folder's own files come first in its group.
     */
    groups() {
      const out = [], at = new Map();
      for (const p of (listing && listing.periods || []).slice().reverse()) {
        const top = p.parts[0] || '';
        if (!at.has(top)) { at.set(top, { top, periods: [] }); out.push(at.get(top)); }
        at.get(top).periods.push(p);
      }
      for (const g of out) g.periods.sort((a, b) => (a.parts.length === 1 ? -1 : 0) - (b.parts.length === 1 ? -1 : 0));
      return out;
    },
    /**
     * Pick the data folder in the browser (call it straight from a click: the browser only opens its folder dialog then).
     * Edge and Chrome remember it; elsewhere a folder upload reads it for this session. Resolves with the new listing, or
     * the old one when the dialog is cancelled.
     */
    async choose() {
      let dir = null;
      if (canRemember()) {
        try { dir = await global.showDirectoryPicker({ id: 'scope-data', mode: 'read' }); }
        catch (e) { if (e && e.name === 'AbortError') return listing; markRefused(e); } // refused (a locked-down PC): the folder upload below, and from now on
      }
      if (dir) {
        picked = { name: dir.name, dir, saved: false };
        const s = kv(); if (s) { try { await s.set(KEY, dir); picked.saved = true; } catch (e) { /* remembered for this page only */ } }
      } else {
        const files = await new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file'; input.webkitdirectory = true; input.multiple = true; input.style.display = 'none';
          input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
          input.addEventListener('cancel', () => { resolve(null); input.remove(); });
          document.body.appendChild(input); input.click();
        });
        if (!files || !files.length) return listing;
        S.useFiles(files);
      }
      cache.clear();
      return S.periods(true);
    },
    /** Use a folder upload's files (webkitRelativePath) as the data folder for this session. */
    useFiles(files) { const dir = treeFromFiles(files); if (dir) { picked = { name: dir.name, dir, saved: false }; cache.clear(); } return !!dir; },
    /** Ask the browser again for leave to read the remembered folder (call it straight from a click). */
    async reconnect() {
      if (picked && picked.dir.requestPermission) { try { await picked.dir.requestPermission({ mode: 'read' }); } catch (e) { /* the listing says it is still not allowed */ } }
      return S.periods(true);
    },
    /** Forget the folder picked in the browser. */
    async forget() {
      picked = null; cache.clear();
      const s = kv(); if (s) { try { await s.del(KEY); } catch (e) { /* nothing remembered */ } }
      return S.periods(true);
    },
    /**
     * Read one period: its files, read as a file drop would. Resolves with Scope.inputs.readFiles output ({ sheets, sources,
     * warnings }) plus .period; each source says which period it came from.
     */
    async read(id) {
      if (/^h:/.test(String(id))) {
        let m = S.find(id);
        if (!m) m = ((await hList(true)).months || []).find((x) => x.id === id);
        if (!m) throw new Error(`${S.label(id)} is not in the Holdings folder${hListing && hListing.needsPermission ? ' (reconnect it on the Data page)' : ''}`);
        const stamp = [m.name, m.size, m.modified].join('|'), hit = cache.get(id);
        if (hit && hit.stamp === stamp) return hit.out;
        const read = Scope.inputs && Scope.inputs.readFiles;
        if (!read) throw new Error('The workbook reader is not available in this copy of Scope');
        const out = await hRead(m, read);
        cache.set(id, { stamp, out });
        return out;
      }
      await S.periods();
      const list = S.cached();
      const p = list && (list.periods || []).find((x) => x.id === id);
      if (!p) throw new Error(`${S.label(id)} is not in the data folder${list && list.needsPermission ? ' (reconnect it on the Data page)' : ''}`);
      const stamp = p.files.map((f) => (f.folder !== undefined ? f.folder : id) + '/' + f.name + '|' + f.size + '|' + f.modified + '|' + (f.sheet || '')).join(';');
      const hit = cache.get(id);
      if (hit && hit.stamp === stamp) return hit.out;
      const read = Scope.inputs && Scope.inputs.readFiles;
      if (!read) throw new Error('The workbook reader is not available in this copy of Scope');
      const bytes = async (folder, name) => {
        if (list.local) return localBytes(folder, name);
        const r = await fetch(`source/file?period=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${name} could not be fetched from the data folder (${r.status})`);
        return new Uint8Array(await r.arrayBuffer());
      };
      if (p.split) { const out = await readSplit(p, list, bytes, read); cache.set(id, { stamp, out }); return out; }
      const files = await Promise.all(p.files.map(async (f) => ({ name: f.name, data: await bytes(id, f.name) })));
      const out = await read(files);
      const held = p.files.map((f) => ({ folder: id, name: f.name, size: f.size, modified: f.modified })); // what the folder held when read (the change notice compares with it)
      for (const src of Object.values(out.sources || {})) Object.assign(src, { period: id, folder: list.name, whole: true, files: held.map((f) => Object.assign({}, f)) });
      out.period = id;
      cache.set(id, { stamp, out });
      return out;
    },
    /**
     * Sheets for a comparison: the period's own sheets, with any input sheet it does not have (a folder holding only
     * Holdings, say) taken from the loaded data. Returns { sheets, sources, borrowed: [names] }.
     */
    complete(out, store) {
      const sheets = Object.assign({}, out.sheets), sources = Object.assign({}, out.sources), borrowed = [];
      const names = (store.SHEETS || []).concat(store.OPTIONAL_SHEETS || []);
      for (const n of names) if (!sheets[n] && store.sheet(n)) { sheets[n] = store.effectiveSheets()[n] || store.sheet(n); sources[n] = store.state.sources[n]; borrowed.push(n); }
      return { sheets, sources, borrowed };
    },
    /** Call fn() when the change notice appears or goes; returns an unsubscribe function. */
    subscribe(fn) { watch.listeners.add(fn); return () => watch.listeners.delete(fn); },
    /** The periods the loaded sheets were read from: [{ id, files, sheets }] (sheets loaded some other way are not watched). */
    loadedPeriods,
    /** Look now: has a file of a loaded period changed in the data folder? Resolves with the notice, or null. */
    check,
    /** The current change notice: { id, changed: [file names], gone: [file names], at, sheets }, or null. */
    notice() { return watch.notice; },
    /** Start looking every ms (20 seconds), when the tab is shown again and when other data is loaded. */
    watch(ms) {
      if (watch.timer || typeof setInterval !== 'function') return;
      const every = ms || 20000;
      watch.timer = setInterval(check, every);
      if (typeof document !== 'undefined') {
        const wake = () => { if (!document.hidden) check(); };
        document.addEventListener('visibilitychange', wake); if (global.addEventListener) global.addEventListener('focus', wake);
      }
      const store = Scope.store;
      if (store && store.subscribe) store.subscribe(() => { const k = keyOf(loadedPeriods()); if (k !== watch.key) { watch.key = k; check(); } });
      watch.key = keyOf(loadedPeriods());
      check();
    },
    /**
     * Read the changed period again and load it, as Load on the Data page would. Only the sheets that came from that
     * period (and input sheets not loaded at all, a file added to it) are replaced: a sheet dropped on top is kept.
     */
    async refresh() {
      const n = watch.notice;
      if (!n) return null;
      if (/^h:/.test(String(n.id))) await hList(true); else await S.periods(true);
      const out = await S.read(n.id), st = Scope.store.state, sheets = {}, sources = {};
      for (const name of Object.keys(out.sheets || {})) {
        const was = st.sources[name];
        if (st.sheets[name] && was && was.kind !== 'demo' && was.period !== n.id) continue;
        sheets[name] = out.sheets[name]; if (out.sources && out.sources[name]) sources[name] = out.sources[name];
      }
      watch.notice = null; watch.dismissed = ''; emit();
      const filtered = Object.assign({}, out, { sheets, sources });
      if (S.onApply) S.onApply(filtered, `${S.label(n.id)} (data folder)`);
      else Scope.store.setSheets(sheets, sources, { merge: true });
      return filtered;
    },
    /** Hide the notice until the folder changes again. */
    dismiss() { const n = watch.notice; if (!n) return; watch.dismissed = n.id + '\u0000' + n.folder + '\u0000' + n.stamp; watch.notice = null; emit(); },
    /** Top bar notice row: the inputs changed in the data folder (Refresh, Not now). */
    renderNotice(bar) {
      const n = watch.notice, UI = Scope.ui;
      if (!n || !UI) return;
      const h = UI.h, icon = Scope.icon;
      const names = (l) => l.length > 3 ? l.slice(0, 3).join(', ') + ` and ${l.length - 3} more` : l.join(', ');
      const what = [n.changed.length ? `${names(n.changed)} changed` : '', (n.added || []).length ? `${names(n.added)} added` : '', n.gone.length ? `${names(n.gone)} removed` : ''].filter(Boolean).join(', ');
      const at = n.at && Scope.shared && Scope.shared.when ? `, saved ${Scope.shared.when(n.at)}` : '';
      const go = h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
        go.disabled = true;
        try { await S.refresh(); } catch (e) { go.disabled = null; if (UI.toast) UI.toast(`Could not refresh ${S.label(n.id)}: ${(e && e.message) || e}`, 'warn'); }
      } }, 'Refresh');
      bar.appendChild(h('div', { class: 'sh-notice', role: 'status' }, icon ? icon('refresh-cw', { size: 14 }) : '',
        h('span', {}, `${n.folder === HF ? 'Holdings changed' : 'Inputs changed in the data folder'}: ${what} in ${S.folderLabel(n.folder)}${at}. You are looking at ${S.label(n.id)} as loaded before (${names(n.sheets)}).`),
        h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm', onClick: () => S.dismiss() }, 'Not now'), go));
    },
    /**
     * The Holdings folder: a folder of its own where every input file is one month's Holdings. list(force) looks at it
     * (cached() without looking), choose() picks it (straight from a click), reconnect() asks the browser again, forget()
     * stops using it, latest() is its newest month. A month reads with read('h:' + file name).
     */
    holdings: {
      list: hList,
      cached: () => hListing,
      latest: () => { const ms = ((hListing && hListing.months) || []).filter((m) => !m.future); return ms.length ? ms[ms.length - 1] : null; },
      async choose() {
        let dir = null;
        if (canRemember()) {
          try { dir = await global.showDirectoryPicker({ id: 'scope-holdings', mode: 'read' }); }
          catch (e) { if (e && e.name === 'AbortError') return hList(); markRefused(e); } // refused (a locked-down PC): the folder upload below, and from now on
        }
        if (dir) {
          hPicked = { name: dir.name, dir, saved: false };
          const s = kv(); if (s) { try { await s.set(HKEY, dir); hPicked.saved = true; } catch (e) { /* remembered for this page only */ } }
        } else {
          const files = await new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file'; input.webkitdirectory = true; input.multiple = true; input.style.display = 'none';
            input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
            input.addEventListener('cancel', () => { resolve(null); input.remove(); });
            document.body.appendChild(input); input.click();
          });
          if (!files || !files.length) return hList();
          S.holdings.useFiles(files);
        }
        for (const k of Array.from(cache.keys())) if (/^h:/.test(k)) cache.delete(k);
        return hList(true);
      },
      /** Use a folder upload's files as the Holdings folder for this session (its files directly in it are the months). */
      useFiles(files) { const dir = treeFromFiles(files); if (dir) { hPicked = { name: dir.name, dir, saved: false }; for (const k of Array.from(cache.keys())) if (/^h:/.test(k)) cache.delete(k); } return !!dir; },
      async reconnect() {
        if (hPicked && hPicked.dir.requestPermission) { try { await hPicked.dir.requestPermission({ mode: 'read' }); } catch (e) { /* the listing says it is still not allowed */ } }
        return hList(true);
      },
      async forget() {
        hPicked = null; for (const k of Array.from(cache.keys())) if (/^h:/.test(k)) cache.delete(k);
        const s = kv(); if (s) { try { await s.del(HKEY); } catch (e) { /* nothing remembered */ } }
        return hList(true);
      },
      /** The folder token a Holdings month's source carries in its files (for the change notice). */
      FOLDER: HF,
    },
    /** For tests: a file list as a directory handle's shape, and the walker. */
    _treeFromFiles: treeFromFiles, _walk: walk,
  });
})(typeof window !== 'undefined' ? window : globalThis);
