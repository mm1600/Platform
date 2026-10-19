/* Scope page: Layer 3 · Pack designer (route #/designer).
 *
 * Build your own investor pack by dragging blocks onto a mock-up of the page: KPI tiles, charts and tables by any
 * dimension, asset tables with the columns you choose, one asset's card, the investor columns, the group split, the
 * changes since the previous Holdings, your own text, and the notes page. Blocks snap to a 24 × 12 grid, can be moved
 * and resized, and show the real figures of the selected view as you work. Download writes the same blocks to a native
 * PowerPoint deck in the house look (js/report/widgets.js on js/report/house.js), on your own template when one is kept.
 * Layouts are saved in this browser (localStorage) and can be exported as a small .json file to share.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, UI = Scope.ui, h = UI.h, store = Scope.store;
  const R = Scope.report, W = R.widgets, G = W.GRID;
  const KEY = 'scope.packDesigner', SAVED = 'scope.packLayouts';
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } };

  // ---------- state ----------
  const state = { layout: null, cur: 0, sel: null };
  function layout() {
    if (!state.layout) { state.layout = read(KEY, null) || W.standardLayout(); state.cur = 0; }
    if (!state.layout.slides.length) state.layout.slides.push({ title: 'New page', message: '', widgets: [] });
    state.cur = Math.max(0, Math.min(state.layout.slides.length - 1, state.cur));
    return state.layout;
  }
  const slide = () => layout().slides[state.cur];
  const save = () => write(KEY, state.layout);
  const selected = () => (slide().widgets || []).find((w) => w.id === state.sel) || null;

  /** The result for the Holdings sheet loaded before the current one (same view and currency), or null. */
  function previousResult(res) {
    const prev = store.state.previousHoldings;
    if (!prev || !prev.rows || (res.globalFilters || []).length) return null;
    try { return Scope.calc.aum.run(store.computeInput({ sheets: Object.assign({}, store.effectiveSheets(), { Holdings: { name: 'Holdings', rows: prev.rows } }) })); } catch (e) { return null; }
  }
  async function templateInForce() { const t = store.state.template; if (!t || !t.bytes) return null; return Scope.pptx.readTemplate(new Uint8Array(t.bytes), t.name); }

  // ---------- web preview of a block ----------
  function preview(w, ctx) {
    let c; try { c = W.content(w, ctx); } catch (e) { return h('div', { class: 'pd-text' }, h('p', { style: { color: 'var(--danger)' } }, String((e && e.message) || e))); }
    if (c.kind === 'kpi') return h('div', {}, h('div', { class: 'pd-kpi-label' }, c.label), h('div', { class: 'pd-kpi-value' }, c.value), h('div', { class: 'pd-kpi-sub' }, c.sub || ''));
    const parts = [];
    if (c.title) parts.push(h('div', { class: 'pd-wtitle' }, c.title));
    if (c.kind === 'chart') {
      const body = h('div', { class: 'pd-chart' });
      const items = c.categories.map((l, i) => ({ label: l, value: c.series[0].values[i], exposure_m: c.series[0].values[i] }));
      const fmt = (v) => U.fmt.m(v);
      requestAnimationFrame(() => { try { const C = Scope.charts; if (!C) return; if (c.type === 'doughnut') C.donut(body, { items, format: fmt }); else if (c.type === 'col') C.bar(body, { items, format: fmt }); else C.hbar(body, { items, format: fmt, rowH: Math.max(12, Math.min(26, Math.floor(body.clientHeight / Math.max(1, items.length)))) }); } catch (e) { body.textContent = String(e.message || e); } });
      parts.push(body, h('div', { class: 'pd-cap' }, `Figure – ${c.caption || ''}`));
      return h('div', {}, parts);
    }
    if (c.kind === 'table') {
      parts.push(h('table', {}, h('thead', {}, h('tr', {}, c.head.map((x, i) => h('th', { class: c.align[i] === 'right' ? 'r' : '' }, x)))),
        h('tbody', {}, c.rows.slice(0, 40).map((r) => h('tr', {}, r.map((v, i) => h('td', { class: c.align[i] === 'right' ? 'r' : '', style: v && v.color ? { color: '#' + v.color } : null }, v && typeof v === 'object' ? v.text : String(v === null || v === undefined ? '' : v))))))));
      return h('div', {}, parts);
    }
    if (c.kind === 'card') { parts.push(h('dl', {}, c.items.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))); return h('div', {}, parts); }
    parts.push(h('div', { class: 'pd-text' }, c.paras.map((p) => h('p', {}, p.runs ? p.runs.map((r) => (r.bold ? h('b', {}, r.text) : r.text)) : p.text))));
    return h('div', {}, parts);
  }

  // ---------- the page mock-up ----------
  function canvas(ctx, rerender) {
    const sl = slide();
    const cv = h('div', { class: 'pd-canvas' + (sl.cover ? ' pd-cover' : '') });
    // the style in force, as CSS variables for the mock-up (colours of headings, table headers, banding, text, rules)
    const P = ctx.C || {}; for (const [k, v] of Object.entries({ green: P.green, slate: P.slate, text: P.text, label: P.label, muted: P.muted, rule: P.rule, cell: P.cell, border: P.border })) if (v) cv.style.setProperty('--pd-' + k, '#' + v);
    if (P.font) cv.style.fontFamily = `"${P.font}", Arial, sans-serif`;
    const titleIn = h('input', { value: sl.title || '', placeholder: sl.cover ? 'Cover title (the view name when blank)' : 'Page title', 'aria-label': 'Page title', onInput: (e) => { sl.title = e.target.value; save(); } });
    const msgIn = h('input', { value: sl.message || '', placeholder: sl.cover ? 'Cover label (Quarterly report)' : 'One-line message under the title', 'aria-label': 'Message', onInput: (e) => { sl.message = e.target.value; save(); } });
    cv.appendChild(h('div', { class: 'pd-title' }, titleIn));
    cv.appendChild(h('div', { class: 'pd-msg' }, msgIn));
    cv.appendChild(h('div', { class: 'pd-corner' }, `${ctx.view} · ${ctx.res.quarter || ''} · ${ctx.ccy} m`));
    if (!sl.cover) cv.appendChild(h('div', { class: 'pd-rule' }));
    const body = h('div', { class: 'pd-body' });
    cv.appendChild(body);
    cv.appendChild(h('div', { class: 'pd-foot' }, h('span', {}, String(state.cur + 1)), h('span', {}, `Source: Holdings as of ${U.isoDate(ctx.res.reportingDate)}; Scope calculation`)));
    const pct = (v, n) => (v / n * 100) + '%';
    const place = (el, w) => { el.style.left = pct(w.x, G.cols); el.style.top = pct(w.y, G.rows); el.style.width = pct(w.w, G.cols); el.style.height = pct(w.h, G.rows); };
    const cell = (ev) => { const r = body.getBoundingClientRect(); return { col: Math.floor((ev.clientX - r.left) / r.width * G.cols), row: Math.floor((ev.clientY - r.top) / r.height * G.rows), cw: r.width / G.cols, rh: r.height / G.rows }; };
    for (const w of sl.widgets || []) {
      const el = h('div', { class: 'pd-widget' + (w.id === state.sel ? ' pd-sel' : ''), title: `${(W.TYPES[w.type] || {}).label || w.type} · drag to move, corner to resize, Delete to remove` });
      place(el, w);
      el.appendChild(preview(w, ctx));
      el.appendChild(h('button', { class: 'btn btn-ghost btn-sm pd-del', 'aria-label': 'Remove block', onClick: (e) => { e.stopPropagation(); sl.widgets = sl.widgets.filter((x) => x.id !== w.id); state.sel = null; save(); rerender(); } }, Scope.icon('x', { size: 12 })));
      const handle = h('div', { class: 'pd-handle', title: 'Resize' });
      el.appendChild(handle);
      // move: pointer drag on the block; resize: on the corner handle; both snap to the grid and save on release
      const start = (ev, mode) => {
        if (ev.button !== 0 || ev.target.tagName === 'BUTTON' || ev.target.closest('.pd-del')) return;
        ev.preventDefault(); state.sel = w.id; cv.querySelectorAll('.pd-widget.pd-sel').forEach((x) => x.classList.remove('pd-sel')); el.classList.add('pd-sel');
        const c0 = cell(ev), o = { x: w.x, y: w.y, w: w.w, h: w.h };
        const move = (e) => { const c1 = cell(e), dx = Math.round((e.clientX - ev.clientX) / c0.cw), dy = Math.round((e.clientY - ev.clientY) / c0.rh);
          if (mode === 'move') { w.x = o.x + dx; w.y = o.y + dy; } else { w.w = o.w + dx; w.h = o.h + dy; }
          W.clamp(w); place(el, w); void c1; };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(); rerender(); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      };
      el.addEventListener('pointerdown', (ev) => { if (ev.target === handle) return; start(ev, 'move'); });
      handle.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); start(ev, 'resize'); });
      el.addEventListener('click', (ev) => { ev.stopPropagation(); if (state.sel !== w.id) { state.sel = w.id; rerender(); } });
      body.appendChild(el);
    }
    // drop a block from the palette
    body.addEventListener('dragover', (ev) => { if (Array.from(ev.dataTransfer.types).includes('text/plain')) { ev.preventDefault(); cv.classList.add('pd-over'); } });
    body.addEventListener('dragleave', () => cv.classList.remove('pd-over'));
    body.addEventListener('drop', (ev) => { ev.preventDefault(); cv.classList.remove('pd-over'); const type = ev.dataTransfer.getData('text/plain'); if (!W.TYPES[type]) return; const c = cell(ev); const w = W.create(type, c.col, c.row); if (type === 'asset' && ctx.rows[0]) w.opts.code = ctx.rows[0].code; (sl.widgets = sl.widgets || []).push(w); state.sel = w.id; save(); rerender(); });
    cv.addEventListener('click', () => { if (state.sel) { state.sel = null; rerender(); } });
    return cv;
  }

  // ---------- the inspector of the selected block ----------
  function inspector(ctx, rerender) {
    const w = selected();
    if (!w) return h('div', { class: 'pd-side' }, h('h4', {}, 'Block'), h('p', { class: 'muted small' }, 'Drag a block from the left onto the page, or click one on the page to change what it shows.'));
    const t = W.TYPES[w.type] || {}, o = w.opts;
    const upd = () => { save(); rerender(); };
    const field = (label, el) => h('div', { class: 'pd-field' }, h('label', {}, label), el);
    const sel = (key, options, onChange) => h('select', { class: 'input', 'aria-label': key, onChange: (e) => { (onChange || ((v) => { o[key] = v; }))(e.target.value); upd(); } }, options.map(([v, l]) => h('option', { value: v, selected: String(o[key]) === String(v) }, l)));
    const num = (key, min, max) => h('input', { class: 'input', type: 'number', min, max, value: o[key], 'aria-label': key, onChange: (e) => { o[key] = +e.target.value || 0; upd(); } });
    const txt = (key, placeholder) => h('input', { class: 'input', value: o[key] || '', placeholder, 'aria-label': key, onChange: (e) => { o[key] = e.target.value; upd(); } });
    const checks = (key, list) => h('div', { class: 'pd-checks' }, list.map(([v, l]) => h('label', {}, h('input', { type: 'checkbox', checked: (o[key] || []).includes(v), onChange: (e) => { const cur = o[key] || []; o[key] = e.target.checked ? list.map((x) => x[0]).filter((x) => x === v || cur.includes(x)) : cur.filter((x) => x !== v); upd(); } }), ' ' + l)));
    const dims = W.DIMENSIONS();
    const parts = [h('h4', {}, t.label || w.type), h('p', { class: 'muted small' }, t.help || '')];
    if (w.type === 'kpi') parts.push(field('Figure', sel('metric', W.METRICS.map((m) => [m.id, m.label]))));
    if (w.type === 'chart') parts.push(field('Dimension', sel('dim', dims)), field('Chart', sel('type', [['bar', 'Horizontal bars'], ['col', 'Columns'], ['doughnut', 'Doughnut']])), field('Top n (0 = all)', num('top', 0, 30)), field('Title (blank = the dimension)', txt('title', '')));
    if (w.type === 'table') parts.push(field('Dimension', sel('dim', dims)), field('Top n (0 = all)', num('top', 0, 40)), field('Title', txt('title', '')));
    if (w.type === 'assets') parts.push(field('Rows (largest first)', num('top', 1, 60)), field('Columns', checks('columns', W.ASSET_COLUMNS.map((x) => [x[0], x[1]]))), field('Title', txt('title', '')));
    if (w.type === 'asset') parts.push(field('Asset', sel('code', ctx.rows.map((r) => [r.code, r.name]))), field('Details', checks('details', W.ASSET_DETAILS)), field('Title (blank = the asset name)', txt('title', '')));
    if (w.type === 'investors') parts.push(field('Rows', num('top', 1, 40)), field('Title', txt('title', '')));
    if (w.type === 'group') parts.push(field('Chart', sel('type', [['doughnut', 'Doughnut'], ['bar', 'Bars']])));
    if (w.type === 'changes') parts.push(field('Movements shown', num('top', 1, 20)), field('Title', txt('title', '')));
    if (w.type === 'text') parts.push(field('Title (optional)', txt('title', '')), field('Text (one paragraph per line)', h('textarea', { class: 'input', 'aria-label': 'text', onChange: (e) => { o.text = e.target.value; upd(); } }, o.text || '')));
    parts.push(h('div', { class: 'pd-field' }, h('label', {}, 'Position and size (grid cells)'), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } },
      ...[['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']].map(([k, l]) => h('input', { class: 'input', type: 'number', value: w[k], 'aria-label': l, title: l, onChange: (e) => { w[k] = +e.target.value || 0; W.clamp(w); upd(); } })))));
    parts.push(h('button', { class: 'btn btn-sm btn-danger', onClick: () => { const s = slide(); s.widgets = s.widgets.filter((x) => x.id !== w.id); state.sel = null; upd(); } }, Scope.icon('trash-2', { size: 14 }), ' Remove block'));
    return h('div', { class: 'pd-side' }, parts);
  }

  // ---------- the page ----------
  Scope.registerModule({
    id: 'designer', layer: 3, order: 2, title: 'Pack designer', status: 'built', icon: 'layout',
    render(el, ctx0) {
      const res = ctx0.result;
      el.appendChild(Scope.app.pageHead({ title: 'Pack designer', sub: 'build your own investor pack: drag blocks onto the page, move and resize them, then download the deck in the house look (or on your template)' }));
      if (!res || res.fatal) { el.appendChild(h('div', { class: 'notice warn' }, 'Load the four sheets on Data & validation first.')); return; }
      const L = layout(), ctx = W.context(res, previousResult(res), store.state.settings.reportStyle || null);
      const rerender = () => { el.innerHTML = ''; this.render(el, ctx0); };
      // toolbar: name, new / standard, save / load, export / import, download
      const saved = read(SAVED, {});
      const nameIn = h('input', { class: 'input', value: L.name || '', placeholder: 'Layout name', 'aria-label': 'Layout name', onChange: (e) => { L.name = e.target.value; save(); } });
      const loadSel = h('select', { class: 'input', 'aria-label': 'Saved layouts', onChange: (e) => { const v = e.target.value; if (!v) return; state.layout = JSON.parse(JSON.stringify(saved[v])); state.cur = 0; state.sel = null; save(); rerender(); } },
        [h('option', { value: '' }, saved && Object.keys(saved).length ? 'Load a saved layout…' : 'No saved layouts')].concat(Object.keys(saved).map((k) => h('option', { value: k }, k))));
      const picker = h('input', { type: 'file', accept: '.json', class: 'hidden', 'aria-label': 'Layout file', onChange: async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (!j || !Array.isArray(j.slides)) throw new Error('not a layout file'); state.layout = j; state.cur = 0; state.sel = null; save(); rerender(); UI.toast(`Layout loaded: ${j.name || f.name}`); } catch (err) { UI.toast(`Could not read the layout: ${err.message || err}`, 'warn'); } e.target.value = ''; } });
      el.appendChild(h('div', { class: 'pd-toolbar' },
        nameIn,
        h('button', { class: 'btn btn-sm', onClick: () => { if (global.confirm('Start a new empty layout? The current one stays saved only if you saved it under a name.')) { state.layout = { name: 'My pack', slides: [{ title: 'Page 1', message: '', widgets: [] }] }; state.cur = 0; state.sel = null; save(); rerender(); } } }, Scope.icon('file', { size: 14 }), ' New'),
        h('button', { class: 'btn btn-sm', onClick: () => { if (global.confirm('Replace the current layout with the standard pack?')) { state.layout = W.standardLayout(); state.cur = 0; state.sel = null; save(); rerender(); } } }, Scope.icon('copy', { size: 14 }), ' Standard pack'),
        h('button', { class: 'btn btn-sm', onClick: () => { const n = (nameIn.value || '').trim() || global.prompt('Name for this layout'); if (!n) return; L.name = n; saved[n] = JSON.parse(JSON.stringify(L)); write(SAVED, saved); save(); UI.toast(`Layout saved: ${n}`); rerender(); } }, Scope.icon('save', { size: 14 }), ' Save'),
        loadSel,
        L.name && saved[L.name] ? h('button', { class: 'btn btn-sm', onClick: () => { if (global.confirm(`Delete the saved layout "${L.name}"?`)) { delete saved[L.name]; write(SAVED, saved); rerender(); } } }, Scope.icon('trash-2', { size: 14 }), ' Delete saved') : null,
        picker, h('button', { class: 'btn btn-sm', onClick: () => picker.click() }, Scope.icon('upload', { size: 14 }), ' Import .json'),
        h('button', { class: 'btn btn-sm', onClick: () => UI.downloadText(`${(L.name || 'pack-layout').replace(/[^\w.-]+/g, '-')}.json`, JSON.stringify(L, null, 1)) }, Scope.icon('download', { size: 14 }), ' Export .json'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => { try { const out = R.custom({ res, prev: ctx.prev, layout: L, template: await templateInForce(), templateText: store.state.settings.reportTemplateText || 'dark', style: store.state.settings.reportStyle || null }); Scope.inputs.downloadBytes(out.filename, out.deck.toBytes(), Scope.pptx.MIME); UI.toast(`${out.filename} downloaded · ${out.deck.slides.length} slides`); } catch (e) { console.error(e); UI.toast(`Could not build the deck: ${(e && e.message) || e}`, 'warn'); } } }, Scope.icon('download', { size: 14 }), ' Download PowerPoint'),
        h('span', { class: 'small muted' }, `${res.platform.label} · ${res.displayCurrency}${store.state.template ? ' · on your template' : ''}`)));
      // pages
      const pages = h('div', { class: 'pd-slides' }, L.slides.map((s, i) => h('button', { class: 'pd-slide' + (i === state.cur ? ' cur' : ''), onClick: () => { state.cur = i; state.sel = null; rerender(); } }, `${i + 1} · ${s.title || (s.cover ? 'Cover' : 'untitled')}`)),
        h('button', { class: 'btn btn-sm', onClick: () => { L.slides.splice(state.cur + 1, 0, { title: 'New page', message: '', widgets: [] }); state.cur++; state.sel = null; save(); rerender(); } }, Scope.icon('plus', { size: 14 }), ' Add page'),
        h('button', { class: 'btn btn-sm', disabled: state.cur === 0, onClick: () => { const s = L.slides.splice(state.cur, 1)[0]; L.slides.splice(state.cur - 1, 0, s); state.cur--; save(); rerender(); } }, Scope.icon('arrow-left', { size: 14 })),
        h('button', { class: 'btn btn-sm', disabled: state.cur >= L.slides.length - 1, onClick: () => { const s = L.slides.splice(state.cur, 1)[0]; L.slides.splice(state.cur + 1, 0, s); state.cur++; save(); rerender(); } }, Scope.icon('arrow-right', { size: 14 })),
        h('button', { class: 'btn btn-sm', onClick: () => { const s = slide(); s.cover = !s.cover; save(); rerender(); } }, Scope.icon('layout', { size: 14 }), slide().cover ? ' Cover page: on' : ' Cover page: off'),
        h('button', { class: 'btn btn-sm btn-danger', disabled: L.slides.length <= 1, onClick: () => { if (global.confirm('Remove this page?')) { L.slides.splice(state.cur, 1); state.cur = Math.max(0, state.cur - 1); state.sel = null; save(); rerender(); } } }, Scope.icon('trash-2', { size: 14 }), ' Remove page'));
      el.appendChild(pages);
      // palette · page · inspector
      const palette = h('div', { class: 'pd-palette' }, h('h4', {}, 'Blocks'), Object.entries(W.TYPES).map(([type, t]) => h('div', { class: 'pd-item', draggable: true, title: 'Drag onto the page', onDragstart: (e) => { e.dataTransfer.setData('text/plain', type); e.dataTransfer.effectAllowed = 'copy'; },
        onDblclick: () => { const w = W.create(type, 0, 0); if (type === 'asset' && ctx.rows[0]) w.opts.code = ctx.rows[0].code; (slide().widgets = slide().widgets || []).push(w); state.sel = w.id; save(); rerender(); } },
        Scope.icon('move', { size: 13 }), h('span', {}, t.label, h('span', { class: 'pd-help' }, t.help)))),
        h('p', { class: 'pd-hint' }, 'Drag a block onto the page (or double-click it). On the page: drag to move, the corner to resize, Delete to remove. Figures are those of the selected view.'));
      const stage = h('div', { class: 'pd-stage' }, canvas(ctx, rerender));
      el.appendChild(h('div', { class: 'pd-wrap' }, palette, stage, inspector(ctx, rerender)));
      // Delete removes the selected block (one listener, replaced on every render, dropped when the page is left)
      if (state.onKey) document.removeEventListener('keydown', state.onKey);
      state.onKey = (e) => { if (!document.body.contains(el)) { document.removeEventListener('keydown', state.onKey); state.onKey = null; return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); const s = slide(); s.widgets = s.widgets.filter((x) => x.id !== state.sel); state.sel = null; save(); rerender(); } };
      document.addEventListener('keydown', state.onKey);
    },
  });
})(window);
