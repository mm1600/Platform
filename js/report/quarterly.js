/* Scope · Quarterly report — the standard pack for one view, as a native PowerPoint deck (house layout: white pages,
 * green section headers with a thin rule, dense tables, figure captions, a source line and a page number; no logo).
 *
 * Scope.report.quarterly({ res, prev }) → { deck, outline, filename }
 *   res   the AUM result of the selected view and currency (store.result(): global filters applied)
 *   prev  optional: the result for the previous Holdings sheet (same view and currency), for the changes slide and the
 *         quarter-on-quarter figures on the tiles
 * Slides: cover · key figures · sector and country · rating · maturity · top 10 assets · changes since the previous
 * Holdings · watchlist and covenants · the full asset list (as many slides as needed) · notes and sources.
 * Every figure comes from the result object, so the deck shows exactly what the pages show. No DOM; runs in Node.
 */
(function (global) {
  'use strict';
  const Scope = (global.Scope = global.Scope || {});
  const R = (Scope.report = Scope.report || {});
  const U = Scope.util;

  // the palette and the page helpers (frame, tile, section header, caption, table) come from the house kit (house.js)

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const nf = (d) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);
  const m1 = (v) => (isNum(v) ? NF1.format(v) : '–');
  const pct = (v, d) => (isNum(v) ? (d === 0 ? NF0 : NF1).format(v * 100) + '%' : '–');
  const signed = (v, f) => (isNum(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v)) : '–');
  const dmy = (d) => (d instanceof Date && !isNaN(d) ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '–');
  const yrs = (v) => (isNum(v) ? NF1.format(v) + ' y' : '–');
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const cut = (s, n) => (str(s).length > n ? str(s).slice(0, n - 1) + '…' : str(s));
  const onWatch = (w) => (Scope.calc && Scope.calc.aum && Scope.calc.aum.onWatchlist ? Scope.calc.aum.onWatchlist(w) : !!w && !/^(no|n|none|-|0)$/i.test(String(w).trim()));

  /** Top n of a distribution plus one "Other" bucket. */
  function topN(dist, n) {
    const list = (dist || []).filter((d) => d.exposure_m > 0);
    if (list.length <= n) return list;
    const head = list.slice(0, n - 1), rest = list.slice(n - 1);
    return head.concat([{ label: `Other (${rest.length})`, exposure_m: rest.reduce((s, d) => s + d.exposure_m, 0), share: rest.reduce((s, d) => s + d.share, 0) }]);
  }

  R.quarterly = function (opts) {
    const res = opts.res, prev = opts.prev || null;
    const P = Scope.pptx;
    const M = res.metrics || {}, D = res.distributions || {}, rows = res.rows || [];
    const view = (res.platform && res.platform.label) || 'Portfolio';
    const ccy = res.displayCurrency || 'EUR';
    const quarter = res.quarter || '';
    const asOf = dmy(res.reportingDate);
    const attr = (res.config && res.config.attribution_label) || 'Group';
    const filtered = (res.globalFilters || []).length;
    const tpl = opts.template || null;
    const style = opts.style || null;
    const deck = P.deck({ title: `${view} · quarterly report · ${quarter}`, template: tpl, font: style && style.font });
    const K = R.houseKit(deck, { view, quarter, ccy, asOf, filtered, light: !!(tpl && opts.templateText === 'light'), style });
    const { C, T, frame, tile, sectionTitle, caption, outline, WD, X0, CW } = K;
    const change = (cur, before) => (prev && isNum(cur) && isNum(before) && before !== 0 ? (cur - before) / Math.abs(before) : NaN);
    const changeLine = (cur, before) => { const c = change(cur, before); return isNum(c) ? [`${signed(c, (v) => NF1.format(v * 100))}% vs previous`, c >= 0 ? C.green : C.red] : [null, null]; };
    const PM = prev ? prev.metrics || {} : {};

    // 1. cover
    {
      const s = K.blank('Cover');
      s.text({ x: X0, y: 0.9, w: CW, h: 0.45, text: 'Quarterly report', size: 14, color: T.green, bold: true, inset: 0 });
      s.text({ x: X0, y: 1.35, w: CW, h: 1.0, text: view, size: 36, bold: true, color: T.text, inset: 0, valign: 'middle' });
      s.text({ x: X0, y: 2.4, w: CW, h: 0.45, text: `${quarter} · reporting date ${asOf} · amounts in ${ccy} millions`, size: 14, color: T.label, inset: 0 });
      s.line({ x1: X0, y1: 3.1, x2: WD - X0, y2: 3.1, color: T.rule, w: 0.75 });
      const tw = (CW - 3 * 0.3) / 4;
      const [c1, k1] = changeLine(M.total_exposure_m, PM.total_exposure_m);
      tile(s, X0, 3.9, tw, 1.6, 'Exposure', m1(M.total_exposure_m), c1 || `${NF0.format(M.n_assets || 0)} assets`, k1);
      tile(s, X0 + (tw + 0.3), 3.9, tw, 1.6, 'Drawn', m1(M.total_drawn_m), `${pct(M.drawn_pct, 0)} of exposure`);
      tile(s, X0 + 2 * (tw + 0.3), 3.9, tw, 1.6, 'Weighted rating', M.w_rating_label || '–', `IG ${pct(1 - (M.sub_ig_share || 0) - (M.nr_share || 0), 0)} · not rated ${pct(M.nr_share, 0)}`);
      tile(s, X0 + 3 * (tw + 0.3), 3.9, tw, 1.6, 'Remaining life', yrs(M.w_remaining_years), isNum(M.w_margin_bps) ? `weighted spread ${NF0.format(M.w_margin_bps)} bps` : '');
      outline[outline.length - 1].note = `${view} · ${quarter}`;
    }

    // 2. key figures
    {
      const topSector = (D.sector || []).filter((d) => d.exposure_m > 0)[0];
      const kp = `${m1(M.total_exposure_m)}m across ${NF0.format(M.n_assets || 0)} assets; ${pct(M.drawn_pct, 0)} drawn${topSector ? `; largest sector ${topSector.label} (${pct(topSector.share, 0)})` : ''}.`;
      const s = frame('Key figures', kp);
      const tw = (CW - 3 * 0.25) / 4, th = 1.25;
      const cells = [
        ['Exposure', m1(M.total_exposure_m), ...changeLine(M.total_exposure_m, PM.total_exposure_m)],
        ['Drawn', m1(M.total_drawn_m), ...(prev ? changeLine(M.total_drawn_m, PM.total_drawn_m) : [`${pct(M.drawn_pct, 0)} of exposure`, null])],
        ['Undrawn', m1(M.total_undrawn_m), `${pct(isNum(M.drawn_pct) ? 1 - M.drawn_pct : NaN, 0)} of exposure`, null],
        ['Commitment', m1(M.total_commitment_m), null, null],
        ['Assets', NF0.format(M.n_assets || 0), prev ? `${signed((M.n_assets || 0) - (PM.n_assets || 0), (v) => NF0.format(v))} vs previous` : `${NF0.format(M.n_positions || 0)} positions`, null],
        ['Weighted rating', M.w_rating_label || '–', `sub-IG ${pct(M.sub_ig_share, 0)} · NR ${pct(M.nr_share, 0)}`, null],
        ['Remaining life', yrs(M.w_remaining_years), `WAL ${yrs(M.w_wal_years)}`, null],
        ['Weighted spread', isNum(M.w_margin_bps) ? NF0.format(M.w_margin_bps) + ' bps' : '–', `fixed rate ${pct(M.fixed_share, 0)}`, null],
      ];
      cells.forEach(([l, v, sub, col], i) => tile(s, X0 + (i % 4) * (tw + 0.25), 1.5 + Math.floor(i / 4) * (th + 0.18), tw, th, l, v, sub, col));
      const y = 4.45;
      sectionTitle(s, X0, y, 4, 'Drawn and undrawn');
      s.chart({ x: X0, y: y + 0.35, w: 4, h: 2.0, type: 'doughnut', categories: ['Drawn', 'Undrawn'], series: [{ name: 'Exposure', values: [M.total_drawn_m || 0, Math.max(0, M.total_undrawn_m || 0)] }], colors: [C.green, C.pgreen], legend: 'r' });
      caption(s, X0, y + 2.38, 4, `drawn and undrawn exposure, ${ccy} m`);
      sectionTitle(s, X0 + 4.3, y, 3.8, 'Fixed and floating');
      const ff = (D.fixed_floating || []).filter((d) => d.exposure_m > 0);
      s.chart({ x: X0 + 4.3, y: y + 0.35, w: 3.8, h: 2.0, type: 'doughnut', categories: ff.map((d) => d.label), series: [{ name: 'Exposure', values: ff.map((d) => d.exposure_m) }], colors: [C.slate, C.pgreen], legend: 'r' });
      caption(s, X0 + 4.3, y + 2.38, 3.8, 'fixed and floating rate exposure');
      sectionTitle(s, X0 + 8.4, y, 3.9, 'Currency');
      const cc = topN(D.currency, 6);
      s.table({ headerFill: C.green, headerColor: C.white, x: X0 + 8.4, y: y + 0.38, colW: [1.5, 1.3, 1.1], header: true, size: 9, rowH: 0.27, zebra: C.cell, align: ['left', 'right', 'right'], rows: [['Currency', `${ccy} m`, 'Share']].concat(cc.map((d) => [d.label, m1(d.exposure_m), pct(d.share)])) });
    }

    // 3. sector and country
    {
      const sec = topN(D.sector, 8), cty = topN(D.country, 8);
      const kp = sec.length && cty.length ? `${sec[0].label} is the largest sector (${pct(sec[0].share, 0)}); ${cty[0].label} the largest country (${pct(cty[0].share, 0)}).` : '';
      const s = frame('Exposure by sector and country', kp);
      sectionTitle(s, X0, 1.5, 5.9, `Sector · ${ccy} m`);
      s.chart({ x: X0, y: 1.85, w: 5.9, h: 4.8, type: 'bar', categories: sec.map((d) => d.label), series: [{ name: `Exposure (${ccy} m)`, values: sec.map((d) => d.exposure_m), color: C.green }] });
      caption(s, X0, 6.7, 5.9, `exposure by sector, top ${sec.length} with the rest grouped`);
      sectionTitle(s, X0 + 6.4, 1.5, 5.9, `Country · ${ccy} m`);
      s.chart({ x: X0 + 6.4, y: 1.85, w: 5.9, h: 4.8, type: 'bar', categories: cty.map((d) => d.label), series: [{ name: `Exposure (${ccy} m)`, values: cty.map((d) => d.exposure_m), color: C.slate }] });
      caption(s, X0 + 6.4, 6.7, 5.9, `exposure by country, top ${cty.length} with the rest grouped`);
    }

    // 4. rating
    {
      const rat = (D.rating || []).filter((d) => d.exposure_m > 0), ig = (D.ig || []).filter((d) => d.exposure_m > 0);
      const igShare = (ig.find((d) => d.label === 'IG') || {}).share;
      const s = frame('Credit quality', `Weighted rating ${M.w_rating_label || '–'}; investment grade ${pct(igShare, 0)} of exposure, not rated ${pct(M.nr_share, 0)}.`);
      sectionTitle(s, X0, 1.5, 7.6, `Exposure by current rating · ${ccy} m`);
      s.chart({ x: X0, y: 1.85, w: 7.6, h: 4.8, type: 'col', categories: rat.map((d) => d.label), series: [{ name: `Exposure (${ccy} m)`, values: rat.map((d) => d.exposure_m), color: C.green }] });
      caption(s, X0, 6.7, 7.6, 'exposure by current rating (internal rating, else the worst external)');
      sectionTitle(s, X0 + 8.0, 1.5, 4.3, 'Investment grade split');
      s.chart({ x: X0 + 8.0, y: 1.85, w: 4.3, h: 2.7, type: 'doughnut', categories: ig.map((d) => d.label), series: [{ name: 'Exposure', values: ig.map((d) => d.exposure_m) }], colors: [C.green, C.salmon, C.pgreen], legend: 'r' });
      caption(s, X0 + 8.0, 4.6, 4.3, 'investment grade, sub-investment grade and not rated');
      s.table({ headerFill: C.green, headerColor: C.white, x: X0 + 8.0, y: 5.0, colW: [1.7, 1.4, 1.2], header: true, size: 9, rowH: 0.27, zebra: C.cell, align: ['left', 'right', 'right'], rows: [['Band', `${ccy} m`, 'Share']].concat(ig.map((d) => [d.label, m1(d.exposure_m), pct(d.share)])) });
    }

    // 5. maturity
    {
      const mb = (D.maturity_bucket || []).filter((d) => d.exposure_m > 0);
      const top = mb.slice().sort((a, b) => b.exposure_m - a.exposure_m)[0];
      const s = frame('Maturity profile', `Weighted remaining life ${yrs(M.w_remaining_years)}${top ? `; the largest bucket is ${top.label} (${pct(top.share, 0)})` : ''}.`);
      sectionTitle(s, X0, 1.5, 7.6, `Exposure by remaining maturity · ${ccy} m`);
      s.chart({ x: X0, y: 1.85, w: 7.6, h: 4.8, type: 'col', categories: mb.map((d) => d.label), series: [{ name: `Exposure (${ccy} m)`, values: mb.map((d) => d.exposure_m), color: C.green }] });
      caption(s, X0, 6.7, 7.6, 'exposure by remaining maturity bucket');
      sectionTitle(s, X0 + 8.0, 1.5, 4.3, 'Maturity by year');
      const byYear = new Map();
      for (const r of rows) { const y = r.maturity_date instanceof Date ? r.maturity_date.getUTCFullYear() : null; const k = y ? String(y) : 'Unknown'; byYear.set(k, (byYear.get(k) || 0) + r.exposure_m); }
      const years = Array.from(byYear).sort((a, b) => (a[0] === 'Unknown' ? 1 : b[0] === 'Unknown' ? -1 : a[0].localeCompare(b[0])));
      const dated = years.filter(([y]) => y !== 'Unknown'), unknown = years.find(([y]) => y === 'Unknown');
      const head = dated.slice(0, 12), restY = dated.slice(12);
      const yrRows = head.concat(restY.length ? [[`Later (${restY.length})`, restY.reduce((t, x) => t + x[1], 0)]] : [], unknown ? [unknown] : []);
      s.table({ headerFill: C.green, headerColor: C.white, x: X0 + 8.0, y: 1.9, colW: [1.7, 1.4, 1.2], header: true, size: 9, rowH: 0.27, zebra: C.cell, align: ['left', 'right', 'right'], rows: [['Year', `${ccy} m`, 'Share']].concat(yrRows.map(([y, v]) => [y, m1(v), pct(M.total_exposure_m ? v / M.total_exposure_m : NaN)])) });
    }

    // 6. top 10
    {
      const top = rows.slice(0, 10);
      const topSum = top.reduce((t, r) => t + r.exposure_m, 0);
      const s = frame('Top 10 assets', `The ten largest assets are ${pct(M.total_exposure_m ? topSum / M.total_exposure_m : NaN, 0)} of exposure; the largest is ${top[0] ? cut(top[0].name, 40) + ' (' + pct(M.total_exposure_m ? top[0].exposure_m / M.total_exposure_m : NaN) + ')' : '–'}.`);
      const head = ['#', 'Asset', 'Sector', 'Country', 'Rating', 'Maturity', 'Exposure', 'Drawn', 'Share'];
      const body = top.map((r) => [String(r.rank), cut(r.name, 38), cut(r.sector, 22), cut(r.country, 16), r.rating_status === 'rated' ? r.rating : 'NR', dmy(r.maturity_date), m1(r.exposure_m), m1(r.drawn_m), pct(M.total_exposure_m ? r.exposure_m / M.total_exposure_m : NaN)]);
      const totals = [{ text: '', bold: true }, { text: 'Top 10', bold: true }, '', '', '', '', { text: m1(topSum), bold: true }, { text: m1(top.reduce((t, r) => t + r.drawn_m, 0)), bold: true }, { text: pct(M.total_exposure_m ? topSum / M.total_exposure_m : NaN), bold: true }];
      const all = [{ text: '', bold: true }, { text: 'Portfolio', bold: true }, '', '', '', '', { text: m1(M.total_exposure_m), bold: true }, { text: m1(M.total_drawn_m), bold: true }, { text: '100.0%', bold: true }];
      sectionTitle(s, X0, 1.5, CW, `Ten largest assets · ${ccy} m`);
      s.table({ headerFill: C.green, headerColor: C.white, x: X0, y: 1.9, colW: [0.45, 3.2, 1.85, 1.55, 0.85, 1.2, 1.1, 1.1, 1.0], header: true, size: 10, rowH: 0.36, zebra: C.cell,
        align: ['right', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right'], rows: [head].concat(body, [totals, all]), rowStyles: { [body.length + 1]: { fill: C.tgreen }, [body.length + 2]: { fill: C.tgreen } } });
    }

    // 7. changes since the previous Holdings
    {
      if (prev) {
        const before = new Map((prev.rows || []).map((r) => [r.code, r])), now = new Map(rows.map((r) => [r.code, r]));
        const added = rows.filter((r) => !before.has(r.code)), exited = (prev.rows || []).filter((r) => !now.has(r.code));
        const movers = rows.filter((r) => before.has(r.code)).map((r) => ({ r, d: r.exposure_m - before.get(r.code).exposure_m, b: before.get(r.code).exposure_m })).filter((x) => Math.abs(x.d) > 1e-9).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8);
        const dTot = (M.total_exposure_m || 0) - (PM.total_exposure_m || 0);
        const s = frame('Changes since the previous Holdings', `Exposure ${signed(dTot, m1)}m (${signed(change(M.total_exposure_m, PM.total_exposure_m), (v) => NF1.format(v * 100))}%); ${added.length} asset(s) added, ${exited.length} exited.`);
        const tw = (CW - 3 * 0.25) / 4;
        tile(s, X0, 1.5, tw, 1.2, 'Exposure change', `${signed(dTot, m1)}`, `previous ${m1(PM.total_exposure_m)}`, dTot >= 0 ? C.green : C.red);
        tile(s, X0 + tw + 0.25, 1.5, tw, 1.2, 'Drawn change', `${signed((M.total_drawn_m || 0) - (PM.total_drawn_m || 0), m1)}`, `previous ${m1(PM.total_drawn_m)}`);
        tile(s, X0 + 2 * (tw + 0.25), 1.5, tw, 1.2, 'Assets added', NF0.format(added.length), added.length ? `${m1(added.reduce((t, r) => t + r.exposure_m, 0))}m new exposure` : 'none');
        tile(s, X0 + 3 * (tw + 0.25), 1.5, tw, 1.2, 'Assets exited', NF0.format(exited.length), exited.length ? `${m1(exited.reduce((t, r) => t + r.exposure_m, 0))}m repaid or sold` : 'none');
        sectionTitle(s, X0, 2.9, 7.4, 'Largest movements');
        s.table({ headerFill: C.green, headerColor: C.white, x: X0, y: 3.25, colW: [3.5, 1.3, 1.3, 1.3], header: true, size: 9.5, rowH: 0.3, zebra: C.cell, align: ['left', 'right', 'right', 'right'],
          rows: [['Asset', 'Previous', 'Current', 'Change']].concat(movers.length ? movers.map((x) => [cut(x.r.name, 40), m1(x.b), m1(x.r.exposure_m), { text: signed(x.d, m1), color: x.d >= 0 ? C.green : C.red }]) : [['No change in existing assets', '', '', '']]) });
        sectionTitle(s, X0 + 7.8, 2.9, 4.5, 'Added and exited');
        const ae = added.slice(0, 5).map((r) => [cut(r.name, 30), { text: 'added', color: C.green }, m1(r.exposure_m)]).concat(exited.slice(0, 5).map((r) => [cut(r.name, 30), { text: 'exited', color: C.red }, m1(r.exposure_m)]));
        s.table({ headerFill: C.green, headerColor: C.white, x: X0 + 7.8, y: 3.25, colW: [2.8, 0.8, 0.9], header: true, size: 9.5, rowH: 0.3, zebra: C.cell, align: ['left', 'left', 'right'], rows: [['Asset', '', `${ccy} m`]].concat(ae.length ? ae : [['No assets added or exited', '', '']]) });
      } else {
        const s = frame('Changes since the previous Holdings', 'No previous Holdings sheet is loaded, so there is nothing to compare yet.');
        s.rect({ x: X0, y: 1.6, w: CW, h: 1.6, fill: C.tgreen });
        s.text({ x: X0 + 0.3, y: 1.75, w: CW - 0.6, h: 1.3, valign: 'middle', size: 13, color: C.text, paras: [
          { text: 'To fill this page, load the next Holdings sheet as a monthly update (Data › Setup › Load › Monthly update).', spaceAfter: 6 },
          { text: 'Scope keeps the sheet it replaces and compares the two: exposure and drawn changes, assets added and exited, and the largest movements.' }] });
      }
    }

    // 8. watchlist and covenants
    {
      const watch = rows.filter((r) => onWatch(r.watchlist));
      const wSum = watch.reduce((t, r) => t + r.exposure_m, 0);
      const s = frame('Watchlist and covenants', watch.length ? `${watch.length} asset(s) on the watchlist: ${m1(wSum)}m, ${pct(M.total_exposure_m ? wSum / M.total_exposure_m : NaN)} of exposure.` : 'No asset is on the watchlist.');
      sectionTitle(s, X0, 1.5, 7.6, 'Assets on the watchlist');
      s.table({ headerFill: C.green, headerColor: C.white, x: X0, y: 1.9, colW: [3.2, 1.2, 0.9, 1.2, 1.1], header: true, size: 9.5, rowH: 0.3, zebra: C.cell, align: ['left', 'left', 'left', 'right', 'left'],
        rows: [['Asset', 'Watchlist', 'Rating', `${ccy} m`, 'Covenants']].concat(watch.length ? watch.slice(0, 14).map((r) => [cut(r.name, 36), { text: str(r.watchlist), color: /intensive/i.test(r.watchlist) ? C.red : C.amber }, r.rating_status === 'rated' ? r.rating : 'NR', m1(r.exposure_m), cut(r.covenant_compliance || '–', 14)]) : [['None', '', '', '', '']]) });
      if (watch.length > 14) s.text({ x: X0, y: 6.7, w: 7.6, h: 0.25, text: `+ ${watch.length - 14} more on the asset list`, size: 9, color: C.muted, inset: 0 });
      const cv = (D.covenant_compliance || []).filter((d) => d.exposure_m > 0);
      sectionTitle(s, X0 + 8.0, 1.5, 4.3, `Covenant compliance · ${ccy} m`);
      s.chart({ x: X0 + 8.0, y: 1.9, w: 4.3, h: 3.0, type: 'bar', categories: cv.map((d) => d.label), series: [{ name: `Exposure (${ccy} m)`, values: cv.map((d) => d.exposure_m), color: C.green }] });
      caption(s, X0 + 8.0, 4.95, 4.3, 'exposure by covenant compliance status');
      const wl = (D.watchlist || []).filter((d) => d.exposure_m > 0);
      s.table({ headerFill: C.green, headerColor: C.white, x: X0 + 8.0, y: 5.3, colW: [1.7, 1.4, 1.2], header: true, size: 9, rowH: 0.27, zebra: C.cell, align: ['left', 'right', 'right'], rows: [['Watchlist', `${ccy} m`, 'Share']].concat(wl.map((d) => [d.label, m1(d.exposure_m), pct(d.share)])) });
    }

    // 9. full asset list
    {
      // up to 17 rows on one slide; more are spread evenly over slides of at most 15 rows
      const pages = rows.length <= 17 ? 1 : Math.ceil(rows.length / 15), PER = Math.max(1, Math.ceil(rows.length / pages));
      const rowH = pages === 1 ? Math.min(0.32, 5.3 / (Math.max(1, rows.length) + 1)) : 0.32;
      for (let k = 0; k < pages; k++) {
        const part = rows.slice(k * PER, (k + 1) * PER);
        const s = frame(`Asset list${pages > 1 ? ` (${k + 1} of ${pages})` : ''}`, k === 0 ? `${NF0.format(rows.length)} assets with exposure in ${view}, largest first.` : '');
        s.table({ headerFill: C.green, headerColor: C.white, x: X0, y: k === 0 ? 1.5 : 1.45, colW: [0.45, 3.2, 1.8, 1.45, 0.65, 0.75, 1.1, 1.0, 0.95, 0.95], header: true, size: 9, rowH, zebra: C.cell,
          align: ['right', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right'],
          rows: [['#', 'Asset', 'Sector', 'Country', 'Ccy', 'Rating', 'Maturity', 'Spread (bps)', 'Exposure', 'Drawn']].concat(part.map((r) => [String(r.rank), cut(r.name, 34), cut(r.sector, 20), cut(r.country, 14), str(r.currency), r.rating_status === 'rated' ? r.rating : 'NR', dmy(r.maturity_date), isNum(r.margin_bps) ? NF0.format(r.margin_bps) : '–', m1(r.exposure_m), m1(r.drawn_m)])) });
      }
    }

    // 10. notes and sources
    {
      const def = ((res.inputs && res.inputs.views) || []).find((v) => v.view === (res.platform && res.platform.id));
      const how = !def ? '' : def.def === '*' ? 'every investor column' : def.def === 'group' ? `the ${attr} ownership of each investor column` : def.kind === 'investor column' ? `the investor column ${view}` : def.formula || '';
      const fx = ((res.inputs && res.inputs.fx && res.inputs.fx.table) || []).filter((x) => x.currency !== 'EUR').map((x) => `${x.currency} ${isNum(x.perEur) ? String(+x.perEur.toFixed(4)) : '–'} per EUR`);
      const st = res.stats || {};
      const s = frame('Notes and sources', '');
      s.text({ x: X0, y: 1.5, w: CW, h: 5.4, size: 11.5, color: T.text, paras: [
        { runs: [{ text: 'View. ', bold: true }, { text: `${view}${how ? ' = ' + how : ''}.` }], bullet: true, spaceAfter: 8 },
        { runs: [{ text: 'Data. ', bold: true }, { text: `Holdings as of ${asOf} (${NF0.format(st.positions || 0)} positions, ${NF0.format(st.excluded || 0)} excluded with a reason on Data › Issues), Mapping, Hardcoded and ESG Hardcoded.` }], bullet: true, spaceAfter: 8 },
        { runs: [{ text: 'Amounts. ', bold: true }, { text: `Nominal in ${ccy} millions; drawn and commitment as reported in Holdings; exposure of a view = Σ coefficient × investor column, as in the workbook's Calculations sheet.` }], bullet: true, spaceAfter: 8 },
        { runs: [{ text: 'FX. ', bold: true }, { text: fx.length ? fx.join(' · ') + '.' : 'All positions in EUR.' }], bullet: true, spaceAfter: 8 },
        { runs: [{ text: 'Ratings. ', bold: true }, { text: `Current rating = internal rating, else the worst external rating; weighted by exposure on the workbook's numeric scale; sub-IG above ${(res.config && res.config.ig_threshold) || ''}.` }], bullet: true, spaceAfter: 8 },
        { runs: [{ text: 'Filters. ', bold: true }, { text: filtered ? `${filtered} global filter(s) were applied when this deck was made.` : 'None: the whole view.' }], bullet: true, spaceAfter: 8 },
        { runs: [{ text: 'Previous period. ', bold: true }, { text: prev ? `Compared with the Holdings sheet loaded before this one (as of ${dmy(prev.reportingDate)}).` : 'No previous Holdings sheet was loaded.' }], bullet: true },
      ] });
    }

    const safe = (t) => String(t).replace(/[^A-Za-z0-9 ._-]+/g, ' ').trim().replace(/\s+/g, '-');
    return { deck, outline, filename: `${safe(view)}-quarterly-report-${safe(quarter || U.isoDate(res.reportingDate))}.pptx` };
  };
})(typeof window !== 'undefined' ? window : globalThis);
