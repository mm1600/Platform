/* Scope core: one copy of the team's data in a shared folder, with every save kept as a version (Scope.shared).
 *
 * Built on js/core/drive-vc.js (the same file as the standalone drive-vc library: keep the two in step). Shared: the
 * loaded workbook sheets, the rows added to Mapping in the app, the corrections, the calculation and report settings,
 * the write-ups and their links, the market curves and the PowerPoint template. Kept in each browser: the view,
 * currency and filters, your name, saved Explorer views, grid layouts, custom sheets, designer layouts and the one-step
 * undo of a Holdings update.
 * Each person picks the team folder once (Scope only reads it); the team's data is one file there, "Scope team.json".
 * Scope reads it every 20 seconds, when the tab is shown again and before a deck is built, and flags a colleague's newer
 * save in the top bar (Get it); nothing changes until it is taken. Save to team folder writes the file (or hands it over as a download where the PC stops web pages saving
 * into folders). The page is js/modules/layer0-shared.js. Nothing leaves the drive: there is no server.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, store = Scope.store, VC = global.DriveVC;
  const APP = 'scope';
  const SHARED_SETTINGS = ['calcOverrides', 'reportStyle', 'reportInputs', 'writeupsUnlinked', 'reportTemplateText', 'dataLayout', 'ratioWays'];
  const SH = (Scope.shared = { repo: null, dir: null, permission: '', problem: '', SHARED_SETTINGS });
  const copy = (x) => JSON.parse(JSON.stringify(x));
  /** "5 Nov, 14:05" in the user's locale. */
  const when = (iso) => { try { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } };
  SH.when = when;
  const listeners = new Set();
  /** Call fn() whenever the shared-folder status changes; returns an unsubscribe function. */
  SH.subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const changed = () => { for (const fn of Array.from(listeners)) { try { fn(); } catch (e) { console.error(e); } } };

  // ---------- the template travels as text (base64) ----------
  let tpl = { t: null, out: null };
  function templateOut(t) {
    if (tpl.t === t) return tpl.out;
    const u8 = new Uint8Array(t.bytes); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    tpl = { t, out: { name: t.name || '', at: t.at || '', summary: t.summary ? copy(t.summary) : null, base64: global.btoa(s) } };
    return tpl.out;
  }
  function templateIn(o) {
    const s = global.atob(o.base64), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    const t = { name: o.name, at: o.at, summary: o.summary || null, bytes: u8.buffer };
    tpl = { t, out: o }; return t;
  }

  // ---------- what is shared ----------
  /** The shared part of the store as one object (sheets by reference: a sheet is replaced, never edited in place). */
  SH.stateOf = function () {
    const st = store.state, sheets = {}, settings = {};
    for (const [n, g] of Object.entries(st.sheets || {})) if (g && g.rows) sheets[n] = g.rows;
    for (const k of SHARED_SETTINGS) if (st.settings[k] !== undefined && st.settings[k] !== null) settings[k] = copy(st.settings[k]);
    return { sheets, sources: copy(st.sources || {}), datasetLabel: st.datasetLabel || '', edits: copy(st.edits || []), adjustments: copy(st.adjustments || []),
      settings, reportData: copy(st.reportData || {}), template: st.template && st.template.bytes ? templateOut(st.template) : null };
  };
  /** Put a version's data into the store, save it in this browser and re-render (personal settings are kept). */
  SH.applyState = function (s) {
    const st = store.state, before = st.sheets.Holdings && st.sheets.Holdings.rows; s = s || {};
    st.sheets = {}; for (const [n, rows] of Object.entries(s.sheets || {})) if (Array.isArray(rows)) st.sheets[n] = { name: n, rows };
    st.sources = s.sources || {}; st.datasetSource = 'workbook'; st.datasetLabel = s.datasetLabel || 'Workbook data';
    st.edits = s.edits || []; st.adjustments = s.adjustments || [];
    if (!st.sheets.Holdings || st.sheets.Holdings.rows !== before) st.previousHoldings = null; // its undo belonged to the Holdings replaced here
    for (const k of SHARED_SETTINGS) { const v = (s.settings || {})[k]; if (v !== undefined) st.settings[k] = v; else if (k === 'calcOverrides') st.settings[k] = {}; else delete st.settings[k]; }
    st.reportData = s.reportData || {};
    st.template = s.template && s.template.base64 ? templateIn(s.template) : null;
    store.persistSheets(); store.persistSettings(); store.persistAdjustments(); store.persistReportInputs();
    store.emit();
  };

  // ---------- one change in words ----------
  const AREA = { sources: 'Sheet sources', datasetLabel: 'Dataset label', edits: 'Mapping rows added in Scope', adjustments: 'Corrections', template: 'PowerPoint template' };
  const SETTING = { calcOverrides: 'Calculation settings', reportStyle: 'Report style', reportInputs: 'Investor reporting', writeupsUnlinked: 'Write-ups not linked', reportTemplateText: 'Template text colour', dataLayout: 'Data folder layout', ratioWays: 'Ratios: which way is good' };
  const GROUP = { ownershipGrid: 'Ownership grid', roles: 'Column choices', settings: 'Parameters', fxQuote: 'FX quote', fxOverrides: 'FX rates', names: 'Names', investors: 'Investors', views: 'Views' };
  /** { where, what } for one change [{ p, b, a }] of a version. */
  SH.describe = function (c) {
    const d = VC.describe(c), p = c.p;
    let where = d.where, what = d.what;
    if (p[0] === 'sheets') { const n = (j) => JSON.parse(j).length; where = `${p[1]} sheet`; what = c.b === undefined ? `added (${n(c.a)} rows)` : c.a === undefined ? 'removed' : n(c.b) === n(c.a) ? `cells changed (${n(c.a)} rows)` : `replaced (${n(c.b)} → ${n(c.a)} rows)`; }
    else if (p[0] === 'settings') where = [SETTING[p[1]] || p[1]].concat(p[1] === 'calcOverrides' ? [GROUP[p[2]] || p[2]].concat(p.slice(3)) : p.slice(2)).filter((x) => x !== undefined).join(' › ');
    else if (p[0] === 'reportData') where = ['Report inputs', { monitoring: 'Write-ups', market: 'Market curves' }[p[1]] || p[1]].concat(p.slice(2)).filter((x) => x !== undefined).join(' › ');
    else if (AREA[p[0]]) where = [AREA[p[0]]].concat(p.slice(1)).join(' › ');
    if (p[0] === 'template' && p[1] === 'base64') { where = 'PowerPoint template'; what = c.b === undefined ? 'added' : c.a === undefined ? 'removed' : 'file replaced'; }
    return { where, what };
  };

  // ---------- connecting ----------
  const user = () => store.state.settings.user || '';
  /** Open the repository on a folder (or DriveVC.memory() to try it) and start checking it; opts go to DriveVC.open (tests: timings, cache). */
  SH.attach = async function (folderStore, opts) {
    if (SH.repo) SH.repo.disconnect();
    SH.repo = VC.open(Object.assign({ store: folderStore, appId: APP, user: () => user() || 'someone', getState: SH.stateOf, setState: SH.applyState }, opts));
    SH.repo.subscribe(changed);
    await SH.repo.connect();
    changed();
    return SH.repo;
  };
  // ---------- the team folder: one file, read every 20 seconds, saved with one button ----------
  // The team's data is one file, "Scope team.json", in a folder on the team drive. Scope only needs to read the folder (work
  // PCs that stop web pages saving into folders still allow that): it reads the file when picked, then every 20 seconds and
  // when the tab is shown again, and flags a colleague's newer save (Get it brings it in, unsaved changes on top). Save to team
  // folder reads the file once more (so nothing saved since is lost), saves, and writes the file into the folder where the
  // PC allows it, or hands it over as a download to save there in place of the old one. In a browser that cannot pick
  // folders the file is opened with the file box instead (and read again only when opened again).
  const TEAM_KIND = 'scope-team-file', TEAM_NAME = 'Scope team.json';
  SH.TEAM_NAME = TEAM_NAME;
  SH.mode = '';          // 'folder': a team folder, read by Scope | 'file': the team file opened by hand
  SH.canWrite = null;    // may Scope write the file into the folder? null: not asked yet this session
  SH.waiting = null;     // { at } a save handed over as a download, not yet seen in the folder
  SH.unreachable = '';   // why the team folder could not be read just now (the drive is not connected, say)
  SH.teamFile = null;    // { name, openedAt, store } the team file in memory (its versions as a folder would hold them)
  let seen = '', timer = null, pulling = null, wake = null;
  const kv = () => (VC && VC.localStore ? (kv.s || (kv.s = VC.localStore('scope-team'))) : null);
  SH.canPick = () => typeof global.showDirectoryPicker === 'function';

  /** The versions in a team file's text, added to the in-memory folder (a newer copy overwrites what it also holds). */
  function loadTeamText(mem, text, name) {
    let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!j || j.kind !== TEAM_KIND || !j.files || typeof j.files !== 'object') throw new Error(`${name} is not a Scope team file: pick "${TEAM_NAME}" in the team folder`);
    for (const [k, v] of Object.entries(j.files)) mem.files.set(k, String(v));
    return j;
  }
  /** The team file's text: every version held. */
  SH.teamFileText = () => JSON.stringify({ kind: TEAM_KIND, app: APP, savedAt: new Date().toISOString(), by: user() || 'someone', files: Object.fromEntries(SH.teamFile.store.files) });
  /** Start on a team file in memory (its text, or a new one) and open the repository on it. */
  async function start(name, text) {
    const mem = VC.memory({ name });
    if (text) loadTeamText(mem, text, name);
    SH.teamFile = { name, openedAt: new Date().toISOString(), store: mem };
    return SH.attach(mem, { pollMs: 0, settleMs: 0, verifyMs: 0 });
  }
  /** The team file in the folder now: { text, stamp }, or null when there is none yet. */
  async function readFolderFile() {
    let f; try { f = await (await SH.dir.getFileHandle(TEAM_NAME)).getFile(); } catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; }
    return { text: await f.text(), stamp: `${f.lastModified}|${f.size}` };
  }
  /**
   * Read the team file again (folder mode) and see what was saved since: a newer save is only flagged (the top bar and the
   * card offer Get it); nothing changes here until it is taken. Resolves true when the file changed.
   */
  SH.pull = function () {
    if (SH.mode !== 'folder' || !SH.dir || !SH.repo) return Promise.resolve(false);
    if (pulling) return pulling;
    pulling = (async () => {
      const f = await readFolderFile();
      if (SH.unreachable) { SH.unreachable = ''; changed(); }
      if (!f || f.stamp === seen) return false;
      seen = f.stamp;
      const mine = SH.repo.status().version, j = loadTeamText(SH.teamFile.store, f.text, TEAM_NAME);
      await SH.repo.check();
      // a save handed over as a download: arrived when the file's newest save is mine; when someone else's got there first,
      // the download is out of date (putting it in the folder would wipe theirs): say so, my changes come back as unsaved
      if (SH.waiting) {
        let head = null; try { head = JSON.parse(j.files['head.json']); } catch (e) { head = null; }
        if (!(head && head.v === mine && head.by === (user() || 'someone'))) Scope.ui.toast(`${(head && head.by) || 'Someone'} saved to the team folder before your downloaded file got there. Do not use that download: click Get it, then Save to team folder again.`, 'warn');
        SH.waiting = null;
      }
      changed();
      return true;
    })().catch((e) => { console.error(e); const msg = `Cannot read the team folder (${(e && e.message) || e}): is the drive connected?`; if (SH.unreachable !== msg) { SH.unreachable = msg; changed(); } return false; }).finally(() => { pulling = null; });
    return pulling;
  };
  function watch() {
    if (timer || typeof setInterval !== 'function') return;
    timer = setInterval(() => SH.pull(), 20000);
    if (typeof document !== 'undefined') { wake = () => { if (!document.hidden) SH.pull(); }; document.addEventListener('visibilitychange', wake); if (global.addEventListener) global.addEventListener('focus', wake); }
  }
  function unwatch() {
    if (timer) clearInterval(timer); timer = null;
    if (wake && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', wake); if (global.removeEventListener) global.removeEventListener('focus', wake); } wake = null;
  }
  /** Open the team folder already chosen (SH.dir, allowed to be read): read its file and start watching it. */
  /** A shared folder of the earlier kind (head.json, history/, blobs/ as files): its files as a team file's text, or null. */
  async function oldLayout() {
    try { await SH.dir.getFileHandle('head.json'); } catch (e) { return null; }
    const files = {};
    const walk = async (d, pre) => { for await (const e of d.values()) { if (e.kind === 'file' && /\.json$/.test(e.name) && e.name !== TEAM_NAME) files[pre + e.name] = await (await e.getFile()).text(); else if (e.kind === 'directory' && (e.name === 'history' || e.name === 'blobs') && !pre) await walk(e, e.name + '/'); } };
    if (!SH.dir.values) return null;
    await walk(SH.dir, '');
    return files['head.json'] && files['repo.json'] ? JSON.stringify({ kind: TEAM_KIND, app: APP, files }) : null;
  }
  async function openFolder() {
    const f = await readFolderFile();
    seen = f ? f.stamp : '';
    const old = f ? null : await oldLayout();
    if (old) { await start(TEAM_NAME, old); SH.mode = 'folder'; SH.converted = true; watch(); changed(); Scope.ui.toast('This folder holds team data from the earlier Scope: it was read as it is. Your next Save to team folder writes it as the one file, "Scope team.json".'); return SH.repo; }
    await start(TEAM_NAME, f && f.text);
    SH.mode = 'folder'; watch(); changed();
    return SH.repo;
  }

  /** At start-up: open the team folder picked before when the browser still lets Scope read it (else the top bar offers Reconnect). */
  SH.init = async function () {
    if (!VC) return;
    store.subscribe(() => { if (SH.repo) SH.repo.touch(); });
    try {
      const s = kv(); const dir = s && SH.canPick() ? await s.get('folder') : null; if (!dir) return;
      SH.dir = dir; SH.mode = 'folder';
      SH.permission = dir.queryPermission ? await dir.queryPermission({ mode: 'read' }) : 'granted';
      if (SH.permission === 'granted') await openFolder(); else changed();
    } catch (e) { console.error(e); }
  };
  /**
   * Pick the team folder (pick = true: always ask; otherwise the one used before, asked for leave again) and open it. Only
   * reading is asked for, so a PC that stops web pages saving into folders still allows it. Must run inside a click.
   */
  SH.connect = async function (pick) {
    const fail = (msg) => { SH.problem = msg; Scope.ui.toast(msg, 'warn'); changed(); return null; };
    SH.problem = '';
    if (!SH.canPick()) return fail('This browser cannot pick folders: open the team file instead, or use Microsoft Edge or Google Chrome.');
    let dir = pick ? null : SH.dir;
    if (!dir) {
      let opened = false; const looked = () => { opened = true; };
      if (global.addEventListener) global.addEventListener('blur', looked);
      try { dir = await global.showDirectoryPicker({ id: 'scope-team', mode: 'read' }); }
      catch (e) { return fail(SH.pickError(e, opened)); }
      finally { if (global.removeEventListener) global.removeEventListener('blur', looked); }
      const s = kv(); if (s) { try { await s.set('folder', dir); } catch (e) { /* asked again next visit */ } }
    } else if (dir.requestPermission) {
      let p = 'denied'; try { p = await dir.requestPermission({ mode: 'read' }); } catch (e) { p = 'denied'; }
      if (p !== 'granted') return fail(`Scope was not allowed to read ${dir.name}. Click Reconnect and choose Allow (or "Allow on every visit").`);
    }
    unwatch(); if (SH.repo) SH.repo.disconnect();
    SH.dir = dir; SH.mode = 'folder'; SH.permission = 'granted'; SH.canWrite = null; SH.waiting = null;
    try { return await openFolder(); }
    catch (e) { return fail(`${dir.name} could not be read: ${(e && e.message) || e}`); }
  };
  /** A failed folder pick in words: cancelled, blocked by the browser, or refused by the PC. opened: the folder window was seen. */
  SH.pickError = function (e, opened) {
    const n = (e && e.name) || '';
    if (n === 'AbortError') return 'No folder was picked. Click the button again, choose the team folder and click Select folder.';
    if (n === 'SecurityError') return 'The browser blocked the folder window. Open Scope in its own Edge or Chrome tab (not inside another app or a preview) and try again, or open the team file instead.';
    if (n === 'NotAllowedError' || n === 'TypeError') return opened
      ? 'The browser did not let Scope read that folder. Click the button again and choose Allow, or open the team file instead.'
      : 'This PC does not let web pages open folders (a work setting). Open the team file instead: Scope then reads it when you open it.';
    return `The folder could not be picked: ${(e && e.message) || e}`;
  };
  /** Open the team file with the file box (a browser or PC without folders); a new one when file is null. */
  SH.openTeamFile = async function (file) {
    unwatch(); SH.problem = ''; SH.dir = null;
    const repo = await start(file ? file.name : TEAM_NAME, file ? await file.text() : null);
    SH.mode = 'file'; changed();
    return repo;
  };
  /** The team file picked again by hand: what was saved since comes in, my unsaved changes on top. */
  SH.updateTeamFile = async function (file) {
    if (!SH.teamFile || !SH.repo) return SH.openTeamFile(file);
    loadTeamText(SH.teamFile.store, await file.text(), file.name);
    SH.teamFile.openedAt = new Date().toISOString();
    await SH.repo.check(); changed();
    return SH.repo;
  };
  /** Hand the team file over as a download (to save in the team folder in place of the old one). */
  SH.downloadTeamFile = function () { Scope.ui.downloadText(TEAM_NAME, SH.teamFileText(), 'application/json'); SH.waiting = { at: new Date().toISOString() }; changed(); };
  /** Write the team file into the folder (when the PC allows it): true when written. */
  async function writeFolderFile() {
    const w = await (await SH.dir.getFileHandle(TEAM_NAME, { create: true })).createWritable(); await w.write(SH.teamFileText()); await w.close();
    const f = await readFolderFile(); seen = f ? f.stamp : seen; SH.waiting = null;
    return true;
  }
  /**
   * Save to team folder (call it straight from a click): ask once a session whether Scope may write into the folder, read
   * the file again so nothing saved since is lost, save my changes (the first save when the folder has no file yet), then
   * write the file, or hand it over as a download. Resolves { version, how: 'written' | 'downloaded' } or null.
   */
  SH.save = async function (note) {
    if (!SH.repo) return null;
    if (SH.mode === 'folder' && SH.canWrite === null && SH.dir && SH.dir.requestPermission) { // first thing in the click: the browser asks only then
      try { SH.canWrite = (await SH.dir.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { SH.canWrite = false; }
    }
    await SH.pull(); // a save made since is merged by the save itself
    const st0 = SH.repo.status();
    const r = await SH.run(st0.empty ? SH.repo.init(note || 'First save') : SH.repo.save(note || ''));
    if (!r || r.conflicts || r === true || r === false) return null;
    if (r.nothing) { Scope.ui.toast('Nothing to save: you have no changes'); return null; }
    return { version: r.version, how: await SH.publish() };
  };
  /** Put the team file where the team reads it: written into the folder where allowed, else handed over as a download. */
  SH.publish = async function () {
    let how = 'downloaded';
    if (SH.mode === 'folder' && SH.canWrite) {
      try {
        // two people saving at the same moment: the file is looked at once more just before writing; when it changed, their
        // save comes in, mine goes on top as a new save (up to three times), so neither is lost
        for (let i = 0; i < 3; i++) {
          const f = await readFolderFile(); if (!f || f.stamp === seen) break;
          seen = f.stamp; loadTeamText(SH.teamFile.store, f.text, TEAM_NAME);
          await SH.repo.check();
          const r = await SH.repo.refresh(); if (r && r.conflicts) { await SH.askMerge(); }
          const again = await SH.repo.save('Saved at the same moment as another save'); if (again && again.conflicts) { Scope.ui.toast('Someone saved at the same moment and changed the same thing: choose which to keep, then save again.', 'warn'); changed(); return 'conflict'; }
        }
        await writeFolderFile(); how = 'written';
      } catch (e) { console.error(e); SH.canWrite = false; }
    }
    if (how === 'written') { Scope.ui.toast('Saved to the team folder: everyone is told within 20 seconds'); SH.writeCorrections(); }
    else { SH.downloadTeamFile(); Scope.ui.toast(`Saved. Now save "${TEAM_NAME}" from your downloads into ${SH.dir ? SH.dir.name : 'the team folder'}, replacing the old one: the team gets it from there.`, 'warn'); }
    changed();
    return how;
  };
  /** After a save that could not write into the folder: was a save handed over and not yet seen there? */
  SH.isWaiting = () => !!SH.waiting;
  /** corrections.csv next to the team file, every correction with its status, months, reason and who (only where Scope may write). */
  SH.writeCorrections = async function () {
    try {
      if (!SH.dir || !SH.canWrite || !Scope.corrections || !SH.dir.getFileHandle) return false;
      const text = Scope.corrections.csv(Scope.app && Scope.app.safeResult ? Scope.app.safeResult() : null);
      const w = await (await SH.dir.getFileHandle('corrections.csv', { create: true })).createWritable();
      await w.write('﻿' + text); await w.close();
      return true;
    } catch (e) { console.error('corrections.csv not written', e); return false; }
  };
  /** Stop sharing in this browser (the team folder and its file stay as they are). */
  SH.disconnect = async function () {
    unwatch(); if (SH.repo) SH.repo.disconnect();
    Object.assign(SH, { repo: null, dir: null, permission: '', mode: '', teamFile: null, canWrite: null, waiting: null, problem: '', unreachable: '' }); seen = '';
    const s = kv(); if (s) { try { await s.del('folder'); } catch (e) { /* nothing remembered */ } }
    changed();
  };
  /** The repository status, or null when no folder is connected. */
  SH.status = () => (SH.repo ? SH.repo.status() : null);

  // ---------- merging ----------
  /** Ask which value to keep where both changed the same field; resolves true when merged. */
  SH.askMerge = function () {
    const UI = Scope.ui, h = UI.h, st = SH.status(); if (!st || !st.conflicts) return Promise.resolve(true);
    const pick = {}, who = (st.head && st.head.by) || 'Someone';
    return new Promise((resolve) => {
      const rows = st.conflicts.map((c) => {
        pick[c.k] = 'theirs';
        const opt = (side, j) => h('label', { class: 'sh-pick' }, h('input', { type: 'radio', name: 'sh-' + c.k, checked: side === 'theirs', onChange: () => { pick[c.k] = side; } }), ' ', VC.show(j, 80));
        return h('tr', {}, h('td', {}, SH.describe({ p: c.p, b: c.base, a: c.mine }).where), h('td', {}, opt('theirs', c.theirs)), h('td', {}, opt('mine', c.mine)));
      });
      const m = UI.modal({ title: 'You both changed these', wide: true, onDismiss: () => { SH.repo.cancelMerge(); resolve(false); }, // closed with × or the backdrop: as "Not now"
        body: h('div', {}, h('p', {}, `${who} saved a newer version while you were working. Everything else merged by itself; pick which value to keep here.`),
          h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, `Theirs (${who})`), h('th', {}, 'Yours'))), h('tbody', {}, rows))),
        actions: [h('button', { class: 'btn', onClick: () => { m.close(); SH.repo.cancelMerge(); resolve(false); } }, 'Not now'),
          h('button', { class: 'btn btn-primary', onClick: async () => { m.close(); try { await SH.repo.resolve(pick); UI.toast('Merged: you are on the newest version, your changes on top'); resolve(true); } catch (e) { UI.toast(e.message, 'warn'); resolve(false); } } }, 'Keep these')] });
    });
  };
  /** Run a repository action and report it: conflicts open the merge dialog, errors become a toast. */
  SH.run = async function (p, done) {
    try { const r = await p; if (r && r.conflicts) return SH.askMerge(); if (done) Scope.ui.toast(typeof done === 'function' ? done(r) : done); return r; }
    catch (e) { Scope.ui.toast(e.message || String(e), 'warn'); return null; }
  };
  /** Bring in the newest version (my unsaved changes stay on top). */
  /** Get the newer save: it comes in, my unsaved changes on top (a field we both changed is asked about). */
  SH.refresh = () => SH.run(SH.repo.refresh(), (r) => (r.nothing ? 'Already up to date' : 'Team data updated: you have the newest save'));

  /** Before building a deck: read the team folder once more; when a newer save is there, ask whether to get it first. Resolves true (build). */
  SH.fresh = async function () {
    if (!SH.repo) return true;
    try { await SH.pull(); } catch (e) { console.error(e); }
    const st = SH.status(); if (!st || !st.ready || st.preview || !st.behind) return true;
    const UI = Scope.ui, h = UI.h;
    return new Promise((resolve) => {
      const m = UI.modal({ title: 'A newer save is in the team folder',
        body: h('p', {}, `${st.head.by} saved newer team data at ${when(st.head.at)}${st.head.note ? ` ("${st.head.note}")` : ''}. Get it before building, so the deck uses it?`),
        actions: [h('button', { class: 'btn', onClick: () => { m.close(); resolve(true); } }, 'Build without it'),
          h('button', { class: 'btn btn-primary', onClick: async () => { m.close(); await SH.refresh(); resolve(true); } }, 'Get it first')] });
    });
  };

  /** Top bar badge: the team data's state (up to date, unsaved changes, waiting to be put in the folder), or Reconnect. */
  SH.renderBadge = function (bar) {
    const h = Scope.ui.h, icon = Scope.icon, st = SH.status();
    if (!st) { if (SH.dir && SH.permission !== 'granted') bar.appendChild(h('button', { class: 'btn btn-sm', title: 'The browser asks once per visit before Scope reads the team folder', onClick: () => SH.connect(false) }, icon('folder', { size: 14 }), ' Reconnect team folder')); return; }
    if (!st.connected) return;
    if (SH.unreachable) { bar.appendChild(h('a', { href: Scope.href('shared'), class: 'badge badge-error', title: SH.unreachable }, icon('share-2', { size: 12 }), ' Team: folder not reachable')); return; }
    const label = st.empty ? 'Team: not shared yet' : st.needsLoad ? 'Team data: not loaded' : st.preview ? 'Viewing an older save' : st.behind ? 'Team: newer save' : st.unsaved ? `Team: ${st.unsaved} unsaved` : SH.waiting ? 'Team: put the file in the folder' : 'Team: up to date';
    bar.appendChild(h('a', { href: Scope.href('shared'), class: 'badge ' + (st.error ? 'badge-error' : st.behind || st.unsaved || st.needsLoad || SH.waiting ? 'badge-warn' : 'badge-ok'), title: st.error || `Team data in ${SH.dir ? SH.dir.name : st.folder}${st.head ? ` · last saved by ${st.head.by} at ${when(st.head.at)}` : ''}` }, icon('share-2', { size: 12 }), ' ', label));
  };
  /** Top bar notice row: an older save is open, a merge waits, a newer save is in the folder (Get it), or a save waits to be put there. */
  SH.renderNotice = function (bar) {
    const h = Scope.ui.h, icon = Scope.icon, st = SH.status();
    if (!st || !st.connected) return;
    if (st.preview) bar.appendChild(h('div', { class: 'sh-notice' }, icon('eye', { size: 14 }), h('span', {}, `Viewing the save of ${when(st.preview.at)} by ${st.preview.by}, read only: changes made while viewing are not kept.`),
      h('span', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', onClick: () => SH.run(SH.repo.endPreview(), 'Back to the team data') }, 'Back')));
    else if (st.conflicts) bar.appendChild(h('div', { class: 'sh-notice' }, icon('git-merge', { size: 14 }), h('span', {}, 'You and someone else changed the same thing: pick which to keep.'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', onClick: () => SH.askMerge() }, 'Choose')));
    else if (st.behind && st.ready) bar.appendChild(h('div', { class: 'sh-notice' }, icon('refresh-cw', { size: 14 }), h('span', {}, `${st.head.by} saved newer team data at ${when(st.head.at)}${st.head.note ? ` ("${st.head.note}")` : ''}. You are still on the earlier save${st.unsaved ? `; your ${st.unsaved} unsaved change${st.unsaved === 1 ? '' : 's'} stay on top when you get it` : ''}.`),
      h('span', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', disabled: !!st.busy || null, onClick: () => SH.refresh() }, 'Get it')));
    else if (SH.waiting) bar.appendChild(h('div', { class: 'sh-notice' }, icon('download', { size: 14 }), h('span', {}, `Your save is in your downloads: save "${TEAM_NAME}" into ${SH.dir ? SH.dir.name : 'the team folder'}, replacing the old one, so the team gets it.`),
      h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm', onClick: () => SH.downloadTeamFile() }, 'Download again'), h('button', { class: 'btn btn-sm', title: 'Hide this: the file is in the folder', onClick: () => { SH.waiting = null; changed(); } }, 'Done')));
  };
})(typeof window !== 'undefined' ? window : globalThis);
