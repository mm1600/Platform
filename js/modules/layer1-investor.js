/* Module: Layer 1 · Investor page (#/investor/<label>) — one investor's direct, look-through and total exposure.
 * Figures come from Scope.engine.lookthrough (the fund unit register: js/calc/aum.js §1 fundHolders, overridable on Data › Views & investors) and AUM.summarise;
 * the page only formats them. Global filters are already applied to ctx.result. */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts;
  const state = { mode: 'total', lastLabel: null }; // Direct / Look-through / Total, kept while moving between investors

  /** "EUR 12.3m" from a millions figure. */
  const ccyM = (ccy, v) => `${ccy} ${F.m(v)}m`;
  /** Chart value formatter (millions). */
  const mfmt = (v) => F.m(v) + 'm';

  /** Human-readable descriptions of the active global filters. */
  function describeFilters(list) {
    return list.map((f) => {
      try { if (Scope.filters && Scope.filters.describe) return Scope.filters.describe(f); } catch (e) { /* fall back below */ }
      return `${f.field} ${f.op} ${Array.isArray(f.value) ? f.value.join(', ') : f.value}`;
    });
  }

  /** Link to another investor page (plain text when the label is the external residual). */
  function investorLink(label) {
    const ext = Scope.engine.lookthrough && label === Scope.engine.lookthrough.EXTERNAL_LABEL;
    return ext ? h('span', { class: 'muted' }, label) : h('a', { href: Scope.href('investor', label), onClick: (e) => e.stopPropagation() }, label);
  }

  /** Notice listing look-through warnings and errors (info items are left to the Data page). */
  function issuesNotice(lt) {
    const list = lt.issues.filter((i) => i.severity !== 'info');
    if (!list.length) return null;
    const hasError = list.some((i) => i.severity === 'error');
    return h('div', { class: 'notice iv-issues' + (hasError ? ' error' : '') },
      h('b', {}, `Fund look-through: ${list.length} ${hasError ? 'issue' : 'warning'}${list.length === 1 ? '' : 's'}`),
      h('ul', {}, list.slice(0, 5).map((i) => h('li', {}, UI.badge(i.severity, i.severity === 'error' ? 'error' : 'warn'), ' ', i.message))),
      list.length > 5 ? h('div', { class: 'small muted' }, `${list.length - 5} more`) : null);
  }

  /** Holdings table: Scope.ui.grid when loaded, else the simple sortable table. */
  function holdingsTable(rows, ctxInfo) {
    const { ccy, modeDef, label } = ctxInfo;
    const toAsset = (r) => Scope.navigate('asset', r.code);
    if (UI.grid) {
      return UI.grid({
        // short books get a short grid; long ones scroll inside a fixed-height viewport
        rows, rowKey: 'code', height: Math.max(220, Math.min(560, rows.length * 28 + 150)) + 'px', ariaLabel: `Holdings of ${label}`, onRow: toAsset,
        exportName: `scope_investor_${U.slug(label)}_${modeDef.id}.csv`,
        columns: [
          { key: 'name', label: 'Asset', type: 'text', width: 220, frozen: true, href: (r) => Scope.href('asset', r.code) },
          { key: 'code', label: 'Code', type: 'text', width: 90 },
          { key: 'sector', label: 'Sector', type: 'text', width: 150 }, { key: 'subsector', label: 'Subsector', type: 'text', hidden: true },
          { key: 'country', label: 'Country', type: 'text', width: 120 },
          { key: 'rating', label: 'Rating', type: 'text', width: 80 },
          { key: 'ig', label: 'IG / Sub-IG', type: 'text', width: 90, hidden: true, get: (r) => (r.rating_status === 'rated' ? r.ig_label : 'NR') },
          { key: 'maturity_date', label: 'Maturity', type: 'date', width: 110 },
          { key: 'remaining_years', label: 'Years left', type: 'number', decimals: 1, width: 90, hidden: true },
          { key: 'direct_m', label: `Direct ${ccy}m`, type: 'number', format: F.m, total: 'sum' },
          { key: 'indirect_m', label: `Look-through ${ccy}m`, type: 'number', format: F.m, total: 'sum' },
          { key: 'total_m', label: `Total ${ccy}m`, type: 'number', format: F.m, total: 'sum' },
          { key: 'via_text', label: 'Via (fund, share)', type: 'text', width: 210 },
          { key: 'drawn_m', label: `Drawn ${ccy}m (${modeDef.label.toLowerCase()})`, type: 'number', format: F.m, total: 'sum', width: 150 },
          { key: 'margin_bps', label: 'Spread bps', type: 'number', format: F.int, hidden: true },
          { key: 'wal_years', label: 'WAL (y)', type: 'number', decimals: 1, hidden: true },
        ],
      });
    }
    return UI.table({
      rows, compact: true, sortKey: 'exposure_m', exportName: `scope_investor_${U.slug(label)}_${modeDef.id}.csv`, onRow: toAsset, columns: [
        { key: 'name', label: 'Asset', class: 'strong' }, { key: 'sector', label: 'Sector' }, { key: 'country', label: 'Country' }, { key: 'rating', label: 'Rating' },
        { key: 'maturity_date', label: 'Maturity', format: (v) => F.date(v), sortValue: (r) => (r.maturity_date ? r.maturity_date.getTime() : NaN) },
        { key: 'direct_m', label: `Direct ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'indirect_m', label: `Look-through ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
        { key: 'total_m', label: `Total ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'via_text', label: 'Via (fund, share)', class: 'dim' },
        { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
      ],
    });
  }

  Scope.registerModule({
    id: 'investor', layer: 1, order: 98, hidden: true, title: 'Investor', icon: 'users', status: 'built',
    render(el, ctx) {
      const res = ctx.result, label = ctx.params[0] || '', ccy = res.displayCurrency, unit = res.config.unit, L = res.config.attribution_label || 'Group';
      if (!label) { Scope.navigate('investors'); return; } // bare #/investor: no investor chosen, go to the investor book
      const LT = Scope.engine.lookthrough;
      const back = h('a', { href: Scope.href('investors') }, Scope.icon('arrow-left', { size: 13 }), ' Investor book');
      if (!LT) { el.appendChild(h('div', { class: 'notice error' }, 'The look-through engine (js/engine/lookthrough.js) is not loaded.')); return; }
      const lt = LT.compute(res, res.fundRegister || []); // register: js/calc/aum.js §1 fundHolders (+ Data page overrides)
      const inv = lt.byInvestor.get(label);
      // the shell keeps the scroll position within one module; moving to another investor starts at the top
      if (state.lastLabel !== null && state.lastLabel !== label) { const main = document.querySelector('.main'); if (main) main.scrollTop = 0; }
      state.lastLabel = label;

      // ---------- unknown investor ----------
      if (!inv) {
        el.appendChild(Scope.app.pageHead({ title: 'Investor not found', crumbs: back }));
        el.appendChild(h('div', { class: 'notice error' }, `No investor "${label}" in Mapping › Funding Name.`));
        el.appendChild(UI.section({ title: 'Investors', body: h('div', { class: 'iv-links' }, Array.from(lt.byInvestor.keys()).map((l) => investorLink(l))) }));
        return;
      }

      const mode = lt.available ? state.mode : 'direct';
      const modeDef = LT.MODES.find((m) => m.id === mode) || LT.MODES[0];
      const S = LT.summariseInvestor(res, lt, label, mode), M = S.metrics, D = S.distributions;
      const meta = res.investors.find((i) => i.label === label) || {};
      const fund = lt.fundByLabel.get(label) || null;
      const synthetic = /synthetic/i.test(res.config.dataset_label || '');
      const share = LT.platformShare(res, label, 'nominal');
      const platformsIn = LT.platformsOf(res, label);
      const basis = modeDef.label.toLowerCase();

      // ---------- header: identity, mode toggle, filter action ----------
      const toggle = h('div', { class: 'chips iv-toggle', role: 'group', 'aria-label': 'Exposure basis' },
        h('span', { class: 'iv-toggle-label' }, 'Basis'),
        LT.MODES.map((md) => {
          const b = UI.chip(md.label, md.id === mode, () => { state.mode = md.id; Scope.app.render(true); });
          if (!lt.available && md.id !== 'direct') { b.disabled = true; b.title = `Needs ${LT.TABLE}`; }
          return b;
        }));
      const filterBtn = Scope.filters && inv.isInvestorColumn ? h('button', {
        class: 'btn btn-sm', type: 'button', title: 'Add a global filter keeping only this investor\'s own positions on every page (direct exposure only: fund look-through drops out)',
        onClick: () => { Scope.filters.add({ field: 'investor_label', op: 'in', value: [label] }); UI.toast(`Global filter added: investor = ${label}`); },
      }, Scope.icon('filter', { size: 14 }), 'Filter platform to this investor') : null;
      el.appendChild(Scope.app.pageHead({
        crumbs: h('span', {}, back, ' / ', label),
        title: label,
        sub: [meta.key || inv.key, inv.group, `${L} weight ${U.isNum(inv.group_weight) ? inv.group_weight : 0}`,
          fund ? 'fund with a unit register' : null, !inv.isInvestorColumn ? 'not an investor column: look-through exposure only' : null].filter(Boolean).join(' · '),
        actions: [toggle, filterBtn],
      }));

      // ---------- notices ----------
      const gf = res.globalFilters || [];
      if (gf.length) el.appendChild(h('div', { class: 'notice info iv-notice' }, h('b', {}, 'Global filters apply: '), describeFilters(gf).join(' · '), '. Every figure covers the filtered positions only, including the funds behind look-through exposure.'));
      if (!lt.available) el.appendChild(h('div', { class: 'notice info iv-notice' }, 'No fund unit holders are listed, so figures are direct only. ', h('a', { href: Scope.href('data', 'views') }, 'List them on Data › Views & investors'), '.'));
      const issues = issuesNotice(lt); if (issues) el.appendChild(issues);

      // ---------- KPIs ----------
      const heldNames = inv.viaFunds.map((v) => `${v.fund} (${F.pct(v.share)})`).join(', ');
      const ratingWarn = U.isNum(M.w_rating_numeric) && M.w_rating_numeric > res.config.ig_threshold;
      el.appendChild(h('div', { class: 'kpis iv-kpis' },
        UI.kpi({ icon: 'briefcase', label: 'Direct nominal', value: ccyM(ccy, inv.direct.nominal / unit), sub: `${inv.assetCount.direct} assets · ${F.int(inv.positions)} positions` }),
        UI.kpi({ icon: 'git-merge', label: 'Look-through nominal', value: ccyM(ccy, inv.indirect.nominal / unit), sub: !lt.available ? `no ${LT.TABLE}` : heldNames ? `via ${heldNames}` : 'holds no fund units' }),
        UI.kpi({ icon: 'layers', label: 'Total economic exposure', value: ccyM(ccy, inv.total.nominal / unit), sub: `${F.pct(inv.shareOfBook)} of the book (all investors, before look-through)` }),
        UI.kpi({ icon: 'trending-up', label: `Drawn (${basis})`, value: ccyM(ccy, M.total_drawn_m), sub: `${F.pct(M.drawn_pct, 0)} of ${basis} nominal` }),
        UI.kpi({ icon: 'clock', label: `Undrawn (${basis})`, value: ccyM(ccy, M.total_undrawn_m), sub: 'nominal less drawn' }),
        UI.kpi({ icon: 'grid', label: `Assets (${basis})`, value: F.int(M.n_assets), sub: `direct ${inv.assetCount.direct} · look-through ${inv.assetCount.indirect}` }),
        UI.kpi({ icon: 'award', label: 'Weighted rating', value: M.w_rating_label || 'NR', tone: ratingWarn ? 'warn' : null, sub: `numeric ${F.int(M.w_rating_numeric)} · ${F.pct(M.rated_share, 0)} rated · ${basis}-weighted` }),
        UI.kpi({ icon: 'percent', label: 'Weighted spread', value: F.bps(M.w_margin_bps), sub: `coverage ${F.pct(M.margin_coverage, 0)} of exposure` }),
        UI.kpi({ icon: 'calendar', label: 'Weighted WAL', value: F.yrs(M.w_wal_years), sub: `coverage ${F.pct(M.wal_coverage, 0)} · remaining ${F.yrs(M.w_remaining_years)}` }),
        UI.kpi({ icon: 'pie-chart', label: `Share of ${res.platform.label}`, value: F.pct(share.share), sub: share.weight ? `weight ${share.weight} × direct column` : 'not in this platform\'s composition' }),
      ));

      // ---------- profile and exposure source ----------
      const sourceItems = [];
      if (mode !== 'lookthrough') sourceItems.push({ label: 'Direct', value: inv.direct.nominal / unit });
      if (mode !== 'direct') inv.viaFunds.forEach((v) => sourceItems.push({ label: `Via ${v.fund}`, value: v.amount.nominal / unit }));
      const sourceChart = h('div');
      el.appendChild(h('div', { class: 'grid-2 iv-row' },
        UI.section({ title: 'Profile', subtitle: `Mapping › Funding Name · views (Mapping column H)${lt.available ? ' · fund unit register' : ''}`, body: UI.dl([
          ['Investor ID', meta.id || inv.id || '–'], ['Key', meta.key || inv.key || '–'], ['Group', inv.group || '–'],
          [`${L} weight`, String(U.isNum(inv.group_weight) ? inv.group_weight : 0)],
          ['Platforms', platformsIn.length ? h('span', { class: 'iv-platforms' }, platformsIn.map((p) => h('span', {}, p.label, h('span', { class: 'muted' }, p.all ? ' (all investors)' : ` × ${p.weight}`)))) : h('span', { class: 'muted' }, 'none')],
          ['Positions', F.int(inv.positions)],
          ['Role', fund ? `Fund with a unit register: in ultimate-holder views it is replaced by its unit holders and the external residual` : 'Ultimate holder'],
          ['Fund units held', inv.viaFunds.length ? h('span', { class: 'iv-platforms' }, inv.viaFunds.map((v) => h('span', {}, investorLink(v.fund), h('span', { class: 'muted' }, ` ${F.pct(v.share)}`)))) : h('span', { class: 'muted' }, 'none')],
        ]) }),
        UI.section({ title: 'Exposure source', subtitle: `${ccy}m nominal · ${basis} basis`, body: sourceChart }),
      ));

      // ---------- breakdowns ----------
      const c1 = h('div'), c2 = h('div'), c3 = h('div'), c4 = h('div');
      const sub = `${ccy}m · ${basis} basis`;
      el.appendChild(h('div', { class: 'charts iv-charts' },
        UI.section({ title: 'Sector', subtitle: sub, body: c1 }), UI.section({ title: 'Country', subtitle: sub + ' · top 10', body: c2 }),
        UI.section({ title: 'Rating', subtitle: sub + ' · best to worst', body: c3 }), UI.section({ title: 'Maturity bucket', subtitle: sub + ' · years from reporting date', body: c4 })));

      // ---------- unit holders (funds with a register) ----------
      let splitChart = null;
      if (fund) {
        const holderRows = LT.unitHolderRows(lt, label, mode).map((r) => Object.assign({}, r, { nominal_m: r.nominal / unit, drawn_m: r.drawn / unit }));
        splitChart = h('div');
        const check = h('div', { class: 'iv-check' }, `${L} share from holders (Σ share × holder ${L} weight) `, h('b', {}, F.pct(fund.groupShareFromHolders)),
          ' vs group_weight ', h('b', {}, F.pct(fund.groupWeight)), ' ', fund.consistent ? UI.badge('Consistent', 'ok') : UI.badge('Mismatch', 'warn', `${L} attribution keeps using group_weight`));
        el.appendChild(UI.section({
          title: 'Unit holders', subtitle: `${synthetic ? 'synthetic demo register · ' : ''}fund unit register · amounts = share × this fund's ${basis} exposure`,
          body: h('div', { class: 'iv-holders' },
            h('div', {}, UI.table({ rows: holderRows, filter: false, compact: true, onRow: (r) => { if (r.kind !== 'external') Scope.navigate('investor', r.holder_label); }, columns: [
              { key: 'holder_label', label: 'Holder', render: (r) => investorLink(r.holder_label) }, { key: 'holder_group', label: 'Group' },
              { key: 'share', label: 'Share', align: 'right', format: (v) => F.pct(v), total: (rows) => F.pct(U.sum(rows, (r) => r.share)) },
              { key: 'nominal_m', label: `Nominal ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
              { key: 'note', label: 'Note', class: 'dim' },
            ] }), check),
            h('div', {}, h('div', { class: 'iv-sublabel' }, 'Ownership split'), splitChart)),
        }));
      } else if (lt.available && inv.group === 'Fund') {
        el.appendChild(h('div', { class: 'notice info iv-notice' }, `${label} is a fund with no rows in ${LT.TABLE}: it is treated as a holder in its own right (direct only).`));
      }

      // ---------- fund units held (look-through detail) ----------
      if (inv.viaFunds.length && mode !== 'direct') {
        const heldRows = inv.viaFunds.map((v) => { const f = lt.fundByLabel.get(v.fund) || {}; return { fund: v.fund, share: v.share, group: f.group || '', group_weight: f.groupWeight, nominal_m: v.amount.nominal / unit, drawn_m: v.amount.drawn / unit }; });
        el.appendChild(UI.section({ title: 'Fund units held', subtitle: `look-through exposure = share × each fund's total exposure · ${ccy}m`, body: UI.table({ rows: heldRows, filter: false, compact: true, sortKey: 'nominal_m', onRow: (r) => Scope.navigate('investor', r.fund), columns: [
          { key: 'fund', label: 'Fund', render: (r) => investorLink(r.fund) }, { key: 'group', label: 'Group' }, { key: 'group_weight', label: `${L} weight`, align: 'right', format: (v) => (U.isNum(v) ? String(v) : '–') },
          { key: 'share', label: 'Units held', align: 'right', format: (v) => F.pct(v) },
          { key: 'nominal_m', label: `Nominal ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
        ] }) }));
      }

      // ---------- holdings ----------
      const grid = S.rows.length ? holdingsTable(S.rows, { ccy, modeDef, label }) : UI.empty(`No ${basis} exposure${gf.length ? ' within the global filters' : ''}.`);
      el.appendChild(UI.section({
        title: `Holdings · ${modeDef.label}`, class: 'iv-holdings',
        subtitle: `${F.int(S.rows.length)} assets · direct = own positions, look-through = share × fund exposure, total = both · all assets, independent of the selected platform · click a name or double-click a row for the asset page`,
        body: grid,
      }));

      // charts need the laid-out width, so draw on the next frame
      requestAnimationFrame(() => {
        // a single source reads better as a bar than as a full ring
        if (sourceItems.length > 1) C.donut(sourceChart, { items: sourceItems, format: mfmt, centre: { value: F.m(U.sum(sourceItems, (x) => x.value)), label: `${ccy}m` } });
        else C.hbar(sourceChart, { items: sourceItems, format: mfmt });
        C.hbar(c1, { items: D.sector || [], format: mfmt });
        C.hbar(c2, { items: D.country || [], format: mfmt, max: 10 });
        C.bar(c3, { items: D.rating || [], format: mfmt });
        C.bar(c4, { items: D.maturity_bucket || [], format: mfmt });
        if (splitChart && fund) C.donut(splitChart, { format: (v) => F.pct(v), items: [
          { label: `${L} (listed)`, value: fund.groupShareFromHolders }, { label: 'Third party (listed)', value: fund.thirdPartyShare }, { label: LT.EXTERNAL_LABEL, value: fund.externalShare }] });
      });
      return () => { if (grid && typeof grid.destroy === 'function') grid.destroy(); };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
