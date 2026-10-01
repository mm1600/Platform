/* Scope page: Layer 2 · ESG (route #/esg).
 *
 * Portfolio ESG view over the selected view (and the global filters), from the ESG Hardcoded sheet: E, S, G and ESG
 * scores, the CHI sector classification and GHG scopes 1–3. Scores are exposure-weighted; emissions are summed per
 * asset (not weighted). Small on purpose: it is the template for adding a page (see README › Extending the platform).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts;

  /** Exposure-weighted average of an ESG field over Output rows (rows without a value are skipped). */
  function wavg(rows, field) {
    let n = 0, d = 0;
    for (const r of rows) { const v = r.asset.esg[field]; if (U.isNum(v)) { n += v * r.exposure_m; d += r.exposure_m; } }
    return d ? n / d : NaN;
  }
  /** Score band label for an ESG score (0–100). */
  const band = (v) => (!U.isNum(v) ? 'No score' : v >= 80 ? '80–100' : v >= 70 ? '70–79' : v >= 60 ? '60–69' : v >= 50 ? '50–59' : 'Below 50');

  Scope.registerModule({
    id: 'esg', layer: 2, order: 8, title: 'ESG', status: 'partial', icon: 'globe',
    /** Render KPIs, four charts and the asset table. */
    render(el, ctx) {
      const res = ctx.result, ccy = res.displayCurrency, rows = res.rows, M = res.metrics, mfmt = (v) => F.m(v) + 'm';
      el.appendChild(Scope.app.pageHead({ title: `ESG · ${res.platform.label}`, sub: 'from the ESG Hardcoded sheet · scores exposure-weighted · emissions summed per asset' }));
      el.appendChild(h('div', { class: 'notice info' }, 'Partial page: it shows what the ESG Hardcoded sheet holds. The scoring methodology, coverage rules and reporting templates still need to be agreed before figures are treated as authoritative.'));
      const covered = U.sum(rows.filter((r) => U.isNum(r.asset.esg.esg_score)), (r) => r.exposure_m);
      const s3 = U.sum(rows, (r) => (U.isNum(r.asset.esg.ghg_scope3_t) ? r.asset.esg.ghg_scope3_t : 0));
      el.appendChild(h('div', { class: 'kpis' },
        UI.kpi({ icon: 'globe', label: 'Weighted ESG score', value: U.isNum(M.w_esg_score) ? F.n1(M.w_esg_score) : '–', sub: `coverage ${F.pct(M.total_exposure_m ? covered / M.total_exposure_m : NaN, 0)} of exposure` }),
        UI.kpi({ icon: 'sun', label: 'E score', value: F.n1(wavg(rows, 'e_score')), sub: 'exposure-weighted' }),
        UI.kpi({ icon: 'users', label: 'S score', value: F.n1(wavg(rows, 's_score')), sub: 'exposure-weighted' }),
        UI.kpi({ icon: 'shield', label: 'G score', value: F.n1(wavg(rows, 'g_score')), sub: 'exposure-weighted' }),
        UI.kpi({ icon: 'zap', label: 'GHG scope 1+2', value: F.int(M.ghg_scope12_t) + ' t', sub: 'sum of asset values' }),
        UI.kpi({ icon: 'activity', label: 'GHG scope 3', value: F.int(s3) + ' t', sub: 'sum of asset values' }),
      ));
      // exposure by CHI sector, ESG score bands, emissions by sector, largest emitters
      const bySector = (() => { const m = new Map(); for (const r of rows) { const k = r.asset.esg.chi_sector || '(no ESG row)'; m.set(k, (m.get(k) || 0) + r.exposure_m); } return Array.from(m, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); })();
      const ORDER = ['80–100', '70–79', '60–69', '50–59', 'Below 50', 'No score'];
      const bands = (() => { const m = new Map(ORDER.map((k) => [k, 0])); for (const r of rows) { const k = band(r.asset.esg.esg_score); m.set(k, m.get(k) + r.exposure_m); } return ORDER.map((label) => ({ label, value: m.get(label) })).filter((x) => x.value > 0); })();
      const ghgBySector = (() => { const m = new Map(); for (const r of rows) { const k = r.asset.esg.chi_sector || r.sector || '(blank)'; m.set(k, (m.get(k) || 0) + r.ghg_scope12_t); } return Array.from(m, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); })();
      const emitters = rows.slice().sort((a, b) => b.ghg_scope12_t - a.ghg_scope12_t).slice(0, 10).map((r) => ({ label: r.name, value: r.ghg_scope12_t, sub: r.sector, code: r.code }));
      const c1 = h('div'), c2 = h('div'), c3 = h('div'), c4 = h('div');
      el.appendChild(h('div', { class: 'charts' },
        UI.section({ title: 'Exposure by CHI sector', subtitle: `${ccy}m`, body: c1 }), UI.section({ title: 'Exposure by ESG score band', subtitle: `${ccy}m`, body: c2 }),
        UI.section({ title: 'GHG scope 1+2 by sector', subtitle: 'tonnes', body: c3 }), UI.section({ title: 'Largest emitters', subtitle: 'scope 1+2 tonnes · click for the asset', body: c4 })));
      requestAnimationFrame(() => {
        C.hbar(c1, { items: bySector, format: mfmt }); C.bar(c2, { items: bands, format: (v, tick) => (tick ? F.int(v) : F.m(v)) });
        C.hbar(c3, { items: ghgBySector, format: (v) => F.int(v) + ' t' }); C.hbar(c4, { items: emitters, format: (v) => F.int(v) + ' t', onClick: (it) => Scope.navigate('asset', it.code) });
      });
      const esgVal = (f) => (v, r) => { const x = r.asset.esg[f]; return U.isNum(x) ? (f.startsWith('ghg') ? F.int(x) : F.n1(x)) : '–'; };
      const esgSort = (f) => (r) => r.asset.esg[f];
      el.appendChild(UI.section({ title: 'Assets', body: UI.table({ rows, exportName: 'scope_esg.csv', sortKey: 'exposure_m', onRow: (r) => Scope.navigate('asset', r.code), columns: [
        { key: 'name', label: 'Asset', class: 'strong' }, { key: 'code_name', label: 'Code name', class: 'dim' }, { key: 'chi', label: 'CHI sector', format: (v, r) => r.asset.esg.chi_sector || '' },
        { key: 'exposure_m', label: `Exposure ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
        { key: 'e', label: 'E', align: 'right', format: esgVal('e_score'), sortValue: esgSort('e_score') }, { key: 's', label: 'S', align: 'right', format: esgVal('s_score'), sortValue: esgSort('s_score') },
        { key: 'g', label: 'G', align: 'right', format: esgVal('g_score'), sortValue: esgSort('g_score') }, { key: 'esg', label: 'ESG', align: 'right', format: esgVal('esg_score'), sortValue: esgSort('esg_score') },
        { key: 'ghg_scope12_t', label: 'GHG 1+2 (t)', align: 'right', format: F.int, total: 'sum' }, { key: 'ghg3', label: 'GHG 3 (t)', align: 'right', format: esgVal('ghg_scope3_t'), sortValue: esgSort('ghg_scope3_t') },
        { key: 'intensity', label: 'Intensity t/m', align: 'right', format: esgVal('ghg_intensity_t_per_eurm'), sortValue: esgSort('ghg_intensity_t_per_eurm'), title: 'GHG scope 1+2 ÷ total debt offering (m)' }] }) }));
    },
  });
})(window);
