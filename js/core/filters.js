/* Scope core: global filters and global search.
 *
 * Global filters are a list of { field, op, value } conditions (the same shape Scope.pivot uses) kept in
 * Scope.store.state.settings.globalFilters. The store applies them inside the engine (see store.result()),
 * so every page, KPI, chart, table and export reflects the same filtered book. Any dataset field can be used:
 * asset attributes, position terms, ratings, ESG, investor, derived bands, and numeric measures (ranges).
 *
 * Exports:
 *   Scope.filters.list() / set(filters) / add(filter) / remove(index) / clear()
 *   Scope.filters.describe(filter)       → "Country: Germany, Netherlands"
 *   Scope.filters.renderBar(container)   → the filter row shown under the navbar on every page
 *   Scope.filters.renderSearch(container)→ the navbar search box (assets, investors, values, pages)
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const F = (Scope.filters = {});
  const h = (...a) => Scope.ui.h(...a);
  const icon = (name, size) => Scope.icon(name, { size: size || 14 });
  const store = () => Scope.store;

  // ---------- state API ----------

  /** Current global filters (a copy, safe to mutate). */
  F.list = () => (store().state.settings.globalFilters || []).map((f) => Object.assign({}, f));

  /** Replace all global filters; triggers a full recompute and re-render through the store. */
  F.set = function (filters) {
    const clean = (filters || []).filter((f) => f && f.field && f.op && !(Array.isArray(f.value) && f.value.length === 0 && (f.op === 'in' || f.op === 'notIn')));
    store().setSetting('globalFilters', clean);
  };

  /** Add a filter. A filter on a field that is already filtered replaces the old one (drill-in behaviour). */
  F.add = function (filter) {
    if (!filter || !filter.field) return;
    const next = F.list().filter((f) => f.field !== filter.field);
    next.push({ field: filter.field, op: filter.op || 'in', value: filter.value });
    F.set(next);
  };

  /** Remove the filter at position `index`. */
  F.remove = function (index) { const next = F.list(); next.splice(index, 1); F.set(next); };

  /** Remove every global filter. */
  F.clear = function () { F.set([]); };

  /** The unfiltered dataset (positions grain) used for field metadata, value counts and search. */
  function baseDataset() {
    const res = store().baseResult();
    return Scope.engine.dataset.build(res);
  }

  /** Human description of one filter, e.g. "Country: Germany, Netherlands" or "Exposure ≥ 50m". */
  F.describe = function (flt, fieldById) {
    const fb = fieldById || baseDataset().fieldById;
    const f = fb[flt.field];
    const label = f ? f.label : flt.field;
    const unit = f && f.unit && f.unit !== 1 ? f.unit : 1;
    const num = (v) => (U.isNum(+v) ? U.fmt.n1(+v / unit) + (unit === 1e6 ? 'm' : '') : String(v));
    const v = flt.value;
    switch (flt.op) {
      case 'in': { const arr = Array.isArray(v) ? v : [v]; return `${label}: ${arr.length > 3 ? arr.slice(0, 3).join(', ') + ` +${arr.length - 3}` : arr.join(', ')}`; }
      case 'notIn': { const arr = Array.isArray(v) ? v : [v]; return `${label}: not ${arr.length > 2 ? arr.slice(0, 2).join(', ') + ` +${arr.length - 2}` : arr.join(', ')}`; }
      case 'between': return f && f.kind === 'measure' ? `${label}: ${num(v[0])} to ${num(v[1])}` : `${label}: ${v[0] || '…'} to ${v[1] || '…'}`;
      case 'gte': return `${label} ≥ ${f && f.kind === 'measure' ? num(v) : v}`;
      case 'lte': return `${label} ≤ ${f && f.kind === 'measure' ? num(v) : v}`;
      case 'contains': return `${label} contains "${v}"`;
      case 'blank': return `${label} is blank`;
      case 'nonblank': return `${label} is not blank`;
      default: return `${label} ${flt.op} ${v}`;
    }
  };

  // ---------- popover (one at a time, closes on outside click or Escape) ----------
  let pop = null;
  function closePop() {
    if (!pop) return;
    pop.el.remove();
    document.removeEventListener('mousedown', pop.onDoc, true);
    document.removeEventListener('keydown', pop.onKey, true);
    pop = null;
  }
  /** Open `content` in a popover anchored under `anchor`, kept inside the viewport. */
  function openPop(anchor, content, cls) {
    closePop();
    const el = h('div', { class: 'fb-pop ' + (cls || ''), role: 'dialog' }, content);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8));
    let top = r.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - el.offsetHeight - 8);
    el.style.left = left + 'px'; el.style.top = top + 'px';
    const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
    const onKey = (e) => { if (e.key === 'Escape') { closePop(); e.stopPropagation(); } };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    pop = { el, onDoc, onKey };
    return el;
  }
  F.closePopover = closePop;

  // ---------- field picker ----------

  /** Popover listing every dataset field grouped like the explorer; picking one opens its editor. */
  function fieldPicker(anchor) {
    const ds = baseDataset();
    const used = new Set(F.list().map((f) => f.field));
    const fields = ds.fields.filter((f) => f.id !== 'positions' && f.agg !== 'countDistinct' && !String(f.id).startsWith('investor_nominal:') && !String(f.id).startsWith('investor_drawn:'));
    const search = h('input', { class: 'input fb-search', type: 'search', placeholder: 'Find a field…', 'aria-label': 'Find a field' });
    const list = h('div', { class: 'fb-fieldlist' });
    /** Re-draw the field list for the current search text. */
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const groups = new Map();
      for (const f of fields) {
        if (q && !f.label.toLowerCase().includes(q) && !f.id.includes(q)) continue;
        const g = f.kind === 'measure' ? 'Amounts and measures' : f.group || 'Other';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(f);
      }
      for (const [g, fs] of groups) {
        list.appendChild(h('div', { class: 'fb-group' }, g));
        for (const f of fs) {
          list.appendChild(h('button', { type: 'button', class: 'fb-field' + (used.has(f.id) ? ' used' : ''), onClick: () => editor(anchor, f.id) },
            icon(f.kind === 'measure' ? 'hash' : f.type === 'date' ? 'calendar' : 'list', 13), h('span', {}, f.label), used.has(f.id) ? h('span', { class: 'fb-used' }, 'filtered') : null));
        }
      }
      if (!list.children.length) list.appendChild(h('div', { class: 'fb-empty' }, 'No field matches'));
    };
    search.addEventListener('input', draw);
    // Enter picks the first match, which makes keyboard-only filtering quick
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = list.querySelector('.fb-field'); if (first) first.click(); } });
    draw();
    openPop(anchor, h('div', {}, h('div', { class: 'fb-pop-head' }, h('strong', {}, 'Add a filter'), h('span', { class: 'muted small' }, 'any column, combined with AND')), h('div', { class: 'fb-pop-body' }, search), list), 'fb-pop-fields');
    search.focus();
  }

  // ---------- filter editor ----------

  /** Open the editor for `fieldId`: a value checklist for dimensions, a range for measures and dates. */
  function editor(anchor, fieldId, index) {
    const ds = baseDataset();
    const f = ds.fieldById[fieldId];
    if (!f) return;
    const current = F.list();
    const existingIndex = index !== undefined ? index : current.findIndex((x) => x.field === fieldId);
    const existing = existingIndex >= 0 ? current[existingIndex] : null;
    /** Save the edited filter (replacing any existing filter on the same field) and close. */
    const commit = (flt) => {
      const next = F.list().filter((x, i) => i !== existingIndex && x.field !== fieldId);
      if (flt) next.splice(existingIndex >= 0 ? Math.min(existingIndex, next.length) : next.length, 0, flt);
      closePop(); F.set(next);
    };
    if (f.kind === 'measure' || f.type === 'number' || f.type === 'date') return rangeEditor(anchor, f, existing, commit);
    return valueEditor(anchor, f, ds, existing, existingIndex, commit);
  }

  /** Checklist of distinct values with position counts and exposure, computed under the OTHER filters. */
  function valueEditor(anchor, f, ds, existing, existingIndex, commit) {
    const others = F.list().filter((x, i) => i !== existingIndex && x.field !== f.id);
    const recs = Scope.pivot.applyFilters(ds.records.filter((r) => r.excluded !== 'Yes'), ds.fieldById, others);
    const stats = new Map(); // value → { count, exposure }
    for (const r of recs) {
      const raw = f.get(r);
      const v = raw === null || raw === undefined || raw === '' ? Scope.pivot.BLANK : String(raw);
      if (!stats.has(v)) stats.set(v, { count: 0, exposure: 0 });
      const s = stats.get(v); s.count++; s.exposure += U.isNum(r.exposure) ? r.exposure : 0;
    }
    // values already selected but no longer present under the other filters stay visible (with zero counts)
    const prevSel = existing && existing.op === 'in' ? new Set((existing.value || []).map(String)) : existing && existing.op === 'notIn' ? null : null;
    if (prevSel) for (const v of prevSel) if (!stats.has(v)) stats.set(v, { count: 0, exposure: 0 });
    let values = Array.from(stats.entries()).map(([value, s]) => Object.assign({ value }, s));
    // ordinal fields (ratings, buckets, years) keep their natural order; others sort by exposure
    if (f.sortRank) values.sort((a, b) => f.sortRank(a.value) - f.sortRank(b.value) || a.value.localeCompare(b.value, undefined, { numeric: true }));
    else values.sort((a, b) => b.exposure - a.exposure || a.value.localeCompare(b.value, undefined, { numeric: true }));
    const selected = new Set(prevSel ? prevSel : existing && existing.op === 'notIn' ? values.map((v) => v.value).filter((v) => !(existing.value || []).map(String).includes(v)) : []);
    const total = values.reduce((s, v) => s + v.exposure, 0) || 1;
    const search = h('input', { class: 'input fb-search', type: 'search', placeholder: `Search ${f.label.toLowerCase()}…`, 'aria-label': 'Search values' });
    const list = h('div', { class: 'fb-values' });
    const foot = h('div', { class: 'fb-count muted small' });
    /** Visible values for the current search text. */
    const visible = () => { const q = search.value.trim().toLowerCase(); return q ? values.filter((v) => v.value.toLowerCase().includes(q)) : values; };
    /** Re-draw the checklist. */
    const draw = () => {
      list.innerHTML = '';
      for (const v of visible()) {
        const cb = h('input', { type: 'checkbox', checked: selected.has(v.value), onChange: (e) => { if (e.target.checked) selected.add(v.value); else selected.delete(v.value); foot.textContent = `${selected.size} of ${values.length} selected`; } });
        list.appendChild(h('label', { class: 'fb-value' + (v.count ? '' : ' zero') }, cb, h('span', { class: 'fb-value-label' }, v.value),
          h('span', { class: 'fb-value-bar' }, h('span', { style: { width: Math.max(1, (v.exposure / total) * 100) + '%' } })),
          h('span', { class: 'fb-value-num' }, `${v.count} · ${U.fmt.m(v.exposure / 1e6)}`)));
      }
      if (!list.children.length) list.appendChild(h('div', { class: 'fb-empty' }, 'No value matches'));
      foot.textContent = `${selected.size} of ${values.length} selected`;
    };
    search.addEventListener('input', draw);
    // Enter applies the filter, Excel-style
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    const bulk = (fn) => () => { visible().forEach(fn); draw(); };
    /** Commit: nothing selected removes the filter; otherwise an "in" list. */
    const apply = () => commit(selected.size ? { field: f.id, op: 'in', value: Array.from(selected) } : null);
    openPop(anchor, h('div', {},
      h('div', { class: 'fb-pop-head' }, h('strong', {}, f.label), h('span', { class: 'muted small' }, 'positions · exposure m, under the other filters')),
      h('div', { class: 'fb-pop-body' }, search,
        h('div', { class: 'fb-bulk' },
          h('button', { type: 'button', class: 'btn btn-sm', onClick: bulk((v) => selected.add(v.value)) }, 'All'),
          h('button', { type: 'button', class: 'btn btn-sm', onClick: bulk((v) => selected.delete(v.value)) }, 'None'),
          h('button', { type: 'button', class: 'btn btn-sm', onClick: bulk((v) => (selected.has(v.value) ? selected.delete(v.value) : selected.add(v.value))) }, 'Invert'))),
      list,
      h('div', { class: 'fb-pop-foot' }, foot, h('span', {},
        existing ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => commit(null) }, 'Remove') : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: apply }, 'Apply')))), 'fb-pop-values');
    draw();
    search.focus();
  }

  /** Range editor for numeric measures (entered in display units, e.g. millions) and dates (ISO). */
  function rangeEditor(anchor, f, existing, commit) {
    const isDate = f.type === 'date';
    const unit = !isDate && f.unit && f.unit !== 1 ? f.unit : 1;
    const toUi = (v) => (v === undefined || v === null || v === '' ? '' : isDate ? String(v) : String(+(+v / unit).toFixed(6)));
    let lo = '', hi = '';
    if (existing) {
      if (existing.op === 'between') { lo = toUi(existing.value[0]); hi = toUi(existing.value[1]); }
      else if (existing.op === 'gte') lo = toUi(existing.value);
      else if (existing.op === 'lte') hi = toUi(existing.value);
    }
    const type = isDate ? 'date' : 'number';
    const loIn = h('input', { class: 'input', type, value: lo, step: 'any', 'aria-label': 'From' });
    const hiIn = h('input', { class: 'input', type, value: hi, step: 'any', 'aria-label': 'To' });
    /** Convert a typed value back to the field's stored units. */
    const toStore = (s) => (s === '' ? '' : isDate ? s : +s * unit);
    /** Build between / ≥ / ≤ from whichever bounds were filled in. */
    const apply = () => {
      const a = toStore(loIn.value.trim()), b = toStore(hiIn.value.trim());
      if (a === '' && b === '') return commit(null);
      if (a !== '' && b !== '') return commit({ field: f.id, op: 'between', value: [a, b] });
      return commit(a !== '' ? { field: f.id, op: 'gte', value: a } : { field: f.id, op: 'lte', value: b });
    };
    [loIn, hiIn].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); }));
    const unitLabel = isDate ? 'ISO date' : f.unitLabel || (unit === 1e6 ? 'millions' : '');
    openPop(anchor, h('div', {},
      h('div', { class: 'fb-pop-head' }, h('strong', {}, f.label), h('span', { class: 'muted small' }, unitLabel ? `in ${unitLabel}` : 'range')),
      h('div', { class: 'fb-pop-body fb-range' },
        h('label', {}, 'From (≥)', loIn), h('label', {}, 'To (≤)', hiIn),
        h('p', { class: 'muted small' }, f.kind === 'measure' ? 'Applied to each position. Leave a bound empty for an open range.' : 'Leave a bound empty for an open range.')),
      h('div', { class: 'fb-pop-foot' }, h('span'), h('span', {},
        existing ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => commit(null) }, 'Remove') : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: apply }, 'Apply')))), 'fb-pop-range');
    loIn.focus();
  }

  // ---------- saved filter sets (per browser) ----------
  const LS_SETS = 'scope.filterSets';
  /** Saved named filter sets from localStorage ({ name: filters[] }). */
  function loadSets() { try { return JSON.parse(localStorage.getItem(LS_SETS) || '{}') || {}; } catch (e) { return {}; } }
  /** Persist named filter sets; returns false when storage is unavailable. */
  function storeSets(o) { try { localStorage.setItem(LS_SETS, JSON.stringify(o)); return true; } catch (e) { return false; } }

  /** Menu of saved filter sets with save / load / delete. */
  function setsMenu(anchor) {
    const sets = loadSets();
    const names = Object.keys(sets).sort();
    const nameIn = h('input', { class: 'input', placeholder: 'Name this filter set', 'aria-label': 'Filter set name' });
    /** Save the current global filters under the typed name. */
    const save = () => {
      const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return; }
      const o = loadSets(); o[n] = F.list();
      if (storeSets(o)) Scope.ui.toast(`Filter set "${n}" saved`); else Scope.ui.toast('Browser storage unavailable', 'warn');
      closePop();
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    openPop(anchor, h('div', {},
      h('div', { class: 'fb-pop-head' }, h('strong', {}, 'Filter sets'), h('span', { class: 'muted small' }, 'saved in this browser')),
      h('div', { class: 'fb-pop-body fb-sets-save' }, nameIn, h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: !F.list().length, onClick: save }, 'Save current')),
      h('div', { class: 'fb-sets' }, names.length ? names.map((n) => h('div', { class: 'fb-set' },
        h('button', { type: 'button', class: 'fb-set-load', title: sets[n].map((x) => F.describe(x)).join(' · '), onClick: () => { closePop(); F.set(sets[n]); } }, h('strong', {}, n), h('span', { class: 'muted small' }, `${sets[n].length} filter${sets[n].length === 1 ? '' : 's'}`)),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Delete', 'aria-label': 'Delete ' + n, onClick: () => { const o = loadSets(); delete o[n]; storeSets(o); setsMenu(anchor); } }, icon('x', 12))))
        : h('div', { class: 'fb-empty' }, 'No saved sets yet'))), 'fb-pop-sets');
  }

  // ---------- filter bar ----------

  /** Render the global filter row (chips, add, sets, clear, filtered-vs-total summary) into `container`. */
  F.renderBar = function (container) {
    const res = Scope.app && Scope.app.safeResult ? Scope.app.safeResult() : null;
    if (!res) return;
    let fieldById = {};
    try { fieldById = baseDataset().fieldById; } catch (e) { fieldById = {}; }
    const filters = F.list();
    const bar = h('div', { class: 'filterbar' + (filters.length ? ' active' : '') });
    bar.appendChild(h('span', { class: 'fb-title' }, icon('filter', 14), 'Filters'));
    filters.forEach((flt, i) => {
      const chip = h('span', { class: 'fb-chip', title: 'Edit filter' });
      chip.append(
        h('button', { type: 'button', class: 'fb-chip-label', onClick: () => editor(chip, flt.field, i) }, F.describe(flt, fieldById)),
        h('button', { type: 'button', class: 'fb-chip-x', 'aria-label': 'Remove filter', title: 'Remove', onClick: () => F.remove(i) }, icon('x', 11)));
      bar.appendChild(chip);
    });
    const addBtn = h('button', { type: 'button', class: 'btn btn-sm fb-add', onClick: () => fieldPicker(addBtn) }, icon('plus', 13), filters.length ? 'Add' : 'Add filter');
    bar.appendChild(addBtn);
    const setsBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Saved filter sets', onClick: () => setsMenu(setsBtn) }, icon('folder', 13), 'Sets');
    bar.appendChild(setsBtn);
    if (filters.length) bar.appendChild(h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => F.clear() }, 'Clear all'));
    // summary: how much of the platform the filters keep
    const base = res.base || res;
    const tot = base.metrics.total_exposure_m, cur = res.metrics.total_exposure_m;
    bar.appendChild(h('span', { class: 'fb-summary' }, filters.length
      ? [h('strong', {}, `${res.displayCurrency} ${U.fmt.m(cur)}m`), ` of ${U.fmt.m(tot)}m (${U.fmt.pct(tot ? cur / tot : NaN)}) · ${res.rows.length} of ${base.rows.length} assets`]
      : `All ${base.rows.length} assets · ${res.displayCurrency} ${U.fmt.m(tot)}m · filters apply to every page`));
    container.appendChild(bar);
  };

  // ---------- global search ----------
  const SEARCH_DIMS = ['sector', 'subsector', 'country', 'region', 'sponsor', 'currency', 'rating', 'ig_label', 'investor_group', 'fixed_floating', 'repayment_type', 'instrument', 'maturity_bucket', 'watchlist', 'deal_lead', 'cbi_taxonomy', 'sfdr_article', 'greenfield_brownfield'];
  let searchIndex = null;

  /** Build (and memoise per base result) the search index: assets, investors, field values, pages. */
  function buildIndex() {
    const res = store().baseResult();
    if (searchIndex && searchIndex.res === res) return searchIndex.items;
    const ds = Scope.engine.dataset.build(res);
    const items = [];
    const unit = res.config.unit || 1e6;
    // assets: name, code, code name, holding ids and security ids all match
    for (const a of res.assets) {
      if (!a.positionCount) continue;
      const secIds = a.holdings.join(' ');
      items.push({ kind: 'Asset', label: a.name, sub: [a.code, a.attrs.sector, a.attrs.country, a.rating ? a.rating.current_grade : ''].filter(Boolean).join(' · '), amount: a.nominal / unit,
        text: [a.name, a.code, a.code_name, secIds, a.attrs.sponsor].join(' ').toLowerCase(), go: () => Scope.navigate('asset', a.code), filter: { field: 'asset_code', op: 'in', value: [a.code] } });
    }
    // investors: open the investor page when present, else the investor book
    for (const inv of res.investors) {
      items.push({ kind: 'Investor', label: inv.label, sub: [inv.key, inv.group].filter(Boolean).join(' · '), amount: inv.nominal_m,
        text: [inv.label, inv.key, inv.id, inv.group].join(' ').toLowerCase(), go: () => (Scope.modules.get('investor') ? Scope.navigate('investor', inv.label) : Scope.navigate('investors')), filter: { field: 'investor_label', op: 'in', value: [inv.label] } });
    }
    // distinct values of the main dimensions: selecting one applies it as a global filter
    for (const id of SEARCH_DIMS) {
      const f = ds.fieldById[id]; if (!f) continue;
      const m = new Map();
      for (const r of ds.records) { if (r.excluded === 'Yes') continue; const v = f.get(r); if (v === null || v === undefined || v === '') continue; const k = String(v); m.set(k, (m.get(k) || 0) + (U.isNum(r.exposure) ? r.exposure : 0)); }
      for (const [v, amt] of m) items.push({ kind: f.label, label: v, sub: 'Filter every page to this value', amount: amt / unit, text: (v + ' ' + f.label).toLowerCase(), filter: { field: id, op: 'in', value: [v] } });
    }
    // pages
    for (const mod of Scope.modules.values()) if (!mod.hidden) items.push({ kind: 'Page', label: mod.title, sub: mod.status === 'built' ? 'Open page' : mod.status === 'partial' ? 'Open page (partial)' : 'Planned page', text: (mod.title + ' ' + mod.id).toLowerCase(), go: () => Scope.navigate(mod.id) });
    searchIndex = { res, items };
    return items;
  }

  /** Rank items for a query: prefix matches first, then word starts, then substring; capped per kind. */
  function searchItems(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = [];
    for (const it of buildIndex()) {
      if (!terms.every((t) => it.text.includes(t))) continue;
      const lbl = it.label.toLowerCase();
      const t0 = terms[0];
      const score = (lbl.startsWith(t0) ? 0 : lbl.includes(' ' + t0) ? 1 : 2) + (it.kind === 'Asset' ? 0 : it.kind === 'Investor' ? 0.1 : it.kind === 'Page' ? 0.3 : 0.2);
      scored.push({ it, score });
    }
    scored.sort((a, b) => a.score - b.score || (b.it.amount || 0) - (a.it.amount || 0));
    const perKind = new Map(), out = [];
    for (const s of scored) { const n = perKind.get(s.it.kind) || 0; if (n >= 6) continue; perKind.set(s.it.kind, n + 1); out.push(s.it); if (out.length >= 24) break; }
    return out;
  }

  /** Render the navbar search box with a keyboard-navigable results dropdown. "/" focuses it from anywhere. */
  F.renderSearch = function (container) {
    const wrap = h('div', { class: 'gsearch' });
    const input = h('input', { class: 'input gsearch-input', type: 'search', placeholder: 'Search assets, investors, sponsors, countries, IDs…  ( / )', 'aria-label': 'Search', autocomplete: 'off' });
    const results = h('div', { class: 'gsearch-results', role: 'listbox' });
    wrap.append(icon('search', 14), input, results);
    let items = [], active = 0;
    /** Close the dropdown. */
    const hide = () => { results.classList.remove('open'); results.innerHTML = ''; };
    /** Run the action for result i: navigate (default) or filter (alt / filter button). */
    const choose = (i, asFilter) => {
      const it = items[i]; if (!it) return;
      hide(); input.value = ''; input.blur();
      if ((asFilter || !it.go) && it.filter) { F.add(it.filter); Scope.ui.toast(`Filter added: ${F.describe(it.filter)}`); }
      else if (it.go) it.go();
    };
    /** Re-draw results for the current text. */
    const draw = () => {
      const q = input.value.trim();
      if (!q) { hide(); return; }
      try { items = searchItems(q); } catch (e) { items = []; }
      results.innerHTML = '';
      if (!items.length) { results.appendChild(h('div', { class: 'gsearch-empty' }, `No match for "${q}"`)); results.classList.add('open'); return; }
      let lastKind = null;
      items.forEach((it, i) => {
        if (it.kind !== lastKind) { results.appendChild(h('div', { class: 'gsearch-kind' }, it.kind)); lastKind = it.kind; }
        const row = h('div', { class: 'gsearch-item' + (i === active ? ' active' : ''), role: 'option', onMousedown: (e) => { e.preventDefault(); choose(i, false); } },
          h('div', { class: 'gsearch-main' }, h('span', { class: 'gsearch-label' }, it.label), h('span', { class: 'gsearch-sub' }, it.sub)),
          U.isNum(it.amount) ? h('span', { class: 'gsearch-amt' }, U.fmt.m(it.amount) + 'm') : null,
          it.go && it.filter ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost gsearch-filter', title: 'Filter every page to this', onMousedown: (e) => { e.preventDefault(); e.stopPropagation(); choose(i, true); } }, icon('filter', 12)) : null);
        results.appendChild(row);
      });
      results.classList.add('open');
    };
    input.addEventListener('input', () => { active = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(active, e.altKey); e.preventDefault(); }
      else if (e.key === 'Escape') { hide(); input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(hide, 150));
    container.appendChild(wrap);
    return input;
  };

  // "/" focuses the search box unless the user is typing in a field
  if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    const el = document.querySelector('.gsearch-input');
    if (el) { e.preventDefault(); el.focus(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
