/* Module: Layer 1 · AUM overview — the workbook's Output sheet as an interactive, filterable view.
 *
 * Filters: any dimension of Scope.engine.aum.DIMENSIONS, multi-select (values with counts and exposure, search),
 * several filters combine (OR within a field, AND across fields). Filter changes re-render KPIs, charts, the
 * breakdown and the asset grid locally (no Scope.app.render). Chart bars and breakdown rows filter on click
 * (plain click replaces, ctrl/cmd-click toggles the value). "Open in Explorer" carries the filters as
 * #/explorer/v/<base64url(JSON)> with { source:'assets', filters:[{ field, op:'in', value:[...] }] } in dataset
 * field ids — Scope.aumView.encode/decode/toDatasetFilters are exported for the explorer and pivot pages.
 *
 * The asset table is Scope.ui.grid (js/core/grid.js) when it is loaded and Scope.ui.table otherwise; the two-level
 * breakdown uses Scope.pivot.run over Scope.engine.dataset asset records when both are loaded and falls back to the
 * engine distributions otherwise. Nothing here is required to be loaded beyond the core + aum engine.
 *
 * Registers the 'aum' page (route #/aum, the default route; sidebar Layer 1) and exports Scope.aumView.
 * Workbook equivalent: Output!G8 (platform) and G6 (currency) are the top-bar selectors handled by the app
 * shell; this page shows Output rows 11..283 for that selection. Unfiltered figures are the engine's own
 * metrics; with filters, the filtered Output rows are re-summarised by AUM.summarise, so the page still never
 * adds numbers itself.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, C = Scope.charts, AUM = Scope.engine.aum;
  const BLANK = '(blank)';
  const ORDERED = ['rating', 'ig', 'maturity_bucket', 'fixed_floating', 'watchlist', 'green_loan', 'deal_year']; // label-sorted dimensions
  const DS_ID = { ig: 'ig_label', greenfield: 'greenfield_brownfield' }; // AUM dimension key → dataset field id

  // session view state (survives re-renders within the session)
  const view = { filters: [], breakdown: 'subsector', thenBy: '', colDim: '', topN: 14, nrInDenominator: false };

  // ---------- link with the global filters ----------
  // AUM dimension key → dataset field id, and value translations where the labels differ.
  const DIM_TO_FIELD = { ig: 'ig_label', greenfield: 'greenfield_brownfield' };
  const FIELD_TO_DIM = { ig_label: 'ig', greenfield_brownfield: 'greenfield' };
  const GREEN_TO_FIELD = { 'Green loan': 'Y', 'Not green': 'N' }, GREEN_TO_DIM = { Y: 'Green loan', N: 'Not green' };
  /** AUM-page filters derived from the global "in" filters on fields the page knows. */
  function globalToView() {
    if (!Scope.filters) return view.filters.filter((f) => AUM.DIMENSIONS[f.field]);
    return Scope.filters.list().filter((f) => f.op === 'in').map((f) => {
      const dim = FIELD_TO_DIM[f.field] || f.field;
      if (!AUM.DIMENSIONS[dim]) return null;
      const vals = [].concat(f.value).map(String).map((v) => (dim === 'green_loan' ? GREEN_TO_DIM[v] || v : v));
      return { field: dim, op: 'in', value: vals };
    }).filter(Boolean);
  }
  /** Push the page's filters into the global filters; returns true when that changed them (a full re-render follows). */
  function writeThrough() {
    if (!Scope.filters) return false;
    const mine = view.filters.map((f) => ({ field: DIM_TO_FIELD[f.field] || f.field, op: 'in',
      value: [].concat(f.value).map(String).map((v) => (f.field === 'green_loan' ? GREEN_TO_FIELD[v] || v : v)) }));
    const handled = new Set(Object.keys(AUM.DIMENSIONS).map((k) => DIM_TO_FIELD[k] || k));
    const current = Scope.filters.list();
    // keep global filters the page does not manage (other fields, ranges), in their original order
    const keep = current.filter((f) => !(f.op === 'in' && handled.has(f.field)));
    const next = keep.concat(mine);
    const key = (arr) => JSON.stringify(arr.map((f) => [f.field, f.op, [].concat(f.value).map(String).sort()]).sort());
    if (key(next) === key(current)) return false;
    Scope.filters.set(next);
    return true;
  }

  // ---------- pure helpers ----------
  // dimValue: an Output row's label for dimension k ("(blank)" when empty), exactly as the engine distributions label it;
  // dimLabel: display name of a dimension; dimKeys: every filterable dimension; asList: value or list → string list.
  const dimValue = (r, k) => { const d = AUM.DIMENSIONS[k]; const v = d ? d.key(r) : ''; return v === undefined || v === null || v === '' ? BLANK : String(v); };
  const dimLabel = (k) => (AUM.DIMENSIONS[k] ? AUM.DIMENSIONS[k].label : k);
  const dimKeys = () => Object.keys(AUM.DIMENSIONS);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((x) => String(x));

  /**
   * AND across fields, OR within a field. Ops: in | notIn (anything else is ignored).
   * Returns a predicate over Output rows; skipField leaves one dimension's filter out (used for picker counts).
   */
  function predicate(filters, skipField) {
    const tests = [];
    for (const f of filters || []) {
      if (!f || f.field === skipField || !AUM.DIMENSIONS[f.field]) continue;
      const set = new Set(asList(f.value)), k = f.field;
      if (f.op === 'notIn') tests.push((r) => !set.has(dimValue(r, k)));
      else tests.push((r) => set.has(dimValue(r, k)));
    }
    if (!tests.length) return () => true;
    return (r) => { for (let i = 0; i < tests.length; i++) if (!tests[i](r)) return false; return true; };
  }
  /** Output rows passing the filters (optionally ignoring one field). */
  const applyFilters = (rows, filters, skipField) => { const p = predicate(filters, skipField); return rows.filter(p); };

  /** Map AUM dimension filters onto dataset field ids/values (explorer and pivot pages read this shape). */
  function toDatasetFilters(filters) {
    const out = [];
    for (const f of filters || []) {
      if (!f || !AUM.DIMENSIONS[f.field]) continue;
      const id = DS_ID[f.field] || f.field;
      let values = asList(f.value);
      // The AUM view labels green loans "Green loan" / "Not green"; the dataset keeps the raw Y / N (blank counts as not green).
      if (f.field === 'green_loan') values = values.flatMap((v) => (v === 'Green loan' ? ['Y'] : v === 'Not green' ? ['N', BLANK] : [v]));
      out.push({ field: id, op: f.op === 'notIn' ? 'notIn' : 'in', value: values });
    }
    return out;
  }
  // URL-safe base64 of UTF-8 text (no padding) for view tokens in the hash; unescape / escape bridge UTF-8 and btoa's Latin-1.
  const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (t) => decodeURIComponent(escape(atob(String(t).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (t.length % 4)) % 4))));
  // View object ↔ token; a malformed token decodes to null rather than throwing.
  const encodeView = (obj) => b64url(JSON.stringify(obj));
  const decodeView = (token) => { try { return JSON.parse(unb64url(token)); } catch (e) { return null; } };
  Scope.aumView = { encode: encodeView, decode: decodeView, toDatasetFilters, predicate, applyFilters, dimValue };

  // Export file name: scope_<what>_<platform>_<ccy>_<reporting date>_<dataset label>.csv
  const fileName = (res, what) => `scope_${what}_${U.slug(res.platformId)}_${U.slug(res.displayCurrency)}_${U.isoDate(res.reportingDate)}_${U.slug((res.config && res.config.dataset_label) || (Scope.store.state.datasetLabel) || 'dataset')}.csv`;
  // Exposure-weighted average of a field over Output rows (rows without a value are skipped), for grid footers.
  const wavgRows = (rows, key, weightKey) => { let n = 0, d = 0; for (const r of rows) { const v = r[key], w = r[weightKey || 'exposure_m']; if (U.isNum(v) && U.isNum(w)) { n += v * w; d += w; } } return d ? n / d : NaN; };


  Scope.registerModule({
    id: 'aum', layer: 1, order: 1, title: 'AUM overview', status: 'built', icon: 'pie-chart', activeFor: ['asset'],
    /**
     * Build the page once (head, filter bar, KPIs, charts, breakdown, asset grid); filter changes then call refresh(),
     * which redraws only the parts that depend on the filtered rows. Returns a cleanup function for the app shell.
     */
    render(el, ctx) {
      const res = ctx.result, ccy = res.displayCurrency, L = res.config.attribution_label || 'Group', mfmt = (v) => F.m(v) + 'm';
      const allRows = res.rows;
      const P = Scope.pivot, DS = Scope.engine.dataset, hasGrid = typeof UI.grid === 'function';
      const datasetLabel = res.config.dataset_label || Scope.store.state.datasetLabel || '';
      const synthetic = /synthetic/i.test(datasetLabel);
      let lastMod = false; // ctrl/cmd held on the last click inside the page (chart wrappers drop the event)
      const modListener = (e) => { lastMod = !!(e.ctrlKey || e.metaKey); };
      el.addEventListener('click', modListener, true);

      // The page's filters are the global filters (Scope.filters) that map onto an AUM dimension; every change made
      // here (chart clicks, breakdown rows) is written back to the global filters, so all pages stay in step.
      view.filters = globalToView();
      if (!AUM.DIMENSIONS[view.breakdown]) view.breakdown = dimKeys()[0];
      if (view.thenBy && !AUM.DIMENSIONS[view.thenBy]) view.thenBy = '';
      if (view.colDim && !AUM.DIMENSIONS[view.colDim]) view.colDim = '';

      // ---------- filter state ----------
      // view.filters holds at most one { field, op: 'in', value: [...] } per dimension. Every mutation ends in refresh().
      const getFilter = (k) => view.filters.find((f) => f.field === k) || null;
      const setFilterValues = (k, values) => {
        const list = U.uniq(asList(values));
        view.filters = view.filters.filter((f) => f.field !== k);
        if (list.length) view.filters.push({ field: k, op: 'in', value: list });
        refresh();
      };
      const removeFilter = (k) => { view.filters = view.filters.filter((f) => f.field !== k); refresh(); };
      // Click semantics: plain click filters to just that value (clicking the sole selected value again clears it);
      // ctrl/cmd-click toggles the value in or out of the current selection.
      const toggleValue = (k, v) => { const f = getFilter(k); const cur = f ? asList(f.value) : []; setFilterValues(k, cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat([v])); };
      const replaceValue = (k, v) => { const f = getFilter(k); const cur = f ? asList(f.value) : []; if (cur.length === 1 && cur[0] === v) removeFilter(k); else setFilterValues(k, [v]); };
      const clickValue = (k, v) => { if (lastMod) toggleValue(k, v); else replaceValue(k, v); };
      const chartClick = (dim) => (it) => { if (!it || it.other || !dim) return; clickValue(dim, it.label); };
      const applyPath = (dims, path) => { // breakdown row: filter to the row's full label path
        const add = !lastMod;
        dims.forEach((k, i) => { if (path[i] === undefined) return; if (add) { const f = getFilter(k); const cur = f ? asList(f.value) : []; if (!(cur.length === 1 && cur[0] === path[i])) view.filters = view.filters.filter((x) => x.field !== k).concat([{ field: k, op: 'in', value: [path[i]] }]); } else { const f = getFilter(k); const cur = f ? asList(f.value) : []; const next = cur.includes(path[i]) ? cur.filter((x) => x !== path[i]) : cur.concat([path[i]]); view.filters = view.filters.filter((x) => x.field !== k); if (next.length) view.filters.push({ field: k, op: 'in', value: next }); } });
        refresh();
      };

      // ---------- computed (per refresh) ----------
      let rows = allRows, M = res.metrics, D = res.distributions;
      /** Filtered Output rows and their metrics / distributions (the engine's own when unfiltered). */
      function compute() {
        rows = view.filters.length ? applyFilters(allRows, view.filters) : allRows;
        if (view.filters.length) { const s = AUM.summarise(rows, res.ratingScale, res.config); M = s.metrics; D = s.distributions; } else { M = res.metrics; D = res.distributions; }
      }
      compute();

      // ---------- page head ----------
      // "Open in Explorer / Pivot": hand the current platform, currency and filters (as dataset filters) over in the URL.
      const openIn = (page) => () => {
        if (!Scope.modules.has(page)) { UI.toast(`The ${page} page is not loaded in this build`, 'warn'); return; }
        const token = encodeView({ source: 'assets', platform: res.platformId, currency: ccy, filters: toDatasetFilters(view.filters) });
        Scope.navigate(page, 'v', token);
      };
      el.appendChild(Scope.app.pageHead({
        title: `AUM · ${res.platform.label}`,
        sub: [`${ccy} millions`, `reporting date ${F.date(res.reportingDate)}${res.quarter ? ' (' + res.quarter + ')' : ''}`, `${L} attribution`, `${res.stats.assetsSelected} assets, ${res.metrics.n_positions} positions on this platform`].join(' · '),
        actions: [
          h('button', { class: 'btn', title: 'Open the current filters in the Explorer grid (asset grain)', disabled: Scope.modules.has('explorer') ? null : true, onClick: openIn('explorer') }, Scope.icon('grid', { size: 14 }), 'Open in Explorer'),
          h('button', { class: 'btn', title: 'Open the current filters in the Pivot builder', disabled: Scope.modules.has('pivot') ? null : true, onClick: openIn('pivot') }, Scope.icon('columns', { size: 14 }), 'Open in Pivot'),
          h('button', { class: 'btn', title: 'Output sheet, one row per asset (all columns, unfiltered)', onClick: () => UI.downloadText(fileName(res, 'output'), Scope.csv.serialize(AUM.outputRecords(res))) }, Scope.icon('download', { size: 14 }), 'Output CSV'),
          h('button', { class: 'btn', title: 'One row per position (unfiltered)', onClick: () => UI.downloadText(fileName(res, 'positions'), Scope.csv.serialize(AUM.positionRecords(res))) }, Scope.icon('download', { size: 14 }), 'Positions CSV'),
        ],
      }));
      if (res.fatal) el.appendChild(h('div', { class: 'notice error' }, h('b', {}, 'Holdings cannot be processed. '), 'Required columns are missing after mapping — see ', h('a', { href: Scope.href('data', 'mapping') }, 'column mapping'), '.'));

      // ---------- filter bar ----------
      const barHost = h('div', { class: 'section', style: { padding: '.75rem 1.25rem' } });
      el.appendChild(barHost);


      /**
       * Filter bar: "x of y assets · exposure a of b (share)", links to excluded positions and issues, the synthetic
       * badge and a pointer to the global filter bar.
       */
      function renderBar() {
        barHost.innerHTML = '';
        const total = res.metrics.total_exposure_m, share = total ? M.total_exposure_m / total : 0;
        const sentence = h('span', { class: 'small', style: { color: 'var(--heading-color)' } },
          h('strong', {}, `${F.int(rows.length)} of ${F.int(allRows.length)} assets`), ` · ${ccy} ${F.m(M.total_exposure_m)} of ${F.m(total)} m (${F.pct(share, 1)})`);
        const right = [];
        if (res.stats.excluded) right.push(h('a', { class: 'chip', href: Scope.href('data', 'issues'), title: 'Positions excluded from AUM because they cannot be mapped or converted — never counted here', style: { textDecoration: 'none' } }, Scope.icon('alert-triangle', { size: 12 }), ` ${res.stats.excluded} excluded`));
        const nIssues = (res.issueCounts.error || 0) + (res.issueCounts.warn || 0);
        if (nIssues) right.push(h('a', { class: 'small', href: Scope.href('data', 'issues') }, `${nIssues} issue${nIssues === 1 ? '' : 's'}`));
        if (synthetic) right.push(h('span', { class: 'badge badge-synthetic', title: 'Synthetic demo data — not a real portfolio' }, datasetLabel));
        barHost.append(
          h('div', { class: 'chips', style: { gap: '.5rem' } }, sentence, h('span', { style: { flex: 1 } }), right),
          h('div', { class: 'small muted', style: { marginTop: '.4rem' } }, 'Filters are set in the bar under the navigation and apply to every page; clicking a chart or a breakdown row adds one.')
        );
      }

      // ---------- KPIs ----------
      const kpiHost = h('div', { class: 'kpis' });
      el.appendChild(kpiHost);
      /**
       * KPI cards from the (filtered) metrics. Sub-IG share is an open definition: by default it is divided by rated
       * exposure only; the checkbox switches to the workbook's denominator (all exposure, NR included).
       */
      function renderKpis() {
        kpiHost.innerHTML = '';
        const total = M.total_exposure_m, nr = U.isNum(M.nr_share) ? M.nr_share * total : 0, subIg = U.isNum(M.sub_ig_share) ? M.sub_ig_share * total : NaN;
        const subIgShare = view.nrInDenominator ? M.sub_ig_share : (total - nr ? subIg / (total - nr) : NaN);
        const nrToggle = h('label', { class: 'small muted', style: { display: 'flex', alignItems: 'center', gap: '.35rem', marginTop: '.35rem', cursor: 'pointer' }, title: 'Open definition: the workbook divides sub-IG exposure by all exposure including NR; off divides by rated exposure only', onClick: (e) => e.stopPropagation() },
          h('input', { type: 'checkbox', checked: view.nrInDenominator ? true : null, style: { margin: 0, accentColor: 'var(--primary)' }, onChange: (e) => { view.nrInDenominator = e.target.checked; renderKpis(); } }), 'NR in sub-IG denominator');
        const ratingKpi = UI.kpi({ icon: 'award', label: 'Weighted rating', value: M.w_rating_label, sub: `${F.pct(subIgShare)} sub-IG (open definition)` + (M.nr_share > 0 ? ` · ${F.pct(M.nr_share)} NR` : ''), title: 'Nearest rating label to the exposure-weighted numeric score (rated assets only)' });
        ratingKpi.appendChild(nrToggle);
        kpiHost.append(
          UI.kpi({ icon: 'briefcase', label: 'Exposure', value: `${ccy} ${F.m(M.total_exposure_m)}m`, sub: `${M.n_assets} assets · ${M.n_positions} positions` }),
          UI.kpi({ icon: 'download', label: 'Drawn', value: `${ccy} ${F.m(M.total_drawn_m)}m`, sub: `${F.pct(M.drawn_pct)} of exposure` }),
          UI.kpi({ icon: 'clock', label: 'Undrawn', value: `${ccy} ${F.m(M.total_undrawn_m)}m`, sub: 'commitment not yet funded' }),
          UI.kpi({ icon: 'percent', label: `${L} share of book`, value: F.pct(M.group_share_of_book), sub: `all investors: ${F.m(M.book_total_m)}m`, title: `${L}-attributed nominal ÷ total nominal across all investor columns (group_weight from mapping_investors.csv)` }),
          ratingKpi,
          UI.kpi({ icon: 'activity', label: 'Weighted spread', value: F.bps(M.w_margin_bps), sub: `coverage ${F.pct(M.margin_coverage, 0)}` }),
          UI.kpi({ icon: 'calendar', label: 'Weighted WAL', value: F.yrs(M.w_wal_years), sub: `remaining tenor ${F.yrs(M.w_remaining_years)}` }),
          UI.kpi({ icon: 'hash', label: 'Fixed rate', value: F.pct(M.fixed_share), sub: 'share of exposure' }),
          UI.kpi({ icon: 'flag', label: 'Watchlist', value: F.pct(M.watchlist_share), sub: 'share of exposure', tone: M.watchlist_share > 0.15 ? 'warn' : null }),
        );
      }

      // ---------- charts ----------
      // Each chart: title, subtitle, the dimension its clicks filter on (null = not clickable) and a draw function.
      const chartDefs = [
        { title: 'Exposure by sector', sub: 'click a bar to filter · ctrl/cmd-click adds', dim: 'sector', draw: (b) => C.hbar(b, { items: D.sector, format: mfmt, onClick: chartClick('sector') }) },
        { title: 'Exposure by country', sub: 'top 10, rest folded', dim: 'country', draw: (b) => C.hbar(b, { items: D.country, format: mfmt, max: 10, onClick: chartClick('country') }) },
        { title: 'Exposure by rating', sub: `current grade · IG threshold ${res.config.ig_threshold}`, dim: 'rating', draw: (b) => C.bar(b, { items: D.rating.map((d) => Object.assign({}, d, { sub: d.count + ' assets' })), format: (v, tick) => (tick ? F.int(v) : F.m(v)), onClick: chartClick('rating') }) },
        { title: 'Maturity profile', sub: 'remaining years from reporting date', dim: 'maturity_bucket', draw: (b) => C.bar(b, { items: D.maturity_bucket.map((d) => Object.assign({}, d, { sub: d.count + ' assets' })), format: (v, tick) => (tick ? F.int(v) : F.m(v)), onClick: chartClick('maturity_bucket') }) },
        { title: 'Fixed vs floating', sub: 'share of exposure', dim: 'fixed_floating', draw: (b) => C.donut(b, { items: D.fixed_floating, format: mfmt, centre: { value: F.pct(M.fixed_share, 0), label: 'fixed' }, onClick: chartClick('fixed_floating') }) },
        { title: `${L} vs third party`, sub: 'nominal across all investor columns (look-through weights applied)', dim: null, draw: (b) => C.donut(b, { items: D.group_split, format: mfmt, centre: { value: F.pct(M.group_share_of_book, 0), label: L } }) },
      ];
      const chartHost = h('div', { class: 'charts' });
      chartDefs.forEach((c) => { c.body = h('div'); chartHost.appendChild(UI.section({ title: c.title, subtitle: c.sub, body: c.body })); });
      el.appendChild(chartHost);
      /** Redraw every chart on the next frame (containers need a width); a failing chart shows a placeholder instead of breaking the page. */
      function renderCharts() { requestAnimationFrame(() => { for (const c of chartDefs) { c.body.innerHTML = ''; try { c.draw(c.body); } catch (e) { c.body.appendChild(h('div', { class: 'chart-empty' }, 'Chart unavailable')); console.error(e); } } }); }

      // ---------- drill-through ----------
      /** Modal listing the Output rows behind a breakdown row (grid when available, else a simple table); a row opens the asset page. */
      function drill(title, crumbs, subset) {
        const cols = [
          { key: 'rank', label: '#', type: 'number', width: 52, decimals: 0 },
          { key: 'name', label: 'Asset', frozen: true, width: 220, href: (r) => Scope.href('asset', r.code), cellClass: () => 'strong' },
          { key: 'code', label: 'Code', width: 90 }, { key: 'sector', label: 'Sector' }, { key: 'country', label: 'Country', width: 120 }, { key: 'currency', label: 'Ccy', width: 64 },
          { key: 'rating', label: 'Rating', width: 80, get: (r) => (r.rating_status === 'rated' ? r.rating : 'NR') },
          { key: 'maturity_date', label: 'Maturity', type: 'date' },
          { key: 'exposure_m', label: 'Exposure', unit: `${ccy} m`, type: 'number', format: F.m, total: 'sum' },
          { key: 'drawn_m', label: 'Drawn', unit: `${ccy} m`, type: 'number', format: F.m, total: 'sum' },
          { key: 'margin_bps', label: 'Margin', unit: 'bps', type: 'number', format: (v) => (U.isNum(v) ? F.int(v) : ''), total: (rs) => F.int(wavgRows(rs, 'margin_bps')) },
        ];
        const body = h('div');
        body.appendChild(h('div', { class: 'small muted', style: { marginBottom: '.5rem' } }, crumbs, synthetic ? [' · ', h('span', { class: 'badge badge-synthetic' }, datasetLabel)] : null));
        if (hasGrid) body.appendChild(UI.grid({ columns: cols, rows: subset, rowKey: 'code', height: '50vh', onRow: (r) => { modal.close(); Scope.navigate('asset', r.code); }, exportName: fileName(res, 'drill'), features: { chooser: false, density: false } }));
        else body.appendChild(UI.table({ rows: subset, rowKey: 'code', sortKey: 'exposure_m', onRow: (r) => { modal.close(); Scope.navigate('asset', r.code); }, columns: cols.map((c) => ({ key: c.key, label: c.label + (c.unit ? ' ' + c.unit : ''), align: c.type === 'number' ? 'right' : 'left', format: c.format || (c.get ? (v, r) => c.get(r) : null), total: c.total === 'sum' ? 'sum' : null })) }));
        const modal = UI.modal({ title, wide: true, body });
        return modal;
      }

      // ---------- breakdown (one or two levels, optional column dimension) ----------
      const canPivot = !!(P && DS && typeof P.run === 'function' && typeof DS.buildAssets === 'function');
      const bdChart = h('div'), bdTable = h('div');
      // Dimension <select>, optionally with a "None" option and excluding dimensions already used elsewhere.
      const mkSelect = (value, onChange, withNone, exclude) => h('select', { class: 'input', style: { fontSize: '.8125rem', padding: '.2rem .6rem' }, onChange: (e) => onChange(e.target.value) },
        withNone ? h('option', { value: '', selected: !value }, withNone) : null,
        dimKeys().filter((d) => !exclude || !exclude.includes(d)).map((d) => h('option', { value: d, selected: d === value }, dimLabel(d))));
      const controls = h('div', { class: 'section-actions', style: { gap: '.6rem' } });
      /** Breakdown controls: row dimension, optional second row level and column dimension (pivot only), Top N, CSV export. */
      function renderControls() {
        controls.innerHTML = '';
        const thenSel = mkSelect(view.thenBy, (v) => { view.thenBy = v; renderBreakdown(); }, 'None', [view.breakdown, view.colDim].filter(Boolean));
        const colSel = mkSelect(view.colDim, (v) => { view.colDim = v; renderControls(); renderBreakdown(); }, 'None', [view.breakdown, view.thenBy].filter(Boolean));
        if (!canPivot) { thenSel.disabled = true; colSel.disabled = true; }
        controls.append(
          h('label', { class: 'small ink2' }, 'Rows ', mkSelect(view.breakdown, (v) => { view.breakdown = v; if (view.thenBy === v) view.thenBy = ''; if (view.colDim === v) view.colDim = ''; renderControls(); renderBreakdown(); })),
          h('label', { class: 'small ink2', title: canPivot ? 'Second row level (nested)' : 'Needs js/engine/pivot.js and dataset.js' }, 'then by ', thenSel),
          h('label', { class: 'small ink2', title: canPivot ? 'Column dimension: one column per value, stacked chart' : 'Needs js/engine/pivot.js and dataset.js' }, 'Columns ', colSel),
          h('label', { class: 'small ink2' }, 'Top ', h('select', { class: 'input', style: { fontSize: '.8125rem', padding: '.2rem .6rem' }, onChange: (e) => { view.topN = +e.target.value || 0; renderBreakdown(); } }, [10, 14, 20, 0].map((n) => h('option', { value: n, selected: n === view.topN }, n ? String(n) : 'All')))),
          h('button', { class: 'btn btn-sm', title: 'Export the breakdown table as shown', onClick: exportBreakdown }, Scope.icon('download', { size: 13 }), 'CSV'),
        );
      }
      let lastPivot = null;
      /**
       * Pivot field definitions ('aum:<key>') that read the AUM dimension labels from each asset record's Output row,
       * so breakdown labels match the charts and filters exactly. sortRank gives ordinal dimensions their natural order.
       */
      function pivotFields() { // AUM dimensions as pivot field objects over asset-grain dataset records (labels identical to charts and filters)
        const ratingRank = new Map(res.ratingScale.map((r) => [r.grade, r.numeric]));
        const bucketOrder = (res.distributions.maturity_bucket || []).map((d) => d.label);
        const rankOf = { rating: (v) => (ratingRank.has(v) ? ratingRank.get(v) : v === 'NR' ? 9e6 : Infinity), ig: (v) => ({ IG: 0, 'SUB IG': 1, NR: 2 })[v], maturity_bucket: (v) => { const i = bucketOrder.indexOf(v); return i < 0 ? Infinity : i; },
          fixed_floating: (v) => ({ Fixed: 0, Floating: 1 })[v], watchlist: (v) => ({ No: 0, Watch: 1, Intensive: 2 })[v], green_loan: (v) => ({ 'Green loan': 0, 'Not green': 1 })[v], deal_year: (v) => +v };
        const out = {};
        for (const k of dimKeys()) out[k] = { id: 'aum:' + k, label: dimLabel(k), kind: 'dimension', type: 'string', group: 'AUM', get: (rec) => (rec._row ? dimValue(rec._row, k) : BLANK), format: (v) => v, agg: 'count', sortRank: rankOf[k], distinctKey: (rec) => (rec._row ? dimValue(rec._row, k) : BLANK) };
        return out;
      }
      const pivotDims = canPivot ? pivotFields() : null;
      /**
       * Breakdown through Scope.pivot over asset-grain records, filtered here with the AUM predicate. Ordinal dimensions sort
       * by label (natural order), others by exposure descending. Without a column dimension it shows exposure, share,
       * drawn, asset count and exposure-weighted margin and remaining years.
       */
      function runPivot() {
        const ds = DS.buildAssets(res), pred = predicate(view.filters);
        const records = view.filters.length ? ds.records.filter((rec) => rec._row && pred(rec._row)) : ds.records;
        const fieldById = Object.assign({}, ds.fieldById);
        for (const k in pivotDims) fieldById[pivotDims[k].id] = pivotDims[k];
        const rowDims = [pivotDims[view.breakdown].id].concat(view.thenBy ? [pivotDims[view.thenBy].id] : []);
        const colDims = view.colDim ? [pivotDims[view.colDim].id] : [];
        const values = colDims.length
          ? [{ field: 'exposure', agg: 'sum', label: 'Exposure' }]
          : [{ field: 'exposure', agg: 'sum', label: `Exposure ${ccy}m` }, { field: 'exposure', agg: 'sum', showAs: 'pctOfTotal', label: 'Share' }, { field: 'drawn', agg: 'sum', label: `Drawn ${ccy}m` }, { field: 'assets', agg: 'countDistinct', label: 'Assets' }, { field: 'margin_bps', agg: 'wavg', label: 'Margin' }, { field: 'remaining_years', agg: 'wavg', label: 'Rem. years' }];
        const ordered = ORDERED.includes(view.breakdown) && (!view.thenBy || ORDERED.includes(view.thenBy));
        const r = P.run({ records, fieldById, rowDims, colDims, values, filters: [], sort: ordered ? { by: 'label', dir: 'asc' } : { by: 'value', valueIndex: 0, dir: 'desc' }, topN: null, subtotals: true, grandTotal: true });
        r.rowKeys = [view.breakdown].concat(view.thenBy ? [view.thenBy] : []);
        r.unit = ds.unit || 1;
        return r;
      }
      /** Column keys to display: all when there are at most 8, else the 7 largest by total and the rest summed as "Other". */
      function pivotColumns(r) { // column keys capped at 8 (largest by total + Other)
        const keys = r.colKeys.filter((c) => c.kind !== 'subtotal');
        if (keys.length <= 8) return { keys, other: [] };
        const sorted = keys.slice().sort((a, b) => ((r.colTotals[b.key] || [])[0] || 0) - ((r.colTotals[a.key] || [])[0] || 0));
        return { keys: sorted.slice(0, 7), other: sorted.slice(7) };
      }
      const rowsOfNode = (row, r) => { // Output rows contributing to a pivot row (for drill and filter clicks)
        const dims = r.rowKeys, path = row.path || [];
        const pred = predicate(view.filters);
        return allRows.filter((x) => pred(x) && dims.every((k, i) => path[i] === undefined || dimValue(x, k) === path[i]));
      };
      /** Breakdown table: indented row labels, one column per value (or per column key + Total), drill button per row. */
      function renderPivotTable(r) {
        const cc = pivotColumns(r), V = r.values, fmtCell = (v, x) => (U.isNum(x) ? V[v].format(x) : '–');
        const colMode = cc.keys.length > 0 || r.colKeys.length > 0;
        const head = h('tr', {}, h('th', {}, r.rowKeys.map(dimLabel).join(' › ')));
        if (colMode) { cc.keys.forEach((c) => head.appendChild(h('th', { class: 'num', title: `${dimLabel(view.colDim)} = ${c.label}` }, c.label))); if (cc.other.length) head.appendChild(h('th', { class: 'num', title: cc.other.map((c) => c.label).join(', ') }, `Other (${cc.other.length})`)); head.appendChild(h('th', { class: 'num' }, `Total ${ccy}m`)); }
        else V.forEach((v) => head.appendChild(h('th', { class: 'num', title: v.agg === 'wavg' ? 'Exposure-weighted average' : v.showAs === 'pctOfTotal' ? 'Share of the filtered total' : '' }, v.label)));
        head.appendChild(h('th', { style: { width: '32px' } }));
        const tbody = h('tbody');
        for (const row of r.rows) {
          const isTotal = row.kind === 'total', isSub = row.kind === 'subtotal', group = row.kind === 'group';
          const tr = h('tr', { class: group ? 'clickable' : '', style: isTotal || isSub ? { fontWeight: 600, background: 'var(--light)' } : null, title: group ? 'Click to filter · ctrl/cmd-click adds' : null,
            onClick: group ? () => applyPath(r.rowKeys, row.path) : null });
          tr.appendChild(h('td', { class: isSub || isTotal ? '' : row.level === 0 && r.rowKeys.length > 1 ? 'strong' : '', style: { paddingLeft: (12 + Math.max(0, row.level) * 18) + 'px' } }, row.label));
          if (colMode) {
            cc.keys.forEach((c) => tr.appendChild(h('td', { class: 'num' }, fmtCell(0, (row.cells[c.key] || [])[0]))));
            if (cc.other.length) tr.appendChild(h('td', { class: 'num' }, fmtCell(0, cc.other.reduce((s, c) => s + (((row.cells[c.key] || [])[0]) || 0), 0))));
            tr.appendChild(h('td', { class: 'num strong' }, fmtCell(0, row.rowTotal[0])));
          } else V.forEach((v, i) => tr.appendChild(h('td', { class: 'num' }, fmtCell(i, row.rowTotal[i]))));
          const drillBtn = h('button', { class: 'btn btn-ghost btn-sm', title: 'Show the assets behind this row', style: { padding: '0 .3rem' }, onClick: (e) => { e.stopPropagation(); const subset = rowsOfNode(row, r); drill(`${row.label} · ${subset.length} asset${subset.length === 1 ? '' : 's'}`, `${r.rowKeys.map(dimLabel).join(' › ')}: ${isTotal ? 'all filtered assets' : row.path.join(' › ')}`, subset); } }, Scope.icon('eye', { size: 13 }));
          tr.appendChild(h('td', {}, drillBtn));
          tbody.appendChild(tr);
        }
        return h('div', { class: 'tbl-scroll', style: { maxHeight: '420px' } }, h('table', { class: 'tbl compact' }, h('thead', {}, head), tbody));
      }
      /** Breakdown table + chart (bars, or stacked bars when a column dimension is set); falls back to engine distributions without the pivot. */
      function renderBreakdown() {
        bdTable.innerHTML = ''; bdChart.innerHTML = '';
        if (!canPivot || !pivotDims[view.breakdown]) {
          const bd = D[view.breakdown] || [];
          lastPivot = null;
          bdTable.appendChild(UI.table({ filter: false, compact: true, rows: bd, sortKey: ORDERED.includes(view.breakdown) ? null : 'exposure_m', columns: [
            { key: 'label', label: dimLabel(view.breakdown) }, { key: 'count', label: 'Assets', align: 'right', total: 'sum' },
            { key: 'exposure_m', label: `Exposure ${ccy}m`, align: 'right', format: F.m, total: 'sum' }, { key: 'share', label: 'Share', align: 'right', format: (v) => F.pct(v) },
            { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m, total: 'sum' }], onRow: (r) => clickValue(view.breakdown, r.label) }));
          requestAnimationFrame(() => C.hbar(bdChart, { items: bd, format: mfmt, max: view.topN || undefined, onClick: chartClick(view.breakdown) }));
          return;
        }
        let r;
        try { r = runPivot(); } catch (e) { console.error(e); bdTable.appendChild(h('div', { class: 'notice error' }, 'Breakdown could not be computed: ', String(e && e.message || e))); return; }
        lastPivot = r;
        if (!r.rows.length || !rows.length) { bdTable.appendChild(h('div', { class: 'empty' }, 'No assets match the current filters. ', h('button', { class: 'btn btn-sm', onClick: () => { view.filters = []; refresh(); } }, 'Clear filters'))); return; }
        bdTable.appendChild(renderPivotTable(r));
        const top = r.rows.filter((x) => x.kind === 'group' && x.level === 0);
        requestAnimationFrame(() => {
          if (view.colDim) {
            const cc = pivotColumns(r), series = cc.keys.map((c) => c.label).concat(cc.other.length ? ['Other'] : []);
            const chartRows = top.map((x) => { const parts = {}; cc.keys.forEach((c) => { parts[c.label] = ((x.cells[c.key] || [])[0] || 0) / r.unit; }); if (cc.other.length) parts.Other = cc.other.reduce((s, c) => s + (((x.cells[c.key] || [])[0]) || 0), 0) / r.unit; return { label: x.label, parts }; });
            C.stacked(bdChart, { rows: chartRows, series, format: mfmt, max: view.topN || undefined, onClick: chartClick(view.breakdown) });
          } else C.hbar(bdChart, { items: top.map((x) => ({ label: x.label, value: x.rowTotal[0] / r.unit, sub: `${F.int(x.count)} assets` })), format: mfmt, max: view.topN || undefined, onClick: chartClick(view.breakdown) });
        });
      }
      /** Download the breakdown as shown (pivot rows with a kind column, or the distribution); BOM prefix so Excel reads UTF-8. */
      function exportBreakdown() {
        let records;
        if (lastPivot && P && typeof P.toRecords === 'function') records = P.toRecords(lastPivot);
        else records = (D[view.breakdown] || []).map((d) => ({ [dimLabel(view.breakdown)]: d.label, assets: d.count, [`exposure_${ccy}m`]: d.exposure_m, share: d.share, [`drawn_${ccy}m`]: d.drawn_m }));
        UI.downloadText(fileName(res, 'breakdown_' + U.slug(view.breakdown + (view.thenBy ? '_' + view.thenBy : '') + (view.colDim ? '_by_' + view.colDim : ''))), '﻿' + Scope.csv.serialize(records));
      }
      renderControls();
      el.appendChild(UI.section({ title: 'Breakdown', subtitle: 'filtered portfolio by one or two dimensions · click a row or bar to filter · eye icon shows the assets behind a row', actions: [controls], body: h('div', { class: 'grid-2' }, bdChart, bdTable) }));

      // ---------- asset table (Output rows) ----------
      const gridSection = h('div');
      el.appendChild(UI.section({ title: 'Assets', subtitle: `one row per asset with exposure on ${res.platform.label} · every Output column and one nominal / drawn column per investor behind the column chooser · double-click or Enter opens the asset page`, body: gridSection }));
      let grid = null;
      /**
       * Assets grid over the filtered Output rows: every Output column (rarely used ones hidden but available in the
       * chooser), then one nominal and one drawn column per investor column. Footers sum amounts, take exposure-weighted
       * averages for rates and terms, and a ratio of sums for drawn %. Layout persists under 'scope.grid.aum'; the
       * default sort (exposure descending) applies only when no saved layout exists.
       */
      function buildGrid() {
        // Column builders: amt (amount in the display unit, summed), wavgCol (rate / term with an exposure-weighted
        // footer), txt (text column). `rated` separates real grades from NR.
        const rated = (r) => r.rating_status === 'rated';
        const amt = (key, label, group, extra) => Object.assign({ key, label, type: 'number', unit: `${ccy} m`, group, format: F.m, decimals: 1, total: 'sum', width: 110 }, extra || {});
        const wavgCol = (key, label, group, unit, format, extra) => Object.assign({ key, label, type: 'number', unit, group, format, total: (rs) => wavgRows(rs, key), width: 96, title: 'Footer: exposure-weighted average of the visible rows' }, extra || {});
        const txt = (key, label, group, extra) => Object.assign({ key, label, type: 'text', group, width: 120 }, extra || {});
        const columns = [
          { key: 'rank', label: '#', type: 'number', group: 'Identity', width: 52, frozen: true, decimals: 0, total: 'count', title: 'Rank by exposure on this platform (unfiltered)' },
          { key: 'name', label: 'Asset', type: 'text', group: 'Identity', width: 230, frozen: true, href: (r) => Scope.href('asset', r.code), cellClass: (v, r) => (r.flags && r.flags.length ? 'strong warn' : 'strong'), tooltip: (v, r) => (r.flags && r.flags.length ? 'Flags: ' + r.flags.join(', ') : '') },
          { key: 'code', label: 'Code', type: 'text', group: 'Identity', width: 90, frozen: true, cellClass: () => 'dim' },
          txt('code_name', 'Code name', 'Identity', { hidden: true }),
          amt('exposure_m', 'Exposure', 'Amounts', { title: 'Nominal × platform weight, converted to the display currency' }),
          amt('drawn_m', 'Drawn', 'Amounts'),
          amt('undrawn_m', 'Undrawn', 'Amounts', { hidden: true }),
          { key: 'drawn_pct', label: 'Drawn %', type: 'number', group: 'Amounts', width: 84, format: (v) => F.pct(v, 0), total: (rs) => { const e = U.sum(rs, (r) => r.exposure_m); return e ? U.sum(rs, (r) => r.drawn_m) / e : NaN; }, title: 'Drawn ÷ exposure (footer: ratio of sums)' },
          amt('commitment_m', 'Commitment', 'Amounts', { hidden: true }),
          amt('total_nominal_m', 'All investors', 'Amounts', { title: 'Total nominal across every investor column' }),
          amt('group_nominal_m', `${L} attributed`, 'Attribution', { title: `Nominal × ${L.toLowerCase()} weight of each investor` }),
          amt('third_party_nominal_m', 'Third party', 'Attribution'),
          amt('group_drawn_m', `${L} drawn`, 'Attribution', { hidden: true }),
          amt('third_party_drawn_m', 'Third party drawn', 'Attribution', { hidden: true }),
          txt('group_invested', `${L} invested`, 'Attribution', { width: 90, hidden: true }),
          txt('sector', 'Sector', 'Attributes'), txt('subsector', 'Subsector', 'Attributes', { hidden: true }), txt('country', 'Country', 'Attributes'), txt('region', 'Region', 'Attributes', { hidden: true }),
          txt('sponsor', 'Sponsor', 'Attributes', { hidden: true, width: 160 }), txt('currency', 'Ccy', 'Attributes', { width: 64 }), txt('instrument', 'Instrument', 'Attributes', { hidden: true }),
          txt('fixed_floating', 'Rate', 'Terms', { width: 84 }), txt('repayment_type', 'Repayment', 'Attributes', { hidden: true }), txt('greenfield_brownfield', 'Greenfield / brownfield', 'Attributes', { hidden: true }),
          { key: 'deal_year', label: 'Deal year', type: 'number', group: 'Attributes', width: 84, hidden: true, decimals: 0, format: (v) => (U.isNum(v) ? String(v) : '') },
          txt('covenant_type', 'Covenant', 'Attributes', { hidden: true }),
          { key: 'rating', label: 'Rating', type: 'text', group: 'Credit', width: 80, get: (r) => (rated(r) ? r.rating : 'NR'), cellClass: (v, r) => (rated(r) ? (r.ig_label === 'IG' ? 'ok' : 'warn') : 'dim'), title: 'Current grade (internal if known, else external)' },
          { key: 'ig_label', label: 'IG / Sub-IG', type: 'text', group: 'Credit', width: 90, get: (r) => (rated(r) ? r.ig_label : 'NR') },
          txt('internal_grade', 'Internal grade', 'Credit', { hidden: true, width: 100 }), txt('external_grade', 'External grade', 'Credit', { hidden: true, width: 100 }),
          wavgCol('rating_numeric', 'Rating numeric', 'Credit', '', (v) => (U.isNum(v) ? F.int(v) : ''), { hidden: true, total: (rs) => wavgRows(rs.filter(rated), 'rating_numeric') }),
          wavgCol('margin_bps', 'Margin', 'Terms', 'bps', (v) => (U.isNum(v) ? F.int(v) : '')),
          wavgCol('coupon', 'Coupon', 'Terms', '%', (v) => (U.isNum(v) ? F.n2(v) : ''), { hidden: true }),
          { key: 'funding_date', label: 'Funding', type: 'date', group: 'Terms', width: 104, hidden: true },
          { key: 'maturity_date', label: 'Maturity', type: 'date', group: 'Terms', width: 104 },
          wavgCol('remaining_years', 'Rem. years', 'Terms', 'y', (v) => (U.isNum(v) ? F.n1(v) : '')),
          wavgCol('initial_tenor', 'Initial tenor', 'Terms', 'y', (v) => (U.isNum(v) ? F.n1(v) : ''), { hidden: true }),
          wavgCol('wal_years', 'WAL', 'Terms', 'y', (v) => (U.isNum(v) ? F.n1(v) : ''), { hidden: true }),
          txt('maturity_bucket', 'Maturity bucket', 'Terms', { hidden: true, width: 100 }),
          { key: 'watchlist', label: 'Watchlist', type: 'text', group: 'Flags', width: 90, cellClass: (v) => (v && v !== 'No' ? 'warn' : 'dim') },
          { key: 'flags', label: 'Flags', type: 'text', group: 'Flags', width: 160, hidden: true, get: (r) => (r.flags || []).join(', ') },
          { key: 'positions', label: 'Positions', type: 'number', group: 'Flags', width: 80, hidden: true, decimals: 0, total: 'sum' },
          wavgCol('esg_score', 'ESG score', 'ESG', '', (v) => (U.isNum(v) ? F.n1(v) : ''), { hidden: true }),
          txt('green_loan', 'Green loan', 'ESG', { hidden: true, width: 84 }), txt('cbi_taxonomy', 'CBI taxonomy', 'ESG', { hidden: true }), txt('sfdr_article', 'SFDR', 'ESG', { hidden: true, width: 80 }),
          { key: 'ghg_scope12_t', label: 'GHG scope 1+2', type: 'number', unit: 't', group: 'ESG', width: 110, hidden: true, decimals: 0, format: (v) => (U.isNum(v) ? F.int(v) : ''), total: 'sum' },
        ];
        (res.investorColumns || []).forEach((label, i) => {
          columns.push({ key: 'inv:' + label, label, unit: `${ccy} m`, type: 'number', group: 'Investors', width: 110, hidden: i >= 4, decimals: 1, format: F.m, total: 'sum', get: (r) => (r.investors && U.isNum(r.investors[label]) && r.investors[label] !== 0 ? r.investors[label] : NaN), title: `${label} nominal in the asset (all platforms)` });
          columns.push({ key: 'invd:' + label, label: `${label} drawn`, unit: `${ccy} m`, type: 'number', group: 'Investors', width: 110, hidden: true, decimals: 1, format: F.m, total: 'sum', get: (r) => (r.investors_drawn && U.isNum(r.investors_drawn[label]) && r.investors_drawn[label] !== 0 ? r.investors_drawn[label] : NaN) });
        });
        let saved = false; try { saved = !!localStorage.getItem('scope.grid.aum'); } catch (e) { saved = false; }
        return UI.grid({ columns, rows, rowKey: 'code', storageKey: 'aum', height: '62vh', exportName: fileName(res, 'assets'), ariaLabel: 'Assets', onRow: (r) => Scope.navigate('asset', r.code), state: saved ? null : { sort: [{ key: 'exposure_m', dir: 'desc' }] } });
      }
      /** Fallback asset table (Scope.ui.table) when grid.js is not loaded. */
      function buildTable() {
        // Rating cell HTML: grade plus an IG / SUB IG badge, or an NR badge (values are escaped).
        const ratingCell = (r) => `${U.escapeHtml(r.rating)}${r.rating_status === 'rated' ? ` <span class="badge ${r.ig_label === 'IG' ? 'badge-ok' : 'badge-warn'}">${r.ig_label}</span>` : ' <span class="badge badge-muted">NR</span>'}`;
        return UI.table({ rows, rowKey: 'code', exportName: fileName(res, 'assets'), onRow: (r) => Scope.navigate('asset', r.code), sortKey: 'exposure_m', filterPlaceholder: 'Filter assets…', columns: [
          { key: 'rank', label: '#', align: 'right', width: '40px' },
          { key: 'name', label: 'Asset', class: 'strong', html: (r) => `${U.escapeHtml(r.name)}${r.flags.length ? ' <span class="cell-flag" title="' + U.escapeHtml(r.flags.join(', ')) + '">' + Scope.iconHtml('flag', 12) + '</span>' : ''}` },
          { key: 'code', label: 'Code', class: 'dim' }, { key: 'sector', label: 'Sector' }, { key: 'country', label: 'Country' }, { key: 'currency', label: 'Ccy' },
          { key: 'rating', label: 'Rating', html: ratingCell, sortValue: (r) => (r.rating_status === 'rated' ? r.rating_numeric : 9999) },
          { key: 'fixed_floating', label: 'Rate' }, { key: 'repayment_type', label: 'Repayment' },
          { key: 'maturity_date', label: 'Maturity', format: F.date, sortValue: (r) => (r.maturity_date ? +r.maturity_date : NaN) },
          { key: 'remaining_years', label: 'Rem. yrs', align: 'right', format: F.n1 },
          { key: 'exposure_m', label: `Exposure ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
          { key: 'drawn_m', label: `Drawn ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
          { key: 'drawn_pct', label: 'Drawn %', align: 'right', format: (v) => F.pct(v, 0) },
          { key: 'total_nominal_m', label: `All investors ${ccy}m`, align: 'right', format: F.m, total: 'sum', title: 'Total nominal across every investor column' },
          { key: 'group_nominal_m', label: `${L} attributed ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
          { key: 'third_party_nominal_m', label: `Third party ${ccy}m`, align: 'right', format: F.m, total: 'sum' },
          { key: 'margin_bps', label: 'Spread', align: 'right', format: (v) => (U.isNum(v) ? F.int(v) : '–') },
          { key: 'watchlist', label: 'Watchlist', html: (r) => (r.watchlist && r.watchlist !== 'No' ? `<span class="badge badge-warn">${U.escapeHtml(r.watchlist)}</span>` : '<span class="muted">No</span>') },
        ] });
      }
      /** Create the grid once and then only swap its rows, so column layout, sort and scroll survive filter changes. */
      function renderGrid() {
        if (hasGrid) {
          if (!grid) { try { grid = buildGrid(); gridSection.appendChild(grid); return; } catch (e) { console.error(e); grid = null; } }
          else { grid.setRows(rows); return; }
        }
        gridSection.innerHTML = ''; gridSection.appendChild(buildTable());
      }

      // ---------- refresh (local, no Scope.app.render) ----------
      /** Recompute the filtered view and redraw everything that depends on it. */
      function refresh() {
        if (writeThrough()) return; // the global change re-renders every page, this one included
        compute(); renderBar(); renderKpis(); renderCharts(); renderBreakdown(); renderGrid();
      }
      refresh();

      // Cleanup when the app leaves or re-renders the page: drop the capture listener, destroy the grid.
      return () => { el.removeEventListener('click', modListener, true); if (grid && typeof grid.destroy === 'function') grid.destroy(); };
    },
  });
})(window);
