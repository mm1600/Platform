/* Scope core: layers, module registry and hash router.
 *
 * Registers Scope.layers (the six platform layers shown as sidebar sections),
 * Scope.modules / Scope.registerModule / Scope.modulesForLayer (every page is a
 * self-registering module file under js/modules/), and Scope.router / Scope.navigate /
 * Scope.href (routes are "#/<module id>/<param>/..."). app.js reads the registry to
 * build the sidebar and renders the module matching the current hash.
 *
 * Adding a module (see README "Add a module"):
 *   Scope.registerModule({ id:'cashflows', layer:1, title:'Cash flows', status:'built',
 *                          render(el, ctx){ el.innerHTML = '...'; } });
 * ctx = { params, result, store, settings, navigate, href, module, app }
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});

  // Sidebar sections in display order; a module's `layer` must match one of these ids.
  Scope.layers = [
    { id: -2, title: 'Layer −2 · Pipeline', short: 'Pipeline & origination' },
    { id: -1, title: 'Layer −1 · Execution', short: 'Execution, guidelines, allocation, closing' },
    { id: 0, title: 'Layer 0 · Source data', short: 'Imports, mapping, validation' },
    { id: 1, title: 'Layer 1 · AUM', short: 'Holdings, investor positions, cash flows' },
    { id: 2, title: 'Layer 2 · Monitoring', short: 'Credit, KPIs, watchlist, valuation, ESG' },
    { id: 3, title: 'Layer 3 · Outputs', short: 'Views, investor books, reports' },
  ];

  const modules = new Map();
  Scope.modules = modules;
  /**
   * Register (or replace, by id) a page module.
   * Defaults: status 'planned', order 100 (sort position within its layer), hidden false
   * (hidden modules are routable but not listed in the sidebar, e.g. the asset page).
   * @param {{id:string, layer:number, title:string, status?:string, order?:number,
   *          hidden?:boolean, render:function(HTMLElement, Object)}} def
   * @returns {Object} the normalised definition
   */
  Scope.registerModule = function (def) {
    if (!def || !def.id) throw new Error('module needs an id');
    def.status = def.status || 'planned';
    def.order = def.order === undefined ? 100 : def.order;
    def.hidden = !!def.hidden;
    modules.set(def.id, def);
    return def;
  };
  /** Visible modules of one layer, sorted by `order` (for the sidebar). */
  Scope.modulesForLayer = (layerId) => Array.from(modules.values()).filter((m) => m.layer === layerId && !m.hidden).sort((a, b) => a.order - b.order);

  // ---------- router ----------
  // Hash routing keeps the app working from file:// (no server rewrites needed).
  const R = (Scope.router = { current: { id: 'aum', params: [] }, default: 'aum' });
  /** "#/asset/A001" → { id: 'asset', params: ['A001'] }; an empty hash maps to the default page. */
  R.parse = function (hash) {
    const h = (hash || '').replace(/^#\/?/, '');
    if (!h) return { id: R.default, params: [] };
    const parts = h.split('/').map(decodeURIComponent);
    return { id: parts[0], params: parts.slice(1) };
  };
  /** Build a route hash from a module id and params, URI-encoding each segment. */
  R.path = (id, ...params) => '#/' + [id, ...params].map(encodeURIComponent).join('/');
  /** Navigate by setting location.hash; app.js re-renders on hashchange. */
  Scope.navigate = function (id, ...params) { location.hash = R.path(id, ...params); };
  Scope.href = R.path;
})(typeof window !== 'undefined' ? window : globalThis);
