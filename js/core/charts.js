/* Scope core: dependency-free SVG charts (hbar, bar, donut, stacked) with hover tooltips.
 * Colours come from CSS custom properties (--series-1..8, --chart-*), so light/dark is handled by CSS.
 *
 * Registers Scope.charts = { hbar, bar, donut, stacked, seriesColor, showTip, hideTip }.
 * Each chart function takes a container element and an options object, clears the
 * container and draws an <svg> sized to the container's current width (charts are
 * redrawn by the page on resize rather than scaled). Charts only draw what they are
 * given: totals and shares come from the engines, so figures agree with the tables.
 * Modules (AUM overview, Explorer, ESG, asset page) use these so colours and tooltips
 * stay consistent across the app.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const C = (Scope.charts = {});
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => Scope.util.escapeHtml(s); // data values are escaped before going into tooltip HTML

  /** Create an SVG element with the given attributes (null / undefined skipped), optionally appended to parent. */
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  /** Append an SVG <text> at (x, y); str is set as textContent, so it needs no escaping. */
  function text(parent, x, y, str, attrs) {
    const t = el('text', Object.assign({ x, y }, attrs), parent);
    t.textContent = str;
    return t;
  }
  /** CSS colour for series i, cycling through the eight --series-N tokens. */
  C.seriesColor = (i) => `var(--series-${(i % 8) + 1})`;

  // ---------- tooltip singleton ----------
  // One shared absolutely-positioned <div class="scope-tooltip"> on <body>, created on first use.
  let tip = null;
  /** The tooltip element, created on first use. */
  function tipEl() { if (!tip) { tip = document.createElement('div'); tip.className = 'scope-tooltip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); } return tip; }
  /**
   * Show the tooltip with trusted HTML near viewport point (x, y) (client coordinates).
   * Placed 14px below-right of the pointer and flipped to the left / above when it
   * would overflow the window edge (8px margin). Callers must escape data values.
   */
  C.showTip = function (html, x, y) {
    const t = tipEl(); t.innerHTML = html; t.style.display = 'block';
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  };
  /** Hide the shared tooltip (no-op if it was never created). */
  C.hideTip = function () { if (tip) tip.style.display = 'none'; };
  /** Wire tooltip-follows-pointer on node; htmlFn is evaluated lazily on each move. Optional click handler. */
  function hover(node, htmlFn, onClick) {
    node.style.cursor = onClick ? 'pointer' : 'default';
    node.addEventListener('mousemove', (e) => C.showTip(htmlFn(), e.clientX, e.clientY));
    node.addEventListener('mouseleave', C.hideTip);
    if (onClick) node.addEventListener('click', onClick);
  }
  /** Container width in px, or a fallback (default 560) when it is not laid out yet (hidden / detached). */
  function width(container, fallback) { const w = container.clientWidth; return w && w > 40 ? w : fallback || 560; }
  /**
   * Keep the first max−1 items and fold the remainder into one "Other (k)" item whose
   * value is their sum and whose `other` array keeps the folded items (used for tooltips
   * and stacked parts). Items are expected to be pre-sorted by the caller.
   */
  function foldOther(items, max) {
    if (!max || items.length <= max) return items;
    const head = items.slice(0, max - 1);
    const rest = items.slice(max - 1);
    head.push({ label: 'Other (' + rest.length + ')', value: rest.reduce((s, x) => s + x.value, 0), other: rest });
    return head;
  }
  // SVG paths for bars with a rounded end only at the data end (baseline end stays square).
  // barPathH: horizontal bar, rounded on the right; barPathV: vertical bar, rounded on top.
  // Radius is capped at half the bar's width/height; a zero-length bar returns an empty path.
  function barPathH(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); if (w <= 0) return ''; return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`; }
  function barPathV(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); if (h <= 0) return ''; return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`; }
  /**
   * Axis ticks from 0 to at least max using a "nice" step (1, 2, 2.5, 5 or 10 × a power
   * of ten) giving roughly n intervals. toFixed(10) strips floating-point drift
   * (0.30000000000000004 → 0.3); a final tick is appended if the last one is below max.
   */
  function niceTicks(max, n) {
    if (!(max > 0)) return [0];
    const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const ticks = []; for (let v = 0; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  /**
   * Horizontal bars. opts: { items:[{label,value,sub,color}], format, max, color, onClick, rowH, labelWidth }
   * max folds the tail into "Other (k)"; non-numeric values are dropped. Bars scale to the
   * largest value; the label column width is estimated from the longest label (~6.6px per character).
   */
  C.hbar = function (container, opts) {
    container.innerHTML = '';
    const items = foldOther((opts.items || []).filter((x) => Scope.util.isNum(x.value)), opts.max);
    if (!items.length) { container.innerHTML = '<div class="chart-empty">No data</div>'; return; }
    const fmt = opts.format || ((v) => String(v));
    const W = width(container), rowH = opts.rowH || 24, padT = 4, padB = 4;
    const labelW = opts.labelWidth || Math.min(190, Math.max(70, Math.max(...items.map((i) => i.label.length)) * 6.6 + 12));
    const valueW = 78;
    const H = padT + items.length * rowH + padB;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart chart-hbar', role: 'img' }, container);
    const vmax = Math.max(...items.map((i) => i.value), 0) || 1;
    const plotW = Math.max(40, W - labelW - valueW - 8);
    const color = opts.color || C.seriesColor(0);
    items.forEach((it, i) => {
      const y = padT + i * rowH, h = rowH - 8;
      const g = el('g', { class: 'bar-row' }, svg);
      // Full-width transparent rect so the whole row (label included) is the hover / click target.
      el('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent' }, g);
      text(g, labelW - 8, y + h / 2 + 4, it.label, { 'text-anchor': 'end', class: 'chart-label' });
      const w = (it.value / vmax) * plotW;
      el('path', { d: barPathH(labelW, y + 4, w, h, 4), fill: it.color || color, class: 'bar' }, g);
      text(g, labelW + w + 6, y + h / 2 + 4, fmt(it.value), { class: 'chart-value' });
      hover(g, () => `<b>${esc(it.label)}</b><br>${esc(fmt(it.value))}${it.sub ? '<br><span class="muted">' + esc(it.sub) + '</span>' : ''}`, opts.onClick ? () => opts.onClick(it) : null);
    });
    el('line', { x1: labelW, y1: padT, x2: labelW, y2: H - padB, class: 'chart-axis' }, svg);
  };

  /**
   * Vertical bars. opts: { items, format, color, onClick, height, labels:true }
   * The y axis runs from 0 to the top "nice" tick; format(v, true) is called for tick labels
   * so a formatter can shorten them. Value labels are drawn only for up to 10 bars.
   */
  C.bar = function (container, opts) {
    container.innerHTML = '';
    const items = (opts.items || []).filter((x) => Scope.util.isNum(x.value));
    if (!items.length) { container.innerHTML = '<div class="chart-empty">No data</div>'; return; }
    const fmt = opts.format || ((v) => String(v));
    const W = width(container), H = opts.height || 220, padL = 44, padR = 8, padT = 18, padB = 34;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart chart-bar', role: 'img' }, container);
    const ticks = niceTicks(Math.max(...items.map((i) => i.value)), 4);
    const vmax = ticks[ticks.length - 1] || 1;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const y = (v) => padT + plotH - (v / vmax) * plotH; // value → SVG y (SVG y grows downwards)
    ticks.forEach((t) => { el('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: 'chart-grid' }, svg); text(svg, padL - 6, y(t) + 4, fmt(t, true), { 'text-anchor': 'end', class: 'chart-tick' }); });
    // Each item gets an equal slot; the bar fills 62 % of it, capped at 56px wide.
    const slot = plotW / items.length, bw = Math.min(56, slot * 0.62);
    const color = opts.color || C.seriesColor(0);
    items.forEach((it, i) => {
      const x = padL + i * slot + (slot - bw) / 2, h = plotH - (y(it.value) - padT);
      const g = el('g', {}, svg);
      el('rect', { x: padL + i * slot, y: padT, width: slot, height: plotH, fill: 'transparent' }, g);
      el('path', { d: barPathV(x, y(it.value), bw, h, 4), fill: it.color || color, class: 'bar' }, g);
      if (opts.labels !== false && items.length <= 10) text(g, x + bw / 2, y(it.value) - 5, fmt(it.value), { 'text-anchor': 'middle', class: 'chart-value' });
      text(g, x + bw / 2, H - padB + 16, it.label, { 'text-anchor': 'middle', class: 'chart-label' });
      hover(g, () => `<b>${esc(it.label)}</b><br>${esc(fmt(it.value))}${it.sub ? '<br><span class="muted">' + esc(it.sub) + '</span>' : ''}`, opts.onClick ? () => opts.onClick(it) : null);
    });
    el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'chart-axis' }, svg);
  };

  /**
   * Donut with legend. opts: { items:[{label,value}], format, centre:{value,label}, onClick, max, size } — keep to ≤4 slices.
   * Only positive values are drawn; beyond max (default 5) slices the tail folds into "Other (k)".
   * Slices start at 12 o'clock and run clockwise.
   */
  C.donut = function (container, opts) {
    container.innerHTML = '';
    const items = foldOther((opts.items || []).filter((x) => Scope.util.isNum(x.value) && x.value > 0), opts.max || 5);
    if (!items.length) { container.innerHTML = '<div class="chart-empty">No data</div>'; return; }
    const fmt = opts.format || ((v) => String(v));
    const total = items.reduce((s, x) => s + x.value, 0);
    const wrap = document.createElement('div'); wrap.className = 'donut-wrap'; container.appendChild(wrap);
    const size = opts.size || 150, r = size / 2 - 4, ri = r * 0.62, cx = size / 2, cy = size / 2;
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'chart chart-donut', role: 'img' }, wrap);
    let a0 = -Math.PI / 2;
    items.forEach((it, i) => {
      const frac = it.value / total, a1 = a0 + frac * Math.PI * 2;
      // Annular sector: outer arc a0→a1, line in, inner arc back a1→a0. large-arc flag set beyond 180°.
      const large = frac > 0.5 ? 1 : 0;
      const p = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; // polar → SVG point
      const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r), [x2, y2] = p(a1, ri), [x3, y3] = p(a0, ri);
      // A single 100 % slice cannot be drawn as one arc (start = end point), so draw two
      // near-closed circles and let fill-rule evenodd punch out the hole.
      const d = frac >= 0.9999 ? `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}Z M${cx},${cy - ri}A${ri},${ri} 0 1 0 ${cx - 0.01},${cy - ri}Z`
        : `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${ri},${ri} 0 ${large} 0 ${x3},${y3}Z`;
      const path = el('path', { d, fill: it.color || C.seriesColor(i), class: 'slice', 'fill-rule': 'evenodd' }, svg);
      hover(path, () => `<b>${esc(it.label)}</b><br>${esc(fmt(it.value))} · ${(frac * 100).toFixed(1)}%`, opts.onClick ? () => opts.onClick(it) : null);
      a0 = a1;
    });
    if (opts.centre) {
      text(svg, cx, cy - 2, opts.centre.value, { 'text-anchor': 'middle', class: 'donut-centre-value' });
      text(svg, cx, cy + 14, opts.centre.label, { 'text-anchor': 'middle', class: 'donut-centre-label' });
    }
    const legend = document.createElement('div'); legend.className = 'legend'; wrap.appendChild(legend);
    items.forEach((it, i) => {
      const row = document.createElement('div'); row.className = 'legend-row';
      row.innerHTML = `<span class="swatch" style="background:${it.color || C.seriesColor(i)}"></span><span class="legend-label">${esc(it.label)}</span><span class="legend-value">${esc(fmt(it.value))}</span><span class="legend-share">${((it.value / total) * 100).toFixed(1)}%</span>`;
      if (opts.onClick) { row.style.cursor = 'pointer'; row.onclick = () => opts.onClick(it); }
      legend.appendChild(row);
    });
  };

  /**
   * Horizontal stacked bars. opts: { rows:[{label, parts:{series:value}}], series:[names], format, max, onClick }
   * Row totals are the sum of parts; series colours follow the order of `series`, with an
   * inline legend above the chart. Only the last non-empty segment gets the rounded end.
   */
  C.stacked = function (container, opts) {
    container.innerHTML = '';
    const rows = foldOther((opts.rows || []).map((r) => Object.assign({ value: Object.values(r.parts).reduce((s, v) => s + (v || 0), 0) }, r)), opts.max);
    const series = opts.series || [];
    if (!rows.length || !series.length) { container.innerHTML = '<div class="chart-empty">No data</div>'; return; }
    const fmt = opts.format || ((v) => String(v));
    const legend = document.createElement('div'); legend.className = 'legend legend-inline'; container.appendChild(legend);
    series.forEach((s, i) => { const d = document.createElement('span'); d.className = 'legend-row'; d.innerHTML = `<span class="swatch" style="background:${C.seriesColor(i)}"></span><span class="legend-label">${esc(s)}</span>`; legend.appendChild(d); });
    const W = width(container), rowH = 24, padT = 4, padB = 4;
    const labelW = Math.min(190, Math.max(70, Math.max(...rows.map((i) => i.label.length)) * 6.6 + 12)), valueW = 78;
    const H = padT + rows.length * rowH + padB;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart chart-stacked', role: 'img' }, container);
    const vmax = Math.max(...rows.map((r) => r.value), 0) || 1, plotW = Math.max(40, W - labelW - valueW - 8);
    rows.forEach((r, i) => {
      const y = padT + i * rowH, h = rowH - 8;
      const g = el('g', {}, svg);
      el('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent' }, g);
      text(g, labelW - 8, y + h / 2 + 4, r.label, { 'text-anchor': 'end', class: 'chart-label' });
      let x = labelW;
      series.forEach((s, k) => {
        // A folded "Other (k)" row has no parts of its own: sum the series across the folded rows.
        const v = (r.parts && r.parts[s]) || (r.other ? r.other.reduce((a, o) => a + ((o.parts && o.parts[s]) || 0), 0) : 0);
        if (!(v > 0)) return;
        const w = (v / vmax) * plotW;
        const last = k === series.length - 1 || !series.slice(k + 1).some((s2) => ((r.parts && r.parts[s2]) || 0) > 0);
        const seg = last ? el('path', { d: barPathH(x, y + 4, w, h, 4), fill: C.seriesColor(k), class: 'seg' }, g)
          : el('rect', { x, y: y + 4, width: w, height: h, fill: C.seriesColor(k), class: 'seg' }, g);
        hover(seg, () => `<b>${esc(r.label)}</b><br>${esc(s)}: ${esc(fmt(v))}<br><span class="muted">total ${esc(fmt(r.value))}</span>`, opts.onClick ? () => opts.onClick(r) : null);
        x += w;
      });
      text(g, x + 6, y + h / 2 + 4, fmt(r.value), { class: 'chart-value' });
    });
    el('line', { x1: labelW, y1: padT, x2: labelW, y2: H - padB, class: 'chart-axis' }, svg);
  };
})(typeof window !== 'undefined' ? window : globalThis);
