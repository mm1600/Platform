/* Scope · Investor report — the quarterly investor deck for one view, laid out like the house's own investor report and
 * built on the user's template (its cover, section break and content slides; Scope fills the slots marked "x").
 *
 * Scope.report.investor({ res, prev, template, style, inputs }) → { deck, outline, filename }
 *   res      the AUM result of the selected view and currency (global filters applied)
 *   prev     optional: the result for the previous Holdings sheet, for the quarter-on-quarter figures and rating changes
 *   inputs   { coverName, compartment, mandate_m, repaid_m, sourceLine ("{date}" = the reporting date),
 *              market: { series: [{ name, points: [[excel serial, bps]] }] }   public-market spread curves (first = BBB, second = BB)
 *              monitoring: [{ ref, name, description, metrics: [{ label, actual, lockup, covenant }], rating, events: [] }] }
 * Sections: 01 market activity (two pages left blank for the market commentary) · 02 portfolio overview (key figures and
 * splits, sectors and jurisdictions, assets under management) · 03 portfolio metrics (spreads by sector, relative value
 * against the public-market curves, two blank pages for the cashflow and yield projections, the asset and performance
 * table) · 04 pipeline (transaction pipeline and guidelines left blank) · 05 appendix (portfolio monitoring, one page per
 * asset, from the monitoring workbook). Every figure comes from the result object. No DOM; runs in Node.
 *
 * Scope.report.parseMonitoring(rows) and Scope.report.parseMarket(rows | text) read the two optional inputs.
 */
(function (global) {
  'use strict';
  const Scope = (global.Scope = global.Scope || {});
  const R = (Scope.report = Scope.report || {});
  const U = Scope.util;

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const nf = (d) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF0 = nf(0), NF1 = nf(1);
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const okDate = (d) => d instanceof Date && !isNaN(d);
  const monthYear = (d) => (okDate(d) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '');
  const longDate = (d) => (okDate(d) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '');
  const serial = (d) => (okDate(d) ? Math.round((d - Date.UTC(1899, 11, 30)) / 86400000) : NaN);
  const SYM = { EUR: '€', GBP: '£', USD: '$', JPY: '¥' };
  const pct0 = (v) => (isNum(v) ? NF0.format(v * 100) + '%' : '–');

  // ---------- colours: shades of the palette, label colour by background ----------
  const rgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const toHex = (a) => a.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
  /** t > 0 mixes with white, t < 0 with black. */
  const shade = (h, t) => toHex(rgb(h).map((c) => (t >= 0 ? c + (255 - c) * t : c * (1 + t))));
  const lum = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const inkOn = (h, C) => (lum(h) > 0.8 ? C.text : 'FFFFFF');

  /** Exposure by a key, largest first, or in `order` (a list of labels, or label → rank) with the rest after it largest first; zero buckets left out. */
  function dist(rows, key, order) {
    const m = new Map(); for (const r of rows) { const k = str(key(r)) || 'Not set'; m.set(k, (m.get(k) || 0) + (r.exposure_m || 0)); }
    return ordered(Array.from(m, ([label, v]) => ({ label, v })).filter((d) => d.v > 0), order);
  }
  function ordered(list, order) {
    const rank = typeof order === 'function' ? order : order ? (l) => order.indexOf(l) + 1 || 99 : () => 0;
    return list.sort((a, b) => rank(a.label) - rank(b.label) || b.v - a.v);
  }

  // The workbook's Quarterly Reporting sheet builds each split from a fixed list, and the house deck shows the slices in that
  // order, clockwise from 12 o'clock. Labels match without case, spacing or plurals ("Fibre" = "Fiber", "Amortising" =
  // "Amortizing"; Digital is Telecom); anything not listed comes after, largest first.
  const keyOf = (s) => str(s).toLowerCase().replace(/&/g, 'and').replace(/fibre/g, 'fiber').replace(/centre/g, 'center').replace(/[^a-z0-9]/g, '');
  const rankIn = (list) => { const keys = list.map((e) => [].concat(e).map(keyOf)); return (label) => { const k = keyOf(label), i = keys.findIndex((es) => es.some((e) => k.startsWith(e))); return i < 0 ? 99 : i; }; };
  const ORDER = {
    currency: rankIn(['EUR', 'GBP', 'SEK', 'DKK', 'NOK', 'JPY']),
    repayment: rankIn(['Bullet', 'Amorti']),
    wal: ['< 5', '5 - 10', '10 - 15', '15 - 20', '> 20', 'n/a'],
    cashflow: rankIn(['PPP', 'Regulated', 'Contracted', 'Concession', 'Merchant']),
    sector: rankIn(['Energy', 'Renewable', 'Transport', ['Telecom', 'Digital'], 'Utilit', 'Social']),
    // subsectors: the house list, and the list of an investor's own classification (a report that picks one, res.sectorSource)
    subsector: rankIn(['Energy storage', 'Diversified renewable', 'Onshore wind', 'Offshore wind', 'Mixed wind', 'Solar', 'Road', 'Airport', 'Port', 'Rosco', 'Rail', 'Ferr',
      'Telecom tower', 'Fiber', 'Data center', 'Electricity network', 'Water', 'Regulated gas', 'Waste', 'Heating', 'Government', 'Education', 'Health']),
    ownSubsector: rankIn(['Electricity network', 'Water', 'Regulated gas', 'Power generation', 'Renewable power', 'Environmental', 'Road', 'Airport', 'Rail', 'Rosco', 'Port',
      'Telecom tower', 'Fiber', 'Data center', 'Government']),
  };
  // A report on a client's own classification without the client's own subsector column: the Holdings subsector put into the
  // client's list as its reporting sheet and deck show it, under the client's sector of the asset. Renewables are all
  // "Renewable power" (but waste), Social all "Government Services"; networks keep their kind and any other energy is
  // "Power generation"; transport and telecom keep their kind; a subsector the list has no row for keeps its name.
  const OWN_SUBSECTORS = [
    { sector: ['energy'], subs: [[['electric', 'grid', 'transmission'], 'Electricity networks'], [['water'], 'Water'], [['gas', 'heat', 'cool'], 'Regulated gas networks'],
      [['power', 'generation', 'storage', 'battery', 'thermal', 'plant', 'renewab', 'wind', 'solar', 'hydro'], 'Power generation']] },
    { sector: ['renewab'], subs: [[['waste', 'environment', 'recycl'], 'Environmental & Waste']], other: 'Renewable power' },
    { sector: ['transport'], subs: [[['road', 'motorway', 'highway'], 'Roads'], [['airport'], 'Airports'], [['rosco', 'rollingstock'], 'Rosco'], [['rail'], 'Rail'], [['port', 'harbo'], 'Ports']] },
    { sector: ['telecom', 'digital'], subs: [[['tower'], 'Telecom towers'], [['fiber'], 'Fiber network'], [['datacenter'], 'Data center']] },
    { sector: ['social'], subs: [], other: 'Government Services' },
  ];
  // The client's own five sectors, as its deck's rings and bubbles name them (its asset table shows the column's own value, e.g.
  // "Renewables"): the client's value read by its first word, else (blank, or a sector the list has no row for, e.g. Utilities)
  // the Holdings sector and subsector put into the list: utility networks are Energy, waste is Renewables + Environmental & Waste.
  const OWN_SECTORS = [[['energy', 'oil', 'og'], 'Energy + O&G'], [['renewab', 'environment', 'waste'], 'Renewables + Environmental & Waste'], [['transport'], 'Transport'], [['telecom', 'digital'], 'Telecom'], [['social'], 'Social']];
  // The house six on the spread bubbles, in the workbook's bubble block order, each with the accent its chart gives it
  // (0-based into the theme accents), read from the first word of the sector ("Digital" is Telecoms)
  const BUBBLE_SECTORS = [[['energy', 'oil'], 'Energy', 1], [['renewab'], 'Renewable Power', 0], [['soci'], 'Social', 3], [['transport'], 'Transport', 2], [['telecom', 'digital'], 'Telecoms', 4], [['utilit'], 'Utilities', 5]];
  const bubbleSector = (v) => { const k = keyOf(v), hit = k && BUBBLE_SECTORS.find(([ws]) => ws.some((w) => k.startsWith(w))); return hit ? hit[1] : str(v); };
  const ownSectorOf = (v) => { const k = keyOf(v), hit = k && OWN_SECTORS.find(([ws]) => ws.some((w) => k.startsWith(w))); return hit ? hit[1] : ''; };
  const ownSector = (value, house, sub) => ownSectorOf(value)
    || (/^utilit/.test(keyOf(house)) ? (/waste|environment|recycl/.test(keyOf(sub)) ? 'Renewables + Environmental & Waste' : 'Energy + O&G') : ownSectorOf(house)) || str(value);
  const ownSubsector = (sector, sub) => {
    const sk = keyOf(sector), k = keyOf(sub), e = OWN_SUBSECTORS.find((x) => x.sector.some((p) => sk.startsWith(p)));
    const hit = e && e.subs.find(([words]) => words.some((w) => k.includes(w)));
    return hit ? hit[1] : e && e.other ? e.other : str(sub);
  };
  // the asset and performance table as the house shows it: "UK" as it is and every other country in proper case (Excel's
  // PROPER); a bond ("Infra Bond") as Bond and anything else as Loan; the internal rating (bold, blue) unless it is NR, else
  // the external one (the worst agency), as the house deck shows them
  const countryName = (c) => { const s = str(c); return /^uk$/i.test(s) ? 'UK' : s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); };
  const formatOf = (r) => (/\bbond\b/i.test(str(r.instrument)) ? 'Bond' : 'Loan');
  const isNR = (g) => !str(g) || /^n\.?r\.?$/i.test(str(g));
  const tableRating = (r) => (!isNR(r.internal_grade) ? { text: str(r.internal_grade), internal: true } : !isNR(r.external_grade) ? { text: str(r.external_grade), internal: false } : { text: 'NR', internal: false });
  /** Assets in deal order, as the Output lists them: the chronological order number, else the funding date, else the Output rank. */
  const dealOrder = (rows) => rows.slice().sort((a, b) => { const ca = isNum(a.chronological_order) ? a.chronological_order : Infinity, cb = isNum(b.chronological_order) ? b.chronological_order : Infinity; if (ca !== cb) return ca - cb; const fa = okDate(a.funding_date) ? +a.funding_date : Infinity, fb = okDate(b.funding_date) ? +b.funding_date : Infinity; return fa - fb || a.rank - b.rank; });

  /**
   * Pages the group's own reports carry, each ticked or not on the Investor reporting page: ticked by default for the group view
   * (the view Settings › Investors builds from group ownership), unticked for every other; a choice made is kept per view.
   */
  R.INVESTOR_EXTRAS = [['maturity', 'Spreads by maturity (bubbles)'], ['granularity', 'Portfolio granularity (aggregated credit exposure)'], ['allocation', 'Portfolio allocation by entity'], ['esg', 'ESG ratings'], ['prepayment', 'Prepayment protection']];
  R.extrasFor = (res, inputs) => { const on = !!(res && res.platform && res.platform.isGroup), own = (inputs && inputs.extras) || {}; return Object.fromEntries(R.INVESTOR_EXTRAS.map(([k]) => [k, typeof own[k] === 'boolean' ? own[k] : on])); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** A date as the house tables write it: 27-Sep-13. */
  const dmy = (d) => (okDate(d) ? `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}` : '');
  const toDate = (v) => { if (okDate(v)) return v; const t = str(v); if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null; const d = new Date(t.slice(0, 10) + 'T00:00:00Z'); return okDate(d) ? d : null; };

  R.investor = function (opts) {
    const res = opts.res, prev = opts.prev || null, inp = opts.inputs || {}, style = opts.style || null;
    const P = Scope.pptx;
    const M = res.metrics || {}, rows = res.rows || [], PM = prev ? prev.metrics || {} : null;
    const view = (res.platform && res.platform.label) || 'Portfolio';
    const ccy = res.displayCurrency || 'EUR', S = SYM[ccy] || ccy + ' ';
    const rd = res.reportingDate, month = monthYear(rd), quarter = res.quarter || '', year = okDate(rd) ? rd.getUTCFullYear() : '';
    const name = str(inp.coverName) || view, compartment = str(inp.compartment) || view;
    const src = (str(inp.sourceLine) || 'Source: internal data (unaudited at {date})').replace(/\{date\}/g, longDate(rd));
    const mm = (v) => (isNum(v) ? `${S}${NF0.format(v)}m` : '–');
    const deck = P.deck({ title: `${name} · investor report · ${quarter}`, template: opts.template || null, font: style && style.font });
    const K = R.houseKit(deck, { view, quarter, ccy, asOf: longDate(rd), filtered: (res.globalFilters || []).length, light: !!(opts.template && opts.templateText === 'light'), style });
    const C = K.C, T = K.T;
    const extra = R.extrasFor(res, inp);
    // colours for many slices: the template theme's accents and their shades, else greens and warm greys (house.js R.rampOf)
    const G = K.G;
    const dark = C.dark || shade(C.green, -0.35), teal = C.teal || C.green;
    // assets as the house names them: the code name (Mapping › Code Name), else the Holdings name
    const nm = (r) => str(r.code_name) || str(r.name);
    // sectors as the Output names them (Holdings), or the client's own when the report picks its classification (res.sectorSource):
    // its five sectors on the rings and bubbles (ownSector), the column's value in the asset table; its subsectors from its own
    // column (res.subsectorSource), else put into its list (ownSubsector)
    const sectorOf = res.sectorSource ? (r) => ownSector(r.sector, r.sector_holdings, r.subsector_holdings || r.subsector) : (r) => str(r.sector);
    const tableSectorOf = (r) => str(r.sector) || sectorOf(r);
    const subsectorOf = (r) => (res.sectorSource && !res.subsectorSource ? ownSubsector(sectorOf(r), r.subsector) : str(r.subsector));
    const page = (kicker, title, note, source) => K.contentPage(String(kicker || '').toUpperCase(), title, { source: source === undefined ? src : source, note });
    const sectionPage = (no, title, lines) => K.section(no, String(title).toUpperCase(), lines);
    const total = M.total_exposure_m || 0;
    const share = (pred) => (total ? rows.reduce((t, r) => t + (pred(r) ? r.exposure_m : 0), 0) / total : NaN);
    // floating share and currency split position by position (an asset's tranches can differ), as the overview shows them
    const floating = (x) => { const t = x && x.metrics && x.metrics.total_exposure_m, d = ((x && x.distributions && x.distributions.fixed_floating) || []).find((e) => e.label === 'Floating'); return t ? (d ? d.exposure_m : 0) / t : NaN; };
    const isBrown = (r) => /brown/i.test(str(r.greenfield_brownfield)), isSubIG = (r) => r.rating_status === 'rated' && r.ig_label !== 'IG';

    /**
     * A doughnut with its title in the hole and its labels set by hand (a chart's own labels get cut at the ring's edge): a slice
     * wide enough has its name and share in the ring, on one line each, never wrapped; a thinner one has them just outside the
     * ring (with a short line when op.lines), the labels each side pushed apart, away from the middle, so none overlap (the
     * op.maxOut largest only). op.values: the amount instead of the share ("2,332"); op.inner: the ring of a pair drawn inside
     * another (nothing outside, it would land on the outer ring).
     */
    function donut(s, x, y, d, title, items, o) {
      const op = o || {}, colors = op.colors || items.map((_, k) => G[k % G.length]), minIn = op.minLabel || 0.04;
      const tot = items.reduce((t, i) => t + (i.v > 0 ? i.v : 0), 0);
      s.chart({ x, y, w: d, h: d, type: 'doughnut', categories: items.map((i) => i.label), series: [{ name: String(title || 'Split').replace(/\n/g, ' '), values: items.map((i) => +i.v.toFixed(3)) }], colors, labelMode: 'none', holeSize: op.hole || 55, fontSize: op.size || 9, plotFill: true, border: op.border || 'FFFFFF', borderW: 1 });
      if (title) s.text({ x: x + d * 0.22, y: y + d * 0.36, w: d * 0.56, h: d * 0.28, text: title, size: op.titleSize || 12, bold: true, color: teal, align: 'center', valign: 'middle', inset: 0 });
      if (op.labels === false || !tot) return;
      const pctTxt = (f) => (f < 0.01 ? NF1.format(f * 100) : NF0.format(f * 100)) + '%';
      const cx = x + d / 2, cy = y + d / 2, R = d / 2, r0 = R * (op.hole || 55) / 100, fs = op.size || 9, lh = (fs * 1.22) / 72;
      const wOf = (t) => Math.max(...String(t).split('\n').map((l) => l.length)) * fs * 0.6 / 72 + 0.1;
      let cum = 0;
      const out = [];
      items.forEach((it, k) => {
        const f = it.v > 0 ? it.v / tot : 0, a = 2 * Math.PI * (cum + f / 2); cum += f;
        if (!(f > 0)) return;
        const text = `${it.label}\n${op.values ? NF0.format(it.v) : pctTxt(f)}`, sin = Math.sin(a), cos = Math.cos(a);
        // in the ring only when the label fits across it there (wide at the top and bottom, the ring's width at the sides)
        const rm = (R + r0) / 2, room = Math.min(2 * rm * Math.sin(Math.min(Math.PI / 2, f * Math.PI)), (R - r0) / Math.max(Math.abs(sin), 0.2));
        if (f >= minIn && wOf(text) - 0.1 <= room * 1.05) { const w = wOf(text); s.text({ x: cx + rm * sin - w / 2, y: cy - rm * cos - lh, w, h: 2 * lh, text, size: fs, bold: !!op.bold, color: inkOn(colors[k % colors.length], C), align: 'center', valign: 'middle', inset: 0, nowrap: true }); return; }
        if (!op.inner) out.push({ f, text, sin, cos, w: wOf(text), h: 2 * lh, side: sin >= 0 ? 1 : -1, ex: cx + R * sin, ey: cy - R * cos });
      });
      // outside: beside the ring at the slice's angle; on each side the labels above the middle pushed up, those below pushed down
      const keep = new Set(out.slice().sort((p, q) => q.f - p.f).slice(0, op.maxOut || 14)), g = 0.08;
      for (const side of [1, -1]) {
        const list = out.filter((l) => l.side === side && keep.has(l)).map((l) => Object.assign(l, { y: cy - (R + g) * l.cos - l.h / 2 }));
        const up = list.filter((l) => l.y + l.h / 2 < cy).sort((p, q) => q.y - p.y), down = list.filter((l) => l.y + l.h / 2 >= cy).sort((p, q) => p.y - q.y);
        for (let i = 1; i < up.length; i++) up[i].y = Math.min(up[i].y, up[i - 1].y - up[i - 1].h);
        for (let i = 1; i < down.length; i++) down[i].y = Math.max(down[i].y, down[i - 1].y + down[i - 1].h);
        // kept within op.top / op.bottom (e.g. under a panel's header bar)
        if (isNum(op.top) && up.length && up[up.length - 1].y < op.top) { const dy = op.top - up[up.length - 1].y; up.forEach((l) => { l.y += dy; }); }
        if (isNum(op.bottom) && down.length && down[down.length - 1].y + down[down.length - 1].h > op.bottom) { const dy = down[down.length - 1].y + down[down.length - 1].h - op.bottom; down.forEach((l) => { l.y -= dy; }); }
        for (const l of list) {
          const lx = cx + (R + g) * l.sin + side * 0.02, bx = side > 0 ? lx : lx - l.w;
          if (op.lines) s.line({ x1: l.ex, y1: l.ey, x2: side > 0 ? bx : bx + l.w, y2: l.y + l.h / 2, color: T.label, w: 0.5 });
          s.text({ x: bx, y: l.y, w: l.w, h: l.h, text: l.text, size: fs, color: T.text, align: side > 0 ? 'left' : 'right', valign: 'middle', inset: 0, nowrap: true });
        }
      }
    }

    /**
     * Bubbles of exposure by all-in spread band (up the side) and a column per category (along the bottom: the sectors, or the
     * maturity buckets), as the workbook's bubble block lays them out: every column shown even when empty, each in its own
     * colour, a bubble's size its volume. own: the client's deck labels ("€37M"); smallAbove: a bubble too small for its amount
     * has it above, in the bubble's colour (else to its right, in the text colour).
     */
    function spreadBubbles(s, b, cols, placeOf, o) {
      const op = o || {}, scale = op.scale || 120;
      const BANDS = ['<150 bps', '150-200 bps', '200-250 bps', '250-300 bps', '300-350 bps', '>350 bps'];
      const band = (v) => (v < 150 ? 1 : v < 200 ? 2 : v < 250 ? 3 : v < 300 ? 4 : v < 350 ? 5 : 6);
      const spreadRows = rows.filter((r) => isNum(r.margin_bps));
      const n = cols.length, X0 = 0.5, X1 = n + 0.5;
      const fx = b.x + 1.25, fw = b.w - 1.4, fy = b.y + 0.1, fh = b.h - (op.twoLine ? 0.95 : 0.75);
      const at = (sec, j) => spreadRows.filter((r) => placeOf(r) === sec.label && band(r.margin_bps) === j).reduce((t, r) => t + r.exposure_m, 0);
      const pts0 = []; cols.forEach((sec, k) => { for (let j = 1; j <= 6; j++) { const v = at(sec, j); if (v > 0) pts0.push({ k, j, v, sec }); } });
      const v0 = Math.max(1e-9, ...pts0.map((p) => p.v));
      // PowerPoint draws the largest bubble a quarter of the plot's smaller side across (times the scale), the others by area
      const rIn = (v) => ((0.25 * Math.min(fw, fh) * scale) / 100 / 2) * Math.sqrt(v / v0);
      // a band of room above >350 and below <150, more when a bubble there is large, plus a label's height over the top row:
      // no bubble or label reaches past the plot, into the title rule or onto the names under it
      let Y0 = 0, Y1 = 7;
      for (let it = 0; it < 6; it++) { const per = fh / (Y1 - Y0); Y1 = Math.max(7, ...pts0.map((p) => p.j + (rIn(p.v) + 0.22) / per)); Y0 = Math.min(0, ...pts0.map((p) => p.j - (rIn(p.v) + 0.08) / per)); }
      const yOf = (j) => fy + (fh * (Y1 - j)) / (Y1 - Y0), xOf = (x) => fx + (fw * (x - X0)) / (X1 - X0);
      // labels: whole millions as the house chart writes them ("37 M€"), the client's deck "€37M"; inside the bubble in white when
      // it fits, else beside it in the bubble's colour: above, right, left or below, the first spot clear of every bubble and of
      // the labels already placed
      const cur = S.trim(), lbl = op.own ? (v) => `${cur}${NF0.format(v)}M` : (v) => `${NF0.format(v)} M${cur.length > 1 ? ' ' + cur : cur}`;
      const fs = 9, lh = (fs * 1.25) / 72, tw = (t) => t.length * fs * 0.6 / 72 + 0.04;
      const circles = pts0.map((p) => ({ x: xOf(p.k + 1), y: yOf(p.j), r: rIn(p.v) }));
      const hitCircle = (q, c) => { const nx = Math.max(q[0], Math.min(c.x, q[0] + q[2])), ny = Math.max(q[1], Math.min(c.y, q[1] + q[3])); return Math.hypot(nx - c.x, ny - c.y) < c.r - 0.01; };
      const hitRect = (q, c) => q[0] < c[0] + c[2] && c[0] < q[0] + q[2] && q[1] < c[1] + c[3] && c[1] < q[1] + q[3];
      const placed = [];
      pts0.forEach((p, i) => {
        const c = circles[i], t = lbl(p.v), w = tw(t);
        if (w <= 2 * c.r * 0.92) { p.pos = 'ctr'; return; }
        const g = 0.03, rect = { t: [c.x - w / 2, c.y - c.r - g - lh, w, lh], r: [c.x + c.r + g, c.y - lh / 2, w, lh], l: [c.x - c.r - g - w, c.y - lh / 2, w, lh], b: [c.x - w / 2, c.y + c.r + g, w, lh] };
        let best = null;
        for (const pos of ['t', 'r', 'l', 'b']) {
          const q = rect[pos], bad = circles.filter((cc, j) => j !== i && hitCircle(q, cc)).length * 2 + placed.filter((pq) => hitRect(q, pq)).length * 2 + (q[1] < fy || q[1] + q[3] > fy + fh || q[0] < fx ? 3 : 0);
          if (!best || bad < best.bad) best = { pos, q, bad }; if (!bad) break;
        }
        p.pos = best.pos; placed.push(best.q);
      });
      const outInk = (col) => (lum(col) > 0.7 ? shade(col, -0.35) : col);
      const series = cols.map((sec, k) => { const pts = pts0.filter((p) => p.k === k); return pts.length ? { name: sec.label.replace(/\n/g, ' '), x: pts.map((p) => k + 1), y: pts.map((p) => p.j), size: pts.map((p) => p.v), labels: pts.map((p) => lbl(p.v)), color: sec.color, alpha: 0.85, labelColor: inkOn(sec.color, C), labelPos: pts.map((p) => p.pos), labelColors: pts.map((p) => (p.pos === 'ctr' ? null : outInk(sec.color))) } : null; }).filter(Boolean);
      if (series.length) s.chart({ x: fx, y: fy, w: fw, h: fh, type: 'bubble', series, bubbleScale: scale, numFmt: op.own ? `"${cur}"#,##0"M"` : `#,##0" M${cur.length > 1 ? ' ' + cur : cur}"`, fontSize: fs, plotFill: true, xAxis: { min: X0, max: X1, hide: true }, yAxis: { min: Y0, max: Y1, hide: true } });
      // the axes with their tick marks: one at each band, one between columns
      s.line({ x1: fx, y1: fy, x2: fx, y2: fy + fh, color: T.label, w: 0.75 }); s.line({ x1: fx, y1: fy + fh, x2: fx + fw, y2: fy + fh, color: T.label, w: 0.75 });
      BANDS.forEach((t, j) => { s.line({ x1: fx - 0.06, y1: yOf(j + 1), x2: fx, y2: yOf(j + 1), color: T.label, w: 0.75 }); s.text({ x: b.x, y: yOf(j + 1) - 0.15, w: 1.1, h: 0.3, text: t, size: 10, color: T.text, align: 'right', valign: 'middle', inset: 0 }); });
      for (let k = 1; k < n; k++) s.line({ x1: xOf(k + 0.5), y1: fy + fh, x2: xOf(k + 0.5), y2: fy + fh + 0.06, color: T.label, w: 0.75 });
      cols.forEach((sec, k) => s.text({ x: xOf(k + 0.5), y: fy + fh + 0.1, w: fw / n, h: op.twoLine ? 0.7 : 0.5, text: sec.label, size: 10, color: T.text, align: 'center', inset: 0 }));
      if (!series.length) s.text({ x: fx, y: fy + fh / 2 - 0.2, w: fw, h: 0.4, text: 'No all-in spread in Holdings for this view.', size: 11, color: T.muted, align: 'center', inset: 0 });
    }

    // ---------- 1. cover ----------
    K.cover(name.toUpperCase(), `REPORTING AS OF ${longDate(rd).toUpperCase()}`, `${name} · ${quarter}`);

    // ---------- 01 market activity: two pages for the market commentary, left blank ----------
    sectionPage('01', 'Market activity', []);
    page('Overview of the infrastructure debt market', 'Current market activity', 'left blank: market commentary and public-market spreads', '');
    page('Overview of the European infrastructure debt market', 'Current market activity', 'left blank: transaction volumes and sector split', '');

    // ---------- 02 portfolio overview ----------
    sectionPage('02', 'Portfolio overview', ['Portfolio exposures', 'Portfolio summary']);
    // key figures and the portfolio split
    {
      // the title carries footnote 1, as the house deck has it
      const s = page(`${name} – Portfolio overview`, `Portfolio overview as at end of ${month}\u207D\u00B9\u207E`, `${mm(total)} under management, ${rows.length} instruments`), b = s.box;
      // repaid: as entered, else the fall in drawn (nominal where drawn is not shown) since the previous Holdings
      let repaid = isNum(+inp.repaid_m) && str(inp.repaid_m) !== '' ? +inp.repaid_m : NaN;
      if (!isNum(repaid) && prev) {
        const amt = (r) => (isNum(r.drawn_m) ? r.drawn_m : r.exposure_m), now = new Map(rows.map((r) => [r.code, r]));
        repaid = (prev.rows || []).reduce((t, p) => { const c = now.get(p.code); return t + Math.max(0, amt(p) - (c ? amt(c) : 0)); }, 0);
      }
      // the house deck's eight figures in four columns of two, each value over its label. The group's deck: the weighted WAL
      // (footnote 2) in place of the instrument count, repaid by quarter of the year, Sub-IG to one decimal, and with a
      // previous Holdings each figure's change on the quarter beside it ("(-12m QoQ)", "(Flat QoQ)")
      const grp = !!(res.platform && res.platform.isGroup), qtrs = okDate(rd) ? Array.from({ length: Math.floor(rd.getUTCMonth() / 3) + 1 }, (_, i) => `Q${i + 1}`).join(', ') : '';
      const prevShare = (pred) => { const t = PM && PM.total_exposure_m; return t ? (prev.rows || []).reduce((a, r) => a + (pred(r) ? r.exposure_m : 0), 0) / t : NaN; };
      const flat = (d, eps) => !isNum(d) || Math.abs(d) < eps;
      const sg = (d, f) => (d > 0 ? '+' : d < 0 ? '-' : '') + f(Math.abs(d));
      const qoq = (d, eps, f) => (!PM || !grp || !isNum(d) ? '' : flat(d, eps) ? '(Flat QoQ)' : `(${sg(d, f)} QoQ)`);
      const pp = (now, was, dp) => qoq(isNum(now) && isNum(was) ? (now - was) * 100 : NaN, dp ? 0.05 : 0.5, (v) => `${(dp ? NF1 : NF0).format(v)}p.p.`);
      const sub = share(isSubIG), pct1 = (v) => (isNum(v) ? NF1.format(v * 100) + '%' : '–');
      const cells = [
        [[mm(total), 'Under management', PM ? qoq(total - (PM.total_exposure_m || 0), 0.5, (v) => `${NF0.format(v)}m`) : ''], [mm(repaid), grp && qtrs ? `Repaid in ${qtrs} ${year}` : `Repaid in ${year}`, '']],
        [[isNum(M.w_margin_bps) ? `${NF0.format(M.w_margin_bps)}${grp ? ' ' : ''}bps` : '–', 'Average all-in spread', PM ? qoq(M.w_margin_bps - PM.w_margin_bps, 0.5, (v) => `${NF0.format(v)}bps`) : ''], [pct0(share(isBrown)), grp ? 'Brownfield' : 'Brownfield²', PM ? pp(share(isBrown), prevShare(isBrown)) : '']],
        grp ? [[isNum(M.w_wal_years) ? NF1.format(M.w_wal_years) : '–', 'Weighted Average Life²', PM ? qoq(M.w_wal_years - PM.w_wal_years, 0.05, (v) => `${NF1.format(v)} years`) : ''], [pct0(floating(res)), 'Floating', PM ? pp(floating(res), floating(prev)) : '']]
          : [[NF0.format(rows.length), 'Instruments outstanding', ''], [pct0(floating(res)), 'Floating', '']],
        [[M.w_rating_label || '–', 'Average rating', PM && grp ? (PM.w_rating_label && PM.w_rating_label !== M.w_rating_label ? `(${PM.w_rating_label} last quarter)` : '(Flat QoQ)') : ''], [grp ? pct1(sub) : pct0(sub), grp ? 'Sub-IG' : 'Sub-IG²', PM ? pp(sub, prevShare(isSubIG), grp) : '']],
      ];
      const cw = b.w / 4, kh = Math.min(1.95, b.h * 0.36);
      cells.forEach((col, k) => {
        const x = b.x + k * cw;
        s.line({ x1: x + 0.05, y1: b.y + 0.05, x2: x + 0.05, y2: b.y + kh, color: teal, w: 1.5 });
        col.forEach((c, j) => s.text({ x: x + 0.18, y: b.y + 0.05 + j * kh / 2, w: cw - 0.25, h: kh / 2 - 0.05, inset: 0, valign: 'middle', paras: [
          { runs: [{ text: c[0], size: 24, bold: true, color: T.text }].concat(c[2] ? [{ text: '  ' + c[2], size: 8, color: T.text }] : []) }, { text: c[1], size: 12.5, color: dark }] }));
      });
      // the split: currency, repayment, residual WAL, type of cashflows
      const by = b.y + kh + 0.2, bh = b.h - kh - 0.75, bx = b.x + 0.1, bw = b.w - 0.2;
      s.rect({ x: bx, y: by, w: bw, h: bh, line: teal, lineW: 1.5 });
      s.text({ x: bx, y: by + 0.06, w: bw, h: 0.32, text: `Portfolio split – ${month}`, size: 13, bold: true, color: teal, align: 'center', valign: 'middle', inset: 0 });
      const wal = (r) => { const v = isNum(r.wal_years) ? r.wal_years : r.remaining_years; return !isNum(v) ? 'n/a' : v < 5 ? '< 5' : v < 10 ? '5 - 10' : v < 15 ? '10 - 15' : v < 20 ? '15 - 20' : '> 20'; };
      const ccySplit = res.distributions && res.distributions.currency ? ordered(res.distributions.currency.map((d) => ({ label: d.label, v: d.exposure_m })).filter((d) => d.v > 0), ORDER.currency) : dist(rows, (r) => r.currency, ORDER.currency);
      const repay = (r) => (/^amorti/i.test(str(r.repayment_type)) ? 'Amortizing' : r.repayment_type);
      const splits = [['Currency', ccySplit], ['Bullet/\nAmortising', dist(rows, repay, ORDER.repayment)], ['Residual\nWAL', dist(rows, wal, ORDER.wal)], ['Type of\nCashflows', dist(rows, (r) => r.cash_flow_type, ORDER.cashflow)]];
      // room round each ring for the labels of thin slices, set outside it
      const d = Math.min(bh - 0.8, bw / 4 - 0.6);
      // each type of cash flow keeps its own colour (Contracted, Regulated, Merchant, Concession, as the house deck colours them)
      const own = (items, of) => { const used = new Set(), list = items.map((it) => of(it.label)); return list.map((c, k) => { const cc = c && !used.has(c) ? c : G.find((g) => !used.has(g) && !list.includes(g)) || G[k % G.length]; used.add(cc); return cc; }); };
      splits.forEach(([t, items], k) => donut(s, bx + k * (bw / 4) + (bw / 4 - d) / 2, by + 0.42 + (bh - 0.42 - d) / 2, d, t, items, Object.assign({ minLabel: 0.05, hole: 50 }, k === 3 ? { colors: own(items, K.named.cashflow) } : {})));
      // footnote 2: the shares are of AuM; with a mandate, the same two as shares of the mandate
      const mandateM = str(inp.mandate_m) !== '' && isNum(+inp.mandate_m) && +inp.mandate_m > 0 ? +inp.mandate_m : NaN, ofMandate = (pred) => pct0(rows.reduce((t, r) => t + (pred(r) ? r.exposure_m : 0), 0) / mandateM);
      const notes = grp ? ['(1) Includes both funded and unfunded nominal as well as amortisation', '(2) Instruments with no WAL (e.g. capex facilities) are not included'] : ['(1) Includes both funded and unfunded nominal as well as amortisation', `(2) Calculated as a percentage of AuM.${isNum(mandateM) ? ` Brownfield is ${ofMandate(isBrown)} as a percentage of mandate size, Sub-IG is ${ofMandate(isSubIG)} of mandate size` : ''}`];
      s.text({ x: b.x + b.w * 0.3, y: by + bh + 0.04, w: b.w * 0.7, h: 0.5, paras: notes.map((t) => ({ text: t, size: 7, color: T.muted, align: 'right' })), inset: 0 });
    }
    // sectors and jurisdictions
    {
      const s = page(`${name} – Portfolio overview`, `Portfolio overview as at end of ${month}`, 'sector and subsector rings; exposure by country on the map'), b = s.box;
      const pw = (b.w - 0.3) / 2, ph = b.h - 0.05;
      const panel = (x, title) => { s.rect({ x, y: b.y, w: pw, h: ph, line: C.border, lineW: 0.75 }); s.rect({ x, y: b.y, w: pw, h: 0.4, fill: dark }); s.text({ x, y: b.y, w: pw, h: 0.4, text: title, size: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', inset: 0 }); };
      panel(b.x, 'Sectors'); panel(b.x + pw + 0.3, 'Jurisdictions');
      // two rings: sectors inside, their subsectors outside, in the same order so they line up
      // each sector a colour of the ramp; its subsectors the other shades of that colour's theme column
      // each sector its own colour (Energy, Renewable, Transport, Telecom, Utilities, Social as the house deck colours them; any
      // other the next colour of the ramp not taken), its subsectors that colour and its lighter shades
      const sectors = dist(rows, sectorOf, ORDER.sector), taken = new Set(sectors.map((d) => K.named.sector(d.label)).filter(Boolean)), spare = G.filter((g) => !taken.has(g));
      const sColor = new Map(sectors.map((d) => [d.label, K.named.sector(d.label) || spare.shift() || G[0]]));
      const subOrder = res.sectorSource ? ORDER.ownSubsector : ORDER.subsector;
      const subs = []; sectors.forEach((sec, k) => { const kin = K.named.sectorKin(sec.label) || [sColor.get(sec.label)].concat(K.kin(k)), list = dist(rows.filter((r) => (sectorOf(r) || 'Not set') === sec.label), (r) => subsectorOf(r) || sec.label, subOrder); list.forEach((d, j) => subs.push({ label: d.label, v: d.v, color: kin[j % kin.length] })); });
      // the outer ring leaves room round it for its thin slices' labels, outside it with a short line
      const D = Math.min(pw - 1.7, ph - 1.2), cx = b.x + pw / 2, cy = b.y + 0.4 + (ph - 0.4) / 2;
      donut(s, cx - D / 2, cy - D / 2, D, '', subs, { colors: subs.map((x) => x.color), hole: 58, minLabel: 0.03, size: 8, lines: true, maxOut: 10, top: b.y + 0.45, bottom: b.y + ph - 0.05 });
      const d2 = D * 0.58;
      donut(s, cx - d2 / 2, cy - d2 / 2, d2, 'Sector', sectors, { colors: sectors.map((x) => sColor.get(x.label)), hole: 45, minLabel: 0.04, size: 8, titleSize: 14, inner: true });
      drawMap(s, b.x + pw + 0.3, b.y + 0.4, pw, ph - 0.4, rows);
    }
    // assets under management against the mandate (the group's deck: against its budget, the shares of total AuM, the
    // undrawn amount of each transaction with their total, and the doughnut by the entities the group is made of)
    {
      const grp = !!(res.platform && res.platform.isGroup);
      const s = page(`${name} – Assets under management`, `Portfolio overview as at end of ${month}`, grp ? 'funded and unfunded; the budget not yet used; unfunded and partly funded transactions; AuM by entity' : 'funded, unfunded and left to deploy against the mandate; unfunded and partly funded transactions', `${src} · AuM defined as funded + unfunded`), b = s.box;
      const mandate = str(inp.mandate_m) !== '' && isNum(+inp.mandate_m) ? +inp.mandate_m : NaN;
      const funded = M.total_drawn_m, unfunded = isNum(funded) ? total - funded : NaN;
      s.rect({ x: b.x, y: b.y, w: b.w, h: 0.95, fill: teal });
      const big = (x, w, v, label) => s.text({ x, y: b.y, w, h: 0.95, inset: 0, valign: 'middle', paras: [{ text: v, size: 28, color: 'FFFFFF', align: 'center' }, { text: label, size: 13, color: 'FFFFFF', align: 'center' }] });
      big(b.x, b.w / 2, `${S}${NF0.format(total)} M`, grp ? 'Total Assets under management' : 'Assets under management');
      if (grp) big(b.x + b.w / 2, b.w / 2, isNum(mandate) ? `${S}${NF0.format(mandate - total)} M` : '–', 'Unused Budget');
      else big(b.x + b.w / 2, b.w / 2, isNum(mandate) ? `${S}${NF0.format(mandate)} M` : '–', 'Mandate size');
      const lw = b.w * 0.5, of = (v) => (isNum(v) && isNum(mandate) && mandate ? pct0(v / mandate) : '–'), am = (v) => (isNum(v) ? NF0.format(v) : '–');
      // the parts in italics (their figures too), the totals in bold, every label from the left
      const it = (t) => ({ text: t, italic: true }), ofAum = (v) => (isNum(v) && total ? pct0(v / total) : '–');
      const t1 = grp ? [['', `Amount (${S.trim()}m)`, '% of total AUM'], [it('Funded'), it(am(funded)), it(ofAum(funded))], [it('Unfunded'), it(am(unfunded)), it(ofAum(unfunded))], [{ text: 'AUM', bold: true }, { text: am(total), bold: true }, { text: ofAum(total), bold: true }]]
        : [['', `Amount (${S.trim()}m)`, '% of mandate'], [it('Funded'), it(am(funded)), it(of(funded))], [it('Unfunded'), it(am(unfunded)), it(of(unfunded))],
          [{ text: 'Assets under management', bold: true }, am(total), of(total)], [it('Left to deploy'), it(am(isNum(mandate) ? mandate - total : NaN)), it(of(isNum(mandate) ? mandate - total : NaN))], [{ text: 'Mandate size', bold: true }, am(mandate), isNum(mandate) ? '100%' : '–']];
      K.table(s, { x: b.x, y: b.y + 1.12, colW: [lw * 0.46, lw * 0.28, lw * 0.26], rows: t1, rowH: 0.3, size: 11, headerFill: dark, zebra: C.cell, align: ['left', 'center', 'center'], rowTop: grp ? { 3: T.text } : { 3: T.text, 5: T.text } });
      // the transaction groups (Mapping › Transaction Group), for the doughnut
      const groupOf = (r) => str(r.transaction_group) || str(r.asset_group) || nm(r), labelOf = (r) => str(r.asset_group) || str(r.transaction_group) || nm(r), deal = dealOrder(rows);
      const byGroup = new Map(); for (const r of deal) { const g = groupOf(r) || 'Not set', e = byGroup.get(g) || { label: labelOf(r) || g, exp: 0, drawn: 0 }; e.exp += r.exposure_m || 0; e.drawn += r.drawn_m; byGroup.set(g, e); }
      // the table lists each instrument (tranche) with anything undrawn, by its code name, as the house deck does (above €5k, so
      // rounding does not list a fully drawn one): the most undrawn first, the group's in deal order with the undrawn amount
      const partial = deal.filter((r) => isNum(r.drawn_m) && (r.exposure_m || 0) - r.drawn_m > 0.005).map((r) => ({ label: nm(r), exp: r.exposure_m, drawn: r.drawn_m }));
      if (!grp) partial.sort((a, b) => (b.exp - b.drawn) - (a.exp - a.drawn));
      const t1h = 0.3 * t1.length, ty = b.y + 1.12 + t1h + 0.18;
      if (!grp) s.text({ x: b.x, y: ty, w: lw, h: 0.3, text: 'Unfunded & partially funded transactions', size: 13, bold: true, color: teal, inset: 0, valign: 'middle' });
      // every row shown: shorter rows and smaller type when there are many, "+ n more" only past 0.17 in a row
      const t2y = grp ? ty : ty + 0.34, space = b.y + b.h - t2y - 0.25, n2 = partial.length + 1 + (grp ? 1 : 0);
      const rh = Math.max(0.16, Math.min(0.25, space / Math.max(1, n2))), room = Math.max(1, Math.floor(space / rh) - 1 - (grp ? 1 : 0)), fs2 = rh < 0.2 ? 8 : rh < 0.23 ? 9 : 10;
      const shown = partial.slice(0, room);
      const t2 = grp ? [['Transaction', `Unfunded amount (${S.trim()}m)`, '% funded']].concat(shown.length ? shown.map((e) => [it(e.label), it(NF1.format(e.exp - e.drawn)), it(pct0(e.drawn / e.exp))]) : [[isNum(funded) ? 'None: every transaction is fully funded' : 'Drawn amounts are not shown for this view', '', '']])
          .concat(shown.length ? [[{ text: 'Total unfunded', bold: true }, { text: NF0.format(partial.reduce((t, e) => t + e.exp - e.drawn, 0)), bold: true }, '']] : [])
        : [['Transaction', `Amount drawn (${S} M)`, '% funded']].concat(shown.length ? shown.map((e) => [e.label, NF1.format(e.drawn), pct0(e.drawn / e.exp)]) : [[isNum(funded) ? 'None: every transaction is fully funded' : 'Drawn amounts are not shown for this view', '', '']]);
      K.table(s, { x: b.x, y: t2y, colW: [lw * 0.46, lw * 0.28, lw * 0.26], rows: t2, rowH: rh, size: fs2, padY: 0.01, headerFill: dark, zebra: C.cell, align: grp ? ['center', 'center', 'center'] : ['left', 'center', 'center'], rowTop: grp && shown.length ? { [t2.length - 1]: T.text } : undefined });
      if (partial.length > shown.length) s.text({ x: b.x, y: t2y + t2.length * rh + 0.02, w: lw, h: 0.22, text: `+ ${partial.length - shown.length} more`, size: 8, color: T.muted, inset: 0 });
      const d = Math.min(b.w - lw - 2, b.h - 1.9);
      if (grp) {
        // the group's doughnut: AuM by the entities it is made of (each at the group's share), the amount on each, the total in the hole
        const ents = entities(), items = ents.map((e) => ({ label: e.label, v: e.weighted })).filter((e) => e.v > 0);
        const dx = b.x + lw + (b.w - lw - d) / 2, dy = b.y + 1.05 + (b.h - 1.05 - d) / 2;
        donut(s, dx, dy, d, '', items, { hole: 50, minLabel: 0.035, size: 9, values: true, top: b.y + 1.05, bottom: b.y + b.h });
        s.text({ x: dx + d * 0.2, y: dy + d * 0.4, w: d * 0.6, h: d * 0.2, text: `${ccy} ${NF0.format(total)} M`, size: 16, bold: true, color: teal, align: 'center', valign: 'middle', inset: 0 });
      } else {
        // the groups' doughnut: in the order the groups first come in the asset list (the sheet's UNIQUE), not by size
        const firstSeen = new Map(); for (const r of deal) { const g = groupOf(r) || 'Not set'; if (!firstSeen.has(g)) firstSeen.set(g, firstSeen.size); }
        const groups = dist(rows, groupOf, (l) => firstSeen.get(l)).map((d) => Object.assign(d, { label: (byGroup.get(d.label) || {}).label || d.label }));
        const d1 = Math.min(b.w - lw - 2.4, b.h - 2.2);
        donut(s, b.x + lw + (b.w - lw - d1) / 2, b.y + 1.05 + (b.h - 1.05 - d1) / 2, d1, '', groups, { hole: 52, minLabel: 0.025, size: 9, top: b.y + 1.05, bottom: b.y + b.h });
      }
    }

    // ---------- 03 portfolio metrics ----------
    sectionPage('03', 'Portfolio metrics', ['Spread breakdown', 'Achieved spreads', 'Cashflow projections', 'Yield projections', 'Asset performance overview']);
    // spreads across sectors, bubble size = volume
    {
      const s = page(res.sectorSource ? 'Achieved spreads across portfolio' : `${name} – Outstanding spreads across portfolio`, `Spreads across sectors depicted by volume as of ${month}`, 'exposure by sector and all-in spread band', `${src} · AuM defined as funded + unfunded`), b = s.box;
      const spreadRows = rows.filter((r) => isNum(r.margin_bps));
      // the sectors along the bottom, every one shown even when empty, as the workbook's bubble block lays them out: the house six
      // (Energy, Renewable Power, Social, Transport, Telecoms, Utilities), or the client's five on its own views; each keeps its
      // own colour (the house chart's: Renewable Power accent 1, Energy 2, Transport 3, Social 4, Telecoms 5, Utilities 6), and
      // a sector outside the list follows in the next accents
      const fixed = res.sectorSource ? OWN_SECTORS.map(([, l], k) => [l, k]) : BUBBLE_SECTORS.map(([, l, c]) => [l, c]);
      const placeOf = res.sectorSource ? (r) => sectorOf(r) || 'Not set' : (r) => bubbleSector(sectorOf(r)) || 'Not set';
      const extra = U.uniq(spreadRows.map(placeOf)).filter((l) => !fixed.some(([f]) => f === l));
      const sectors = fixed.concat(extra.map((l, k) => [l, 6 + k])).map(([label, c]) => ({ label, color: K.ACC[c % K.ACC.length] }));
      spreadBubbles(s, b, sectors, placeOf, { own: !!res.sectorSource });
    }
    // spreads by residual maturity (a group report page): a column per maturity bucket, each in its own colour
    if (extra.maturity) {
      const s = page(`${name} – Spread profiles of portfolio maturities`, `Maturities and spreads across sectors depicted by volume as of ${month}`, 'exposure by residual maturity and all-in spread band', `${src} · AuM defined as funded + unfunded`), b = s.box;
      // the buckets of the house slide, by years to final maturity; each a theme colour (Accent 2, Accent 1, Accent 4, Accent 3,
      // Accent 5, Text 2), an accent instead where the theme colour is too pale to see
      const MAT = [[1, 'Less than 1\nyear', [6, 0]], [3, 'Between 1 to 3\nyears', [5, 0]], [5, 'Between 3 to 5\nyears', [8, 0]], [10, 'Between 5 to\n10 years', [7, 0]], [20, 'Between 10 to\n20 years', [9, 0]], [Infinity, 'Greater than\n20 years', [4, 0]]];
      const bucketOf = (r) => (isNum(r.remaining_years) ? MAT.find(([hi]) => Math.max(0, r.remaining_years) < hi)[1] : 'Not set');
      const cols = MAT.map(([, label, c], k) => { const v = K.named.col(c[0], c[1]); return { label, color: lum(v) > 0.85 ? K.ACC[k % K.ACC.length] : v }; });
      if (rows.some((r) => isNum(r.margin_bps) && !isNum(r.remaining_years))) cols.push({ label: 'Not set', color: T.label });
      spreadBubbles(s, b, cols, bucketOf, { twoLine: true });
    }
    // relative value: the portfolio's spreads against the public-market curves
    {
      const grp = !!(res.platform && res.platform.isGroup);
      const mk = inp.market && Array.isArray(inp.market.series) ? inp.market.series : [];
      const names = mk.map((x) => x.name).filter(Boolean);
      const s = page(grp ? `${name} – Achieved spreads across portfolio` : 'Achieved spreads in the portfolio', 'Relative value vs public markets spread curves', mk.length ? 'deals at their closing spread against the public-market curves' : 'deals at their closing spread; paste the public-market curves on Investor reporting to draw them',
        `Source: ${names.length ? names.join(', ') + '; ' : ''}${src.replace(/^Sources?:\s*/i, '')}`), b = s.box;
      const deals = rows.filter((r) => isNum(r.margin_bps) && okDate(r.financial_close || r.funding_date));
      // each curve on the chart its name puts it on (BBB, or BB / high yield), every one drawn; unnamed: the first BBB, the second BB
      const isBB = (c) => /\bBB\b|high\s*yield|\bHY\b/i.test(str(c.name)) && !/BBB/i.test(str(c.name)), isBBB = (c) => /BBB/i.test(str(c.name));
      let bbb = mk.filter(isBBB), bb = mk.filter(isBB);
      if (!bbb.length && !bb.length) { bbb = mk.slice(0, 1); bb = mk.slice(1, 2); }
      const hh = (b.h - 0.1) / 2, end = serial(rd);
      [['BBB transactions', deals.filter((r) => r.rating_status === 'rated' && r.ig_label === 'IG'), bbb], ['BB transactions', deals.filter((r) => isSubIG(r)), bb]].forEach(([title, list, curves], k) => {
        const y = b.y + k * (hh + 0.1), top = grp ? 0 : 0.26;
        if (!grp) s.text({ x: b.x + 0.6, y, w: 4, h: 0.26, text: title, size: 11, bold: true, color: C.green, inset: 0, valign: 'middle' });
        // the window: from the start of the curves (the first deal when there are none) to the reporting date; deals outside it left off
        const cps = curves.map((c) => (Array.isArray(c.points) ? c.points.filter((p) => isNum(p[0]) && isNum(p[1])) : []));
        const cStart = cps.some((p) => p.length) ? Math.min(...cps.filter((p) => p.length).map((p) => p[0][0])) : NaN;
        // one marker per transaction, close date and spread; tranches closed together share a label ("Name 1,2")
        const groups = new Map();
        for (const r of list) { const d = r.financial_close || r.funding_date, sx = serial(d); if ((isNum(cStart) && sx < cStart) || (isNum(end) && sx > end)) continue; const gr = r.asset_group || r.transaction_group || '', key = `${gr || nm(r)}|${sx}|${r.margin_bps}`; if (!groups.has(key)) groups.set(key, { g: gr, names: [], x: sx, y: r.margin_bps }); groups.get(key).names.push(nm(r)); }
        const pts = Array.from(groups.values()), label = (p) => { if (p.names.length === 1) return p.names[0]; const g = p.g && p.names.every((nm) => nm.startsWith(p.g)) ? p.g : ''; return g ? `${g} ${p.names.map((nm) => nm.slice(g.length).trim()).join(',')}` : p.names.join(', '); };
        const lo = isNum(cStart) ? cStart : pts.length ? Math.min(...pts.map((p) => p.x)) : end - 365, hi = Math.max(isNum(end) ? end : -Infinity, ...pts.map((p) => p.x));
        // the date axis from the 15th of a quarter's last month (Mar, Jun, Sep, Dec) at or before the start, a tick a quarter
        // (half-year or year on a long span), so each tick reads the right month; it ends just past the reporting date
        const d0 = new Date(Date.UTC(1899, 11, 30) + lo * 86400000), qm = Math.floor((d0.getUTCMonth() + 1) / 3) * 3 - 1, q15 = serial(new Date(Date.UTC(d0.getUTCFullYear(), qm, 15)));
        const x0 = q15 > lo ? q15 - 91 : q15, x1 = hi + 12;
        const span = Math.max(1, x1 - x0), major = span / 91.3125 <= 26 ? 91.3125 : span / 182.625 <= 16 ? 182.625 : 365.25;
        const cin = cps.map((p) => p.filter((q) => q[0] >= x0 && q[0] <= x1)), ys = pts.map((p) => p.y).concat(...cin.map((p) => p.map((q) => q[1]))).filter(isNum);
        const ymax = Math.max(100, Math.ceil(Math.max(0, ...ys) * 1.12 / 50) * 50);
        // names on the recent deals only (closed in the 15 months to the reporting date), every one when there are few
        const recent = pts.length <= 12 ? () => true : (p) => p.x >= end - 457;
        // each label beside its marker (above, right, left or below): the first spot clear of the labels placed and the
        // markers, else the least crowded; the plot area set (fractions of the chart) so the spots can be worked out
        const PF = { l: 0.075, t: 0.05, w: 0.72, h: 0.77 }, cw = b.w, ch = hh - top, lsz = 7;
        const px = (v) => (PF.l + (v - x0) / (x1 - x0) * PF.w) * cw, py = (v) => (PF.t + (1 - v / ymax) * PF.h) * ch;
        const marks = pts.map((p) => ({ x: px(p.x), y: py(p.y) })), placed = [], where = [];
        const at = (m, t, pos) => { const w = String(t).length * lsz * 0.5 / 72 + 0.04, h = lsz * 1.3 / 72, g = 0.06; return pos === 't' ? [m.x - w / 2, m.y - g - h, w, h] : pos === 'b' ? [m.x - w / 2, m.y + g, w, h] : pos === 'r' ? [m.x + g, m.y - h / 2, w, h] : [m.x - g - w, m.y - h / 2, w, h]; };
        const hit = (a, c) => a[0] < c[0] + c[2] && c[0] < a[0] + a[2] && a[1] < c[1] + c[3] && c[1] < a[1] + a[3];
        const crowd = (r) => placed.filter((q) => hit(r, q)).length * 2 + marks.filter((m) => hit(r, [m.x - 0.045, m.y - 0.045, 0.09, 0.09])).length + (r[0] < PF.l * cw || r[0] + r[2] > (PF.l + PF.w) * cw + 0.2 || r[1] < 0 ? 3 : 0);
        pts.map((p, k) => k).filter((k) => recent(pts[k])).sort((a, c) => pts[a].x - pts[c].x).forEach((k) => {
          let best = null;
          for (const pos of ['r', 't', 'l', 'b']) { const r = at(marks[k], label(pts[k]), pos), n = crowd(r); if (!best || n < best.n) best = { pos, r, n }; if (!n) break; }
          where[k] = best.pos; placed.push(best.r);
        });
        // the deals first, the curves after them (a viewer may skip a line series listed before a longer one); x markers as on the house slide
        const series = [{ name: 'Spread', x: pts.map((p) => p.x), y: pts.map((p) => p.y), color: k ? C.salmon : C.lgreen, marker: 'x', markerSize: 6, labels: pts.map((p, i) => (recent(p) ? label(p) : '')), labelSize: lsz, labelColor: T.text, labelPos: pts.map((p, i) => where[i] || 'r') }];
        const cc = k ? [dark, C.label] : [teal, C.label];
        cin.forEach((c, j) => { if (c.length) series.push({ name: curves[j].name || 'Public market', x: c.map((p) => p[0]), y: c.map((p) => p[1]), color: cc[j % cc.length], line: true, lineW: 1.5, marker: 'none' }); });
        s.chart({ x: b.x, y: y + top, w: cw, h: ch, type: 'scatter', series, fontSize: 8, legend: 'r', plotFill: PF, xAxis: { min: x0, max: x1, major, fmt: 'mmm-yy', ticks: true }, yAxis: { min: 0, max: ymax, major: ymax > 400 ? 100 : 50, title: 'Spread (bps)', ticks: true } });
        if (!pts.length) s.text({ x: b.x + 1, y: y + hh / 2 - 0.1, w: b.w - 2, h: 0.3, text: `No ${title.replace(' transactions', '')} transaction with a close date and a spread${isNum(cStart) ? ' in the curves\' period' : ''}.`, size: 10, color: T.muted, align: 'center', inset: 0 });
      });
    }
    page('Projected cashflow profile', 'AUM (drawn exposure), Repayments and Coupons', 'left blank: cashflow projection', '');
    page('Projected yield profile', 'Fixed, Floating and Combined Yields', 'left blank: yield projection', '');
    // the asset and performance table, 30 rows a page
    {
      const before = prev ? new Map((prev.rows || []).map((r) => [r.code, r])) : null;
      const order = dealOrder(rows);
      // an investor's own "… Classification" column (Core / Core+) only on that investor's decks, as the workbook shows it only
      // on the investor's own views: here, when the report uses the same investor's "… Sector Classification" (res.sectorSource)
      const classHead = str(res.headers && res.headers.classification) || 'Classification', whose = (h) => keyOf(h).replace(/(sector)?classification$/, '');
      const hasClass = !!res.sectorSource && whose(classHead) !== '' && whose(classHead) === whose(res.sectorSource) && rows.some((r) => r.classification);
      const head = ['#', 'Name', 'Country', 'Currency', 'Sector', `Nominal\n(in ${S.trim()} eq.)`, 'Format', 'Fixed/\nFloating', 'Residual\nWAL', 'All-in spread\n(bps)', 'Compliance\nwith financial\ncovenants', 'Rating (*)', 'Rating\nchange'].concat(hasClass ? [classHead.replace(/ Classification$/i, '\nClassification')] : []);
      const wts = [0.35, 1.75, 1.05, 0.75, 1.25, 0.95, 0.65, 0.85, 0.75, 0.95, 1.05, 0.75, 0.7].concat(hasClass ? [1.0] : []);
      // the rating against the previous Holdings: "No" when unchanged, and (as the house deck types it) when there is no
      // previous Holdings or the deal is new; Upgrade / Downgrade otherwise
      const change = (r) => { const p = before && before.get(r.code); if (!p || !isNum(p.rating_numeric) || !isNum(r.rating_numeric) || p.rating_numeric === r.rating_numeric) return 'No'; return r.rating_numeric < p.rating_numeric ? 'Upgrade' : 'Downgrade'; };
      // up to 30 rows a page, as the house deck, as many as this deck's content area takes at a legible size (fitRows)
      const HEAD = 0.5, fit = fitRows(K.contentBox(), HEAD, order.length, 30), PER = fit.per;
      const pages = Math.max(1, Math.ceil(order.length / PER));
      for (let k = 0; k < pages; k++) {
        const s = page(`${name} – Asset and performance overview`, 'Asset and performance overview', k === 0 ? `${order.length} instruments in deal order` : '', `(*) In bold and blue represent internal rating; black font represents external rating. ${src}`), b = s.box;
        const sc = b.w / wts.reduce((t, x) => t + x, 0), colW = wts.map((x) => x * sc);
        const part = order.slice(k * PER, (k + 1) * PER), rowH = fit.rowH, fs = fit.fs;
        const body = part.map((r, i) => {
          const rt = tableRating(r), comp = str(r.covenant_compliance) || 'n/a';
          return [String(k * PER + i + 1), nm(r), countryName(r.country), str(r.currency), tableSectorOf(r), `${NF0.format(r.exposure_m)}m`, formatOf(r), str(r.fixed_floating), isNum(r.wal_years) ? NF1.format(r.wal_years) : 'n/a', isNum(r.margin_bps) ? NF0.format(r.margin_bps) : 'n/a',
            { text: comp, color: /^y/i.test(comp) ? C.lgreen || C.green : T.text }, { text: rt.text, bold: true, color: rt.internal ? C.blue || '2D5C99' : T.text }, { text: change(r), color: /down/i.test(change(r)) ? C.red : /up/i.test(change(r)) ? C.lgreen || C.green : C.blue || T.text }].concat(hasClass ? [str(r.classification)] : []);
        });
        K.table(s, { x: b.x, y: b.y, colW, rows: [head].concat(body), rowH, size: fs, padY: 0.005, headerFill: dark, zebra: C.cell, align: colW.map(() => 'center'), rowStyles: { 0: { h: HEAD } } });
        // the closing bar under the last row, in the header colour
        s.rect({ x: b.x, y: b.y + HEAD + part.length * rowH, w: colW.reduce((t, x) => t + x, 0), h: 0.08, fill: dark });
      }
    }

    // ---------- 04 pipeline: both pages left for the team to fill ----------
    sectionPage('04', 'Pipeline', ['Transactions in the pipeline are either IC approved or in IC preparation', 'Guidelines']);
    page('Transaction pipeline', 'Transaction pipeline', 'left blank: pipeline transactions, scheduled repayments and prepayments', '');
    page('Guidelines', `${compartment} Guidelines`, 'left blank: guideline checks', '');

    // ---------- 05 appendix: portfolio monitoring, the asset write-ups (Asset write-ups page), one box per asset ----------
    const mon = Array.isArray(inp.monitoring) ? inp.monitoring.filter((m) => m && str(m.name)) : [];
    sectionPage('05', 'Appendix', [extra.granularity && 'Portfolio granularity', extra.allocation && 'Portfolio allocation', extra.esg && 'ESG ratings', extra.prepayment && 'Prepayment protection', 'Portfolio monitoring'].filter(Boolean));
    if (extra.granularity) granularityPages();
    if (extra.allocation) allocationPages();
    if (extra.esg) esgPages();
    if (extra.prepayment) prepaymentPages();
    if (!mon.length) page('Portfolio monitoring', 'Portfolio Monitoring', 'no asset write-ups: load them on Asset write-ups', '');
    else writeupPages(mon);

    const safe = (t) => String(t).replace(/[^A-Za-z0-9 ._-]+/g, ' ').trim().replace(/\s+/g, '-');
    return { deck, outline: K.outline, filename: `${safe(name)}-investor-report-${safe(quarter || U.isoDate(rd))}.pptx` };

    /**
     * Rows a page of a long table takes on this deck's content area: the largest type (9 pt down to 7 pt) at which the rows
     * wanted (up to `most`) fit between the header row and the source line, a row never shorter than its type needs (so no
     * row grows and pushes the table onto the footer); then the rows share the room evenly, up to 0.27 in each.
     */
    function fitRows(b, HEAD, n, most) {
      const avail = b.h - HEAD - 0.08 - 0.04, want = Math.max(1, Math.min(n || 1, most || 29)), minRow = (f) => (f * 1.22) / 72 + 0.012;
      let fs = [9, 8.5, 8, 7.5, 7].find((f) => Math.floor(avail / minRow(f)) >= want) || 7;
      const per = Math.max(1, Math.min(most || 29, Math.floor(avail / minRow(fs)), n || 1));
      return { per, rowH: Math.min(0.27, avail / Math.max(per, 14)), fs };
    }
    /** A long table over as many pages as it needs, in the asset table's look: header row, banded rows, a closing bar; op.num: a "#" column numbering the rows on from page to page. */
    function longTable(kicker, title, head, wts, body, o) {
      const op = o || {}, HEAD = op.head || 0.42;
      if (op.num) { head = ['#'].concat(head); wts = [0.35].concat(wts); body = body.map((r, i) => [String(i + 1)].concat(r)); }
      const fit = fitRows(K.contentBox(), HEAD, body.length, op.per || 29);
      const PER = fit.per, pages = Math.max(1, Math.ceil(body.length / PER));
      for (let k = 0; k < pages; k++) {
        const s = page(kicker, `${title}${pages > 1 && op.count !== false ? ` (${k + 1}/${pages})` : ''}`, op.note || '', op.source === undefined ? `Sources: ${src.replace(/^Sources?:\s*/i, '')} · AuM defined as funded + unfunded` : op.source), b = s.box;
        const sc = b.w / wts.reduce((t, x) => t + x, 0), colW = wts.map((x) => x * sc), part = body.slice(k * PER, (k + 1) * PER);
        K.table(s, { x: b.x, y: b.y, colW, rows: [head].concat(part), rowH: fit.rowH, size: op.size || fit.fs, padY: 0.005, headerFill: dark, zebra: C.cell, align: op.align || colW.map(() => 'center'), rowStyles: { 0: { h: HEAD } } });
        s.rect({ x: b.x, y: b.y + HEAD + part.length * fit.rowH, w: colW.reduce((t, x) => t + x, 0), h: 0.08, fill: dark });
      }
    }
    /**
     * Portfolio granularity (a group report page): each deal's share of AuM (its tranches together, under the deal's name),
     * largest first, in four Name / Share (%) tables side by side, and a doughnut of every deal with the total in the hole
     * under the last table; more deals than fit carry on over the next page.
     */
    function granularityPages() {
      const dealName = (r) => str(r.asset_group) || str(r.transaction_group) || nm(r);
      const deals = dist(rows, dealName), NF2 = nf(2), share = (v) => (total ? `${NF2.format((v / total) * 100)}%` : '–');
      const HEAD = 0.3, box = K.contentBox(), fit = fitRows(box, HEAD, Math.min(25, deals.length), 25), per = fit.per, gap = 0.25, tw = (box.w - 3 * gap) / 4;
      const d = Math.min(tw - 0.2, box.h * 0.5), lastRows = Math.max(0, Math.floor((box.h - d - 0.25 - HEAD - 0.08) / fit.rowH));
      const pages = []; let i = 0;
      while (i < deals.length || !pages.length) { const cap = pages.length ? 4 * per : 3 * per + lastRows; pages.push(deals.slice(i, i + cap)); i += cap; }
      pages.forEach((list, k) => {
        const s = page('Portfolio granularity', `Aggregated Credit Exposure${pages.length > 1 ? ` (${k + 1}/${pages.length})` : ''}`, k === 0 ? `${deals.length} deals, largest first` : ''), b = s.box;
        for (let j = 0; j < 4; j++) {
          const part = list.slice(j * per, j * per + (k === 0 && j === 3 ? lastRows : per)); if (!part.length) continue;
          const x = b.x + j * (tw + gap);
          K.table(s, { x, y: b.y, colW: [tw * 0.62, tw * 0.38], rows: [['Name', 'Share (%)']].concat(part.map((e) => [e.label, share(e.v)])), rowH: fit.rowH, size: fit.fs, padY: 0.005, headerFill: dark, zebra: C.cell, align: ['center', 'center'], rowStyles: { 0: { h: HEAD } } });
          if (!(k === 0 && j === 3)) s.rect({ x, y: b.y + HEAD + part.length * fit.rowH, w: tw, h: 0.08, fill: dark });
        }
        if (k === 0) {
          const x = b.x + 3 * (tw + gap) + (tw - d) / 2, y = b.y + b.h - d - 0.05;
          donut(s, x, y, d, '', deals, { labels: false, hole: 55 });
          s.text({ x: x + d * 0.2, y: y + d * 0.4, w: d * 0.6, h: d * 0.2, text: `${ccy} ${NF0.format(total)}m`, size: 14, bold: true, color: teal, align: 'center', valign: 'middle', inset: 0 });
        }
      });
    }
    /**
     * The entities a view is made of, as its own reports list them: its investor columns in their order, except that the
     * columns another view adds up whole (e.g. Region A = two countries, each at 100 %) are one entity under that view's
     * name, where its first member stands. Each with its members' weights: full(r) the entity's own amount in an asset,
     * share(r) the view's part of it, weighted the view's part over the portfolio.
     */
    function entities() {
      const comp = ((res.platform && res.platform.composition) || []).filter((c) => c.label !== '*' && c.weight > 0), labels = new Set(comp.map((c) => c.label));
      const pid = res.platform && res.platform.id;
      const views = (res.platforms || []).filter((p) => p.id !== pid && !p.isGroup && !p.lookThroughOf && p.composition.length >= 2 && p.composition.every((c) => labels.has(c.label) && Math.abs(c.weight - 1) < 1e-9))
        .sort((a, b) => b.composition.length - a.composition.length);
      const used = new Set(), out = [];
      for (const c of comp) {
        if (used.has(c.label)) continue;
        const v = views.find((p) => p.composition.some((x) => x.label === c.label) && p.composition.every((x) => !used.has(x.label)));
        const members = v ? v.composition.map((x) => comp.find((y) => y.label === x.label)) : [c];
        members.forEach((m) => used.add(m.label)); out.push({ label: v ? v.label : c.label, members });
      }
      const amt = (r, l) => (r.investors || {})[l] || 0;
      out.forEach((e) => { e.full = (r) => e.members.reduce((t, m) => t + amt(r, m.label), 0); e.share = (r) => e.members.reduce((t, m) => t + amt(r, m.label) * m.weight, 0); e.weighted = rows.reduce((t, r) => t + e.share(r), 0); });
      return out;
    }
    /**
     * Portfolio allocation (a group report page): each asset's exposure by the entities the view is made of, each column the
     * entity's own amount (a fund in full, as the group's own allocation table shows it), "-" where it holds none, and in the
     * last column, in bold, the view's total (funds at the view's share).
     */
    function allocationPages() {
      let ents = entities();
      if (!ents.length) { const order = (res.investors || []).map((i) => i.label), rank = (l) => { const i = order.indexOf(l); return i < 0 ? 1e9 : i; }; ents = U.uniq(rows.flatMap((r) => Object.keys(r.investors || {}))).sort((a, b) => rank(a) - rank(b)).map((label) => ({ label, full: (r) => (r.investors || {})[label] || 0 })); }
      // more entities than fit across the page: those holding nothing in the view are left out
      if (ents.length > 18) ents = ents.filter((e) => rows.some((r) => e.full(r) > 0));
      const cell = (v) => (isNum(v) && v > 0.0005 ? `${NF0.format(v)}m` : '-');
      const body = dealOrder(rows).map((r) => [nm(r)].concat(ents.map((e) => cell(e.full(r))), [{ text: cell(r.exposure_m), bold: true }]));
      const head = ['Name'].concat(ents.map((e) => e.label), [name]);
      longTable(`${name} – Portfolio allocation`, 'Portfolio allocation', head, [1.7].concat(ents.map(() => 0.85), [1]), body, { note: `${rows.length} instruments by entity`, count: true, head: 0.5 });
    }
    /**
     * ESG ratings (a group report page): the ESG Hardcoded scores of each deal the view holds, one row per deal under the deal's
     * name (its tranches as one, unless their scores differ), in deal order, in two tables side by side; "Yes" under Green
     * asset when the deal has a CBI sector (a blank, "n/a", "None", "Not …" or "Non-…" is no sector).
     */
    function esgPages() {
      const dealName = (r) => str(r.asset_group) || str(r.transaction_group) || nm(r), f1 = (v) => (isNum(v) ? NF1.format(v) : '-');
      const seen = new Map();
      for (const r of dealOrder(rows)) { const e = (r.asset && r.asset.esg) || {}, key = `${dealName(r)}|${[e.e_score, e.s_score, e.g_score, e.esg_score].join('|')}`; if (!seen.has(key)) seen.set(key, { name: dealName(r), e }); }
      const list = Array.from(seen.values());
      const green = (e) => { const v = str(e.chi_sector); return v && !/^(n\/?a|none|no|nil|false|0|-+|not\b|non\b|non-|ineligible|excluded)/i.test(v) ? 'Yes' : ''; };
      const head = ['Asset', 'E score', 'S score', 'G score', 'ESG Score', 'Green asset'], wts = [1.9, 0.8, 0.8, 0.8, 0.9, 0.9];
      const rowOf = (x) => [x.name, f1(x.e.e_score), f1(x.e.s_score), f1(x.e.g_score), f1(x.e.esg_score), green(x.e)];
      const HEAD = 0.3, fit = fitRows(K.contentBox(), HEAD, Math.ceil(list.length / 2), 30), PER = fit.per, pages = Math.max(1, Math.ceil(list.length / (2 * PER)));
      for (let k = 0; k < pages; k++) {
        const s = page(`${name} – ESG ratings`, `ESG Ratings${pages > 1 ? ` (${k + 1}/${pages})` : ''}`, k === 0 ? `${list.length} deals` : '', `*Definition: Loans categorized in beneficial sectors defined by the CBI (Climate Bond Initiative). ${src}`), b = s.box;
        const tw = (b.w - 0.5) / 2, sc = tw / wts.reduce((t, x) => t + x, 0), colW = wts.map((x) => x * sc);
        [0, 1].forEach((j) => {
          const part = list.slice((2 * k + j) * PER, (2 * k + j + 1) * PER); if (!part.length) return;
          const x = b.x + j * (tw + 0.5);
          K.table(s, { x, y: b.y, colW, rows: [head].concat(part.map(rowOf)), rowH: fit.rowH, size: fit.fs, padY: 0.005, headerFill: dark, zebra: C.cell, align: ['left', 'center', 'center', 'center', 'center', 'center'], rowStyles: { 0: { h: HEAD } } });
          s.rect({ x, y: b.y + HEAD + part.length * fit.rowH, w: tw, h: 0.08, fill: dark });
        });
      }
    }
    /**
     * Prepayment protection (a group report page): each instrument's protection (Hardcoded › Prepayment protection), close,
     * final maturity, end of protection (Hardcoded › End of NC / MW) and the share of its life protected; its repayment profile;
     * and whether a make-whole fee can be earned: not on a floating rate, a currency other than the euro, or a WAL at acquisition
     * under 8 years (the current WAL plus the years since funding).
     */
    function prepaymentPages() {
      const yrs = (a, b) => (b - a) / (365.25 * 86400000);
      const body = dealOrder(rows).map((r) => {
        const close = toDate(r.financial_close) || toDate(r.funding_date), mat = toDate(r.maturity_date), endRaw = r.asset ? r.asset.attrs.protection_end_date : '', end = toDate(endRaw);
        // the share of the life protected as the workbook works it out: (end of protection − funding) ÷ (maturity − funding)
        const from = toDate(r.funding_date) || close, share = from && mat && end && mat > from ? Math.max(0, Math.min(1, yrs(from, end) / yrs(from, mat))) : NaN;
        const since = toDate(r.funding_date) || close, walAcq = isNum(r.wal_years) && since && okDate(rd) ? r.wal_years + Math.max(0, yrs(since, rd)) : NaN;
        const why = r.fixed_floating === 'Floating' ? 'Floating' : str(r.currency) && str(r.currency) !== 'EUR' && str(r.currency) !== 'Multi' ? `Denomination in ${str(r.currency)}` : isNum(walAcq) && walAcq < 8 ? 'WAL at acquisition <8' : '';
        // the protection as the house table words it: the description alone ("Make whole at MS + 50 bps"), without the
        // Yes / No it follows in Hardcoded; "n/a" where there is none
        const raw = (r.asset && str(r.asset.attrs.prepayment_protection)) || '', m = raw.match(/^(yes|no)\s*(?:[;:,–-]\s*(.*))?$/i);
        const rest = m ? str(m[2]) : raw, prot = !raw || /^(none|n\/?a|-+)$/i.test(raw) || (m && /^no$/i.test(m[1]) && (!rest || /^n\/?a$/i.test(rest))) ? 'n/a' : rest && !/^n\/?a$/i.test(rest) ? rest : m && /^yes$/i.test(m[1]) ? 'Yes' : 'n/a';
        return [nm(r), prot, dmy(close) || 'n/a', dmy(mat) || 'n/a', end ? dmy(end) : str(endRaw) || 'n/a', isNum(share) ? pct0(share) : 'n/a', /^amorti/i.test(str(r.repayment_type)) ? 'Amortizing' : str(r.repayment_type) || 'n/a', why ? 'No' : 'Yes', why || '-'];
      });
      const head = ['Name', 'Prepayment protection', 'Financial close', 'Final maturity', 'End of protection', '% of time protected', 'Amortizing / Bullet', 'Eligible for MW fee', 'Reason for non-eligibility'];
      longTable(`${name} – Prepayment protection`, 'Prepayment protection', head, [1.3, 2.8, 0.95, 0.95, 1.05, 1, 1.05, 1, 1.6], body, { note: `${rows.length} instruments in deal order`, num: true });
    }

    /**
     * The write-ups as the monitoring pages of the house deck: a header bar in the deck's dark green (Ref., Name, Description
     * and recent events) over a pale tinted box; on the left the ref, the name in bold and the ratios in white boxes under
     * Actual, Lock-up and Covenant with the rating under them (one rating across the three); on the right the description
     * in bold, then the recent events as small dark ► bullets, justified, an "… impact" line in bold. A write-up too long
     * for one page carries on over the next; the title counts pages: Portfolio Monitoring (k/N).
     */
    function writeupPages(list) {
      const asOf = okDate(rd) ? U.isoDate(rd).split('-').reverse().join('/') : '';
      const srcLine = `Source: internal data and companies' documents as at ${asOf}`;
      const plan = [];
      list = list.map((m) => R.tidyWriteup(m));
      list.forEach((m, k) => {
        const ev = (m.events || []).map(str).filter(Boolean), desc = str(m.description);
        const chars = ev.join(' ').length + desc.length, fs = chars > 3200 ? 7 : chars > 2200 ? 7.5 : 8;
        // lines a paragraph takes in the text column (~6.9 in wide on a 13.33 in page: 1 char ≈ 0.5 em)
        const perLine = Math.max(30, Math.floor((6.9 * 72) / (fs * 0.5))), linesOf = (t) => Math.max(1, Math.ceil(t.length / perLine));
        const boxH = (deck.template ? deck.template.pages[deck.template.kinds.content].box.h : 5.55) - 0.3 - 0.6, room = Math.floor((Math.max(2, boxH) * 72) / (fs * 1.32)); // lines that fit under the header bar in the page's free area
        const paras = (desc ? [{ t: desc, kind: 'desc' }] : []).concat(ev.map((t) => ({ t, kind: /^(neutral|positive|negative|no|limited|material)\b[^:]{0,24}impact\b|^impact\s*:/i.test(t) ? 'impact' : 'event' })));
        let cur = [], used = 0;
        for (const p of paras) { const n = linesOf(p.t) + 0.3; if (cur.length && used + n > room) { plan.push({ m, k, paras: cur, fs, cont: plan.length && plan[plan.length - 1].m === m }); cur = []; used = 0; } cur.push(p); used += n; }
        plan.push({ m, k, paras: cur, fs, cont: plan.length && plan[plan.length - 1].m === m });
      });
      plan.forEach((pg, i) => {
        const m = pg.m, s = page('Portfolio monitoring', `Portfolio Monitoring (${i + 1}/${plan.length})`, m.name, srcLine), b = s.box;
        const hb = 0.3, ink = T.text, lw = b.w * 0.435, x0 = b.x;
        s.rect({ x: x0, y: b.y, w: b.w, h: hb, fill: dark });
        s.text({ x: x0 + 0.15, y: b.y, w: 0.7, h: hb, text: 'Ref.', size: 9, bold: true, color: 'FFFFFF', valign: 'middle', inset: 0 });
        s.text({ x: x0 + 0.85, y: b.y, w: 1.6, h: hb, text: 'Name', size: 9, bold: true, color: 'FFFFFF', valign: 'middle', inset: 0 });
        s.text({ x: x0 + lw, y: b.y, w: b.w - lw, h: hb, text: 'Description and recent events', size: 9, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', inset: 0 });
        // the tinted box: as tall as what it holds
        const mets = pg.cont ? [] : (m.metrics || []).slice(0, 12), hasRating = !pg.cont; // up to 12 ratio rows (the box grows with them); // the Rating row always, under the ratios
        const leftH = 0.5 + (mets.length + (hasRating ? 1 : 0)) * 0.3 + 0.2;
        const perLine = Math.max(30, Math.floor(((b.w - lw - 0.25) * 72) / (pg.fs * 0.47)));
        const textH = pg.paras.reduce((t, p) => t + Math.max(1, Math.ceil(p.t.length / perLine)) * pg.fs * 1.2 / 72 + 0.02, 0.22);
        const boxH = Math.min(b.h - hb, Math.max(leftH, textH, 0.9));
        s.rect({ x: x0, y: b.y + hb, w: b.w, h: boxH, fill: C.tgreen || C.cell });
        const y0 = b.y + hb + 0.12;
        s.text({ x: x0 + 0.15, y: y0, w: 0.7, h: 0.25, text: str(m.ref) || `${pg.k + 1}/${list.length}`, size: 8.5, color: ink, inset: 0 });
        const cx = x0 + b.w * 0.205; // the Actual column starts here; ratio labels end here
        const nameW = cx - (x0 + 0.85) - 0.05, nmText = pg.cont ? `${m.name} (continued)` : m.name;
        s.text({ x: x0 + 0.85, y: y0, w: Math.max(0.8, nameW), h: 0.25, text: nmText, size: nmText.length * 0.075 > nameW ? 7.5 : 8.5, bold: true, color: ink, inset: 0 });
        if (!pg.cont) {
          const vw = b.w * 0.075, lab = 1.5;
          ['Actual', 'Lock-up', 'Covenant'].forEach((t, j) => s.text({ x: cx + j * vw, y: y0, w: vw, h: 0.25, text: t, size: 8, italic: true, color: ink, align: 'center', inset: 0 }));
          mets.forEach((mt, r) => {
            const y = y0 + 0.3 + r * 0.3;
            s.text({ x: cx - lab - 0.05, y, w: lab, h: 0.3, text: mt.label, size: 8, italic: true, color: ink, align: 'right', valign: 'middle', inset: 0 });
            [mt.actual, mt.lockup, mt.covenant].forEach((v, j) => s.text({ x: cx + j * vw, y, w: vw, h: 0.3, text: str(v), size: 8, italic: true, color: ink, align: 'center', valign: 'middle', inset: 0, fill: 'FFFFFF', line: ink, lineW: 0.75 }));
          });
          // the Rating row: the word under the ratio names, the rating under the middle of the three columns (as on the slide), never boxed
          const y = y0 + 0.3 + mets.length * 0.3;
          s.text({ x: cx - lab - 0.05, y, w: lab, h: 0.3, text: 'Rating', size: 8, italic: true, color: ink, align: 'right', valign: 'middle', inset: 0 });
          if (str(m.rating)) s.text({ x: cx, y, w: vw * 3, h: 0.3, text: str(m.rating), size: 8, italic: true, color: ink, align: 'center', valign: 'middle', inset: 0 });
        }
        // the description in bold, then the events as small dark ► bullets, justified; the "… impact" line in bold
        const bullet = { char: '\u25BA', color: ink, size: 60, indent: 0.12 };
        s.text({ x: x0 + lw, y: y0 - 0.04, w: b.w - lw - 0.1, h: boxH - 0.1, inset: 0.03, size: pg.fs, color: ink,
          paras: pg.paras.map((p) => p.kind === 'desc' ? { runs: [{ text: p.t, bold: true }], size: pg.fs, spaceAfter: 3 } : { runs: [{ text: p.t, bold: p.kind === 'impact', color: p.kind === 'impact' ? teal : undefined }], size: pg.fs, bullet, align: 'justify', spaceAfter: 1 }) });
      });
    }

    /**
     * Europe on the panel: every European country in view (cut at the panel's edges), the invested ones shaded by size
     * (darkest = largest), the others in the map grey, white borders; the share on each invested country and the amounts
     * listed on the right, over the map's eastern edge.
     */
    function drawMap(s, x, y, w, h, list) {
      // country shapes: the Europe extract (Natural Earth 1:50m, data/europe-map.js), else the coarse world map; names → ISO codes by the world map
      const WM = Scope.worldMap, EM = Scope.europeMap && Scope.europeMap.paths ? Scope.europeMap : null, SH = EM || WM; if (!WM || !SH || !SH.paths) return;
      const byIso = new Map(); for (const r of list) { const iso = WM.iso && WM.iso(r.country); const k = iso || 'other:' + str(r.country); const e = byIso.get(k) || { iso: iso || '', isos: iso ? [iso] : [], label: countryName(r.country) || 'Not set', v: 0 }; e.v += r.exposure_m; byIso.set(k, e); }
      // Belgium, the Netherlands and Luxembourg are one entry, Benelux, as in the workbook's country table (one shade on the map, the share on the largest)
      const bnl = ['BE', 'NL', 'LU'].map((i) => byIso.get(i)).filter(Boolean).sort((a, b) => b.v - a.v);
      if (bnl.length) { bnl.forEach((e) => byIso.delete(e.iso)); byIso.set('BENELUX', { iso: bnl[0].iso, isos: bnl.map((e) => e.iso), label: 'Benelux', v: bnl.reduce((t, e) => t + e.v, 0) }); }
      const ranked = Array.from(byIso.values()).sort((a, b) => b.v - a.v);
      // each country its own colour, largest first, as the house deck colours them (the theme's run: Background 2, then Accent 2,
      // Accent 1, Accent 4 and Text 2 in turn), the same in the list and on the map
      const cat = K.named.cat(ranked.length);
      const colour = new Map(ranked.map((e, k) => [e, cat[k]]));
      const colourOf = (iso) => { const e = ranked.find((q) => q.isos.includes(iso)); return e ? colour.get(e) : null; };
      const EUROPE = ['PT', 'ES', 'FR', 'GB', 'IE', 'BE', 'NL', 'LU', 'DE', 'CH', 'AT', 'IT', 'DK', 'SE', 'FI', 'NO', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'GR', 'RO', 'BG', 'EE', 'LV', 'LT',
        'BA', 'RS', 'ME', 'MK', 'AL', 'XK', 'MD', 'BY', 'UA', 'CY', 'MT', 'IS', 'RU', 'TR', 'LI', 'AD', 'MC', 'SM', 'GE', 'AM', 'AZ', 'KZ'];
      const FRAME = ['PT', 'ES', 'IE', 'GB', 'NO', 'SE', 'FI', 'EE', 'DE', 'PL', 'FR', 'IT'];
      const polys = (iso) => svgPolys(SH.paths[iso] || '').filter((p) => p.length > 2);
      const bbox = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [px, py] of pts) { a = Math.min(a, px); b = Math.min(b, py); c = Math.max(c, px); d = Math.max(d, py); } return [a, b, c, d]; };
      const area = (p) => { const q = bbox(p); return (q[2] - q[0]) * (q[3] - q[1]); };
      const mainland = (iso) => polys(iso).sort((p, q) => area(q) - area(p))[0];
      // the frame: western and northern Europe, widened to take in any invested European country
      const inEurope = ranked.flatMap((e) => e.isos).filter((i) => EUROPE.includes(i) && i !== 'RU' && i !== 'TR' && i !== 'KZ');
      const fb = bbox(FRAME.concat(inEurope).map(mainland).filter(Boolean).flat());
      if (!isFinite(fb[0])) return;
      const legendW = Math.min(1.45, w * 0.24), mapW = w - legendW - 0.25, pad = 0.12;
      const fw = (fb[2] - fb[0]) * 1.04, fh = (fb[3] - fb[1]) * 1.04, k = Math.min((mapW - 2 * pad) / fw, (h - 2 * pad) / fh);
      // the part of the map the panel shows (map units): the frame centred in the area left of the legend, running on under it
      const cx = (fb[0] + fb[2]) / 2, cy = (fb[1] + fb[3]) / 2;
      const vx0 = cx - (mapW / 2) / k, vy0 = cy - (h / 2) / k, vx1 = vx0 + w / k, vy1 = vy0 + h / k;
      /** A closed polygon cut to the view rectangle (Sutherland–Hodgman). */
      const clip = (pts) => {
        let out = pts;
        const edge = (inside, cut) => { const src = out; out = []; for (let i = 0; i < src.length; i++) { const a = src[i], b = src[(i + 1) % src.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); } };
        const at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        edge((p) => p[0] >= vx0, (a, b) => at(a, b, (vx0 - a[0]) / (b[0] - a[0])));
        if (out.length) edge((p) => p[0] <= vx1, (a, b) => at(a, b, (vx1 - a[0]) / (b[0] - a[0])));
        if (out.length) edge((p) => p[1] >= vy0, (a, b) => at(a, b, (vy0 - a[1]) / (b[1] - a[1])));
        if (out.length) edge((p) => p[1] <= vy1, (a, b) => at(a, b, (vy1 - a[1]) / (b[1] - a[1])));
        return out;
      };
      /** One round of corner cutting (Chaikin): the coarse world map's outlines drawn smoother (the Europe extract needs none). */
      const smooth = (pts) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return out; };
      const toX = (px) => x + (px - vx0) * k, toY = (py) => y + (py - vy0) * k, sc = 20;
      const drawn = [];
      const drawList = EM ? Object.keys(EM.paths) : EUROPE.concat(inEurope.filter((i) => !EUROPE.includes(i)));
      for (const iso of drawList) {
        const ps = polys(iso).map((p) => clip(!EM && area(p) * k * k > 0.004 ? smooth(p) : p)).filter((p) => p.length > 2 && area(p) * k * k > 0.0004);
        if (!ps.length) continue;
        const bb = bbox(ps.flat()), fill = colourOf(iso) || C.map || 'CFCBC2';
        s.freeform({ name: iso, x: toX(bb[0]), y: toY(bb[1]), w: Math.max(0.01, (bb[2] - bb[0]) * k), h: Math.max(0.01, (bb[3] - bb[1]) * k), pw: (bb[2] - bb[0]) * sc, ph: (bb[3] - bb[1]) * sc,
          paths: ps.map((p) => p.map(([px, py]) => [(px - bb[0]) * sc, (py - bb[1]) * sc])), fill, line: 'FFFFFF', lineW: 0.4 });
        drawn.push({ iso, ps });
      }
      /** The point of a polygon farthest from its edges (a grid search, then a finer one round the best), where a label fits best. */
      const inmost = (poly) => {
        const inside = (x0, y0) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y0) !== (yj > y0) && x0 < ((xj - xi) * (y0 - yi)) / (yj - yi) + xi) c = !c; } return c; };
        const edge = (x0, y0) => { let d = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x0 - ax) * dx + (y0 - ay) * dy) / L)) : 0; d = Math.min(d, Math.hypot(x0 - ax - t * dx, y0 - ay - t * dy)); } return d; };
        const bb = bbox(poly); let best = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], bd = -1;
        const scan = (x0, y0, x1, y1, n) => { for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { const x2 = x0 + (x1 - x0) * i / n, y2 = y0 + (y1 - y0) * j / n; if (!inside(x2, y2)) continue; const d = edge(x2, y2); if (d > bd) { bd = d; best = [x2, y2]; } } };
        scan(bb[0], bb[1], bb[2], bb[3], 16); const cw = (bb[2] - bb[0]) / 16, ch = (bb[3] - bb[1]) / 16; scan(best[0] - cw, best[1] - ch, best[0] + cw, best[1] + ch, 8);
        return best.concat([bd]);
      };
      // the share on each invested country (where it fits best on its largest piece in view)
      // (Benelux: on whichever invested member has the most room for it, so not on Luxembourg beside the Netherlands)
      for (const e of ranked) {
        if (!total || e.v / total < 0.02) continue;
        const spots = drawn.filter((q) => e.isos.includes(q.iso)).map((c) => inmost(c.ps.slice().sort((p, q) => area(q) - area(p))[0])).sort((a, b) => b[2] - a[2]);
        if (!spots.length) continue;
        const [px, py, room] = spots[0], lx = toX(px), ly = toY(py), txt = pct0(e.v / total);
        if (lx > x + mapW) continue;
        // white on the country, or the text colour when the label is wider than the land under it (it runs onto the sea)
        s.text({ x: lx - 0.3, y: ly - 0.11, w: 0.6, h: 0.22, text: txt, size: 8, bold: true, color: room * k < txt.length * 0.035 ? T.text : inkOn(colour.get(e), C), align: 'center', valign: 'middle', inset: 0 });
      }
      // the amounts, top right
      // every country listed, the boxes shorter when there are many (down to 0.32 in); "Other" only past that
      const rowH = Math.max(0.32, Math.min(0.46, (h - 0.2) / Math.max(1, ranked.length))), rowsFit = Math.max(1, Math.floor((h - 0.2) / rowH));
      const shown = ranked.length > rowsFit ? ranked.slice(0, rowsFit - 1).concat([{ iso: '', label: `Other (${ranked.length - rowsFit + 1})`, v: ranked.slice(rowsFit - 1).reduce((t, e) => t + e.v, 0), other: true }]) : ranked;
      shown.forEach((e, j) => { const col = e.other ? C.slate : colour.get(e); s.text({ x: x + w - legendW - 0.12, y: y + 0.12 + j * rowH, w: legendW, h: rowH - 0.05, fill: col, line: 'FFFFFF', lineW: 0.75, inset: 0.02, valign: 'middle', paras: [{ text: e.label, size: 9, bold: true, color: inkOn(col, C), align: 'center' }, { text: mm(e.v), size: 9, bold: true, color: inkOn(col, C), align: 'center' }] }); });
    }
  };

  /** Polygons of an SVG path made of M/L/H/V/Z (absolute and relative), as [[x, y], …] lists. */
  function svgPolys(d) {
    const out = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0;
    const re = /([MLHVZmlhvz])([^MLHVZmlhvz]*)/g; let m;
    const start = () => { cur = [[x, y]]; out.push(cur); sx = x; sy = y; };
    while ((m = re.exec(d))) {
      const c = m[1], n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
      if (c === 'M' || c === 'm') { for (let i = 0; i + 1 < n.length; i += 2) { if (c === 'M') { x = n[i]; y = n[i + 1]; } else { x += n[i]; y += n[i + 1]; } if (i === 0) start(); else cur.push([x, y]); } continue; }
      if (c === 'Z' || c === 'z') { x = sx; y = sy; cur = null; continue; }
      if (!cur) start();
      if (c === 'L' || c === 'l') for (let i = 0; i + 1 < n.length; i += 2) { if (c === 'L') { x = n[i]; y = n[i + 1]; } else { x += n[i]; y += n[i + 1]; } cur.push([x, y]); }
      else if (c === 'H' || c === 'h') for (const v of n) { x = c === 'H' ? v : x + v; cur.push([x, y]); }
      else if (c === 'V' || c === 'v') for (const v of n) { y = c === 'V' ? v : y + v; cur.push([x, y]); }
    }
    return out;
  }
  R.svgPolys = svgPolys;

  // ---------- inputs: the monitoring workbook and the public-market curves ----------
  const cellText = (v) => (v === null || v === undefined ? '' : String(v).replace(/\r/g, '').trim());
  const BULLET = /^\s*(?:[•▪▸►▶‣◦·*]+|[–-](?=\s))\s*/; // a bullet mark, or a dash followed by a space ("-3% revenue" keeps its minus)
  /**
   * A ratio cell as the workbook shows it: read with its number format it is text already ("6.62x", "565", "70%", "EUR 668")
   * and is kept as it is; a bare number (a workbook read without formats) is shown as Excel's General format would, no unit added.
   */
  function ratio(v) {
    if (typeof v !== 'number' || !isFinite(v)) return cellText(v);
    return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(10)));
  }
  /**
   * Asset write-ups (one sheet's rows) → [{ ref, name, description, metrics, rating, rating_cells, events }]. A box per asset
   * laid out like the monitoring slide: a row with the words Actual, Lock-up and Covenant marks each box (the asset's name to
   * their left, on that row or above it); the rows under it hold a ratio name (in the name's column or the next) and its values,
   * then a Rating row that closes the box; everything right of Covenant is the description and recent events (one cell with
   * line breaks, or a cell a row; the first line is the description when it is short). Values are kept as the workbook shows
   * them (read with their number formats: 6.62x, 565, 70%), nothing added. Header rows (Ref., Name, Description …) are skipped. With no Actual / Covenant rows at all, one row per asset
   * under a header row (Ref, Name, Description, Recent events) is read instead.
   */
  const REFLIKE = /^(\d{1,3}\s*\/\s*\d{1,3}|\d{1,3}|ref\.?)$/i;
  const RATING_LABEL = /\bratings?\b/i;
  /** A credit rating as typed (BBB-, A (Internal), - / BBB+ / -, NR …): letters only, no ratio or percentage. */
  const RTOK = '\\(?(?:AAA|AA|A|BBB|BB|B|CCC|CC|C|D|Aaa|Aa|Baa|Ba|Caa|Ca|NR|WR|SD)[+-]?[123]?\\)?';
  const RATING_RE = new RegExp(`^[\\s/–-]*${RTOK}(?:\\s*\\((?:internal|shadow|implied|est\\.?)\\))?(?:[\\s/–-]+(?:${RTOK})?)*$`, 'i');
  const ratingLike = (t) => { const v = cellText(t); if (!v || /\d\s*x\b|%|\d[.,]\d/i.test(v)) return false; return RATING_RE.test(v) || /\b(internal|shadow)\b.*\b(rating|[A-D]{1,3}[+-]?)|\b[A-D]{1,3}[+-]?\s*\((internal|shadow)\)|^not rated$|^n\.?r\.?$/i.test(v); };
  /** One rating from the cells of a Rating row: the one filled, or the filled ones joined (- for a blank between); "Rating:" dropped. */
  const ratingOf = (cells) => { const c = cells.map((v) => cellText(v).replace(/^ratings?\s*[:\-–]\s*/i, '')), f = c.filter(Boolean); if (f.length <= 1) return f[0] || ''; const a = c.findIndex(Boolean), b = c.length - 1 - c.slice().reverse().findIndex(Boolean); return c.slice(a, b + 1).map((v) => v || '-').join(' / '); };
  const RATIO_WORD = /ebitda|icr|dscr|llcr|nlcr|plcr|cover|ratio|leverage|ltv|ltc|gearing|debt|interest|service|lock|covenant|yield|margin|nav|loan|\bx$/i;
  R.parseMonitoring = function (grid) {
    const rows = (grid || []).map((r) => (r || []).slice());
    const txt = (i, j) => cellText((rows[i] || [])[j]);
    const isHead = (r) => r.some((v) => /^(ref\.?|name|asset|transaction|project)$/i.test(cellText(v))) && r.some((v) => /description|event|comment|update/i.test(cellText(v)));
    const marksOf = (i) => { const o = { act: -1, lock: -1, cov: -1 }; (rows[i] || []).forEach((v, j) => { const t = cellText(v).toLowerCase(); if (o.act < 0 && /^actuals?\b/.test(t)) o.act = j; else if (o.lock < 0 && /^lock[\s-]*ups?\b/.test(t)) o.lock = j; else if (o.cov < 0 && /^covenants?\b/.test(t)) o.cov = j; }); return o.act >= 0 && (o.cov >= 0 || o.lock >= 0) ? o : null; };
    const colsOf = (m) => { const vc = [m.act, m.lock, m.cov].filter((j) => j >= 0); return Object.assign({ v0: Math.min.apply(null, vc), v1: Math.max.apply(null, vc) }, m); };
    const firstMarks = rows.findIndex((r, i) => marksOf(i));
    if (firstMarks < 0) return tableWriteups(rows, isHead);
    let cols = colsOf(marksOf(firstMarks));
    const lines = (arr) => arr.join('\n').split('\n').map((t) => t.replace(BULLET, '').trim()).filter(Boolean);
    // on row i: the texts right of the values (description and events), the ratio label (nearest text left of the values, not
    // a ref), the name and ref left of the values (first text, first ref-like text)
    const right = (i) => { const r = rows[i] || [], o = []; for (let j = cols.v1 + 1; j < r.length; j++) { const t = cellText(r[j]); if (t && !/^description( and recent events)?$/i.test(t)) o.push(t); } return o; };
    const labelOf = (i) => { for (let j = cols.v0 - 1; j >= 0; j--) { const t = txt(i, j); if (t && !REFLIKE.test(t)) return t; } return ''; };
    const leftOf = (i) => { let name = '', ref = ''; for (let j = 0; j < cols.v0; j++) { const t = txt(i, j); if (!t) continue; if (REFLIKE.test(t)) { if (!ref && !/^ref/i.test(t)) ref = t; } else if (!name) name = t; } return { name, ref }; };
    const out = []; let cur = null, closed = true, buf = [];
    // a new box; text met between two boxes goes to the earlier one when the new one has text on its own first row, else to the new one
    const open = (i, name, ref) => {
      const own = right(i); let lead = [];
      if (buf.length) { if (own.length && cur) cur._t.push(...buf); else lead = buf; buf = []; }
      cur = { ref, name, description: '', metrics: [], rating: '', rating_cells: [], events: [], _t: lead.concat(own) }; out.push(cur); closed = false;
    };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || []; if (!r.some((v) => cellText(v))) continue;
      const m = marksOf(i);
      if (isHead(r)) { if (m) cols = colsOf(m); if (cur && buf.length) cur._t.push(...buf); buf = []; cur = null; closed = true; continue; }
      if (m) { // the Actual / Lock-up / Covenant row: a box's first row (its name to the left), or the row under a name in a merged cell
        cols = colsOf(m); const L = leftOf(i);
        if (L.name && !/^(name|asset)$/i.test(L.name)) open(i, L.name, L.ref);
        else if (cur && !closed && !cur.metrics.length && !cur.rating) cur._t.push(...right(i));
        else open(i, '', L.ref);
        continue;
      }
      const lab = labelOf(i), vals = [cols.act, cols.lock, cols.cov].map((j) => (j >= 0 ? r[j] : null)), has = vals.some((v) => cellText(v)), txts = right(i);
      if (RATING_LABEL.test(lab)) { // the Rating row closes the box; its rating is read from this row, else from the row right under it
        if (cur) {
          const span = (k) => { const c = [cols.act, cols.lock, cols.cov].map((j) => (j >= 0 ? cellText((rows[k] || [])[j]) : '')); if (!c.some(Boolean)) for (let j = cols.v0; j <= cols.v1; j++) if (txt(k, j)) return [txt(k, j)]; return c; };
          let cells = span(i);
          if (!cells.some(Boolean) && i + 1 < rows.length && !marksOf(i + 1) && !labelOf(i + 1) && span(i + 1).filter(Boolean).every(ratingLike) && span(i + 1).some(Boolean)) { cells = span(i + 1); cur._t.push(...right(i + 1)); i++; }
          if (!cur.rating && cells.some(Boolean)) cur.rating = ratingOf(cells);
          cur._t.push(...txts);
        }
        closed = true; continue;
      }
      // a rating on its own right under the Rating row (in the name column) is that box's rating, not a new box
      if (closed && cur && lab && ratingLike(lab) && !has && !txts.length) { if (!cur.rating) cur.rating = ratingOf([lab]); continue; }
      // a name after a closed box (or a word that is no ratio after a box's ratios) starts the next box
      if (lab && (closed || !cur || (!has && cur.metrics.length && !RATIO_WORD.test(lab)))) { open(i, lab, leftOf(i).ref); continue; }
      if (cur && !closed && (lab || has)) cur.metrics.push({ label: lab, actual: ratio(vals[0], lab), lockup: ratio(vals[1], lab), covenant: ratio(vals[2], lab) });
      if (txts.length) { if (closed || !cur) buf.push(...txts); else cur._t.push(...txts); }
    }
    if (cur && buf.length) cur._t.push(...buf);
    for (const a of out) {
      R.tidyWriteup(a, true);
      // the first line is the description when it is short; the rest are the recent events (bullet marks dropped)
      const L = lines(a._t); delete a._t;
      if (L.length > 1 && L[0].length <= 160) { a.description = L[0]; a.events = L.slice(1); }
      else if (L.length === 1 && L[0].length <= 140) a.description = L[0];
      else a.events = L;
    }
    // a box with nothing filled in (a blank template) is no write-up
    return out.filter((a) => a.name && (a.description || a.events.length || a.rating || a.metrics.some((x) => x.actual || x.lockup || x.covenant)));
  };
  /**
   * A write-up as the slide shows it: a ratio row that is really the rating (its name says rating, or it holds nothing but a
   * rating, whatever its name) becomes the box's rating (when it has none) and leaves the ratio rows; "Rating:" is dropped from the
   * rating; the rating sits under the middle column, whatever column the workbook put it in. Only the write-up's own rows are
   * looked at. A copy (or the write-up itself when inPlace).
   */
  R.tidyWriteup = function (m, inPlace) {
    const a = inPlace ? m : Object.assign({}, m);
    let rating = ratingOf([a.rating]);
    const vals = (x) => [x.actual, x.lockup, x.covenant].map(cellText).filter(Boolean);
    // a row named Rating, or any row that holds nothing but a rating (whatever its name says), is the rating, not a ratio
    const labelled = (x) => RATING_LABEL.test(cellText(x.label)), stray = (x) => !labelled(x) && vals(x).length > 0 && vals(x).every(ratingLike);
    // a row named Rating before a stray one
    for (const x of (a.metrics || []).filter(labelled).concat((a.metrics || []).filter(stray))) if (!rating && vals(x).length) rating = ratingOf([x.actual, x.lockup, x.covenant]);
    a.metrics = (a.metrics || []).filter((x) => !labelled(x) && !stray(x));
    a.rating = rating; a.rating_cells = rating ? ['', rating, ''] : [];
    return a;
  };
  /** One row per asset under a header row (Ref, Name, Description, Recent events): the shape with no ratio boxes. */
  function tableWriteups(rows, isHead) {
    const hi = rows.findIndex(isHead); if (hi < 0) return [];
    const H = rows[hi].map((v) => cellText(v).toLowerCase()), find = (re, not) => H.findIndex((t) => re.test(t) && !(not && not.test(t)));
    const cRef = find(/^ref/), cName = find(/^(name|asset|transaction|project)\b/), cDesc = find(/description/), cEv = find(/event|comment|update|news/, /description/);
    const out = []; let cur = null;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || []; if (!r.some((v) => cellText(v))) continue; if (isHead(r)) { cur = null; continue; }
      const nm = cName >= 0 ? cellText(r[cName]) : '';
      if (nm) { cur = { ref: cRef >= 0 ? cellText(r[cRef]) : '', name: nm, description: '', metrics: [], rating: '', rating_cells: [], events: [], _d: [], _e: [] }; out.push(cur); }
      if (!cur) continue;
      if (cDesc >= 0) cur._d.push(cellText(r[cDesc])); if (cEv >= 0) cur._e.push(cellText(r[cEv]));
    }
    for (const a of out) {
      const ls = (arr) => arr.join('\n').split('\n').map((t) => t.replace(BULLET, '').trim()).filter(Boolean), d = ls(a._d), e = ls(a._e);
      if (cEv >= 0) { a.description = d.join(' '); a.events = e; } else if (d.length > 1) { a.description = d[0]; a.events = d.slice(1); } else if (d.length === 1) { if (d[0].length > 140) a.events = d; else a.description = d[0]; }
      delete a._d; delete a._e;
    }
    return out.filter((a) => a.description || a.events.length);
  }
  /** Every sheet of a write-ups workbook ([{ name, rows }]) read with parseMonitoring, in sheet order; a name read twice keeps its first box. */
  R.parseWriteups = function (grids) {
    const out = [], seen = new Set(), sheets = [];
    for (const g of grids || []) {
      const items = R.parseMonitoring(g.rows); if (items.length) sheets.push(g.name);
      for (const m of items) { const k = R.writeupKey(m); if (seen.has(k)) continue; seen.add(k); out.push(Object.assign(m, { sheet: g.name })); }
    }
    return { items: out, sheets };
  };

  // ---------- write-ups ↔ assets: every name an asset goes by, matched word by word ----------
  const nkey = (v) => cellText(v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  /** The key a write-up is linked by: its name without case, accents, spaces or punctuation. */
  R.writeupKey = (m) => nkey(m && m.name);
  const ROMAN = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9' };
  // words that say nothing about which asset it is (legal form, debt wording)
  const STOP = new Set('the of and de du la le des et ltd limited plc sa sas sarl srl spa bv nv gmbh ag ab as aps oy llc lp inc co holding holdings group groupe bidco topco midco holdco opco finance financing funding debt senior junior mezz mezzanine loan loans facility facilities tranche term tl tla tlb tlc capex rcf notes note bond bonds pp ppp project projects top up topup'.split(' '));
  // words that name a kind of asset, not one asset: matching on them alone is no match
  const GENERIC = new Set(('airport airports hospital hospitals port ports prison prisons school schools road roads rail railway railways rolling stock motorway toll tolls bridge tunnel energy power wind windfarm windfarms farm farms '
    + 'solar pv offshore onshore hydro battery batteries storage gas water waste network networks fibre fiber telecom telecoms tower towers data centre centres center centers district heating student housing education '
    + 'health healthcare social transport infrastructure infra renewable renewables utilities utility electricity grid ev charging plant portfolio platform services service uk france germany spain netherlands italy '
    + 'portugal ireland sweden european europe north south east west new city international national').split(' '));
  /** A name in parts: compact (no spaces, no filler words), its words (no numbers) and its numbers (no years, no decimals). */
  function nameParts(v) {
    let t = cellText(v).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ');
    t = t.replace(/\d+[.,]\d+\s*%?|\d+\s*%/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
    // roman numerals as numbers ("II" = 2, a last "I" = 1), plurals as singulars ("Airports" = "Airport", "Batteries" = "Battery");
    // a word on either list stays as it is ("Netherlands", "Facilities")
    const one = (w) => (STOP.has(w) || GENERIC.has(w) || w.length <= 3 ? w : /[^aeiou]ies$/.test(w) ? w.slice(0, -3) + 'y' : /[^s]s$/.test(w) ? w.slice(0, -1) : w);
    const toks = t.split(/[^a-z0-9]+/).filter(Boolean).map((w, i, a) => ROMAN[w] || (w === 'i' && i === a.length - 1 && a.length > 1 ? '1' : /^\d+$/.test(w) ? String(+w) : one(w)));
    const kept = toks.filter((w) => !STOP.has(w));
    return { compact: (kept.length ? kept : toks).join(''), words: new Set(kept.filter((w) => !/^\d+$/.test(w))), nums: new Set(kept.filter((w) => /^\d+$/.test(w))) };
  }
  const distinct = (w) => (w.length >= 3 || /\d/.test(w)) && !GENERIC.has(w);
  function similar(a, b) { // 1 − edit distance / longer length
    const m = a.length, n = b.length; if (!m || !n) return 0; let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return 1 - prev[n] / Math.max(m, n);
  }
  /**
   * How well two names match, 0–100: 100 the same name (case, spacing, punctuation, legal form aside); 96 the same words;
   * 90 every word of the first in the second ("Asset" in "Asset Holdings 2"); 84 the other way; 60–80 most words shared;
   * 80 the same letters run together; 76 one letter out. Numbers must agree when both have one ("Asset 2" is not
   * "Asset 3"); 6 off when only one has a number. Words that only name a kind of asset (Airport, Wind, Fibre …) never match alone.
   */
  R.nameScore = function (a, b) {
    const p = typeof a === 'string' ? nameParts(a) : a, q = typeof b === 'string' ? nameParts(b) : b;
    if (!p.compact || !q.compact) return 0;
    if (p.compact === q.compact) return 100;
    if (p.nums.size && q.nums.size && !Array.from(p.nums).some((x) => q.nums.has(x))) return 0;
    const pen = !p.nums.size !== !q.nums.size ? 6 : 0;
    const inter = Array.from(p.words).filter((w) => q.words.has(w));
    if (inter.some(distinct)) {
      if (inter.length === p.words.size && inter.length === q.words.size) return 96 - pen;
      if (inter.length === p.words.size) return 90 - pen;
      if (inter.length === q.words.size) return 84 - pen;
      const jac = inter.length / new Set(Array.from(p.words).concat(Array.from(q.words))).size;
      if (jac >= 0.5) return Math.round(60 + 20 * jac) - pen;
    }
    const x = p.compact.replace(/\d+/g, ''), y = q.compact.replace(/\d+/g, ''), short = x.length <= y.length ? p : q;
    if (Math.min(x.length, y.length) >= 5 && Array.from(short.words).some(distinct) && (x.includes(y) || y.includes(x))) return 80 - pen;
    if (Math.min(x.length, y.length) >= 6 && Math.abs(x.length - y.length) <= Math.max(x.length, y.length) * 0.15 && x[0] === y[0] && similar(x, y) >= 0.85) return 76 - pen;
    return 0;
  };
  // the columns that hold a name (of the asset, its deal, issuer, security …), not an ID, a party or a category
  const NAME_COL = /name|project|deal|transaction|asset|issuer|borrower|obligor|company|spv|tranche|facility|security|instrument|description/i;
  const NOT_NAME = /\bid\b|isin|cusip|sedol|figi|\blei\b|ticker|sponsor|owner|shareholder|agent|arranger|lender|manager|analyst|investor|fund|portfolio|country|sector|currency|rating|type|status|date|class|esg|sfdr|region|desk|account|book|custod|counterpart|benchmark|index|model|strategy|format|comment|note|team/i;
  /**
   * Every name an asset goes by, with where it comes from: its name, code name, ID, transaction group and asset group; every
   * Mapping row of its securities (code name, Holdings name, transaction group); every name-like column of its Hardcoded and
   * ESG Hardcoded rows; and every name-like column of its Holdings rows (security name, issuer, deal …). → [{ type, value }]
   */
  R.assetNames = function (a, positions) {
    const out = [], seen = new Set();
    // a name is short: free text (a long description, a sentence) is not one
    const add = (type, v) => { if (typeof v === 'number') return; const t = cellText(v); const k = t.toLowerCase(); if (t.length < 2 || t.length > 60 || t.split(/\s+/).length > 8 || seen.has(k)) return; seen.add(k); out.push({ type, value: t }); };
    add('Name', a.name); add('Code name', a.code_name); add('Identification ID', a.code); add('Transaction group', a.attrs && a.attrs.transaction_group); add('Asset group', a.asset_group);
    for (const x of a.aliases || []) add(x.type, x.value);
    for (const [sheet, cells] of Object.entries(a.sheets || {})) for (const [k, c] of Object.entries(cells || {})) if (NAME_COL.test(k) && !NOT_NAME.test(k)) add(`${sheet} › ${k}`, c && typeof c === 'object' ? c.value : c);
    for (const p of positions || a.positions || []) { add('Holdings › Security name', p.security_name); for (const [k, v] of Object.entries(p.sheet || {})) if (NAME_COL.test(k) && !NOT_NAME.test(k)) add(`Holdings › ${k}`, v); }
    return out;
  };
  // res → every asset's names and an index of them by word and by first letters, built once per result
  const NAMES = new WeakMap();
  const pre = (parts) => parts.compact.replace(/\d+/g, '').slice(0, 3);
  function namesOf(res) {
    const k0 = (res && res.assets) || res; // a copy of the result (the report's sectors) shares its assets
    if (k0 && NAMES.has(k0)) return NAMES.get(k0);
    const posBy = new Map(); for (const p of (res && res.positions) || []) if (p.asset_code) { if (!posBy.has(p.asset_code)) posBy.set(p.asset_code, []); posBy.get(p.asset_code).push(p); }
    const idx = ((res && res.assets) || []).map((a) => ({ a, names: R.assetNames(a, posBy.get(a.code)).map((n) => Object.assign(n, { parts: nameParts(n.value) })) }));
    // a name is only scored against a write-up that shares a word with it or starts with the same three letters
    const byWord = new Map(), byPre = new Map(), put = (m, k, v) => { if (!k) return; let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(v); };
    idx.forEach((x, ai) => x.names.forEach((n, ni) => { for (const w of n.parts.words) if (distinct(w)) put(byWord, w, [ai, ni]); put(byPre, pre(n.parts), [ai, ni]); }));
    const out = { idx, byWord, byPre, count: idx.reduce((t, x) => t + x.names.length, 0), types: Array.from(new Set(idx.flatMap((x) => x.names.map((n) => n.type.replace(/ › .*/, ''))))) };
    if (k0 && typeof k0 === 'object') NAMES.set(k0, out);
    return out;
  }
  let LINKS = null; // the last linking (same result, write-ups and links → the same answer)
  /**
   * Which assets each write-up is about. A link set on the Asset write-ups page wins ('none', an asset code, or
   * 'group:<asset group>'); else the write-up's name is matched (R.nameScore) against every name each asset goes by
   * (R.assetNames) and the best match of 75 or more wins. Several assets as good (within 2) of one asset group link to the
   * group; of several groups, to none (ambiguous, the candidates listed).
   * → [{ item, key, codes, how: 'set' | 'auto' | 'ambiguous' | 'none', target, via: [{ code, type, value, score }], candidates, near, checked }]
   */
  R.linkWriteups = function (items, res, links) {
    const lk = JSON.stringify(links || {});
    const k0 = (res && res.assets) || res;
    if (LINKS && LINKS.k0 === k0 && LINKS.items === items && LINKS.lk === lk) return LINKS.out;
    const assets = (res && res.assets) || [], L = links || {}, N = namesOf(res);
    const checked = { names: N.count, assets: N.idx.length, types: N.types };
    const byTarget = (t) => (t.startsWith('group:') ? assets.filter((a) => a.asset_group === t.slice(6)).map((a) => a.code) : assets.some((a) => a.code === t) ? [t] : []);
    const out = (items || []).map((item) => {
      const key = R.writeupKey(item), set = L[key];
      if (set === 'none') return { item, key, codes: [], how: 'none', target: 'none', checked };
      if (set) { const codes = byTarget(set); if (codes.length) return { item, key, codes, how: 'set', target: set, checked }; }
      const wp = nameParts(item.name), best = new Map(), seen = new Set();
      const score = ([ai, ni]) => {
        const id = ai * 100000 + ni; if (seen.has(id)) return; seen.add(id);
        const n = N.idx[ai].names[ni], sc = R.nameScore(wp, n.parts); if (!sc) return;
        const b = best.get(ai); if (!b || sc > b.score) best.set(ai, { a: N.idx[ai].a, score: sc, type: n.type, value: n.value });
      };
      for (const w of wp.words) if (distinct(w)) (N.byWord.get(w) || []).forEach(score);
      (N.byPre.get(pre(wp)) || []).forEach(score);
      const scored = Array.from(best.values()).sort((p, q) => q.score - p.score), top = scored[0];
      if (!top || top.score < 75) return { item, key, codes: [], how: 'none', target: '', near: top ? { code: top.a.code, type: top.type, value: top.value, score: top.score } : null, checked };
      const hit = scored.filter((x) => x.score >= top.score - 2), via = hit.map((x) => ({ code: x.a.code, type: x.type, value: x.value, score: x.score }));
      if (hit.length === 1) return { item, key, codes: [top.a.code], how: 'auto', target: top.a.code, via, checked };
      const groups = new Set(hit.map((x) => x.a.asset_group || x.a.code));
      if (groups.size === 1 && top.a.asset_group) return { item, key, codes: byTarget('group:' + top.a.asset_group), how: 'auto', target: 'group:' + top.a.asset_group, via, checked }; // the whole group, as a link set by hand
      return { item, key, codes: [], how: 'ambiguous', target: '', candidates: hit.map((x) => x.a.code), via, checked };
    });
    LINKS = { k0, items, lk, out };
    return out;
  };
  /** The assets a view holds: its Output rows with an exposure of at least half a currency unit (a 0 is not a holding). */
  R.heldCodes = function (res) {
    const unit = (res && res.config && res.config.unit) || 1e6;
    return new Set(((res && res.rows) || []).filter((r) => (r.exposure_m || 0) * unit >= 0.5).map((r) => r.code));
  };
  /**
   * Does a linked write-up (R.linkWriteups) go in the report of a view holding `held`? Linked to an asset: only when the view
   * holds one of its assets. Linked to nothing: never when set to "Not linked" by hand; otherwise (no sure match, or several
   * assets as good) only when opts.unlinked === 'include', since a write-up matched to no asset cannot be placed in a view.
   */
  R.writeupInView = (l, held, unlinked) => (l.codes.length ? l.codes.some((c) => held.has(c)) : l.target !== 'none' && unlinked === 'include');
  /** The write-ups of a view's report, in the workbook's order (R.writeupInView); opts.unlinked: 'omit' (default) or 'include'. */
  R.writeupsForView = function (items, res, links, opts) {
    const held = R.heldCodes(res), unlinked = (opts && opts.unlinked) || 'omit';
    // in deal order (the asset table's), as the house deck orders its monitoring pages; a write-up linked to no asset of the view last
    const at = new Map(dealOrder((res && res.rows) || []).map((r, i) => [r.code, i])), rank = (l) => Math.min(Infinity, ...(l.codes || []).map((c) => (at.has(c) ? at.get(c) : Infinity)));
    return R.linkWriteups(items, res, links).filter((l) => R.writeupInView(l, held, unlinked)).map((l, i) => ({ l, i, k: rank(l) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.l.item);
  };

  /**
   * A write-ups workbook to fill in, laid out like the house monitoring workbook: one box per asset of the view (its asset
   * group: "Asset A" for "Asset A" and "Asset A top-up"): column A the ref (optional), column B the name next to Actual,
   * Lock-up and Covenant (C, D, E), then a ratio name per row in B with its values under them, and a Rating row; column F
   * the description on the box's first row and the recent events under it (one cell, a line each); and a sheet on how to
   * fill it. → [{ name, rows }] for Scope.inputs.writeXlsx. Read back by parseMonitoring.
   */
  R.writeupTemplate = function (res) {
    const names = []; for (const r of (res && res.rows) || []) { const g = str(r.asset_group) || str(r.code_name) || str(r.name); if (g && !names.includes(g)) names.push(g); }
    const rows = [['Ref.', 'Name', '', '', '', 'Description and recent events']];
    names.forEach((g) => rows.push(['', g, 'Actual', 'Lock-up', 'Covenant', ''], ['', 'Net debt / EBITDA', '', '', '', ''], ['', 'ICR', '', '', '', ''], ['', 'Rating', '', '', '', '']));
    const how = ['How to fill the write-ups', '',
      'One box per asset: its name in column B on the row with the words Actual, Lock-up and Covenant (columns C, D, E). Column A can hold a ref such as 3/30; left blank, the report numbers the boxes.',
      'Under it, one row per ratio: its name in column B and its values under Actual, Lock-up and Covenant (each shows on the slide exactly as the cell shows it in Excel, its number format included: 6.62x, 565, 70%, n/a). Add or delete ratio rows freely.',
      'The Rating row closes the box: the rating under any of the three columns (one rating shows across the three on the slide).',
      'Column F: the description on the box\'s first row (a short line, shown in bold), then the recent events in the cell under it, each on its own line (Alt+Enter); a cell a row works too. Each event becomes a bullet; a line such as "Neutral impact: no rating change" is set in bold.',
      'Names are matched to the assets word by word against every name an asset goes by (name, code name, transaction group, Mapping, Hardcoded and Holdings name columns); Scope › Asset write-ups shows each link and lets you change it.',
      'Add or delete boxes freely. Every sheet of the workbook is read, in order, so one sheet per asset works too.'].map((t) => [t]);
    return [{ name: 'Write-ups', rows }, { name: 'How to fill', rows: how }];
  };

  /**
   * Public-market spread curves from pasted text or a sheet's rows: a date column then one or two value columns (bps),
   * a header row naming them (else "Index 1", "Index 2"). → { series: [{ name, points: [[excel serial, bps]] }], from, to }.
   */
  R.parseMarket = function (input) {
    // pasted text: tabs when the text has any (a paste from Excel keeps "1,234" whole), else semicolons, else commas outside
    // quotes (a CSV writes "1,234" in quotes), else two or more spaces
    const cells = (l, sep) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
    const splitLine = (t) => (/\t/.test(t) ? (l) => l.split('\t').map((x) => x.trim()) : /;/.test(t) ? (l) => cells(l, ';') : /,/.test(t) ? (l) => cells(l, ',') : (l) => l.split(/\s{2,}/).map((x) => x.trim()));
    const rows = typeof input === 'string' ? ((t) => { const sp = splitLine(t); return t.split('\n').map(sp); })(input.replace(/\r/g, '')) : (input || []).map((r) => (r || []).slice());
    // a date: an Excel serial; a month and year ("Mar-20", "Jun-2020") as that month's last day; else any date the util reads
    const asDate = (v) => { if (typeof v === 'number') return v > 20000 && v < 80000 ? v : NaN; const t = cellText(v); if (/^\s*\d+([.,]\d+)?\s*$/.test(t)) return NaN; const m = t.match(/^([A-Za-z]{3})[a-z]*[-\s/.](\d{2}|\d{4})$/); if (m) { const mo = MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === m[1].toLowerCase()); if (mo >= 0) { const yy = m[2].length === 2 ? 2000 + +m[2] : +m[2]; return serial(new Date(Date.UTC(yy, mo + 1, 0))); } } const d = U.parseDate(v); return d ? serial(d) : NaN; };
    const num = (v) => (typeof v === 'number' ? v : U.toNumber(cellText(v).replace(/bps?$/i, '')));
    let head = null; const pts = [[], []];
    for (const r of rows) {
      if (!r || !r.length) continue;
      const di = r.findIndex((v) => isNum(asDate(v)));
      if (di < 0 || !r.slice(di + 1).some((v) => isNum(num(v)))) { if (!pts[0].length) head = r; continue; }
      const vals = r.slice(di + 1).map(num).filter((v, j) => j < 2);
      vals.forEach((v, j) => { if (isNum(v)) pts[j].push([asDate(r[di]), v]); });
    }
    // the curve names: the header cells over the value columns (a blank header cell keeps its column's place)
    let names = [];
    if (head) { const firstData = rows.find((r) => r && r.findIndex((v) => isNum(asDate(v))) >= 0), di0 = firstData ? firstData.findIndex((v) => isNum(asDate(v))) : 0; names = [cellText(head[di0 + 1]), cellText(head[di0 + 2])]; }
    const series = pts.map((p, j) => ({ name: names[j] || `Index ${j + 1}`, points: p.sort((a, b) => a[0] - b[0]) })).filter((x) => x.points.length);
    const all = series.flatMap((x) => x.points.map((p) => p[0]));
    return { series, from: all.length ? Math.min(...all) : NaN, to: all.length ? Math.max(...all) : NaN };
  };
})(typeof window !== 'undefined' ? window : globalThis);
