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
    const persisted = store.restore();
    await App.loadInitialData(persisted);
    App.renderShell();
    window.addEventListener('hashchange', App.render);
    store.subscribe(() => { App.renderSidebar(); App.renderTopbar(); App.render(true); });
    window.addEventListener('resize', U.debounce(() => App.render(true), 150));
    App.render();
  };

  /** Data source order: files the user loaded earlier → CSVs served next to the page → the embedded demo copy. */
  App.loadInitialData = async function (persisted) {
    if (persisted && persisted.files && Object.keys(persisted.files).length) { store.setTables(persisted.files, 'file'); return; }
    if (/^https?:$/.test(location.protocol)) {
      try {
        const files = {};
        await Promise.all(store.REQUIRED.map(async (n) => { const r = await fetch('data/demo/' + n, { cache: 'no-store' }); if (!r.ok) throw new Error(n); files[n] = await r.text(); }));
        // optional tables (e.g. fund_lookthrough.csv): load when present, ignore when absent
        await Promise.all(store.OPTIONAL.map(async (n) => { try { const r = await fetch('data/demo/' + n, { cache: 'no-store' }); if (r.ok) files[n] = await r.text(); } catch (e) { /* optional */ } }));
        store.setTables(files, 'fetch'); return;
      } catch (e) { /* fall through to embedded */ }
    }
    if (global.SCOPE_DEMO) store.setTables(global.SCOPE_DEMO, 'embedded');
    else store.setTables({}, 'none');
  };
  /** Drop user-loaded files and reload the embedded demo dataset. */
  App.resetToDemo = function () { store.clearDataset(); if (global.SCOPE_DEMO) store.setTables(global.SCOPE_DEMO, 'embedded'); Scope.ui.toast('Demo dataset restored'); };

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
    side.appendChild(h('div', { class: 'sidebar-cta' }, h('div', {}, h('strong', { style: { color: '#e9ecef' } }, store.state.datasetLabel || 'Dataset'), ' · ', { embedded: 'embedded demo', fetch: 'served CSVs', file: 'loaded files', none: 'no data' }[store.state.datasetSource] || ''),
      h('div', { style: { marginTop: '.35rem' } }, `Scope v${Scope.version} · `, h('a', { href: 'tests/index.html', target: '_blank' }, 'engine tests'), ' · ', h('a', { href: 'README.md', target: '_blank' }, 'README'))));
  };

  /** Top bar: menu button, platform and currency selectors, reporting date, search, dataset and issue badges, filter row. */
  App.renderTopbar = function () {
    const bar = document.getElementById('topbar');
    const res = App.safeResult();
    bar.innerHTML = '';
    bar.appendChild(h('button', { class: 'hamburger', onClick: () => document.getElementById('sidebar').classList.toggle('open'), 'aria-label': 'Toggle navigation' }, icon('menu', { size: 22 })));
    if (res) {
      const platSel = h('select', { class: 'input', onChange: (e) => store.setSetting('platform', e.target.value), title: 'Platform (Output!G8)' },
        res.platforms.map((p) => h('option', { value: p.id, selected: p.id === res.platformId }, p.label)));
      const ccySel = h('select', { class: 'input', onChange: (e) => store.setSetting('currency', e.target.value), title: 'Display currency (Output!G6)' },
        res.currencies.map((c) => h('option', { value: c, selected: c === res.displayCurrency }, c)));
      bar.append(h('label', {}, 'Platform', platSel), h('label', {}, 'Currency', ccySel),
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
  App.safeResult = function () { try { return store.missingTables().length === store.REQUIRED.length ? null : store.result(); } catch (e) { console.error(e); return null; } };

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
