/* Module: Layer 2 · ESG — portfolio ESG view over the selected platform. Small on purpose: it is the template for adding a module.
 *
 * Registers the 'esg' page (route #/esg, sidebar Layer 2, status 'partial'). Reads only the AUM engine result
 * passed in ctx.result: ESG metrics (weighted score, coverage, GHG, green share) and distributions come from
 * AUM.summarise, and the per-asset attributes from esg.csv via the Output rows. The only figures computed here
 * are chart groupings of engine values (GHG by sector, top emitters). Loaded by index.html after the engines.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts, AUM = Scope.engine.aum;

  Scope.registerModule({
    id: 'esg', layer: 2, order: 8, title: 'ESG', status: 'partial', icon: 'globe',
    /** Render KPI cards, four charts and the per-asset ESG table into el for the current engine result. */
    render(el, ctx) {
      const res = ctx.result, ccy = res.displayCurrency, rows = res.rows, M = res.metrics, D = res.distributions, mfmt = (v) => F.m(v) + 'm';
      el.appendChild(Scope.app.pageHead({ title: `ESG · ${res.platform.label}`, sub: 'asset and portfolio ESG from esg.csv (stand-in for Greenscope / RDR feeds) · methodology is an open definition (brief §8.8)' }));
      el.appendChild(h('div', { class: 'notice info' }, 'Partial module: shows what the data model already supports. Scoring methodology, coverage rules and reporting templates must be confirmed before figures are treated as authoritative.'));
      el.appendChild(h('div', { class: 'kpis' },
        UI.kpi({ icon: 'globe', label: 'Weighted ESG score', value: U.isNum(M.w_esg_score) ? F.n1(M.w_esg_score) : '–', sub: `coverage ${F.pct(M.esg_coverage, 0)} of exposure` }),
        UI.kpi({ icon: 'zap', label: 'GHG scope 1+2', value: F.int(M.ghg_scope12_t) + ' t', sub: 'sum of asset-level values, not exposure-weighted' }),
        UI.kpi({ icon: 'sun', label: 'Green loans', value: F.pct(M.green_share), sub: 'share of exposure' }),
        UI.kpi({ icon: 'check-circle', label: 'CBI aligned', value: F.pct((D.cbi_taxonomy.find((d) => d.label === 'Aligned') || { share: 0 }).share), sub: 'share of exposure' }),
      ));
      // GHG is an absolute per-asset figure, so it is summed (not exposure-weighted) by sector.
      const bySector = (() => { const m = new Map(); for (const r of rows) m.set(r.sector, (m.get(r.sector) || 0) + r.ghg_scope12_t); return Array.from(m, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); })();
      const emitters = rows.slice().sort((a, b) => b.ghg_scope12_t - a.ghg_scope12_t).slice(0, 10).map((r) => ({ label: r.name, value: r.ghg_scope12_t, sub: r.sector, code: r.code }));
      const c1 = h('div'), c2 = h('div'), c3 = h('div'), c4 = h('div');
      el.appendChild(h('div', { class: 'charts' },
        UI.section({ title: 'CBI taxonomy', subtitle: 'exposure share', body: c1 }), UI.section({ title: 'SFDR article', subtitle: 'exposure share', body: c2 }),
        UI.section({ title: 'GHG scope 1+2 by sector', subtitle: 'tonnes', body: c3 }), UI.section({ title: 'Largest emitters', subtitle: 'scope 1+2 tonnes · click for asset', body: c4 })));
      // Charts size themselves from their container width, so draw after the sections are laid out.
      requestAnimationFrame(() => {
        C.donut(c1, { items: D.cbi_taxonomy, format: mfmt }); C.donut(c2, { items: D.sfdr_article, format: mfmt });
        C.hbar(c3, { items: bySector, format: (v) => F.int(v) + ' t' }); C.hbar(c4, { items: emitters, format: (v) => F.int(v) + ' t', onClick: (it) => Scope.navigate('asset', it.code) });
      });
      el.appendChild(UI.section({ title: 'Assets', body: UI.table({ rows, exportName: 'scope_esg.csv', sortKey: 'exposure_m', onRow: (r) => Scope.navigate('asset', r.code), columns: [
        { key: 'name', label: 'Asset', class: 'strong' }, { key: 'sector', label: 'Sector' }, { key: 'exposure_m', label: `Exposure ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
        { key: 'esg_score', label: 'ESG score', align: 'right', format: (v) => (U.isNum(v) ? F.int(v) : '–') }, { key: 'cbi_taxonomy', label: 'CBI' }, { key: 'sfdr_article', label: 'SFDR' }, { key: 'green_loan', label: 'Green loan' },
        { key: 'ghg_scope12_t', label: 'GHG s1+2 (t)', align: 'right', format: F.int, total: 'sum' },
        { key: 'ghg_intensity', label: 'Intensity t/€m', align: 'right', format: (v, r) => { const x = r.asset.esg.ghg_intensity_t_per_eurm; return U.isNum(x) ? F.int(x) : '–'; }, sortValue: (r) => r.asset.esg.ghg_intensity_t_per_eurm },
        { key: 'coverage', label: 'Data', format: (v, r) => r.asset.esg.data_coverage || '' }] }) }));
    },
  });
})(window);
