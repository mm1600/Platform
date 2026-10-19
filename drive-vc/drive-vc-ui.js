/* drive-vc-ui: a ready-made bar and dialogs for drive-vc (optional; load after drive-vc.js).
 *
 *   const vc = DriveVC.ui({ appId: 'my-app', getState, setState });   // after the app changes its data: vc.touch()
 *
 * Draws one bar (top of the page, or inside opts.mount): connect a folder, Save with a note, History, and a notice
 * when someone saved a newer version (Refresh / What changed). History lists every version with what it changed,
 * View (read-only), Restore and Tag, and compares any two versions. When both people changed the same field it asks
 * which to keep. Colours come from CSS variables (--dvc-accent, --dvc-bg, --dvc-ink, --dvc-line) so it fits any page.
 * opts.store (e.g. DriveVC.memory()) skips the folder picker, for demos and tests.
 */
(function (root) {
  'use strict';
  const D = root.DriveVC;
  const CSS = `.dvc-bar,.dvc-dlg{--a:var(--dvc-accent,#0f7164);--bg:var(--dvc-bg,#fff);--ink:var(--dvc-ink,#212529);--line:var(--dvc-line,#dee2e6)}.dvc-bar{font:13px/1.4 system-ui,sans-serif;color:var(--ink);background:var(--bg);border-bottom:1px solid var(--line);padding:6px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dvc-fixed{position:sticky;top:0;z-index:50}.dvc-bar b{font-weight:600}.dvc-grow{flex:1}.dvc-muted{opacity:.7}.dvc-err{color:#b02a37}
.dvc-btn{font:inherit;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:4px;padding:3px 10px;cursor:pointer}.dvc-btn:hover{border-color:var(--a)}.dvc-btn:disabled{opacity:.5;cursor:default}
.dvc-pri{background:var(--a);border-color:var(--a);color:#fff}.dvc-note{flex-basis:100%;display:flex;gap:8px;align-items:center;background:#fff3cd;color:#664d03;border:1px solid #ffe69c;border-radius:4px;padding:5px 10px}
.dvc-dlg{border:1px solid #ccc;border-radius:6px;padding:0;max-width:min(900px,95vw);width:100%;font:13px/1.4 system-ui,sans-serif}.dvc-dlg::backdrop{background:rgba(0,0,0,.35)}
.dvc-dlg header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #eee;font-weight:600}.dvc-dlg section{padding:12px 14px;max-height:70vh;overflow:auto}
.dvc-dlg table{border-collapse:collapse;width:100%}.dvc-dlg td,.dvc-dlg th{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;vertical-align:top}.dvc-tag{background:#e7f1ff;border-radius:3px;padding:0 5px;margin-left:4px;font-size:11px}
.dvc-dlg footer{display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid #eee}.dvc-dlg input[type=text]{font:inherit;width:100%;padding:5px;box-sizing:border-box}`;
  /** el('button', { class, onclick }, ...children) */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === null || v === undefined || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  }
  const btn = (text, onclick, pri, disabled) => el('button', { class: 'dvc-btn' + (pri ? ' dvc-pri' : ''), onclick, disabled: !!disabled }, text);
  const when = (iso) => { try { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } };
  /** A dialog with a title, a body and buttons; resolves with the value passed to close(). */
  function dialog(title, body, buttons) {
    return new Promise((resolve) => {
      const d = el('dialog', { class: 'dvc-dlg' }), close = (v) => { d.close(); d.remove(); resolve(v); };
      d.append(el('header', {}, title, btn('×', () => close(null))), el('section', {}, typeof body === 'function' ? body(close) : body), buttons ? el('footer', {}, buttons(close)) : '');
      d.addEventListener('cancel', () => resolve(null)); document.body.append(d); d.showModal();
    });
  }
  const ask = (title, label, value) => dialog(title, (close) => { const i = el('input', { type: 'text', value: value || '', onkeydown: (e) => { if (e.key === 'Enter') close(i.value); } }); setTimeout(() => i.focus(), 0); ask.input = i; return el('label', {}, label, i); }, (close) => [btn('Cancel', () => close(null)), btn('OK', () => close(ask.input.value), true)]);
  const changeTable = (list) => list.length ? el('table', {}, el('tr', {}, el('th', {}, 'Where'), el('th', {}, 'Change')), list.map((c) => { const t = D.describe(c); return el('tr', {}, el('td', {}, t.where), el('td', {}, t.what)); })) : el('p', { class: 'dvc-muted' }, 'No differences.');

  D.ui = function (opts) {
    if (!document.getElementById('dvc-css')) document.head.append(el('style', { id: 'dvc-css' }, CSS));
    const appId = opts.appId || 'app', bar = el('div', { class: 'dvc-bar' + (opts.mount ? '' : ' dvc-fixed') });
    if (opts.mount) opts.mount.append(bar); else document.body.prepend(bar);
    const me = { repo: null, el: bar, touch: () => me.repo && me.repo.touch() };
    const nameKey = `dvc-name:${appId}`;
    const getName = () => { try { return localStorage.getItem(nameKey) || ''; } catch (e) { return ''; } };
    async function name() { let n = opts.user || getName(); if (!n) { n = await ask('Your name', 'Shown next to every version you save'); if (!n) return ''; try { localStorage.setItem(nameKey, n); } catch (e) { /* not kept */ } } return n; }
    async function attach(store) {
      me.repo = D.open(Object.assign({}, opts, { store, appId, user: () => opts.user || getName() || 'someone' }));
      me.repo.subscribe(draw); await me.repo.connect();
      if (opts.onConnect) opts.onConnect(me.repo);
    }
    const run = (p) => Promise.resolve(p).then((r) => { if (r && r.conflicts) return merge(); return r; }).catch((e) => { draw(); console.error(e); });
    async function connect(pick) {
      if (!D.supported()) return alert('This browser cannot write to a folder: open the page in Edge or Chrome.');
      let dir = pick ? null : await D.savedFolder(appId);
      if (!dir) dir = await D.pickFolder(appId).catch(() => null); if (!dir) return;
      const p = await D.permission(dir, true); if (p === 'prompt') return;
      if (!(await name())) return;
      await attach(D.folder(dir));
    }
    async function save() {
      if (!(await name())) return;
      const note = await ask('Save a new version', 'What changed (optional)'); if (note === null) return;
      run(me.repo.save(note));
    }
    async function merge() {
      const st = me.repo.status(), list = st.conflicts || [], pick = {};
      const res = await dialog('Both of you changed these', el('div', {}, el('p', {}, `${st.head ? st.head.by : 'Someone'} saved since you started. Pick which value to keep for each:`),
        el('table', {}, el('tr', {}, el('th', {}, 'Field'), el('th', {}, `Theirs (${st.head ? st.head.by : ''})`), el('th', {}, 'Yours')),
          list.map((c) => { pick[c.k] = 'theirs'; const r = (side, j) => el('label', {}, el('input', { type: 'radio', name: c.k, checked: side === 'theirs', onchange: () => { pick[c.k] = side; } }), ' ', D.show(j, 80)); return el('tr', {}, el('td', {}, c.p.join(' › ')), el('td', {}, r('theirs', c.theirs)), el('td', {}, r('mine', c.mine))); }))),
        (close) => [btn('Not now', () => close(false)), btn('Keep these', () => close(true), true)]);
      if (res) run(me.repo.resolve(pick)); else me.repo.cancelMerge();
    }
    async function history(focusFrom) {
      const list = await me.repo.history(), cur = me.repo.status().version;
      const sel = (dflt) => el('select', {}, list.map((e) => el('option', { value: e.id, selected: e.v === dflt }, `v${e.v} · ${e.by} · ${when(e.at)}`)));
      const from = sel(focusFrom || (list[1] && list[1].v)), to = sel(list[0] && list[0].v), out = el('div');
      const show = async (title, p) => { out.replaceChildren(el('p', {}, el('b', {}, title)), changeTable(await p)); out.scrollIntoView({ block: 'nearest' }); };
      await dialog('History', (close) => el('div', {},
        el('table', {}, el('tr', {}, ['', 'Who', 'When', 'Note', 'Changes', ''].map((t) => el('th', {}, t))), list.map((e) => el('tr', {},
          el('td', {}, el('b', {}, 'v' + e.v), e.v === cur ? el('span', { class: 'dvc-tag' }, 'yours') : '', (e.tags || []).map((t) => el('span', { class: 'dvc-tag' }, t))),
          el('td', {}, e.by), el('td', {}, when(e.at)), el('td', {}, e.note || ''), el('td', {}, e.n),
          el('td', {}, btn('Changes', () => show(`What v${e.v} changed`, me.repo.changesIn(e.id))), ' ',
            btn('View', () => { close(); run(me.repo.preview(e.id)); }), ' ',
            btn('Restore', async () => { if (confirm(`Make a new version equal to v${e.v}? Your unsaved changes are dropped; nothing in the history is erased.`)) { close(); run(me.repo.restore(e.id)); } }, false, !me.repo.status().ready || me.repo.status().preview), ' ',
            btn('Tag', async () => { const t = await ask(`Name v${e.v}`, 'e.g. "Q3 sign-off" or "Sent to Investor 4"'); if (t) { await me.repo.tag(e.id, t); close(); history(); } }))))),
        el('p', {}, 'Compare ', from, ' with ', to, ' ', btn('Compare', () => show('Differences', me.repo.compare(from.value, to.value)))), out));
    }
    function draw() {
      const st = me.repo ? me.repo.status() : null, parts = [];
      if (!st || !st.connected) parts.push(el('span', {}, el('b', {}, 'Shared folder'), ' · not connected'), btn('Connect', () => connect(false), true), btn('Choose another', () => connect(true)));
      else if (st.empty) parts.push(el('span', {}, el('b', {}, st.folder), ' has no shared data yet'), btn('Start here with what is open', () => name().then((n) => n && run(me.repo.init('First version'))), true));
      else if (st.needsLoad) parts.push(el('span', {}, el('b', {}, st.folder), ' holds shared data'), btn('Load it (replaces what is open here)', () => run(me.repo.load()), true));
      else if (st.preview) parts.push(el('span', { class: 'dvc-note' }, `Viewing v${st.preview.v} by ${st.preview.by} (${when(st.preview.at)}), read only`, el('span', { class: 'dvc-grow' }), btn('Back to latest', () => run(me.repo.endPreview()), true)));
      else {
        parts.push(el('span', {}, el('b', {}, st.folder), ` · v${st.version}`, st.unsaved ? ` · ${st.unsaved} unsaved` : ' · saved'));
        parts.push(btn('Save', save, !!st.unsaved, !st.unsaved || !!st.busy), btn('History', () => history()));
        if (st.conflicts) parts.push(btn('Finish merge', merge, true));
        if (st.behind) parts.push(el('div', { class: 'dvc-note' }, `Newer version v${st.head.v} saved by ${st.head.by} at ${when(st.head.at)}${st.head.note ? ` · "${st.head.note}"` : ''}`, el('span', { class: 'dvc-grow' }),
          btn('What changed', () => history(st.version)), btn('Refresh', () => run(me.repo.refresh()), true)));
      }
      if (st && st.busy) parts.push(el('span', { class: 'dvc-muted' }, st.busy + '…'));
      if (st && st.error) parts.push(el('span', { class: 'dvc-err' }, st.error));
      bar.replaceChildren(...parts);
    }
    draw();
    if (opts.store) attach(opts.store);
    else D.savedFolder(appId).then(async (dir) => { if (dir && (await D.permission(dir, false)) !== 'prompt') attach(D.folder(dir)); }).catch(() => {});
    return me;
  };
})(typeof window !== 'undefined' ? window : globalThis);
