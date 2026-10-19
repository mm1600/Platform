/* Scope · report widgets (js/report/widgets.js): the building blocks of a custom pack.
 *
 * A widget is a small object { id, type, x, y, w, h, opts } placed on a 24 × 12 grid that covers the body of a page
 * (under the title and message, above the source line). The pack designer (js/modules/layer3-designer.js) lets the
 * user drag them about on a web mock-up of the page; this file turns each one into content (numbers, categories,
 * table rows: the same figures every page shows) and writes that content to a PowerPoint page with the house kit
 * (js/report/house.js). Pure JavaScript, no DOM: the content and the deck are built the same way in Node (tests).
 *
 *   Scope.report.widgets.TYPES            the catalogue: label, default size, options
 *   Scope.report.widgets.content(w, ctx)  → { kind: 'kpi' | 'chart' | 'table' | 'text' | 'card', … }
 *   Scope.report.widgets.toPptx(s, K, box, content)
 *   Scope.report.custom({ res, prev, layout, template, templateText }) → { deck, outline, filename }
 *   Scope.report.widgets.standardLayout(ctx) → the standard pack as a layout to start from
 */
(function (global) {
  'use strict';
  const Scope = (global.Scope = global.Scope || {});
  const R = (Scope.report = Scope.report || {});
  const U = Scope.util;
  const W = (R.widgets = {});

  // ---------- the grid: 24 columns × 12 rows over the body of a 13.333 × 7.5 in page ----------
  W.GRID = { cols: 24, rows: 12, x0: 0.5, y0: 1.45, w: 12.333, h: 5.5 };
  /** Inches of a widget's box on the page. */
  W.box = (w) => { const G = W.GRID, cw = G.w / G.cols, rh = G.h / G.rows; return { x: G.x0 + w.x * cw, y: G.y0 + w.y * rh, w: w.w * cw, h: w.h * rh }; };
  /** Clamp a widget to the grid (and to its type's minimum size). */
  W.clamp = (w) => { const G = W.GRID, t = W.TYPES[w.type] || W.TYPES.text; w.w = Math.max(t.min[0], Math.min(G.cols, Math.round(w.w))); w.h = Math.max(t.min[1], Math.min(G.rows, Math.round(w.h))); w.x = Math.max(0, Math.min(G.cols - w.w, Math.round(w.x))); w.y = Math.max(0, Math.min(G.rows - w.h, Math.round(w.y))); return w; };

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const nf = (d) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF0 = nf(0), NF1 = nf(1);
  const m1 = (v) => (isNum(v) ? NF1.format(v) : '–');
  const pct = (v, d) => (isNum(v) ? (d === 0 ? NF0 : NF1).format(v * 100) + '%' : '–');
  const yrs = (v) => (isNum(v) ? NF1.format(v) + ' y' : '–');
  const bps = (v) => (isNum(v) ? NF0.format(v) + ' bps' : '–');
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const cut = (s, n) => (str(s).length > n ? str(s).slice(0, n - 1) + '…' : str(s));
  const dmy = (d) => (d instanceof Date && !isNaN(d) ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '–');
  const signed = (v, f) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v)) : '–');

  // ---------- metrics a KPI tile can show ----------
  W.METRICS = [
    { id: 'total_exposure_m', label: 'Exposure', fmt: (v, c) => m1(v), sub: (M, c) => `${NF0.format(M.n_assets || 0)} assets` },
    { id: 'total_drawn_m', label: 'Drawn', fmt: (v) => m1(v), sub: (M) => `${pct(M.drawn_pct, 0)} of exposure` },
    { id: 'total_undrawn_m', label: 'Undrawn', fmt: (v) => m1(v), sub: (M) => `${pct(isNum(M.drawn_pct) ? 1 - M.drawn_pct : NaN, 0)} of exposure` },
    { id: 'total_commitment_m', label: 'Commitment', fmt: (v) => m1(v), sub: () => '' },
    { id: 'n_assets', label: 'Assets', fmt: (v) => NF0.format(v || 0), sub: (M) => `${NF0.format(M.n_positions || 0)} positions` },
    { id: 'w_rating_label', label: 'Weighted rating', fmt: (v) => v || '–', sub: (M) => `sub-IG ${pct(M.sub_ig_share, 0)} · NR ${pct(M.nr_share, 0)}` },
    { id: 'w_remaining_years', label: 'Remaining life', fmt: (v) => yrs(v), sub: (M) => `WAL ${yrs(M.w_wal_years)}` },
    { id: 'w_wal_years', label: 'Weighted WAL', fmt: (v) => yrs(v), sub: (M) => `remaining life ${yrs(M.w_remaining_years)}` },
    { id: 'w_margin_bps', label: 'Weighted spread', fmt: (v) => bps(v), sub: (M) => `fixed rate ${pct(M.fixed_share, 0)}` },
    { id: 'ig_share', label: 'Investment grade', fmt: (v, c, M) => pct(1 - (M.sub_ig_share || 0) - (M.nr_share || 0), 0), sub: (M) => `not rated ${pct(M.nr_share, 0)}` },
    { id: 'sub_ig_share', label: 'Sub-investment grade', fmt: (v) => pct(v, 0), sub: () => 'share of exposure' },
    { id: 'nr_share', label: 'Not rated', fmt: (v) => pct(v, 0), sub: () => 'share of exposure' },
    { id: 'fixed_share', label: 'Fixed rate', fmt: (v) => pct(v, 0), sub: () => 'share of exposure' },
    { id: 'watchlist_share', label: 'On watchlist', fmt: (v) => pct(v, 0), sub: () => 'share of exposure' },
    { id: 'w_esg_score', label: 'ESG score', fmt: (v) => (isNum(v) ? NF1.format(v) : '–'), sub: (M) => `coverage ${pct(M.esg_coverage, 0)}` },
    { id: 'book_group_m', label: 'Group attributed', fmt: (v) => m1(v), sub: (M) => `${pct(M.group_share_of_book, 0)} of the book` },
    { id: 'book_third_party_m', label: 'Other investors', fmt: (v) => m1(v), sub: (M) => `${pct(isNum(M.group_share_of_book) ? 1 - M.group_share_of_book : NaN, 0)} of the book` },
    { id: 'book_total_m', label: 'Whole book', fmt: (v) => m1(v), sub: () => 'every investor column' },
  ];
  /** Dimensions a chart or table can show (label, and the distribution key). */
  W.DIMENSIONS = () => Object.entries((Scope.calc && Scope.calc.aum && Scope.calc.aum.DIMENSIONS) || {}).map(([k, v]) => [k, v.label]).concat([['group_split', 'Group vs other investors']]);
  /** Columns an asset table can show. */
  W.ASSET_COLUMNS = [
    ['rank', '#', 'right', (r) => String(r.rank)], ['name', 'Asset', 'left', (r) => cut(r.name, 38)], ['sector', 'Sector', 'left', (r) => cut(r.sector, 22)], ['subsector', 'Subsector', 'left', (r) => cut(r.subsector, 22)],
    ['country', 'Country', 'left', (r) => cut(r.country, 16)], ['region', 'Region', 'left', (r) => cut(r.region, 16)], ['currency', 'Ccy', 'left', (r) => str(r.currency)],
    ['rating', 'Rating', 'left', (r) => (r.rating_status === 'rated' ? r.rating : 'NR')], ['ig_label', 'IG', 'left', (r) => (r.rating_status === 'rated' ? r.ig_label : 'NR')],
    ['maturity_date', 'Maturity', 'left', (r) => dmy(r.maturity_date)], ['remaining_years', 'Years left', 'right', (r) => yrs(r.remaining_years)], ['margin_bps', 'Spread (bps)', 'right', (r) => (isNum(r.margin_bps) ? NF0.format(r.margin_bps) : '–')],
    ['fixed_floating', 'Rate', 'left', (r) => str(r.fixed_floating)], ['exposure_m', 'Exposure', 'right', (r) => m1(r.exposure_m)], ['drawn_m', 'Drawn', 'right', (r) => m1(r.drawn_m)], ['undrawn_m', 'Undrawn', 'right', (r) => m1(r.undrawn_m)],
    ['commitment_m', 'Commitment', 'right', (r) => m1(r.commitment_m)], ['share', 'Share', 'right', (r, c) => pct(c.M.total_exposure_m ? r.exposure_m / c.M.total_exposure_m : NaN)],
    ['sponsor', 'Sponsor', 'left', (r) => cut(r.sponsor, 22)], ['watchlist', 'Watchlist', 'left', (r) => str(r.watchlist)], ['covenant_compliance', 'Covenants', 'left', (r) => str(r.covenant_compliance)],
    ['esg_score', 'ESG', 'right', (r) => (isNum(r.esg_score) ? NF1.format(r.esg_score) : '–')], ['deal_year', 'Deal year', 'left', (r) => str(r.deal_year)], ['greenfield_brownfield', 'Green / brown', 'left', (r) => str(r.greenfield_brownfield)],
  ];
  /** Details an asset card can show. */
  W.ASSET_DETAILS = [['sector', 'Sector'], ['subsector', 'Subsector'], ['country', 'Country'], ['region', 'Region'], ['sponsor', 'Sponsor'], ['currency', 'Currency'], ['rating', 'Rating'], ['ig_label', 'IG'], ['internal_grade', 'Internal rating'], ['external_grade', 'External rating'],
    ['maturity_date', 'Maturity'], ['remaining_years', 'Years to maturity'], ['wal_years', 'WAL'], ['margin_bps', 'Spread'], ['fixed_floating', 'Rate type'], ['repayment_type', 'Repayment'], ['instrument', 'Instrument'], ['deal_year', 'Deal year'],
    ['exposure_m', 'Exposure in the view'], ['drawn_m', 'Drawn'], ['undrawn_m', 'Undrawn'], ['commitment_m', 'Commitment'], ['total_nominal_m', 'Whole book'], ['group_nominal_m', 'Group attributed'], ['watchlist', 'Watchlist'], ['covenant_compliance', 'Covenants'], ['esg_score', 'ESG score'], ['greenfield_brownfield', 'Greenfield / brownfield']];
  const detail = (r, k) => { const v = r[k]; if (k === 'maturity_date') return dmy(v); if (/_m$/.test(k)) return m1(v) + ' m'; if (k === 'remaining_years' || k === 'wal_years') return yrs(v); if (k === 'margin_bps') return bps(v); if (k === 'esg_score') return isNum(v) ? NF1.format(v) : '–'; if (k === 'rating') return r.rating_status === 'rated' ? r.rating : 'NR'; return str(v) || '–'; };

  // ---------- the catalogue ----------
  W.TYPES = {
    kpi: { label: 'KPI tile', help: 'one figure of the view', size: [6, 3], min: [4, 2], opts: { metric: 'total_exposure_m' } },
    chart: { label: 'Chart', help: 'exposure by a dimension', size: [12, 7], min: [6, 4], opts: { dim: 'sector', type: 'bar', top: 8, title: '' } },
    table: { label: 'Breakdown table', help: 'a dimension with amounts and shares', size: [8, 6], min: [5, 3], opts: { dim: 'country', top: 8, title: '' } },
    assets: { label: 'Asset table', help: 'the largest assets, chosen columns', size: [24, 7], min: [8, 3], opts: { top: 10, columns: ['rank', 'name', 'sector', 'country', 'rating', 'maturity_date', 'exposure_m', 'drawn_m', 'share'], title: '' } },
    asset: { label: 'Asset card', help: 'one asset and its details', size: [8, 6], min: [5, 3], opts: { code: '', details: ['sector', 'country', 'sponsor', 'rating', 'maturity_date', 'margin_bps', 'exposure_m', 'drawn_m', 'watchlist'], title: '' } },
    investors: { label: 'Investor table', help: 'investor columns of the view with their amounts', size: [12, 7], min: [6, 3], opts: { top: 12, title: '' } },
    group: { label: 'Group split', help: 'group attributed vs other investors', size: [8, 6], min: [5, 4], opts: { type: 'doughnut' } },
    changes: { label: 'Changes', help: 'largest movements since the previous Holdings', size: [12, 7], min: [6, 3], opts: { top: 8, title: '' } },
    text: { label: 'Text', help: 'your own words', size: [12, 3], min: [4, 1], opts: { text: 'Your text here.', title: '' } },
    notes: { label: 'Notes and sources', help: 'how the view, data, FX and ratings are defined', size: [24, 10], min: [10, 4], opts: {} },
  };
  let seq = 0;
  /** A new widget of a type at a grid position (clamped), with the type's defaults. */
  W.create = (type, x, y) => { const t = W.TYPES[type] || W.TYPES.text; return W.clamp({ id: 'w' + Date.now().toString(36) + (seq++).toString(36), type, x: x || 0, y: y || 0, w: t.size[0], h: t.size[1], opts: JSON.parse(JSON.stringify(t.opts)) }); };

  // ---------- context of a result ----------
  W.context = (res, prev, style) => ({ res, prev: prev || null, C: R.palette(style), S: R.seriesOf(R.palette(style)), M: res.metrics || {}, PM: prev ? prev.metrics || {} : {}, D: res.distributions || {}, rows: res.rows || [], ccy: res.displayCurrency || 'EUR', attr: (res.config && res.config.attribution_label) || 'Group', view: (res.platform && res.platform.label) || 'Portfolio' });

  /** Top n of a distribution plus one "Other" bucket. */
  const topN = (dist, n) => { const list = (dist || []).filter((d) => d.exposure_m > 0); if (!n || list.length <= n) return list; const head = list.slice(0, n - 1), rest = list.slice(n - 1); return head.concat([{ label: `Other (${rest.length})`, exposure_m: rest.reduce((s, d) => s + d.exposure_m, 0), share: rest.reduce((s, d) => s + d.share, 0) }]); };
  const dimLabel = (k) => (W.DIMENSIONS().find((d) => d[0] === k) || [k, k])[1];

  // ---------- content: the figures a widget shows ----------
  W.content = function (w, c) {
    const o = w.opts || {}, M = c.M, D = c.D, S = c.S || R.SERIES, PAL = c.C || R.PALETTE;
    switch (w.type) {
      case 'kpi': {
        const m = W.METRICS.find((x) => x.id === o.metric) || W.METRICS[0];
        const prevV = c.prev && isNum(c.PM[m.id]) && isNum(M[m.id]) && c.PM[m.id] !== 0 ? (M[m.id] - c.PM[m.id]) / Math.abs(c.PM[m.id]) : NaN;
        const sub = c.prev && isNum(prevV) && /_m$/.test(m.id) ? `${signed(prevV, (v) => NF1.format(v * 100))}% vs previous` : m.sub(M, c);
        return { kind: 'kpi', label: m.label, value: m.fmt(M[m.id], c, M), sub, subColor: c.prev && isNum(prevV) && /_m$/.test(m.id) ? (prevV >= 0 ? PAL.green : PAL.red) : null };
      }
      case 'chart': {
        const items = topN(D[o.dim] || [], o.top), label = dimLabel(o.dim);
        if (o.type === 'doughnut') return { kind: 'chart', type: 'doughnut', title: o.title || label, categories: items.map((d) => d.label), series: [{ name: 'Exposure', values: items.map((d) => d.exposure_m) }], colors: S, caption: `exposure by ${label.toLowerCase()}` };
        return { kind: 'chart', type: o.type === 'col' ? 'col' : 'bar', title: o.title || `${label} · ${c.ccy} m`, categories: items.map((d) => d.label), series: [{ name: `Exposure (${c.ccy} m)`, values: items.map((d) => d.exposure_m), color: S[0] }], caption: `exposure by ${label.toLowerCase()}${o.top && items.length >= o.top ? `, top ${o.top} with the rest grouped` : ''}` };
      }
      case 'table': {
        const items = topN(D[o.dim] || [], o.top), label = dimLabel(o.dim);
        return { kind: 'table', title: o.title || label, head: [label, `${c.ccy} m`, 'Share'], align: ['left', 'right', 'right'], widths: [0.5, 0.28, 0.22], rows: items.map((d) => [d.label, m1(d.exposure_m), pct(d.share)]) };
      }
      case 'assets': {
        const cols = (o.columns || []).map((k) => W.ASSET_COLUMNS.find((x) => x[0] === k)).filter(Boolean);
        const list = c.rows.slice(0, o.top || 10);
        const wts = cols.map((x) => (x[0] === 'name' ? 3 : x[0] === 'rank' ? 0.5 : /sector|subsector|sponsor/.test(x[0]) ? 1.8 : /country|region|maturity|watchlist|covenant/.test(x[0]) ? 1.4 : 1)); const tot = wts.reduce((a, b) => a + b, 0);
        return { kind: 'table', title: o.title || `${list.length === c.rows.length ? 'All' : 'Largest'} ${list.length} assets · ${c.ccy} m`, head: cols.map((x) => x[1]), align: cols.map((x) => x[2]), widths: wts.map((v) => v / tot), rows: list.map((r) => cols.map((x) => x[3](r, c))) };
      }
      case 'asset': {
        const r = c.rows.find((x) => x.code === o.code) || c.rows[0];
        if (!r) return { kind: 'text', title: o.title || 'Asset', paras: [{ text: 'No asset in the view.' }] };
        const items = (o.details || []).map((k) => { const d = W.ASSET_DETAILS.find((x) => x[0] === k); return d ? [d[1], detail(r, k)] : null; }).filter(Boolean);
        return { kind: 'card', title: o.title || r.name, items };
      }
      case 'investors': {
        const inv = (c.res.investors || []).filter((i) => i.selected_nominal_m > 0).sort((a, b) => b.selected_nominal_m - a.selected_nominal_m).slice(0, o.top || 12);
        const tot = inv.reduce((s, i) => s + i.selected_nominal_m, 0);
        return { kind: 'table', title: o.title || `Investor columns in the view · ${c.ccy} m`, head: ['Investor', 'Type', `${c.ccy} m`, 'Drawn', 'Share'], align: ['left', 'left', 'right', 'right', 'right'], widths: [0.34, 0.2, 0.16, 0.15, 0.15], rows: inv.map((i) => [i.label, i.group || '', m1(i.selected_nominal_m), m1(i.selected_drawn_m), pct(tot ? i.selected_nominal_m / tot : NaN)]) };
      }
      case 'group': {
        const g = D.group_split || [];
        return { kind: 'chart', type: o.type === 'bar' ? 'bar' : 'doughnut', title: `${c.attr} attributed vs other investors`, categories: g.map((d) => d.label), series: [{ name: 'Nominal', values: g.map((d) => d.value || 0), color: S[0] }], colors: [S[0], S[2]], caption: `${c.attr} attributed share of the whole book` };
      }
      case 'changes': {
        if (!c.prev) return { kind: 'text', title: o.title || 'Changes since the previous Holdings', paras: [{ text: 'No previous Holdings sheet is loaded, so there is nothing to compare yet (Data › Setup › Load › Monthly update).' }] };
        const before = new Map((c.prev.rows || []).map((r) => [r.code, r]));
        const movers = c.rows.filter((r) => before.has(r.code)).map((r) => ({ r, d: r.exposure_m - before.get(r.code).exposure_m, b: before.get(r.code).exposure_m })).filter((x) => Math.abs(x.d) > 1e-9).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, o.top || 8);
        return { kind: 'table', title: o.title || `Largest movements · ${c.ccy} m`, head: ['Asset', 'Previous', 'Current', 'Change'], align: ['left', 'right', 'right', 'right'], widths: [0.46, 0.18, 0.18, 0.18], rows: movers.length ? movers.map((x) => [cut(x.r.name, 40), m1(x.b), m1(x.r.exposure_m), { text: signed(x.d, m1), color: x.d >= 0 ? PAL.green : PAL.red }]) : [['No change in existing assets', '', '', '']] };
      }
      case 'notes': {
        const res = c.res, def = ((res.inputs && res.inputs.views) || []).find((v) => v.view === (res.platform && res.platform.id));
        const how = !def ? '' : def.def === '*' ? 'every investor column' : def.def === 'group' ? `the ${c.attr} ownership of each investor column` : def.kind === 'investor column' ? `the investor column ${c.view}` : def.formula || '';
        const fx = ((res.inputs && res.inputs.fx && res.inputs.fx.table) || []).filter((x) => x.currency !== 'EUR').map((x) => `${x.currency} ${isNum(x.perEur) ? String(+x.perEur.toFixed(4)) : '–'} per EUR`);
        const st = res.stats || {};
        return { kind: 'text', title: '', paras: [
          { runs: [{ text: 'View. ', bold: true }, { text: `${c.view}${how ? ' = ' + how : ''}.` }], bullet: true, spaceAfter: 6 },
          { runs: [{ text: 'Data. ', bold: true }, { text: `Holdings as of ${dmy(res.reportingDate)} (${NF0.format(st.positions || 0)} positions, ${NF0.format(st.excluded || 0)} excluded with a reason on Data › Issues), Mapping, Hardcoded and ESG Hardcoded.` }], bullet: true, spaceAfter: 6 },
          { runs: [{ text: 'Amounts. ', bold: true }, { text: `Nominal in ${c.ccy} millions; drawn and commitment as reported in Holdings; exposure of a view = Σ coefficient × investor column, as in the workbook's Calculations sheet.` }], bullet: true, spaceAfter: 6 },
          { runs: [{ text: 'FX. ', bold: true }, { text: fx.length ? fx.join(' · ') + '.' : 'All positions in EUR.' }], bullet: true, spaceAfter: 6 },
          { runs: [{ text: 'Ratings. ', bold: true }, { text: `Current rating = internal rating, else the worst external rating; weighted by exposure on the workbook's numeric scale; sub-IG above ${(res.config && res.config.ig_threshold) || ''}.` }], bullet: true, spaceAfter: 6 },
          { runs: [{ text: 'Filters. ', bold: true }, { text: (res.globalFilters || []).length ? `${res.globalFilters.length} global filter(s) were applied when this deck was made.` : 'None: the whole view.' }], bullet: true },
        ] };
      }
      default: {
        const lines = str(o.text).split('\n').filter((x) => x.trim() !== '');
        return { kind: 'text', title: o.title || '', paras: lines.map((t) => ({ text: t, spaceAfter: 4 })) };
      }
    }
  };

  // ---------- content → a PowerPoint page ----------
  /** Draw a content object in a box (inches) on slide s with the house kit K. */
  W.toPptx = function (s, K, box, content) {
    const { x, y, w, h } = box;
    if (content.kind === 'kpi') { K.tile(s, x, y, w, h, content.label, content.value, content.sub, content.subColor); return; }
    let top = y;
    if (content.title) { K.sectionTitle(s, x, top, w, content.title); top += 0.4; }
    if (content.kind === 'chart') {
      const capH = 0.28, ch = Math.max(0.6, y + h - top - capH);
      s.chart({ x, y: top, w, h: ch, type: content.type, categories: content.categories, series: content.series, colors: content.colors, legend: content.type === 'doughnut' ? 'r' : undefined });
      K.caption(s, x, y + h - capH + 0.02, w, content.caption || content.title || '');
      return;
    }
    if (content.kind === 'table') {
      const rowH = 0.27, maxRows = Math.max(1, Math.floor((y + h - top) / rowH) - 1);
      const rows = content.rows.slice(0, maxRows);
      const widths = content.widths || content.head.map(() => 1 / content.head.length);
      K.table(s, { x, y: top, colW: widths.map((f) => +(f * w).toFixed(3)), rowH, align: content.align, rows: [content.head].concat(rows) });
      if (content.rows.length > rows.length) s.text({ x, y: y + h - 0.24, w, h: 0.22, text: `+ ${content.rows.length - rows.length} more`, size: 8, color: K.T.muted, inset: 0 });
      return;
    }
    if (content.kind === 'card') {
      const rowH = 0.27, maxRows = Math.max(1, Math.floor((y + h - top) / rowH));
      K.table(s, { x, y: top, colW: [+(w * 0.4).toFixed(3), +(w * 0.6).toFixed(3)], rowH, header: false, align: ['left', 'left'], rows: content.items.slice(0, maxRows).map(([k, v]) => [{ text: k, bold: true }, v]) });
      return;
    }
    s.text({ x, y: top, w, h: Math.max(0.3, y + h - top), size: 11, color: K.T.text, valign: 'top', paras: content.paras });
  };

  // ---------- a whole custom deck ----------
  /**
   * Scope.report.custom({ res, prev, layout, template, templateText }) → { deck, outline, filename }
   * layout = { name, slides: [{ title, message, cover, widgets: [widget] }] }.
   */
  R.custom = function (opts) {
    const res = opts.res, layout = opts.layout || { slides: [] }, prev = opts.prev || null;
    const c = W.context(res, prev, opts.style);
    const quarter = res.quarter || '', asOf = dmy(res.reportingDate);
    const deck = Scope.pptx.deck({ title: `${c.view} · ${layout.name || 'custom pack'} · ${quarter}`, template: opts.template || null, font: opts.style && opts.style.font });
    const K = R.houseKit(deck, { view: c.view, quarter, ccy: c.ccy, asOf, filtered: (res.globalFilters || []).length, light: opts.templateText === 'light', style: opts.style });
    for (const sl of layout.slides || []) {
      const s = sl.cover ? K.blank(sl.title || 'Cover') : K.frame(sl.title || '', sl.message || '');
      if (sl.cover) {
        s.text({ x: K.X0, y: 0.9, w: K.CW, h: 0.45, text: sl.message || 'Quarterly report', size: 14, color: K.T.green, bold: true, inset: 0 });
        s.text({ x: K.X0, y: 1.35, w: K.CW, h: 1.0, text: sl.title || c.view, size: 36, bold: true, color: K.T.text, inset: 0, valign: 'middle' });
        s.text({ x: K.X0, y: 2.4, w: K.CW, h: 0.45, text: `${quarter} · reporting date ${asOf} · amounts in ${c.ccy} millions`, size: 14, color: K.T.label, inset: 0 });
        s.line({ x1: K.X0, y1: 3.1, x2: K.WD - K.X0, y2: 3.1, color: K.T.rule, w: 0.75 });
      }
      for (const w of sl.widgets || []) {
        try { W.toPptx(s, K, W.box(W.clamp(Object.assign({}, w))), W.content(w, c)); }
        catch (e) { s.text({ x: K.X0, y: 1.6, w: K.CW, h: 0.4, text: `${(W.TYPES[w.type] || {}).label || w.type}: ${(e && e.message) || e}`, size: 9, color: K.C.red, inset: 0 }); }
      }
    }
    const safe = (t) => String(t).replace(/[^A-Za-z0-9 ._-]+/g, ' ').trim().replace(/\s+/g, '-');
    return { deck, outline: K.outline, filename: `${safe(c.view)}-${safe(layout.name || 'custom-pack')}-${safe(quarter || U.isoDate(res.reportingDate))}.pptx` };
  };

  /** The standard pack as a layout to start from. */
  W.standardLayout = function () {
    const mk = (type, x, y, w, h, opts) => W.clamp(Object.assign(W.create(type, 0, 0), { x, y, w, h }, opts ? { opts: Object.assign({}, W.TYPES[type].opts, opts) } : {}));
    return { name: 'Standard pack', slides: [
      { title: '', message: 'Quarterly report', cover: true, widgets: [mk('kpi', 0, 6, 6, 3, { metric: 'total_exposure_m' }), mk('kpi', 6, 6, 6, 3, { metric: 'total_drawn_m' }), mk('kpi', 12, 6, 6, 3, { metric: 'w_rating_label' }), mk('kpi', 18, 6, 6, 3, { metric: 'w_remaining_years' })] },
      { title: 'Key figures', message: '', widgets: [mk('kpi', 0, 0, 6, 3, { metric: 'total_exposure_m' }), mk('kpi', 6, 0, 6, 3, { metric: 'total_drawn_m' }), mk('kpi', 12, 0, 6, 3, { metric: 'total_undrawn_m' }), mk('kpi', 18, 0, 6, 3, { metric: 'total_commitment_m' }),
        mk('kpi', 0, 3, 6, 3, { metric: 'n_assets' }), mk('kpi', 6, 3, 6, 3, { metric: 'w_rating_label' }), mk('kpi', 12, 3, 6, 3, { metric: 'w_remaining_years' }), mk('kpi', 18, 3, 6, 3, { metric: 'w_margin_bps' }),
        mk('chart', 0, 6, 8, 6, { dim: 'fixed_floating', type: 'doughnut', top: 0, title: 'Fixed and floating' }), mk('group', 8, 6, 8, 6), mk('table', 16, 6, 8, 6, { dim: 'currency', top: 6, title: 'Currency' })] },
      { title: 'Exposure by sector and country', message: '', widgets: [mk('chart', 0, 0, 12, 12, { dim: 'sector', type: 'bar', top: 8 }), mk('chart', 12, 0, 12, 12, { dim: 'country', type: 'bar', top: 8 })] },
      { title: 'Credit quality', message: '', widgets: [mk('chart', 0, 0, 15, 12, { dim: 'rating', type: 'col', top: 0 }), mk('chart', 15, 0, 9, 7, { dim: 'ig', type: 'doughnut', top: 0, title: 'Investment grade split' }), mk('table', 15, 7, 9, 5, { dim: 'ig', top: 0, title: 'Band' })] },
      { title: 'Maturity profile', message: '', widgets: [mk('chart', 0, 0, 15, 12, { dim: 'maturity_bucket', type: 'col', top: 0 }), mk('table', 15, 0, 9, 12, { dim: 'maturity_bucket', top: 0, title: 'Bucket' })] },
      { title: 'Top 10 assets', message: '', widgets: [mk('assets', 0, 0, 24, 12, { top: 10 })] },
      { title: 'Changes since the previous Holdings', message: '', widgets: [mk('changes', 0, 0, 24, 12, { top: 8 })] },
      { title: 'Watchlist and covenants', message: '', widgets: [mk('table', 0, 0, 12, 12, { dim: 'watchlist', top: 0, title: 'Watchlist' }), mk('chart', 12, 0, 12, 12, { dim: 'covenant_compliance', type: 'bar', top: 0 })] },
      { title: 'Notes and sources', message: '', widgets: [mk('notes', 0, 0, 24, 12)] },
    ] };
  };
})(typeof window !== 'undefined' ? window : globalThis);
