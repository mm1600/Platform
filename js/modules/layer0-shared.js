/* Scope page: Layer 0 · Shared folder (route #/shared, #/shared/history).
 *
 * One copy of the data for the whole team in a shared folder, every save kept as a version (js/core/shared.js on
 * js/core/drive-vc.js). The page connects the folder and sets your name, saves your changes with a note, refreshes to
 * the newest version and lists your unsaved changes. Its history shows every version (who, when, note, what it
 * changed), compares any two, opens one read-only, restores one as a new version (nothing is erased) and tags one
 * ("Q3 sign-off"). Page styles: css/data.css (sh- classes).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, UI = Scope.ui, h = UI.h, store = Scope.store, SH = Scope.shared, VC = global.DriveVC;
  const ic = (n) => Scope.icon(n, { size: 14 });
  const detail = { title: '', list: null }; // the change list shown under the history (kept across re-renders)
  /** Scroll to an element, clear of the sticky top bar. */
  const reveal = (n, block) => { const bar = document.getElementById('topbar'); n.style.scrollMarginTop = `${(bar ? bar.offsetHeight : 0) + 12}px`; n.scrollIntoView({ block: block || 'start', behavior: 'smooth' }); };

  /** The changes of a version (or between two) as a Where / Change table. */
  function changeTable(list) {
    if (!list.length) return UI.empty('No differences.');
    return h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Where'), h('th', {}, 'Change'))),
      h('tbody', {}, list.map((c) => { const d = SH.describe(c); return h('tr', {}, h('td', {}, d.where), h('td', {}, d.what)); })));
  }
  /** A one-field dialog; resolves with the text, or null when cancelled. */
  function ask(title, label, value, hint) {
    return new Promise((resolve) => {
      const input = h('input', { class: 'input', type: 'text', value: value || '', style: { width: '100%' }, onKeydown: (e) => { if (e.key === 'Enter') { m.close(); resolve(input.value.trim()); } } });
      const m = UI.modal({ title, body: h('label', { class: 'sh-ask' }, label, input, hint ? h('div', { class: 'muted' }, hint) : null),
        actions: [h('button', { class: 'btn', onClick: () => { m.close(); resolve(null); } }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => { m.close(); resolve(input.value.trim()); } }, 'OK')] });
      setTimeout(() => input.focus(), 0);
    });
  }
  /** A yes/no dialog; resolves true on yes. */
  function confirmBox(title, text, yes) {
    return new Promise((resolve) => {
      const m = UI.modal({ title, body: h('p', {}, text), actions: [h('button', { class: 'btn', onClick: () => { m.close(); resolve(false); } }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => { m.close(); resolve(true); } }, yes)] });
    });
  }
  /** Your name, asked once when missing (it is shown next to every version you save). */
  async function ensureName() {
    if (store.state.settings.user) return true;
    const n = await ask('Your name', 'Shown next to every version you save', '', 'Kept in this browser; change it on this page.');
    if (!n) return false; store.setSetting('user', n); return true;
  }

  Scope.registerModule({
    id: 'shared', layer: 0, order: 2, title: 'Shared folder', status: 'built', icon: 'share-2', needsData: false,
    render(el, ctx) {
      const st = SH.status(), repo = SH.repo, demo = store.state.datasetSource === 'demo';
      if (detail.list && (!st || st.version !== detail.version)) detail.list = null; // a list from before a save or refresh is out of date
      detail.version = st && st.version;
      el.appendChild(Scope.app.pageHead({ title: 'Shared folder', sub: 'one copy of the data for the whole team on a shared drive, every save kept as a version you can look at, compare or restore' }));
      if (!VC || !VC.supported()) el.appendChild(h('div', { class: 'notice error' }, 'This browser cannot write to a folder. Open Scope in Microsoft Edge or Google Chrome to share the data; everything else works here as before.'));

      // ---------- the folder ----------
      const nameIn = h('input', { class: 'input', type: 'text', value: store.state.settings.user || '', placeholder: 'e.g. Sam', 'aria-label': 'Your name', onChange: (e) => store.setSetting('user', e.target.value.trim()) });
      const rows = [['Your name', h('span', {}, nameIn, h('span', { class: 'muted' }, ' shown next to every version you save'))]];
      const actions = [];
      if (!st || !st.connected) {
        rows.unshift(['Folder', SH.dir ? `${SH.dir.name} (the browser asks once per visit before Scope may use it)` : 'none picked yet']);
        if (SH.dir) actions.push(h('button', { class: 'btn btn-primary', onClick: () => SH.connect(false) }, ic('folder'), ` Reconnect ${SH.dir.name}`));
        actions.push(h('button', { class: SH.dir ? 'btn' : 'btn btn-primary', disabled: !VC || !VC.supported(), onClick: () => SH.connect(true) }, ic('folder'), SH.dir ? ' Choose another folder' : ' Choose the shared folder'));
      } else {
        rows.unshift(['Folder', st.folder]);
        if (st.ready) {
          rows.push(['You are on', `version ${st.version}${st.preview ? ` (viewing version ${st.preview.v}, read only)` : ''}`]);
          if (st.head) rows.push(['Newest', h('span', {}, `version ${st.head.v}, saved by ${st.head.by} at ${SH.when(st.head.at)}${st.head.note ? ` · "${st.head.note}"` : ''}`, st.behind ? h('span', { class: 'badge badge-warn', style: { marginLeft: '.5rem' } }, 'newer than yours') : '')]);
          rows.push(['Unsaved changes', st.unsaved ? `${st.unsaved} (kept in this browser until you save)` : 'none']);
        }
        if (st.busy) rows.push(['Now', st.busy + '…']);
        if (st.error) rows.push(['Problem', h('span', { style: { color: 'var(--danger)' } }, st.error)]);
      }
      const body = [UI.dl(rows)];
      if (st && st.empty) body.push(h('div', { class: 'notice info' }, 'This folder has no Scope data yet. Put what is open here as version 1, then everyone who picks this folder loads it.',
        h('div', { class: 'sh-actions' }, h('button', { class: 'btn btn-primary', disabled: demo || !!st.busy, title: demo ? 'Load your workbook first: the demo is never shared' : '', onClick: async () => { if (await ensureName()) SH.run(repo.init('First version'), 'Version 1 saved in the shared folder'); } }, ic('upload'), ' Put my data here as version 1'),
          demo ? h('span', { class: 'muted' }, ' Load your workbook first: the demo is never shared.') : null)));
      if (st && st.needsLoad) body.push(h('div', { class: 'notice info' }, `This folder holds the team's data${st.head ? ` (version ${st.head.v}, saved by ${st.head.by} at ${SH.when(st.head.at)})` : ''}. Load it to work on the same version as everyone else.`,
        h('div', { class: 'sh-actions' }, h('button', { class: 'btn btn-primary', disabled: !!st.busy, onClick: async () => { if (await confirmBox('Load the shared data', 'The workbook, Mapping rows, corrections and report settings in this browser are replaced by the shared version. Your view, filters and layouts stay.', 'Load it')) SH.run(repo.load(), (r) => `Loaded version ${r.version}`); } }, ic('download'), ' Load the shared data'))));
      if (st && st.ready && !st.preview) {
        const note = h('input', { class: 'input sh-note', type: 'text', placeholder: 'What changed, e.g. "October holdings, Deal 01 mapped"', 'aria-label': 'Note for this version' });
        const save = async () => { if (!(await ensureName())) return; SH.run(repo.save(note.value.trim()), (r) => (r.nothing ? 'Nothing to save' : `Saved as version ${r.version}`)); };
        note.addEventListener('keydown', (e) => { if (e.key === 'Enter' && st.unsaved) save(); });
        body.push(h('div', { class: 'sh-actions' }, note,
          h('button', { class: 'btn btn-primary', disabled: !st.unsaved || !!st.busy || demo || !!st.conflicts, onClick: save }, ic('save'), ' Save version'),
          h('button', { class: 'btn', disabled: !!st.busy, onClick: () => SH.refresh() }, ic('refresh-cw'), st.behind ? ` Refresh to version ${st.head.v}` : ' Check for a newer version'),
          st.conflicts ? h('button', { class: 'btn btn-primary', onClick: () => SH.askMerge() }, ic('git-merge'), ' Finish merge') : null));
      }
      if (st && st.connected) actions.push(h('button', { class: 'btn btn-sm', onClick: () => SH.connect(true) }, ic('folder'), ' Choose another folder'),
        h('button', { class: 'btn btn-sm', onClick: async () => { if (await confirmBox('Stop using this folder', 'Scope stops checking the folder in this browser. The folder, its versions and the data open here stay as they are.', 'Stop using it')) SH.disconnect(); } }, ic('x'), ' Stop using this folder'));
      el.appendChild(UI.section({ title: 'Folder', subtitle: 'each person picks the folder once; Scope checks it every 20 seconds, when you come back to the tab and before a deck is built', body: [body, h('div', { class: 'sh-actions' }, actions)] }));

      // ---------- unsaved changes ----------
      if (st && st.ready && !st.preview && st.unsaved) el.appendChild(UI.section({ title: 'Your unsaved changes', subtitle: 'kept in this browser; Save puts them in the folder as a new version, merged with anything saved since', body: changeTable(repo.unsaved()) }));

      // ---------- history ----------
      if (st && st.connected && !st.empty) {
        const box = h('div', {}, UI.empty('Reading the history…')), out = h('div', { class: 'sh-detail' });
        const show = async (title, p) => { try { detail.title = title; detail.list = await p; paint(); reveal(out, 'nearest'); } catch (e) { UI.toast(e.message, 'warn'); } };
        const paint = () => { out.innerHTML = ''; if (detail.list) out.append(h('h4', {}, detail.title), changeTable(detail.list)); };
        el.appendChild(UI.section({ id: 'history', title: 'History', subtitle: 'every version saved in the folder, newest first; restoring makes a new version, so nothing is ever erased', body: [box, out] }));
        repo.history().then((list) => {
          box.innerHTML = '';
          const sel = (v) => h('select', { class: 'input' }, list.map((e) => h('option', { value: e.id, selected: e.v === v }, `v${e.v} · ${e.by} · ${SH.when(e.at)}`)));
          const from = sel(list[1] ? list[1].v : list[0] && list[0].v), to = sel(list[0] && list[0].v);
          const can = st.ready && !st.busy;
          box.append(h('div', { class: 'sh-scroll' }, h('table', { class: 'tbl sh-history' },
            h('thead', {}, h('tr', {}, ['Version', 'Saved', 'By', 'Note', 'Changes', ''].map((t) => h('th', {}, t)))),
            h('tbody', {}, list.map((e) => h('tr', { class: e.v === st.version ? 'sh-here' : '' },
              h('td', {}, h('strong', {}, `v${e.v}`), e.v === st.version ? h('span', { class: 'badge badge-primary sh-tag' }, 'yours') : null, (e.tags || []).map((t) => h('span', { class: 'badge sh-tag', title: 'Tag: click to remove', onClick: async () => { if (await confirmBox('Remove tag', `Remove the tag "${t}"? The version stays.`, 'Remove')) SH.run(repo.untag(t), 'Tag removed').then(() => ctx.app.render(true)); } }, ic('tag'), ' ', t))),
              h('td', {}, SH.when(e.at)), h('td', {}, e.by), h('td', {}, e.restore ? h('span', {}, e.note || '', h('span', { class: 'muted' }, ` (restore of v${e.restore})`)) : e.note || ''), h('td', { class: 'num' }, e.n),
              h('td', { class: 'sh-row-actions' },
                h('button', { class: 'btn btn-sm', onClick: () => show(`What version ${e.v} changed`, repo.changesIn(e.id)) }, 'Changes'),
                h('button', { class: 'btn btn-sm', disabled: !can, title: 'Open this version in Scope, read only (every page and deck), then go back to yours', onClick: () => SH.run(repo.preview(e.id), `Viewing version ${e.v}: read only`).then((r) => { if (r) Scope.navigate('aum'); }) }, ic('eye'), ' View'),
                h('button', { class: 'btn btn-sm', disabled: !can || e.id === (st.head && st.head.id), onClick: async () => { if (await confirmBox(`Restore version ${e.v}`, `A new version is saved with the data of version ${e.v}. Nothing in the history is erased. Unsaved changes in this browser are dropped.`, 'Restore')) { if (await ensureName()) SH.run(repo.restore(e.id), (r) => `Version ${e.v} restored as version ${r.version}`); } } }, 'Restore'),
                h('button', { class: 'btn btn-sm', disabled: !!st.busy, onClick: async () => { const t = await ask(`Tag version ${e.v}`, 'Name', '', 'e.g. "Q3 sign-off" or "Sent to Investor 4". The same name moves if used again.'); if (t) SH.run(repo.tag(e.id, t), 'Tagged').then(() => ctx.app.render(true)); } }, ic('tag'), ' Tag'))))))),
            list.length > 1 ? h('div', { class: 'sh-actions' }, 'Compare', from, 'with', to, h('button', { class: 'btn btn-sm', onClick: () => show('Differences', repo.compare(from.value, to.value)) }, ic('columns'), ' Compare')) : '');
          if (ctx.params[0] === 'history' && st.behind && !detail.list) show(`What changed since your version ${st.version}`, repo.compare(list.find((e) => e.v === st.version).id, list[0].id));
          else paint();
          if (ctx.params[0] === 'history') reveal(document.getElementById('history'));
        }).catch((e) => { box.innerHTML = ''; box.append(h('div', { class: 'notice error' }, `Could not read the history: ${e.message}`)); });
      }

      // ---------- what is shared ----------
      el.appendChild(UI.section({ title: 'What is shared', body: h('div', { class: 'sh-cols' },
        h('div', {}, h('h4', {}, 'In the folder, the same for everyone'), h('ul', {}, ['The workbook sheets (Holdings, Mapping, Hardcoded, ESG Hardcoded, Ownership, and Output / Calculations when loaded)', 'Mapping rows added in Scope', 'Corrections, with their reasons', 'Calculation settings: the Ownership grid, column choices, parameters, FX', 'Investor reporting inputs, report style and template text colour', 'Write-ups and their links, market curves, the PowerPoint template'].map((t) => h('li', {}, t)))),
        h('div', {}, h('h4', {}, 'In this browser, yours only'), h('ul', {}, ['The view, currency, look-through and filters', 'Your name', 'Saved Explorer views, grid layouts, filter sets, custom sheets and designer layouts', 'The one-step undo of a Holdings update (the history replaces it)', 'Unsaved changes, until you save'].map((t) => h('li', {}, t))))) }));

      return SH.subscribe(() => ctx.app.render(true));
    },
  });
})(window);
