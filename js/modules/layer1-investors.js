/* Module: Layer 1 · Investor book — asset × investor matrix, investor summary, group split, fund look-through.
 * Investor rows open the per-investor page (#/investor/<label>, js/modules/layer1-investor.js). */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts;
  const state = { measure: 'nominal', scope: 'platform' };

  /** Link to the per-investor page; stops the row click so the link wins. */
  const investorLink = (label) => h('a', { href: Scope.href('investor', label), onClick: (e) => e.stopPropagation() }, label);

  /** Holders × funds share matrix with listed / external / consistency rows (fund_lookthrough.csv). */
  function shareMatrix(lt, L) {
    const funds = lt.funds;
    const holders = [];
    const seen = new Set();
    for (const f of funds) for (const x of f.holders) if (!seen.has(x.holder_label)) { seen.add(x.holder_label); holders.push({ label: x.holder_label, group: x.holder_group, group_weight: x.group_weight }); }
    // Group entities first, then funds, third parties and anything else; alphabetical (numeric-aware) inside a group
    const rank = { 'Group entity': 0, Fund: 1, 'Third party': 2 };
    const rankOf = (g) => (g in rank ? rank[g] : 3);
    holders.sort((a, b) => rankOf(a.group) - rankOf(b.group) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    const shareOf = (f, holder) => { const x = f.holders.find((y) => y.holder_label === holder); return x ? x.share : null; };
    const pctCell = (v, cls) => h('td', { class: 'num' + (cls ? ' ' + cls : '') }, v === null || v === undefined ? '' : F.pct(v));
    const head = h('thead', {}, h('tr', {}, h('th', {}, 'Holder'), h('th', {}, 'Group'), h('th', { class: 'num' }, `${L} weight`),
      funds.map((f) => h('th', { class: 'num', title: `${f.fund_label} · ${f.group}` }, h('a', { href: Scope.href('investor', f.fund_label) }, f.fund_label)))));
    const body = h('tbody', {},
      holders.map((x) => h('tr', {}, h('td', { class: 'strong' }, investorLink(x.label)), h('td', {}, x.group), h('td', { class: 'num dim' }, String(x.group_weight)), funds.map((f) => pctCell(shareOf(f, x.label))))),
      h('tr', { class: 'iv-ext' }, h('td', {}, 'External fund holders'), h('td', {}, 'Not on the platform'), h('td', { class: 'num dim' }, '0'), funds.map((f) => pctCell(f.externalShare, f.externalShare < 0 ? 'iv-bad' : ''))));
    const foot = h('tfoot', {},
      h('tr', {}, h('td', {}, 'Listed holders'), h('td'), h('td'), funds.map((f) => pctCell(f.listedShare, f.listedShare > 1 + 1e-9 ? 'iv-bad' : ''))),
      h('tr', {}, h('td', {}, `${L} share from holders`), h('td', { class: 'dim' }, 'Σ share × weight'), h('td'), funds.map((f) => pctCell(f.groupShareFromHolders))),
      h('tr', {}, h('td', {}, 'group_weight'), h('td', { class: 'dim' }, 'js/calc/aum.js CONFIG.investors'), h('td'), funds.map((f) => pctCell(f.groupWeight))),
      h('tr', {}, h('td', {}, 'Check'), h('td'), h('td'), funds.map((f) => h('td', { class: 'num' }, f.consistent ? UI.badge('Consistent', 'ok') : UI.badge('Mismatch', 'warn', `${L} attribution keeps using group_weight`)))));
    return h('div', { class: 'compact' }, h('div', { class: 'tbl-scroll iv-matrix-wrap' }, h('table', { class: 'tbl iv-matrix' }, head, body, foot)));
  }

  Scope.registerModule({
    id: 'investors', layer: 1, order: 2, title: 'Investor book', status: 'built', icon: 'users', activeFor: ['investor'],
    render(el, ctx) {
      const res = ctx.result, ccy = res.displayCurrency, unit = res.config.unit, L = res.config.attribution_label, mfmt = (v) => F.m(v) + 'm';
      const assets = (state.scope === 'platform' ? res.rows.map((r) => r.asset) : res.assets.filter((a) => a.active));
      const measure = state.measure;
      const cell = (a, label) => ((a.byInvestor.get(label) || {})[measure] || 0) / unit;
      const totalOf = (a) => ({ nominal: a.nominal, drawn: a.drawn, commitment: a.commitment })[measure] / unit;

      el.appendChild(Scope.app.pageHead({
        title: 'Investor book', sub: `asset × investor matrix · ${ccy} millions · investor columns from Mapping › Funding Name, views from Mapping › Active Assets (column H) · click an investor for its page`,
        actions: [
          h('div', { class: 'chips' }, ['nominal', 'drawn', 'commitment'].map((mname) => UI.chip(mname, measure === mname, () => { state.measure = mname; Scope.app.render(true); }))),
          h('div', { class: 'chips' }, UI.chip(`Assets on ${res.platform.label}`, state.scope === 'platform', () => { state.scope = 'platform'; Scope.app.render(true); }), UI.chip('All active assets', state.scope === 'all', () => { state.scope = 'all'; Scope.app.render(true); })),
        ],
      }));

      // ---------- investor summary ----------
      const invRows = res.investors.map((i) => Object.assign({}, i, { matrix_m: assets.reduce((s, a) => s + cell(a, i.label), 0), assets_n: assets.filter((a) => a.byInvestor.has(i.label)).length }));
      const groupItems = (() => { const g = new Map(); for (const i of invRows) g.set(i.group, (g.get(i.group) || 0) + i.matrix_m); return Array.from(g, ([label, value]) => ({ label, value })); })();
      el.appendChild(h('div', { class: 'kpis' },
        UI.kpi({ icon: 'users', label: 'Investor columns', value: String(res.investorColumns.length), sub: `${invRows.filter((i) => i.group === 'Group entity').length} ${L} entities · ${invRows.filter((i) => i.group === 'Fund').length} funds · ${invRows.filter((i) => i.group === 'Third party').length} third party` }),
        UI.kpi({ icon: 'grid', label: `Matrix total (${measure})`, value: `${ccy} ${F.m(assets.reduce((s, a) => s + totalOf(a), 0))}m`, sub: `${assets.length} assets` }),
        UI.kpi({ icon: 'share-2', label: `${L} attributed`, value: `${ccy} ${F.m(assets.reduce((s, a) => s + ({ nominal: a.group_nominal, drawn: a.group_drawn, commitment: a.group_nominal })[measure], 0) / unit)}m`, sub: 'Σ group_weight × column (funds at look-through weight)' }),
        groupItems.map((g) => UI.kpi({ icon: 'users', label: g.label + ' (100%)', value: `${ccy} ${F.m(g.value)}m`, sub: 'columns summed, no look-through' })),
      ));
      const invChart = h('div'), grpChart = h('div');
      el.appendChild(h('div', { class: 'grid-2' },
        UI.section({ title: `${measure[0].toUpperCase() + measure.slice(1)} by investor`, subtitle: `${ccy}m · all columns at 100% · click a bar for the investor page`, body: invChart }),
        UI.section({ title: 'Top assets by investor group', subtitle: `funds shown at 100% here; ${L} attribution applies the look-through weight`, body: grpChart }),
      ));
      const groups = U.uniq(res.investors.map((i) => i.group));
      const stackRows = assets.slice().sort((x, y) => totalOf(y) - totalOf(x)).slice(0, 12).map((a) => { const parts = {}; for (const i of res.investors) parts[i.group] = (parts[i.group] || 0) + cell(a, i.label); return { label: a.name, parts }; });
      requestAnimationFrame(() => {
        C.hbar(invChart, { items: invRows.map((i) => ({ label: i.label, value: i.matrix_m, sub: `${i.group} · ${L} weight ${i.group_weight} · ${i.assets_n} assets` })).sort((x, y) => y.value - x.value), format: mfmt, onClick: (it) => { if (!/^Other \(/.test(it.label)) Scope.navigate('investor', it.label); } });
        C.stacked(grpChart, { rows: stackRows, series: groups, format: mfmt });
      });

      el.appendChild(UI.section({ title: 'Investors', subtitle: 'summary per investor column · click a row for the investor page', body: UI.table({ rows: invRows, filter: false, compact: true, sortKey: 'matrix_m', exportName: 'scope_investors.csv', onRow: (r) => Scope.navigate('investor', r.label), columns: [
        { key: 'label', label: 'Investor', class: 'strong', render: (r) => investorLink(r.label) }, { key: 'key', label: 'Key', class: 'dim' }, { key: 'group', label: 'Group' }, { key: 'group_weight', label: `${L} weight`, align: 'right' },
        { key: 'assets_n', label: 'Assets', align: 'right' }, { key: 'positions', label: 'Positions', align: 'right', total: 'sum' },
        { key: 'matrix_m', label: `${measure} ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
        { key: 'nominal_m', label: `Nominal (all assets) ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'drawn_m', label: `Drawn (all) ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
      ] }) }));

      // ---------- fund look-through ----------
      const LTE = Scope.engine.lookthrough;
      if (LTE) {
        const lt = LTE.compute(res, Scope.store ? Scope.store.table(LTE.TABLE) : []);
        const synthetic = /synthetic/i.test(res.config.dataset_label || '');
        if (!lt.available) {
          el.appendChild(UI.section({ title: 'Look-through', subtitle: 'who owns the units of each fund column', body: h('div', { class: 'notice info iv-notice' }, `No fund look-through table loaded (${LTE.TABLE}): exposures are direct only and funds count as holders in their own right. `, h('a', { href: Scope.href('data') }, 'Load it on the Data page'), '.') }));
        } else {
          const problems = lt.issues.filter((i) => i.severity !== 'info');
          const rec = LTE.reconcile(lt, assets.map((a) => a.code), measure);
          const recRows = rec.rows.map((r) => Object.assign({}, r, { direct_m: r.direct / unit, indirect_m: r.indirect / unit, total_m: r.total / unit }));
          recRows.push({ label: LTE.EXTERNAL_LABEL, key: '', group: 'External', role: 'Outside the platform', isFund: false, external: true, direct_m: 0, indirect_m: rec.external / unit, total_m: rec.external / unit });
          // two full-width cards: the share matrix, then exposure by investor with the reconciliation line
          el.append(
            UI.section({ title: 'Look-through · fund unit holders', subtitle: `${synthetic ? 'synthetic demo register · ' : ''}${LTE.TABLE} · share of each fund's units · the external row is held outside the platform`,
              body: h('div', {}, shareMatrix(lt, L), problems.length ? h('div', { class: 'notice iv-notice' + (problems.some((i) => i.severity === 'error') ? ' error' : '') }, h('ul', { class: 'iv-issue-list' }, problems.map((i) => h('li', {}, UI.badge(i.severity, i.severity === 'error' ? 'error' : 'warn'), ' ', i.message)))) : null) }),
            UI.section({ title: `Look-through · ${measure} by investor`, subtitle: `${ccy}m · ${state.scope === 'platform' ? `assets on ${res.platform.label}` : 'all active assets'} · direct column + share × fund exposure`,
              body: h('div', {},
                UI.table({ rows: recRows, filter: false, compact: true, sortKey: 'total_m', exportName: `scope_lookthrough_${measure}.csv`, onRow: (r) => { if (!r.external) Scope.navigate('investor', r.label); }, columns: [
                  { key: 'label', label: 'Investor', class: 'strong', render: (r) => (r.external ? h('span', {}, r.label) : investorLink(r.label)) }, { key: 'group', label: 'Group' },
                  { key: 'role', label: 'Role', class: 'dim' },
                  { key: 'direct_m', label: `Direct ${ccy}m`, align: 'right', format: F.m }, { key: 'indirect_m', label: `Look-through ${ccy}m`, align: 'right', format: F.m },
                  { key: 'total_m', label: `Total ${ccy}m`, align: 'right', format: F.m },
                ] }),
                h('div', { class: 'iv-recon' },
                  h('span', {}, 'Σ ultimate holders ', h('b', {}, F.m(rec.holders / unit)), ' + external fund holders ', h('b', {}, F.m(rec.external / unit)), ' = ', h('b', {}, F.m(rec.ultimate / unit))),
                  h('span', {}, 'matrix total (Σ investor columns) ', h('b', {}, F.m(rec.direct / unit))),
                  h('span', {}, 'difference ', h('b', {}, F.m(rec.difference / unit))),
                  rec.ok ? UI.badge('Reconciles', 'ok') : UI.badge('Does not reconcile', 'error')),
                h('p', { class: 'small muted iv-recon-note' }, 'Pass-through funds are listed for reference; their exposure is counted once, through their unit holders and the external residual.')) }),
          );
        }
      }

      // ---------- matrix ----------
      const mrows = assets.map((a) => { const r = { code: a.code, name: a.name, total_m: totalOf(a), group_m: ({ nominal: a.group_nominal, drawn: a.group_drawn, commitment: a.group_nominal })[measure] / unit }; r.tp_m = r.total_m - r.group_m; for (const label of res.investorColumns) r['inv:' + label] = cell(a, label); return r; });
      const cols = [{ key: 'name', label: 'Asset', class: 'strong' }, { key: 'code', label: 'Code', class: 'dim' }];
      for (const i of res.investors) cols.push({ key: 'inv:' + i.label, label: i.key || i.label, title: `${i.label} · ${i.group}`, align: 'right', format: (v) => (v ? F.m(v) : ''), total: 'sum' });
      cols.push({ key: 'total_m', label: 'Total', align: 'right', format: F.m, total: 'sum', class: 'strong' }, { key: 'group_m', label: `${L} attributed`, align: 'right', format: F.m, total: 'sum' }, { key: 'tp_m', label: 'Third party', align: 'right', format: F.m, total: 'sum' });
      el.appendChild(UI.section({ title: `Matrix · ${measure}`, subtitle: `${ccy}m · hover a column header for the full investor name · click a row for the asset page`, body: UI.table({ rows: mrows, compact: true, sortKey: 'total_m', exportName: `scope_matrix_${measure}.csv`, onRow: (r) => Scope.navigate('asset', r.code), columns: cols }) }));
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
