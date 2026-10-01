/* Scope core: additional dependency-free SVG charts for the concentration page — choropleth (world map), treemap,
 * heatmap, pareto and maturity ladder. Same conventions as js/core/charts.js: draw into a container, width taken from
 * the container, hover tooltips through Scope.charts.showTip / hideTip, optional onClick callbacks, "No data" states.
 * Categorical colours come from --series-1..8; magnitude uses one sequential green ramp (light → dark).
 * Pure helpers (quantileBreaks, classOf, squarify, pathBBox) touch no DOM, so they also run in Node. */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const C = Scope.charts || (Scope.charts = {});
  const NS = 'http://www.w3.org/2000/svg';
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const esc = (s) => (Scope.util && Scope.util.escapeHtml ? Scope.util.escapeHtml(s) : String(s === null || s === undefined ? '' : s));
  const pct = (x, d) => (isNum(x) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : '–');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);

  // ---------- palette ----------
  // Sequential ramp of the primary green, light → dark (5 classes); lightness is monotonic so order reads without hue.
  const SEQ = ['#c2e3d3', '#86c9a9', '#45ab7f', '#00915a', '#005e3a'];
  C.SEQ_RAMP = SEQ.slice();
  C.NO_DATA = '#eceff1';     // countries / cells without exposure: neutral light grey, distinct from the lightest class
  C.OTHER_COLOR = '#adb5bd'; // folded "Other" group (never a generated 9th hue)
  // Hex mirror of --series-1..8 in css/scope.css, used only to pick a readable label ink on top of a series fill.
  const SERIES_HEX = ['#00915a', '#2c6fb0', '#d98b00', '#c8433a', '#8460b8', '#2e9fb5', '#9a9b2a', '#b0568f'];
  const seriesColor = (i) => (C.seriesColor ? C.seriesColor(i) : `var(--series-${(i % 8) + 1})`);

  // hex → [r, g, b]
  function rgb(hex) { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  // [r, g, b] → hex
  function hex(c) { return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
  // WCAG relative luminance of a hex colour
  function luminance(h) { return rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }

  /** Continuous sequential colour for t in [0, 1] (piecewise-linear through the ramp). */
  C.seqColor = function (t) {
    t = clamp(isNum(t) ? t : 0, 0, 1);
    const pos = t * (SEQ.length - 1), i = Math.min(SEQ.length - 2, Math.floor(pos)), f = pos - i;
    const a = rgb(SEQ[i]), b = rgb(SEQ[i + 1]);
    return hex(a.map((v, k) => v + (b[k] - v) * f));
  };
  /** Label ink (white or near-black) with the higher contrast on a hex fill. */
  C.inkOn = function (fill) {
    if (!/^#[0-9a-f]{6}$/i.test(fill || '')) return '#1d1d1b';
    const L = luminance(fill);
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / (luminance('#1d1d1b') + 0.05)) ? '#ffffff' : '#1d1d1b';
  };
  /** Ramp step for class i of n (fewer classes spread over the darker end so the lightest is never used alone). */
  C.rampIndex = (i, n) => (n >= SEQ.length ? i : n <= 1 ? 3 : Math.round(1 + (i * 3) / (n - 1)));

  // ---------- pure helpers (no DOM) ----------
  /** Quantile class breaks for positive values: up to k-1 ascending thresholds; class i holds values ≤ breaks[i]. */
  C.quantileBreaks = function (values, k) {
    k = Math.max(1, Math.floor(k || 5));
    const v = (values || []).filter((x) => isNum(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return [];
    const distinct = Array.from(new Set(v));
    if (distinct.length <= k) return distinct.slice(0, -1); // one class per distinct value
    const out = [];
    for (let i = 1; i < k; i++) {
      const b = v[Math.min(v.length - 1, Math.max(0, Math.ceil((v.length * i) / k) - 1))];
      if ((!out.length || b > out[out.length - 1]) && b < v[v.length - 1]) out.push(b);
    }
    return out;
  };
  /** Class index of a value given ascending breaks (0 … breaks.length). */
  C.classOf = function (v, breaks) { let i = 0; while (i < breaks.length && v > breaks[i]) i++; return i; };

  /** Bounding boxes of an SVG path, one per subpath (M L H V Z, absolute or relative). → [[minX, minY, maxX, maxY], …] */
  C.subpathBBoxes = function (d) {
    const out = [];
    let x = 0, y = 0, sx = 0, sy = 0, box = null;
    const add = () => { if (!box) box = [x, y, x, y]; else { if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; } };
    const re = /([MmLlHhVvZz])([^MmLlHhVvZz]*)/g;
    let m;
    while ((m = re.exec(String(d || '')))) {
      const c = m[1], n = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      if (c === 'Z' || c === 'z') { x = sx; y = sy; continue; }
      if (c === 'H' || c === 'h') { for (const v of n) { x = c === 'H' ? v : x + v; add(); } continue; }
      if (c === 'V' || c === 'v') { for (const v of n) { y = c === 'V' ? v : y + v; add(); } continue; }
      for (let i = 0; i + 1 < n.length; i += 2) {
        const abs = c === 'M' || c === 'L';
        x = abs ? n[i] : x + n[i]; y = abs ? n[i + 1] : y + n[i + 1];
        if (i === 0 && (c === 'M' || c === 'm')) { if (box) out.push(box); box = null; sx = x; sy = y; }
        add();
      }
    }
    if (box) out.push(box);
    return out;
  };
  /** Bounding box of a whole path. */
  C.pathBBox = function (d) {
    const bs = C.subpathBBoxes(d);
    if (!bs.length) return null;
    return bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  };
  /** Bounding box of the largest subpath (the mainland: ignores overseas territories and remote islands). */
  C.mainBBox = function (d) {
    const bs = C.subpathBBoxes(d);
    if (!bs.length) return null;
    return bs.reduce((a, b) => ((b[2] - b[0]) * (b[3] - b[1]) > (a[2] - a[0]) * (a[3] - a[1]) ? b : a));
  };

  /** Squarified treemap layout (Bruls, Huizing, van Wijk): items {value>0} → [{ item, x, y, w, h }], largest first. */
  C.squarify = function (items, x, y, w, h) {
    const list = (items || []).filter((it) => it && isNum(it.value) && it.value > 0).slice().sort((a, b) => b.value - a.value);
    const out = [];
    const total = sum(list, (it) => it.value);
    if (!total || !(w > 0) || !(h > 0)) return out;
    const areas = list.map((it) => (it.value / total) * w * h);
    let rect = { x, y, w, h }, row = [], i = 0;
    // worst aspect ratio of a row laid along a side of length `side`
    const worst = (idx, side) => {
      if (!idx.length) return Infinity;
      const a = idx.map((j) => areas[j]), s = sum(a), mx = Math.max.apply(null, a), mn = Math.min.apply(null, a);
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    // place a finished row along the shorter side and return the remaining rectangle
    const place = (idx, r) => {
      const s = sum(idx, (j) => areas[j]);
      if (r.w >= r.h) {
        const cw = r.h ? s / r.h : 0; let yy = r.y;
        for (const j of idx) { const hh = cw ? areas[j] / cw : 0; out.push({ item: list[j], x: r.x, y: yy, w: cw, h: hh }); yy += hh; }
        return { x: r.x + cw, y: r.y, w: Math.max(0, r.w - cw), h: r.h };
      }
      const rh = r.w ? s / r.w : 0; let xx = r.x;
      for (const j of idx) { const ww = rh ? areas[j] / rh : 0; out.push({ item: list[j], x: xx, y: r.y, w: ww, h: rh }); xx += ww; }
      return { x: r.x, y: r.y + rh, w: r.w, h: Math.max(0, r.h - rh) };
    };
    while (i < list.length) {
      const side = Math.min(rect.w, rect.h);
      if (!row.length || worst(row.concat([i]), side) <= worst(row, side)) { row.push(i); i++; }
      else { rect = place(row, rect); row = []; }
    }
    if (row.length) place(row, rect);
    return out;
  };

  // ---------- DOM helpers (only called when drawing) ----------
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs) { const t = el('text', Object.assign({ x, y }, attrs), parent); t.textContent = str; return t; }
  function div(cls, parent) { const d = document.createElement('div'); if (cls) d.className = cls; if (parent) parent.appendChild(d); return d; }
  // tooltip + click wiring; the tip is hidden on click because a click usually re-renders the page
  function hover(node, htmlFn, onClick) {
    node.style.cursor = onClick ? 'pointer' : 'default';
    node.addEventListener('mousemove', (e) => { if (C.showTip) C.showTip(htmlFn(), e.clientX, e.clientY); });
    node.addEventListener('mouseleave', () => { if (C.hideTip) C.hideTip(); });
    if (onClick) node.addEventListener('click', (e) => { if (C.hideTip) C.hideTip(); onClick(e); });
  }
  function width(container, fallback) { const w = container.clientWidth; return w && w > 40 ? w : fallback || 560; }
  function empty(container, msg) { container.innerHTML = '<div class="chart-empty">' + esc(msg || 'No data') + '</div>'; }
  // truncate a label to roughly maxPx at ~charPx per character
  function fit(str, maxPx, charPx) { const s = String(str); const n = Math.floor(maxPx / (charPx || 6.4)); if (n < 3) return ''; return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…'; }
  // rounded end only at the data end of a vertical bar (baseline end stays square)
  function barPathV(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); if (!(h > 0)) return ''; return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`; }
  // round axis ticks 0 … ≥max in about n steps
  function niceTicks(max, n) {
    if (!(max > 0)) return [0, 1];
    const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const ticks = []; for (let v = 0; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
    if (ticks[ticks.length - 1] < max - 1e-9) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
    return ticks;
  }
  // inline legend row (reuses the .legend styles of charts.js); entries: { label, color, kind:'box'|'line'|'dash' }
  function legend(parent, entries) {
    const lg = div('legend legend-inline', parent);
    for (const e of entries) {
      const row = document.createElement('span'); row.className = 'legend-row';
      const sw = document.createElement('span');
      sw.className = e.kind === 'line' ? 'cx-swatch-line' : e.kind === 'dash' ? 'cx-swatch-dash' : 'swatch';
      if (e.kind === 'line') sw.style.background = e.color; else if (e.kind !== 'dash') sw.style.background = e.color;
      const lb = document.createElement('span'); lb.className = 'legend-label'; lb.textContent = e.label;
      row.append(sw, lb); lg.appendChild(row);
    }
    return lg;
  }
  // segmented toggle (square-cornered button group); returns the element
  function segmented(options, active, onPick) {
    const g = div('cx-seg'); g.setAttribute('role', 'group');
    for (const o of options) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = o.label; b.className = o.id === active ? 'active' : '';
      b.setAttribute('aria-pressed', o.id === active ? 'true' : 'false');
      b.addEventListener('click', () => { Array.from(g.children).forEach((x) => { x.className = ''; x.setAttribute('aria-pressed', 'false'); }); b.className = 'active'; b.setAttribute('aria-pressed', 'true'); onPick(o.id); });
      g.appendChild(b);
    }
    return g;
  }

  // ---------- choropleth ----------
  // Europe for the view toggle (Russia and Turkey excluded: they would stretch the frame to Asia).
  const EUROPE = new Set(['AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LT', 'LU', 'LV', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'UA', 'XK']);
  const EUROPE_BOX = [352, 318, 505, 462]; // map units of data/world-map.js, used when no European country has exposure
  const mainBoxCache = new Map();
  const mainBoxOf = (iso, d) => { if (!mainBoxCache.has(iso)) mainBoxCache.set(iso, C.mainBBox(d)); return mainBoxCache.get(iso); };

  /**
   * World choropleth with a ranked side list.
   * opts: { values:{ countryName: amount }, format, onClick(countryName), view:'europe'|'world', onViewChange(view), height }
   * Countries resolve through Scope.worldMap.iso(); names that do not resolve still appear in the list ("not on map").
   */
  C.choropleth = function (container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const WM = Scope.worldMap;
    const fmt = opts.format || ((v) => String(v));
    const entries = Object.keys(opts.values || {}).map((name) => ({ name, value: opts.values[name] })).filter((e) => isNum(e.value) && e.value > 0).sort((a, b) => b.value - a.value);
    if (!entries.length) return empty(container, 'No exposure by country');
    if (!WM || !WM.paths) return empty(container, 'Map geometry not loaded');
    const total = sum(entries, (e) => e.value);
    // aggregate by ISO code (two spellings of one country share a shape)
    const byIso = new Map();
    for (const e of entries) {
      const iso = typeof WM.iso === 'function' ? WM.iso(e.name) : null;
      e.iso = iso && WM.paths[iso] ? iso : null;
      if (!e.iso) continue;
      if (!byIso.has(e.iso)) byIso.set(e.iso, { iso: e.iso, names: [], value: 0 });
      const g = byIso.get(e.iso); g.names.push(e.name); g.value += e.value;
    }
    const breaks = C.quantileBreaks(Array.from(byIso.values()).map((g) => g.value), 5);
    const nCls = breaks.length + 1;
    const colorOf = (v) => SEQ[C.rampIndex(C.classOf(v, breaks), nCls)];
    for (const e of entries) e.color = e.iso ? colorOf(byIso.get(e.iso).value) : C.NO_DATA;
    const allEurope = byIso.size > 0 && Array.from(byIso.keys()).every((iso) => EUROPE.has(iso));
    let view = opts.view === 'europe' || opts.view === 'world' ? opts.view : allEurope ? 'europe' : 'world';

    const wrap = div('cx-choro', container);
    const main = div('cx-choro-main', wrap), side = div('cx-choro-side', wrap);
    const bar = div('cx-choro-bar', main);
    bar.appendChild(segmented([{ id: 'europe', label: 'Europe' }, { id: 'world', label: 'World' }], view, (v) => { view = v; if (opts.onViewChange) opts.onViewChange(v); drawMap(); }));
    const offMap = entries.filter((e) => !e.iso);
    const note = div('cx-hint', bar); note.textContent = `${entries.length} ${entries.length === 1 ? 'country' : 'countries'}` + (offMap.length ? ` · ${offMap.length} not on map` : '');
    const mapEl = div('cx-map', main);
    const pathsByIso = new Map();

    // frame for the current view: [x0, y0, x1, y1] in map units
    function frame() {
      const vb = String(WM.viewBox || '0 0 800 460').split(/[\s,]+/).map(Number);
      if (view === 'world') return [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]];
      let box = null;
      for (const iso of byIso.keys()) {
        if (!EUROPE.has(iso)) continue;
        const b = mainBoxOf(iso, WM.paths[iso]); if (!b) continue;
        box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b.slice();
      }
      if (!box) return EUROPE_BOX.slice();
      const pad = Math.max(6, 0.12 * Math.max(box[2] - box[0], box[3] - box[1]));
      box = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
      // never zoom closer than ~60 × 45 map units, so a single small country keeps its neighbours for context
      const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, w = Math.max(60, box[2] - box[0]), h = Math.max(45, box[3] - box[1]);
      return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    }
    // draw the SVG map for the current view, expanding the frame to the element's aspect ratio (no distortion)
    function drawMap() {
      mapEl.innerHTML = ''; pathsByIso.clear();
      let [x0, y0, x1, y1] = frame();
      const W = width(mapEl, 520);
      const H = Math.round(clamp((W * (y1 - y0)) / (x1 - x0), 200, opts.height || 420));
      const aspect = W / H, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      let bw = x1 - x0, bh = y1 - y0;
      if (bw / bh < aspect) bw = bh * aspect; else bh = bw / aspect;
      const svg = el('svg', { width: W, height: H, viewBox: `${cx - bw / 2} ${cy - bh / 2} ${bw} ${bh}`, class: 'chart cx-map-svg', role: 'img', 'aria-label': 'Exposure by country map' }, mapEl);
      const front = [];
      for (const iso of Object.keys(WM.paths)) {
        const g = byIso.get(iso);
        const p = el('path', { d: WM.paths[iso], fill: g ? colorOf(g.value) : C.NO_DATA, class: 'cx-country' + (g ? ' cx-has' : '') }, svg);
        if (g) { front.push(p); pathsByIso.set(iso, p); hover(p, () => tipHtml(g.names.join(' / '), g.value), opts.onClick ? () => opts.onClick(g.names[0]) : null); }
      }
      for (const p of front) svg.appendChild(p); // exposure countries on top so their outlines are not covered
    }
    const tipHtml = (name, v) => `<b>${esc(name)}</b><br>${esc(fmt(v))} · ${pct(v / total)} of total`;

    // class legend: value range of each class, plus the no-exposure swatch
    const scale = div('cx-scale', main);
    const vals = Array.from(byIso.values()).map((g) => g.value).sort((a, b) => a - b);
    if (vals.length) {
      const lo = [vals[0]].concat(breaks), hi = breaks.concat([vals[vals.length - 1]]);
      for (let i = 0; i < nCls; i++) {
        const it = div('cx-scale-item', scale);
        const sw = document.createElement('span'); sw.className = 'cx-swatch'; sw.style.background = SEQ[C.rampIndex(i, nCls)];
        const lb = document.createElement('span'); lb.textContent = lo[i] === hi[i] ? fmt(hi[i]) : `${fmt(lo[i])} – ${fmt(hi[i])}`;
        it.append(sw, lb);
      }
    }
    const none = div('cx-scale-item', scale);
    const nsw = document.createElement('span'); nsw.className = 'cx-swatch cx-swatch-none';
    const nlb = document.createElement('span'); nlb.textContent = 'No exposure';
    none.append(nsw, nlb);

    // ranked side list (click filters; hover outlines the country on the map)
    const vmax = entries[0].value;
    const list = document.createElement('ol'); list.className = 'cx-rank'; side.appendChild(list);
    entries.forEach((e, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="cx-rank-n">${i + 1}</span><span class="cx-rank-name"><span class="cx-swatch${e.iso ? '' : ' cx-swatch-none'}" style="background:${e.color}"></span>${esc(e.name)}${e.iso ? '' : ' <span class="muted">(not on map)</span>'}</span><span class="cx-rank-val">${esc(fmt(e.value))}</span><span class="cx-rank-share">${pct(e.value / total)}</span><span class="cx-rank-meter"><span style="width:${((e.value / vmax) * 100).toFixed(1)}%"></span></span>`;
      if (opts.onClick) {
        li.style.cursor = 'pointer'; li.title = 'Filter on ' + e.name; li.tabIndex = 0; li.setAttribute('role', 'button');
        li.addEventListener('click', () => { if (C.hideTip) C.hideTip(); opts.onClick(e.name); });
        li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onClick(e.name); } });
      }
      li.addEventListener('mouseenter', () => { const p = e.iso && pathsByIso.get(e.iso); if (p) { p.classList.add('cx-hl'); p.parentNode.appendChild(p); } });
      li.addEventListener('mouseleave', () => { const p = e.iso && pathsByIso.get(e.iso); if (p) p.classList.remove('cx-hl'); });
      list.appendChild(li);
    });
    drawMap();
  };

  // ---------- treemap ----------
  /**
   * Two-level squarified treemap: groups (coloured by the series palette) → items.
   * opts: { items:[{ label, value, group, sub, key }], format, onClick(item), groupOrder:[labels] (stable colour order,
   *         e.g. from the unfiltered book), maxGroups (default 8; the tail folds into a grey "Other"), selectedKey, height }
   */
  C.treemap = function (container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const fmt = opts.format || ((v) => String(v));
    const items = (opts.items || []).filter((x) => x && isNum(x.value) && x.value > 0);
    if (!items.length) return empty(container);
    const total = sum(items, (x) => x.value);
    // colour slot per group from the stable order; groups past the palette fold into "Other"
    const present = new Map();
    for (const it of items) { const g = it.group === '' || it.group === null || it.group === undefined ? '(blank)' : String(it.group); present.set(g, (present.get(g) || 0) + it.value); }
    const order = opts.groupOrder && opts.groupOrder.length ? opts.groupOrder.map(String) : Array.from(present.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const maxG = opts.maxGroups || 8, slots = order.length <= maxG ? maxG : maxG - 1;
    const slotOf = (g) => { const i = order.indexOf(g); return i >= 0 && i < slots ? i : -1; };
    const groups = new Map();
    for (const it of items) {
      const g = it.group === '' || it.group === null || it.group === undefined ? '(blank)' : String(it.group);
      const s = slotOf(g), key = s >= 0 ? g : '__other';
      if (!groups.has(key)) groups.set(key, { label: g, slot: s, value: 0, items: [], members: new Set() });
      const grp = groups.get(key); grp.value += it.value; grp.items.push(it); grp.members.add(g);
    }
    const other = groups.get('__other');
    if (other) other.label = 'Other (' + other.members.size + ')';
    const colorOf = (grp) => (grp.slot >= 0 ? seriesColor(grp.slot) : C.OTHER_COLOR);
    const hexOf = (grp) => (grp.slot >= 0 ? SERIES_HEX[grp.slot % 8] : C.OTHER_COLOR);
    const glist = Array.from(groups.values()).sort((a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot);

    legend(container, glist.map((g) => ({ label: `${g.label} ${pct(g.value / total, 0)}`, color: colorOf(g) })));
    const W = width(container), H = opts.height || Math.round(clamp(W * 0.5, 260, 440));
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart cx-treemap', role: 'img', 'aria-label': 'Treemap of exposure' }, container);
    let selected = null;
    const glay = C.squarify(glist.map((g) => ({ value: g.value, g })), 0, 0, W, H);
    for (const gr of glay) {
      const g = gr.item.g, fill = colorOf(g), ink = C.inkOn(hexOf(g));
      const head = gr.w > 80 && gr.h > 56 ? 18 : 0; // group caption band only where it fits
      const gg = el('g', { class: 'cx-group' }, svg);
      el('rect', { x: gr.x, y: gr.y, width: Math.max(0, gr.w), height: Math.max(0, gr.h), fill, class: 'cx-group-bg' }, gg);
      if (head) text(gg, gr.x + 6, gr.y + 13, fit(`${g.label} · ${pct(g.value / total, 0)}`, gr.w - 12, 6.8), { class: 'cx-group-label', fill: ink });
      const tiles = C.squarify(g.items, gr.x + 1, gr.y + head + 1, Math.max(0, gr.w - 2), Math.max(0, gr.h - head - 2));
      for (const t of tiles) {
        const it = t.item;
        const tg = el('g', {}, gg);
        const r = el('rect', { x: t.x, y: t.y, width: Math.max(0, t.w), height: Math.max(0, t.h), fill, class: 'cx-tile' }, tg);
        if (opts.selectedKey !== undefined && opts.selectedKey !== null && it.key === opts.selectedKey) { r.classList.add('cx-tile-selected'); selected = r; }
        const name = t.w > 34 && t.h > 16 ? fit(it.label, t.w - 8, 6.4) : '';
        if (name) text(tg, t.x + 4, t.y + 13, name, { class: 'cx-tile-label', fill: ink });
        if (name && t.h > 32) text(tg, t.x + 4, t.y + 27, fit(fmt(it.value), t.w - 8, 6), { class: 'cx-tile-value', fill: ink });
        hover(tg, () => `<b>${esc(it.label)}</b><br>${esc(it.group || '(blank)')}${it.sub ? ' · ' + esc(it.sub) : ''}<br>${esc(fmt(it.value))} · ${pct(it.value / total)} of total · ${pct(it.value / (present.get(String(it.group || '(blank)')) || it.value))} of group`,
          opts.onClick ? () => { if (selected) selected.classList.remove('cx-tile-selected'); r.classList.add('cx-tile-selected'); selected = r; opts.onClick(it); } : null);
      }
    }
  };

  // ---------- heatmap ----------
  /**
   * Matrix with sequential green shading, row and column totals, value labels where they fit.
   * opts: { rows:[labels], cols:[labels], cell(r, c) → number, format, onClick(r, c) (r or c is null for a total),
   *         rowTitle, colTitle }
   */
  C.heatmap = function (container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const rows = opts.rows || [], cols = opts.cols || [];
    const fmt = opts.format || ((v) => String(v));
    if (!rows.length || !cols.length) return empty(container);
    const val = rows.map((r) => cols.map((c) => { const v = opts.cell(r, c); return isNum(v) ? v : 0; }));
    const rowT = val.map((a) => sum(a)), colT = cols.map((c, j) => sum(val, (a) => a[j])), grand = sum(rowT);
    let vmax = 0; for (const a of val) for (const v of a) if (v > vmax) vmax = v;
    const W = width(container);
    const labelW = clamp(Math.max.apply(null, rows.map((r) => String(r).length)) * 6.6 + 16, 70, 200), totalW = 78;
    const cellW = Math.max(52, (W - labelW - totalW) / cols.length), cellH = 28;
    const maxCol = Math.max.apply(null, cols.map((c) => String(c).length).concat(['Total'.length]));
    const rotate = maxCol * 6.4 + 10 > cellW;
    const headH = rotate ? Math.min(120, Math.min(maxCol, 22) * 6.4 * 0.72 + 20) : 24;
    // rotated headers lean right: leave room so the last column's label is not clipped
    const extraR = rotate ? Math.max(0, Math.min(22, maxCol) * 6.4 * 0.77 - totalW - cellW / 2) : 0;
    const SW = labelW + cellW * cols.length + totalW + extraR, SH = headH + cellH * (rows.length + 1) + 4;
    const scroller = div('cx-scroll', container);
    const svg = el('svg', { width: SW, height: SH, viewBox: `0 0 ${SW} ${SH}`, class: 'chart cx-heatmap', role: 'img', 'aria-label': 'Heatmap' }, scroller);
    const xOf = (j) => labelW + j * cellW, yOf = (i) => headH + i * cellH;
    // column headers (rotated when they do not fit), then the totals header
    cols.concat(['Total']).forEach((c, j) => {
      const x = j < cols.length ? xOf(j) + cellW / 2 : labelW + cellW * cols.length + totalW / 2;
      const label = fit(c, rotate ? 140 : cellW - 6, 6.4) || String(c).slice(0, 2);
      const t = rotate ? text(svg, x, headH - 6, label, { class: 'chart-label' + (j === cols.length ? ' cx-total-text' : ''), 'text-anchor': 'start', transform: `rotate(-40 ${x} ${headH - 6})` })
        : text(svg, x, headH - 8, label, { class: 'chart-label' + (j === cols.length ? ' cx-total-text' : ''), 'text-anchor': 'middle' });
      const title = el('title', {}, t); title.textContent = String(c);
    });
    const tipCell = (r, c, v, ofRow, ofCol) => `<b>${esc(r === null ? 'All' : r)} × ${esc(c === null ? 'All' : c)}</b><br>${esc(fmt(v))} · ${pct(grand ? v / grand : NaN)} of total` +
      (ofRow !== undefined ? `<br><span class="muted">${pct(ofRow)} of row · ${pct(ofCol)} of column</span>` : '');
    // one row of cells with its total
    rows.forEach((r, i) => {
      const y = yOf(i);
      text(svg, labelW - 8, y + cellH / 2 + 4, fit(r, labelW - 12, 6.6), { 'text-anchor': 'end', class: 'chart-label' });
      cols.forEach((c, j) => {
        const v = val[i][j], x = xOf(j);
        const fill = v > 0 ? C.seqColor(vmax ? v / vmax : 0) : C.NO_DATA;
        const g = el('g', {}, svg);
        el('rect', { x: x + 1, y: y + 1, width: cellW - 2, height: cellH - 2, rx: 2, fill, class: 'cx-cell' }, g);
        const s = v > 0 ? fmt(v) : '';
        if (s && s.length * 6.2 + 8 <= cellW) text(g, x + cellW / 2, y + cellH / 2 + 4, s, { 'text-anchor': 'middle', class: 'cx-cell-text', fill: C.inkOn(fill) });
        hover(g, () => tipCell(r, c, v, rowT[i] ? v / rowT[i] : NaN, colT[j] ? v / colT[j] : NaN), opts.onClick && v > 0 ? () => opts.onClick(r, c) : null);
      });
      const tx = labelW + cellW * cols.length, tg = el('g', {}, svg);
      el('rect', { x: tx + 1, y: y + 1, width: totalW - 2, height: cellH - 2, rx: 2, class: 'cx-cell-total' }, tg);
      text(tg, tx + totalW - 8, y + cellH / 2 + 4, fmt(rowT[i]), { 'text-anchor': 'end', class: 'cx-cell-text cx-total-text' });
      hover(tg, () => tipCell(r, null, rowT[i]), opts.onClick ? () => opts.onClick(r, null) : null);
    });
    // totals row
    const ty = yOf(rows.length);
    text(svg, labelW - 8, ty + cellH / 2 + 4, 'Total', { 'text-anchor': 'end', class: 'chart-label cx-total-text' });
    cols.forEach((c, j) => {
      const g = el('g', {}, svg);
      el('rect', { x: xOf(j) + 1, y: ty + 1, width: cellW - 2, height: cellH - 2, rx: 2, class: 'cx-cell-total' }, g);
      const s = fmt(colT[j]);
      if (s.length * 6.2 + 8 <= cellW) text(g, xOf(j) + cellW / 2, ty + cellH / 2 + 4, s, { 'text-anchor': 'middle', class: 'cx-cell-text cx-total-text' });
      hover(g, () => tipCell(null, c, colT[j]), opts.onClick ? () => opts.onClick(null, c) : null);
    });
    const gx = labelW + cellW * cols.length;
    el('rect', { x: gx + 1, y: ty + 1, width: totalW - 2, height: cellH - 2, rx: 2, class: 'cx-cell-total' }, svg);
    text(svg, gx + totalW - 8, ty + cellH / 2 + 4, fmt(grand), { 'text-anchor': 'end', class: 'cx-cell-text cx-total-text' });
    // shading key: light = small, dark = large (continuous)
    const key = div('cx-scale', container);
    key.innerHTML = `<span class="cx-scale-item"><span class="cx-swatch" style="background:${C.seqColor(0)}"></span>${esc(fmt(0))}</span><span class="cx-scale-ramp" style="background:linear-gradient(90deg, ${SEQ.join(', ')})"></span><span class="cx-scale-item"><span class="cx-swatch" style="background:${C.seqColor(1)}"></span>${esc(fmt(vmax))} (largest cell)</span>`;
  };

  // ---------- pareto ----------
  /**
   * Pareto chart on ONE percentage axis: bars = each item's share of the total, line = cumulative share.
   * opts: { items:[{ label, value, key }], total (default Σ items), max (default 15), format, onClick(item),
   *         threshold:{ value (fraction), label }, height }
   */
  C.pareto = function (container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const fmt = opts.format || ((v) => String(v));
    const all = (opts.items || []).filter((x) => x && isNum(x.value) && x.value > 0).sort((a, b) => b.value - a.value);
    if (!all.length) return empty(container);
    const total = isNum(opts.total) && opts.total > 0 ? opts.total : sum(all, (x) => x.value);
    const items = all.slice(0, opts.max || 15);
    let cum = 0;
    const pts = items.map((it) => { cum += it.value; return { it, share: it.value / total, cum: cum / total }; });
    const th = opts.threshold && isNum(opts.threshold.value) ? opts.threshold : null;
    legend(container, [{ label: 'Share of total', color: seriesColor(0) }, { label: 'Cumulative share', color: seriesColor(1), kind: 'line' }].concat(th ? [{ label: th.label || 'Threshold', kind: 'dash' }] : []));
    const W = width(container), H = opts.height || 300;
    const labels = items.map((it) => fit(it.label, 104, 6));
    // rotated x labels lean left: widen the left margin so the first one is not clipped
    const padL = clamp((labels[0] || '').length * 6 * 0.77 - 14, 44, 100), padR = 14, padT = 16, padB = clamp(Math.max.apply(null, labels.map((l) => l.length)) * 6 * 0.66 + 18, 40, 96);
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart cx-pareto', role: 'img', 'aria-label': 'Pareto chart' }, container);
    const top = Math.min(1, Math.max(pts[pts.length - 1].cum, th ? th.value : 0) * 1.08);
    const ticks = niceTicks(top, 5), vmax = ticks[ticks.length - 1] || 1;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const y = (v) => padT + plotH - (v / vmax) * plotH;
    ticks.forEach((t) => { el('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: 'chart-grid' }, svg); text(svg, padL - 6, y(t) + 4, pct(t, 0), { 'text-anchor': 'end', class: 'chart-tick' }); });
    const slot = plotW / items.length, bw = Math.min(40, slot * 0.62);
    const cx = (i) => padL + i * slot + slot / 2;
    pts.forEach((p, i) => {
      const g = el('g', {}, svg);
      el('rect', { x: padL + i * slot, y: padT, width: slot, height: plotH, fill: 'transparent' }, g);
      el('path', { d: barPathV(cx(i) - bw / 2, y(p.share), bw, y(0) - y(p.share), 4), fill: seriesColor(0), class: 'bar' }, g);
      if (slot >= 30) text(g, cx(i), y(p.share) - 5, pct(p.share, 1), { 'text-anchor': 'middle', class: 'chart-value' });
      const lx = cx(i) + 4, ly = H - padB + 12;
      text(g, lx, ly, labels[i], { 'text-anchor': 'end', class: 'chart-label', transform: `rotate(-40 ${lx} ${ly})` });
      hover(g, () => `<b>${esc(p.it.label)}</b><br>${esc(fmt(p.it.value))} · ${pct(p.share)} of total<br><span class="muted">cumulative ${pct(p.cum)} (top ${i + 1})</span>`, opts.onClick ? () => opts.onClick(p.it) : null);
    });
    el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'chart-axis' }, svg);
    if (th && th.value <= vmax) {
      el('line', { x1: padL, x2: W - padR, y1: y(th.value), y2: y(th.value), class: 'cx-threshold' }, svg);
      text(svg, W - padR, y(th.value) - 4, `${th.label || 'Threshold'} ${pct(th.value, 0)}`, { 'text-anchor': 'end', class: 'cx-threshold-label' });
    }
    // cumulative line drawn above the bars, with ringed markers (no pointer events, the slot carries the tooltip)
    el('polyline', { points: pts.map((p, i) => `${cx(i)},${y(p.cum)}`).join(' '), class: 'cx-cum-line' }, svg);
    pts.forEach((p, i) => el('circle', { cx: cx(i), cy: y(p.cum), r: 4, class: 'cx-cum-dot' }, svg));
    const last = pts[pts.length - 1];
    text(svg, Math.min(cx(pts.length - 1), W - padR - 4), y(last.cum) - 9, pct(last.cum, 1), { 'text-anchor': 'end', class: 'chart-value cx-cum-label' });
  };

  // ---------- maturity ladder ----------
  /**
   * Vertical bars per period (e.g. maturity year) with a cumulative-share label row under the axis.
   * opts: { items:[{ label, value, sub }], total (default Σ items), format, onClick(item), height }
   */
  C.ladder = function (container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const fmt = opts.format || ((v) => String(v));
    const items = (opts.items || []).filter((x) => x && isNum(x.value));
    if (!items.length || !items.some((x) => x.value > 0)) return empty(container);
    const total = isNum(opts.total) && opts.total > 0 ? opts.total : sum(items, (x) => x.value);
    const W = width(container), H = opts.height || 250, padL = 48, padR = 8, padT = 18, padB = 46;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart cx-ladder', role: 'img', 'aria-label': 'Maturity ladder' }, container);
    const ticks = niceTicks(Math.max.apply(null, items.map((i) => i.value)), 4), vmax = ticks[ticks.length - 1] || 1;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const y = (v) => padT + plotH - (v / vmax) * plotH;
    ticks.forEach((t) => { el('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: 'chart-grid' }, svg); text(svg, padL - 6, y(t) + 4, fmt(t), { 'text-anchor': 'end', class: 'chart-tick' }); });
    const slot = plotW / items.length, bw = Math.min(44, slot * 0.66);
    const every = Math.max(1, Math.ceil(34 / slot)); // label every n-th period when slots are narrow
    text(svg, padL - 6, H - 8, 'Cum.', { 'text-anchor': 'end', class: 'chart-tick' });
    let cum = 0;
    items.forEach((it, i) => {
      cum += it.value;
      const c = cum / total, x = padL + i * slot + (slot - bw) / 2;
      const g = el('g', {}, svg);
      el('rect', { x: padL + i * slot, y: padT, width: slot, height: H - padT, fill: 'transparent' }, g);
      if (it.value > 0) el('path', { d: barPathV(x, y(it.value), bw, y(0) - y(it.value), 4), fill: it.color || seriesColor(0), class: 'bar' }, g);
      if (it.value > 0 && slot >= 40 && items.length <= 16) text(g, x + bw / 2, y(it.value) - 5, fmt(it.value), { 'text-anchor': 'middle', class: 'chart-value' });
      if (i % every === 0) {
        text(g, x + bw / 2, H - padB + 16, it.label, { 'text-anchor': 'middle', class: 'chart-label' });
        text(g, x + bw / 2, H - 8, pct(c, 0), { 'text-anchor': 'middle', class: 'chart-tick' });
      }
      hover(g, () => `<b>${esc(it.label)}</b><br>${esc(fmt(it.value))} · ${pct(it.value / total)} of total<br><span class="muted">cumulative ${pct(c)}${it.sub ? ' · ' + esc(it.sub) : ''}</span>`, opts.onClick && it.value > 0 ? () => opts.onClick(it) : null);
    });
    el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'chart-axis' }, svg);
  };
})(typeof window !== 'undefined' ? window : globalThis);
