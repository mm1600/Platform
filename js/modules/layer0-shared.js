/* Scope page: Layer 0 · Shared folder (route #/shared, #/shared/history).
 *
 * The team's data in one file, "Scope team.json", in a folder on the team drive (js/core/shared.js on js/core/drive-vc.js).
 * Set up: pick the team folder once (Scope only reads it), or open the team file where folders are blocked. Then one card
 * says where you stand with the one button that fits: Share my data (nobody has yet), Use the team's data, Save to team
 * folder (changes only on this computer), Get it (a colleague saved), or Up to date. Older saves and what is
 * shared are folded underneath. Page styles: css/data.css (sh- classes).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, UI = Scope.ui, h = UI.h, store = Scope.store, SH = Scope.shared, VC = global.DriveVC;
  const ic = (n) => Scope.icon(n, { size: 14 });
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

  /** Ask for the team file with the browser's file box (a single file: allowed where folders are not); resolves with it, or null. */
  function pickTeamFile() {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
      input.addEventListener('change', () => { const f = input.files && input.files[0]; input.remove(); resolve(f || null); });
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });
      document.body.appendChild(input); input.click();
    });
  }
  /** Open the team file by hand (first time, or again for what was saved since). */
  async function openFile() {
    const f = await pickTeamFile(); if (!f) return;
    try {
      await (SH.mode === 'file' && SH.repo ? SH.updateTeamFile(f) : SH.openTeamFile(f));
      const st = SH.status();
      UI.toast(st && st.ready && st.behind ? `Opened ${f.name}: ${st.head.by} saved newer team data; Get it when you are ready` : st && st.head ? `Opened ${f.name}: last saved by ${st.head.by} at ${SH.when(st.head.at)}` : `Opened ${f.name}`);
    } catch (e) { UI.toast((e && e.message) || String(e), 'warn'); }
  }

  Scope.registerModule({
    id: 'shared', layer: 0, order: 2, title: 'Shared folder', status: 'built', icon: 'share-2', needsData: false,
    /** One card: where the team data is and where you stand, with the one button that fits; older saves and what is shared folded below. */
    render(el, ctx) {
      const st = SH.status(), repo = SH.repo, demo = store.state.datasetSource === 'demo', fileMode = SH.mode === 'file';
      el.appendChild(Scope.app.pageHead({ title: 'Shared folder', sub: 'the team works on the same data: Scope keeps it in one file in a folder on the team drive, and tells you when someone saves' }));
      const nameIn = h('input', { class: 'input sh-name', type: 'text', value: store.state.settings.user || '', placeholder: 'e.g. Sam', 'aria-label': 'Your name', 'data-focus': 'user', onChange: (e) => { const v = e.target.value.trim(); UI.deferSave(() => store.setSetting('user', v)); } });
      const nameRow = h('label', { class: 'sh-name-row muted' }, 'Your name, shown with your saves ', nameIn);
      const fileBtn = (primary, label) => h('button', { class: primary ? 'btn btn-primary' : 'btn btn-sm', onClick: openFile }, ic('file-text'), ' ' + (label || 'Open the team file…'));
      const save = async () => { if (await ensureName()) await SH.save(''); };

      // ---------- not set up (or the browser asks before reading the folder again) ----------
      if (!st || !st.connected) {
        let body;
        if (SH.dir && SH.permission !== 'granted') body = [h('p', {}, 'Team folder ', h('strong', {}, SH.dir.name), '. The browser asks once per visit before Scope reads it: click Reconnect and choose Allow (or "Allow on every visit").'),
          h('div', { class: 'sh-actions' }, h('button', { class: 'btn btn-primary', onClick: () => SH.connect(false) }, ic('refresh-cw'), ' Reconnect'), h('button', { class: 'btn btn-sm', onClick: () => SH.connect(true) }, ic('folder'), ' Pick another folder'))];
        else body = [h('p', {}, 'Pick the folder on the team drive where Scope keeps the team\'s data. Everyone picks the same one (make an empty folder the first time, e.g. "Scope team"). Scope only reads it and checks it every 20 seconds, so you see when a colleague saves and get it with one click.'),
          SH.canPick() ? h('div', { class: 'sh-actions' }, h('button', { class: 'btn btn-primary', onClick: () => SH.connect(true) }, ic('folder'), ' Pick the team folder…')) : null,
          SH.problem ? h('div', { class: 'notice error sh-problem', role: 'alert' }, SH.problem) : null,
          h('div', { class: 'muted sh-alt' }, SH.canPick() ? 'Folders blocked on this PC? ' : 'This browser cannot pick folders: ', fileBtn(!SH.canPick() || !!SH.problem), ` (the "${SH.TEAM_NAME}" file in the team folder; Scope reads it when you open it).`,
            h('button', { class: 'btn btn-sm', title: 'Nobody has made the team file yet: start it here, then Share my data gives you the file to put in the team folder', onClick: async () => { try { await SH.openTeamFile(null); UI.toast('New team file started: click Share my data, then save the file into the team folder'); } catch (e) { UI.toast((e && e.message) || String(e), 'warn'); } } }, ic('plus'), ' Start a new team file'))];
        el.appendChild(UI.section({ title: 'Share with the team', subtitle: 'once per person, in Edge or Chrome', body: [...body, nameRow] }));
        el.appendChild(whatIsShared());
        return SH.subscribe(() => ctx.app.render(true));
      }

      // ---------- set up: where you stand, and the button that fits ----------
      const where = fileMode ? h('span', {}, 'Team file ', h('strong', {}, SH.teamFile.name), ` (opened at ${SH.when(SH.teamFile.openedAt)})`) : h('span', {}, 'Team folder ', h('strong', {}, SH.dir ? SH.dir.name : st.folder), ` · the file "${SH.TEAM_NAME}" in it`);
      const last = st.head ? `Last saved by ${st.head.by} at ${SH.when(st.head.at)}${st.head.note ? ` ("${st.head.note}")` : ''}.` : '';
      const lines = [];
      const say = (kind, icon, text, ...btns) => h('div', { class: `sh-say sh-say-${kind}` }, ic(icon), h('span', {}, text), btns.length ? h('span', { class: 'sh-actions' }, btns) : null);
      if (st.empty) lines.push(demo
        ? say('warn', 'upload', 'Nobody has shared data here yet. Only the demo is open, and the demo is never shared: load your workbook first.', h('a', { class: 'btn btn-primary btn-sm', href: Scope.href('data', 'inputs') }, 'Load your workbook'))
        : say('warn', 'upload', 'Nobody has shared data here yet: share what you have open, and everyone who picks this folder gets it.', h('button', { class: 'btn btn-primary', disabled: !!st.busy || null, onClick: save }, ic('upload'), ' Share my data')));
      else if (st.needsLoad) lines.push(say('warn', 'download', `The team's data is here. ${last} Use it to work on the same data as everyone else (your view, filters and layouts stay).`,
        h('button', { class: 'btn btn-primary', disabled: !!st.busy || null, onClick: async () => { if (await confirmBox("Use the team's data", 'The workbook, Mapping rows, corrections and report settings in this browser are replaced by the team\'s. Your view, filters and layouts stay.', 'Use it')) SH.run(repo.load(), "You are on the team's data"); } }, ic('download'), " Use the team's data")));
      else if (st.conflicts) lines.push(say('warn', 'git-merge', 'You and someone else changed the same thing: pick which to keep.', h('button', { class: 'btn btn-primary btn-sm', onClick: () => SH.askMerge() }, 'Choose')));
      if (st.ready && !st.conflicts && st.behind) lines.push(say('warn', 'refresh-cw', `${st.head.by} saved newer team data at ${SH.when(st.head.at)}${st.head.note ? ` ("${st.head.note}")` : ''}. Get it when you are ready${st.unsaved ? ': your unsaved changes stay on top' : ''}.`, h('button', { class: 'btn btn-primary', disabled: !!st.busy || null, onClick: () => SH.refresh() }, ic('download'), ' Get it')));
      if (st.empty || st.needsLoad || st.conflicts) { /* said above */ }
      else if (st.unsaved) lines.push(say('warn', 'save', `You have ${st.unsaved} change${st.unsaved === 1 ? '' : 's'} only on this computer. ${last}`, h('button', { class: 'btn btn-primary', disabled: !!st.busy || demo || null, onClick: save }, ic('save'), ' Save to team folder')));
      else if (SH.waiting && !st.behind) lines.push(say('warn', 'download', `Saved. Now save "${SH.TEAM_NAME}" from your downloads into ${SH.dir ? SH.dir.name : 'the team folder'}, replacing the old one, so the team gets it.`,
        h('button', { class: 'btn btn-sm', onClick: () => SH.downloadTeamFile() }, 'Download again'), h('button', { class: 'btn btn-sm', onClick: () => { SH.waiting = null; ctx.app.render(true); } }, 'Done')));
      else if (!st.behind) lines.push(say('ok', 'check', `Up to date with the team. ${last}${fileMode ? ' Open the team file again to see saves made since.' : ' Scope checks the folder every 20 seconds and tells you when someone saves.'}`));
      if (SH.unreachable) lines.unshift(say('warn', 'alert-triangle', SH.unreachable + ' What you see is the team data as last read.', h('button', { class: 'btn btn-sm', onClick: () => SH.pull() }, 'Try again')));
      if (st.busy) lines.push(h('div', { class: 'muted' }, st.busy + '…'));
      if (st.error) lines.push(h('div', { class: 'notice error' }, st.error));
      if (st.ready && st.unsaved && !st.preview) lines.push(h('details', { class: 'sh-more' }, h('summary', {}, 'What changed on this computer'), changeTable(repo.unsaved())));
      const tools = h('div', { class: 'sh-actions sh-folder-actions' }, nameRow,
        fileMode ? fileBtn(false, 'Open the team file again') : null,
        SH.canPick() ? h('button', { class: 'btn btn-sm', onClick: () => SH.connect(true) }, ic('folder'), fileMode ? ' Use a team folder' : ' Change folder') : null,
        h('button', { class: 'btn btn-sm', onClick: async () => { if (await confirmBox('Stop sharing', 'Scope stops reading the team data in this browser. The team folder, its file and the data open here stay as they are.', 'Stop sharing')) SH.disconnect(); } }, ic('x'), ' Stop sharing'));
      el.appendChild(UI.section({ title: 'Team data', subtitle: where, body: [...lines, tools] }));

      // ---------- older saves, folded: look at one, or go back to it ----------
      if (st.ready && !st.empty) {
        const box = h('div', {}, UI.empty('Reading…'));
        el.appendChild(h('details', { class: 'section sh-older', open: ctx.params[0] === 'history' ? true : null }, h('summary', {}, 'Every save, oldest to newest'), box));
        repo.history().then((list) => {
          box.innerHTML = '';
          box.append(h('div', { class: 'sh-scroll' }, h('table', { class: 'tbl sh-history' },
            h('thead', {}, h('tr', {}, ['Saved', 'By', 'Note', ''].map((t) => h('th', {}, t)))),
            h('tbody', {}, list.slice().reverse().map((e, k, all) => { const i = all.length - 1 - k; return h('tr', { class: e.id === (st.head && st.head.id) ? 'sh-here' : '' },
              h('td', {}, `${k + 1}. `, SH.when(e.at), i === 0 ? h('span', { class: 'badge badge-primary sh-tag' }, 'latest') : null), h('td', {}, e.by), h('td', {}, e.note || ''),
              h('td', { class: 'sh-row-actions' },
                h('button', { class: 'btn btn-sm', disabled: !!st.busy || null, title: 'Open this save in Scope, read only, then go back', onClick: () => SH.run(repo.preview(e.id), 'Viewing an older save: read only') }, ic('eye'), ' View'),
                i === 0 ? null : h('button', { class: 'btn btn-sm', disabled: !!st.busy || null, onClick: async () => { if (await confirmBox('Go back to this save', `The team data goes back to the save of ${SH.when(e.at)} by ${e.by}, as a new save; nothing is erased. Unsaved changes in this browser are dropped.`, 'Go back')) { if (!(await ensureName())) return; const r = await SH.run(repo.restore(e.id)); if (r && r.version) SH.publish(); } } }, 'Go back to this'))); })))));
        }).catch((e) => { box.innerHTML = ''; box.append(h('div', { class: 'notice error' }, `Could not read the older saves: ${e.message}`)); });
      }
      el.appendChild(whatIsShared());
      return SH.subscribe(() => ctx.app.render(true));
    },
  });

  /** What the team data holds, and what stays yours (folded). */
  function whatIsShared() {
    return h('details', { class: 'section sh-older' }, h('summary', {}, 'What is shared'), h('div', { class: 'sh-cols' },
      h('div', {}, h('h4', {}, 'In the team file, the same for everyone'), h('ul', {}, ['The workbook sheets (Holdings, Mapping, Hardcoded, ESG Hardcoded, Ownership, and Output / Calculations when loaded)', 'Mapping rows added in Scope', 'Corrections, with their reasons', 'Calculation settings: the Ownership grid, column choices, parameters, FX', 'How the data folder is laid out (where each input comes from)', 'Investor reporting inputs, report style and template text colour', 'Write-ups and their links, market curves, the PowerPoint template'].map((t) => h('li', {}, t)))),
      h('div', {}, h('h4', {}, 'In this browser, yours only'), h('ul', {}, ['The view, currency, look-through and filters', 'Your name', 'Saved Explorer views, grid layouts, filter sets, custom sheets and designer layouts', 'The one-step undo of a Holdings update', 'Unsaved changes, until you save them'].map((t) => h('li', {}, t))))));
  }
})(window);
