/* Scope core: Excel-grade virtualised data grid — Scope.ui.grid(opts).
   Classic script, loaded after ui.js (it uses Scope.ui.h, Scope.icon, Scope.csv and Scope.util).
   Nothing touches the DOM at load time, so the pure helpers (filter-expression parser,
   comparators, dictionary ranks) also load in Node for tests as Scope.ui.gridUtil.
   Used by the Explorer's Positions and Assets grids and by the AUM page; styles in css/grid.css.

   Design: rows are never copied or re-rendered wholesale. Per-column caches hold the display
   strings, lower-cased strings, numeric values (Float64Array, NaN = blank) and a sorted
   dictionary of distinct strings with per-row ranks (Int32Array), so filters and multi-level
   sorts run over typed arrays and indices. The body is virtualised: only the rows in view
   (plus an overscan margin) exist as <tr> elements, recycled from a pool between two spacer
   rows whose heights stand in for the rows above and below.

   Scope.ui.grid(opts) → element with setRows(rows), getVisibleRows(), getState(), setState(state)
     opts: { columns:[{ key, label, type:'text'|'number'|'date', format(v,row), width, frozen?, hidden?, align?,
                        total?:'sum'|'avg'|fn, group?, title?, unit?, get(row)?, href(row)?, cellClass(v,row)?, decimals? }],
             rows, rowKey, onRow(row), height (css, default '62vh'), storageKey, exportName,
             features:{ chooser, filters, multiSort, totals, density, search, export, copy, resize, menu } (all default true),
             onStateChange(state), onFilterChange(contractFilters) }
   Extras on the element: getFilters()/setFilters(contract shape), clearFilters(), refresh(), exportCsv(), copyTsv(),
     getColumns(), destroy().
   "Contract shape" filters are [{ field, op, value }] with op in contains | in | notIn | between | gte | lte |
     gt | lt | eq | neq | expr — the Scope.pivot filter vocabulary (plus 'expr' for expressions that map onto
     no single operator), which is how "Pivot this" and the pivot's drill-through move filters between the
     grids and the pivot. */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const UI = Scope.ui || (Scope.ui = {});
  const U = Scope.util || {};
  const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';

  /* ======================================================================
     Pure helpers (Node-safe): Scope.ui.gridUtil
     ====================================================================== */
  // Rank given to blank strings: the largest Int32, so blanks fall after every real value.
  const BLANK_RANK = 0x7fffffff;
  /** Blank = null, undefined, '' or NaN. */
  const isBlank = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v));
  /** Cell value → number for numeric filters / sorts (booleans → 1 / 0, text via Scope.util.toNumber); NaN when blank. */
  const toNum = (v) => { if (typeof v === 'number') return v; if (isBlank(v)) return NaN; if (typeof v === 'boolean') return v ? 1 : 0; if (U.toNumber) return U.toNumber(v); const n = Number(v); return isNaN(n) ? NaN : n; };
  /** Cell value → epoch milliseconds for date columns (Date, number or parseable string); NaN when blank. */
  const toTime = (v) => {
    if (isBlank(v)) return NaN;
    if (v instanceof Date) return isNaN(v) ? NaN : v.getTime();
    if (typeof v === 'number') return v;
    const d = U.parseDate ? U.parseDate(v) : new Date(v);
    return d && !isNaN(d) ? d.getTime() : NaN;
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Default display formats: dates as "31 Dec 2027" (UTC), ISO for export, en-GB numbers.
  const fmtDate = (v) => { const t = toTime(v); if (isNaN(t)) return ''; const d = new Date(t); return String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
  // Cell value → 'yyyy-mm-dd' ('' when blank), used for CSV export of dates.
  const isoOf = (v) => { const t = toTime(v); return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10); };
  // Intl fallbacks keep the helpers usable in minimal runtimes without Intl.
  const nfInt = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }) : { format: (x) => String(Math.round(x)) };
  const nfAuto = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }) : { format: (x) => String(x) };
  // Blank-safe number formatting: integers for counts, up to two decimals for untyped numbers.
  const fmtInt = (x) => (isBlank(x) ? '' : nfInt.format(x));
  const fmtNum = (x) => (isBlank(x) ? '' : nfAuto.format(x));

  /** A token for the date variant of the expression parser: a bare year or year-month becomes a [lo, hi] range. */
  function dateTok(tok) {
    tok = String(tok).trim(); let m;
    if ((m = tok.match(/^(\d{4})$/))) return [Date.UTC(+m[1], 0, 1), Date.UTC(+m[1], 11, 31)];
    if ((m = tok.match(/^(\d{4})-(\d{1,2})$/))) { const y = +m[1], mo = +m[2]; return [Date.UTC(y, mo - 1, 1), Date.UTC(y, mo, 0)]; }
    return toTime(tok);
  }

  /**
   * parseRangeExpr('>100', conv) → predicate(n) | null (empty expression) | { error: token } (unparsable).
   * Conditions are ANDed; separated by ',', '&', 'and' or whitespace before an operator ('>100 <500').
   * Each condition: blank | nonblank | >x | >=x | <x | <=x | =x | !=x | <>x | a..b | a to b | x (equals).
   * conv(token) returns a number or a [lo, hi] range (dates: a bare year covers the whole year).
   */
  function parseRangeExpr(expr, conv) {
    conv = conv || toNum;
    const s = String(expr === null || expr === undefined ? '' : expr).trim();
    if (!s) return null;
    // A converted token is either a point or a [lo, hi] range; lo / hi read either uniformly.
    const lo = (x) => (Array.isArray(x) ? x[0] : x), hi = (x) => (Array.isArray(x) ? x[1] : x);
    // A token that failed to convert (NaN point, or a range with a NaN end).
    const bad = (x) => (Array.isArray(x) ? isNaN(x[0]) || isNaN(x[1]) : typeof x !== 'number' || isNaN(x));
    const conds = [];
    // Split on explicit AND separators, or on whitespace that precedes an operator ('>100 <500').
    const parts = s.split(/\s*(?:,|&&|&|\band\b)\s*|\s+(?=[<>=!])/i).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      const low = p.toLowerCase();
      if (['blank', 'blanks', 'empty', 'null', '(blank)', '(blanks)', 'is blank'].includes(low)) { conds.push((n) => isNaN(n)); continue; }
      if (['nonblank', 'notblank', 'non-blank', 'not blank', 'filled', '*', 'nonblanks'].includes(low)) { conds.push((n) => !isNaN(n)); continue; }
      let m;
      // Range "a..b" / "a to b" / "a…b": inclusive, endpoints may be given in either order.
      if ((m = p.match(/^(.+?)\s*(?:\.\.+|\bto\b|\u2026)\s*(.+)$/i))) {
        const a = conv(m[1]), b = conv(m[2]); if (bad(a) || bad(b)) return { error: p };
        const x = Math.min(lo(a), lo(b)), y = Math.max(hi(a), hi(b)); conds.push((n) => n >= x && n <= y); continue;
      }
      if ((m = p.match(/^(>=|<=|<>|!=|==|=|>|<)\s*(.+)$/))) {
        const v = conv(m[2]); if (bad(v)) return { error: p };
        // Against a range token (e.g. '>2027') strict operators use the far edge and inclusive ones the
        // near edge, so '>2027' means after 31 Dec 2027 and '>=2027' from 1 Jan 2027; '=' tests membership.
        const op = m[1], a = lo(v), b = hi(v);
        conds.push(op === '>' ? (n) => n > b : op === '>=' ? (n) => n >= a : op === '<' ? (n) => n < a : op === '<=' ? (n) => n <= b
          : op === '=' || op === '==' ? (n) => n >= a && n <= b : (n) => !(n >= a && n <= b));
        continue;
      }
      // Bare token: equality (for a range token, anywhere inside it).
      const v = conv(p); if (bad(v)) return { error: p };
      const a = lo(v), b = hi(v); conds.push((n) => n >= a && n <= b);
    }
    if (!conds.length) return null;
    if (conds.length === 1) return conds[0];
    return (n) => { for (let i = 0; i < conds.length; i++) if (!conds[i](n)) return false; return true; };
  }
  // Column-type variants: numbers take numeric tokens; dates accept ISO dates plus bare years / year-months.
  const parseNumberFilter = (s) => parseRangeExpr(s, toNum);
  const parseDateFilter = (s) => parseRangeExpr(s, dateTok);

  /**
   * Sorted dictionary of the distinct non-blank strings and an Int32Array of ranks (blank = BLANK_RANK, always last).
   * Text sorts compare these integer ranks instead of strings, so a 50k-row sort does one collation pass
   * over distinct values only. Collation is en-GB, numeric-aware ("A2" < "A10") and case-insensitive.
   * @returns {{dict: string[], ranks: Int32Array, rank: Map<string, number>}}
   */
  function buildDictionary(strs) {
    const set = new Set();
    for (let i = 0; i < strs.length; i++) if (strs[i] !== '') set.add(strs[i]);
    const dict = Array.from(set);
    const coll = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' }).compare : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    dict.sort(coll);
    const rank = new Map(); dict.forEach((v, i) => rank.set(v, i));
    const ranks = new Int32Array(strs.length);
    for (let i = 0; i < strs.length; i++) ranks[i] = strs[i] === '' ? BLANK_RANK : rank.get(strs[i]);
    return { dict, ranks, rank };
  }

  /** Numeric compare with blanks (NaN) last in both directions. */
  function compareNumbers(x, y, desc) {
    const xb = x !== x, yb = y !== y; // NaN checks
    if (xb || yb) return xb && yb ? 0 : xb ? 1 : -1;
    return desc ? (y < x ? -1 : y > x ? 1 : 0) : (x < y ? -1 : x > y ? 1 : 0);
  }
  /** Rank compare with BLANK_RANK last in both directions. */
  function compareRanks(x, y, desc) {
    const xb = x === BLANK_RANK, yb = y === BLANK_RANK;
    if (xb || yb) return xb && yb ? 0 : xb ? 1 : -1;
    return desc ? y - x : x - y;
  }
  /**
   * Multi-level sort of row indices. levels: [{ values: Float64Array|Int32Array|Array, desc, ranks:boolean }] — stable, blanks last.
   * values are indexed by row index; ties at every level fall back to the original index, which makes the sort stable.
   */
  function sortIndices(indices, levels) {
    const out = Array.from(indices);
    if (!levels || !levels.length) return out;
    const L = levels.length;
    out.sort((a, b) => {
      for (let i = 0; i < L; i++) {
        const l = levels[i], r = l.ranks ? compareRanks(l.values[a], l.values[b], l.desc) : compareNumbers(l.values[a], l.values[b], l.desc);
        if (r) return r;
      }
      return a - b;
    });
    return out;
  }

  /** Aggregate over a Float64Array (NaN = blank) restricted to idx. agg: sum | avg | min | max | count; blanks are skipped, so count = non-blank count and an all-blank set gives NaN. */
  function aggregate(nums, idx, agg) {
    let s = 0, n = 0, mn = Infinity, mx = -Infinity;
    for (let k = 0; k < idx.length; k++) { const v = nums[idx[k]]; if (v !== v) continue; n++; s += v; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (agg === 'count') return n;
    if (!n) return NaN;
    if (agg === 'sum') return s; if (agg === 'avg') return s / n; if (agg === 'min') return mn; if (agg === 'max') return mx;
    return NaN;
  }

  // Exposed for tests (tests/grid-check.html) and for callers that want the same filter semantics.
  const gridUtil = { BLANK_RANK, isBlank, toNum, toTime, fmtDate, isoOf, dateTok, parseRangeExpr, parseNumberFilter, parseDateFilter, buildDictionary, compareNumbers, compareRanks, sortIndices, aggregate };
  UI.gridUtil = gridUtil;

  /* ======================================================================
     Column normalisation
     ====================================================================== */
  // Footer aggregates a user can pick per column ('none' blanks the footer cell).
  const AGGS = ['sum', 'avg', 'min', 'max', 'count', 'none'];
  const AGG_LABEL = { sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count', none: 'None' };
  /** Width option → pixels: numbers as-is, '140px' / '140' parsed, anything else → dflt. */
  function pxOf(w, dflt) { if (typeof w === 'number' && isFinite(w)) return w; if (typeof w === 'string') { const n = parseFloat(w); if (isFinite(n)) return n; } return dflt; }
  /**
   * Fill in a column definition: resolved type (an untyped right-aligned column is treated as a
   * number), default width per type, accessor get(row), and three renderers that share one rule
   * set — text() for display, formatTotal() for the footer and exportValue() for CSV / TSV
   * (numbers and ISO dates stay raw so spreadsheets can compute with them).
   */
  function normaliseColumn(c, i) {
    const type = c.type === 'number' || c.type === 'date' ? c.type : (c.type === 'text' ? 'text' : (c.align === 'right' && !c.type ? 'number' : 'text'));
    const col = Object.assign({}, c, { type });
    col.key = String(c.key === undefined ? 'col' + i : c.key);
    col.label = c.label === undefined ? col.key : String(c.label);
    col.numeric = type === 'number';
    col.align = c.align || (type === 'number' ? 'right' : 'left');
    col.width = pxOf(c.width, type === 'number' ? 120 : type === 'date' ? 112 : 160);
    col.group = c.group || 'Columns';
    col.get = typeof c.get === 'function' ? c.get : (row) => (row ? row[col.key] : undefined);
    const fmt = typeof c.format === 'function' ? c.format : null;
    // Display text: the column's format() if given, else numbers with up to 2 decimals (or fixed decimals), dates as "31 Dec 2027".
    col.text = (v, row) => {
      if (isBlank(v)) return '';
      if (fmt) { const s = fmt(v, row); return s === null || s === undefined ? '' : String(s); }
      if (type === 'number') return typeof c.decimals === 'number' ? Number(v).toFixed(c.decimals) : fmtNum(v);
      if (type === 'date') return fmtDate(v);
      return String(v);
    };
    // Footer text for an aggregate (format() is called with row = null).
    col.formatTotal = (v) => (isBlank(v) ? '' : fmt ? String(fmt(v, null)) : typeof c.decimals === 'number' ? Number(v).toFixed(c.decimals) : fmtNum(v));
    // Export value: raw numbers (rounded to decimals if set) and ISO dates so the CSV stays computable; text as displayed.
    col.exportValue = typeof c.exportValue === 'function' ? c.exportValue : (v, row) => {
      if (isBlank(v)) return '';
      if (type === 'number') { const n = toNum(v); return isNaN(n) ? col.text(v, row) : typeof c.decimals === 'number' ? Number(n.toFixed(c.decimals)) : n; }
      if (type === 'date') return isoOf(v);
      return col.text(v, row);
    };
    col.total = c.total === undefined || c.total === null ? null : c.total;
    return col;
  }

  /* ======================================================================
     The grid
     ====================================================================== */
  // Registry of mounted grids for the single document-level key handler (Escape, '/').
  const liveGrids = [];
  let docKeyBound = false;

  /**
   * Create a grid. Returns its root element with the API methods attached (see the file header).
   * Throws outside a browser.
   */
  UI.grid = function grid(opts) {
    if (!hasDOM) throw new Error('Scope.ui.grid needs a DOM');
    const h = UI.h, icon = Scope.icon;
    opts = opts || {};
    const features = Object.assign({ chooser: true, filters: true, multiSort: true, totals: true, density: true, search: true, export: true, copy: true, resize: true, menu: true }, opts.features || {});
    const columns = (opts.columns || []).map(normaliseColumn);
    const colByKey = new Map(columns.map((c) => [c.key, c]));
    const defaultKeys = columns.map((c) => c.key);
    const rowKeyFn = typeof opts.rowKey === 'function' ? opts.rowKey : opts.rowKey ? (r) => (r ? r[opts.rowKey] : undefined) : null;
    const OVERSCAN = 10; // extra rows rendered above and below the viewport so fast scrolling does not flash blank

    /* ---------- state ---------- */
    // Everything the user can change lives in `state` (persisted to localStorage when storageKey is set):
    // visible keys, column order, widths, frozen count, sort levels, column filters, density, footer aggregates, search.
    /** Initial state from the column definitions; leading columns marked frozen form the frozen pane. */
    function defaultState() {
      let frozen = 0; for (const c of columns) { if (c.frozen) frozen++; else break; }
      return { visible: columns.filter((c) => !c.hidden).map((c) => c.key), order: defaultKeys.slice(), widths: {}, frozen, sort: [], filters: {}, density: 'normal', totals: {}, search: '' };
    }
    /**
     * Validate an incoming (saved or caller-supplied) state against the current columns, on top of `base`.
     * Unknown keys are dropped and malformed entries ignored, so a stale localStorage entry or an old saved
     * view never breaks the grid.
     */
    function normaliseState(s, base) {
      const st = base ? JSON.parse(JSON.stringify(base)) : defaultState();
      if (!s || typeof s !== 'object') return st;
      const known = colByKey;
      if (Array.isArray(s.order)) {
        const order = s.order.filter((k, i, a) => known.has(k) && a.indexOf(k) === i);
        // columns unknown to the saved state slot in after their default predecessor
        defaultKeys.forEach((k, i) => {
          if (order.includes(k)) return;
          let at = order.length;
          for (let j = i - 1; j >= 0; j--) { const p = order.indexOf(defaultKeys[j]); if (p >= 0) { at = p + 1; break; } }
          if (i === 0) at = 0;
          order.splice(at, 0, k);
        });
        st.order = order;
      }
      if (Array.isArray(s.visible)) st.visible = s.visible.filter((k) => known.has(k));
      if (s.widths && typeof s.widths === 'object') { st.widths = {}; for (const k in s.widths) if (known.has(k) && isFinite(+s.widths[k])) st.widths[k] = Math.max(48, +s.widths[k]); }
      if (s.frozen !== undefined) st.frozen = Math.max(0, Math.min(st.order.length, parseInt(s.frozen, 10) || 0));
      if (Array.isArray(s.sort)) st.sort = s.sort.filter((x) => x && known.has(x.key)).map((x) => ({ key: x.key, dir: x.dir === 'asc' ? 'asc' : 'desc' }));
      if (s.filters && typeof s.filters === 'object') {
        st.filters = {};
        for (const k in s.filters) {
          if (!known.has(k)) continue; const f = s.filters[k]; if (!f || typeof f !== 'object') continue;
          const o = {};
          if (typeof f.text === 'string' && f.text) o.text = f.text;
          if (Array.isArray(f.values)) { o.values = f.values.map((v) => String(v)); if (f.exclude) o.exclude = true; }
          if (typeof f.expr === 'string' && f.expr.trim()) o.expr = f.expr;
          if (Object.keys(o).length) st.filters[k] = o;
        }
      }
      if (s.density === 'compact' || s.density === 'normal') st.density = s.density;
      if (s.totals && typeof s.totals === 'object') { st.totals = {}; for (const k in s.totals) if (known.has(k) && AGGS.includes(s.totals[k])) st.totals[k] = s.totals[k]; }
      if (typeof s.search === 'string') st.search = s.search;
      return st;
    }
    let state = defaultState();
    if (opts.storageKey) { try { const raw = localStorage.getItem('scope.grid.' + opts.storageKey); if (raw) state = normaliseState(JSON.parse(raw), state); } catch (e) { /* storage unavailable or corrupt: keep defaults */ } }
    if (opts.state) state = normaliseState(opts.state, state);
    let persistT = null;
    /** Debounced (200 ms) save of the state to localStorage under 'scope.grid.<storageKey>'; the search box is not persisted. */
    function persist() {
      if (!opts.storageKey) return;
      clearTimeout(persistT);
      persistT = setTimeout(() => { try { const s = getState(); delete s.search; localStorage.setItem('scope.grid.' + opts.storageKey, JSON.stringify(s)); } catch (e) { /* ignore */ } }, 200);
    }

    /* ---------- data + caches ---------- */
    // filteredIdx: row indices passing the filters (source order); viewIdx: the same after sorting.
    // Everything displayed is addressed through viewIdx, so `rows` itself is never reordered or copied.
    let rows = Array.isArray(opts.rows) ? opts.rows : [];
    const cache = { cols: new Map(), search: null, visibleRows: null };
    let filteredIdx = [], viewIdx = [];
    /** Lazily created per-column cache bag (strs / lower / nums / dictionary / blank). */
    function colCache(c) { let cc = cache.cols.get(c.key); if (!cc) { cc = {}; cache.cols.set(c.key, cc); } return cc; }
    /** Display string of every row for column c (what text filters, value pickers and text sorts see). */
    function strsOf(c) {
      const cc = colCache(c);
      if (!cc.strs) { const a = new Array(rows.length); for (let i = 0; i < rows.length; i++) { const r = rows[i]; a[i] = c.text(c.get(r), r); } cc.strs = a; }
      return cc.strs;
    }
    /** Lower-cased display strings, for case-insensitive "contains" and search. */
    function lowerOf(c) { const cc = colCache(c); if (!cc.lower) { const s = strsOf(c); const a = new Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s[i].toLowerCase(); cc.lower = a; } return cc.lower; }
    /** Numeric value of every row (epoch ms for date columns, NaN for blanks) for expression filters, sorts and totals. */
    function numsOf(c) {
      const cc = colCache(c);
      if (!cc.nums) { const a = new Float64Array(rows.length); const conv = c.type === 'date' ? toTime : toNum; for (let i = 0; i < rows.length; i++) a[i] = conv(c.get(rows[i])); cc.nums = a; }
      return cc.nums;
    }
    /** Sorted distinct values + ranks for column c (text sorts and the value picker). */
    function dictOf(c) { const cc = colCache(c); if (!cc.dictionary) cc.dictionary = buildDictionary(strsOf(c)); return cc.dictionary; }
    /** Whether any row is blank in column c (adds a "(blank)" entry to the value picker). */
    function hasBlank(c) { const cc = colCache(c); if (cc.blank === undefined) { const s = strsOf(c); cc.blank = false; for (let i = 0; i < s.length; i++) if (s[i] === '') { cc.blank = true; break; } } return cc.blank; }
    /** Drop all derived caches (after setRows / refresh). */
    function invalidate() { cache.cols.clear(); cache.search = null; cache.visibleRows = null; }

    /**
     * Row-index predicate for one column filter: text contains (on display text), value set
     * (in / not in, on display text, so it matches what the picker lists) and expression (on the
     * numeric value). The parts of one column filter are ANDed; an unparsable expression is ignored
     * (the input is marked invalid instead). Expressions on a text column are read as numbers.
     */
    function columnPredicate(c, f) {
      const preds = [];
      if (f.text) { const q = f.text.toLowerCase(); const lower = lowerOf(c); preds.push((i) => lower[i].includes(q)); }
      if (Array.isArray(f.values)) { const set = new Set(f.values), ex = !!f.exclude, strs = strsOf(c); preds.push((i) => set.has(strs[i]) !== ex); }
      if (f.expr && c.type !== 'text') { const p = c.type === 'date' ? parseDateFilter(f.expr) : parseNumberFilter(f.expr); if (typeof p === 'function') { const nums = numsOf(c); preds.push((i) => p(nums[i])); } }
      if (f.expr && c.type === 'text') { const p = parseNumberFilter(f.expr); if (typeof p === 'function') { const nums = numsOf(c); preds.push((i) => p(nums[i])); } }
      if (!preds.length) return null; if (preds.length === 1) return preds[0];
      return (i) => { for (let k = 0; k < preds.length; k++) if (!preds[k](i)) return false; return true; };
    }
    /**
     * Predicates for every active column filter plus the global search, optionally skipping one column.
     * Skipping is how the value picker shows counts that reflect the other filters only, as in Excel.
     */
    function predicatesExcept(skipKey) {
      const preds = [];
      for (const key in state.filters) { if (key === skipKey) continue; const c = colByKey.get(key); if (!c) continue; const p = columnPredicate(c, state.filters[key]); if (p) preds.push(p); }
      const q = state.search.trim().toLowerCase();
      if (q) { const ss = searchStrings(); preds.push((i) => ss[i].includes(q)); }
      return preds;
    }
    /**
     * One lower-cased haystack per row joining the visible columns' text with a U+0001 separator (so a search
     * cannot match across two cells). Cached per visible-column set; global search only looks at visible columns.
     */
    function searchStrings() {
      const key = vis.map((c) => c.key).join('|');
      if (cache.search && cache.search.key === key) return cache.search.strs;
      const cols = vis.map((c) => lowerOf(c)), n = rows.length, a = new Array(n);
      for (let i = 0; i < n; i++) { let s = ''; for (let j = 0; j < cols.length; j++) s += cols[j][i] + '\u0001'; a[i] = s; }
      cache.search = { key, strs: a };
      return a;
    }
    /** Re-run all filters (all predicates ANDed) into filteredIdx, then re-sort. */
    function recompute() {
      const preds = predicatesExcept(null), n = rows.length, out = [];
      for (let i = 0; i < n; i++) { let ok = true; for (let k = 0; k < preds.length; k++) if (!preds[k](i)) { ok = false; break; } if (ok) out.push(i); }
      filteredIdx = out;
      applySort();
    }
    /** Sort filteredIdx into viewIdx: text columns by dictionary rank, number and date columns by value. */
    function applySort() {
      const levels = state.sort.map((s) => { const c = colByKey.get(s.key); if (!c) return null; return c.type === 'text' ? { values: dictOf(c).ranks, desc: s.dir === 'desc', ranks: true } : { values: numsOf(c), desc: s.dir === 'desc', ranks: false }; }).filter(Boolean);
      viewIdx = levels.length ? sortIndices(filteredIdx, levels) : filteredIdx;
      cache.visibleRows = null;
    }
    /** Row objects in display order (memoised until the next filter / sort). */
    function visibleRows() { if (!cache.visibleRows) cache.visibleRows = viewIdx.map((i) => rows[i]); return cache.visibleRows; }
    /** Number of filtered columns, plus one if the search box is in use. */
    function activeFilterCount() { return Object.keys(state.filters).length + (state.search.trim() ? 1 : 0); }

    /* ---------- DOM skeleton ---------- */
    // toolbar / filter chips / scrolling table (colgroup, sticky thead, virtual tbody, sticky tfoot) / status line
    const root = h('div', { class: 'grid' + (state.density === 'compact' ? ' grid-compact' : ''), role: 'group' });
    const toolbar = h('div', { class: 'grid-toolbar' });
    const chipsEl = h('div', { class: 'grid-chips' });
    const scroller = h('div', { class: 'grid-scroll', tabindex: '0', role: 'region', 'aria-label': opts.ariaLabel || 'Data grid', style: { height: opts.height || '62vh' } });
    const table = h('table', { class: 'grid-table', role: 'grid' });
    const colgroup = h('colgroup'), thead = h('thead'), tbody = h('tbody'), tfoot = h('tfoot');
    const status = h('div', { class: 'grid-status' });
    const countEl = h('span', { class: 'grid-count' });
    const statusText = h('span', { class: 'grid-status-text' });
    table.append(colgroup, thead, tbody);
    if (features.totals) table.appendChild(tfoot);
    scroller.appendChild(table);
    root.append(toolbar, chipsEl, scroller, status);
    status.append(countEl, statusText);

    // toolbar: search on the left, a flexible spacer, then the action buttons; opts.extraToolbar goes before the spacer
    let searchInput = null, clearBtn = null, densityBtn = null;
    if (features.search) {
      searchInput = h('input', { type: 'search', class: 'input grid-search', placeholder: 'Search all columns  ( / )', 'aria-label': 'Search rows', value: state.search });
      searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value; onFiltersChanged(); }, 120));
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (searchInput.value) { searchInput.value = ''; state.search = ''; onFiltersChanged(); } searchInput.blur(); e.stopPropagation(); } });
      toolbar.appendChild(h('div', { class: 'grid-search-wrap' }, icon('search', { size: 14, class: 'grid-search-icon' }), searchInput));
    }
    const toolbarSpacer = h('span', { class: 'grid-spacer-flex' });
    toolbar.appendChild(toolbarSpacer);
    if (features.filters) { clearBtn = h('button', { class: 'btn btn-sm grid-clear', type: 'button', onClick: () => clearFilters() }, icon('x', { size: 13 }), 'Clear filters'); toolbar.appendChild(clearBtn); }
    if (features.density) { densityBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Toggle row density', onClick: () => setDensity(state.density === 'compact' ? 'normal' : 'compact') }, icon('list', { size: 13 }), h('span', { class: 'grid-density-label' })); toolbar.appendChild(densityBtn); }
    if (features.chooser) toolbar.appendChild(h('button', { class: 'btn btn-sm', type: 'button', title: 'Show, hide, reorder and freeze columns', onClick: (e) => openChooser(e.currentTarget) }, icon('columns', { size: 13 }), 'Columns'));
    if (features.copy) toolbar.appendChild(h('button', { class: 'btn btn-sm', type: 'button', title: 'Copy visible rows as tab-separated text', onClick: () => copyTsv() }, icon('clipboard', { size: 13 }), 'Copy'));
    if (features.export) toolbar.appendChild(h('button', { class: 'btn btn-sm', type: 'button', title: 'Download the visible rows and columns as CSV', onClick: () => exportCsv() }, icon('download', { size: 13 }), 'Export CSV'));
    if (opts.extraToolbar) toolbar.insertBefore(opts.extraToolbar, toolbarSpacer);

    /* ---------- layout ---------- */
    // vis: visible columns in display order; cellBase: base class per visible column; frozenLeft: sticky
    // left offset (px) of each frozen column; pool: recycled body <tr> elements.
    let vis = [], cellBase = [], frozenLeft = [], pool = [];
    let headRow = null, filterRow = null, footRow = null, spacerTopTd = null, spacerBottomTd = null, spacerTopTr = null, spacerBottomTr = null;
    // rowH starts from the CSS density height and is corrected from the first rendered row in measure();
    // start / end are the currently rendered window [start, end) in viewIdx; activeRow is the keyboard cursor.
    let rowH = state.density === 'compact' ? 24 : 28, headH = 0, footH = 0, start = -1, end = -1, activeRow = -1;
    let rafPending = false, resizeObs = null, destroyed = false;

    /** Current width of a column: user-resized width, else its default. */
    function widthOf(c) { return state.widths[c.key] || c.width; }
    /**
     * Rebuild colgroup, header, filter row, footer and the empty body (two spacer rows) for the
     * current visible columns. Fixed table layout: the table width is the sum of column widths so
     * horizontal scrolling works and frozen columns can stick with position: sticky.
     */
    function layoutColumns() {
      vis = state.order.filter((k) => colByKey.has(k) && state.visible.includes(k)).map((k) => colByKey.get(k));
      const frozen = Math.min(state.frozen, vis.length);
      cellBase = vis.map((c, j) => 'grid-cell' + (c.align === 'right' ? ' grid-num' : c.align === 'center' ? ' grid-center' : '') + (j < frozen ? ' grid-frozen' : '') + (j === frozen - 1 ? ' grid-frozen-last' : ''));
      frozenLeft = vis.map(() => 0);
      // colgroup
      colgroup.innerHTML = '';
      let total = 0;
      for (const c of vis) { const w = widthOf(c); total += w; colgroup.appendChild(h('col', { style: { width: w + 'px' }, 'data-k': c.key })); }
      table.style.width = total + 'px';
      // header
      thead.innerHTML = '';
      headRow = h('tr', { class: 'grid-head', role: 'row' });
      vis.forEach((c, j) => {
        const th = h('th', { class: 'grid-th' + (c.align === 'right' ? ' grid-num' : '') + (j < frozen ? ' grid-frozen' : '') + (j === frozen - 1 ? ' grid-frozen-last' : ''), role: 'columnheader', scope: 'col', title: c.title || c.label, 'data-k': c.key, 'data-j': j, 'aria-sort': 'none' },
          h('div', { class: 'grid-th-inner' },
            h('span', { class: 'grid-th-label' }, c.label, c.unit ? h('small', { class: 'grid-th-unit' }, c.unit) : null),
            h('span', { class: 'grid-funnel', title: 'Filtered' }, icon('filter', { size: 11 })),
            h('span', { class: 'grid-sort', 'aria-hidden': 'true' })),
          features.resize ? h('div', { class: 'grid-resizer', 'data-k': c.key, title: 'Drag to resize, double-click to auto-fit' }) : null);
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      filterRow = null;
      if (features.filters) {
        filterRow = h('tr', { class: 'grid-filters', role: 'row' });
        vis.forEach((c, j) => {
          const f = state.filters[c.key] || {};
          const input = h('input', { class: 'grid-filter-input', type: 'text', 'data-k': c.key, 'aria-label': 'Filter ' + c.label, autocomplete: 'off', spellcheck: 'false',
            placeholder: c.type === 'number' ? '>100' : c.type === 'date' ? '2027' : 'contains', title: c.type === 'text' ? 'Text contains' : c.type === 'date' ? 'Date filter: 2027 · 2027-01..2027-06 · >=2027-06-30 · blank' : 'Number filter: >100 · <=5 · 100..200 · =0 · blank · nonblank' });
          input.value = c.type === 'text' ? (f.text || '') : (f.expr || '');
          const btn = h('button', { class: 'grid-filter-btn', type: 'button', 'data-k': c.key, title: 'Choose values', tabindex: '-1', 'aria-label': 'Choose values for ' + c.label }, icon('chevron-down', { size: 12 }));
          filterRow.appendChild(h('th', { class: 'grid-filter-cell' + (j < frozen ? ' grid-frozen' : '') + (j === frozen - 1 ? ' grid-frozen-last' : ''), 'data-k': c.key, 'data-j': j }, h('div', { class: 'grid-filter' }, input, btn)));
        });
        thead.appendChild(filterRow);
      }
      // footer
      if (features.totals) {
        tfoot.innerHTML = '';
        footRow = h('tr', { class: 'grid-foot', role: 'row' });
        vis.forEach((c, j) => footRow.appendChild(h('td', { class: 'grid-foot-cell' + (c.align === 'right' ? ' grid-num' : '') + (j < frozen ? ' grid-frozen' : '') + (j === frozen - 1 ? ' grid-frozen-last' : ''), 'data-k': c.key, 'data-j': j },
          h('span', { class: 'grid-foot-val' }), h('button', { class: 'grid-foot-btn', type: 'button', 'data-k': c.key, title: 'Choose aggregate', tabindex: '-1' }, icon('chevron-down', { size: 11 })))));
        tfoot.appendChild(footRow);
      }
      // body pool
      tbody.innerHTML = ''; pool = [];
      spacerTopTd = h('td', { colspan: String(Math.max(1, vis.length)), class: 'grid-spacer-td' });
      spacerBottomTd = h('td', { colspan: String(Math.max(1, vis.length)), class: 'grid-spacer-td' });
      spacerTopTr = h('tr', { class: 'grid-spacer', 'aria-hidden': 'true' }, spacerTopTd);
      spacerBottomTr = h('tr', { class: 'grid-spacer', 'aria-hidden': 'true' }, spacerBottomTd);
      tbody.append(spacerTopTr, spacerBottomTr);
      start = end = -1;
      cache.search = null;
      updateSortIndicators(); updateFunnels();
      scheduleMeasure();
    }

    /** Create an empty pooled body row with one cell per visible column (link-type cells get an <a>). */
    function makeRow() {
      const tr = document.createElement('tr'); tr.className = 'grid-row'; tr.setAttribute('role', 'row');
      for (let j = 0; j < vis.length; j++) {
        const c = vis[j], td = document.createElement('td'); td.className = cellBase[j]; td.setAttribute('role', 'gridcell');
        if (c.href) { const a = document.createElement('a'); a.className = 'grid-link'; td.appendChild(a); }
        if (j < state.frozen) td.style.left = frozenLeft[j] + 'px';
        tr.appendChild(td);
      }
      return tr;
    }
    /** Fill a pooled row with the k-th row of the current view (data-r = view position, used by click handling). */
    function fillRow(tr, k) {
      const idx = viewIdx[k], row = rows[idx];
      tr.dataset.r = k; tr.setAttribute('aria-rowindex', String(k + 1));
      tr.className = 'grid-row' + (k === activeRow ? ' grid-active' : '') + (opts.onRow ? ' grid-clickable' : '');
      const cells = tr.children;
      for (let j = 0; j < vis.length; j++) {
        const c = vis[j], td = cells[j], v = c.get(row), text = c.text(v, row);
        if (c.href) { const a = td.firstChild; const u = c.href(row); a.href = u || '#'; a.textContent = text; }
        else td.textContent = text;
        if (c.cellClass) { const extra = c.cellClass(v, row); td.className = extra ? cellBase[j] + ' ' + extra : cellBase[j]; }
        if (c.tooltip) td.title = c.tooltip(v, row) || '';
      }
    }
    /**
     * Virtual scrolling: render only view rows [s, e) around the viewport.
     * Body rows have a fixed height (rowH), so the first visible row is scrollTop / rowH and the
     * window spans the scroller height minus the sticky header and footer, widened by OVERSCAN rows
     * on each side. The top spacer stands in for the s rows above and the bottom spacer for the
     * rows below, so the scrollbar reflects the full row count. Skipped when the window is unchanged
     * unless force is set (data, filter or layout changed).
     */
    function renderWindow(force) {
      const total = viewIdx.length;
      const top = scroller.scrollTop, vh = Math.max(0, scroller.clientHeight - headH - footH);
      let s = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
      let e = Math.min(total, Math.ceil((top + vh) / rowH) + OVERSCAN);
      if (e < s) e = s;
      if (!force && s === start && e === end) return;
      start = s; end = e;
      spacerTopTd.style.height = (s * rowH) + 'px';
      spacerBottomTd.style.height = ((total - e) * rowH) + 'px';
      spacerTopTr.style.display = s > 0 ? '' : 'none';
      spacerBottomTr.style.display = total - e > 0 ? '' : 'none';
      // Grow the pool as needed; surplus pooled rows are hidden rather than removed, so they can be reused.
      const need = e - s;
      while (pool.length < need) { const tr = makeRow(); pool.push(tr); tbody.insertBefore(tr, spacerBottomTr); }
      for (let k = 0; k < pool.length; k++) { const tr = pool[k]; if (k < need) { fillRow(tr, s + k); tr.style.display = ''; } else if (tr.style.display !== 'none') tr.style.display = 'none'; }
      table.setAttribute('aria-rowcount', String(total));
      if (!total) showEmpty(); else hideEmpty();
    }
    let emptyEl = null;
    /** Overlay message when there are no rows, with a "Clear filters" shortcut when filters caused it. */
    function showEmpty() {
      if (!emptyEl) {
        emptyEl = h('div', { class: 'grid-empty' }, h('span', {}, rows.length ? 'No rows match the current filters.' : 'No rows.'),
          rows.length && activeFilterCount() ? h('button', { class: 'btn btn-sm', type: 'button', onClick: () => clearFilters() }, 'Clear filters') : null);
        scroller.appendChild(emptyEl);
      }
    }
    /** Remove the empty-state overlay. */
    function hideEmpty() { if (emptyEl) { emptyEl.remove(); emptyEl = null; } }

    /** Coalesce layout measurement into the next animation frame (after the browser has laid out the new DOM). */
    function scheduleMeasure() {
      if (rafPending) return; rafPending = true;
      requestAnimationFrame(() => { rafPending = false; if (destroyed) return; measure(); });
    }
    /**
     * Read the real header / footer heights and row height from the DOM. --grid-head-h lets CSS place the
     * sticky filter row directly under the header row. If the rendered row height differs from the
     * assumed one (fonts, density, zoom), rowH is corrected and the window redrawn so the virtual maths stays exact.
     */
    function measure() {
      headH = thead.offsetHeight || 0; footH = features.totals ? (tfoot.offsetHeight || 0) : 0;
      const hr = headRow ? headRow.offsetHeight : 0;
      root.style.setProperty('--grid-head-h', hr + 'px');
      applyFrozen();
      renderWindow(true);
      // measure the real row height once rows exist
      const first = pool.find((tr) => tr.style.display !== 'none');
      if (first) { const hgt = first.getBoundingClientRect().height; if (hgt > 4 && Math.abs(hgt - rowH) > 0.5) { rowH = hgt; renderWindow(true); } }
    }
    /**
     * Frozen panes: each frozen column is position: sticky with `left` = the summed widths of the frozen
     * columns before it (measured from the header cells). Applied to header, filter, footer and pooled body rows.
     */
    function applyFrozen() {
      const frozen = Math.min(state.frozen, vis.length);
      if (!headRow) return;
      const ths = headRow.children; let left = 0;
      for (let j = 0; j < vis.length; j++) { frozenLeft[j] = left; if (j < frozen) left += ths[j] ? ths[j].offsetWidth : widthOf(vis[j]); }
      // Apply the frozen offsets to one row's leading cells.
      const setLeft = (tr) => { if (!tr) return; const cells = tr.children; for (let j = 0; j < frozen && j < cells.length; j++) cells[j].style.left = frozenLeft[j] + 'px'; };
      setLeft(headRow); setLeft(filterRow); setLeft(footRow);
      for (const tr of pool) setLeft(tr);
    }

    /* ---------- header UI state ---------- */
    /** Sync header sort classes and aria-sort; with several sort levels each sorted header shows its level number. */
    function updateSortIndicators() {
      if (!headRow) return;
      const ths = headRow.children;
      for (let j = 0; j < ths.length; j++) {
        const th = ths[j], key = th.dataset.k, i = state.sort.findIndex((s) => s.key === key), ind = th.querySelector('.grid-sort');
        th.classList.toggle('grid-sorted', i >= 0); th.classList.toggle('grid-asc', i >= 0 && state.sort[i].dir === 'asc'); th.classList.toggle('grid-desc', i >= 0 && state.sort[i].dir === 'desc');
        th.setAttribute('aria-sort', i < 0 ? 'none' : state.sort[i].dir === 'asc' ? 'ascending' : 'descending');
        ind.textContent = i >= 0 && state.sort.length > 1 ? String(i + 1) : '';
      }
    }
    /**
     * Sync filter indicators: funnel on filtered headers, filter inputs reflecting the state (except the
     * one being typed in), invalid-expression styling, and a marker when a value list is active.
     */
    function updateFunnels() {
      if (!headRow) return;
      for (const th of headRow.children) th.classList.toggle('grid-filtered', !!state.filters[th.dataset.k]);
      if (filterRow) for (const th of filterRow.children) {
        const key = th.dataset.k, c = colByKey.get(key), f = state.filters[key] || {}, input = th.querySelector('input');
        th.classList.toggle('grid-filtered', !!state.filters[key]);
        const want = c.type === 'text' ? (f.text || '') : (f.expr || '');
        if (document.activeElement !== input && input.value !== want) input.value = want;
        let invalid = false;
        if (f.expr) { const p = c.type === 'date' ? parseDateFilter(f.expr) : parseNumberFilter(f.expr); invalid = !!(p && p.error); }
        input.classList.toggle('invalid', invalid);
        if (!input.dataset.title) input.dataset.title = input.title;
        input.title = invalid ? 'Cannot read this expression' : input.dataset.title;
        th.classList.toggle('grid-has-values', Array.isArray(f.values));
      }
    }
    /** Status line "n of t rows", Clear-filters visibility and the density button label. */
    function updateCount() {
      const n = viewIdx.length, t = rows.length;
      countEl.textContent = n === t ? `${fmtInt(t)} rows` : `${fmtInt(n)} of ${fmtInt(t)} rows`;
      if (clearBtn) clearBtn.style.display = activeFilterCount() ? '' : 'none';
      if (densityBtn) densityBtn.querySelector('.grid-density-label').textContent = state.density === 'compact' ? 'Normal' : 'Compact';
    }
    /** One removable chip per active filter (and the search), flagging filters on hidden columns so they are not forgotten. */
    function renderChips() {
      chipsEl.innerHTML = '';
      if (!features.filters) return;
      const keys = Object.keys(state.filters);
      if (!keys.length && !state.search.trim()) { chipsEl.style.display = 'none'; return; }
      chipsEl.style.display = '';
      if (state.search.trim()) chipsEl.appendChild(chip(`Search: "${state.search.trim()}"`, () => { state.search = ''; if (searchInput) searchInput.value = ''; onFiltersChanged(); }));
      for (const key of keys) {
        const c = colByKey.get(key), f = state.filters[key], hidden = !state.visible.includes(key);
        const parts = [];
        if (f.text) parts.push(`contains "${f.text}"`);
        if (Array.isArray(f.values)) { const vals = f.values.map((v) => (v === '' ? '(blank)' : v)); parts.push((f.exclude ? 'not ' : '') + (vals.length ? vals.slice(0, 3).join(', ') + (vals.length > 3 ? ` +${vals.length - 3}` : '') : '(none)')); }
        if (f.expr) parts.push(f.expr);
        chipsEl.appendChild(chip(`${c.label}: ${parts.join(' · ')}`, () => removeFilter(key), hidden ? 'hidden column' : null));
      }
      chipsEl.appendChild(h('button', { class: 'btn btn-sm btn-ghost grid-chip-clear', type: 'button', onClick: () => clearFilters() }, 'Clear all'));
    }
    /** Filter chip element: label, optional warning badge and a remove button. */
    function chip(label, onRemove, warn) {
      return h('span', { class: 'grid-chip' }, h('span', { class: 'grid-chip-label', title: label }, label), warn ? h('span', { class: 'badge badge-warn' }, warn) : null,
        h('button', { class: 'grid-chip-x', type: 'button', title: 'Remove', 'aria-label': 'Remove filter ' + label, onClick: onRemove }, icon('x', { size: 11 })));
    }
    /**
     * Footer totals over the visible (filtered) rows only. A user-chosen aggregate overrides the column's
     * default; a function total receives the visible row objects; text columns only support count.
     * When the first column has no aggregate it shows the "Total" label.
     */
    function renderTotals() {
      if (!features.totals || !footRow) return;
      const cells = footRow.children;
      for (let j = 0; j < vis.length; j++) {
        const c = vis[j], td = cells[j], val = td.querySelector('.grid-foot-val');
        const agg = totalAggOf(c);
        let text = '';
        if (agg === 'fn') { try { const r = c.total(visibleRows()); text = r === null || r === undefined ? '' : typeof r === 'number' ? c.formatTotal(r) : String(r); } catch (e) { text = ''; } }
        else if (agg === 'count') text = fmtInt(c.type === 'text' ? countNonBlank(c) : aggregate(numsOf(c), viewIdx, 'count'));
        else if (agg && agg !== 'none') text = c.type === 'text' ? '' : c.formatTotal(aggregate(numsOf(c), viewIdx, agg));
        if (!text && j === 0 && (!agg || agg === 'none')) text = 'Total';
        val.textContent = text;
        td.title = agg && agg !== 'none' ? `${AGG_LABEL[agg] || 'Total'} of ${fmtInt(viewIdx.length)} visible rows` : '';
      }
    }
    /** Count of visible rows with a non-blank display value in column c. */
    function countNonBlank(c) { const s = strsOf(c); let n = 0; for (let k = 0; k < viewIdx.length; k++) if (s[viewIdx[k]] !== '') n++; return n; }
    /** Effective footer aggregate: user choice, else 'fn' for a function total, else the column's named total, else null. */
    function totalAggOf(c) {
      if (state.totals[c.key]) return state.totals[c.key];
      if (typeof c.total === 'function') return 'fn';
      if (c.total === 'sum' || c.total === 'avg' || c.total === 'min' || c.total === 'max' || c.total === 'count') return c.total;
      return null;
    }

    /** Full refresh after data or filter changes: filter, sort, status, chips, totals, header state and body window. */
    function renderAll() { recompute(); updateCount(); renderChips(); renderTotals(); updateFunnels(); updateSortIndicators(); start = end = -1; renderWindow(true); }
    /** Common path for every filter / search change: re-render, persist, refresh an open value picker and notify listeners. */
    function onFiltersChanged() {
      renderAll(); persist();
      if (pop && pop.meta && pop.meta.refresh) pop.meta.refresh();
      if (typeof opts.onFilterChange === 'function') opts.onFilterChange(getFilters());
      emitState();
    }
    /** Notify opts.onStateChange with a copy of the state (used to mirror grid layouts into saved views / URLs). */
    function emitState() { if (typeof opts.onStateChange === 'function') opts.onStateChange(getState()); }

    /* ---------- filters API ---------- */
    /** Merge a patch into one column's filter; null / '' / false entries are removed, and an emptied filter is deleted. */
    function setColumnFilter(key, patch) {
      const cur = Object.assign({}, state.filters[key] || {});
      for (const k in patch) { const v = patch[k]; if (v === null || v === undefined || v === '' || (k === 'exclude' && !v)) delete cur[k]; else cur[k] = v; }
      if (cur.values && !cur.values.length && !cur.exclude) { /* explicit empty selection: keep (matches nothing) */ }
      if (Object.keys(cur).length) state.filters[key] = cur; else delete state.filters[key];
      onFiltersChanged();
    }
    /** Remove one column's filter. */
    function removeFilter(key) { delete state.filters[key]; onFiltersChanged(); }
    /** Remove every column filter and the search. */
    function clearFilters() { state.filters = {}; state.search = ''; if (searchInput) searchInput.value = ''; if (filterRow) for (const i of filterRow.querySelectorAll('input')) i.value = ''; onFiltersChanged(); }
    /**
     * Contract-shape filters [{ field, op, value }] derived from the grid's column filters.
     * Expressions are translated where they map onto a single operator (dates as yyyy-mm-dd; a bare
     * year becomes a between); anything else is passed through as { op: 'expr' }.
     */
    function getFilters() {
      const out = [];
      for (const key in state.filters) {
        const c = colByKey.get(key), f = state.filters[key];
        if (f.text) out.push({ field: key, op: 'contains', value: f.text });
        if (Array.isArray(f.values)) out.push({ field: key, op: f.exclude ? 'notIn' : 'in', value: f.values.slice() });
        if (f.expr) {
          const conv = c.type === 'date' ? (t) => { const d = dateTok(t); return Array.isArray(d) ? d.map((x) => new Date(x).toISOString().slice(0, 10)) : (isNaN(d) ? null : new Date(d).toISOString().slice(0, 10)); } : (t) => { const n = toNum(t); return isNaN(n) ? null : n; };
          const e = f.expr.trim();
          /** Translate one clause ("100..200", ">=5", "2027", "blank") into a contract filter, or null if it cannot be mapped. */
          const clause = (x) => {
            let m;
            if ((m = x.match(/^(.+?)\s*(?:\.\.+|\u2026|\bto\b)\s*(.+)$/i))) { const a = conv(m[1]), b = conv(m[2]); if (a === null || b === null) return null; return { field: key, op: 'between', value: [Array.isArray(a) ? a[0] : a, Array.isArray(b) ? b[1] : b] }; }
            if ((m = x.match(/^(>=|<=|<>|!=|==|=|>|<)\s*(.+)$/))) {
              const v = conv(m[2]); if (v === null) return null;
              const a = Array.isArray(v) ? v[0] : v, b = Array.isArray(v) ? v[1] : v, op = m[1];
              if (op === '>=') return { field: key, op: 'gte', value: a };
              if (op === '<=') return { field: key, op: 'lte', value: b };
              if (op === '=' || op === '==') return Array.isArray(v) ? { field: key, op: 'between', value: [a, b] } : { field: key, op: 'eq', value: a };
              if (op === '!=' || op === '<>') return { field: key, op: 'neq', value: a };
              return op === '>' ? { field: key, op: 'gt', value: b, expr: x } : { field: key, op: 'lt', value: a, expr: x };
            }
            if (/^(blank|blanks|empty|null|\(blank\))$/i.test(x)) return { field: key, op: 'in', value: [''] };
            if (/^(nonblank|notblank|filled|\*)$/i.test(x)) return { field: key, op: 'notIn', value: [''] };
            const v = conv(x); if (v === null) return null;
            return Array.isArray(v) ? { field: key, op: 'between', value: v } : { field: key, op: 'eq', value: v };
          };
          // compound expressions such as ">100 <500" or ">=2027, <2030" become one AND-ed filter per clause
          const parts = e.split(/\s*(?:,|&&|\band\b)\s*|\s+(?=[<>=!])/i).map((x) => x.trim()).filter(Boolean);
          const mapped = parts.map(clause);
          if (mapped.length && mapped.every(Boolean)) out.push(...mapped);
          else out.push({ field: key, op: 'expr', value: e }); // left for the grid's own expression engine
        }
      }
      return out;
    }
    /**
     * Accepts contract-shape filters and maps them onto column filters (replaces the current set).
     * Range operators become expression text (several on one field are ANDed); eq / neq on a text
     * column become a value list. Filters on unknown fields are ignored.
     */
    function setFilters(list) {
      const next = {};
      for (const f of (Array.isArray(list) ? list : [])) {
        if (!f || !colByKey.has(f.field)) continue;
        const c = colByKey.get(f.field), cur = next[f.field] || (next[f.field] = {});
        // asExpr appends to the column's expression (conditions ANDed); tok renders a value as an expression token.
        const asExpr = (s) => { cur.expr = cur.expr ? cur.expr + ' ' + s : s; };
        const tok = (v) => (c.type === 'date' ? isoOf(v) || String(v) : String(v));
        switch (f.op) {
          case 'contains': cur.text = String(f.value); break;
          case 'in': cur.values = [].concat(f.value).map((v) => String(v)); delete cur.exclude; break;
          case 'notIn': cur.values = [].concat(f.value).map((v) => String(v)); cur.exclude = true; break;
          case 'between': asExpr(`${tok(f.value[0])}..${tok(f.value[1])}`); break;
          case 'gte': asExpr('>=' + tok(f.value)); break;
          case 'lte': asExpr('<=' + tok(f.value)); break;
          case 'gt': asExpr('>' + tok(f.value)); break;
          case 'lt': asExpr('<' + tok(f.value)); break;
          case 'eq': if (c.type === 'text') cur.values = [String(f.value)]; else asExpr('=' + tok(f.value)); break;
          case 'neq': if (c.type === 'text') { cur.values = [String(f.value)]; cur.exclude = true; } else asExpr('!=' + tok(f.value)); break;
          case 'expr': asExpr(String(f.value)); break;
          default: break;
        }
      }
      state.filters = next;
      onFiltersChanged();
    }

    /* ---------- sorting ---------- */
    /**
     * Header-click sort cycle. Numbers start descending, text and dates ascending; a second click
     * flips the direction and a third clears it. With shift (additive) the column is added as a further
     * level or cycled within the existing levels; without shift it becomes the only sort level.
     */
    function toggleSort(key, additive) {
      const c = colByKey.get(key); if (!c) return;
      const first = c.type === 'number' ? 'desc' : 'asc', second = first === 'desc' ? 'asc' : 'desc';
      const i = state.sort.findIndex((s) => s.key === key);
      if (additive && features.multiSort) {
        if (i < 0) state.sort.push({ key, dir: first });
        else if (state.sort[i].dir === first) state.sort[i].dir = second;
        else state.sort.splice(i, 1);
      } else if (i >= 0 && state.sort.length === 1) {
        if (state.sort[0].dir === first) state.sort[0].dir = second; else state.sort = [];
      } else state.sort = [{ key, dir: first }];
      applySort(); updateSortIndicators(); start = end = -1; renderWindow(true); renderTotals(); persist(); emitState();
    }
    /** Replace the sort levels programmatically ([{ key, dir }]; unknown keys dropped). */
    function setSort(sort) { state.sort = normaliseState({ sort }).sort; applySort(); updateSortIndicators(); start = end = -1; renderWindow(true); persist(); emitState(); }

    /* ---------- column operations ---------- */
    /** Switch between normal (28px) and compact (24px) rows; the real height is re-measured. */
    function setDensity(d) { state.density = d === 'compact' ? 'compact' : 'normal'; root.classList.toggle('grid-compact', state.density === 'compact'); rowH = state.density === 'compact' ? 24 : 28; start = end = -1; scheduleMeasure(); updateCount(); persist(); emitState(); }
    /** Set a column width (min 48px) in place, without rebuilding the table. */
    function setWidth(key, w) { state.widths[key] = Math.max(48, Math.round(w)); const col = colgroup.querySelector(`col[data-k="${cssEsc(key)}"]`); if (col) col.style.width = state.widths[key] + 'px'; let total = 0; for (const c of vis) total += widthOf(c); table.style.width = total + 'px'; applyFrozen(); persist(); emitState(); }
    /** Rebuild after a column-set change (visibility, order, freeze), keeping the scroll position. */
    function relayout() { const st = scroller.scrollTop; layoutColumns(); recompute(); updateCount(); renderChips(); renderTotals(); renderWindow(true); scroller.scrollTop = st; persist(); emitState(); }
    /** Show or hide one column. */
    function setVisible(key, on) { const i = state.visible.indexOf(key); if (on && i < 0) state.visible.push(key); if (!on && i >= 0) state.visible.splice(i, 1); relayout(); }
    /** Move a column by delta positions within the full column order (hidden columns included). */
    function moveColumn(key, delta) { const i = state.order.indexOf(key); const j = i + delta; if (i < 0 || j < 0 || j >= state.order.length) return; state.order.splice(i, 1); state.order.splice(j, 0, key); relayout(); }
    /** Show only this column. */
    function hideAllBut(key) { state.visible = [key]; relayout(); }
    /** Freeze every visible column up to and including this one. */
    function freezeTo(key) { const idx = vis.findIndex((c) => c.key === key); state.frozen = idx < 0 ? 0 : idx + 1; relayout(); }
    /** Restore the default columns, order, widths and frozen pane (filters and sort are kept). */
    function resetColumns() { const d = defaultState(); state.visible = d.visible; state.order = d.order; state.widths = {}; state.frozen = d.frozen; relayout(); }
    /**
     * Auto-fit a column to its header and the first 200 visible rows, measured with a shared off-screen
     * canvas in the grid's font (padding allows for the sort / filter icons); capped at 520px.
     */
    function autoFit(c) {
      const ctx = (autoFit.ctx || (autoFit.ctx = document.createElement('canvas').getContext('2d')));
      const cs = getComputedStyle(scroller); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      let w = ctx.measureText(c.label).width + 44;
      const n = Math.min(200, viewIdx.length);
      for (let k = 0; k < n; k++) { const row = rows[viewIdx[k]]; w = Math.max(w, ctx.measureText(c.text(c.get(row), row)).width + 20); }
      setWidth(c.key, Math.min(520, Math.ceil(w)));
    }
    /** Escape a column key for use inside a quoted CSS attribute selector. */
    function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    /* ---------- popovers ---------- */
    // At most one popover (value picker, column chooser or menu) is open per grid; `pop` holds it.
    let pop = null;
    /** Close the open popover and detach its outside-click and resize listeners. */
    function closePopover() { if (!pop) return; const p = pop; pop = null; p.el.remove(); document.removeEventListener('mousedown', p.onDown, true); window.removeEventListener('resize', p.onResize); }
    /**
     * Open a popover attached to <body> (so the scroller's overflow cannot clip it) and position it
     * in viewport coordinates under the anchor, left-aligned (or right-aligned when meta.alignRight),
     * clamped to an 8px margin inside the window and flipped above the anchor when it would overflow
     * the bottom. It closes on a mousedown outside both popover and anchor; that listener is added on
     * the next tick so the click that opened it does not close it immediately.
     * meta: { type: 'values' | 'chooser' | 'menu', key?, refresh?, cls?, alignRight? }
     */
    function openPopover(anchor, content, meta) {
      closePopover();
      const el = h('div', { class: 'grid-popover' + (meta && meta.cls ? ' ' + meta.cls : ''), role: 'dialog' }, content);
      document.body.appendChild(el);
      // (Re)position under the anchor; also called on window resize.
      const place = () => {
        const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
        let left = meta && meta.alignRight ? r.right - w : r.left, top = r.bottom + 4;
        if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8); if (left < 8) left = 8;
        if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 4);
        el.style.left = left + 'px'; el.style.top = top + 'px';
      };
      place();
      const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
      const onResize = () => place();
      setTimeout(() => { if (pop && pop.el === el) document.addEventListener('mousedown', onDown, true); }, 0);
      window.addEventListener('resize', onResize);
      pop = { el, anchor, meta: meta || {}, onDown, onResize, place };
      const focusable = el.querySelector('input, button'); if (focusable) focusable.focus();
      return pop;
    }
    /** Popover menu from [{ label, icon?, active?, disabled?, onClick }] with '-' separators; choosing an item closes the menu. */
    function menu(items) {
      return h('div', { class: 'grid-menu', role: 'menu' }, items.map((it) => it === '-' ? h('div', { class: 'grid-menu-sep' }) : h('button', { class: 'grid-menu-item' + (it.active ? ' active' : '') + (it.disabled ? ' disabled' : ''), type: 'button', role: 'menuitem', disabled: it.disabled ? true : null, onClick: () => { closePopover(); it.onClick && it.onClick(); } }, it.icon ? icon(it.icon, { size: 13 }) : h('span', { class: 'grid-menu-icon' }), it.label)));
    }

    /**
     * Value picker (multi-select of distinct values with counts), Excel's AutoFilter list.
     * Counts reflect the other filters only (predicatesExcept), values with zero count stay listed
     * (dimmed). The list itself is virtualised with fixed 26px items so columns with thousands of
     * distinct values stay responsive. Every tick commits immediately.
     */
    function openValuePicker(c, anchor) {
      const ITEM_H = 26, LIST_H = 264;
      const wrap = h('div', { class: 'grid-picker' });
      const search = h('input', { type: 'search', class: 'input grid-pop-search', placeholder: `Search ${c.label}`, 'aria-label': 'Search values' });
      const listEl = h('div', { class: 'grid-pick-list', style: { height: LIST_H + 'px' } });
      const inner = h('div', { class: 'grid-pick-inner' });
      const foot = h('div', { class: 'grid-pick-foot' });
      const summary = h('span', { class: 'muted small' });
      listEl.appendChild(inner);
      let items = [], shown = [], q = '';
      /** Recount distinct values under the other filters and mark the current selection; blank listed first. */
      function build() {
        const f = state.filters[c.key] || {};
        const dict = dictOf(c).dict, strs = strsOf(c), preds = predicatesExcept(c.key), counts = new Map();
        for (let i = 0; i < rows.length; i++) { let ok = true; for (let k = 0; k < preds.length; k++) if (!preds[k](i)) { ok = false; break; } if (!ok) continue; const s = strs[i]; counts.set(s, (counts.get(s) || 0) + 1); }
        const sel = Array.isArray(f.values) ? new Set(f.values) : null, ex = !!f.exclude;
        // Selected = in the include list, or not in the exclude list; no list means everything is selected.
        const isSel = (v) => (sel ? sel.has(v) !== ex : true);
        items = (hasBlank(c) ? [''] : []).concat(dict).map((v) => ({ v, label: v === '' ? '(blank)' : v, count: counts.get(v) || 0, sel: isSel(v) }));
        filterShown();
      }
      /** Apply the picker's own search box to the item list and resize the virtual list. */
      function filterShown() { shown = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items; inner.style.height = (shown.length * ITEM_H) + 'px'; draw(true); const n = items.filter((it) => it.sel).length; summary.textContent = `${fmtInt(n)} of ${fmtInt(items.length)} selected`; }
      let ls = -1, le = -1;
      /** Render the visible slice of the picker list (absolutely positioned items, 4 items of overscan). */
      function draw(force) {
        const top = listEl.scrollTop, s = Math.max(0, Math.floor(top / ITEM_H) - 4), e = Math.min(shown.length, Math.ceil((top + LIST_H) / ITEM_H) + 4);
        if (!force && s === ls && e === le) return; ls = s; le = e;
        inner.innerHTML = '';
        if (!shown.length) { inner.appendChild(h('div', { class: 'grid-pick-none muted' }, 'No values')); return; }
        for (let i = s; i < e; i++) {
          const it = shown[i];
          const lab = h('label', { class: 'grid-pick' + (it.count ? '' : ' zero') + (it.sel ? ' sel' : ''), style: { top: (i * ITEM_H) + 'px' }, 'data-i': i, title: it.label },
            h('input', { type: 'checkbox', 'data-i': i }), h('span', { class: 'grid-pick-label' }, it.label), h('span', { class: 'grid-pick-count' }, fmtInt(it.count)));
          lab.firstChild.checked = it.sel;
          inner.appendChild(lab);
        }
      }
      /**
       * Store the selection in its most compact form: everything ticked removes the filter; more than half
       * ticked stores the unticked values as an exclude list (so values that appear later are included);
       * otherwise the ticked values are stored as an include list.
       */
      function commit() {
        const selected = items.filter((it) => it.sel).map((it) => it.v);
        if (selected.length === items.length) setColumnFilter(c.key, { values: null, exclude: null });
        else if (selected.length > items.length / 2) setColumnFilter(c.key, { values: items.filter((it) => !it.sel).map((it) => it.v), exclude: true });
        else setColumnFilter(c.key, { values: selected, exclude: null });
      }
      listEl.addEventListener('scroll', () => draw(false));
      inner.addEventListener('change', (e) => { const i = +e.target.dataset.i; if (!(i >= 0)) return; shown[i].sel = e.target.checked; commit(); });
      search.addEventListener('input', debounce(() => { q = search.value.trim().toLowerCase(); ls = le = -1; filterShown(); }, 120));
      // All / None / Invert act on the searched subset when the picker search is in use.
      const setAll = (fn) => { (q ? shown : items).forEach(fn); commit(); };
      const bar = h('div', { class: 'grid-pick-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onClick: () => setAll((it) => { it.sel = true; }) }, 'All'),
        h('button', { class: 'btn btn-sm', type: 'button', onClick: () => setAll((it) => { it.sel = false; }) }, 'None'),
        h('button', { class: 'btn btn-sm', type: 'button', onClick: () => setAll((it) => { it.sel = !it.sel; }) }, 'Invert'),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Remove this column filter', onClick: () => { closePopover(); removeFilter(c.key); } }, 'Clear'));
      foot.append(summary, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => closePopover() }, 'Done'));
      wrap.append(h('div', { class: 'grid-pop-head' }, h('strong', {}, c.label), h('span', { class: 'muted small' }, 'values')), search, bar, listEl, foot);
      // refresh keeps the popover open across setRows / other filter changes (counts follow the other filters)
      const refresh = () => { const st = listEl.scrollTop; build(); listEl.scrollTop = st; ls = le = -1; draw(true); };
      build();
      openPopover(anchor, wrap, { type: 'values', key: c.key, refresh, cls: 'grid-popover-picker' });
      search.focus();
    }

    /** Column chooser: show / hide, reorder, "only" and freeze, grouped by column group, with a search box. */
    function openChooser(anchor) {
      const wrap = h('div', { class: 'grid-chooser' });
      const search = h('input', { type: 'search', class: 'input grid-pop-search', placeholder: 'Search columns', 'aria-label': 'Search columns' });
      const list = h('div', { class: 'grid-chooser-list' });
      let q = '';
      /** Redraw the chooser list (columns in current order, grouped; the group header is omitted when there is only the default group). */
      function draw() {
        list.innerHTML = '';
        const groups = new Map();
        for (const key of state.order) { const c = colByKey.get(key); if (!c) continue; if (q && !c.label.toLowerCase().includes(q) && !c.group.toLowerCase().includes(q)) continue; if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
        if (!groups.size) list.appendChild(h('div', { class: 'muted small grid-pick-none' }, 'No columns match'));
        for (const [g, cols] of groups) {
          if (groups.size > 1 || g !== 'Columns') list.appendChild(h('div', { class: 'grid-chooser-group' }, g));
          for (const c of cols) {
            const on = state.visible.includes(c.key), pos = state.order.indexOf(c.key), vpos = vis.findIndex((x) => x.key === c.key);
            const cb = h('input', { type: 'checkbox', 'aria-label': 'Show ' + c.label, onChange: (e) => { setVisible(c.key, e.target.checked); draw(); } }); cb.checked = on;
            list.appendChild(h('div', { class: 'grid-chooser-row' + (on ? '' : ' off') + (vpos >= 0 && vpos < state.frozen ? ' frozen' : '') },
              h('label', { class: 'grid-chooser-label', title: c.title || c.label }, cb, h('span', {}, c.label), on && vpos >= 0 && vpos < state.frozen ? h('span', { class: 'badge badge-muted' }, 'frozen') : null, state.filters[c.key] ? h('span', { class: 'badge badge-warn', title: 'A filter is active on this column' }, 'filter') : null),
              h('span', { class: 'grid-chooser-actions' },
                h('button', { class: 'grid-mini', type: 'button', title: 'Move up', disabled: pos <= 0 ? true : null, onClick: () => { moveColumn(c.key, -1); draw(); } }, h('span', { class: 'grid-caret grid-caret-up' })),
                h('button', { class: 'grid-mini', type: 'button', title: 'Move down', disabled: pos >= state.order.length - 1 ? true : null, onClick: () => { moveColumn(c.key, 1); draw(); } }, h('span', { class: 'grid-caret grid-caret-down' })),
                h('button', { class: 'grid-mini grid-mini-text', type: 'button', title: 'Hide all other columns', onClick: () => { hideAllBut(c.key); draw(); } }, 'only'),
                h('button', { class: 'grid-mini grid-mini-text', type: 'button', title: 'Freeze columns up to and including this one', disabled: on ? null : true, onClick: () => { freezeTo(c.key); draw(); } }, 'freeze'))));
          }
        }
      }
      search.addEventListener('input', debounce(() => { q = search.value.trim().toLowerCase(); draw(); }, 120));
      const foot = h('div', { class: 'grid-pick-foot' },
        h('span', {}, h('button', { class: 'btn btn-sm', type: 'button', onClick: () => { state.visible = state.order.slice(); relayout(); draw(); } }, 'Show all'), ' ',
          h('button', { class: 'btn btn-sm', type: 'button', title: 'Unfreeze columns', onClick: () => { state.frozen = 0; relayout(); draw(); } }, 'Unfreeze'), ' ',
          h('button', { class: 'btn btn-sm', type: 'button', title: 'Default columns, order, widths and frozen panes', onClick: () => { resetColumns(); draw(); } }, 'Reset')),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => closePopover() }, 'Done'));
      wrap.append(h('div', { class: 'grid-pop-head' }, h('strong', {}, 'Columns'), h('span', { class: 'muted small' }, `${state.visible.length} of ${columns.length} shown`)), search, list, foot);
      draw();
      openPopover(anchor, wrap, { type: 'chooser', cls: 'grid-popover-chooser', alignRight: true, refresh: draw });
    }

    /** Right-click header menu: sort, filter, width, freeze and visibility actions for one column. */
    function openHeaderMenu(c, anchor) {
      const i = state.sort.findIndex((s) => s.key === c.key);
      const items = [
        { label: 'Sort ascending', active: i >= 0 && state.sort[i].dir === 'asc', onClick: () => setSort([{ key: c.key, dir: 'asc' }]) },
        { label: 'Sort descending', active: i >= 0 && state.sort[i].dir === 'desc', onClick: () => setSort([{ key: c.key, dir: 'desc' }]) },
        { label: 'Add to sort (shift-click)', disabled: !features.multiSort, onClick: () => toggleSort(c.key, true) },
        { label: 'Clear sort', disabled: !state.sort.length, onClick: () => setSort([]) }, '-'];
      if (features.filters) items.push({ label: 'Choose values', icon: 'filter', onClick: () => { const th = filterRow && filterRow.querySelector(`th[data-k="${cssEsc(c.key)}"] .grid-filter-btn`); openValuePicker(c, th || anchor); } },
        { label: 'Clear column filter', disabled: !state.filters[c.key], onClick: () => removeFilter(c.key) }, '-');
      items.push({ label: 'Auto-fit width', onClick: () => autoFit(c) },
        { label: 'Freeze to here', onClick: () => freezeTo(c.key) },
        { label: 'Unfreeze', disabled: !state.frozen, onClick: () => { state.frozen = 0; relayout(); } },
        { label: 'Hide column', onClick: () => setVisible(c.key, false) });
      if (features.chooser) items.push({ label: 'Columns…', icon: 'columns', onClick: () => openChooser(toolbar.querySelector('.btn') || anchor) });
      openPopover(anchor, menu(items), { type: 'menu' });
    }
    /** Footer aggregate menu for one column ('Default' restores a column-supplied total function). */
    function openTotalsMenu(c, anchor) {
      const cur = totalAggOf(c);
      const aggs = c.type === 'text' ? ['count', 'none'] : ['sum', 'avg', 'min', 'max', 'count', 'none'];
      const items = aggs.map((a) => ({ label: AGG_LABEL[a], active: cur === a, onClick: () => { state.totals[c.key] = a; renderTotals(); persist(); emitState(); } }));
      if (typeof c.total === 'function') items.unshift({ label: 'Default', active: cur === 'fn', onClick: () => { delete state.totals[c.key]; renderTotals(); persist(); emitState(); } });
      openPopover(anchor, menu(items), { type: 'menu' });
    }

    /* ---------- events ---------- */
    // Delegated listeners on thead / tbody / tfoot, so re-rendering header or body never needs re-binding.
    // Header click: value-picker button toggles its popover; a header cell sorts (shift-click adds a level).
    thead.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('.grid-resizer')) return;
      const btn = t.closest('.grid-filter-btn');
      if (btn) { const c = colByKey.get(btn.dataset.k); if (c) { if (pop && pop.meta.key === c.key && pop.meta.type === 'values') closePopover(); else openValuePicker(c, btn); } return; }
      if (t.closest('.grid-filters')) return;
      const th = t.closest('th.grid-th'); if (!th) return;
      toggleSort(th.dataset.k, e.shiftKey);
    });
    thead.addEventListener('contextmenu', (e) => {
      if (!features.menu) return;
      const th = e.target.closest('th.grid-th'); if (!th) return;
      e.preventDefault(); const c = colByKey.get(th.dataset.k); if (c) openHeaderMenu(c, th);
    });
    thead.addEventListener('dblclick', (e) => { const rz = e.target.closest('.grid-resizer'); if (rz) { const c = colByKey.get(rz.dataset.k); if (c) autoFit(c); } });
    // Filter inputs apply after 120 ms of no typing (per column); Enter applies at once, Escape clears then blurs.
    const filterTimers = new Map();
    thead.addEventListener('input', (e) => {
      const input = e.target; if (!input.classList.contains('grid-filter-input')) return;
      const key = input.dataset.k, c = colByKey.get(key); if (!c) return;
      clearTimeout(filterTimers.get(key));
      filterTimers.set(key, setTimeout(() => { const v = input.value.trim(); if (c.type === 'text') setColumnFilter(key, { text: v }); else setColumnFilter(key, { expr: v }); }, 120));
    });
    thead.addEventListener('keydown', (e) => {
      const input = e.target; if (!input.classList.contains('grid-filter-input')) return;
      if (e.key === 'Escape') { if (input.value) { input.value = ''; const c = colByKey.get(input.dataset.k); setColumnFilter(input.dataset.k, c && c.type === 'text' ? { text: '' } : { expr: '' }); } else input.blur(); e.stopPropagation(); }
      if (e.key === 'Enter') { clearTimeout(filterTimers.get(input.dataset.k)); const c = colByKey.get(input.dataset.k); const v = input.value.trim(); if (c) setColumnFilter(c.key, c.type === 'text' ? { text: v } : { expr: v }); }
    });
    // Resize drag: width follows the pointer from the drag start; double-click on the handle auto-fits.
    thead.addEventListener('mousedown', (e) => {
      const rz = e.target.closest('.grid-resizer'); if (!rz || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const key = rz.dataset.k, c = colByKey.get(key), startX = e.clientX, startW = widthOf(c);
      const th = rz.closest('th'); th.classList.add('grid-resizing');
      const move = (ev) => { setWidth(key, startW + (ev.clientX - startX)); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); th.classList.remove('grid-resizing'); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    if (features.totals) tfoot.addEventListener('click', (e) => { const btn = e.target.closest('.grid-foot-btn'); if (!btn) return; const c = colByKey.get(btn.dataset.k); if (c) openTotalsMenu(c, btn); });

    /** View position of the body row containing el, or -1. */
    function rowAt(el) { const tr = el && el.closest ? el.closest('tr.grid-row') : null; return tr && tr.dataset.r !== undefined ? +tr.dataset.r : -1; }
    /** Move the keyboard / click cursor to view row k (clamped), optionally scrolling it into view. */
    function setActive(k, scroll) {
      if (k >= viewIdx.length) k = viewIdx.length - 1; if (k < 0) k = viewIdx.length ? 0 : -1;
      activeRow = k;
      for (const tr of pool) tr.classList.toggle('grid-active', +tr.dataset.r === k && tr.style.display !== 'none');
      if (scroll && k >= 0) ensureVisible(k);
    }
    /** Scroll the minimum amount so view row k is fully inside the body area (between sticky header and footer). */
    function ensureVisible(k) {
      const y = k * rowH, vh = scroller.clientHeight - headH - footH;
      if (y < scroller.scrollTop) scroller.scrollTop = y;
      else if (y + rowH > scroller.scrollTop + vh) scroller.scrollTop = y + rowH - vh;
    }
    // Single click selects a row; double-click (or Enter) opens it via opts.onRow. Clicks on links are left alone.
    tbody.addEventListener('click', (e) => { if (e.target.closest('a')) return; const k = rowAt(e.target); if (k >= 0) setActive(k, false); });
    tbody.addEventListener('dblclick', (e) => { if (e.target.closest('a')) return; const k = rowAt(e.target); if (k >= 0 && typeof opts.onRow === 'function') opts.onRow(rows[viewIdx[k]], k); });
    // Keyboard navigation when the scroller itself has focus: arrows, Page Up / Down, Home / End, Enter, Escape.
    scroller.addEventListener('keydown', (e) => {
      if (e.target !== scroller) return;
      const n = viewIdx.length; if (!n) return;
      const page = Math.max(1, Math.floor((scroller.clientHeight - headH - footH) / rowH) - 1);
      let k = activeRow < 0 ? 0 : activeRow, handled = true;
      switch (e.key) {
        case 'ArrowDown': k = Math.min(n - 1, activeRow < 0 ? 0 : activeRow + 1); break;
        case 'ArrowUp': k = Math.max(0, activeRow < 0 ? 0 : activeRow - 1); break;
        case 'PageDown': k = Math.min(n - 1, k + page); break;
        case 'PageUp': k = Math.max(0, k - page); break;
        case 'Home': k = 0; break;
        case 'End': k = n - 1; break;
        case 'Enter': if (activeRow >= 0 && typeof opts.onRow === 'function') opts.onRow(rows[viewIdx[activeRow]], activeRow); break;
        case 'Escape': closePopover(); break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      // Scroll first, render the new window, then re-apply the highlight to the freshly filled pooled rows.
      if (e.key !== 'Enter' && e.key !== 'Escape') { setActive(k, true); renderWindow(false); setActive(k, false); }
    });
    // Scroll: re-render at most once per animation frame; open menus close (they would detach from their anchor).
    let ticking = false;
    scroller.addEventListener('scroll', () => {
      if (pop && (pop.meta.type === 'menu')) closePopover();
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => { ticking = false; if (!destroyed) renderWindow(false); });
    }, { passive: true });
    // Re-measure when the scroller resizes and once web fonts have loaded (both change row and header heights).
    if (typeof ResizeObserver !== 'undefined') { resizeObs = new ResizeObserver(() => { if (!destroyed) scheduleMeasure(); }); resizeObs.observe(scroller); }
    else window.addEventListener('resize', scheduleMeasure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) scheduleMeasure(); }).catch(() => {});

    // document-level: Escape closes popovers, '/' focuses search (bound once for all grids; '/' goes to the
    // first connected grid with a search box, and is ignored while typing in a form field)
    if (!docKeyBound) {
      docKeyBound = true;
      document.addEventListener('keydown', (e) => {
        for (let i = liveGrids.length - 1; i >= 0; i--) if (!liveGrids[i].el.isConnected && liveGrids[i].destroyed) liveGrids.splice(i, 1);
        if (e.key === 'Escape') { for (const g of liveGrids) g.closePopover(); return; }
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const t = e.target, tag = t && t.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
          const g = liveGrids.find((x) => x.el.isConnected && x.search); if (g) { e.preventDefault(); g.search.focus(); g.search.select(); }
        }
      });
    }
    // Register this grid; the list is capped at 40 so grids discarded without destroy() cannot accumulate.
    const live = { el: root, closePopover, search: searchInput, destroyed: false };
    liveGrids.push(live);
    if (liveGrids.length > 40) liveGrids.splice(0, liveGrids.length - 40);

    /* ---------- export ---------- */
    /** Visible rows × visible columns as records keyed by (de-duplicated) column label, using raw export values. */
    function exportRecords() {
      const labels = uniqueLabels(vis.map((c) => c.label));
      const out = [];
      for (let k = 0; k < viewIdx.length; k++) { const row = rows[viewIdx[k]], o = {}; for (let j = 0; j < vis.length; j++) { const c = vis[j]; o[labels[j]] = c.exportValue(c.get(row), row); } out.push(o); }
      return { labels, records: out };
    }
    /** Suffix repeated labels " (2)", " (3)" so CSV headers and record keys stay unique. */
    function uniqueLabels(labels) { const seen = new Map(); return labels.map((l) => { const n = (seen.get(l) || 0) + 1; seen.set(l, n); return n > 1 ? `${l} (${n})` : l; }); }
    /** Download the visible rows and columns as CSV; the UTF-8 BOM makes Excel read € / £ and accents correctly. */
    function exportCsv() {
      const { labels, records } = exportRecords();
      const csv = '\ufeff' + (Scope.csv && Scope.csv.serialize ? Scope.csv.serialize(records, labels) : '');
      let name = opts.exportName || 'grid.csv'; if (!/\.csv$/i.test(name)) name += '.csv';
      if (UI.downloadText) UI.downloadText(name, csv, 'text/csv;charset=utf-8'); else { const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: name }); document.body.appendChild(a); a.click(); a.remove(); }
    }
    /** Visible rows as tab-separated text (tabs / line breaks inside values become spaces) for pasting into Excel. */
    function tsvText() {
      const { labels, records } = exportRecords();
      // Flatten tabs and line breaks so each record stays on one TSV line.
      const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' ');
      return [labels.map(esc).join('\t')].concat(records.map((r) => labels.map((l) => esc(r[l])).join('\t'))).join('\n');
    }
    /** Copy the TSV to the clipboard; falls back to a hidden textarea + execCommand where the async Clipboard API is unavailable (e.g. file://). */
    function copyTsv() {
      const text = tsvText();
      const done = () => { if (UI.toast) UI.toast(`Copied ${fmtInt(viewIdx.length)} rows to the clipboard`); };
      const fallback = () => { const ta = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } }); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove(); if (ok) done(); else if (UI.toast) UI.toast('Copy is not available in this browser', 'warn'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    }

    /* ---------- public API ---------- */
    /** Deep copy of the persistable state (safe to store or mutate). */
    function getState() { return JSON.parse(JSON.stringify({ visible: state.visible, order: state.order, widths: state.widths, frozen: state.frozen, sort: state.sort, filters: state.filters, density: state.density, totals: state.totals, search: state.search })); }
    /** Apply a (partial) state, e.g. a saved view; silent skips persisting and the change callback. */
    function setState(s, silent) {
      state = normaliseState(s, state);
      root.classList.toggle('grid-compact', state.density === 'compact'); rowH = state.density === 'compact' ? 24 : 28;
      if (searchInput && searchInput.value !== state.search) searchInput.value = state.search;
      const st = scroller.scrollTop;
      layoutColumns(); renderAll(); scroller.scrollTop = st;
      if (!silent) { persist(); emitState(); }
    }
    /**
     * Swap in new rows (e.g. platform or currency changed) keeping filters, sort, scroll position, the
     * active row (matched by rowKey), input focus and any open value picker.
     */
    function setRows(next) {
      const st = scroller.scrollTop, key = rowKeyFn && activeRow >= 0 && viewIdx[activeRow] !== undefined ? rowKeyFn(rows[viewIdx[activeRow]]) : undefined;
      const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
      rows = Array.isArray(next) ? next : []; invalidate();
      renderAll();
      if (key !== undefined) { const k = viewIdx.findIndex((i) => rowKeyFn(rows[i]) === key); activeRow = k; } else activeRow = -1;
      scroller.scrollTop = Math.min(st, Math.max(0, viewIdx.length * rowH));
      renderWindow(true); setActive(activeRow, false);
      if (focused && document.activeElement !== focused && focused.isConnected) { try { focused.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      if (pop && pop.meta && pop.meta.refresh) pop.meta.refresh();
    }
    /** Stop observers and timers and close popovers; call when the grid's page is torn down. */
    function destroy() { destroyed = true; live.destroyed = true; closePopover(); if (resizeObs) resizeObs.disconnect(); clearTimeout(persistT); }

    Object.assign(root, {
      setRows, getVisibleRows: () => visibleRows().slice(), getState, setState,
      getFilters, setFilters, clearFilters, setSort, setDensity, setWidth, setVisible, moveColumn, freezeTo, resetColumns,
      refresh: () => { invalidate(); renderAll(); }, exportCsv, copyTsv, tsvText, getColumns: () => vis.slice(), getActiveRow: () => (activeRow >= 0 ? rows[viewIdx[activeRow]] : null), destroy,
      closePopover, openChooser: () => openChooser(toolbar.querySelector('.btn') || root),
    });

    layoutColumns(); renderAll();
    return root;
  };

  /** Local trailing-edge debounce (kept here so grid.js does not depend on load order for Scope.util.debounce). */
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms); }; }

  /* ======================================================================
     Self-check: window.SCOPE_GRID_SELFTEST = true before loading → 50,000 synthetic rows with timings in the console
     ====================================================================== */
  if (hasDOM && global.SCOPE_GRID_SELFTEST) {
    /** Build a 50k-row synthetic grid, then time first render, paint, a 2-level sort, a filter and a deep scroll. */
    const run = () => {
      if (!UI.h) { console.warn('grid self-test: Scope.ui.h missing (load ui.js first)'); return; }
      const N = 50000, sectors = ['Renewables', 'Transport', 'Utilities', 'Digital', 'Social', 'Energy'], ccys = ['EUR', 'GBP', 'USD'], ratings = ['A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'NR'];
      // Park–Miller LCG: deterministic data so timings are comparable between runs.
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const rows = new Array(N);
      for (let i = 0; i < N; i++) rows[i] = { id: i + 1, asset: 'Asset ' + (1 + (i % 240)), sector: sectors[Math.floor(rnd() * sectors.length)], ccy: ccys[Math.floor(rnd() * 3)], rating: rnd() < 0.05 ? '' : ratings[Math.floor(rnd() * ratings.length)], nominal: Math.round(rnd() * 90 + 10) * 1e5, drawn: Math.round(rnd() * 50) * 1e5, margin: Math.round(rnd() * 300 + 80), maturity: new Date(Date.UTC(2026 + Math.floor(rnd() * 20), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28))).toISOString().slice(0, 10) };
      const columns = [
        { key: 'id', label: '#', type: 'number', width: 70, frozen: true, group: 'Identity' }, { key: 'asset', label: 'Asset', frozen: true, group: 'Identity' },
        { key: 'sector', label: 'Sector', group: 'Attributes' }, { key: 'ccy', label: 'Ccy', width: 70, group: 'Attributes' }, { key: 'rating', label: 'Rating', width: 90, group: 'Credit' },
        { key: 'nominal', label: 'Nominal', type: 'number', unit: 'EUR m', format: (v) => (v / 1e6).toFixed(1), total: 'sum', group: 'Amounts' },
        { key: 'drawn', label: 'Drawn', type: 'number', unit: 'EUR m', format: (v) => (v / 1e6).toFixed(1), total: 'sum', group: 'Amounts' },
        { key: 'margin', label: 'Margin', type: 'number', unit: 'bps', total: 'avg', group: 'Terms' }, { key: 'maturity', label: 'Maturity', type: 'date', group: 'Terms' }];
      const t0 = performance.now();
      const g = UI.grid({ columns, rows, rowKey: 'id', height: '420px', exportName: 'grid-selftest.csv' });
      const host = document.getElementById('grid-selftest') || document.body; host.appendChild(g);
      const t1 = performance.now();
      requestAnimationFrame(() => {
        const t2 = performance.now();
        g.setState({ sort: [{ key: 'nominal', dir: 'desc' }, { key: 'asset', dir: 'asc' }] }, true); const t3 = performance.now();
        g.setFilters([{ field: 'sector', op: 'in', value: ['Transport', 'Digital'] }, { field: 'margin', op: 'gte', value: 200 }]); const t4 = performance.now();
        g.scrollTop = 0; g.querySelector('.grid-scroll').scrollTop = 25000 * 28; const t5 = performance.now();
        console.log(`[grid self-test] ${N} rows: build+first render ${(t1 - t0).toFixed(1)} ms, first paint ${(t2 - t1).toFixed(1)} ms, 2-level sort ${(t3 - t2).toFixed(1)} ms, filter ${(t4 - t3).toFixed(1)} ms (${g.getVisibleRows().length} visible), scroll-to-middle ${(t5 - t4).toFixed(1)} ms`);
        global.SCOPE_GRID_SELFTEST_RESULT = { rows: N, build: t1 - t0, paint: t2 - t1, sort: t3 - t2, filter: t4 - t3, visible: g.getVisibleRows().length, grid: g };
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  }
})(typeof window !== 'undefined' ? window : globalThis);
