/* Scope core: one copy of the team's data in a shared folder, with every save kept as a version (Scope.shared).
 *
 * Built on js/core/drive-vc.js (the same file as the standalone drive-vc library: keep the two in step). Shared: the
 * loaded workbook sheets, the rows added to Mapping in the app, the corrections, the calculation and report settings,
 * the write-ups and their links, the market curves and the PowerPoint template. Kept in each browser: the view,
 * currency and filters, your name, saved Explorer views, grid layouts, custom sheets, designer layouts and the one-step
 * undo of a Holdings update.
 * Each person picks the folder once (Edge or Chrome can write to a folder; it works from file:// too). Scope then
 * checks the folder every 20 seconds, when the tab is shown again and before a deck is built; the top bar says when a
 * newer version is there and by whom. Saving, merging, history, restore and tags are on the Shared folder page
 * (js/modules/layer0-shared.js). Nothing leaves the folder: there is no server.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, store = Scope.store, VC = global.DriveVC;
  const APP = 'scope';
  const SHARED_SETTINGS = ['calcOverrides', 'reportStyle', 'reportInputs', 'writeupsUnlinked', 'reportTemplateText'];
  const SH = (Scope.shared = { repo: null, dir: null, permission: '', SHARED_SETTINGS });
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
  const SETTING = { calcOverrides: 'Calculation settings', reportStyle: 'Report style', reportInputs: 'Investor reporting', writeupsUnlinked: 'Write-ups not linked', reportTemplateText: 'Template text colour' };
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
  /** At start-up: reconnect the folder picked earlier when the browser still allows it (else the top bar offers Reconnect). */
  SH.init = async function () {
    if (!VC || !VC.supported()) return;
    store.subscribe(() => { if (SH.repo) SH.repo.touch(); });
    try {
      SH.dir = await VC.savedFolder(APP); if (!SH.dir) return;
      SH.permission = await VC.permission(SH.dir, false);
      if (SH.permission !== 'prompt') await SH.attach(VC.folder(SH.dir)); else changed();
    } catch (e) { console.error(e); }
  };
  /** Pick the folder (pick = true: always ask; otherwise the one used before) and connect; must run inside a click. */
  SH.connect = async function (pick) {
    if (!VC.supported()) { Scope.ui.toast('This browser cannot write to a folder: open Scope in Edge or Chrome', 'warn'); return null; }
    let dir = pick ? null : SH.dir;
    if (!dir) { try { dir = await VC.pickFolder(APP); } catch (e) { return null; } }
    SH.dir = dir; SH.permission = await VC.permission(dir, true);
    if (SH.permission === 'prompt') { Scope.ui.toast('Scope was not allowed to use the folder', 'warn'); changed(); return null; }
    return SH.attach(VC.folder(dir));
  };
  /** Stop using the folder in this browser (the folder and its history stay as they are). */
  SH.disconnect = async function () { if (SH.repo) SH.repo.disconnect(); SH.repo = null; SH.dir = null; SH.permission = ''; await VC.forgetFolder(APP); changed(); };
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
  SH.refresh = () => SH.run(SH.repo.refresh(), (r) => (r.nothing ? 'Already on the newest version' : `Now on version ${r.version}`));

  /**
   * Before building a deck: true when this browser is on the newest version (or no folder is used). When someone saved
   * since, ask: build from my version anyway, or refresh first (then the user downloads again).
   */
  SH.fresh = async function () {
    if (!SH.repo) return true;
    const st0 = SH.status(); if (!st0.ready || st0.preview) return true;
    await SH.repo.check(); const st = SH.status(); if (!st.behind) return true;
    const UI = Scope.ui, h = UI.h;
    return new Promise((resolve) => {
      const m = UI.modal({ title: 'A newer version is on the shared folder',
        body: h('p', {}, `${st.head.by} saved version ${st.head.v} (${when(st.head.at)}${st.head.note ? `: "${st.head.note}"` : ''}). You are on version ${st.version}. Refresh first so the deck uses the newest data?`),
        actions: [h('button', { class: 'btn', onClick: () => { m.close(); resolve(true); } }, `Build from version ${st.version}`),
          h('button', { class: 'btn btn-primary', onClick: async () => { m.close(); await SH.refresh(); Scope.ui.toast('Refreshed: download the deck again'); resolve(false); } }, 'Refresh first')] });
    });
  };

  /** Top bar badge: the version this browser is on and its unsaved changes (or Reconnect when the browser asks first). */
  SH.renderBadge = function (bar) {
    const h = Scope.ui.h, icon = Scope.icon, st = SH.status();
    if (!st) { if (SH.dir && SH.permission === 'prompt') bar.appendChild(h('button', { class: 'btn btn-sm', title: 'The browser asks once per visit before Scope may use the shared folder', onClick: () => SH.connect(false) }, icon('folder', { size: 14 }), ' Reconnect shared folder')); return; }
    if (!st.connected) return;
    const label = st.empty ? 'Shared folder: empty' : st.needsLoad ? 'Shared folder: not loaded' : st.preview ? `Viewing v${st.preview.v}` : `v${st.version}${st.unsaved ? ` · ${st.unsaved} unsaved` : ''}`;
    bar.appendChild(h('a', { href: Scope.href('shared'), class: 'badge ' + (st.error ? 'badge-error' : st.unsaved || st.behind || st.needsLoad ? 'badge-warn' : 'badge-ok'), title: st.error || `Shared folder ${st.folder}${st.busy ? ' · ' + st.busy : ''}` }, icon('share-2', { size: 12 }), ' ', label));
  };
  /** Top bar notice row: a newer version was saved (Refresh), an old version is open (Back to latest), or a merge waits. */
  SH.renderNotice = function (bar) {
    const h = Scope.ui.h, icon = Scope.icon, st = SH.status();
    if (!st || !st.connected) return;
    if (st.preview) bar.appendChild(h('div', { class: 'sh-notice' }, icon('eye', { size: 14 }), h('span', {}, `Viewing version ${st.preview.v} saved by ${st.preview.by} (${when(st.preview.at)}), read only: changes made while viewing are not kept.`),
      h('span', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', onClick: () => SH.run(SH.repo.endPreview(), 'Back to your data') }, 'Back to latest')));
    else if (st.behind && !st.conflicts) bar.appendChild(h('div', { class: 'sh-notice' }, icon('refresh-cw', { size: 14 }), h('span', {}, `Newer version ${st.head.v} saved by ${st.head.by} at ${when(st.head.at)}${st.head.note ? ` · "${st.head.note}"` : ''}. You are on version ${st.version}${st.unsaved ? `, with ${st.unsaved} unsaved change${st.unsaved === 1 ? '' : 's'} (kept on top)` : ''}.`),
      h('span', { class: 'spacer' }), h('a', { class: 'btn btn-sm', href: Scope.href('shared', 'history') }, 'What changed'), h('button', { class: 'btn btn-primary btn-sm', disabled: !!st.busy, onClick: () => SH.refresh() }, 'Refresh')));
    else if (st.conflicts) bar.appendChild(h('div', { class: 'sh-notice' }, icon('git-merge', { size: 14 }), h('span', {}, 'A merge is waiting: you and someone else changed the same fields.'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-sm', onClick: () => SH.askMerge() }, 'Finish merge')));
  };
})(typeof window !== 'undefined' ? window : globalThis);
