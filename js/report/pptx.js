/* Scope · PowerPoint writer — native, fully editable .pptx from plain JavaScript (no libraries, runs in the browser and Node).
 *
 * A .pptx is a zip of XML parts. This file writes the parts a presentation needs (one master, one blank layout, a theme)
 * plus one part per slide and per chart, and zips them with the workbook writer's zipStore (js/inputs/workbook.js).
 * Everything on a slide is a native object: text boxes, rectangles, tables and charts. Each chart carries its data as an
 * embedded workbook (written with writeXlsx), so PowerPoint's "Edit Data" opens the numbers behind it.
 *
 *   const deck = Scope.pptx.deck({ title: 'Quarterly report' });
 *   const s = deck.slide();
 *   s.rect({ x, y, w, h, fill: '1B2A4A' });
 *   s.text({ x, y, w, h, text: 'Title', size: 22, bold: true, color: 'FFFFFF' });
 *   s.table({ x, y, colW: [..], rows: [[..], ..], header: true });
 *   s.chart({ x, y, w, h, type: 'col' | 'bar' | 'doughnut', categories: [..], series: [{ name, values, color }] });
 *   const bytes = deck.toBytes(); // Uint8Array, ready for Scope.inputs.downloadBytes
 *
 * Positions and sizes are in inches on a 13.333 × 7.5 in (16:9) slide; font sizes in points; colours as 'RRGGBB'.
 */
(function (global) {
  'use strict';
  const Scope = (global.Scope = global.Scope || {});
  const P = (Scope.pptx = {});

  const EMU = 914400; // per inch
  const W = 13.333, H = 7.5;
  P.WIDTH = W; P.HEIGHT = H;
  const emu = (inches) => Math.round((+inches || 0) * EMU);
  const NS = {
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    pkg: 'http://schemas.openxmlformats.org/package/2006/relationships',
    ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  };
  const REL = NS.r;
  const CT = 'application/vnd.openxmlformats-officedocument.';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  let FONT = 'Arial';      // the deck's typeface: Arial, or the template's minor font (set per deck)
  let MAJOR = '';          // the template theme's heading (major) font, for sizing text set in it
  let SX = 1, SY = 1;      // drawing scale: 1 on the 13.333 × 7.5 in canvas, else the template's slide size over it
  const PNS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

  /** XML text: escaped, control characters dropped. */
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hex = (c, d) => (/^[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).toUpperCase() : d || '000000');
  const fill = (c) => (c ? `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>` : '<a:noFill/>');
  const line = (c, wPt) => (c ? `<a:ln w="${Math.round((wPt || 0.75) * 12700)}">${fill(c)}</a:ln>` : '<a:ln><a:noFill/></a:ln>');
  const xfrm = (o, tag) => `<${tag || 'a:xfrm'}><a:off x="${emu(o.x * SX)}" y="${emu(o.y * SY)}"/><a:ext cx="${Math.max(1, emu(o.w * SX))}" cy="${Math.max(1, emu(o.h * SY))}"/></${tag || 'a:xfrm'}>`;
  const ALIGN = { left: 'l', center: 'ctr', right: 'r', justify: 'just', l: 'l', ctr: 'ctr', r: 'r', just: 'just' };
  const ANCHOR = { top: 't', middle: 'ctr', bottom: 'b', t: 't', ctr: 'ctr', b: 'b' };

  /** Run properties: size (pt), bold, italic, colour. */
  const rPr = (o, tag) => `<a:${tag || 'rPr'} lang="en-GB" sz="${Math.round((o.size || 12) * 100)}"${o.bold ? ' b="1"' : ' b="0"'}${o.italic ? ' i="1"' : ''} dirty="0">${fill(o.color || '1F2937')}<a:latin typeface="${esc(o.font || FONT)}"/><a:cs typeface="${esc(o.font || FONT)}"/></a:${tag || 'rPr'}>`;
  /**
   * Paragraphs from a string (lines split on \n), or [{ runs: [{ text, size, bold, color, italic }] | text, align, bullet
   * (true or { char, color, size, indent }), spaceAfter (pt) }]. Run settings default to the shape's.
   */
  function paragraphs(o) {
    const list = Array.isArray(o.paras) ? o.paras : String(o.text === null || o.text === undefined ? '' : o.text).split('\n').map((t) => ({ text: t }));
    return list.map((p) => {
      const pp = typeof p === 'string' ? { text: p } : p;
      const base = { size: pp.size || o.size, bold: pp.bold !== undefined ? pp.bold : o.bold, color: pp.color || o.color, italic: pp.italic !== undefined ? pp.italic : o.italic, font: pp.font || o.font };
      const runs = (pp.runs || [{ text: pp.text }]).filter((r) => r && r.text !== undefined && r.text !== null && String(r.text) !== '');
      const algn = ALIGN[pp.align || o.align] || 'l';
      // bullet: true (•) or { char, color, size (% of the text), indent (in) }
      const bu = pp.bullet ? (typeof pp.bullet === 'object' ? pp.bullet : {}) : null;
      const bullet = bu ? `${bu.color ? `<a:buClr><a:srgbClr val="${hex(bu.color)}"/></a:buClr>` : ''}${bu.size ? `<a:buSzPct val="${Math.round(bu.size * 1000)}"/>` : ''}<a:buFont typeface="${bu.font || FONT}"/><a:buChar char="${esc(bu.char || '•')}"/>` : '<a:buNone/>';
      const ind = bu ? ` marL="${emu(bu.indent || 0.25)}" indent="-${emu(bu.indent || 0.25)}"` : '';
      const spc = pp.spaceAfter !== undefined ? pp.spaceAfter : o.spaceAfter;
      const pPr = `<a:pPr algn="${algn}"${ind}>${spc ? `<a:spcAft><a:spcPts val="${Math.round(spc * 100)}"/></a:spcAft>` : ''}${bullet}</a:pPr>`;
      const body = runs.map((r) => `<a:r>${rPr(Object.assign({}, base, r))}<a:t>${esc(r.text)}</a:t></a:r>`).join('');
      return `<a:p>${pPr}${body}${rPr(base, 'endParaRPr')}</a:p>`;
    }).join('');
  }
  const txBody = (o, tag) => {
    const ins = o.inset === undefined ? 0.08 : o.inset;
    return `<${tag || 'p:txBody'}><a:bodyPr wrap="square" lIns="${emu(ins)}" tIns="${emu(ins * 0.6)}" rIns="${emu(ins)}" bIns="${emu(ins * 0.6)}" anchor="${ANCHOR[o.valign] || 't'}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs(o)}</${tag || 'p:txBody'}>`;
  };

  // ---------- charts ----------
  const colRef = (i) => Scope.inputs.colName(i); // A, B, … Z, AA … (scatter and bubble charts use two or three columns per series)
  const isF = (v) => typeof v === 'number' && isFinite(v);
  const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = (vals, fmt) => `<c:numCache><c:formatCode>${esc(fmt || 'General')}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (Number.isFinite(+v) && v !== null && v !== '' ? `<c:pt idx="${i}"><c:v>${+v}</c:v></c:pt>` : '')).join('')}</c:numCache>`;
  const chartTx = (size, color, bold) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(size * 100)}" b="${bold ? 1 : 0}">${fill(color)}<a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-GB"/></a:p></c:txPr>`;
  /** A solid fill with transparency (alpha 0–1). */
  const fillA = (c, alpha) => (alpha === undefined || alpha >= 1 ? fill(c) : `<a:solidFill><a:srgbClr val="${hex(c)}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:solidFill>`);
  const NOLINE = '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>';
  const SHOW = (o) => ['showLegendKey', 'showVal', 'showCatName', 'showSerName', 'showPercent', 'showBubbleSize'].map((k) => `<c:${k} val="${o[k] ? 1 : 0}"/>`).join('');
  /** Plot area layout: automatic, or { l, t, w, h } as fractions of the chart frame (true = the whole frame). */
  const plotLayout = (pf) => { if (!pf) return '<c:layout/>'; const b = pf === true ? { l: 0, t: 0, w: 1, h: 1 } : pf; return `<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="${b.l}"/><c:y val="${b.t}"/><c:w val="${b.w}"/><c:h val="${b.h}"/></c:manualLayout></c:layout>`; };
  /** A value axis for scatter and bubble charts: { min, max, major, fmt, hide, title, grid, size, line }. */
  function valAx(id, cross, pos, a, size, txt) {
    a = a || {};
    const title = a.title ? `<c:title><c:tx><c:rich><a:bodyPr${pos === 'l' || pos === 'r' ? ' rot="-5400000" vert="horz"' : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round((a.size || size) * 100)}" b="0"/></a:pPr><a:r>${rPr({ size: a.size || size, color: txt })}<a:t>${esc(a.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` : '';
    const ln = a.line === false ? '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' : `<c:spPr><a:noFill/><a:ln w="9525">${fill(a.line || 'BFC5D2')}</a:ln></c:spPr>`;
    return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${isF(a.max) ? `<c:max val="${a.max}"/>` : ''}${isF(a.min) ? `<c:min val="${a.min}"/>` : ''}</c:scaling><c:delete val="${a.hide ? 1 : 0}"/><c:axPos val="${pos}"/>`
      + `${a.grid ? `<c:majorGridlines><c:spPr><a:ln w="6350">${fill(a.grid)}</a:ln></c:spPr></c:majorGridlines>` : ''}${title}<c:numFmt formatCode="${esc(a.fmt || 'General')}" sourceLinked="0"/><c:majorTickMark val="${a.ticks ? 'out' : 'none'}"/><c:minorTickMark val="none"/><c:tickLblPos val="${a.hide ? 'none' : 'low'}"/>`
      + `${ln}${chartTx(a.size || size, txt)}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/>${isF(a.major) ? `<c:majorUnit val="${a.major}"/>` : ''}</c:valAx>`;
  }
  /** Data label text for one point (scatter): rich text in the series' label style. */
  const richLbl = (k, text, size, color, pos, bold) => `<c:dLbl><c:idx val="${k}"/><c:layout/><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${Math.round(size * 100)}"/></a:pPr><a:r>${rPr({ size, color, bold })}<a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx>${NOLINE}<c:dLblPos val="${pos || 't'}"/>${SHOW({ showVal: 1 })}</c:dLbl>`;
  /** Where each series' numbers sit in the embedded workbook: columns and row count (bar/doughnut: one column per series). */
  function sheetLayout(o) {
    const xy = o.type === 'scatter' || o.type === 'bubble', per = o.type === 'bubble' ? 3 : 2;
    return (o.series || []).map((s, i) => xy ? { x: colRef(per * i), y: colRef(per * i + 1), z: o.type === 'bubble' ? colRef(per * i + 2) : null, n: (s.x || []).length } : { y: colRef(i + 1), n: (o.categories || []).length });
  }
  /**
   * One chart part (c:chartSpace).
   *   bar / col: { categories, series: [{ name, values, color }], stacked, numFmt, labels, legend, gap }
   *   doughnut: { categories, series: [{ values }], colors, holeSize, labelMode: 'pct' | 'catpct' | 'none', labelColors, minLabel (share under which a slice has no label), border }
   *   scatter: { series: [{ name, x, y, color, line, lineW, marker: 'x' | 'circle' | 'none', markerSize, labels: [text per point], labelPos (one, or one per point: t, r, b, l) }], xAxis, yAxis }
   *   bubble: { series: [{ name, x, y, size, color, alpha, labels, labelPos (per bubble: ctr, r …), labelColors }], bubbleScale, numFmt (label of the size), labelColor, xAxis, yAxis }
   * Every type: fontSize, textColor, legend, plotFill (plot area = the whole frame, or { l, t, w, h } fractions).
   */
  function chartXml(o) {
    const cats = (o.categories || []).map((c) => String(c === null || c === undefined ? '' : c));
    const n = cats.length, fmt = o.numFmt || '#,##0.0', size = o.fontSize || 10, txt = o.textColor || '4B5563';
    const lay = sheetLayout(o);
    const catF = `Sheet1!$A$2:$A$${n + 1}`;
    const dLbls = (isPie) => (o.labels === false ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
      : `<c:dLbls><c:numFmt formatCode="${esc(isPie ? '0%' : fmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${chartTx(size - 1, isPie ? (o.labelColor || 'FFFFFF') : txt, isPie)}${isPie ? '' : `<c:dLblPos val="${o.stacked ? 'ctr' : 'outEnd'}"/>`}<c:showLegendKey val="0"/><c:showVal val="${isPie ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${isPie ? 1 : 0}"/><c:showBubbleSize val="0"/>${isPie ? '<c:showLeaderLines val="0"/>' : ''}</c:dLbls>`);
    const serTx = (s, i, col) => `<c:tx><c:strRef><c:f>Sheet1!$${col || colRef(i + 1)}$1</c:f>${strCache([s.name || 'Series ' + (i + 1)])}</c:strRef></c:tx>`;
    const cat = `<c:cat><c:strRef><c:f>${catF}</c:f>${strCache(cats)}</c:strRef></c:cat>`;
    const val = (s, i) => `<c:val><c:numRef><c:f>Sheet1!$${colRef(i + 1)}$2:$${colRef(i + 1)}$${n + 1}</c:f>${numCache(s.values || [], fmt)}</c:numRef></c:val>`;
    // scatter and bubble series are padded to one length (empty points): some viewers drop a series shorter than the next one
    const padTo = Math.max(0, ...(o.series || []).map((sr) => (sr.x || []).length));
    const nums = (tag, col, vals, f) => { const v = vals.concat(Array(Math.max(0, padTo - vals.length)).fill(null)); return `<c:${tag}><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${Math.max(2, v.length + 1)}</c:f>${numCache(v, f)}</c:numRef></c:${tag}>`; };
    let plot;
    if (o.type === 'doughnut') {
      const s = (o.series || [])[0] || { values: [] };
      const colors = o.colors || [], lc = o.labelColors || [], mode = o.labels === false ? 'none' : o.labelMode || 'pct';
      const total = (s.values || []).reduce((t, v) => t + (isF(+v) && +v > 0 ? +v : 0), 0);
      const dpts = cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${fill(colors[k % Math.max(1, colors.length)] || '3A6FD8')}<a:ln w="${Math.round((o.borderW || 1.5) * 12700)}">${fill(o.border || 'FFFFFF')}</a:ln></c:spPr></c:dPt>`).join('');
      const show = { showCatName: mode === 'catpct', showPercent: 1 }, sep = mode === 'catpct' ? '<c:separator>\n</c:separator>' : '';
      const one = (k) => { const v = +(s.values || [])[k]; if (o.minLabel && total && (!isF(v) || v / total < o.minLabel)) return `<c:dLbl><c:idx val="${k}"/><c:delete val="1"/></c:dLbl>`;
        return lc[k] ? `<c:dLbl><c:idx val="${k}"/><c:numFmt formatCode="0%" sourceLinked="0"/>${NOLINE}${chartTx(size - 1, lc[k], o.labelBold !== false)}${SHOW(show)}${sep}</c:dLbl>` : ''; };
      const lbls = mode === 'none' ? '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
        : `<c:dLbls>${cats.map((_, k) => one(k)).join('')}<c:numFmt formatCode="0%" sourceLinked="0"/>${NOLINE}${chartTx(size - 1, o.labelColor || 'FFFFFF', o.labelBold !== false)}${SHOW(show)}${sep}<c:showLeaderLines val="0"/></c:dLbls>`;
      plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${serTx(s, 0)}${dpts}${lbls}${cat}${val(s, 0)}</c:ser><c:firstSliceAng val="${o.firstSliceAng || 0}"/><c:holeSize val="${o.holeSize || 60}"/></c:doughnutChart>`;
    } else if (o.type === 'scatter') {
      const sers = (o.series || []).map((s, i) => {
        const L = lay[i], c = s.color || '3A6FD8';
        const sp = s.line ? `<c:spPr><a:ln w="${Math.round((s.lineW || 1.5) * 12700)}" cap="rnd">${fill(c)}<a:round/></a:ln></c:spPr>` : '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>';
        // an x or a plus is drawn by its line alone (thin, unfilled, so it stays an x at any zoom); other shapes filled
        const open = s.marker === 'x' || s.marker === 'plus';
        const mk = !s.marker || s.marker === 'none' ? '<c:marker><c:symbol val="none"/></c:marker>' : `<c:marker><c:symbol val="${s.marker}"/><c:size val="${s.markerSize || 7}"/><c:spPr>${open ? '<a:noFill/>' : fill(c)}<a:ln w="${open ? 12700 : 15875}">${fill(c)}</a:ln></c:spPr></c:marker>`;
        const lbls = s.labels ? `<c:dLbls>${s.labels.map((t, k) => (t ? richLbl(k, t, s.labelSize || size - 1, s.labelColor || txt, Array.isArray(s.labelPos) ? s.labelPos[k] : s.labelPos) : `<c:dLbl><c:idx val="${k}"/><c:delete val="1"/></c:dLbl>`)).join('')}${NOLINE}${SHOW({})}</c:dLbls>` : '';
        return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${serTx(s, i, L.y)}${sp}${mk}${lbls}${nums('xVal', L.x, s.x || [], (o.xAxis || {}).fmt)}${nums('yVal', L.y, s.y || [], (o.yAxis || {}).fmt)}<c:smooth val="0"/></c:ser>`;
      }).join('');
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}<c:axId val="50010"/><c:axId val="50020"/></c:scatterChart>${valAx(50010, 50020, 'b', o.xAxis, size, txt)}${valAx(50020, 50010, 'l', o.yAxis, size, txt)}`;
    } else if (o.type === 'bubble') {
      const sers = (o.series || []).map((s, i) => {
        const L = lay[i], c = s.color || '3A6FD8';
        const lc = s.labelColor || o.labelColor || 'FFFFFF';
        // labels: the given text per bubble (written out, so every viewer shows it), else the bubble size in numFmt
        const lbls = o.labels === false ? '' : s.labels ? `<c:dLbls>${s.labels.map((t, k) => richLbl(k, t, size, (s.labelColors && s.labelColors[k]) || lc, (s.labelPos && s.labelPos[k]) || 'ctr', true)).join('')}${NOLINE}${SHOW({})}</c:dLbls>`
          : `<c:dLbls><c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/>${NOLINE}${chartTx(size, lc, true)}<c:dLblPos val="ctr"/>${SHOW({ showBubbleSize: 1 })}</c:dLbls>`;
        return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${serTx(s, i, L.y)}<c:spPr>${fillA(c, s.alpha)}<a:ln w="9525">${fill('FFFFFF')}</a:ln></c:spPr><c:invertIfNegative val="0"/>${lbls}${nums('xVal', L.x, s.x || [])}${nums('yVal', L.y, s.y || [])}${nums('bubbleSize', L.z, s.size || [], fmt)}<c:bubble3D val="0"/></c:ser>`;
      }).join('');
      plot = `<c:bubbleChart><c:varyColors val="0"/>${sers}<c:bubbleScale val="${o.bubbleScale || 100}"/><c:showNegBubbles val="0"/><c:axId val="50010"/><c:axId val="50020"/></c:bubbleChart>${valAx(50010, 50020, 'b', o.xAxis, size, txt)}${valAx(50020, 50010, 'l', o.yAxis, size, txt)}`;
    } else {
      const horizontal = o.type === 'bar';
      // room above the largest bar for its label (the axis itself is hidden)
      const top = Math.max(0, ...(o.series || []).map((sr) => (o.stacked ? 0 : Math.max(0, ...(sr.values || []).map((v) => (Number.isFinite(+v) ? +v : 0))))), o.stacked ? Math.max(0, ...cats.map((_, k) => (o.series || []).reduce((t, sr) => t + (Number.isFinite(+(sr.values || [])[k]) ? +(sr.values || [])[k] : 0), 0))) : 0);
      const headroom = top > 0 ? +(top * (horizontal ? 1.18 : 1.1)).toPrecision(4) : 0;
      const sers = (o.series || []).map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${serTx(s, i)}<c:spPr>${fill(s.color || '3A6FD8')}</c:spPr><c:invertIfNegative val="0"/>${dLbls(false)}${cat}${val(s, i)}</c:ser>`).join('');
      const axLine = `<c:spPr><a:noFill/><a:ln w="9525">${fill('BFC5D2')}</a:ln></c:spPr>`;
      plot = `<c:barChart><c:barDir val="${horizontal ? 'bar' : 'col'}"/><c:grouping val="${o.stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="${o.gap || 60}"/>${o.stacked ? '<c:overlap val="100"/>' : ''}<c:axId val="50010"/><c:axId val="50020"/></c:barChart>`
        + `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="${horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axLine}${chartTx(size, txt)}<c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
        + `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/>${headroom ? `<c:max val="${headroom}"/>` : ''}<c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="${horizontal ? 't' : 'l'}"/><c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="50010"/><c:crosses val="${horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
    }
    const legend = o.legend ? `<c:legend><c:legendPos val="${o.legend === true ? 'b' : o.legend}"/><c:overlay val="0"/>${chartTx(size, txt)}</c:legend>` : '';
    return HEAD + `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:date1904 val="0"/><c:lang val="en-GB"/><c:roundedCorners val="0"/>`
      + `<c:chart><c:autoTitleDeleted val="1"/><c:plotArea>${plotLayout(o.plotFill)}${plot}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
      + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${chartTx(size, txt)}<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
  }
  /** The chart's data as a one-sheet workbook (Edit Data): categories in A and one column per series; x / y (/ size) columns per series for scatter and bubble charts. */
  function chartWorkbook(o) {
    const numOr = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);
    if (o.type === 'scatter' || o.type === 'bubble') {
      const head = [], cols = [];
      (o.series || []).forEach((s, i) => { const nm = s.name || 'Series ' + (i + 1); head.push(nm + ' (x)', nm); cols.push(s.x || [], s.y || []); if (o.type === 'bubble') { head.push(nm + ' (size)'); cols.push(s.size || []); } });
      const n = Math.max(0, ...cols.map((c) => c.length));
      const rows = [head]; for (let k = 0; k < n; k++) rows.push(cols.map((c) => numOr(c[k])));
      return Scope.inputs.writeXlsx([{ name: 'Sheet1', rows }]);
    }
    const rows = [[''].concat((o.series || []).map((s, i) => s.name || 'Series ' + (i + 1)))];
    (o.categories || []).forEach((c, k) => rows.push([String(c === null || c === undefined ? '' : c)].concat((o.series || []).map((s) => numOr((s.values || [])[k])))));
    return Scope.inputs.writeXlsx([{ name: 'Sheet1', rows }]);
  }

  // ---------- tables ----------
  /** A table cell: a string / number, or { text, bold, color, fill, align, size }. */
  function cellXml(c, t, isHeader, rowFill) {
    const o = c !== null && typeof c === 'object' ? c : { text: c };
    const size = o.size || t.size || 10;
    const run = { text: o.text === null || o.text === undefined ? '' : String(o.text), size, bold: o.bold !== undefined ? o.bold : isHeader, color: o.color || (isHeader ? t.headerColor || 'FFFFFF' : t.color || '1F2937') };
    const algn = ALIGN[o.align] || 'l';
    const bg = o.fill || (isHeader ? t.headerFill || '1B2A4A' : rowFill);
    const border = t.border || 'E5E7EB';
    const none = (tag) => `<a:${tag} w="0"><a:noFill/></a:${tag}>`;
    const m = emu(0.06);
    const body = run.text.split('\n').map((t) => (t ? `<a:r>${rPr(Object.assign({}, run, { italic: o.italic }))}<a:t>${esc(t)}</a:t></a:r>` : '')).join(`<a:br>${rPr(run)}</a:br>`); // "\n" = a line break in the cell
    const top = o.topBorder || (t.rowTop || {})[o._row] ? `<a:lnT w="12700">${fill(o.topBorder || t.rowTop[o._row])}</a:lnT>` : none('lnT');
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${algn}"${o.indent ? ` marL="${emu(o.indent)}"` : ''}><a:buNone/></a:pPr>${body}${rPr(run, 'endParaRPr')}</a:p></a:txBody>`
      + `<a:tcPr marL="${m}" marR="${m}" marT="${emu(0.03)}" marB="${emu(0.03)}" anchor="ctr">${none('lnL')}${none('lnR')}${top}<a:lnB w="6350">${fill(o.borderColor || border)}</a:lnB>${fill(bg)}</a:tcPr></a:tc>`;
  }
  function tableXml(id, t) {
    const colW = t.colW || [];
    const w = colW.reduce((s, x) => s + x, 0), rowH = t.rowH || 0.3;
    const rows = t.rows || [];
    const trs = rows.map((r, i) => {
      const isHeader = !!t.header && i === 0;
      const zebra = t.zebra && !isHeader && (i - (t.header ? 1 : 0)) % 2 === 1 ? t.zebra : null;
      const rowStyle = (t.rowStyles || {})[i] || {};
      return `<a:tr h="${emu((rowStyle.h || rowH) * SY)}">${colW.map((_, k) => cellXml(Object.assign({}, typeof r[k] === 'object' && r[k] !== null ? r[k] : { text: r[k] }, rowStyle.cell || {}, { align: (r[k] && r[k].align) || (t.align || [])[k], _row: i }), t, isHeader, rowStyle.fill || zebra)).join('')}</a:tr>`;
    }).join('');
    return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
      + xfrm({ x: t.x, y: t.y, w, h: rowH * rows.length }, 'p:xfrm')
      + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${t.header ? 1 : 0}" bandRow="0"/><a:tblGrid>${colW.map((x) => `<a:gridCol w="${emu(x * SX)}"/>`).join('')}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  }

  // ---------- the deck ----------
  /** A new presentation: { title }. */
  P.deck = function (opts) {
    const o = opts || {};
    const tpl = o.template || null;
    FONT = o.font || (tpl && tpl.font) || 'Arial'; MAJOR = (tpl && tpl.majorFont) || FONT; SX = tpl ? tpl.w / W : 1; SY = tpl ? tpl.h / H : 1; // the deck's typeface: set, else the template's, else Arial
    const slides = [];
    let chartCount = 0;
    const deck = {
      slides,
      /** Add a slide; returns its drawing API. */
      slide(so) {
        const shapes = [], charts = [];
        let nextId = 2;
        // on a template the slide is built on one of its pages: cover, section or content (see P.readTemplate)
        const kind = (so && so.base) || 'content', page = tpl ? tpl.pages[tpl.kinds[kind] || 0] : null, roles = page ? P.slotRoles(page, kind) : [];
        const s = {
          shapes, charts, page, kind, slotRoles: roles,
          /** The roles this slide's template page has slots for (Scope draws the others itself), and what goes in them. */
          roles: new Set(roles.filter(Boolean)), fill: Object.assign({}, so && so.fill),
          /** The free area of the page (inches on the 13.333 × 7.5 canvas): the template content page's, else null. */
          box: page && kind === 'content' ? Object.assign({}, page.box) : null,
          /** Rectangle: { x, y, w, h, fill, line, lineW, radius (0–0.5 of the short side) }. */
          rect(r) {
            const id = nextId++;
            const geom = r.radius ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(0.5, r.radius) * 100000)}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
            shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(r)}${geom}${fill(r.fill)}${line(r.line, r.lineW)}</p:spPr>${r.text !== undefined || r.paras ? txBody(r) : ''}</p:sp>`);
            return s;
          },
          /** Text box: { x, y, w, h, text | paras, size, bold, italic, color, align, valign, fill, line, inset, spaceAfter }. */
          text(t) {
            const id = nextId++;
            shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(t)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill(t.fill)}${line(t.line, t.lineW)}</p:spPr>${txBody(t)}</p:sp>`);
            return s;
          },
          /** Line: { x1, y1, x2, y2, color, w (pt) }. */
          line(l) {
            const id = nextId++;
            const x = Math.min(l.x1, l.x2), y = Math.min(l.y1, l.y2);
            const flip = (l.x2 < l.x1 ? ' flipH="1"' : '') + (l.y2 < l.y1 ? ' flipV="1"' : '');
            shapes.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flip}><a:off x="${emu(x * SX)}" y="${emu(y * SY)}"/><a:ext cx="${emu(Math.abs(l.x2 - l.x1) * SX)}" cy="${emu(Math.abs(l.y2 - l.y1) * SY)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>${line(l.color || 'BFC5D2', l.w || 0.75)}</p:spPr></p:cxnSp>`);
            return s;
          },
          /** Freeform (a map country…): { x, y, w, h, paths: [[[px, py], …], …] in a pw × ph path space, fill, line, lineW, name }. */
          freeform(f) {
            const id = nextId++, r = (v) => Math.round(v);
            const pl = (f.paths || []).filter((pts) => pts.length > 2).map((pts) => `<a:path w="${r(f.pw)}" h="${r(f.ph)}"><a:moveTo><a:pt x="${r(pts[0][0])}" y="${r(pts[0][1])}"/></a:moveTo>${pts.slice(1).map((p) => `<a:lnTo><a:pt x="${r(p[0])}" y="${r(p[1])}"/></a:lnTo>`).join('')}<a:close/></a:path>`).join('');
            shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(f.name || 'Freeform ' + id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(f)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${pl}</a:pathLst></a:custGeom>${fill(f.fill)}${line(f.line, f.lineW)}</p:spPr></p:sp>`);
            return s;
          },
          /** Table: { x, y, colW: [inches], rows: [[cell]], header, rowH, size, align: ['left'|'right'…], zebra, headerFill, headerColor, border, rowStyles: { i: { fill, cell } }, rowTop: { i: colour of a rule above row i } }. */
          table(t) { shapes.push(tableXml(nextId++, t)); return s; },
          /** Chart: { x, y, w, h, type: 'col' | 'bar' | 'doughnut' | 'scatter' | 'bubble', … } (see chartXml for each type's options). */
          chart(c) {
            const id = nextId++, k = ++chartCount, rid = 'rId' + (charts.length + 2);
            charts.push({ k, rid, spec: c });
            shapes.push(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(c, 'p:xfrm')}<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`);
            return s;
          },
          /** Speaker notes are not written; slide title for the outline. */
          title: '',
        };
        slides.push(s);
        return s;
      },
      /** The .pptx bytes. */
      toBytes() { return P.package(slides, o); },
      /** The template in force (see P.readTemplate), or null. */
      template: tpl,
    };
    return deck;
  };

  // ---------- a template of the user's own ----------
  /** The top-level elements of an XML fragment, in order (each a complete string). */
  function children(inner) {
    const out = []; const re = /<(\/?)([A-Za-z][\w:.-]*)\b[^>]*?(\/?)>/g; let m, depth = 0, start = -1;
    while ((m = re.exec(inner))) {
      if (m[3] === '/') { if (depth === 0) out.push(inner.slice(m.index, re.lastIndex)); continue; }
      if (!m[1]) { if (depth === 0) start = m.index; depth++; } else { depth--; if (depth === 0) out.push(inner.slice(start, re.lastIndex)); }
    }
    return out;
  }
  const plainText = (x) => Array.from(x.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1]).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
  const phOf = (x) => { const m = x.match(/<p:ph\b([^>]*)\/?>/); if (!m) return null; const a = (k) => (m[1].match(new RegExp('\\b' + k + '="([^"]*)"')) || [])[1] || ''; return { type: a('type') || (a('idx') ? 'body' : ''), idx: a('idx') }; };
  /** Own position of a shape or group, in EMU, or null (a placeholder that inherits it). */
  const geomOf = (x) => { const m = x.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/); return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null; };
  /** Placeholders (with their position) and positioned shapes of a layout or master part. */
  const partShapes = (xml) => children((xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/) || [, ''])[1]).filter((c) => !/^<p:(nvGrpSpPr|grpSpPr)\b/.test(c)).map((c) => ({ ph: phOf(c), g: geomOf(c), xml: c }));
  /** The first font size (pt) set in a piece of XML: a run's, the paragraph end's or a list style's first level. */
  const szOf = (x) => { const m = String(x || '').match(/<a:(?:rPr|endParaRPr|defRPr)\b[^>]*\bsz="(\d+)"/); return m ? +m[1] / 100 : 0; };
  /** The text of a shape's paragraphs, entities decoded, paragraphs joined by "\n" (not trimmed: offsets count in it). */
  const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const paraText = (x) => (x.match(/<a:p\b[\s\S]*?<\/a:p>|<a:p\/>/g) || []).map((p) => Array.from(p.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => unxml(m[1])).join('')).join('\n');
  /** The text a slot asks for: "x" (any case, "xx" too, in quotes or brackets: “X”, [x]), filled by its place on the page, or a {token}. */
  const slotToken = (t) => {
    const v = String(t || '').replace(/\u00a0/g, ' ').trim(), k = v.match(/^\{\s*([a-z]+)\s*\}$/i);
    if (k) return k[1].toLowerCase();
    const bare = v.replace(/^[\s"“”'‘’«»\[(<]+|[\s"“”'‘’«»\])>:.,]+$/g, '');
    return /^x{1,3}$/i.test(bare) ? 'x' : null;
  };
  /** An "x" inside a short line ("REPORTING AS OF “X”", "“x” – PORTFOLIO OVERVIEW"): its [start, end) in the text, else null. */
  const INLINE = /["“”'‘’«\[(<{]\s*x{1,3}\s*["“”'‘’»\])>}]|(?<![\p{L}\p{N}._/@-])x{1,3}(?![\p{L}\p{N}._/@-])/giu;
  const inlineToken = (t) => { if (!t || t.length > 90) return null; const ms = Array.from(t.matchAll(INLINE)); return ms.length === 1 ? [ms[0].index, ms[0].index + ms[0][0].length] : null; };
  P.SLOT_ROLES = ['name', 'date', 'number', 'title', 'subtitle', 'kicker', 'source'];

  /**
   * Read a .pptx (bytes) as a template. Each of its first slides is a page Scope builds on, kept as it is (pictures,
   * bands, logo, footer, slide-number fields, placeholders with text) with the layouts, masters, themes and images they
   * use: slide 1 = the cover, slide 2 = the section break, slide 3 = the content page (one slide = every page; two = cover
   * and section, then content). A text box whose whole text is "x" (any case, in quotes too: “X”), or a short line with
   * one "x" in it ("REPORTING AS OF “X”": only the x is replaced), is a slot Scope fills by its place on the page
   * (cover: name, then date; section: number, title, subtitle; content: kicker then title at the top, the source line at
   * the bottom); "{title}", "{kicker}", "{source}", "{name}", "{date}", "{number}" or "{subtitle}" name the slot outright.
   * The content page's free area (under its title, above its footer) is where the exhibits go. Nothing leaves the machine.
   * Returns { name, w, h (inches), font, colors, pages, kinds, layouts, masters, themes, media, shapeCount, imageCount, dropped, layoutName }.
   */
  P.readTemplate = async function (bytes, name) {
    const IN = Scope.inputs, dec = new TextDecoder();
    const ents = IN.zipEntries(bytes), byName = new Map(ents.map((e) => [e.name.replace(/^\/+/, ''), e]));
    const has = (n) => byName.has(n);
    const text = async (n) => { const e = byName.get(n); if (!e) throw new Error(`${n} is missing in the template`); return dec.decode(await e.bytes()); };
    const attr = (tag, k) => (tag.match(new RegExp('\\b' + k + '="([^"]*)"')) || [])[1] || '';
    const relsOf = async (part) => { const n = part.replace(/([^/]+)$/, '_rels/$1.rels'); if (!has(n)) return []; return Array.from((await text(n)).matchAll(/<Relationship\b([^>]*?)\/?>/g)).map((m) => ({ id: attr(m[1], 'Id'), type: attr(m[1], 'Type').replace(/^.*\//, ''), typeFull: attr(m[1], 'Type'), target: attr(m[1], 'Target'), mode: attr(m[1], 'TargetMode') })); };
    const resolve = (part, target) => { if (/^\//.test(target)) return target.slice(1); const parts = part.replace(/[^/]+$/, '').split('/').filter(Boolean); for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); } return parts.join('/'); };
    if (!has('ppt/presentation.xml')) throw new Error('not a PowerPoint file (.pptx)');
    const pres = await text('ppt/presentation.xml');
    const sz = pres.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
    const w = sz ? +sz[1] / EMU : W, h = sz ? +sz[2] / EMU : H, cvX = (e) => e / EMU / (w / W), cvY = (e) => e / EMU / (h / H); // EMU → inches on Scope's 13.333 × 7.5 canvas
    const presRels = await relsOf('ppt/presentation.xml');
    const slideParts = Array.from(pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)).map((m) => presRels.find((r) => r.id === m[1] && r.type === 'slide')).filter(Boolean).map((r) => resolve('ppt/presentation.xml', r.target)).slice(0, 6);
    if (!slideParts.length) throw new Error('the template has no slide');
    const masterIds = new Map(Array.from(pres.matchAll(/<p:sldMasterId\b([^>]*)\/?>/g)).map((m) => { const rel = presRels.find((r) => r.id === attr(m[1], 'r:id')); return [rel ? resolve('ppt/presentation.xml', rel.target) : '', attr(m[1], 'id')]; }));
    // images are copied under ppt/media/tpl_N.ext; external hyperlinks kept; every other relationship (notes, tags, OLE…) dropped with what uses it
    const media = [], mediaFor = new Map();
    let dropped = 0;
    async function keepRels(part, rels, structural) {
      const kept = [];
      for (const r of rels) {
        if (structural && structural(r)) { const t = structural(r); if (t !== true) kept.push({ id: r.id, type: r.type, target: t }); continue; }
        if (r.type === 'hyperlink' && r.mode === 'External') { kept.push({ id: r.id, type: r.typeFull, target: r.target, mode: 'External' }); continue; }
        if (r.type !== 'image' || r.mode === 'External') continue;
        const src = resolve(part, r.target), e = byName.get(src); if (!e) continue;
        if (!mediaFor.has(src)) { const ext = (src.match(/\.([a-z0-9]+)$/i) || [0, 'bin'])[1].toLowerCase(); const nn = `ppt/media/tpl_${media.length + 1}.${ext}`; media.push({ name: nn, ext, bytes: await e.bytes() }); mediaFor.set(src, nn); }
        kept.push({ id: r.id, type: 'image', target: '../' + mediaFor.get(src).replace(/^ppt\//, '') });
      }
      return kept;
    }
    /** A part's XML with what refers to a dropped relationship removed (tags, shapes, a background); ids kept as they are. */
    function prune(xml, keptIds) {
      let x = xml.replace(/<p:custDataLst>[\s\S]*?<\/p:custDataLst>|<p:custDataLst\/>/g, '').replace(/<p:timing>[\s\S]*?<\/p:timing>/g, '');
      const bad = (s) => Array.from(s.matchAll(/\br:(?:embed|link|id|pict)="([^"]+)"/g)).some((m) => !keptIds.has(m[1]));
      const tm = x.match(/<p:spTree>([\s\S]*)<\/p:spTree>/);
      if (tm) { const kids = children(tm[1]).filter((c) => { if (bad(c)) { dropped++; return false; } return true; }); x = x.replace(tm[0], () => `<p:spTree>${kids.join('')}</p:spTree>`); }
      const bg = (x.match(/<p:bg>[\s\S]*?<\/p:bg>/) || [''])[0]; if (bg && bad(bg)) x = x.replace(bg, '');
      return x.replace(/\br:(embed|link|pict)="([^"]+)"/g, (m0, k, id) => (keptIds.has(id) ? m0 : '')).replace(/\br:id="([^"]+)"/g, (m0, id) => (keptIds.has(id) ? m0 : 'r:id=""'));
    }
    const themes = [], masters = [], layouts = [];
    const masterIndex = new Map(), layoutIndex = new Map();
    async function addMaster(part) {
      if (masterIndex.has(part)) return masterIndex.get(part);
      const xml = await text(part), rels = await relsOf(part);
      const themeRel = rels.find((r) => r.type === 'theme'); if (!themeRel) throw new Error('a template master has no theme');
      themes.push(await text(resolve(part, themeRel.target)));
      const k = masters.length; masterIndex.set(part, k);
      masters.push({ part, xml, rels, theme: themes.length - 1, id: masterIds.get(part) || String(2147483648 + k * 100) });
      return k;
    }
    async function addLayout(part) {
      if (layoutIndex.has(part)) return layoutIndex.get(part);
      const xml = await text(part), rels = await relsOf(part);
      const mRel = rels.find((r) => r.type === 'slideMaster'); if (!mRel) throw new Error('a template layout has no master');
      const m = await addMaster(resolve(part, mRel.target));
      const k = layouts.length; layoutIndex.set(part, k);
      const kept = await keepRels(part, rels, (r) => (r.type === 'slideMaster' ? `../slideMasters/slideMaster${m + 1}.xml` : false));
      layouts.push({ part, xml: prune(xml, new Set(kept.map((r) => r.id))), rels: kept, master: m });
      return k;
    }
    const pages = [];
    for (const sp of slideParts) {
      const xml0 = await text(sp), rels = await relsOf(sp);
      const lRel = rels.find((r) => r.type === 'slideLayout'); if (!lRel) throw new Error('a template slide has no layout');
      const li = await addLayout(resolve(sp, lRel.target));
      // the slide's own images and links, renamed rIdT1… so they never meet the ids of Scope's charts
      const kept = await keepRels(sp, rels.filter((r) => r.type !== 'slideLayout'));
      const ren = new Map(kept.map((r, i) => [r.id, 'rIdT' + (i + 1)])); kept.forEach((r) => { r.id = ren.get(r.id); });
      let xml = xml0.replace(/\br:(embed|link|id|pict)="([^"]*)"/g, (m0, k, id) => (id === '' ? m0 : `r:${k}="${ren.get(id) || '__dropped__'}"`));
      xml = prune(xml, new Set(kept.map((r) => r.id))).replace(/<p:extLst>(?:(?!<p:extLst>)[\s\S])*?<\/p:extLst>\s*(?=<\/p:sld>)/, '');
      const tm = xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/); if (!tm) throw new Error('a template slide has no shape tree');
      const all = children(tm[1]), head = all.filter((c) => /^<p:(nvGrpSpPr|grpSpPr)\b/.test(c)).join('');
      // shapes: ids moved to 1000+ (Scope's own start at 2); placeholders with no text (prompts only) left out
      const kids = [];
      for (const c of all) {
        if (/^<p:(nvGrpSpPr|grpSpPr)\b/.test(c)) continue;
        if (/<p:ph\b/.test(c) && /^<p:sp\b/.test(c) && !plainText(c)) { dropped++; continue; }
        kids.push(c.replace(/<p:cNvPr\b([^>]*?)\bid="(\d+)"/g, (m0, a, id) => `<p:cNvPr${a}id="${1000 + +id}"`).replace(/<a:(stCxn|endCxn)\b([^>]*?)\bid="(\d+)"/g, (m0, t, a, id) => `<a:${t}${a}id="${1000 + +id}"`));
      }
      // positions: a shape's own, else its layout placeholder's, else its master placeholder's
      const L = layouts[li], M = masters[L.master];
      const lSh = partShapes(L.xml), mSh = partShapes(M.xml);
      const inherit = (ph) => { if (!ph) return null; const find = (list) => (list.find((s) => s.ph && ph.idx && s.ph.idx === ph.idx && s.g) || list.find((s) => s.ph && s.ph.type === ph.type && s.g) || {}).g; return find(lSh) || find(mSh) || null; };
      const pos = (c) => geomOf(c) || inherit(phOf(c));
      // a placeholder's font size: its layout's or master's placeholder, else the master's text style for its kind
      const ptOf = (ph) => {
        if (!ph) return 0;
        const find = (list) => (list.find((s) => s.ph && ph.idx && s.ph.idx === ph.idx) || list.find((s) => s.ph && s.ph.type === ph.type) || {}).xml;
        const style = /title/i.test(ph.type || '') ? 'titleStyle' : /body|subTitle|obj/i.test(ph.type || '') || !ph.type ? 'bodyStyle' : 'otherStyle';
        return szOf(find(lSh)) || szOf(find(mSh)) || szOf((M.xml.match(new RegExp('<p:' + style + '>[\\s\\S]*?<\\/p:' + style + '>')) || [''])[0]);
      };
      // slots: text boxes that are "x" (or hold one "x" in a short line), in groups too (their place mapped out of the group)
      const slots = [];
      const walk = (c, i, path, toSlide) => {
        if (/^<p:grpSp\b/.test(c)) {
          const gp = (c.match(/<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/) || [''])[0], two = (re) => { const m = gp.match(re); return m ? [+m[1], +m[2]] : null; };
          const off = two(/<a:off x="(-?\d+)" y="(-?\d+)"/) || [0, 0], ext = two(/<a:ext cx="(\d+)" cy="(\d+)"/), cho = two(/<a:chOff x="(-?\d+)" y="(-?\d+)"/) || [0, 0], che = two(/<a:chExt cx="(\d+)" cy="(\d+)"/);
          const kx = ext && che && che[0] ? ext[0] / che[0] : 1, ky = ext && che && che[1] ? ext[1] / che[1] : 1;
          const inner = children(c.replace(/^<p:grpSp\b[^>]*>/, '').replace(/<\/p:grpSp>\s*$/, '')).filter((x) => !/^<p:(nvGrpSpPr|grpSpPr)\b/.test(x));
          inner.forEach((x, j) => walk(x, i, path.concat(j), (g) => toSlide({ x: off[0] + (g.x - cho[0]) * kx, y: off[1] + (g.y - cho[1]) * ky, w: g.w * kx, h: g.h * ky })));
          return;
        }
        if (!/^<p:sp\b/.test(c) || !/<p:txBody>/.test(c)) return;
        const whole = slotToken(plainText(c)), inline = !whole && inlineToken(paraText(c));
        if (!whole && !inline) return;
        const g0 = path.length ? geomOf(c) : pos(c); if (!g0) return;
        const g = toSlide(g0), ph = phOf(c);
        slots.push({ i, path, token: whole || 'x', inline: !!inline, text: inline ? paraText(c).replace(/\s+/g, ' ').trim() : '', ph: ph ? ph.type : '', x: cvX(g.x), y: cvY(g.y), w: cvX(g.w), h: cvY(g.h), pt: szOf(c) || ptOf(ph) || 0 });
      };
      kids.forEach((c, i) => walk(c, i, [], (g) => g));
      slots.sort((a, b) => (Math.abs(a.y - b.y) > 0.15 ? a.y - b.y : a.x - b.x));
      // the free area of the page: under the slots at the top, above anything in the bottom third (footer, logo, page number)
      const showMaster = !/\bshowMasterSp="0"/.test(L.xml.slice(0, 400)) && !/\bshowMasterSp="0"/.test(xml.slice(0, 600));
      const footers = [];
      kids.forEach((c, i) => { if (slots.some((s) => s.i === i)) return; const g = pos(c); if (g) footers.push(g); });
      const fromPart = (list) => list.forEach((s) => { if (s.g && (!s.ph || ['ftr', 'sldNum', 'dt'].includes(s.ph.type))) footers.push(s.g); });
      fromPart(lSh); if (showMaster) fromPart(mSh);
      const bottoms = footers.map((g) => cvY(g.y)).filter((y) => y > H * 0.7);
      const topSlots = slots.filter((s) => s.y < H * 0.45), botSlots = slots.filter((s) => s.y > H * 0.7);
      const top = topSlots.length ? Math.max(...topSlots.map((s) => s.y + s.h)) + 0.12 : 1.35;
      const bottom = Math.min(H - 0.45, ...bottoms.map((y) => y - 0.1), ...botSlots.map((s) => s.y - 0.06));
      const left = topSlots.length ? Math.max(0.25, Math.min(...topSlots.map((s) => s.x))) : 0.5;
      pages.push({ xml, head, kids, rels: kept, layout: li, slots, box: { x: left, y: top, w: W - 2 * left, h: Math.max(1, bottom - top) }, layoutName: (L.xml.match(/<p:cSld\b[^>]*name="([^"]*)"/) || [])[1] || '' });
    }
    // each master keeps only the layouts the pages use, renamed slideLayoutN.xml in package order
    for (const [k, M] of masters.entries()) {
      const used = new Map(); layouts.forEach((L, j) => { if (L.master === k) used.set(L.part, j); });
      const keptLayoutIds = new Set();
      const kept = await keepRels(M.part, M.rels, (r) => { if (r.type === 'theme') return `../theme/theme${M.theme + 1}.xml`; if (r.type !== 'slideLayout') return false; const j = used.get(resolve(M.part, r.target)); if (j === undefined) return true; keptLayoutIds.add(r.id); return `../slideLayouts/slideLayout${j + 1}.xml`; });
      const lst = Array.from(M.xml.matchAll(/<p:sldLayoutId\b[^>]*\/>/g)).map((m) => m[0]).filter((t) => keptLayoutIds.has(attr(t, 'r:id')));
      M.xml = prune(M.xml.replace(/<p:sldLayoutIdLst>[\s\S]*?<\/p:sldLayoutIdLst>/, `<p:sldLayoutIdLst>${lst.join('')}</p:sldLayoutIdLst>`), new Set(kept.map((r) => r.id)));
      M.rels = kept;
    }
    const n = pages.length, kinds = n >= 3 ? { cover: 0, section: 1, content: 2 } : n === 2 ? { cover: 0, section: 0, content: 1 } : { cover: 0, section: 0, content: 0 };
    // the theme of the master the content page uses (a template with several masters: the one its pages are built on)
    const content = pages[kinds.content] || pages[0], theme = themes[(masters[(layouts[content.layout] || {}).master] || {}).theme || 0] || themes[0];
    const font = (theme.match(/<a:minorFont>\s*<a:latin\b[^>]*typeface="([^"]+)"/) || [])[1] || 'Arial', majorFont = (theme.match(/<a:majorFont>\s*<a:latin\b[^>]*typeface="([^"]+)"/) || [])[1] || font;
    // the theme's colour scheme (dk1, lt1, dk2, lt2, accent1–6, hlink) as RRGGBB, for a style that follows the template
    const colors = {}; for (const k of ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink']) { const m = theme.match(new RegExp('<a:' + k + '>\\s*<a:(?:srgbClr|sysClr)\\b[^>]*?(?:lastClr|val)="([0-9A-Fa-f]{6})"')); if (m) colors[k] = m[1].toUpperCase(); }
    return { name: name || '', w, h, font, majorFont, colors, pages, kinds, layouts, masters, themes, media, shapeCount: pages[0].kids.length, imageCount: media.length, dropped, layoutName: pages[0].layoutName };
  };
  /**
   * What each slot of a template page holds on a page of this kind ('cover' | 'section' | 'content'): [role or null] in
   * slot order. A {token} names its role; an "x" in a title placeholder is the title (the name on a cover). On a section
   * break the other "x" slots go by their font size, largest first: the number, the title, the lines under it (a section
   * slide sets them 100+, 40–60 and 14–20 pt; a placeholder's type says nothing there, the number often sits in a text
   * placeholder like the lines); with a size unknown, top to bottom. Elsewhere the other "x" slots take the roles left,
   * top to bottom (cover: a subtitle placeholder is the date; content pages: kicker and title at the top, the source line
   * at the bottom).
   */
  P.slotRoles = function (page, kind) {
    const roles = page.slots.map((s) => (s.token !== 'x' && P.SLOT_ROLES.includes(s.token) ? s.token : null));
    const BY_PH = { cover: { ctrTitle: 'name', title: 'name', subTitle: 'date' }, section: { ctrTitle: 'title', title: 'title' }, content: { ctrTitle: 'title', title: 'title' } }[kind] || {};
    page.slots.forEach((s, i) => { if (s.token === 'x' && BY_PH[s.ph] && !roles.includes(BY_PH[s.ph])) roles[i] = BY_PH[s.ph]; });
    const free = (list, order) => { const left = order.filter((r) => !roles.includes(r)); list.filter((i) => !roles[i]).forEach((i, k) => { roles[i] = left[k] || null; }); };
    const xs = page.slots.map((s, i) => (s.token === 'x' ? i : -1)).filter((i) => i >= 0);
    if (kind === 'cover') free(xs, ['name', 'date']);
    else if (kind === 'section') {
      const rest = xs.filter((i) => !roles[i]), pt = (i) => page.slots[i].pt || 0, ti = roles.indexOf('title');
      if (rest.length && rest.every((i) => pt(i) > 0) && (ti < 0 || pt(ti) > 0)) {
        const big = rest.slice().sort((a, b) => pt(b) - pt(a) || a - b); // largest first; slots are in page order
        if (ti >= 0) { // the title known: a bigger slot is the number, the others the lines
          big.forEach((i) => { if (pt(i) > pt(ti) * 1.15 && !roles.includes('number')) roles[i] = 'number'; else if (!roles.includes('subtitle')) roles[i] = 'subtitle'; });
        } else if (big.length >= 3) free(big, ['number', 'title', 'subtitle']);
        else if (big.length === 2) free(big, pt(big[1]) >= 28 ? ['number', 'title'] : ['title', 'subtitle']);
        else free(big, ['title']);
      } else free(xs, xs.length === 1 ? ['title'] : ['number', 'title', 'subtitle']);
    }
    else {
      const top = xs.filter((i) => page.slots[i].y < H * 0.45), bot = xs.filter((i) => page.slots[i].y > H * 0.7);
      free(top, top.filter((i) => !roles[i]).length === 1 && !roles.includes('title') ? ['title'] : ['kicker', 'title']); free(bot, ['source']);
    }
    return roles;
  };
  /** The shape at `path` inside a group (child indices, nvGrpSpPr and grpSpPr not counted) passed through fn; the group rebuilt. */
  function atPath(xml, path, fn) {
    if (!path || !path.length) return fn(xml);
    const m = xml.match(/^(<p:grpSp\b[^>]*>)([\s\S]*)(<\/p:grpSp>)\s*$/); if (!m) return xml;
    const parts = children(m[2]), idx = parts.map((x, k) => k).filter((k) => !/^<p:(nvGrpSpPr|grpSpPr)\b/.test(parts[k])), at = idx[path[0]];
    if (at === undefined) return xml;
    parts[at] = atPath(parts[at], path.slice(1), fn);
    return m[1] + parts.join('') + m[3];
  }
  /**
   * An "x" inside a line replaced by `value`, the words around it kept in their own runs. Words the value repeats are said
   * once: "REPORTING AS OF “X”" + "REPORTING AS OF 30 JUNE 2026" → "REPORTING AS OF 30 JUNE 2026".
   */
  function fillInline(sp, value) {
    const body = sp.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/); if (!body) return sp;
    const text = paraText(body[1]), at = inlineToken(text); if (!at) return sp;
    let v = String(value === null || value === undefined ? '' : value).replace(/\s*\n\s*/g, ' ');
    const before = text.slice(0, at[0]).split('\n').pop().replace(/[\s:–—-]+$/, '').trim(), after = text.slice(at[1]).split('\n')[0].replace(/^[\s:–—-]+/, '').trim();
    if (before && v.toLowerCase().startsWith(before.toLowerCase())) v = v.slice(before.length).replace(/^[\s:–—-]+/, '');
    if (after && v.toLowerCase().endsWith(after.toLowerCase())) v = v.slice(0, v.length - after.length).replace(/[\s:–—-]+$/, '');
    // walk the runs counting characters as paraText does; the first run touching the token takes the value, the others lose their part of it
    let n = 0, placed = false;
    const inner = body[1].replace(/<a:p\b[\s\S]*?<\/a:p>|<a:p\/>/g, (p) => {
      const out = p.replace(/<a:t>([^<]*)<\/a:t>/g, (m0, raw) => {
        const u = unxml(raw), a = n, b = n + u.length; n = b;
        if (b <= at[0] || a >= at[1]) return m0;
        const keep = u.slice(0, Math.max(0, at[0] - a)) + (placed ? '' : v) + u.slice(Math.min(u.length, at[1] - a));
        placed = true;
        return `<a:t>${esc(keep)}</a:t>`;
      });
      n += 1; // the "\n" between paragraphs
      return out;
    });
    return sp.replace(body[0], () => `<p:txBody>${inner}</p:txBody>`);
  }
  /** Run properties with the Latin typeface set, in schema order (latin before ea, cs, sym and links). */
  function withFont(rp, font) {
    const f = `<a:latin typeface="${esc(font)}"/>`;
    if (!rp) return `<a:rPr lang="en-GB" dirty="0">${f}</a:rPr>`;
    if (!/<\/a:rPr>$/.test(rp)) return rp.replace(/\s*\/>$/, `>${f}</a:rPr>`);
    const r = rp.replace(/<a:latin\b[^>]*\/>/g, ''), at = r.search(/<a:(ea|cs|sym|hlinkClick|hlinkMouseOver|rtl|extLst)\b/);
    return at >= 0 ? r.slice(0, at) + f + r.slice(at) : r.replace(/<\/a:rPr>$/, `${f}</a:rPr>`);
  }
  /**
   * A slot shape with its text replaced by `value` (lines on "\n"), in the formatting of the slot's own "x" (its paragraph,
   * and the run that holds the x); `font` (a typeface, or +mj-lt for the theme's heading font) set on it when given.
   */
  function fillSlot(sp, value, slot, font) {
    if (slot && slot.inline) return fillInline(sp, value);
    const body = sp.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/); if (!body) return sp;
    const inner = body[1], at = inner.search(/<a:p[ >\/]/);
    const firstP = (inner.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/) || [''])[0];
    const pPr = (firstP.match(/<a:pPr\b[^>]*\/>|<a:pPr\b[\s\S]*?<\/a:pPr>/) || [''])[0];
    // the run with the x in it (an empty run before it can carry other formatting), else the first
    const runX = (inner.match(/<a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t>[^<]*\S[^<]*<\/a:t>(?:(?!<\/a:r>)[\s\S])*?<\/a:r>/) || [''])[0];
    let rp = (runX.match(/<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/) || firstP.match(/<a:rPr\b[^>]*\/>|<a:rPr\b[\s\S]*?<\/a:rPr>/) || [''])[0];
    if (font) rp = withFont(rp, font);
    const end = (firstP.match(/<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>/) || [''])[0];
    const lines = value === null || value === undefined || value === '' ? [''] : (Array.isArray(value) ? value : String(value).split('\n'));
    const ps = lines.map((t) => `<a:p>${pPr}${t ? `<a:r>${rp}<a:t>${esc(t)}</a:t></a:r>` : ''}${end}</a:p>`).join('');
    return fitSlot(sp.replace(body[0], () => `<p:txBody>${at >= 0 ? inner.slice(0, at) : inner}${ps}</p:txBody>`), lines, slot, pPr, font);
  }
  /**
   * A filled slot made to hold its text without running into its neighbours. The lines it takes are estimated (its font
   * size, an average character half an em wide, its line and paragraph spacing). A one-line slot (a title, a number, a
   * name) that would wrap is shrunk to one line. Text taller than the box: the text starts at the box's top, the box grows
   * downward (as far as the footer), and what still does not fit is shrunk (PowerPoint's shrink-on-overflow, its scale
   * written in). Nothing changes when the text fits.
   */
  function fitSlot(sp, lines, slot, pPr, font) {
    if (!slot || !(slot.w > 0) || !(slot.h > 0)) return sp;
    const vals = lines.filter((t) => String(t).trim()); if (!vals.length) return sp;
    const face = font === '+mj-lt' ? MAJOR : !font || font === '+mn-lt' ? FONT : font;
    const pt = slot.pt || 18, em = /narrow|condensed|\bcond\b|compressed/i.test(face) ? 0.42 : 0.5, wide = (t) => String(t).length * pt * em / 72 * (/[a-z]/.test(t) ? 1 : 1.18);
    const pts = (tag) => { const m = String(pPr || '').match(new RegExp('<a:' + tag + '>\\s*<a:spcPts val="(\\d+)"')); return m ? +m[1] / 100 : 0; };
    const pct = String(pPr || '').match(/<a:lnSpc>\s*<a:spcPct val="(\d+)"/), line = pt * 1.2 * (pct ? +pct[1] / 100000 : 1) / 72;
    const wIn = Math.max(0.4, slot.w - 0.2), rows = (t) => Math.max(1, Math.ceil(wide(t) / wIn));
    const need = lines.reduce((t, l) => t + rows(l) * line + (pts('spcBef') + pts('spcAft')) / 72, 0) + 0.1;
    let scale = 1, grow = 0;
    if (lines.length === 1 && rows(lines[0]) > 1 && need > slot.h * 1.05) scale = Math.max(0.5, wIn / wide(lines[0])); // one line: smaller, never wrapped over what is below
    else if (need > slot.h * 1.05) { const room = slot.path && slot.path.length ? slot.h : Math.max(slot.h, H - 0.6 - slot.y); grow = Math.min(need, room); if (need > room) scale = Math.max(0.5, room / need); }
    if (scale >= 0.995 && !grow) return sp;
    let out = sp.replace(/<a:bodyPr\b([^>]*?)(\/?)>/, (m0, a, close) => `<a:bodyPr${grow ? a.replace(/\s+anchor="[^"]*"/, '') + ' anchor="t"' : a}${close}>`);
    if (scale < 0.995) {
      const fit = `<a:normAutofit fontScale="${Math.round(scale * 100000)}"/>`;
      out = /<a:bodyPr\b[^>]*\/>/.test(out) ? out.replace(/(<a:bodyPr\b[^>]*?)\/>/, `$1>${fit}</a:bodyPr>`)
        : out.replace(/(<a:bodyPr\b[^>]*>)([\s\S]*?)(<\/a:bodyPr>)/, (m0, a, b, c) => { const kids = b.replace(/<a:(noAutofit|spAutoFit)\s*\/>|<a:normAutofit\b[^>]*\/>/g, ''); const warp = kids.match(/<a:prstTxWarp\b[\s\S]*?(?:\/>|<\/a:prstTxWarp>)/); return a + (warp ? warp[0] + fit + kids.replace(warp[0], '') : fit + kids) + c; });
    }
    if (grow > slot.h) { // the box taller, its top where it was (its own geometry, or its placeholder's written onto it)
      const cy = emu(grow * SY);
      if (/<p:spPr\b[^>]*>[\s\S]*?<a:xfrm\b/.test(out)) out = out.replace(/(<p:spPr\b[^>]*>[\s\S]*?<a:xfrm\b[\s\S]*?<a:ext cx="\d+" cy=")(\d+)(")/, `$1${cy}$3`);
      else { const xf = `<a:xfrm><a:off x="${emu(slot.x * SX)}" y="${emu(slot.y * SY)}"/><a:ext cx="${emu(slot.w * SX)}" cy="${cy}"/></a:xfrm>`; out = /<p:spPr\s*\/>/.test(out) ? out.replace(/<p:spPr\s*\/>/, `<p:spPr>${xf}</p:spPr>`) : out.replace(/(<p:spPr\b[^>]*>)/, `$1${xf}`); }
    }
    return out;
  }

  // ---------- fixed parts ----------
  const THEME = HEAD + `<a:theme xmlns:a="${NS.a}" name="Scope"><a:themeElements><a:clrScheme name="Scope">`
    + '<a:dk1><a:srgbClr val="1F2937"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1B2A4A"/></a:dk2><a:lt2><a:srgbClr val="F2F4F8"/></a:lt2>'
    + '<a:accent1><a:srgbClr val="3A6FD8"/></a:accent1><a:accent2><a:srgbClr val="9DB7EE"/></a:accent2><a:accent3><a:srgbClr val="1B2A4A"/></a:accent3><a:accent4><a:srgbClr val="2E7D4F"/></a:accent4><a:accent5><a:srgbClr val="C8963E"/></a:accent5><a:accent6><a:srgbClr val="8A94A6"/></a:accent6>'
    + '<a:hlink><a:srgbClr val="3A6FD8"/></a:hlink><a:folHlink><a:srgbClr val="5A6478"/></a:folHlink></a:clrScheme>'
    + `<a:fontScheme name="Scope"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + '<a:fmtScheme name="Scope"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:fillStyleLst>'
    + '<a:lnStyleLst>' + '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3) + '</a:lnStyleLst>'
    + '<a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst>'
    + '<a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const lvl = (sz) => `<a:lvl1pPr><a:defRPr sz="${sz}"><a:latin typeface="${FONT}"/></a:defRPr></a:lvl1pPr>`;
  const MASTER = HEAD + `<p:sldMaster ${PNS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${lvl(3200)}</p:titleStyle><p:bodyStyle>${lvl(1800)}</p:bodyStyle><p:otherStyle>${lvl(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`;
  const LAYOUT = HEAD + `<p:sldLayout ${PNS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const rels = (list) => HEAD + `<Relationships xmlns="${NS.pkg}">${list.map((r) => { const [id, type, target, mode] = Array.isArray(r) ? r : [r.id, r.type, r.target, r.mode]; return `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : REL + '/' + type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`; }).join('')}</Relationships>`;

  /** Zip every part of the presentation. */
  P.package = function (slides, o) {
    const enc = new TextEncoder();
    const files = [];
    const add = (name, text) => files.push({ name, data: typeof text === 'string' ? enc.encode(text) : text });
    const n = slides.length, tpl = o.template || null;
    const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', webp: 'image/webp' };
    const exts = tpl ? Array.from(new Set(tpl.media.map((m) => m.ext))) : [];
    const nMasters = tpl ? tpl.masters.length : 1, nLayouts = tpl ? tpl.layouts.length : 1, nThemes = tpl ? tpl.themes.length : 1;
    const range = (k) => Array.from({ length: k }, (_, i) => i + 1);
    let types = HEAD + `<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="xlsx" ContentType="${CT}spreadsheetml.sheet"/>`
      + exts.map((e) => `<Default Extension="${e}" ContentType="${IMG[e] || 'application/octet-stream'}"/>`).join('')
      + `<Override PartName="/ppt/presentation.xml" ContentType="${CT}presentationml.presentation.main+xml"/>`
      + range(nMasters).map((k) => `<Override PartName="/ppt/slideMasters/slideMaster${k}.xml" ContentType="${CT}presentationml.slideMaster+xml"/>`).join('')
      + range(nLayouts).map((k) => `<Override PartName="/ppt/slideLayouts/slideLayout${k}.xml" ContentType="${CT}presentationml.slideLayout+xml"/>`).join('')
      + range(nThemes).map((k) => `<Override PartName="/ppt/theme/theme${k}.xml" ContentType="${CT}theme+xml"/>`).join('')
      + `<Override PartName="/ppt/presProps.xml" ContentType="${CT}presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="${CT}presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="${CT}presentationml.tableStyles+xml"/>`
      + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="${CT}extended-properties+xml"/>`;
    slides.forEach((s, i) => {
      types += `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}presentationml.slide+xml"/>`;
      if (tpl && s.page) {
        // the template page as it is, its slots filled, Scope's shapes on top
        const pg = s.page;
        const kids = pg.kids.map((c, k) => { let out = c; pg.slots.forEach((sl, j) => { if (sl.i !== k) return; const role = s.slotRoles[j]; out = atPath(out, sl.path, (sp) => fillSlot(sp, role ? s.fill[role] : '', sl, role && s.fonts ? s.fonts[role] : null)); }); return out; });
        add(`ppt/slides/slide${i + 1}.xml`, pg.xml.replace(/<p:spTree>[\s\S]*<\/p:spTree>/, () => `<p:spTree>${pg.head || GROUP}${kids.join('')}${s.shapes.join('')}</p:spTree>`));
        add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', `../slideLayouts/slideLayout${pg.layout + 1}.xml`]].concat(s.charts.map((c) => [c.rid, 'chart', `../charts/chart${c.k}.xml`]), pg.rels)));
      } else {
        add(`ppt/slides/slide${i + 1}.xml`, HEAD + `<p:sld ${PNS}><p:cSld><p:spTree>${GROUP}${s.shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
        add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']].concat(s.charts.map((c) => [c.rid, 'chart', `../charts/chart${c.k}.xml`]))));
      }
      for (const c of s.charts) {
        types += `<Override PartName="/ppt/charts/chart${c.k}.xml" ContentType="${CT}drawingml.chart+xml"/>`;
        add(`ppt/charts/chart${c.k}.xml`, chartXml(c.spec));
        add(`ppt/charts/_rels/chart${c.k}.xml.rels`, rels([['rId1', 'package', `../embeddings/Microsoft_Excel_Worksheet${c.k}.xlsx`]]));
        add(`ppt/embeddings/Microsoft_Excel_Worksheet${c.k}.xlsx`, chartWorkbook(c.spec));
      }
    });
    add('[Content_Types].xml', types + '</Types>');
    add('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml']]));
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    add('docProps/core.xml', HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(o.title || 'Presentation')}</dc:title><dc:creator>Scope</dc:creator><cp:lastModifiedBy>Scope</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    add('docProps/app.xml', HEAD + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Scope</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${n}</Slides></Properties>`);
    const masterIds = tpl ? tpl.masters.map((M) => M.id) : ['2147483648'];
    add('ppt/presentation.xml', HEAD + `<p:presentation ${PNS} saveSubsetFonts="1"><p:sldMasterIdLst>${masterIds.map((id, k) => `<p:sldMasterId id="${id}" r:id="rIdM${k + 1}"/>`).join('')}</p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${emu(tpl ? tpl.w : W)}" cy="${emu(tpl ? tpl.h : H)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
    add('ppt/_rels/presentation.xml.rels', rels(masterIds.map((_, k) => [`rIdM${k + 1}`, 'slideMaster', `slideMasters/slideMaster${k + 1}.xml`]).concat(slides.map((_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`]),
      [[`rId${n + 2}`, 'presProps', 'presProps.xml'], [`rId${n + 3}`, 'viewProps', 'viewProps.xml'], [`rId${n + 4}`, 'theme', 'theme/theme1.xml'], [`rId${n + 5}`, 'tableStyles', 'tableStyles.xml']])));
    add('ppt/presProps.xml', HEAD + `<p:presentationPr ${PNS}/>`);
    add('ppt/viewProps.xml', HEAD + `<p:viewPr ${PNS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
    add('ppt/tableStyles.xml', HEAD + `<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
    if (tpl) { // the template's themes, masters and layouts (with their images) in place of Scope's fixed ones
      tpl.masters.forEach((M, k) => { add(`ppt/slideMasters/slideMaster${k + 1}.xml`, M.xml); add(`ppt/slideMasters/_rels/slideMaster${k + 1}.xml.rels`, rels(M.rels)); });
      tpl.layouts.forEach((L, k) => { add(`ppt/slideLayouts/slideLayout${k + 1}.xml`, L.xml); add(`ppt/slideLayouts/_rels/slideLayout${k + 1}.xml.rels`, rels(L.rels)); });
      tpl.themes.forEach((t, k) => add(`ppt/theme/theme${k + 1}.xml`, t));
      for (const m of tpl.media) add(m.name, m.bytes);
    } else {
      add('ppt/slideMasters/slideMaster1.xml', MASTER);
      add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
      add('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
      add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
      add('ppt/theme/theme1.xml', THEME);
    }
    // [Content_Types].xml first, as Office writes it
    files.sort((a, b) => (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));
    return Scope.inputs.zipStore(files);
  };
  P.MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
})(typeof window !== 'undefined' ? window : globalThis);
