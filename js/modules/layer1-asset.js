/* Module: Layer 1 · Asset page — positions, investor split, provenance, ratings branch, calculation trace, manual adjustments.
 *
 * Registers the hidden 'asset' page (route #/asset/<asset code>; reached from tables, charts and issue links, not
 * the sidebar) and exports Scope.ui.adjustModal, the manual-adjustment dialog, so other pages can reuse it.
 * Everything shown is read from the AUM engine result (asset record, its positions, platform columns, rating
 * branch); the calculation trace restates the engine's steps with this asset's numbers so any figure can be
 * reproduced by hand from the CSV inputs.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts, AUM = Scope.engine.aum, store = Scope.store;

  // originalOf(field) → the imported value of that field, so the audit record always stores the true original for the field actually chosen
  /**
   * Manual-adjustment dialog (brief §11). table: 'positions' | 'assets'; key: position key or asset code; field: the
   * preselected field from `fields`. A reason is mandatory; the user name is remembered in settings. Saving calls
   * store.addAdjustment, which records the audit entry and triggers a recompute, so the change flows to every total.
   */
  function adjustModal({ table, key, field, fields, originalOf, label }) {
    let original = originalOf(field);
    const show = (v) => (v === undefined || v === null ? '' : String(v)); // value → input text
    const valueIn = h('input', { class: 'input', value: show(original) });
    const fieldSel = h('select', { class: 'input', onChange: (e) => { original = originalOf(e.target.value); valueIn.value = show(original); } }, fields.map((f) => h('option', { value: f, selected: f === field }, f)));
    const reasonIn = h('textarea', { class: 'input', placeholder: 'Why is this correction needed? (required — retained in the audit trail)' });
    const userIn = h('input', { class: 'input', value: store.state.settings.user || 'local user' });
    const m = UI.modal({ title: `Manual adjustment · ${label}`, body: h('div', {},
      h('p', { class: 'small muted' }, 'The imported value is kept. The adjustment, reason, user and timestamp are stored and shown as provenance wherever the value is used (brief §11).'),
      h('div', { class: 'field' }, h('label', {}, 'Field'), fieldSel), h('div', { class: 'field' }, h('label', {}, 'New value'), valueIn),
      h('div', { class: 'field' }, h('label', {}, 'Reason'), reasonIn), h('div', { class: 'field' }, h('label', {}, 'User'), userIn)),
      actions: [h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', onClick: () => {
        if (!reasonIn.value.trim()) { reasonIn.focus(); return; }
        store.state.settings.user = userIn.value.trim() || 'local user'; store.persistSettings();
        store.addAdjustment({ table, key, field: fieldSel.value, original: original, value: valueIn.value.trim(), reason: reasonIn.value.trim() });
        m.close(); UI.toast('Adjustment saved');
      } }, 'Save adjustment')] });
  }
  Scope.ui.adjustModal = adjustModal;

  Scope.registerModule({
    id: 'asset', layer: 1, order: 99, hidden: true, title: 'Asset',
    /** Render the asset identified by the first route parameter, or a not-found notice. */
    render(el, ctx) {
      const res = ctx.result, code = ctx.params[0], ccy = res.displayCurrency, unit = res.config.unit;
      if (!code) { Scope.navigate('aum'); return; } // bare #/asset: no asset chosen, go to the overview
      const a = res.assets.find((x) => x.code === code);
      const row = res.rows.find((x) => x.code === code);
      if (!a) { el.appendChild(Scope.app.pageHead({ title: 'Asset not found', crumbs: h('a', { href: Scope.href('aum') }, Scope.icon('arrow-left', { size: 13 }), ' AUM overview') })); el.appendChild(h('div', { class: 'notice error' }, `No asset with code "${code}" in mapping_assets.csv.`)); return; }
      // pv: this asset's column in the selected platform; m(): full units → "12.3m" in the display unit.
      const pv = a.platform[res.platformId] || { nominal: 0, drawn: 0 };
      const m = (v) => `${F.m(v / unit)}m`;
      // Value followed by its provenance badge (Imported / Calculated / Manual).
      const provDd = (src, value) => h('span', {}, value === '' || value === undefined || value === null ? h('span', { class: 'muted' }, '–') : String(value), ' ', UI.prov(src));
      // Edit button for an asset attribute; the original offered to the dialog is the imported value, not a prior adjustment.
      const adjBtn = (field) => h('button', { class: 'btn btn-ghost btn-sm', title: 'Manual adjustment', onClick: () => adjustModal({ table: 'assets', key: a.code, field, fields: AUM.ASSET_ATTRIBUTE_FIELDS.concat(AUM.ESG_FIELDS), originalOf: (f) => { const holder = f in a.attrs ? a.attrs : a.esg; return a.src[f] && a.src[f].table === 'manual' ? a.src[f].original : holder[f]; }, label: a.name }) }, Scope.icon('edit-2', { size: 13 }));

      el.appendChild(Scope.app.pageHead({
        crumbs: h('span', {}, h('a', { href: Scope.href('aum') }, Scope.icon('arrow-left', { size: 13 }), ' AUM overview'), ' / ', a.code),
        title: a.name, sub: [a.attrs.sector, a.attrs.subsector, a.attrs.country, a.instrument_type, a.attrs.greenfield_brownfield].filter(Boolean).join(' · ') + (a.code_name ? ` · ${a.code_name}` : ''),
        actions: [h('button', { class: 'btn', onClick: () => UI.downloadText(`scope_${a.code}_positions.csv`, Scope.csv.serialize(AUM.positionRecords(res).filter((p) => p.asset_code === a.code))) }, Scope.icon('download', { size: 14 }), 'Positions CSV')],
      }));
      if (a.flags.length) el.appendChild(h('div', { class: 'notice' }, h('b', {}, 'Flags: '), a.flags.join(', '), ' — see ', h('a', { href: Scope.href('data', 'issues') }, 'issues'), '.'));
      if (!row) el.appendChild(h('div', { class: 'notice info' }, `This asset has no exposure on ${res.platform.label}; figures below show all investors.`));

      el.appendChild(h('div', { class: 'kpis' },
        UI.kpi({ icon: 'briefcase', label: `Exposure · ${res.platform.label}`, value: `${ccy} ${m(pv.nominal)}`, sub: `drawn ${m(pv.drawn)} (${F.pct(pv.nominal ? pv.drawn / pv.nominal : NaN, 0)})` }),
        UI.kpi({ icon: 'users', label: 'All investors', value: `${ccy} ${m(a.nominal)}`, sub: `${a.positionCount} position(s)` }),
        UI.kpi({ icon: 'share-2', label: `${res.config.attribution_label} attributed`, value: `${ccy} ${m(a.group_nominal)}`, sub: `third party ${m(a.third_party_nominal)}` }),
        UI.kpi({ icon: 'clipboard', label: 'Commitment', value: `${ccy} ${m(a.commitment)}`, sub: `undrawn ${m(a.nominal - a.drawn)}` }),
        UI.kpi({ icon: 'award', label: 'Rating', value: a.rating ? a.rating.current_grade : '–', sub: a.rating ? (a.rating.status === 'rated' ? a.rating.ig_label : 'not rated') : '', tone: a.rating && a.rating.status === 'rated' && a.rating.ig_label !== 'IG' ? 'warn' : null }),
        UI.kpi({ icon: 'calendar', label: 'Maturity', value: F.date(a.maturity_date), sub: U.isNum(a.remaining_years) ? `${F.n1(a.remaining_years)} years remaining · ${a.maturity_bucket}` : 'unknown' }),
      ));

      // ---------- attributes / terms / ESG ----------
      // [label, value + provenance + edit button] pairs for a definition list.
      const attrPairs = (fields, holder) => fields.map((f) => [f.replace(/_/g, ' '), h('span', {}, provDd(a.src[f], holder[f]), adjBtn(f))]);
      const R = a.rating || {};
      el.appendChild(h('div', { class: 'grid-3' },
        UI.section({ title: 'Deal attributes', subtitle: 'from the Hardcoded, ESG Hardcoded and Holdings sheets (badge shows the cell) · edit icon corrects a value with an audit trail', body: UI.dl(attrPairs(AUM.ASSET_ATTRIBUTE_FIELDS, a.attrs)) }),
        UI.section({ title: 'Credit & terms', subtitle: 'from positions (imported) and derived fields', body: UI.dl([
          ['currency', a.currency], ['rate type', provDd(a.positions[0] ? a.positions[0].src.rate_type : null, a.fixed_floating)],
          ['spread', provDd(a.positions[0] ? a.positions[0].src.spread : null, U.isNum(a.margin_bps) ? F.bps(a.margin_bps) : '–')], ['closing rating', R.closing || '–'],
          ['funding date', F.date(a.funding_date)], ['maturity date', F.date(a.maturity_date)],
          ['initial tenor', provDd({ table: 'calc', note: 'YEARFRAC(funding, maturity), 30/360; 0 if a date is missing (workbook IFERROR)' }, F.yrs(a.initial_tenor))],
          ['WAL', provDd(a.src.wal_years, U.isNum(a.attrs.wal_years) ? F.yrs(a.attrs.wal_years) : '')],
          ['protection end', provDd(a.src.protection_end_date, a.attrs.protection_end_date)], ['protected life', provDd({ table: 'calc', note: '(protection_end − funding) ÷ (maturity − funding)' }, U.isNum(a.protected_life_fraction) ? F.pct(a.protected_life_fraction, 0) : '')],
          ['covenant compliance', provDd(a.src.covenant_compliance, a.attrs.covenant_compliance)],
          ['internal grade', `${R.internal || '–'} (${R.internal_numeric || 0})`], ['Fitch / Moody\'s / S&P', `${R.fitch} / ${R.moodys} / ${R.sp}`],
          ['external (worst)', `${R.external_grade || '–'} (${R.external_numeric || 0})`], ['current grade', provDd(a.src.rating, `${R.current_grade || '–'} → ${R.status === 'rated' ? R.ig_label : 'NR'} (numeric ${R.current_numeric || 0}, threshold ${res.config.ig_threshold})`)],
        ]) }),
        UI.section({ title: 'ESG', subtitle: 'ESG Hardcoded sheet · methodology to be agreed', body: a.esg && Object.keys(a.esg).length ? UI.dl(attrPairs(AUM.ESG_FIELDS, a.esg)) : UI.empty('No ESG record') }),
      ));

      // ---------- positions ----------
      const posRows = a.positions.map((p) => ({ p, investor: p.investor_label, holding: p.holding_id, tranche: p.tranche, ccy: p.currency, nominal: p.nominal, drawn: p.drawn, commitment: p.commitment, fx: p.fx_rate, nominal_m: p.nominal_base / unit, drawn_m: p.drawn_base / unit, grade: p.rating.current_grade, line: p.line, adjusted: p.flags.includes('adjusted') }));
      // only positions mapped to this asset; unmapped holdings have no asset and are listed on the Data page instead
      const excl = res.excludedPositions.filter((p) => p.asset_code === a.code);
      el.appendChild(UI.section({ title: 'Positions', subtitle: 'one row per investor × holding (Holdings sheet) · edit icon adjusts an imported amount with an audit trail', body: [UI.table({
        rows: posRows, filter: false, compact: true, sortKey: 'nominal_m', columns: [
          { key: 'investor', label: 'Investor', class: 'strong' }, { key: 'holding', label: 'Holding ID', class: 'dim' }, { key: 'tranche', label: 'Tranche' }, { key: 'ccy', label: 'Ccy' },
          { key: 'nominal', label: 'Nominal', align: 'right', format: F.amount }, { key: 'drawn', label: 'Drawn', align: 'right', format: F.amount }, { key: 'commitment', label: 'Commitment', align: 'right', format: F.amount },
          { key: 'fx', label: 'FX (per EUR)', align: 'right', format: (v) => F.n4(v) },
          { key: 'nominal_m', label: `Nominal ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
          { key: 'grade', label: 'Grade' },
          { key: 'line', label: 'Source', render: (r) => h('span', {}, UI.prov(r.p.src.nominal), r.adjusted ? UI.badge('adjusted', 'manual') : null, ' ', h('button', { class: 'btn btn-ghost btn-sm', title: 'Manual adjustment', onClick: (e) => { e.stopPropagation(); adjustModal({ table: 'positions', key: r.p.key, field: 'nominal', fields: AUM.ADJUSTABLE_POSITION_FIELDS, originalOf: (f) => (r.p.src[f] && r.p.src[f].table === 'manual' ? r.p.src[f].original : r.p.raw[f]), label: `${a.name} · ${r.investor}` }); } }, Scope.icon('edit-2', { size: 13 }))) },
        ] }), excl.length ? h('div', { class: 'notice', style: { marginTop: '10px' } }, h('b', {}, `${excl.length} excluded position(s): `), excl.map((p) => `line ${p.line} (${p.investor_label}) — ${p.exclusionReason}`).join('; ')) : null] }));

      // ---------- investor split + platforms + trace ----------
      const invItems = Array.from(a.byInvestor.entries()).map(([label, c]) => ({ label, value: c.nominal / unit, sub: `drawn ${F.m(c.drawn / unit)}m` })).sort((x, y) => y.value - x.value);
      const invChart = h('div');
      const platRows = res.platforms.map((p) => ({ label: p.label, id: p.id, nominal_m: a.platform[p.id].nominal / unit, drawn_m: a.platform[p.id].drawn / unit, composition: p.composition.map((c) => `${c.label === '*' ? 'all investors' : c.label} × ${c.weight}`).join(' + ') }));
      // Calculation trace: the engine's pipeline for this asset (mapping → FX → totals → investor columns → platform → attribution → rating).
      const trace = h('ol', { class: 'trace' },
        step(1, `${a.positionCount} position(s) map to identification ID ${a.code} through Mapping › Security Mapping (holding IDs ${a.holdings.join(', ')}).` + (a.excludedCount ? ` ${a.excludedCount} excluded — see above.` : '')),
        step(2, `Each position converted: amount ÷ FX(ccy per EUR) × FX(${ccy} per EUR). ` + a.positions.map((p) => `${p.investor_label}: ${p.currency} ${F.amount(p.nominal)} ÷ ${F.n4(p.fx_rate)} → ${F.m(p.nominal_base / unit)}m`).join('; ')),
        step(3, `Asset totals = Σ positions: nominal ${m(a.nominal)}, drawn ${m(a.drawn)}, commitment ${m(a.commitment)}.`),
        step(4, `Investor columns (SUMIF by investor label × asset): ` + invItems.map((i) => `${i.label} ${F.m(i.value)}m`).join('; ') + '.'),
        step(5, `${res.platform.label} = Σ weight × investor column = ` + res.platform.composition.map((c) => { const v = c.label === '*' ? a.nominal : (a.byInvestor.get(c.label) || { nominal: 0 }).nominal; return `${c.weight} × ${c.label === '*' ? 'all' : c.label} (${F.m(v / unit)}m)`; }).join(' + ') + ` = ${m(pv.nominal)}.`),
        step(6, `${res.config.attribution_label} attributed = Σ group_weight × investor column = ` + Array.from(a.byInvestor.entries()).map(([l, c]) => { const w = (res.investors.find((i) => i.label === l) || { group_weight: 0 }).group_weight; return w ? `${w} × ${l} (${F.m(c.nominal / unit)}m)` : null; }).filter(Boolean).join(' + ') + ` = ${m(a.group_nominal)}; third party = total − ${res.config.attribution_label} attributed = ${m(a.third_party_nominal)}.`),
        step(7, `Rating: internal ${R.internal} (${R.internal_numeric}); external worst of Fitch ${R.fitch}, Moody's ${R.moodys}, S&P ${R.sp} → ${R.external_grade} (${R.external_numeric}); current = ${R.current_grade}; numeric MAX(internal, external) = ${R.current_numeric} ${R.current_numeric > res.config.ig_threshold ? '>' : '≤'} ${res.config.ig_threshold} → ${R.status === 'rated' ? R.ig_label : 'NR'}.`),
      );
      /** One numbered trace step. */
      function step(n, text) { return h('li', {}, h('span', { class: 'step' }, n), h('span', {}, text)); }
      el.appendChild(h('div', { class: 'grid-2' },
        UI.section({ title: 'Investor split', subtitle: `nominal per investor column, ${ccy}m`, body: invChart }),
        UI.section({ title: 'Platform columns', subtitle: 'how this asset rolls into each view (Mapping column H; compositions in js/calc/aum.js §1)', body: UI.table({ rows: platRows, filter: false, compact: true, columns: [
          { key: 'label', label: 'Platform', class: 'strong' }, { key: 'nominal_m', label: `Nominal ${ccy}m`, align: 'right', format: F.m }, { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m }, { key: 'composition', label: 'Composition', class: 'dim wrap' }] }) }),
      ));
      // ---------- source rows: the asset's complete Hardcoded and ESG Hardcoded rows, cell by cell ----------
      const srcRows = [];
      for (const sheet of ['Hardcoded', 'ESG Hardcoded']) for (const [header, c] of Object.entries((a.sheets && a.sheets[sheet]) || {})) srcRows.push({ sheet, header, label: c.label || '', value: c.value === null || c.value === undefined ? '' : String(c.value), cell: c.cell });
      el.appendChild(UI.section({ title: 'Source rows', subtitle: 'every column of this asset in the Hardcoded and ESG Hardcoded sheets, with its cell', body: srcRows.length ? UI.table({ rows: srcRows, compact: true, filterPlaceholder: 'Filter columns…', exportName: `scope_${a.code}_source_rows.csv`, columns: [
        { key: 'sheet', label: 'Sheet' }, { key: 'cell', label: 'Cell', class: 'mono' }, { key: 'header', label: 'Column (row 3)', class: 'strong' }, { key: 'label', label: 'Row 2 label', class: 'dim' }, { key: 'value', label: 'Value', class: 'wrap' }] }) : UI.empty('No Hardcoded or ESG Hardcoded row for this asset') }));
      el.appendChild(UI.section({ title: 'Calculation trace', subtitle: 'every figure is reproducible from the four input sheets (js/calc/aum.js)', body: trace }));
      // Draw the chart once its section is in the DOM and has a width.
      requestAnimationFrame(() => C.hbar(invChart, { items: invItems, format: (v) => F.m(v) + 'm' }));
    },
  });
})(window);
