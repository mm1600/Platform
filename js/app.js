/* Scope app shell (loaded last by index.html).
 *
 * Loads the data (saved user files, served CSVs or the embedded demo), draws the sidebar and the top bar, and routes
 * the URL hash (#/<module>/<params…>) to the page registered with Scope.registerModule. Every store change (data,
 * platform, currency, global filters, corrections) re-renders the top bar and the current page in place.
 * Pages receive ctx = { result, params, store, settings, navigate, href, module, app } and may return a cleanup function.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, h = Scope.ui.h, store = Scope.store, F = U.fmt, icon = Scope.icon;
  const App = (Scope.app = {});
  let cleanup = null, lastRoute = null;

  /** Start-up: restore settings, load data, draw the shell, then route on every hash change and store update. */
  App.init = async function () {
    store.restore();
    await App.loadInitialData();
    App.renderShell();
    window.addEventListener('hashchange', App.render);
    store.subscribe(() => { App.renderSidebar(); App.renderTopbar(); App.render(true); });
    window.addEventListener('resize', U.debounce(() => App.render(true), 150));
    App.render();
  };

  /** Data source order: the workbook sheets the user loaded earlier (saved in IndexedDB) → the bundled synthetic demo. */
  App.loadInitialData = async function () {
    let saved = null;
    try { saved = await store.loadSavedSheets(); } catch (e) { saved = null; }
    try { const t = await store.loadSavedTemplate(); if (t && t.bytes) store.state.template = t; } catch (e) { /* no template kept */ }
    try { const d = await store.loadSavedReportData(); if (d && typeof d === 'object') store.state.reportData = d; } catch (e) { /* no report inputs kept */ }
    if (saved && saved.sheets && Object.keys(saved.sheets).length) { store.loadSaved(saved); return; }
    App.loadDemo();
  };
  /** Load the bundled synthetic demo workbook (data/demo.js). */
  App.loadDemo = function () {
    const demo = global.SCOPE_DEMO;
    if (demo && demo.sheets) store.setSheets(demo.sheets, Object.fromEntries(Object.keys(demo.sheets).map((k) => [k, { kind: 'demo', file: 'data/demo.js', sheetName: k }])), { demo: true, label: demo.label });
    else store.setSheets({}, {}, { demo: true });
  };
  /** Forget the loaded workbook and reload the demo. */
  App.resetToDemo = function () { store.clearSavedSheets(); App.loadDemo(); Scope.ui.toast('Demo workbook restored'); };

  // ---------- shell ----------
  App.renderShell = function () { App.renderSidebar(); App.renderTopbar(); };

  /** Sidebar: brand, then each business layer with its pages (built, partial or planned), then dataset info. */
  App.renderSidebar = function () {
    const side = document.getElementById('sidebar-content');
    const route = Scope.router.parse(location.hash);
    side.innerHTML = '';
    side.appendChild(h('a', { class: 'sidebar-brand', href: Scope.href('aum') }, icon('layers', { size: 26 }), h('span', {}, 'Scope', h('small', {}, 'Infrastructure debt platform'))));
    const nav = h('ul', { class: 'sidebar-nav' });
    for (const layer of Scope.layers) {
      const mods = Scope.modulesForLayer(layer.id);
      nav.appendChild(h('li', { class: 'sidebar-header', title: layer.short }, layer.title));
      for (const m of mods) {
        const active = route.id === m.id || (m.activeFor && m.activeFor.includes(route.id));
        nav.appendChild(h('li', { class: 'sidebar-item ' + m.status + (active ? ' active' : '') },
          h('a', { class: 'sidebar-link', href: Scope.href(m.id), onClick: () => document.getElementById('sidebar').classList.remove('open') },
            icon(m.icon || 'box'), h('span', {}, m.title),
            m.status === 'planned' ? h('span', { class: 'sidebar-badge' }, 'Planned') : m.status === 'partial' ? h('span', { class: 'sidebar-badge' }, 'Partial') : null)));
      }
    }
    side.appendChild(nav);
    side.appendChild(h('div', { class: 'sidebar-cta' }, h('div', {}, h('strong', { style: { color: '#e9ecef' } }, store.state.datasetLabel || 'Dataset'), ' · ', { demo: 'bundled demo workbook', workbook: 'your workbook' }[store.state.datasetSource] || ''),
      h('div', { style: { marginTop: '.35rem' } }, `Scope v${Scope.version} · `, h('a', { href: 'tests/index.html', target: '_blank' }, 'engine tests'), ' · ', h('a', { href: 'README.md', target: '_blank' }, 'README'))));
  };


  /**
   * The Look-through dropdown: the investor columns in the selected view and, under each, its segments (Mapping › Funding
   * Name rows: fund name Y with code AA). Picking one narrows every page to it through the global filters (investor or
   * segment), so view weights still apply; "All of …" removes it, and changing the view resets it.
   */
  function lookThroughSelect(res) {
    const base = res.base || res, comp = (base.platform && base.platform.composition) || [];
    const all = comp.some((c) => c.label === '*');
    const weightOf = (l) => comp.reduce((s, c) => s + (c.label === '*' || c.label === l ? +c.weight || 0 : 0), 0);
    const cols = ((base.inputs && base.inputs.investors) || []).filter((i) => all || comp.some((c) => c.label === i.label && c.weight));
    // amounts in the view, per code, from the unfiltered positions
    const idk = (Scope.calc && Scope.calc.aum && Scope.calc.aum.idKey) || ((v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase()); // codes match as the calculation matches them
    const byCode = new Map(); for (const p of base.positions || []) if (!p.excluded) byCode.set(idk(p.investor_id), (byCode.get(idk(p.investor_id)) || 0) + (p.nominal_base || 0) * weightOf(p.investor_label));
    const unit = (base.config && base.config.unit) || 1e6, m = (v) => `${F.m(v / unit)}m`;
    const opts = cols.map((i) => ({ i, segs: (i.segments || []).filter((s) => s.name || s.code), total: (i.ids || []).reduce((t, id) => t + (byCode.get(idk(id)) || 0), 0) })).filter((x) => x.total);
    const many = opts.length > 1;
    if (!opts.length || (!many && opts[0].segs.length < 2)) return null;
    const flt = (store.state.settings.globalFilters || []);
    // the choice in force: a segment sets both the investor and the segment filter (two codes may share a fund name)
    const one = (field) => { const f = flt.find((x) => x.field === field && x.op === 'in' && (x.value || []).length === 1); return f ? f.value[0] : null; };
    const curSeg = one('investor_key'), curCol = one('investor_label');
    const value = curSeg ? 'seg:' + (curCol || '') + '|' + curSeg : curCol ? 'col:' + curCol : '';
    const choose = (v) => {
      const rest = flt.filter((f) => f.field !== 'investor_key' && f.field !== 'investor_label');
      if (v.startsWith('seg:')) { const [col, seg] = v.slice(4).split('|'); if (col) rest.push({ field: 'investor_label', op: 'in', value: [col] }); rest.push({ field: 'investor_key', op: 'in', value: [seg] }); }
      else if (v.startsWith('col:')) rest.push({ field: 'investor_label', op: 'in', value: [v.slice(4)] });
      Scope.filters ? Scope.filters.set(rest) : store.setSetting('globalFilters', rest);
    };
    const children = [h('option', { value: '', selected: !value }, `All of ${base.platform ? base.platform.label : 'the view'}`)];
    for (const x of opts) {
      const items = [];
      if (many) items.push(h('option', { value: 'col:' + x.i.label, selected: value === 'col:' + x.i.label }, `All of ${x.i.label} · ${m(x.total)}`));
      if (x.segs.length > 1 || !many) for (const s of x.segs) { const v = 'seg:' + x.i.label + '|' + (s.name || s.code); items.push(h('option', { value: v, selected: value === v }, `${s.name || s.code}${s.name ? ` (${s.code})` : ''} · ${m(byCode.get(idk(s.code)) || 0)}`)); }
      children.push(many ? h('optgroup', { label: x.i.label }, items) : items);
    }
    return h('label', {}, 'Look-through', h('select', { class: 'input' + (value ? ' input-active' : ''), title: 'An investor in this view, or one of its segments (Mapping › Funding Name)', onChange: (e) => choose(e.target.value) }, children));
  }

  /**
   * The Asset and Name dropdowns, by code name (Mapping › Code Name): the assets grouped as Mapping › Transaction Group groups
   * them ("Asset A" for "Asset A" and "Asset A top-up"), then the code names inside the groups picked. Each opens the checklist (All, None or ticks) and sets a
   * global filter, so every page, export and report follows; the filter row shows them like any other filter.
   */
  function assetSelects() {
    const flt = store.state.settings.globalFilters || [];
    const pick = (field, label, all, title) => {
      const f = flt.find((x) => x.field === field && x.op === 'in'), vals = f ? (f.value || []).map(String) : [];
      const text = !vals.length ? all : vals.length === 1 ? vals[0] : `${vals[0]} +${vals.length - 1}`;
      return h('label', {}, label, h('button', { type: 'button', class: 'input tb-dd' + (vals.length ? ' input-active' : ''), title: vals.length ? `${title}: ${vals.join(', ')}` : title,
        onClick: (e) => { e.preventDefault(); if (Scope.filters && Scope.filters.openEditor) Scope.filters.openEditor(e.currentTarget, field); } }, text));
    };
    return [pick('asset_group', 'Asset', 'All assets', 'Assets by code name, grouped by Mapping › Transaction Group'), pick('code_name', 'Name', 'All', 'The code names inside the assets picked')];
  }

  /** Top bar: menu button, the View, Look-through, Asset, Name and Currency selectors, reporting date, search, dataset and issue badges, filter row. */
  App.renderTopbar = function () {
    const bar = document.getElementById('topbar');
    const res = App.safeResult();
    bar.innerHTML = '';
    bar.appendChild(h('button', { class: 'hamburger', onClick: () => document.getElementById('sidebar').classList.toggle('open'), 'aria-label': 'Toggle navigation' }, icon('menu', { size: 22 })));
    if (res) {
      const platSel = h('select', { class: 'input', onChange: (e) => store.setSetting('platform', e.target.value), title: 'View (Mapping column H, the Output!G8 choice)' },
        res.platforms.map((p) => h('option', { value: p.id, selected: p.id === res.platformId }, p.label)));
      const ccySel = h('select', { class: 'input', onChange: (e) => store.setSetting('currency', e.target.value), title: 'Display currency (Output!G6)' },
        res.currencies.map((c) => h('option', { value: c, selected: c === res.displayCurrency }, c)));
      let ltSel = null; try { ltSel = lookThroughSelect(res); } catch (e) { console.error(e); }
      let assetSel = []; try { if (Scope.filters) assetSel = assetSelects(); } catch (e) { console.error(e); }
      bar.append(h('label', {}, 'View', platSel), ltSel || '', ...assetSel, h('label', {}, 'Currency', ccySel),
        h('span', { class: 'nav-text', title: 'Reporting date = earliest position date (workbook rule)' }, icon('calendar', { size: 14 }), ` Reporting date ${F.date(res.reportingDate)}${res.quarter ? ' · ' + res.quarter : ''}`));
    }
    // global search (assets, investors, values, pages) — see js/core/filters.js
    if (res && Scope.filters) Scope.filters.renderSearch(bar);
    bar.appendChild(h('span', { class: 'spacer' }));
    if (res) {
      const label = store.state.datasetLabel || 'Dataset';
      bar.appendChild(h('a', { href: Scope.href('data'), class: 'badge ' + (/synthetic/i.test(label) ? 'badge-synthetic' : 'badge-primary'), title: `Source: ${store.state.datasetSource}` }, label));
      const n = res.issueCounts.error || 0, w = res.issueCounts.warn || 0;
      bar.appendChild(h('a', { href: Scope.href('data', 'issues'), class: 'badge ' + (n ? 'badge-error' : w ? 'badge-warn' : 'badge-ok'), title: 'Data issues' }, n ? `${n} errors` : w ? `${w} warnings` : 'Data OK', w && n ? ` · ${w} warn` : ''));
      // global filters apply to every page; the row sits under the navbar controls
      if (Scope.filters) Scope.filters.renderBar(bar);
    }
  };

  /** The current engine result, or null when no data is loaded or the engine fails (errors are logged, not thrown). */
  App.safeResult = function () { try { return store.missingSheets().length === store.SHEETS.length ? null : store.result(); } catch (e) { console.error(e); return null; } };

  // ---------- routing ----------
  App.render = function (soft) {
    const route = Scope.router.parse(location.hash);
    const content = document.getElementById('content');
    const mod = Scope.modules.get(route.id);
    if (!soft || !lastRoute || lastRoute.id !== route.id) { App.renderSidebar(); const mainEl = document.querySelector('.main'); if (mainEl) mainEl.scrollTop = 0; window.scrollTo(0, 0); }
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    content.innerHTML = '';
    const ctx = { params: route.params, store, settings: store.state.settings, navigate: Scope.navigate, href: Scope.href, module: mod, result: null, app: App };
    if (!mod) { content.appendChild(Scope.ui.section({ title: 'Not found', body: `No module "${U.escapeHtml(route.id)}".` })); return; }
    try {
      ctx.result = App.safeResult();
      if (!ctx.result && mod.needsData !== false) { content.appendChild(h('div', { class: 'notice error' }, 'No dataset loaded. ', h('a', { href: Scope.href('data') }, 'Load CSV files'), ' or ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); App.resetToDemo(); } }, 'restore the demo dataset'), '.')); return; }
      const ret = mod.render(content, ctx);
      if (typeof ret === 'function') cleanup = ret;
    } catch (e) {
      console.error(e);
      content.appendChild(h('div', { class: 'notice error' }, h('b', {}, 'Module error: '), String(e && e.message || e)));
    }
    lastRoute = route;
    document.title = `${mod.title} · Scope`;
  };

  // shared page header: "<strong>AUM</strong> · Total platform" like AdminKit's "<strong>Analytics</strong> Dashboard"
  App.pageHead = function ({ title, sub, actions, crumbs }) {
    const parts = String(title).split(' · ');
    const h1 = parts.length > 1 ? h('h1', { class: 'h3' }, h('strong', {}, parts[0]), ' · ' + parts.slice(1).join(' · ')) : h('h1', { class: 'h3' }, h('strong', {}, title));
    return h('div', { class: 'page-head' }, h('div', {}, crumbs ? h('div', { class: 'crumbs' }, crumbs) : null, h1, sub ? h('div', { class: 'sub' }, sub) : null), actions ? h('div', { class: 'page-actions' }, actions) : null);
  };

  document.addEventListener('DOMContentLoaded', () => { App.init().catch((e) => { console.error(e); document.getElementById('content').textContent = 'Failed to start: ' + e.message; }); });
})(window);
