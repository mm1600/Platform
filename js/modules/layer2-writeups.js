/* Scope page: Layer 2 · Asset write-ups (route #/writeups).
 *
 * Your write-ups workbook, the box per asset that the monitoring pages of the investor report show (ref, name, ratios
 * under Actual / Lock-up / Covenant, rating, description and recent events). Load it here (every sheet is read), see each
 * write-up linked to its asset (its name matched against every name an asset goes by, or as you set it) and how it will look. The
 * linked write-up shows on its asset's page; the investor report of a view carries the write-ups of the assets that view
 * holds. A blank workbook laid out the same way, one box per asset of the view, is one click away. Everything stays in
 * this browser (IndexedDB), never in the code or the repository.
 *
 * Exports Scope.ui.writeupBox(item, palette) for the asset page.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, UI = Scope.ui, h = UI.h;
  const store = Scope.store;
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const IMPACT = /^(neutral|positive|negative|no|limited|material)\b[^:]{0,24}impact\b|^impact\s*:/i;

  /** The write-ups kept in this browser: { name, sheets, at, items, links }, or null. */
  const kept = () => (store.state.reportData || {}).monitoring || null;
  /** The colours the deck uses (your style, else the template's theme, else the house look), so the preview matches it. */
  function palette() {
    const R = Scope.report, t = store.state.template, colors = t && t.summary && t.summary.colors;
    return R.palette(store.state.settings.reportStyle || null, colors && Object.keys(colors).length ? R.themeColumns(colors) : undefined);
  }
  /** The rows of every sheet of an .xlsx / .xlsm file as [{ name, rows }], each number as its cell shows it in Excel. */
  async function readGrids(file) {
    const wb = await Scope.inputs.readXlsx(new Uint8Array(await file.arrayBuffer()), { display: true }); // numbers as Excel shows them (6.62x, 565, 70%)
    return wb.order.map((n) => ({ name: n, rows: (wb.sheets[n] || {}).rows || [] }));
  }

  /**
   * One write-up as its monitoring slide shows it: the header bar in the deck's dark green, a pale tinted box, the name in
   * bold, the ratios in white boxes, the Rating row under them (the rating under the middle column), the description in
   * bold, dark ► bullets, the impact line in bold.
   */
  function writeupBox(m0, pal) {
    const P = pal || palette(), c = (k, d) => '#' + (P[k] || d), m = Scope.report.tidyWriteup(m0);
    // the ratios boxed; the Rating row always, the rating under the middle of the three columns
    const ratios = h('table', { class: 'wu-ratios' },
      h('thead', {}, h('tr', {}, h('th', {}), ['Actual', 'Lock-up', 'Covenant'].map((t) => h('th', {}, t)))),
      h('tbody', {}, (m.metrics || []).map((x) => h('tr', {}, h('th', {}, x.label), [x.actual, x.lockup, x.covenant].map((v) => h('td', { class: 'boxed' }, v || '')))),
        h('tr', {}, h('th', {}, 'Rating'), h('td', { colspan: 3 }, m.rating || ''))));
    return h('div', { class: 'wu-box', style: { color: c('text', '1D1D1B') } },
      h('div', { class: 'wu-head', style: { background: c('dark', '0F7164') } }, h('span', { class: 'wu-ref' }, 'Ref.'), h('span', { class: 'wu-name' }, 'Name'), h('span', { class: 'wu-desc' }, 'Description and recent events')),
      h('div', { class: 'wu-body', style: { background: c('tgreen', 'E7F4F1') } },
        h('div', { class: 'wu-left' }, h('span', { class: 'wu-ref' }, m.ref || ''), h('span', { class: 'wu-name' }, m.name), ratios),
        h('div', { class: 'wu-right' }, m.description ? h('p', {}, m.description) : null,
          (m.events || []).length ? h('ul', {}, m.events.map((t) => h('li', { class: IMPACT.test(t) ? 'impact' : '' }, t))) : null)));
  }
  Scope.ui.writeupBox = writeupBox;

  Scope.registerModule({
    id: 'writeups', layer: 2, order: 0.5, title: 'Asset write-ups', status: 'built', icon: 'file-text',
    render(el, ctx) {
      const res = ctx.result, R = Scope.report;
      el.appendChild(Scope.app.pageHead({ title: 'Asset write-ups', sub: 'your write-ups workbook: one box per asset (ratios, rating, description and recent events), linked to the assets; the investor report\'s monitoring pages and each asset\'s page show them' }));
      if (!res || res.fatal) { el.appendChild(h('div', { class: 'notice warn' }, 'Load the four sheets on Data & validation first.')); return; }
      const mon = kept(), links = (mon && mon.links) || {}, items = (mon && mon.items) || [];
      const setLinks = (next) => store.setReportData('monitoring', Object.assign({}, mon, { links: next }));

      // ---------- the workbook ----------
      const file = h('input', { type: 'file', accept: '.xlsx,.xlsm', class: 'hidden', 'aria-label': 'Write-ups workbook', onChange: async (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        try {
          const read = R.parseWriteups(await readGrids(f));
          if (!read.items.length) { UI.toast(`No write-ups found in ${f.name}: each box needs a name and Actual / Lock-up / Covenant or a Description column`, 'warn'); return; }
          store.setReportData('monitoring', { v: 2, name: f.name, sheets: read.sheets, sheet: read.sheets.join(', '), at: new Date().toISOString(), items: read.items, links }); // v2: values as Excel shows them
          UI.toast(`${read.items.length} write-up(s) read from ${f.name} (${read.sheets.length} sheet(s))`);
        } catch (err) { console.error(err); UI.toast(`Could not read ${f.name}: ${(err && err.message) || err}`, 'warn'); }
        e.target.value = '';
      } });
      const template = () => {
        const bytes = Scope.inputs.writeXlsx(R.writeupTemplate(res));
        Scope.inputs.downloadBytes(`write-ups-template-${U.slug(res.platform.label)}.xlsx`, bytes, XLSX_MIME);
        UI.toast(`Template downloaded: one box per asset of ${res.platform.label}`);
      };
      const L = mon ? R.linkWriteups(items, res, links) : [];
      const held = new Set(res.rows.map((r) => r.code)), unlinked = store.state.settings.writeupsUnlinked || 'include';
      const count = (f) => L.filter(f).length, inView = L.filter((l) => (l.codes.length ? l.codes.some((c) => held.has(c)) : unlinked !== 'omit'));
      el.appendChild(UI.section({ title: 'Your workbook', subtitle: 'laid out like the monitoring slide\'s table, one box per asset: its name next to the words Actual, Lock-up and Covenant, a row per ratio (its name in the same column or the next), a Rating row, and the description and recent events to the right (one cell with a line each, or a cell a row). Kept in this browser only.',
        body: h('div', {}, file,
          mon ? h('p', {}, h('b', {}, mon.name), ` · ${(mon.sheets || [mon.sheet]).filter(Boolean).length} sheet(s) · ${items.length} write-up(s) · read ${U.isoDate(new Date(mon.at))} · `,
            `${count((l) => l.how === 'auto')} linked by name, ${count((l) => l.how === 'set')} by hand, `,
            h('span', { class: count((l) => !l.codes.length) ? 'strong' : '' }, `${count((l) => !l.codes.length)} not linked`), ` · ${inView.length} in the ${res.platform.label} report`)
            : h('p', { class: 'muted' }, 'No write-ups loaded: the report\'s appendix has one empty page.'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' } },
            h('button', { class: 'btn btn-primary btn-sm', onClick: () => file.click() }, Scope.icon('upload', { size: 14 }), mon ? ' Load it again' : ' Load the workbook (.xlsx)'),
            h('button', { class: 'btn btn-sm', onClick: template, title: 'a blank workbook in the same layout, one box per asset of this view, named as the reports name them' }, Scope.icon('download', { size: 14 }), ' Blank template (.xlsx)'),
            mon ? h('button', { class: 'btn btn-sm', onClick: () => { store.setReportData('monitoring', null); UI.toast('Write-ups removed'); } }, Scope.icon('x', { size: 14 }), ' Remove') : null,
            h('label', { class: 'small', style: { marginLeft: '8px' }, title: 'a write-up linked to no asset cannot be matched to a view' }, 'Write-ups linked to no asset: ',
              h('select', { class: 'input', 'aria-label': 'Write-ups linked to no asset', onChange: (e) => store.setSetting('writeupsUnlinked', e.target.value) },
                [['include', 'in every report'], ['omit', 'left out']].map(([v, l]) => h('option', { value: v, selected: v === unlinked }, l)))))) }));
      if (!mon) return;
      if (mon.v !== 2) el.appendChild(h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, 'These write-ups were read by an earlier version of Scope, which added "x" and two decimals to every number. Load the workbook again (button above) so every value shows exactly as it does in Excel.'));

      // ---------- the write-ups and their links ----------
      const byCode = new Map(res.assets.map((a) => [a.code, a]));
      const groups = new Map(); for (const a of res.assets) if (a.asset_group) groups.set(a.asset_group, (groups.get(a.asset_group) || 0) + 1);
      const assetLabel = (a) => `${a.code_name || a.name} · ${a.code}`;
      const targetLabel = (t) => (!t ? '' : t.startsWith('group:') ? `${t.slice(6)} (${groups.get(t.slice(6)) || 0} assets)` : byCode.has(t) ? assetLabel(byCode.get(t)) : t);
      const options = [['auto', 'By name'], ['none', 'Not linked']]
        .concat(Array.from(groups).filter(([, n]) => n > 1).sort((x, y) => x[0].localeCompare(y[0])).map(([g, n]) => ['group:' + g, `${g} (${n} assets)`]))
        .concat(res.assets.slice().sort((x, y) => assetLabel(x).localeCompare(assetLabel(y))).map((a) => [a.code, assetLabel(a)]));
      const linkCell = (l) => {
        const cur = links[l.key] === undefined ? 'auto' : links[l.key];
        const sel = h('select', { class: 'input', style: { maxWidth: '230px', fontSize: '.8125rem', padding: '.15rem .5rem' }, 'aria-label': `Link for ${l.item.name}`, onClick: (e) => e.stopPropagation(),
          onChange: (e) => { const next = Object.assign({}, links); if (e.target.value === 'auto') delete next[l.key]; else next[l.key] = e.target.value; setLinks(next); } },
          options.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
        // which name matched (its kind and value), or what came closest
        const via = (l.via || [])[0], name = (v) => v ? `${v.type} “${v.value}”` : '', warn = { color: 'var(--warning)' };
        const note = l.how === 'auto' ? h('div', { class: 'small muted', title: (l.via || []).map((v) => `${assetLabel(byCode.get(v.code) || { code: v.code })}: ${name(v)} (${v.score})`).join('\n') }, `→ ${targetLabel(l.target)} · by ${name(via)}`)
          : l.how === 'ambiguous' ? h('div', { class: 'small', style: warn }, `${l.candidates.length} assets match as well (${l.candidates.slice(0, 3).map((c) => (byCode.get(c) || {}).code_name || c).join(', ')}${l.candidates.length > 3 ? ' …' : ''}): pick one`)
          : l.how === 'none' && cur === 'auto' ? h('div', { class: 'small', style: warn, title: l.checked ? `compared with ${l.checked.names} names of ${l.checked.assets} assets: ${l.checked.types.join(', ')}` : '' },
            l.near ? `no sure match; closest: ${assetLabel(byCode.get(l.near.code) || { code: l.near.code })} by ${name(l.near)}` : `no match among ${l.checked ? l.checked.names : 'the'} asset names`) : null;
        return h('div', {}, sel, note);
      };
      let selected = 0;
      const preview = h('div');
      const showPreview = () => { preview.innerHTML = ''; const l = L[selected]; if (!l) return; preview.appendChild(h('p', { class: 'small muted' }, `${l.item.name} · sheet ${l.item.sheet || mon.sheet || ''} · as on the monitoring slide`)); preview.appendChild(writeupBox(l.item)); };
      const trs = L.map((l, i) => h('tr', { class: 'clickable', onClick: () => { selected = i; trs.forEach((t, j) => t.classList.toggle('active', j === i)); showPreview(); } },
        h('td', { class: 'dim' }, l.item.ref || ''), h('td', { class: 'strong' }, l.item.name), h('td', {}, linkCell(l)),
        h('td', {}, l.codes.length ? (l.codes.some((c) => held.has(c)) ? 'Yes' : h('span', { class: 'dim' }, 'No')) : h('span', { class: 'dim' }, unlinked === 'omit' ? 'No' : 'Yes (not linked)')),
        h('td', {}, (R.tidyWriteup(l.item).metrics || []).map((x) => x.label).join(', ') || h('span', { class: 'dim' }, '–')), h('td', {}, R.tidyWriteup(l.item).rating || ''),
        h('td', { class: 'num' }, String((l.item.events || []).length))));
      if (trs[0]) trs[0].classList.add('active');
      el.appendChild(UI.section({ title: `Write-ups · ${L.length}`, subtitle: `each name is matched word by word against every name an asset goes by (name, code name, ID, transaction and asset group, every Mapping row, the name columns of Hardcoded and Holdings: security name, issuer, deal …), unless you set the link; "In this report" = the ${res.platform.label} report carries it. Click a row to see it.`,
        body: h('div', { class: 'tbl-scroll', style: { maxHeight: '420px' } }, h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Ref.'), h('th', {}, 'Name'), h('th', {}, 'Linked to'), h('th', {}, 'In this report'), h('th', {}, 'Ratios'), h('th', {}, 'Rating'), h('th', { class: 'num' }, 'Events'))),
          h('tbody', {}, trs))) }));
      el.appendChild(UI.section({ title: 'How it looks', subtitle: 'the write-up as the investor report\'s monitoring page draws it, in the deck\'s colours', body: preview }));
      showPreview();
    },
  });
})(window);
