/* Module: Layer 1 · Explorer — Excel-grade pivot builder plus positions and assets grids over the dataset engine.
 *
 * Tabs: Pivot (field list, Rows / Columns / Values / Filters zones, cross-tab, chart, exports, presets, saved views)
 *       Positions (Scope.ui.grid over Scope.engine.dataset.build(res).records, storageKey 'positions')
 *       Assets    (Scope.ui.grid over Scope.engine.dataset.assetRecords(res), storageKey 'assets')
 * UI state lives in the module-level object S so the page survives store re-renders (platform / currency switches);
 * the pivot configuration is mirrored into the hash as #/explorer/v/<base64url JSON> so a view can be bookmarked or shared.
 * All aggregation comes from Scope.pivot (engine); this file never adds numbers itself.
 *
 * Registers two modules: 'explorer' (route #/explorer[/<tab>] or #/explorer/v/<token>, sidebar Layer 1) and the hidden
 * 'pivot' route that the AUM page's "Open in Pivot" button targets, which forwards to the explorer's pivot tab.
 * Filters use the contract shape [{ field, op, value }] shared with Scope.pivot and Scope.ui.grid, so they move
 * between the pivot and the grids ("Pivot this", drill-through) with only small conversions (toGridFilters /
 * fromGridFilters). Styles: css/explorer.css (pivot builder) and css/grid.css (grids).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts, P = Scope.pivot, DS = Scope.engine.dataset, store = Scope.store;
  const icon = (n, s) => Scope.icon(n, { size: s || 13 }); // Feather icon, 13px by default
  const LS_VIEWS = 'scope.explorer.views';
  const TABS = [['pivot', 'Pivot'], ['positions', 'Positions grid'], ['assets', 'Assets grid']];
  const AGG_LABEL = { sum: 'Sum', wavg: 'Weighted average', avg: 'Average', count: 'Count', countDistinct: 'Distinct count', min: 'Min', max: 'Max' };
  const SHOWAS = [['value', 'Value'], ['pctOfTotal', '% of grand total'], ['pctOfRow', '% of row'], ['pctOfCol', '% of column']];
  const SHOWAS_TITLE = { value: 'Aggregated value', pctOfTotal: 'Cell ÷ grand total of this measure', pctOfRow: 'Cell ÷ row total of this measure', pctOfCol: 'Cell ÷ column total of this measure' };
  const MAX_VISIBLE_ROWS = 3000; // DOM cap for the cross-tab; exports always contain every row
  const BLANK = P.BLANK;

  // ---------- state (module level: survives re-renders) ----------
  /** The default pivot: exposure by sector over included positions (Excluded = No), sorted by label, with a bar chart. */
  const defaultPivot = () => ({
    source: 'positions', rowDims: ['sector'], colDims: [], values: [{ field: 'exposure', agg: 'sum', showAs: 'value' }],
    filters: [{ field: 'excluded', op: 'in', value: ['No'] }], sort: { by: 'label', valueIndex: 0, dir: 'asc' }, topN: null,
    subtotals: true, grandTotal: true, collapsed: [], chart: { on: true, type: 'hbar', valueIndex: 0 },
  });
  // S: active tab, pivot configuration, preset / saved-view bookkeeping (modified drives the "*" marker), field-list search,
  // field panel visibility, filters waiting to be applied when a grid tab opens, the last hash token seen, and the drill note.
  // memo caches the last pivot result per engine result + configuration; pop is the single open popover.
  const S = { tab: 'pivot', pivot: defaultPivot(), preset: '', viewName: '', modified: false, fieldSearch: '', panel: true, pendingGridFilters: { positions: null, assets: null }, lastToken: null, drillNote: null };
  let memo = { res: null, key: null, result: null };
  let pop = null;

  // ---------- presets (field ids only; labels come from the dataset registry at render time) ----------
  const PRESETS = [
    { id: 'sector_investor_group', name: 'Sector × investor group', pivot: { rowDims: ['sector'], colDims: ['investor_group'], values: [{ field: 'exposure' }, { field: 'exposure', showAs: 'pctOfCol' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'rating_maturity', name: 'Rating × maturity bucket', pivot: { rowDims: ['ig_label', 'rating'], colDims: ['maturity_bucket'], values: [{ field: 'exposure' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'country_currency', name: 'Country × currency', pivot: { rowDims: ['region', 'country'], colDims: ['currency'], values: [{ field: 'exposure' }, { field: 'nominal_ccy' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'investor_subsector', name: 'Investor × subsector', pivot: { rowDims: ['investor_label'], colDims: ['subsector'], values: [{ field: 'nominal' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'watchlist_sponsor', name: 'Watchlist × sponsor (top 10)', pivot: { rowDims: ['sponsor'], colDims: ['watchlist'], values: [{ field: 'exposure' }, { field: 'assets' }], topN: { n: 10, valueIndex: 0 }, sort: { by: 'value', valueIndex: 0, dir: 'desc' }, chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'fixed_repayment', name: 'Fixed / floating × repayment', pivot: { rowDims: ['fixed_floating'], colDims: ['repayment_type'], values: [{ field: 'exposure' }, { field: 'margin_bps' }, { field: 'coupon' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'top10_assets', name: 'Top 10 assets by exposure', pivot: { source: 'assets', rowDims: ['asset_name'], colDims: [], values: [{ field: 'exposure' }, { field: 'exposure', showAs: 'pctOfTotal' }, { field: 'rating_numeric' }, { field: 'investors' }], topN: { n: 10, valueIndex: 0 }, sort: { by: 'value', valueIndex: 0, dir: 'desc' }, chart: { on: true, type: 'hbar', valueIndex: 0 } } },
    { id: 'drawn_undrawn_sector', name: 'Drawn vs undrawn by sector', pivot: { rowDims: ['sector', 'subsector'], colDims: [], values: [{ field: 'exposure' }, { field: 'exposure_drawn' }, { field: 'undrawn' }], chart: { on: true, type: 'hbar', valueIndex: 0 } } },
    { id: 'green_esg_sector', name: 'Green and ESG by sector', pivot: { rowDims: ['sector'], colDims: ['green_loan'], values: [{ field: 'exposure' }, { field: 'esg_score' }, { field: 'ghg_scope12_t' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'group_third_party_country', name: 'Group vs third party by country', pivot: { rowDims: ['region', 'country'], colDims: [], values: [{ field: 'attributed' }, { field: 'third_party' }, { field: 'nominal' }], chart: { on: true, type: 'hbar', valueIndex: 0 } } },
    { id: 'ig_subig_investor', name: 'IG / Sub-IG by investor', pivot: { rowDims: ['investor_group', 'investor_label'], colDims: ['ig_label'], values: [{ field: 'nominal' }, { field: 'nominal', showAs: 'pctOfRow' }], chart: { on: true, type: 'stacked', valueIndex: 0 } } },
    { id: 'maturity_ladder', name: 'Maturity ladder by year', pivot: { rowDims: ['maturity_year'], colDims: [], values: [{ field: 'exposure' }, { field: 'positions' }], chart: { on: true, type: 'bar', valueIndex: 0 } } },
  ];

  // ---------- small helpers ----------
  // clone: deep copy of plain JSON state; glyph: field-list icon by kind; fileName: scope_<kind>_<platform>_<ccy>_<date>_<dataset>.csv;
  // download: CSV with a UTF-8 BOM for Excel; dataset: the records for the pivot's current grain; mAmount: full units → millions text.
  const isNum = U.isNum;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const toast = (m, k) => UI.toast(m, k);
  const glyph = (f) => icon(f.kind === 'measure' ? 'hash' : f.type === 'date' ? 'calendar' : 'list', 12);
  const attributionLabel = (res) => (res.config && res.config.attribution_label) || 'Group';
  const datasetSlug = () => { const l = U.slug(store.state.datasetLabel || 'dataset'); return l || 'dataset'; };
  const fileName = (kind, res) => `scope_${kind}_${U.slug(res.platformId || 'platform')}_${U.slug(res.displayCurrency || 'ccy')}_${U.isoDate(res.reportingDate) || 'undated'}_${datasetSlug()}.csv`;
  const download = (name, text) => UI.downloadText(name, '﻿' + text);
  const dataset = (res) => (S.pivot.source === 'assets' ? DS.buildAssets(res) : DS.build(res));
  const mAmount = (v, unit) => F.m(isNum(v) ? v / unit : NaN);
  /** Copy text via the async Clipboard API, falling back to a hidden textarea + execCommand (needed from file://). */
  const copyText = (text, okMsg) => {
    const done = () => toast(okMsg || 'Copied to the clipboard');
    const fallback = () => { const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } }); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); if (ok) done(); else toast('Copy is not available in this browser', 'warn'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  };

  // base64url of UTF-8 JSON (no dependency). The explorer's own token is { t: tab, p: pivot }.
  const b64e = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const b64d = (t) => { const s = t.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
  const encodeView = () => b64e(JSON.stringify({ t: S.tab, p: S.pivot }));
  const decodeView = (token) => JSON.parse(b64d(token));

  /** Bring an arbitrary object into a valid pivot state (unknown keys dropped, types coerced). Unknown field ids are dropped at compute time. */
  function normalisePivot(p) {
    const d = defaultPivot(), o = p && typeof p === 'object' ? p : {};
    // Non-empty string ids from an array, or null when the input is not an array (so the default is kept).
    const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : null);
    d.source = o.source === 'assets' ? 'assets' : 'positions';
    d.rowDims = ids(o.rowDims) || d.rowDims; d.colDims = ids(o.colDims) || d.colDims;
    if (Array.isArray(o.values)) d.values = o.values.filter((v) => v && typeof v.field === 'string').map((v) => ({ field: v.field, agg: P.AGGS.includes(v.agg) ? v.agg : undefined, showAs: SHOWAS.some((s) => s[0] === v.showAs) ? v.showAs : 'value', label: typeof v.label === 'string' && v.label ? v.label : undefined }));
    if (Array.isArray(o.filters)) d.filters = o.filters.filter((f) => f && typeof f.field === 'string' && typeof f.op === 'string').map((f) => ({ field: f.field, op: f.op, value: f.value }));
    if (o.sort && typeof o.sort === 'object') d.sort = { by: o.sort.by === 'value' ? 'value' : 'label', valueIndex: Math.max(0, parseInt(o.sort.valueIndex, 10) || 0), dir: o.sort.dir === 'desc' ? 'desc' : 'asc' };
    d.topN = o.topN && o.topN.n > 0 ? { n: Math.min(500, parseInt(o.topN.n, 10) || 10), valueIndex: Math.max(0, parseInt(o.topN.valueIndex, 10) || 0) } : null;
    if (o.subtotals !== undefined) d.subtotals = !!o.subtotals; if (o.grandTotal !== undefined) d.grandTotal = !!o.grandTotal;
    d.collapsed = ids(o.collapsed) || [];
    if (o.chart && typeof o.chart === 'object') d.chart = { on: o.chart.on !== false, type: ['hbar', 'bar', 'stacked', 'donut'].includes(o.chart.type) ? o.chart.type : 'hbar', valueIndex: Math.max(0, parseInt(o.chart.valueIndex, 10) || 0) };
    return d;
  }
  /**
   * Accepts the explorer's own token { t, p } and the AUM page's { source, filters, platform, currency } (Scope.aumView.encode).
   * An explorer token replaces the tab and pivot outright. An AUM token opens the matching grain's grid with the filters
   * applied (and mirrors them into the pivot), then switches platform / currency to the ones the link was made on.
   */
  function applyView(view) {
    const v = view && typeof view === 'object' ? view : {};
    // an explorer token carries a pivot config (p); an AUM-page token carries filters / source and may also name a tab (t)
    if (v.p || (v.t && v.filters === undefined && v.source === undefined)) {
      if (TABS.some((t) => t[0] === v.t)) S.tab = v.t;
      S.pivot = normalisePivot(v.p);
      return;
    }
    // AUM-page shape: open that grain's grid with the filters applied and mirror them into the pivot
    const grain = v.source === 'positions' ? 'positions' : 'assets';
    const filters = normalisePivot({ filters: v.filters }).filters;
    const cur = S.pivot;
    cur.source = grain; cur.collapsed = [];
    cur.filters = (grain === 'positions' && !filters.some((f) => f.field === 'excluded') ? [{ field: 'excluded', op: 'in', value: ['No'] }] : []).concat(filters);
    S.pendingGridFilters[grain] = { contract: cur.filters.slice() };
    S.drillNote = filters.length ? { grain, text: 'filters from the AUM page', count: null } : null;
    S.tab = v.t === 'pivot' ? 'pivot' : grain;
    // the link may carry the platform / currency it was made on; switch after this render so the numbers match the link
    const st = store.state.settings;
    const wantPlatform = typeof v.platform === 'string' && v.platform && v.platform !== st.platform ? v.platform : null;
    const wantCcy = typeof v.currency === 'string' && v.currency && v.currency !== st.currency ? v.currency : null;
    if (wantPlatform || wantCcy) setTimeout(() => { if (wantPlatform) store.setSetting('platform', wantPlatform); if (wantCcy) store.setSetting('currency', wantCcy); }, 0);
  }
  /** Mirror the current view into the URL with replaceState, so the link is shareable without adding history entries. */
  function updateHash() {
    const token = encodeView();
    S.lastToken = token;
    try { history.replaceState(null, '', Scope.href('explorer', 'v', token)); } catch (e) { /* ignore */ }
  }

  // ---------- saved views (localStorage, try/catch) ----------
  // Stored as one JSON object { name: { t, p, savedAt } } under 'scope.explorer.views', capped at 200 KB.
  /** All saved views ({} when storage is empty, unavailable or corrupt). */
  function loadViews() { try { const raw = localStorage.getItem(LS_VIEWS); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  /** Persist all views; refuses (with a toast) above the size cap or when storage fails. Returns success. */
  function storeViews(v) { try { const s = JSON.stringify(v); if (s.length > 200000) { toast('Saved views exceed the 200 KB storage cap; delete some views first', 'warn'); return false; } localStorage.setItem(LS_VIEWS, s); return true; } catch (e) { toast('Views could not be saved (storage unavailable)', 'warn'); return false; } }

  // ---------- popovers ----------
  /** Close the open popover and remove its document listeners. */
  function closePop() { if (pop) { pop.el.remove(); document.removeEventListener('mousedown', pop.onDoc, true); document.removeEventListener('keydown', pop.onKey, true); pop = null; } }
  /**
   * Open a popover on <body> under the anchor (viewport coordinates), kept 8px inside the window horizontally and
   * flipped above the anchor when it would overflow the bottom. Closes on mousedown outside it or on Escape.
   */
  function openPop(anchor, content, cls) {
    closePop();
    const el = h('div', { class: 'xp-pop ' + (cls || ''), role: 'dialog' }, content);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8), top = r.bottom + 4;
    if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 4);
    el.style.left = Math.max(8, left) + 'px'; el.style.top = top + 'px';
    const onDoc = (e) => { if (!el.contains(e.target)) closePop(); };
    const onKey = (e) => { if (e.key === 'Escape') { closePop(); e.stopPropagation(); } };
    document.addEventListener('mousedown', onDoc, true); document.addEventListener('keydown', onKey, true);
    pop = { el, onDoc, onKey };
    return el;
  }
  /** items: [{ label, icon, onClick, disabled, active, keep }] or 'sep' or an element */
  function menu(items) {
    return h('div', { class: 'xp-menu', role: 'menu' }, items.map((it) => {
      if (it === 'sep') return h('div', { class: 'xp-menu-sep' });
      if (it instanceof Node) return it;
      return h('button', { type: 'button', role: 'menuitem', class: 'xp-menu-item' + (it.disabled ? ' disabled' : '') + (it.active ? ' active' : ''), disabled: !!it.disabled, onClick: () => { if (it.disabled) return; if (!it.keep) closePop(); it.onClick(); } }, it.icon ? icon(it.icon) : h('span', { class: 'xp-menu-icon' }), it.label);
    }));
  }

  // ---------- filter descriptions ----------
  /** Human-readable chip text for a pivot filter; measure bounds are shown in display units (millions for amounts). */
  function filterLabel(f, field, unit) {
    const name = field ? field.label : f.field;
    const vals = Array.isArray(f.value) ? f.value : [f.value];
    // list: first three values then "+n"; num: a measure bound in display units (e.g. 25000000 → "25").
    const list = (a) => (a.length <= 3 ? a.join(', ') : `${a.slice(0, 3).join(', ')} +${a.length - 3}`);
    const num = (v) => (field && field.kind === 'measure' && field.unit && field.unit !== 1 && isNum(+v) ? String(+(+v / field.unit).toFixed(4)) : String(v));
    switch (f.op) {
      case 'in': return `${name}: ${vals.length ? list(vals) : 'none'}`;
      case 'notIn': return vals.length ? `${name}: not ${list(vals)}` : `${name}: all`;
      case 'between': { const lo = vals[0], hi = vals[1]; const e = (v) => v === null || v === undefined || v === ''; if (e(lo) && e(hi)) return `${name}: any`; if (e(lo)) return `${name} ≤ ${num(hi)}`; if (e(hi)) return `${name} ≥ ${num(lo)}`; return `${name}: ${num(lo)} – ${num(hi)}`; }
      case 'gte': return `${name} ≥ ${num(f.value)}`; case 'lte': return `${name} ≤ ${num(f.value)}`; case 'gt': return `${name} > ${num(f.value)}`; case 'lt': return `${name} < ${num(f.value)}`;
      case 'eq': return `${name} = ${num(f.value)}`; case 'neq': return `${name} ≠ ${num(f.value)}`;
      case 'contains': return `${name} contains "${f.value}"`; case 'blank': return `${name} is blank`; case 'nonblank': return `${name} is not blank`;
      default: return `${name} ${f.op} ${vals.join(', ')}`;
    }
  }
  /** Contract filters → grid filters: "(blank)" becomes "", date "in" lists become ranges (the grid shows dd MMM yyyy). */
  function toGridFilters(filters, fieldById) {
    const out = [];
    // The grid filters on display text, so blanks are '' there but "(blank)" in the pivot; a single date becomes a
    // one-day range and several dates their min..max span; open-ended betweens become gte / lte.
    for (const f of filters) {
      const field = fieldById[f.field]; if (!field) continue;
      if ((f.op === 'in' || f.op === 'notIn') && field.type === 'date') { const vals = [].concat(f.value); if (f.op === 'in' && vals.length === 1 && vals[0] !== BLANK) { out.push({ field: f.field, op: 'between', value: [vals[0], vals[0]] }); continue; } if (f.op === 'in' && vals.length > 1) { const s = vals.filter((v) => v !== BLANK).sort(); out.push({ field: f.field, op: 'between', value: [s[0], s[s.length - 1]] }); continue; } }
      if (f.op === 'in' || f.op === 'notIn') { out.push({ field: f.field, op: f.op, value: [].concat(f.value).map((v) => (v === BLANK ? '' : String(v))) }); continue; }
      if (f.op === 'blank') { out.push({ field: f.field, op: 'in', value: [''] }); continue; }
      if (f.op === 'nonblank') { out.push({ field: f.field, op: 'notIn', value: [''] }); continue; }
      if (f.op === 'between') { const v = Array.isArray(f.value) ? f.value : [f.value && f.value.from, f.value && f.value.to]; const e = (x) => x === null || x === undefined || x === ''; if (e(v[0]) && e(v[1])) continue; if (e(v[0])) out.push({ field: f.field, op: 'lte', value: v[1] }); else if (e(v[1])) out.push({ field: f.field, op: 'gte', value: v[0] }); else out.push({ field: f.field, op: 'between', value: [v[0], v[1]] }); continue; }
      out.push({ field: f.field, op: f.op, value: f.value });
    }
    return out;
  }
  /** Grid filters → contract filters for the pivot ("" becomes "(blank)"; unparsable expressions are dropped with a toast). */
  function fromGridFilters(filters) {
    const out = [], dropped = [];
    for (const f of filters) {
      if (f.op === 'expr') { dropped.push(f.field); continue; }
      if (f.op === 'in' || f.op === 'notIn') out.push({ field: f.field, op: f.op, value: [].concat(f.value).map((v) => (v === '' ? BLANK : v)) });
      else out.push({ field: f.field, op: f.op, value: f.value });
    }
    if (dropped.length) toast(`Filter expressions on ${dropped.join(', ')} could not be converted; use >=, <=, = or a range`, 'warn');
    return out;
  }

  // ---------- the module ----------
  Scope.registerModule({
    id: 'explorer', layer: 1, order: 2, title: 'Explorer', status: 'built', icon: 'columns', activeFor: ['pivot'],
    /**
     * Apply a view token from the URL (only when it differs from the one this page last wrote, so replaceState
     * updates do not loop), build the page head and tab bar, then draw the active tab. Returns a cleanup function.
     */
    render(el, ctx) {
      const res = ctx.result;
      const params = ctx.params || [];
      if (params[0] === 'v' && params[1]) {
        if (params[1] !== S.lastToken) { try { applyView(decodeView(params[1])); S.lastToken = params[1]; S.preset = ''; S.viewName = ''; S.modified = true; } catch (e) { toast('The view in this link could not be read; showing the current view', 'warn'); } }
      } else if (TABS.some((t) => t[0] === params[0])) S.tab = params[0];
      closePop();

      const ccy = res.displayCurrency, unit = (res.config && res.config.unit) || 1e6, L = attributionLabel(res);
      const label = store.state.datasetLabel || 'Dataset';
      const synthetic = /synthetic/i.test(label);

      // ---------- page head ----------
      const presetSel = h('select', { class: 'input', title: 'Shipped pivot layouts (read-only; save as a view to keep changes)', onChange: (e) => { if (e.target.value) applyPreset(e.target.value); e.target.value = ''; } },
        h('option', { value: '' }, 'Presets…'), PRESETS.map((p) => h('option', { value: p.id }, p.name)));
      const viewSel = h('select', { class: 'input', title: 'Saved views (stored in this browser)', onChange: (e) => { if (e.target.value) loadView(e.target.value); } });
      // Saved-view selector; its placeholder shows the current view name with "*" when modified.
      const fillViews = () => { const views = loadViews(); viewSel.innerHTML = ''; viewSel.appendChild(h('option', { value: '' }, S.viewName ? `${S.viewName}${S.modified ? ' *' : ''}` : 'Saved views…')); for (const n of Object.keys(views).sort()) viewSel.appendChild(h('option', { value: n, selected: n === S.viewName }, n + (n === S.viewName && S.modified ? ' *' : ''))); };
      fillViews();
      const viewsBtn = h('button', { class: 'btn', type: 'button', title: 'Save, rename, delete, export or import views' }, icon('folder', 14), 'Views');
      viewsBtn.addEventListener('click', () => openPop(viewsBtn, menu([
        { label: S.viewName ? `Save "${S.viewName}"` : 'Save…', icon: 'check', onClick: () => (S.viewName ? saveView(S.viewName) : askName('Save view as', '', saveView)) },
        { label: 'Save as…', icon: 'plus', onClick: () => askName('Save view as', S.viewName ? S.viewName + ' copy' : '', saveView) },
        { label: 'Rename…', icon: 'edit-2', disabled: !S.viewName, onClick: () => askName('Rename view', S.viewName, (n) => { const v = loadViews(); if (n !== S.viewName) { v[n] = v[S.viewName]; delete v[S.viewName]; if (storeViews(v)) { S.viewName = n; fillViews(); } } }) },
        { label: 'Delete', icon: 'x', disabled: !S.viewName, onClick: () => { const v = loadViews(); delete v[S.viewName]; if (storeViews(v)) { toast(`Deleted view "${S.viewName}"`); S.viewName = ''; S.modified = false; fillViews(); } } },
        'sep',
        { label: 'Reset to default view', icon: 'refresh-cw', onClick: () => { S.pivot = defaultPivot(); S.preset = ''; S.viewName = ''; S.modified = false; S.tab = 'pivot'; fillViews(); draw(); } },
        { label: 'Export views (JSON)', icon: 'download', onClick: () => UI.downloadText(`scope_explorer_views_${datasetSlug()}.json`, JSON.stringify(loadViews(), null, 2), 'application/json') },
        { label: 'Import views (JSON)…', icon: 'upload', onClick: importViews },
      ])));
      const linkBtn = h('button', { class: 'btn', type: 'button', title: 'Copy a link that reproduces this view', onClick: () => { updateHash(); copyText(location.href, 'Link copied'); } }, icon('share-2', 14), 'Copy link');

      const nIn = res.stats.included, nEx = res.stats.excluded;
      el.appendChild(Scope.app.pageHead({
        title: `Explorer · ${res.platform.label}`,
        sub: h('span', {}, `${ccy} · amounts in millions · reporting date ${F.date(res.reportingDate)}${res.quarter ? ' · ' + res.quarter : ''} · ${nIn} positions, ${res.rows.length} assets in scope · attribution label "${L}" `,
          h('span', { class: 'badge ' + (synthetic ? 'badge-synthetic' : 'badge-primary'), title: `Source: ${store.state.datasetSource}` }, label),
          nEx ? [' ', h('a', { class: 'badge badge-warn', href: Scope.href('data', 'issues'), title: 'Positions excluded by the engine (never counted here)' }, `${nEx} excluded`)] : null,
          res.issues.length ? [' ', h('a', { class: 'badge badge-muted', href: Scope.href('data', 'issues') }, `${res.issues.length} issues`)] : null),
        actions: [presetSel, viewSel, viewsBtn, linkBtn],
      }));
      if (res.fatal) el.appendChild(h('div', { class: 'notice error' }, h('b', {}, 'Holdings cannot be processed. '), 'Required columns are missing after mapping — see ', h('a', { href: Scope.href('data', 'columns') }, 'column mapping'), '.'));

      // ---------- tabs ----------
      const tabsEl = h('div', { class: 'tabs xp-tabs' });
      const body = h('div', { class: 'xp-body' });
      el.append(tabsEl, body);

      /** Redraw the tab bar and the active tab (pivot builder or one of the grids). */
      function draw() {
        closePop();
        updateHash();
        tabsEl.innerHTML = '';
        for (const [id, name] of TABS) tabsEl.appendChild(h('button', { type: 'button', class: 'tab' + (S.tab === id ? ' active' : ''), onClick: () => { if (S.tab !== id) { S.tab = id; draw(); } } }, name));
        body.innerHTML = '';
        if (S.tab === 'pivot') drawPivot(body); else drawGrid(body, S.tab);
        fillViews();
      }

      // ================= PIVOT TAB =================
      /**
       * Pivot builder: field list (left), zones (Filters / Columns / Rows / Values), options bar, notices, summary,
       * cross-tab and chart. All state changes go through set(), which re-renders this tab locally.
       */
      function drawPivot(host) {
        const ds = dataset(res);
        sanitisePivot(ds);
        const fieldsPanel = h('div', { class: 'xp-fields' });
        const zonesEl = h('div', { class: 'xp-zones' });
        const optionsEl = h('div', { class: 'xp-options' });
        const summaryEl = h('div', { class: 'xp-summary' });
        const noticesEl = h('div', { class: 'xp-notices' });
        const resultEl = h('div', { class: 'xp-result' });
        const chartEl = h('div', {});
        const chartSection = UI.section({ title: 'Chart', subtitle: 'first row field as categories; column fields as series (capped at 8, rest folded into Other) · click a bar to drill', body: chartEl });
        const resultActions = [
          h('button', { class: 'btn btn-sm', type: 'button', title: 'Download the pivot table as CSV (subtotal and total rows flagged in the kind column)', onClick: exportPivot }, icon('download'), 'Pivot CSV'),
          h('button', { class: 'btn btn-sm', type: 'button', title: 'Download the filtered records behind this pivot (all fields)', onClick: exportRecords }, icon('download'), 'Records CSV'),
          h('button', { class: 'btn btn-sm', type: 'button', title: 'Copy the whole pivot as tab-separated text', onClick: copyPivot }, icon('clipboard'), 'Copy'),
        ];
        const resultSection = UI.section({ title: 'Pivot table', subtitle: 'click a label to expand or collapse, click a value to see the positions behind it', actions: resultActions, body: resultEl });
        const main = h('div', { class: 'xp-main' }, zonesEl, optionsEl, noticesEl, summaryEl, resultSection, chartSection);
        const layout = h('div', { class: 'xp-layout' + (S.panel ? '' : ' xp-panel-closed') }, fieldsPanel, main);
        host.appendChild(layout);

        // ----- field list -----
        const fieldSearch = h('input', { type: 'search', class: 'input xp-field-search', placeholder: 'Search fields', value: S.fieldSearch, 'aria-label': 'Search fields' });
        const fieldList = h('div', { class: 'xp-field-list' });
        fieldSearch.addEventListener('input', U.debounce(() => { S.fieldSearch = fieldSearch.value; renderFieldList(); }, 120));
        fieldsPanel.append(h('div', { class: 'xp-fields-head' }, h('strong', {}, 'Fields'), h('span', { class: 'muted small' }, ds.grain === 'assets' ? 'assets grain' : 'positions grain'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Hide the field list', onClick: () => { S.panel = false; layout.classList.add('xp-panel-closed'); renderOptions(); } }, icon('x'))), fieldSearch, fieldList);
        /** Field list grouped as in the dataset registry; fields already used are marked. Click adds, Space opens the zone menu, drag drops into a zone. */
        function renderFieldList() {
          fieldList.innerHTML = '';
          const q = S.fieldSearch.trim().toLowerCase();
          const inUse = new Set(S.pivot.rowDims.concat(S.pivot.colDims, S.pivot.values.map((v) => v.field), S.pivot.filters.map((f) => f.field)));
          for (const g of DS.GROUPS.concat(['Investor'])) {
            const fields = ds.fields.filter((f) => f.group === g && (!q || f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)));
            if (!fields.length || (g === 'Investor' && DS.GROUPS.includes(g) && fieldList.querySelector(`[data-group="${g}"]`))) continue;
            fieldList.appendChild(h('div', { class: 'xp-field-group', 'data-group': g }, g));
            for (const f of fields) {
              const row = h('div', { class: 'xp-field' + (inUse.has(f.id) ? ' in-use' : ''), draggable: 'true', title: (f.title || f.label) + (f.kind === 'measure' ? ` · ${AGG_LABEL[f.agg] || f.agg}${f.unitLabel ? ' · ' + f.unitLabel : ''}` : ' · dimension') + ' · click to add, drag into a zone', tabindex: '0', role: 'button' },
                h('span', { class: 'xp-glyph' }, glyph(f)), h('span', { class: 'xp-field-label' }, f.label),
                h('button', { class: 'xp-field-add', type: 'button', title: 'Add to…', 'aria-label': 'Add ' + f.label + ' to a zone', onClick: (e) => { e.stopPropagation(); openPop(e.currentTarget, addMenu(f)); } }, icon('plus', 12)));
              row.addEventListener('click', () => addField(f, f.kind === 'measure' ? 'values' : 'rows'));
              row.addEventListener('keydown', (e) => { if (e.key === 'Enter') addField(f, f.kind === 'measure' ? 'values' : 'rows'); else if (e.key === ' ') { e.preventDefault(); openPop(row, addMenu(f)); } });
              row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ field: f.id, from: 'list' })); e.dataTransfer.effectAllowed = 'copyMove'; });
              fieldList.appendChild(row);
            }
          }
          if (!fieldList.children.length) fieldList.appendChild(h('div', { class: 'empty small' }, 'No field matches'));
        }
        // "+" menu of a field: which zone to add it to (measures cannot be row or column fields).
        const addMenu = (f) => menu([
          { label: 'Add to Rows', icon: 'list', disabled: f.kind === 'measure', onClick: () => addField(f, 'rows') },
          { label: 'Add to Columns', icon: 'columns', disabled: f.kind === 'measure', onClick: () => addField(f, 'columns') },
          { label: f.kind === 'measure' ? 'Add to Values' : 'Add to Values (count)', icon: 'hash', onClick: () => addField(f, 'values') },
          { label: 'Add to Filters', icon: 'filter', onClick: () => addField(f, 'filters') },
        ]);
        /**
         * Add a field to a zone. A dimension lives in Rows or Columns, never both (adding moves it); a dimension in Values is
         * counted; a new filter starts open (all values / unbounded range) and its editor opens straight away.
         */
        function addField(f, zone) {
          const pv = S.pivot;
          if ((zone === 'rows' || zone === 'columns') && f.kind === 'measure') { toast(`${f.label} is a measure; put it in Values (or use its band dimension)`, 'warn'); return; }
          if (zone === 'rows') { if (pv.rowDims.includes(f.id)) { toast(`${f.label} is already in Rows`); return; } pv.colDims = pv.colDims.filter((x) => x !== f.id); pv.rowDims.push(f.id); }
          else if (zone === 'columns') { if (pv.colDims.includes(f.id)) { toast(`${f.label} is already in Columns`); return; } pv.rowDims = pv.rowDims.filter((x) => x !== f.id); pv.colDims.push(f.id); }
          else if (zone === 'values') pv.values.push({ field: f.id, agg: f.kind === 'measure' ? undefined : 'count', showAs: 'value' });
          else if (zone === 'filters') { const flt = f.kind === 'measure' ? { field: f.id, op: 'between', value: [null, null] } : { field: f.id, op: 'notIn', value: [] }; pv.filters.push(flt); set({}); const chip = zonesEl.querySelector(`.xp-chip[data-zone="filters"][data-index="${pv.filters.length - 1}"]`); if (chip) openFilterEditor(chip, pv.filters.length - 1); return; }
          set({});
        }

        // ----- zones -----
        /** Draw the four drop zones with their chips. */
        function renderZones() {
          zonesEl.innerHTML = '';
          const pv = S.pivot;
          zonesEl.append(
            zone('filters', 'Filters', pv.filters.map((f, i) => filterChip(f, i)), 'Drop a field to filter on it'),
            zone('columns', 'Columns', pv.colDims.map((id, i) => dimChip('columns', id, i)), 'Drop a dimension'),
            zone('rows', 'Rows', pv.rowDims.map((id, i) => dimChip('rows', id, i)), 'Drop a dimension'),
            zone('values', 'Values', pv.values.map((v, i) => valueChip(v, i)), 'Drop a measure'));
        }
        /**
         * One drop zone. Drag payload: { field, from: 'list' | zone id, index }. Dropping from the field list adds (before the
         * chip under the pointer, if any); within a zone reorders; across zones moves.
         */
        function zone(id, title, chips, placeholder) {
          const bodyEl = h('div', { class: 'xp-zone-body' }, chips.length ? chips : h('span', { class: 'xp-zone-empty' }, placeholder));
          const z = h('div', { class: 'xp-zone', 'data-zone': id }, h('div', { class: 'xp-zone-title' }, title, ' ', h('span', { class: 'muted' }, chips.length ? `(${chips.length})` : '')), bodyEl);
          z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
          z.addEventListener('dragleave', () => z.classList.remove('over'));
          z.addEventListener('drop', (e) => {
            e.preventDefault(); z.classList.remove('over');
            let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
            if (!data || !data.field) return;
            const f = ds.fieldById[data.field]; if (!f) return;
            const target = e.target.closest('.xp-chip'); const before = target ? parseInt(target.dataset.index, 10) : -1;
            if (data.from === 'list') { addField(f, id); if (before >= 0) moveWithin(id, lastIndex(id), before); return; }
            if (data.from === id) { moveWithin(id, data.index, before < 0 ? lastIndex(id) : before); return; }
            moveBetween(data.from, data.index, id, f);
          });
          return z;
        }
        // The array behind a zone (field ids for rows / columns, value specs, filter objects).
        const zoneList = (id) => (id === 'rows' ? S.pivot.rowDims : id === 'columns' ? S.pivot.colDims : id === 'values' ? S.pivot.values : S.pivot.filters);
        // Index of the last item in a zone (target for appends).
        const lastIndex = (id) => zoneList(id).length - 1;
        /** Reorder an item inside one zone. */
        function moveWithin(id, from, to) { const a = zoneList(id); if (from === to || from < 0 || from >= a.length) return; const [x] = a.splice(from, 1); a.splice(Math.min(to, a.length), 0, x); set({}); }
        /** Move a chip to another zone: into Values as a new value, into Filters as a new filter (the original stays), otherwise as a dimension. */
        function moveBetween(from, index, to, f) {
          const a = zoneList(from); const item = a[index]; if (item === undefined) return;
          if (to === 'values') { a.splice(index, 1); S.pivot.values.push({ field: f.id, agg: f.kind === 'measure' ? undefined : 'count', showAs: 'value' }); set({}); return; }
          if (to === 'filters') { addField(f, 'filters'); return; }
          if (f.kind === 'measure') { toast(`${f.label} is a measure; it cannot go into ${to === 'rows' ? 'Rows' : 'Columns'}`, 'warn'); return; }
          if (from === 'rows' || from === 'columns') a.splice(index, 1);
          const target = zoneList(to); if (!target.includes(f.id)) target.push(f.id);
          set({});
        }
        /** Draggable chip shell shared by all zones. */
        function chipBase(zoneId, index, label, titleText, extra) {
          const c = h('div', { class: 'chip xp-chip', draggable: 'true', 'data-zone': zoneId, 'data-index': index, title: titleText }, extra, h('span', { class: 'xp-chip-label' }, label));
          c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ field: chipField(zoneId, index), from: zoneId, index })); e.dataTransfer.effectAllowed = 'move'; });
          return c;
        }
        // Field id behind a chip; caret and xBtn build the chip's options and remove buttons (clicks do not bubble to the chip).
        const chipField = (zoneId, index) => { const x = zoneList(zoneId)[index]; return typeof x === 'string' ? x : x && x.field; };
        const caret = (onClick) => h('button', { class: 'xp-chip-btn', type: 'button', title: 'Options', 'aria-label': 'Options', onClick: (e) => { e.stopPropagation(); onClick(e.currentTarget); } }, icon('chevron-down', 12));
        const xBtn = (onClick) => h('button', { class: 'xp-chip-btn xp-chip-x', type: 'button', title: 'Remove', 'aria-label': 'Remove', onClick: (e) => { e.stopPropagation(); onClick(); } }, icon('x', 11));
        /** Row / column chip with its menu (move, filter, reorder, expand / collapse, Top N on the deepest row level, remove). */
        function dimChip(zoneId, id, index) {
          const f = ds.fieldById[id]; const pv = S.pivot; const list = zoneList(zoneId);
          const c = chipBase(zoneId, index, f.label, f.title || f.label, h('span', { class: 'xp-glyph' }, glyph(f)));
          const other = zoneId === 'rows' ? 'columns' : 'rows';
          c.appendChild(caret((btn) => openPop(btn, menu([
            { label: `Move to ${other === 'rows' ? 'Rows' : 'Columns'}`, icon: other === 'rows' ? 'list' : 'columns', onClick: () => { list.splice(index, 1); zoneList(other).push(id); set({}); } },
            { label: 'Add as filter', icon: 'filter', onClick: () => addField(f, 'filters') },
            { label: 'Move up', icon: 'chevron-down', disabled: index === 0, onClick: () => moveWithin(zoneId, index, index - 1) },
            { label: 'Move down', icon: 'chevron-down', disabled: index >= list.length - 1, onClick: () => moveWithin(zoneId, index, index + 1) },
            'sep',
            zoneId === 'rows' ? { label: 'Expand all', icon: 'plus', onClick: () => set({ collapsed: [] }) } : null,
            zoneId === 'rows' ? { label: 'Collapse this level', icon: 'minus', disabled: index >= pv.rowDims.length - 1, onClick: () => collapseToLevel(index + 1) } : null,
            zoneId === 'rows' && index === pv.rowDims.length - 1 ? { label: pv.topN ? `Top ${pv.topN.n} on (change…)` : 'Top N…', icon: 'award', onClick: () => askTopN() } : null,
            zoneId === 'rows' && pv.topN ? { label: 'Clear top N', icon: 'x', onClick: () => set({ topN: null }) } : null,
            'sep',
            { label: 'Remove', icon: 'x', onClick: () => { list.splice(index, 1); set({}); } },
          ].filter(Boolean)))));
          c.appendChild(xBtn(() => { list.splice(index, 1); set({}); }));
          return c;
        }
        /** Value chip with aggregation, show-as and custom label editors plus reorder / duplicate / remove. */
        function valueChip(v, index) {
          const f = ds.fieldById[v.field]; const pv = S.pivot;
          const agg = v.agg || f.agg || (f.kind === 'dimension' ? 'count' : 'sum');
          const lbl = v.label || `${agg === 'sum' ? '' : (AGG_LABEL[agg] || agg) + ' of '}${f.label}${v.showAs && v.showAs !== 'value' ? ' (' + SHOWAS.find((s) => s[0] === v.showAs)[1] + ')' : ''}`;
          const c = chipBase('values', index, lbl, `${AGG_LABEL[agg] || agg} of ${f.label}${f.unitLabel ? ' · ' + f.unitLabel : ''} · ${SHOWAS_TITLE[v.showAs || 'value']}`, h('span', { class: 'xp-glyph' }, glyph(f)));
          c.appendChild(caret((btn) => {
            const aggs = f.kind === 'dimension' ? ['count', 'countDistinct', 'min', 'max'] : P.AGGS;
            const aggSel = h('select', { class: 'input xp-pop-select', onChange: (e) => { v.agg = e.target.value; set({}); } }, aggs.map((a) => h('option', { value: a, selected: a === agg }, AGG_LABEL[a] + (a === f.agg ? ' (default)' : ''))));
            const showSel = h('select', { class: 'input xp-pop-select', onChange: (e) => { v.showAs = e.target.value; set({}); } }, SHOWAS.map(([id, name]) => h('option', { value: id, selected: id === (v.showAs || 'value') }, name)));
            const nameIn = h('input', { class: 'input xp-pop-select', placeholder: 'Custom label', value: v.label || '', onChange: (e) => { v.label = e.target.value.trim() || undefined; set({}); } });
            openPop(btn, menu([
              h('div', { class: 'xp-pop-field' }, h('label', {}, 'Aggregation'), aggSel),
              h('div', { class: 'xp-pop-field' }, h('label', {}, 'Show as'), showSel),
              h('div', { class: 'xp-pop-field' }, h('label', {}, 'Label'), nameIn),
              'sep',
              { label: 'Move up', icon: 'chevron-down', disabled: index === 0, onClick: () => moveWithin('values', index, index - 1) },
              { label: 'Move down', icon: 'chevron-down', disabled: index >= pv.values.length - 1, onClick: () => moveWithin('values', index, index + 1) },
              { label: 'Duplicate', icon: 'plus', onClick: () => { pv.values.splice(index + 1, 0, clone(v)); set({}); } },
              { label: 'Remove', icon: 'x', onClick: () => { pv.values.splice(index, 1); set({}); } },
            ]), 'xp-pop-values');
          }));
          c.appendChild(xBtn(() => { pv.values.splice(index, 1); set({}); }));
          return c;
        }
        /** Filter chip: click edits, × removes. */
        function filterChip(f, index) {
          const field = ds.fieldById[f.field];
          const c = chipBase('filters', index, filterLabel(f, field, unit), 'Click to edit this filter', h('span', { class: 'xp-glyph' }, icon('filter', 12)));
          c.classList.add('active');
          c.addEventListener('click', () => openFilterEditor(c, index));
          c.appendChild(xBtn(() => { S.pivot.filters.splice(index, 1); set({}); }));
          return c;
        }

        // ----- filter editor -----
        /**
         * Value picker for a dimension filter (measures and dates get the range editor). Lists every value of the field
         * in its natural order with record count and exposure under the other filters, as in Excel; zero-count values stay listed.
         */
        function openFilterEditor(anchor, index) {
          const flt = S.pivot.filters[index]; const field = ds.fieldById[flt.field]; if (!field) return;
          if (field.kind === 'measure' || field.type === 'date') return openRangeEditor(anchor, index, field);
          const others = S.pivot.filters.filter((x, i) => i !== index);
          const base = P.applyFilters(ds.records, ds.fieldById, others);
          const all = P.distinctValues(ds.records, field);
          const counts = new Map(P.distinctValues(base, field, 'exposure').map((e) => [e.value, e]));
          const cmp = P.labelComparator(field, 'asc');
          all.sort((a, b) => cmp(a.value, b.value));
          // tick what the current filter keeps: an "in" list as is, "notIn" as its complement, and any other operator
          // (eq, contains, startsWith, …) as the set of values it currently matches
          const selected = new Set(flt.op === 'in' ? [].concat(flt.value).map(String)
            : flt.op === 'notIn' ? all.map((e) => e.value).filter((v) => ![].concat(flt.value).map(String).includes(v))
              : P.distinctValues(P.applyFilters(ds.records, ds.fieldById, [flt]), field).map((e) => e.value));
          const search = h('input', { type: 'search', class: 'input xp-pop-search', placeholder: 'Search values' });
          const list = h('div', { class: 'xp-pick-list' });
          const foot = h('div', { class: 'xp-pick-foot' });
          // Store the selection compactly: everything → notIn [] (no restriction); more than half → notIn of the
          // unticked values (new values stay included); otherwise → in of the ticked values.
          const commit = () => {
            const values = all.map((e) => e.value);
            const chosen = values.filter((v) => selected.has(v));
            if (chosen.length === values.length) { flt.op = 'notIn'; flt.value = []; }
            else if (chosen.length > values.length / 2) { flt.op = 'notIn'; flt.value = values.filter((v) => !selected.has(v)); }
            else { flt.op = 'in'; flt.value = chosen; }
            set({}, true);
            foot.textContent = `${chosen.length} of ${values.length} selected`;
          };
          // Redraw the value list for the current search text, with counts under the other filters.
          const renderList = () => {
            list.innerHTML = '';
            const q = search.value.trim().toLowerCase();
            for (const e of all) {
              if (q && !e.value.toLowerCase().includes(q)) continue;
              const c = counts.get(e.value);
              const cb = h('input', { type: 'checkbox', checked: selected.has(e.value) ? true : null, onChange: () => { if (cb.checked) selected.add(e.value); else selected.delete(e.value); commit(); } });
              list.appendChild(h('label', { class: 'xp-pick' + (c ? '' : ' zero'), title: c ? `${c.count} records · ${ccy} ${mAmount(c.sum, unit)} m exposure under the other filters` : 'No records under the other filters' }, cb,
                h('span', { class: 'xp-pick-label' }, e.value), h('span', { class: 'xp-pick-count' }, c ? `${F.int(c.count)} · ${mAmount(c.sum, unit)}` : '0')));
            }
            if (!list.children.length) list.appendChild(h('div', { class: 'empty small' }, 'No values'));
          };
          search.addEventListener('input', U.debounce(renderList, 120));
          // Values matching the search text (All / None / Invert act on these only).
          const visibleValues = () => { const q = search.value.trim().toLowerCase(); return all.map((e) => e.value).filter((v) => !q || v.toLowerCase().includes(q)); };
          const actions = h('div', { class: 'xp-pick-actions' },
            h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { visibleValues().forEach((v) => selected.add(v)); renderList(); commit(); } }, 'All'),
            h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { visibleValues().forEach((v) => selected.delete(v)); renderList(); commit(); } }, 'None'),
            h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { visibleValues().forEach((v) => (selected.has(v) ? selected.delete(v) : selected.add(v))); renderList(); commit(); } }, 'Invert'),
            h('span', { class: 'grid-spacer-flex' }),
            h('button', { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => closePop() }, 'Done'));
          renderList();
          foot.textContent = `${all.filter((e) => selected.has(e.value)).length} of ${all.length} selected`;
          openPop(anchor, [h('div', { class: 'xp-pop-head' }, h('strong', {}, field.label), h('span', { class: 'muted small' }, 'counts under the other filters')), search, actions, list, foot], 'xp-pop-picker');
          search.focus();
        }
        /**
         * From / to editor for measures and dates (stored as between; a blank end is open). Amounts are typed in display
         * units (millions) and stored in full units; dates have presets relative to the reporting date.
         */
        function openRangeEditor(anchor, index, field) {
          const flt = S.pivot.filters[index];
          const isDate = field.type === 'date', scale = !isDate && field.unit && field.unit !== 1 ? field.unit : 1;
          const cur = Array.isArray(flt.value) ? flt.value : [flt.value, flt.value];
          // Stored bound → input text (display units for amounts); commit stores the inputs back as a between filter.
          const show = (v) => (v === null || v === undefined || v === '' ? '' : isDate ? String(v) : String(+(+v / scale).toFixed(6)));
          const lo = h('input', { class: 'input xp-pop-select', type: isDate ? 'date' : 'number', step: 'any', placeholder: 'from', value: show(flt.op === 'gte' || flt.op === 'between' || flt.op === 'eq' ? cur[0] : '') });
          const hi = h('input', { class: 'input xp-pop-select', type: isDate ? 'date' : 'number', step: 'any', placeholder: 'to', value: show(flt.op === 'lte' || flt.op === 'between' || flt.op === 'eq' ? cur[flt.op === 'lte' ? 0 : 1] : '') });
          const commit = () => {
            const a = lo.value === '' ? null : isDate ? lo.value : +lo.value * scale, b = hi.value === '' ? null : isDate ? hi.value : +hi.value * scale;
            flt.op = 'between'; flt.value = [a, b]; set({}, true);
          };
          lo.addEventListener('change', commit); hi.addEventListener('change', commit);
          const presets = isDate ? [
            ['Next 12 months', () => { const d = res.reportingDate || new Date(); const e = new Date(d); e.setUTCFullYear(e.getUTCFullYear() + 1); lo.value = U.isoDate(d); hi.value = U.isoDate(e); commit(); }],
            ['This year', () => { const y = (res.reportingDate || new Date()).getUTCFullYear(); lo.value = `${y}-01-01`; hi.value = `${y}-12-31`; commit(); }],
            ['2027–2029', () => { lo.value = '2027-01-01'; hi.value = '2029-12-31'; commit(); }],
            ['Before reporting date', () => { lo.value = ''; hi.value = U.isoDate(res.reportingDate || new Date()); commit(); }],
          ] : [];
          openPop(anchor, [
            h('div', { class: 'xp-pop-head' }, h('strong', {}, field.label), h('span', { class: 'muted small' }, isDate ? 'date range' : field.unitLabel || 'range')),
            h('div', { class: 'xp-pop-field' }, h('label', {}, 'From'), lo), h('div', { class: 'xp-pop-field' }, h('label', {}, 'To'), hi),
            presets.length ? h('div', { class: 'xp-pick-actions' }, presets.map(([n, fn]) => h('button', { class: 'btn btn-sm', type: 'button', onClick: fn }, n))) : null,
            h('div', { class: 'xp-pick-foot' }, h('span', { class: 'muted small' }, 'Blank ends are open; blank values never match'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => closePop() }, 'Done')),
          ], 'xp-pop-range');
          lo.focus();
        }
        /** Top N dialog: N and the value to rank by; N ≤ 0 clears it. */
        function askTopN() {
          const pv = S.pivot; const cur = pv.topN || { n: 10, valueIndex: 0 };
          const nIn = h('input', { class: 'input xp-pop-select', type: 'number', min: '1', max: '500', value: cur.n });
          const vSel = h('select', { class: 'input xp-pop-select' }, pv.values.map((v, i) => h('option', { value: i, selected: i === cur.valueIndex }, valueLabel(v, i))));
          const m = UI.modal({ title: 'Top N with Other', body: h('div', {}, h('p', { class: 'small muted' }, 'Keeps the N largest rows at the deepest row level (per parent) by the chosen value; the remainder is folded into "Other (k)" so totals still reconcile.'),
            h('div', { class: 'field' }, h('label', {}, 'N'), nIn), h('div', { class: 'field' }, h('label', {}, 'By value'), vSel)),
            actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => { const n = parseInt(nIn.value, 10); m.close(); set({ topN: n > 0 ? { n, valueIndex: +vSel.value || 0 } : null }); } }, 'Apply')] });
          nIn.focus();
        }
        /** Collapse the cross-tab so only the first `level` row levels are visible. */
        function collapseToLevel(level) {
          // show groups down to `level` (1 = only top-level rows): collapse every group row at level-1 or deeper
          const result = compute(ds); const R = S.pivot.rowDims.length;
          set({ collapsed: result.rows.filter((r) => r.kind === 'group' && r.level >= level - 1 && r.level < R - 1).map((r) => r.path.join('|')) });
        }
        // Display label of a value spec (custom label, else "<Agg> of <Field> (show-as)"; sums have no prefix).
        const valueLabel = (v, i) => { const f = ds.fieldById[v.field]; if (!f) return v.field; const agg = v.agg || f.agg || (f.kind === 'dimension' ? 'count' : 'sum'); return v.label || `${agg === 'sum' ? '' : (AGG_LABEL[agg] || agg) + ' of '}${f.label}${v.showAs && v.showAs !== 'value' ? ' (' + SHOWAS.find((s) => s[0] === v.showAs)[1] + ')' : ''}`; };

        // ----- options bar -----
        /** Grain, subtotals / grand total, sort, Top N, expand levels, chart toggle / type / value. */
        function renderOptions() {
          optionsEl.innerHTML = '';
          const pv = S.pivot; const R = pv.rowDims.length;
          // Checkbox bound to a boolean pivot option.
          const chk = (label, key, title) => h('label', { class: 'xp-opt', title }, h('input', { type: 'checkbox', checked: pv[key] ? true : null, onChange: (e) => set({ [key]: e.target.checked }) }), label);
          const sortSel = h('select', { class: 'input input-sm', title: 'Order of rows within each parent', onChange: (e) => { const [by, a, b] = e.target.value.split('|'); set({ sort: by === 'label' ? { by: 'label', valueIndex: 0, dir: a } : { by: 'value', valueIndex: +a, dir: b } }); } },
            h('option', { value: 'label|asc', selected: pv.sort.by === 'label' && pv.sort.dir !== 'desc' }, 'Sort: label A→Z'), h('option', { value: 'label|desc', selected: pv.sort.by === 'label' && pv.sort.dir === 'desc' }, 'Sort: label Z→A'),
            pv.values.map((v, i) => [h('option', { value: `value|${i}|desc`, selected: pv.sort.by === 'value' && pv.sort.valueIndex === i && pv.sort.dir !== 'asc' }, `Sort: ${valueLabel(v, i)} high→low`), h('option', { value: `value|${i}|asc`, selected: pv.sort.by === 'value' && pv.sort.valueIndex === i && pv.sort.dir === 'asc' }, `Sort: ${valueLabel(v, i)} low→high`)]));
          const topBtn = h('button', { class: 'btn btn-sm' + (pv.topN ? ' xp-on' : ''), type: 'button', title: 'Keep the N largest rows and fold the rest into Other', onClick: askTopN }, icon('award'), pv.topN ? `Top ${pv.topN.n}` : 'Top N');
          const srcSel = h('select', { class: 'input input-sm', title: 'Positions: one record per holding row and investor (exact for investor, tranche, currency). Assets: one record per Output row.', onChange: (e) => { S.pivot.source = e.target.value; S.pivot.collapsed = []; memo.key = null; S.modified = true; draw(); } },
            h('option', { value: 'positions', selected: pv.source === 'positions' }, 'Positions grain'), h('option', { value: 'assets', selected: pv.source === 'assets' }, 'Assets grain'));
          const levels = R > 1 ? h('span', { class: 'xp-opt' }, 'Expand to ', Array.from({ length: R }, (x, i) => h('button', { class: 'btn btn-sm', type: 'button', title: `Show ${i + 1} level${i ? 's' : ''}`, onClick: () => (i + 1 >= R ? set({ collapsed: [] }) : collapseToLevel(i + 1)) }, String(i + 1)))) : null;
          const chartChk = h('label', { class: 'xp-opt' }, h('input', { type: 'checkbox', checked: pv.chart.on ? true : null, onChange: (e) => set({ chart: Object.assign({}, pv.chart, { on: e.target.checked }) }) }), 'Chart');
          const chartType = h('select', { class: 'input input-sm', disabled: !pv.chart.on, onChange: (e) => set({ chart: Object.assign({}, pv.chart, { type: e.target.value }) }) },
            [['hbar', 'Horizontal bars'], ['bar', 'Columns'], ['donut', 'Donut'], ['stacked', 'Stacked (by column field)']].map(([id, n]) => h('option', { value: id, selected: pv.chart.type === id, disabled: id === 'stacked' && !pv.colDims.length }, n)));
          const chartVal = pv.values.length > 1 ? h('select', { class: 'input input-sm', disabled: !pv.chart.on, onChange: (e) => set({ chart: Object.assign({}, pv.chart, { valueIndex: +e.target.value }) }) }, pv.values.map((v, i) => h('option', { value: i, selected: pv.chart.valueIndex === i }, valueLabel(v, i)))) : null;
          optionsEl.append(...[
            S.panel ? null : h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { S.panel = true; layout.classList.remove('xp-panel-closed'); renderOptions(); } }, icon('columns'), 'Fields'),
            srcSel, chk('Subtotals', 'subtotals', 'Subtotal rows and column totals per group'), chk('Grand total', 'grandTotal', 'Grand total row and column'),
            sortSel, topBtn, levels,
            h('span', { class: 'xp-opt' }, h('button', { class: 'btn btn-sm', type: 'button', onClick: () => set({ collapsed: [] }) }, 'Expand all'), h('button', { class: 'btn btn-sm', type: 'button', disabled: R < 2, onClick: () => collapseToLevel(1) }, 'Collapse all')),
            h('span', { class: 'grid-spacer-flex' }), chartChk, chartType, chartVal].filter(Boolean));
        }

        // ----- compute + result -----
        /**
         * Summary line, reconciliation badge, notices and the cross-tab + chart. The tie-out badge compares Σ exposure of the
         * records in scope with the engine's total_exposure_m; it is only meaningful with the default filter (Excluded = No)
         * on positions or no filter on assets, and is replaced by a neutral note otherwise.
         */
        function renderResult() {
          const pv = S.pivot; const R = pv.rowDims.length, Cn = pv.colDims.length;
          noticesEl.innerHTML = ''; resultEl.innerHTML = ''; summaryEl.innerHTML = '';
          if (!pv.values.length) { resultEl.appendChild(h('div', { class: 'empty' }, 'Add a measure to Values (for example Exposure) to build the pivot.')); chartEl.innerHTML = '<div class="chart-empty">No values</div>'; return; }
          const result = compute(ds);
          const V = result.values.length;
          // summary sentence: x of y records, EUR a of b m (c %)
          const filtered = P.applyFilters(ds.records, ds.fieldById, pv.filters);
          const expFiltered = P.aggregate(filtered, 'exposure', 'sum', ds.fieldById);
          const expEngine = (res.metrics.total_exposure_m || 0) * unit;
          const grain = ds.grain === 'assets' ? 'assets' : 'positions';
          summaryEl.append(...[h('span', { class: 'xp-sentence' }, `Showing ${F.int(result.filteredCount)} of ${F.int(result.recordCount)} ${grain} · ${ccy} ${mAmount(expFiltered, unit)} of ${mAmount(expEngine, unit)} m exposure (${expEngine ? F.pct(expFiltered / expEngine) : '–'})`),
            pv.filters.length ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => set({ filters: [] }) }, 'Clear filters') : null,
            nEx ? h('a', { class: 'badge badge-warn', href: Scope.href('data', 'issues') }, `${nEx} excluded`) : null].filter(Boolean));
          // reconciliation against the engine
          const onlyDefault = pv.filters.length === 1 && pv.filters[0].field === 'excluded' && pv.filters[0].op === 'in' && [].concat(pv.filters[0].value).join() === 'No';
          const noFilter = pv.filters.length === 0 && ds.grain === 'assets';
          if (onlyDefault || noFilter) {
            const delta = expFiltered - expEngine;
            summaryEl.appendChild(Math.abs(delta) < 0.5 ? h('span', { class: 'badge badge-ok', title: 'Σ exposure of the records in scope equals the engine metric total_exposure_m' }, `ties to engine total ${mAmount(expEngine, unit)}`) : h('span', { class: 'badge badge-warn', title: 'Σ exposure of the records differs from the engine metric' }, `delta vs engine ${mAmount(delta, unit)}`));
          } else if (pv.filters.length) summaryEl.appendChild(h('span', { class: 'muted small' }, `engine total ${mAmount(expEngine, unit)} before filters`));
          // look-through guard: with platform weights < 1, exposure ≠ nominal per investor, so investor rows need a caveat
          const lookThrough = (res.platform.composition || []).some((c) => isNum(c.weight) && c.weight < 1);
          const investorDims = ['investor_label', 'investor_key', 'investor_group'];
          if (lookThrough && pv.rowDims.concat(pv.colDims).some((d) => investorDims.includes(d))) noticesEl.appendChild(h('div', { class: 'notice' }, h('b', {}, 'Look-through platform. '), `Investor rows show each investor's nominal at 100 %; the platform "${res.platform.label}" applies weights, so exposure and nominal do not sum to the same figure. Nothing is double counted.`));
          if (ds.grain === 'assets' && pv.filters.concat(pv.rowDims.map((d) => ({ field: d })), pv.colDims.map((d) => ({ field: d }))).some((f) => investorDims.includes(f.field))) noticesEl.appendChild(h('div', { class: 'notice info' }, 'Investor fields are not available at the assets grain; switch to Positions grain to break down or filter by investor.'));
          if (result.dropped.length) noticesEl.appendChild(h('div', { class: 'notice' }, `Fields not in this dataset were dropped: ${U.uniq(result.dropped).join(', ')}`));
          if (R > 4) noticesEl.appendChild(h('div', { class: 'notice info' }, `${R} row levels: consider collapsing levels or using Top N for readability.`));
          if (!result.filteredCount) { resultEl.appendChild(h('div', { class: 'empty' }, 'No records match the current filters. ', h('button', { class: 'btn btn-sm', type: 'button', onClick: () => set({ filters: [] }) }, 'Clear filters'))); chartEl.innerHTML = '<div class="chart-empty">No data</div>'; return; }
          if (result.cellCount > 20000) noticesEl.appendChild(h('div', { class: 'notice' }, h('b', {}, `${F.int(result.cellCount)} cells. `), 'Collapse levels or apply Top N to keep the table readable. ', h('button', { class: 'btn btn-sm', type: 'button', onClick: () => collapseToLevel(1) }, 'Collapse all'), ' ', h('button', { class: 'btn btn-sm', type: 'button', onClick: askTopN }, 'Top N')));

          const vis = visibleRows(result, R);
          const shown = vis.length > MAX_VISIBLE_ROWS ? vis.slice(0, MAX_VISIBLE_ROWS) : vis;
          if (vis.length > MAX_VISIBLE_ROWS) noticesEl.appendChild(h('div', { class: 'notice' }, `Showing the first ${F.int(MAX_VISIBLE_ROWS)} of ${F.int(vis.length)} rows; collapse levels, filter or use Top N to see the rest (exports contain everything).`));
          resultEl.appendChild(buildTable(result, shown, R, Cn, V));
          renderChart(result, vis, R, Cn);
        }
        /**
         * Cross-tab as an HTML table. Column header rows: one per column field (cells span their leaf columns × values, column
         * subtotals labelled at their own level) plus a value-name row when there are several values; each header row sticks at
         * top = level × HEAD_H. Row labels are indented by level. A single delegated click handler expands / collapses a group
         * label, or drills through from a label or value cell (data-ck identifies the column key; '' is the row total).
         */
        function buildTable(result, vis, R, Cn, V) {
          const pv = S.pivot; const colKeys = result.colKeys; const values = result.values;
          const HEAD_H = 30;
          const table = h('table', { class: 'xp-pivot', role: 'grid' });
          const thead = h('thead'), tbody = h('tbody'), tfoot = h('tfoot');
          const cornerLabel = R ? pv.rowDims.map((d) => (ds.fieldById[d] || { label: d }).label).join(' / ') : 'Total';
          // Header cell for a value (label, unit, show-as explanation in the tooltip).
          const valueTh = (v, extraCls) => h('th', { class: 'xp-th-val ' + (extraCls || ''), title: `${v.label}${v.unitLabel ? ' · ' + v.unitLabel : ''} · ${SHOWAS_TITLE[v.showAs] || ''}` }, v.label, v.unitLabel ? h('small', { class: 'xp-th-unit' }, v.unitLabel) : null);
          const headerRows = Cn > 0 ? Cn + (V > 1 ? 1 : 0) : 1;
          if (Cn > 0) {
            for (let l = 0; l < Cn; l++) {
              const tr = h('tr', { style: { top: l * HEAD_H + 'px' } });
              if (l === 0) tr.appendChild(h('th', { class: 'xp-label xp-corner', rowspan: headerRows }, cornerLabel));
              let i = 0;
              while (i < colKeys.length) {
                const ck = colKeys[i];
                const gid = ck.path.length > l ? ck.path.slice(0, l + 1).join('|') : ck.key + '|__st' + l;
                const text = ck.path.length > l ? ck.path[l] : (ck.kind === 'subtotal' && l === ck.path.length ? ck.label : '');
                let j = i + 1;
                while (j < colKeys.length) { const o = colKeys[j]; const og = o.path.length > l ? o.path.slice(0, l + 1).join('|') : o.key + '|__st' + l; if (og !== gid) break; j++; }
                tr.appendChild(h('th', { class: 'xp-th-col' + (ck.kind === 'subtotal' && l >= ck.path.length ? ' xp-th-sub' : ''), colspan: (j - i) * V, title: (ds.fieldById[pv.colDims[l]] || {}).label + ': ' + text }, text));
                i = j;
              }
              if (l === 0 && pv.grandTotal) tr.appendChild(h('th', { class: 'xp-th-col xp-th-total', colspan: V, rowspan: headerRows }, 'Total'));
              thead.appendChild(tr);
            }
            if (V > 1) { const tr = h('tr', { style: { top: Cn * HEAD_H + 'px' } }); for (const ck of colKeys) values.forEach((v) => tr.appendChild(valueTh(v))); thead.appendChild(tr); }
          } else {
            const tr = h('tr', { style: { top: '0px' } }, h('th', { class: 'xp-label xp-corner' }, cornerLabel)); values.forEach((v) => tr.appendChild(valueTh(v))); thead.appendChild(tr);
          }
          const rowIndex = new Map(vis.map((r, i) => [r, i]));
          // Value cells of one row: per column key × value, then the row total when there are no column fields or totals are on.
          const cellsFor = (r, tr, kindCls) => {
            for (const ck of colKeys) { const cell = r.cells[ck.key]; values.forEach((v, vi) => tr.appendChild(h('td', { class: 'xp-num xp-cell' + kindCls + (ck.kind === 'subtotal' ? ' xp-col-sub' : ''), 'data-ck': ck.key }, cell && isNum(cell[vi]) ? v.format(cell[vi]) : ''))); }
            if (Cn === 0 || pv.grandTotal) values.forEach((v, vi) => tr.appendChild(h('td', { class: 'xp-num xp-cell xp-row-total-cell' + kindCls, 'data-ck': '' }, isNum(r.rowTotal[vi]) ? v.format(r.rowTotal[vi]) : '')));
          };
          const collapsed = new Set(pv.collapsed);
          for (let i = 0; i < vis.length; i++) {
            const r = vis[i]; if (r.kind === 'total') continue;
            const hasKids = r.kind === 'group' && r.level < R - 1;
            const key = r.path.join('|');
            const tr = h('tr', { class: 'xp-row xp-row-' + r.kind + (r.other ? ' xp-row-other' : ''), 'data-r': i });
            const lbl = h('td', { class: 'xp-label' + (hasKids ? ' xp-has-kids' : ''), style: { paddingLeft: 8 + (r.kind === 'subtotal' ? r.level : r.level) * 16 + 'px' }, title: r.kind === 'group' ? (hasKids ? 'Click to expand or collapse' : 'Click to see the records behind this row') + (r.other ? ` · folds ${r.folded} rows: ${r.foldedLabels.slice(0, 8).join(', ')}${r.folded > 8 ? '…' : ''}` : '') : 'Click to see the records behind this total' },
              hasKids ? h('button', { class: 'xp-toggle', type: 'button', 'aria-expanded': collapsed.has(key) ? 'false' : 'true', 'aria-label': collapsed.has(key) ? 'Expand' : 'Collapse' }, icon(collapsed.has(key) ? 'plus' : 'minus', 10)) : null,
              r.label, r.kind === 'group' ? h('span', { class: 'xp-count muted' }, ` ${F.int(r.count)}`) : null);
            tr.appendChild(lbl);
            cellsFor(r, tr, '');
            tbody.appendChild(tr);
          }
          const total = result.rows.find((r) => r.kind === 'total');
          if (total && pv.grandTotal) { const tr = h('tr', { class: 'xp-row xp-row-total', 'data-r': rowIndex.has(total) ? rowIndex.get(total) : -1 }, h('td', { class: 'xp-label', title: 'Click to see all records in scope' }, 'Grand total', h('span', { class: 'xp-count muted' }, ` ${F.int(total.count)}`))); cellsFor(total, tr, ''); tfoot.appendChild(tr); }
          table.append(thead, tbody, tfoot);
          table.addEventListener('click', (e) => {
            const td = e.target.closest('td'); if (!td) return;
            const tr = td.parentElement; const ri = parseInt(tr.dataset.r, 10);
            const row = ri >= 0 ? vis[ri] : total;
            if (!row) return;
            if (td.classList.contains('xp-label')) {
              if (row.kind === 'group' && row.level < R - 1) { toggleCollapse(row.path.join('|')); return; }
              drill(row, null); return;
            }
            const ck = td.dataset.ck; drill(row, ck ? colKeys.find((c) => c.key === ck) : null);
          });
          table.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('xp-toggle')) e.target.click(); });
          return h('div', { class: 'xp-pivot-wrap' }, table);
        }
        /** Expand / collapse one group (key = its label path joined with "|"), redrawing only the result. */
        function toggleCollapse(key) { const c = new Set(S.pivot.collapsed); if (c.has(key)) c.delete(key); else c.add(key); S.pivot.collapsed = Array.from(c); S.modified = true; updateHash(); renderResult(); }
        /** Depth-first rows minus the descendants and subtotal of each collapsed group (the group row then carries its total). */
        function visibleRows(result, R) {
          const collapsed = new Set(S.pivot.collapsed); const out = []; let skip = null;
          for (const r of result.rows) {
            if (skip) {
              const p = r.path;
              if (r.kind !== 'total' && p.length > skip.length && p.slice(0, skip.length).join('|') === skip.join('|')) continue;
              if (r.kind === 'subtotal' && p.join('|') === skip.join('|')) continue;
              skip = null;
            }
            out.push(r);
            if (r.kind === 'group' && r.level < R - 1 && collapsed.has(r.path.join('|'))) skip = r.path;
          }
          return out;
        }
        /**
         * Chart of the top-level row groups for the chosen value: bars, columns, donut, or stacked bars by column key (largest 8
         * series kept, the rest folded into "Other", negative parts clipped at 0). Amounts are shown in millions. Clicking drills.
         */
        function renderChart(result, vis, R, Cn) {
          const pv = S.pivot; chartEl.innerHTML = '';
          chartSection.classList.toggle('hidden', !pv.chart.on);
          if (!pv.chart.on) return;
          const vi = Math.min(pv.chart.valueIndex, result.values.length - 1); const val = result.values[vi];
          const fmt = val.showAs !== 'value' ? (v) => F.pct(v) : val.unit && val.unit !== 1 ? (v, tick) => (tick ? F.int(v / val.unit) : F.m(v / val.unit) + 'm') : (v) => val.format(v);
          const top = vis.filter((r) => r.kind === 'group' && r.level === 0);
          if (!R || !top.length) { chartEl.innerHTML = '<div class="chart-empty">Add a row field to chart</div>'; return; }
          const type = pv.chart.type === 'stacked' && !Cn ? 'hbar' : pv.chart.type;
          const clickRow = (it) => { if (it.row) drill(it.row, null); }; // chart click drills through like a label click
          requestAnimationFrame(() => {
            if (!chartEl.isConnected) return;
            if (type === 'stacked') {
              const leaves = result.colKeys.filter((c) => c.kind === 'group');
              const sums = leaves.map((c) => ({ c, s: top.reduce((a, r) => a + ((r.cells[c.key] && isNum(r.cells[c.key][vi])) ? r.cells[c.key][vi] : 0), 0) })).sort((a, b) => b.s - a.s);
              const keep = sums.slice(0, 8).map((x) => x.c), rest = sums.slice(8).map((x) => x.c);
              const series = keep.map((c) => c.path.join(' / ')).concat(rest.length ? ['Other (' + rest.length + ')'] : []);
              const rows = top.map((r) => { const parts = {}; keep.forEach((c, i) => { const cell = r.cells[c.key]; parts[series[i]] = cell && isNum(cell[vi]) ? Math.max(0, cell[vi]) : 0; }); if (rest.length) parts[series[series.length - 1]] = rest.reduce((a, c) => a + ((r.cells[c.key] && isNum(r.cells[c.key][vi])) ? Math.max(0, r.cells[c.key][vi]) : 0), 0); return { label: r.label, parts, row: r }; });
              C.stacked(chartEl, { rows, series, format: (v) => fmt(v), max: 30, onClick: clickRow });
            } else {
              const items = top.map((r) => ({ label: r.label, value: r.rowTotal[vi], sub: `${F.int(r.count)} records`, row: r })).filter((x) => isNum(x.value));
              if (type === 'bar') C.bar(chartEl, { items: items.slice(0, 40), format: (v, tick) => fmt(v, tick), onClick: clickRow });
              else if (type === 'donut') C.donut(chartEl, { items: items.filter((x) => x.value > 0), format: (v) => fmt(v), max: 8, centre: { value: fmt(result.grandTotal[vi]), label: 'total' }, onClick: clickRow });
              else C.hbar(chartEl, { items, format: (v) => fmt(v), max: 30, onClick: clickRow });
            }
          });
        }
        /** Run the pivot, memoised on engine result + every configuration input that affects numbers (not collapse / chart). */
        function compute(dsx) {
          const pv = S.pivot;
          const key = JSON.stringify([pv.source, pv.rowDims, pv.colDims, pv.values, pv.filters, pv.sort, pv.topN, pv.subtotals, pv.grandTotal]);
          if (memo.res === res && memo.key === key) return memo.result;
          const result = P.run({ records: dsx.records, fieldById: dsx.fieldById, rowDims: pv.rowDims, colDims: pv.colDims, values: pv.values, filters: pv.filters, sort: pv.sort, topN: pv.topN, subtotals: pv.subtotals, grandTotal: pv.grandTotal });
          memo = { res, key, result };
          return result;
        }

        // ----- drill-through: the row/column path becomes filters on the grid tab -----
        function drill(row, ck) {
          const pv = S.pivot; const filters = clone(pv.filters); const crumbs = [];
          if (row.kind !== 'total') {
            for (let i = 0; i < row.path.length; i++) {
              const fid = pv.rowDims[i]; if (!fid) break;
              if (row.other && i === row.path.length - 1) { filters.push({ field: fid, op: 'in', value: row.foldedLabels.slice() }); crumbs.push(row.label); }
              else { filters.push({ field: fid, op: 'in', value: [row.path[i]] }); crumbs.push(row.path[i]); }
            }
          } else crumbs.push('Grand total');
          if (ck && ck.path) for (let i = 0; i < ck.path.length; i++) { const fid = pv.colDims[i]; if (!fid) break; filters.push({ field: fid, op: 'in', value: [ck.path[i]] }); crumbs.push(ck.path[i]); }
          const grain = ds.grain === 'assets' ? 'assets' : 'positions';
          S.pendingGridFilters[grain] = toGridFilters(filters, ds.fieldById);
          S.drillNote = { grain, text: crumbs.join(' › ') || 'all records', count: ck ? null : row.count }; // row.count is the whole row; a cell's count is what the grid shows
          S.tab = grain; draw();
        }

        // ----- exports -----
        /** Pivot CSV via Scope.pivot.toRecords (kind column flags subtotals / totals). */
        function exportPivot() { const result = compute(ds); const recs = P.toRecords(result); download(fileName('pivot', res), Scope.csv.serialize(recs, recs.headers)); }
        /** The same table as TSV on the clipboard (tabs inside text become spaces). */
        function copyPivot() {
          const result = compute(ds); const recs = P.toRecords(result); const H = recs.headers;
          const lines = [H.join('\t')]; for (const r of recs) lines.push(H.map((k) => { const v = r[k]; return v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).replace(/\t/g, ' '); }).join('\t'));
          copyText(lines.join('\n'), `Copied ${recs.length} pivot rows`);
        }
        /** Records CSV: the filtered records behind the pivot, every field, amounts in display units, headers de-duplicated. */
        function exportRecords() {
          const recs = P.applyFilters(ds.records, ds.fieldById, S.pivot.filters);
          const seen = new Map(); const headers = ds.fields.map((f) => { let hd = f.label + (f.kind === 'measure' && f.unitLabel ? ` (${f.unitLabel})` : ''); if (seen.has(hd)) { const n = seen.get(hd) + 1; seen.set(hd, n); hd += ` (${n})`; } else seen.set(hd, 1); return hd; });
          const out = recs.map((r) => { const o = {}; ds.fields.forEach((f, i) => { const v = f.get(r); o[headers[i]] = f.kind === 'measure' ? (isNum(v) ? (f.unit && f.unit !== 1 ? v / f.unit : v) : '') : v; }); return o; });
          download(fileName(ds.grain === 'assets' ? 'assets' : 'positions', res), Scope.csv.serialize(out, headers));
        }

        // ----- state change → local re-render (never Scope.app.render) -----
        /** Merge a pivot patch, mark the view modified, mirror it to the URL and re-render the builder (keepPop leaves an open editor open). */
        function set(patch, keepPop) {
          Object.assign(S.pivot, patch);
          if (patch.rowDims || patch.colDims) S.pivot.collapsed = [];
          S.modified = true; S.preset = S.preset && !S.viewName ? S.preset : S.preset;
          if (!keepPop) closePop();
          updateHash(); fillViews();
          renderZones(); renderOptions(); renderResult(); renderFieldList();
        }
        renderFieldList(); renderZones(); renderOptions(); renderResult();
      }

      /** Drop fields that the current grain does not have (e.g. investor fields on assets), with a toast, and clamp value indexes. */
      function sanitisePivot(ds) {
        const pv = S.pivot; const dropped = [];
        // Keep a field id only if this grain has it; otherwise remember it for the toast.
        const keep = (id) => { if (ds.fieldById[id]) return true; dropped.push(id); return false; };
        pv.rowDims = pv.rowDims.filter((id) => keep(id) && ds.fieldById[id].kind === 'dimension');
        pv.colDims = pv.colDims.filter((id) => keep(id) && ds.fieldById[id].kind === 'dimension' && !pv.rowDims.includes(id));
        pv.values = pv.values.filter((v) => keep(v.field));
        pv.filters = pv.filters.filter((f) => keep(f.field));
        if (pv.sort.valueIndex >= pv.values.length) pv.sort.valueIndex = 0;
        if (pv.topN && pv.topN.valueIndex >= pv.values.length) pv.topN.valueIndex = 0;
        if (pv.chart.valueIndex >= pv.values.length) pv.chart.valueIndex = 0;
        if (dropped.length) toast(`Dropped fields not in the ${ds.grain} dataset: ${U.uniq(dropped).join(', ')}`, 'warn');
      }

      // ================= GRID TABS =================
      /**
       * Positions or Assets grid: every dataset field as a column (a curated set visible by default, identity columns frozen,
       * the first four investors' columns shown on the assets grain). Measure footers use the field's aggregation (sum, or
       * Scope.pivot.aggregate for weighted averages and distinct counts); amount exports are in display units. Pending
       * filters from a drill-through or an AUM link are applied once; otherwise positions default to Excluded = No.
       */
      function drawGrid(host, grain) {
        const ds = grain === 'assets' ? DS.buildAssets(res) : DS.build(res);
        const fields = ds.fields;
        const frozenIds = grain === 'assets' ? ['rank', 'asset_code', 'asset_name'] : ['asset_code', 'asset_name'];
        const defaultVisible = new Set(grain === 'assets'
          ? ['rank', 'asset_code', 'asset_name', 'sector', 'subsector', 'country', 'currency', 'rating', 'ig_label', 'fixed_floating', 'repayment_type', 'maturity_date', 'maturity_bucket', 'remaining_years', 'exposure', 'exposure_drawn', 'drawn_pct', 'nominal', 'attributed', 'third_party', 'margin_bps', 'wal_years', 'watchlist', 'positions', 'investors']
          : ['asset_code', 'asset_name', 'investor_label', 'investor_group', 'tranche', 'sector', 'subsector', 'country', 'currency', 'rating', 'ig_label', 'fixed_floating', 'maturity_date', 'maturity_bucket', 'remaining_years', 'nominal', 'drawn', 'undrawn', 'exposure', 'attributed', 'third_party', 'margin_bps', 'wal_years', 'excluded']);
        const investorCols = fields.filter((f) => f.group === 'Investor' && f.investor);
        const firstInvestors = new Set(U.uniq(investorCols.map((f) => f.investor)).slice(0, 4));
        // Dataset field → grid column definition.
        const toColumn = (f) => {
          const measure = f.kind === 'measure';
          const col = { key: f.id, label: f.label, type: measure ? 'number' : f.type === 'date' ? 'date' : 'text', group: f.group, title: f.title || f.label, hidden: !(defaultVisible.has(f.id) || (f.investor && firstInvestors.has(f.investor))), frozen: frozenIds.includes(f.id) };
          if (measure) {
            col.unit = f.unitLabel || undefined; col.format = (v) => f.format(v);
            // per-asset measures (GHG, transaction size) must count each asset once, so only plain sums use the grid's own sum
            col.total = f.agg === 'sum' && !f.perAsset ? 'sum' : (rows) => P.aggregate(rows, f);
            if (f.unit && f.unit !== 1) col.exportValue = (v) => (isNum(v) ? +(v / f.unit).toFixed(6) : '');
            col.width = 110;
          } else if (f.type !== 'date') { col.format = (v) => f.format(v); col.width = f.id === 'asset_name' || f.id === 'security_name' || f.id === 'sponsor' ? 200 : f.id === 'asset_code' || f.id === 'currency' || f.id === 'rating' || f.id === 'ig_label' ? 84 : 130; }
          if (f.id === 'asset_code') col.href = (r) => Scope.href('asset', r.asset_code);
          if (f.id === 'excluded') col.cellClass = (v) => (v === 'Yes' ? 'warn' : '');
          if (f.id === 'watchlist') col.cellClass = (v) => (v && v !== 'No' ? 'warn' : '');
          if (f.id === 'ig_label') col.cellClass = (v) => (v === 'IG' ? 'ok' : v === 'NR' ? 'dim' : 'warn');
          if (f.id === 'rank') col.width = 60;
          return col;
        };
        const columns = frozenIds.map((id) => ds.fieldById[id]).filter(Boolean).map(toColumn).concat(fields.filter((f) => !frozenIds.includes(f.id)).map(toColumn));
        let hasStored = false; try { hasStored = !!localStorage.getItem('scope.grid.' + grain); } catch (e) { hasStored = false; }
        const toPivotBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Use the current grid filters as pivot filters', onClick: () => { S.pivot.filters = fromGridFilters(grid.getFilters()); if (S.pivot.source !== grain) { S.pivot.source = grain; S.pivot.collapsed = []; } S.modified = true; S.tab = 'pivot'; draw(); } }, icon('grid'), 'Pivot this');
        const grid = UI.grid({
          columns, rows: ds.records, rowKey: grain === 'assets' ? 'asset_code' : 'position_key', height: '66vh', storageKey: grain, ariaLabel: grain === 'assets' ? 'Assets grid' : 'Positions grid',
          exportName: fileName(grain, res), onRow: (r) => { if (r && r.asset_code) Scope.navigate('asset', r.asset_code); }, extraToolbar: toPivotBtn,
        });
        if (S.pendingGridFilters[grain]) { const pend = S.pendingGridFilters[grain]; grid.setFilters(Array.isArray(pend) ? pend : toGridFilters(pend.contract || [], ds.fieldById)); S.pendingGridFilters[grain] = null; }
        else if (!hasStored && grain === 'positions') grid.setFilters([{ field: 'excluded', op: 'in', value: ['No'] }]);
        const note = S.drillNote && S.drillNote.grain === grain ? h('div', { class: 'notice info xp-drill-note' }, h('b', {}, 'Drill-through: '), `${S.drillNote.text}${isNum(S.drillNote.count) ? ` · ${F.int(S.drillNote.count)} records from the pivot` : ''}. `, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { S.drillNote = null; grid.clearFilters(); note.remove(); } }, 'Clear'), ' ', h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => { S.tab = 'pivot'; draw(); } }, 'Back to pivot')) : null;
        if (S.drillNote && S.drillNote.grain === grain) S.drillNote = null;
        host.appendChild(UI.section({
          title: grain === 'assets' ? `Assets · one row per asset with exposure on ${res.platform.label}` : `Positions · one row per holding row and investor`,
          subtitle: grain === 'assets' ? `${F.int(ds.records.length)} assets · every Output field plus attributes, ESG and one nominal and drawn column per investor (Columns button shows the rest) · double-click a row for the asset page`
            : `${F.int(ds.records.length)} positions (excluded ones carry Excluded = Yes and are filtered out by default) · every dimension and measure of the dataset is a column · double-click a row for the asset page`,
          body: h('div', {}, note, grid),
        }));
      }

      // ================= presets / views =================
      /** Load a shipped preset on top of the default pivot (keeping the default Excluded = No filter unless the preset sets filters). */
      function applyPreset(id) {
        const p = PRESETS.find((x) => x.id === id); if (!p) return;
        const base = defaultPivot();
        S.pivot = normalisePivot(Object.assign(base, clone(p.pivot), { filters: p.pivot.filters ? clone(p.pivot.filters) : base.filters }));
        S.preset = id; S.viewName = ''; S.modified = false; S.tab = 'pivot';
        toast(`Preset "${p.name}" applied`); draw();
      }
      /** Save the current tab + pivot under a name (overwrites a view of the same name). */
      function saveView(name) {
        name = String(name || '').trim(); if (!name) return;
        const v = loadViews(); v[name] = { t: S.tab, p: clone(S.pivot), savedAt: new Date().toISOString() };
        if (storeViews(v)) { S.viewName = name; S.modified = false; S.preset = ''; fillViews(); toast(`View "${name}" saved`); }
      }
      /** Load a saved view by name. */
      function loadView(name) {
        const v = loadViews()[name]; if (!v) { toast(`View "${name}" not found`, 'warn'); fillViews(); return; }
        applyView(v); S.viewName = name; S.modified = false; S.preset = ''; draw();
      }
      /** Small modal asking for a view name; Enter or Save calls cb(name). */
      function askName(title, initial, cb) {
        const input = h('input', { class: 'input', value: initial || '', placeholder: 'View name' });
        const m = UI.modal({ title, body: h('div', { class: 'field' }, h('label', {}, 'Name'), input), actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => { const n = input.value.trim(); if (!n) { input.focus(); return; } m.close(); cb(n); } }, 'Save')] });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const n = input.value.trim(); if (n) { m.close(); cb(n); } } });
        input.focus(); input.select();
      }
      /** Import views from a JSON file (same shape as the export); entries are normalised and merged by name. */
      function importViews() {
        const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
        input.addEventListener('change', () => {
          const file = input.files && input.files[0]; if (!file) return;
          const reader = new FileReader();
          // Merge every entry that looks like a saved view ({ t, p }); anything else in the file is ignored.
          reader.onload = () => { try { const o = JSON.parse(String(reader.result)); if (!o || typeof o !== 'object') throw new Error('not an object'); const v = loadViews(); let n = 0; for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object' && o[k].p) { v[k] = { t: o[k].t, p: normalisePivot(o[k].p), savedAt: o[k].savedAt || new Date().toISOString() }; n++; } } if (storeViews(v)) { fillViews(); toast(`Imported ${n} view(s)`); } } catch (e) { toast('The file is not a Scope views export', 'warn'); } };
          reader.readAsText(file);
        });
        document.body.appendChild(input); input.click(); setTimeout(() => input.remove(), 60000);
      }

      draw();
      return () => closePop();
    },
  });

  // "Open in Pivot" links (#/pivot/v/<token>) land on the explorer's pivot tab: the AUM-page token is re-issued in the explorer's own shape.
  Scope.registerModule({
    id: 'pivot', layer: 1, order: 99, title: 'Pivot', status: 'built', icon: 'columns', hidden: true,
    /** Redirect to the explorer: an AUM-page token is applied and re-encoded; anything else opens the pivot tab. */
    render(el, ctx) {
      const params = ctx.params || [];
      let view = null;
      if (params[0] === 'v' && params[1]) { try { view = decodeView(params[1]); } catch (e) { view = null; } }
      if (view && !view.p && !view.t) { applyView(Object.assign({}, view, { t: 'pivot' })); Scope.navigate('explorer', 'v', encodeView()); }
      else Scope.navigate('explorer', 'pivot');
      el.appendChild(h('div', { class: 'empty' }, 'Opening the pivot…'));
    },
  });
})(window);
