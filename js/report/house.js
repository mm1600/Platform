/* Scope · house layout kit for PowerPoint decks (js/report/house.js).
 *
 * The look the quarterly pack (quarterly.js) and the pack designer (widgets.js, layer3-designer.js) share, on top of the
 * writer in pptx.js: white pages, a 20pt page title top-left with a one-line message, green section headers with a thin
 * rule, KPI tiles (big green number over a small label), dense tables with green header rows, italic "Figure n – …"
 * captions, a 7pt source line and the page number bottom-left. No logo.
 *
 *   const K = Scope.report.houseKit(deck, { view, quarter, ccy, asOf, filtered, light });
 *   const s = K.frame('Key figures', 'one-line message');   // a page with the frame drawn; K.outline records it
 *   K.tile(s, x, y, w, h, label, value, sub, subColor); K.sectionTitle(s, x, y, w, text); K.caption(s, x, y, w, text);
 *   K.C = the palette · K.G = colours for many slices · K.T = the text colours in force (light on a dark template) · K.X0, K.CW, K.WD = page geometry
 *   K.cover(name, dateLine) · K.section('02', 'Portfolio overview', [lines]) · K.contentPage(kicker, title, { source }) → slide
 *     with s.box: pages built on the template's own cover, section and content slides, their "x" slots filled
 *
 * On a template (deck.template) the background is the template's: nothing but the text and exhibits is drawn, and with no
 * style of the user's the colours come from the template's theme.
 */
(function (global) {
  'use strict';
  const Scope = (global.Scope = global.Scope || {});
  const R = (Scope.report = Scope.report || {});

  // ---------- colours: a theme of ten (PowerPoint's colour-picker order) and which shade of which column each part takes ----------
  const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).replace('#', '').toUpperCase() : null);
  const rgb = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const toHex = (a) => a.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
  /** RRGGBB ↔ hue, saturation, lightness (0–1), the space PowerPoint makes its shades in. */
  const toHsl = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255), hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2; if (hi === lo) return [0, 0, l]; const d = hi - lo, s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo); const hu = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4; return [hu / 6, s, l]; };
  const floorHex = (a) => a.map((x) => Math.max(0, Math.min(255, Math.floor(x + 1e-6))).toString(16).padStart(2, '0')).join('').toUpperCase(); // PowerPoint rounds its shades down
  const fromHsl = (hu, s, l) => { if (!s) return floorHex([l, l, l].map((v) => v * 255)); const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return floorHex([f(hu + 1 / 3), f(hu), f(hu - 1 / 3)].map((v) => v * 255)); };
  /**
   * A colour and its five shades as PowerPoint's colour picker lists them under it: white darker 5, 15, 25, 35, 50 %; a very
   * light colour darker 10, 25, 50, 75, 90 %; a very dark one lighter 90, 75, 50, 25, 10 %; black lighter 50, 35, 25, 15, 5 %;
   * any other lighter 80, 60, 40 % then darker 25, 50 %. → [main, shade 1 … shade 5]
   */
  R.shadesOf = (c) => {
    const [hu, s, l] = toHsl(c), dk = (m) => fromHsl(hu, s, l * m), lt = (t) => fromHsl(hu, s, l * (1 - t) + t);
    const steps = l >= 0.999 ? [0.95, 0.85, 0.75, 0.65, 0.5].map(dk) : l > 0.8 ? [0.9, 0.75, 0.5, 0.25, 0.1].map(dk) : l <= 0.001 ? [0.5, 0.35, 0.25, 0.15, 0.05].map(lt)
      : l < 0.2 ? [0.9, 0.75, 0.5, 0.25, 0.1].map(lt) : [0.8, 0.6, 0.4].map(lt).concat([0.75, 0.5].map(dk));
    return [c].concat(steps);
  };
  // the house theme (Background 1, Text 1, Background 2, Text 2, Accent 1–6): white, near-black, a teal and a green, cyan,
  // sage, grey, petrol, red and orange
  const HOUSE = ['FFFFFF', '1D1D1B', '0F7164', '00A76C', '00A2A3', '8ACBBB', '939FA6', '17596F', 'C3454B', 'F1885A'];
  /** A template theme's ten colours in picker order (lt1, dk1, lt2, dk2, accent1–6), or null when one is missing. */
  R.themeColumns = (colors) => {
    if (!colors) return null;
    const cols = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((k) => hex(colors[k]));
    return cols.some((c) => !c) ? null : cols;
  };
  // which shade of which column each part takes: [column 1–10, shade 0 (main) – 5 as the picker lists them]
  // a theme like the house's (coloured Background 2 and Text 2), as the house deck applies it: the main colours for nearly
  // everything (header bars, bands and headings Background 2, bright Text 2, pale Accent 2, neutral Accent 3), shades only
  // for tints (boxes: Accent 2 lighter 80 %), greys (Text 1 and Background 1 shades) and the long runs of many slices
  const HOUSE_MAP = {
    role: { green: [3, 0], dark: [3, 0], band: [3, 0], lgreen: [4, 0], pgreen: [6, 0], tgreen: [6, 1], slate: [7, 0], salmon: [9, 3], lsalmon: [9, 1], red: [9, 0], amber: [10, 0],
      blue: [8, 0], text: [2, 0], label: [2, 4], muted: [1, 5], rule: [1, 3], border: [1, 2], cell: [1, 1], map: [2, 2], white: [1, 0] },
    // many slices: the main colours first, dark and light in turn (dark green, mint, dark blue, green, blue-grey, teal), then
    // their shades (greens, teals and blues before the greys; red and orange last)
    ramp: [[3, 0], [6, 0], [8, 0], [4, 0], [7, 0], [5, 0], [3, 5], [6, 2], [8, 5], [6, 4], [5, 4], [6, 3], [4, 4], [7, 4], [3, 4], [6, 5], [8, 4], [5, 5], [10, 0], [9, 0]],
    seq: [[3, 5], [3, 4], [3, 0], [6, 4], [6, 0], [6, 3], [6, 2]], // one family dark to light (the map's countries by size)
  };
  // any other theme (light Background 2, the colours in the accents): headings Accent 1, second Accent 2, accent Accent 3
  const STD_MAP = {
    role: { green: [5, 0], dark: [5, 5], band: [5, 4], lgreen: [10, 0], pgreen: [5, 2], tgreen: [5, 1], slate: [6, 0], salmon: [7, 0], lsalmon: [7, 1], red: [9, 0], amber: [8, 0],
      blue: [5, 0], text: [2, 0], label: [2, 0], muted: [1, 5], rule: [1, 3], border: [1, 2], cell: [1, 1], map: [1, 3], white: [1, 0] },
    ramp: [5, 6, 7, 8, 9, 10].map((c) => [c, 0]).concat([5, 6, 7, 8, 9, 10].map((c) => [c, 4]), [5, 6, 7, 8, 9, 10].map((c) => [c, 3]), [5, 6, 7, 8, 9, 10].map((c) => [c, 5])),
    seq: [[5, 5], [5, 4], [5, 0], [5, 3], [5, 2], [5, 1]],
  };
  const mapOf = (cols) => { const coloured = (c) => { const [, sat, l] = toHsl(c); return sat > 0.3 && l > 0.1 && l < 0.7; }; return coloured(cols[2]) && coloured(cols[3]) ? HOUSE_MAP : STD_MAP; };
  const pick = (cols, [c, k]) => R.shadesOf(cols[c - 1])[k];
  const paletteOf = (cols) => { const M = mapOf(cols).role, P = {}; for (const k in M) P[k] = pick(cols, M[k]); return P; };
  const C = paletteOf(HOUSE);
  R.PALETTE = C;
  /** Series colours in order (charts with several series or slices), for a palette. */
  R.seriesOf = (P) => [P.green, P.slate, P.salmon, P.pgreen, P.lgreen, P.lsalmon, P.tgreen];
  R.SERIES = R.seriesOf(C);
  /** The keys of a style the user can set (colours as RRGGBB, font as a typeface name). */
  R.STYLE_KEYS = [['green', 'Headings, first series'], ['dark', 'Header bars, table headers'], ['band', 'Banners'], ['slate', 'Second series'], ['lgreen', 'Bright series colour'], ['salmon', 'Accent, third series'], ['pgreen', 'Pale first colour (doughnut remainder)'], ['tgreen', 'Tint (totals rows, boxes)'], ['text', 'Text'], ['label', 'Labels'], ['muted', 'Source line, captions'], ['rule', 'Rules'], ['cell', 'Table banding'], ['border', 'Tile borders'], ['blue', 'Internal ratings (asset table)'], ['map', 'Map: countries with no exposure']];
  /** The palette (the house theme's, or a template theme's columns) with a style's colours over it (malformed entries ignored); .font when the style sets one. */
  R.palette = (style, cols) => { const P = paletteOf(cols || HOUSE); if (style) for (const [k] of R.STYLE_KEYS) { const v = hex(style[k]); if (v) P[k] = v; } if (style && style.font) P.font = String(style.font); return P; };
  /** Colours for many slices, and the dark-to-light run, from a theme's columns. */
  R.rampOf = (cols) => { const c = cols || HOUSE; return mapOf(c).ramp.map((r) => pick(c, r)); };
  R.seqOf = (cols) => { const c = cols || HOUSE; return mapOf(c).seq.map((r) => pick(c, r)); };
  /** Colours for the children (subsectors) of ramp colour k: the same column's other shades, darkest first, no glaring tints. */
  R.kinOf = (cols, k) => {
    const c = cols || HOUSE, ramp = mapOf(c).ramp, [col, own] = ramp[k % ramp.length], sh = R.shadesOf(c[col - 1]);
    return [4, 0, 5, 3, 2, 1].filter((j) => j !== own && (j === 0 || j >= 4 || toHsl(sh[j])[1] < 0.6)).map((j) => sh[j]);
  };
  /** A style from a template's theme: each part's colour taken from the template's own columns. */
  R.styleFromTheme = (colors) => { const cols = R.themeColumns(colors); if (!cols) return null; const P = paletteOf(cols), s = {}; for (const [k] of R.STYLE_KEYS) s[k] = P[k]; return s; };

  R.houseKit = function (deck, ctx) {
    const P = Scope.pptx, WD = P.WIDTH, X0 = 0.5, CW = WD - 1;
    const o = ctx || {};
    // this deck's colours: a template's theme, else the house theme; the user's style over it
    const cols = (deck.template && R.themeColumns(deck.template.colors)) || HOUSE, theme = cols !== HOUSE;
    const C = R.palette(o.style, cols);
    const G = R.rampOf(cols), SEQC = R.seqOf(cols), kin = (k) => R.kinOf(cols, k);
    const light = !!o.light; // white text for a dark template background
    // page titles in the heading font: the one set in Your style, else the template theme's (+mj-lt), as PowerPoint sets titles
    const TF = (o.style && o.style.titleFont) || (deck.template ? '+mj-lt' : undefined);
    const titleSlot = (s, title) => { s.fill.title = title; if (TF) s.fonts = Object.assign({}, s.fonts, { title: TF }); };
    const T = light ? { text: 'FFFFFF', label: 'E6E8EA', muted: 'D0D4D7', green: 'B9DCCF', rule: '8A9499' } : { text: C.text, label: C.label, muted: C.muted, green: C.green, rule: C.rule };
    const source = `Source: Holdings as of ${o.asOf || ''}; Scope calculation${o.filtered ? ` · ${o.filtered} filter(s) applied` : ''}`;
    let page = 0, figN = 0;
    const outline = [];
    /** A page: title top-left, the view and quarter top-right, the message under the title, a rule, the source line and the page number. */
    function frame(title, keyPoint) {
      const s = deck.slide(); page++;
      // a template content page with slots takes the title (and kicker, source) in them
      if (s.roles.has('kicker')) s.fill.kicker = `${o.view || ''} · ${o.quarter || ''}`;
      if (s.roles.has('source')) s.fill.source = source;
      if (s.roles.has('title')) titleSlot(s, title);
      else {
        s.text({ x: X0, y: 0.22, w: 8.8, h: 0.45, text: title, size: 20, color: T.text, valign: 'middle', inset: 0, font: TF });
        s.text({ x: WD - 4.5, y: 0.26, w: 4, h: 0.4, text: `${o.view || ''} · ${o.quarter || ''} · ${o.ccy || 'EUR'} m`, size: 10, color: T.label, align: 'right', valign: 'middle', inset: 0 });
      }
      if (keyPoint) s.text({ x: X0, y: 0.7, w: CW, h: 0.5, text: keyPoint, size: 12.5, color: T.text, valign: 'top', inset: 0 });
      s.line({ x1: X0, y1: 1.3, x2: WD - X0, y2: 1.3, color: T.rule, w: 0.75 });
      if (!s.roles.has('source')) s.text({ x: X0 + 0.6, y: 7.08, w: 9, h: 0.25, text: source, size: 7, color: T.muted, inset: 0 });
      if (!s.roles.size) s.text({ x: X0, y: 7.08, w: 0.5, h: 0.25, text: String(page), size: 8, color: T.text, inset: 0 });
      outline.push({ title, note: keyPoint || '' });
      return s;
    }
    /** A page without the frame (the cover); the source line and page count still advance. */
    function blank(title) { const s = deck.slide({ base: 'cover' }); page++; s.text({ x: X0, y: 7.08, w: CW, h: 0.25, text: source, size: 7, color: T.muted, inset: 0 }); outline.push({ title, note: '' }); return s; }

    // ---------- pages built on the template's own cover, section and content slides (its "x" slots filled) ----------
    const HB = { x: X0, y: 1.32, w: CW, h: 5.55 }; // the free area of a house content page
    /**
     * Cover: the name and the date line in the template's slots. On a template nothing else is drawn (a box with no "x" stays
     * as the template has it); with no template, the house cover.
     */
    function cover(name, dateLine, note) {
      const s = deck.slide({ base: 'cover' }); page++;
      if (s.roles.has('name')) s.fill.name = name; else if (!deck.template) s.text({ x: X0 + 0.2, y: 1.6, w: CW - 0.4, h: 1.3, text: name, size: 38, bold: true, color: T.text, inset: 0, valign: 'bottom' });
      if (s.roles.has('date')) s.fill.date = dateLine;
      else if (!deck.template) { s.rect({ x: X0 + 1.6, y: 3.55, w: 6.2, h: 0.9, fill: C.green }); s.text({ x: X0 + 1.85, y: 3.55, w: 5.8, h: 0.9, text: String(dateLine || '').toUpperCase(), size: 15, bold: true, color: C.white, valign: 'middle', inset: 0 }); }
      outline.push({ title: 'Cover', note: note || name });
      return s;
    }
    /** Section break: number, title and the lines under it in the template's slots (nothing drawn over the template), else a full green page. */
    function section(number, title, lines) {
      const s = deck.slide({ base: 'section' }); page++;
      const sub = (lines || []).join('\n');
      if (deck.template) {
        if (s.roles.has('number')) s.fill.number = number;
        if (s.roles.has('title')) s.fill.title = title;
        if (s.roles.has('subtitle')) s.fill.subtitle = sub;
      } else {
        s.rect({ x: 0, y: 0, w: WD, h: P.HEIGHT, fill: C.green });
        s.text({ x: X0 + 0.1, y: 0.35, w: 4, h: 1.9, text: number, size: 110, bold: true, color: C.pgreen, inset: 0 });
        s.text({ x: X0 + 0.1, y: 2.45, w: CW, h: 1.0, text: String(title).toUpperCase(), size: 46, bold: true, color: C.white, inset: 0, valign: 'middle' });
        if (sub) s.text({ x: X0 + 0.1, y: 3.5, w: CW, h: 1.6, text: sub, size: 17, color: C.white, inset: 0 });
      }
      outline.push({ title: `${number} ${title}`, note: (lines || []).join(' · ') });
      return s;
    }
    /**
     * Content page: kicker and title in the template's slots (else drawn), the source line in its slot (else drawn at the
     * bottom). Returns the slide with s.box = the free area to place exhibits in (inches on the 13.333 × 7.5 canvas).
     */
    function contentPage(kicker, title, opts) {
      const op = opts || {}, s = deck.slide({ base: 'content' }); page++;
      const box = Object.assign({}, s.box || HB);
      const tplPage = deck.template && s.roles.size;
      if (s.roles.has('kicker')) s.fill.kicker = kicker || '';
      else if (kicker && !s.roles.has('title')) s.text({ x: box.x, y: tplPage ? Math.max(0.1, box.y - 1.05) : 0.24, w: box.w, h: 0.28, text: String(kicker).toUpperCase(), size: 9.5, bold: true, color: T.green, inset: 0, valign: 'middle' });
      if (s.roles.has('title')) titleSlot(s, title || '');
      else { s.text({ x: box.x, y: tplPage ? Math.max(0.35, box.y - 0.75) : 0.52, w: box.w, h: 0.55, text: title, size: 24, color: T.text, inset: 0, valign: 'middle', font: TF }); if (!tplPage) s.line({ x1: X0, y1: 1.16, x2: WD - X0, y2: 1.16, color: T.rule, w: 0.75 }); }
      const src = op.source === undefined ? source : op.source;
      if (s.roles.has('source')) s.fill.source = src || '';
      else if (src) { box.h -= 0.26; s.text({ x: box.x, y: box.y + box.h + 0.04, w: box.w, h: 0.22, text: src, size: 7, color: T.muted, align: 'right', inset: 0 }); }
      if (!deck.template) s.text({ x: X0, y: 7.08, w: 0.5, h: 0.25, text: String(page), size: 8, color: T.text, inset: 0 });
      s.box = box;
      outline.push({ title, note: op.note || '' });
      return s;
    }
    /** KPI tile: small upper-case label, big green value, a small line under it (green / red when it is a change). */
    function tile(s, x, y, w, h, label, value, sub, subColor) {
      s.rect({ x, y, w, h, fill: C.white, line: C.border, lineW: 0.75 });
      s.text({ x: x + 0.15, y: y + 0.08, w: w - 0.3, h: 0.26, text: String(label || '').toUpperCase(), size: 7, color: C.label, inset: 0 });
      s.text({ x: x + 0.15, y: y + 0.32, w: w - 0.3, h: 0.55, text: value, size: h > 1.2 ? 24 : 20, bold: true, color: C.green, inset: 0, valign: 'middle' });
      if (sub) s.text({ x: x + 0.15, y: y + h - 0.36, w: w - 0.3, h: 0.28, text: sub, size: 8.5, color: subColor || C.label, inset: 0 });
    }
    /** Section header: green bold 10.5pt with a thin grey rule under it. */
    const sectionTitle = (s, x, y, w, text) => { s.text({ x, y, w, h: 0.26, text, size: 10.5, bold: true, color: T.green, inset: 0, valign: 'middle' }); s.line({ x1: x, y1: y + 0.28, x2: x + w, y2: y + 0.28, color: T.rule, w: 0.75 }); };
    /** Italic "Figure n – …" caption under an exhibit. */
    const caption = (s, x, y, w, text) => { figN++; s.text({ x, y, w, h: 0.24, text: `Figure ${figN} – ${text}`, size: 8, italic: true, color: T.muted, inset: 0 }); };
    /** A table in the house style (green header row, grey banding). */
    const table = (s, t) => s.table(Object.assign({ headerFill: C.dark || C.green, headerColor: C.white, zebra: C.cell, size: 9, rowH: 0.27, header: true }, t));
    // the theme's accents in order (Accent 1–6), then their darker and lighter shades: PowerPoint's own series colours
    const ACC = [0, 4, 2].flatMap((k) => [5, 6, 7, 8, 9, 10].map((c) => R.shadesOf(cols[c - 1])[k]));
    return { C, S: R.seriesOf(C), G, ACC, SEQ: SEQC, kin, T, WD, X0, CW, frame, blank, cover, section, contentPage, tile, sectionTitle, caption, table, outline, page: () => page, source, theme };
  };
})(typeof window !== 'undefined' ? window : globalThis);
