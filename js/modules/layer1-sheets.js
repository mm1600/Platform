/* Scope page: Layer 1 · Custom sheets (route #/sheets).
 *
 * Your own output sheet: pick any columns (every named field of the Explorer and every raw column of the Holdings,
 * Hardcoded and ESG sheets), order them, give them your own headings, save the set under a name and download it as
 * .xlsx or CSV, for the selected view, currency and filters. Sets are kept in this browser (localStorage) and can be
 * exported as a small .json to share. The rows come from js/analysis/sheets.js, so they are what every page shows.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, UI = Scope.ui, h = UI.h, store = Scope.store, SH = Scope.sheets;
  const KEY = 'scope.customSheet', SAVED = 'scope.customSheets';
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ } };
  const state = { def: null, search: '' };
  function def() { if (!state.def) state.def = read(KEY, null) || { name: 'My sheet', grain: 'assets', columns: SH.PRESETS['Output sheet (standard)'].columns.map((id) => ({ id })), includeExcluded: false }; return state.def; }
  const save = () => write(KEY, state.def);

  Scope.registerModule({
    id: 'sheets', layer: 1, order: 1.45, title: 'Custom sheets', status: 'built', icon: 'table',
    render(el, ctx) {
      const res = ctx.result;
      el.appendChild(Scope.app.pageHead({ title: 'Custom sheets', sub: 'your own output sheet: any columns, your headings, saved under a name, downloaded as .xlsx or CSV for the selected view, currency and filters' }));
      if (!res || res.fatal) { el.appendChild(h('div', { class: 'notice warn' }, 'Load the four sheets on Data & validation first.')); return; }
      const D = def(), DS = Scope.engine.dataset, ds = D.grain === 'positions' ? DS.build(res) : DS.buildAssets(res);
      const rerender = () => { el.innerHTML = ''; this.render(el, ctx); };
      const saved = read(SAVED, {});
      // ---------- toolbar ----------
      const nameIn = h('input', { class: 'input', value: D.name || '', placeholder: 'Sheet name', 'aria-label': 'Sheet name', onChange: (e) => { D.name = e.target.value; save(); } });
      const loadSel = h('select', { class: 'input', 'aria-label': 'Saved sheets', onChange: (e) => { const v = e.target.value; if (!v) return; if (saved[v]) { state.def = JSON.parse(JSON.stringify(saved[v])); } else if (SH.PRESETS[v]) { const p = SH.PRESETS[v]; state.def = { name: v, grain: p.grain, columns: p.columns.map((id) => ({ id })), includeExcluded: false }; } save(); rerender(); } },
        [h('option', { value: '' }, 'Load a saved sheet or a starting set…')].concat(Object.keys(saved).map((k) => h('option', { value: k }, k)), h('option', { disabled: true }, '— starting sets —'), Object.keys(SH.PRESETS).map((k) => h('option', { value: k }, k))));
      const picker = h('input', { type: 'file', accept: '.json', class: 'hidden', 'aria-label': 'Sheet definition file', onChange: async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (!j || !Array.isArray(j.columns)) throw new Error('not a sheet definition'); state.def = j; save(); rerender(); UI.toast(`Sheet definition loaded: ${j.name || f.name}`); } catch (err) { UI.toast(`Could not read the file: ${err.message || err}`, 'warn'); } e.target.value = ''; } });
      const download = (kind) => { try { const b = SH.build(res, D); const fname = `${(D.name || 'custom-sheet').replace(/[^\w.-]+/g, '-')}-${res.platform.id.replace(/[^\w.-]+/g, '-')}-${U.isoDate(res.reportingDate)}`;
        if (kind === 'csv') { UI.downloadText(fname + '.csv', Scope.csv.serialize(b.values.map((row) => Object.fromEntries(row.map((v, i) => [b.headers[i], v === null ? '' : v]))))); }
        else Scope.inputs.downloadBytes(fname + '.xlsx', SH.toXlsx(res, D));
        UI.toast(`${fname}.${kind} downloaded · ${b.count} rows × ${b.headers.length} columns`); } catch (err) { console.error(err); UI.toast(`Could not build the sheet: ${err.message || err}`, 'warn'); } };
      el.appendChild(h('div', { class: 'cs-toolbar' },
        nameIn,
        h('select', { class: 'input', 'aria-label': 'Rows', onChange: (e) => { D.grain = e.target.value; save(); rerender(); } }, [['assets', 'One row per asset (the Output rows)'], ['positions', 'One row per position (Holdings rows)']].map(([v, l]) => h('option', { value: v, selected: D.grain === v }, l))),
        h('button', { class: 'btn btn-sm', onClick: () => { const n = (nameIn.value || '').trim() || global.prompt('Name for this sheet'); if (!n) return; D.name = n; saved[n] = JSON.parse(JSON.stringify(D)); write(SAVED, saved); save(); UI.toast(`Sheet saved: ${n}`); rerender(); } }, Scope.icon('save', { size: 14 }), ' Save'),
        loadSel,
        D.name && saved[D.name] ? h('button', { class: 'btn btn-sm', onClick: () => { if (global.confirm(`Delete the saved sheet "${D.name}"?`)) { delete saved[D.name]; write(SAVED, saved); rerender(); } } }, Scope.icon('trash-2', { size: 14 }), ' Delete saved') : null,
        picker, h('button', { class: 'btn btn-sm', onClick: () => picker.click() }, Scope.icon('upload', { size: 14 }), ' Import .json'),
        h('button', { class: 'btn btn-sm', onClick: () => UI.downloadText(`${(D.name || 'custom-sheet').replace(/[^\w.-]+/g, '-')}.json`, JSON.stringify(D, null, 1)) }, Scope.icon('download', { size: 14 }), ' Export .json'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => download('xlsx') }, Scope.icon('download', { size: 14 }), ' Download .xlsx'),
        h('button', { class: 'btn btn-sm', onClick: () => download('csv') }, Scope.icon('download', { size: 14 }), ' CSV'),
        h('span', { class: 'small muted' }, `${res.platform.label} · ${res.displayCurrency}${(res.globalFilters || []).length ? ` · ${res.globalFilters.length} filter(s)` : ''}`)));
      // ---------- chooser: available fields (grouped, searchable) and the chosen columns in order ----------
      const chosen = new Set(D.columns.map((c) => c.id));
      const q = state.search.trim().toLowerCase();
      const groups = new Map();
      for (const f of ds.fields) { if (q && !(f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || String(f.group).toLowerCase().includes(q))) continue; if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
      const searchIn = h('input', { class: 'input', placeholder: 'Search columns…', value: state.search, 'aria-label': 'Search columns', onInput: (e) => { state.search = e.target.value; const host = el.querySelector('.cs-avail-list'); if (host) { host.replaceWith(availList()); } } });
      const availList = () => h('div', { class: 'cs-avail-list' }, Array.from(groups).map(([g, fs]) => h('details', { open: !!q || /Asset|Amounts|Exposure|Investor$/.test(g) }, h('summary', {}, `${g} (${fs.length})`),
        fs.map((f) => h('label', { class: 'cs-field' + (chosen.has(f.id) ? ' on' : ''), title: f.title || f.id }, h('input', { type: 'checkbox', checked: chosen.has(f.id), onChange: (e) => { if (e.target.checked) { if (!chosen.has(f.id)) D.columns.push({ id: f.id }); } else D.columns = D.columns.filter((c) => c.id !== f.id); save(); rerender(); } }), ' ', f.label, f.kind === 'measure' && f.unitLabel ? h('span', { class: 'muted' }, ` (${f.unitLabel})`) : null)))));
      const chosenList = h('div', { class: 'cs-chosen' }, D.columns.length ? D.columns.map((c, i) => { const f = ds.fieldById[c.id]; return h('div', { class: 'cs-col' + (f ? '' : ' missing') },
        h('span', { class: 'cs-idx' }, String(i + 1)),
        h('input', { class: 'input cs-head', value: c.header || '', placeholder: f ? f.label + (f.kind === 'measure' && f.unitLabel ? ` (${f.unitLabel})` : '') : c.id + ' (not in this dataset)', 'aria-label': 'Heading', title: 'Your own heading for this column (blank = the field name)', onChange: (e) => { c.header = e.target.value; save(); } }),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Move up', disabled: i === 0, onClick: () => { D.columns.splice(i - 1, 0, D.columns.splice(i, 1)[0]); save(); rerender(); } }, Scope.icon('arrow-up', { size: 12 })),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Move down', disabled: i === D.columns.length - 1, onClick: () => { D.columns.splice(i + 1, 0, D.columns.splice(i, 1)[0]); save(); rerender(); } }, Scope.icon('arrow-down', { size: 12 })),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Remove', onClick: () => { D.columns.splice(i, 1); save(); rerender(); } }, Scope.icon('x', { size: 12 }))); })
        : h('p', { class: 'muted small' }, 'No columns yet: tick them on the left.'));
      el.appendChild(h('div', { class: 'cs-wrap' },
        h('div', { class: 'cs-panel' }, h('h4', {}, `Available columns · ${ds.fields.length}`), searchIn, availList()),
        h('div', { class: 'cs-panel' }, h('h4', {}, `Your sheet · ${D.columns.length} columns`), h('p', { class: 'small muted' }, 'In this order, with the heading you type (blank = the field name).'),
          D.grain === 'positions' ? h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: !!D.includeExcluded, onChange: (e) => { D.includeExcluded = e.target.checked; save(); rerender(); } }), ' include excluded positions') : null,
          chosenList,
          D.columns.length ? h('button', { class: 'btn btn-sm', style: { marginTop: '8px' }, onClick: () => { if (global.confirm('Remove every column?')) { D.columns = []; save(); rerender(); } } }, 'Clear all') : null)));
      // ---------- preview ----------
      try {
        const b = SH.build(res, D);
        if (b.headers.length) {
          const columns = b.fields.map((f, i) => ({ key: 'c' + i, label: b.headers[i], type: f.kind === 'measure' ? 'number' : f.type === 'date' ? 'date' : 'text', align: f.kind === 'measure' ? 'right' : 'left', format: (v) => (v === null || v === undefined ? '' : f.kind === 'measure' ? (typeof v === 'number' ? f.format(v) : String(v)) : String(v)), total: f.kind === 'measure' && f.agg === 'sum' && !f.perAsset ? 'sum' : undefined, width: f.kind === 'measure' ? 110 : 150 }));
          const rows = b.values.map((vals, r) => { const o = { _k: r }; vals.forEach((v, i) => { o['c' + i] = v; }); return o; });
          const fmtRows = b.rows;
          // show the display text, keep numbers numeric for sorting and totals
          columns.forEach((c, i) => { if (c.type !== 'number') c.format = (v, row) => fmtRows[row._k] ? fmtRows[row._k][i] : (v === null ? '' : String(v)); else c.format = (v) => (typeof v === 'number' ? b.fields[i].format(v * (b.fields[i].unit && b.fields[i].unit !== 1 ? b.fields[i].unit : 1)) : ''); });
          el.appendChild(UI.section({ title: `Preview · ${U.fmt.int(b.count)} rows`, subtitle: 'exactly what the download holds; sort or filter here does not change the file', body: UI.grid({ columns, rows, rowKey: '_k', height: '52vh', storageKey: 'cs-preview-' + D.grain, ariaLabel: 'Custom sheet preview' }) }));
        }
      } catch (err) { console.error(err); el.appendChild(h('div', { class: 'notice warn' }, `Could not build the preview: ${err.message || err}`)); }
    },
  });
})(window);
