/* Scope engine: pivot.
 * Pure cross-tab aggregation over dataset records (js/engine/dataset.js). No DOM, runs in Node.
 *
 * Third engine in the chain aum.js → dataset.js → pivot.js. The Explorer page (layer1-explorer.js)
 * never adds numbers itself: every pivot cell, subtotal, total, chart bar and export row comes from
 * Scope.pivot.run, so figures tie to the AUM page and the Output export. Field definitions (kind,
 * type, agg, weight, perAsset, sortRank, format) come from the dataset's field registry.
 *
 *   Scope.pivot.run({ records, fieldById, rowDims, colDims, values, filters, sort, topN, subtotals, grandTotal })
 *     → { rows, colKeys, colTotals, grandTotal, recordCount, filteredCount, values, rowDims, colDims, dropped, cellCount }
 *   Scope.pivot.applyFilters(records, fieldById, filters) → records
 *   Scope.pivot.distinctValues(records, field, measure?) → [{ value, count, sum? }] by count desc
 *   Scope.pivot.aggregate(records, field, agg?) → number
 *   Scope.pivot.toRecords(result) → flat objects for CSV export
 *
 * Aggregations: sum | wavg (weight = field.weight(rec), default rec.exposure) | avg | count | countDistinct | min | max.
 * A field with perAsset:true is aggregated once per distinct asset_code inside each cell (first record wins).
 * showAs: value | pctOfTotal | pctOfRow | pctOfCol — computed after aggregation; percentages are fractions (0.25 = 25 %).
 * Filter ops (contract): in | notIn | between | contains | gte | lte | eq | neq. Extensions: gt | lt | blank | nonblank | startsWith | notContains.
 * Row/column keys are label paths joined with "|" (matches the UI's collapsed-set convention). Blank labels read "(blank)".
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const P = (Scope.pivot = {});

  // Label used for blank dimension values, and the separator joining label paths into row / column keys.
  const BLANK = '(blank)';
  const SEP = '|';
  P.BLANK = BLANK; P.SEP = SEP;
  const AGGS = ['sum', 'wavg', 'avg', 'count', 'countDistinct', 'min', 'max'];
  P.AGGS = AGGS;
  const isNum = U.isNum;
  /** Blank = '', null, undefined or NaN (zero is a value). */
  const isBlank = (v) => v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v));
  /** Dimension value → group label (blank → "(blank)"). */
  const labelOf = (v) => (isBlank(v) ? BLANK : String(v));

  /** A field given by id (looked up in fieldById) or as a field object; null when unknown. */
  const resolveField = (fieldById, f) => (typeof f === 'string' ? (fieldById && fieldById[f]) || null : f && typeof f === 'object' ? f : null);
  /** Value accessor for a field: its own get(rec) for derived fields, else rec[field.id]. */
  const getter = (field) => (field && typeof field.get === 'function' ? field.get : (r) => r[field.id]);

  // ---------- filters ----------
  // Value lists compare as strings with blanks normalised to "(blank)", so a filter built from
  // pivot labels (drill-through) or from a value picker matches the records it came from.
  const norm = (v) => (isBlank(v) ? BLANK : String(v));
  /** Filter operand → number (operands from URLs / JSON may arrive as strings). */
  const cmpNum = (v) => (typeof v === 'number' ? v : U.toNumber(v));

  /**
   * Compile one { field, op, value } filter into a record predicate.
   * Numeric fields compare numerically and a blank never satisfies a range. Other fields
   * (strings and ISO-date strings) compare lexicographically, which orders yyyy-mm-dd correctly.
   * between accepts [lo, hi], { from, to } or { min, max }; an open end is unbounded.
   * eq / neq with a non-numeric operand on a number field mean "is blank" / "is not blank".
   * Unknown operators match everything rather than throw (a stale saved view still opens).
   */
  function makePredicate(field, flt) {
    const get = getter(field);
    const op = flt.op || 'in';
    const type = (field && field.type) || 'string';
    const numeric = type === 'number';
    const toKey = numeric ? (v) => (isBlank(v) ? BLANK : String(v)) : norm;
    const val = flt.value;
    switch (op) {
      case 'in': { const set = new Set((Array.isArray(val) ? val : [val]).map(toKey)); return (r) => set.has(toKey(get(r))); }
      case 'notIn': { const set = new Set((Array.isArray(val) ? val : [val]).map(toKey)); return (r) => !set.has(toKey(get(r))); }
      case 'contains': { const s = String(val === undefined || val === null ? '' : val).toLowerCase(); return (r) => String(get(r) === null || get(r) === undefined ? '' : get(r)).toLowerCase().indexOf(s) >= 0; }
      case 'notContains': { const s = String(val === undefined || val === null ? '' : val).toLowerCase(); return (r) => String(get(r) === null || get(r) === undefined ? '' : get(r)).toLowerCase().indexOf(s) < 0; }
      case 'startsWith': { const s = String(val === undefined || val === null ? '' : val).toLowerCase(); return (r) => String(get(r) === null || get(r) === undefined ? '' : get(r)).toLowerCase().startsWith(s); }
      case 'blank': return (r) => isBlank(get(r));
      case 'nonblank': return (r) => !isBlank(get(r));
      case 'between': {
        const lo = Array.isArray(val) ? val[0] : (val && val.from !== undefined ? val.from : val && val.min), hi = Array.isArray(val) ? val[1] : (val && val.to !== undefined ? val.to : val && val.max);
        if (numeric) { const a = isBlank(lo) ? -Infinity : cmpNum(lo), b = isBlank(hi) ? Infinity : cmpNum(hi); return (r) => { const v = get(r); return isNum(v) && v >= a && v <= b; }; }
        const a = isBlank(lo) ? '' : String(lo), b = isBlank(hi) ? '￿' : String(hi); // ISO dates and plain strings compare lexicographically
        return (r) => { const v = get(r); if (isBlank(v)) return false; const s = String(v); return s >= a && s <= b; };
      }
      case 'gte': case 'lte': case 'gt': case 'lt': case 'eq': case 'neq': {
        if (numeric) {
          const t = cmpNum(val);
          if (op === 'eq') return (r) => { const v = get(r); return isNum(t) ? v === t : isBlank(v); };
          if (op === 'neq') return (r) => { const v = get(r); return isNum(t) ? v !== t : !isBlank(v); };
          return (r) => { const v = get(r); if (!isNum(v)) return false; return op === 'gte' ? v >= t : op === 'lte' ? v <= t : op === 'gt' ? v > t : v < t; };
        }
        const t = String(val === undefined || val === null ? '' : val);
        if (op === 'eq') return (r) => norm(get(r)) === norm(t);
        if (op === 'neq') return (r) => norm(get(r)) !== norm(t);
        return (r) => { const v = get(r); if (isBlank(v)) return false; const s = String(v); return op === 'gte' ? s >= t : op === 'lte' ? s <= t : op === 'gt' ? s > t : s < t; };
      }
      default: return () => true;
    }
  }

  /** Compile filters into one predicate; unknown fields are ignored (returned in `.dropped`). */
  P.compileFilters = function (fieldById, filters) {
    const preds = [], dropped = [];
    for (const f of filters || []) {
      if (!f || !f.field) continue;
      const field = resolveField(fieldById, f.field);
      if (!field) { dropped.push(typeof f.field === 'string' ? f.field : f.field.id); continue; }
      preds.push(makePredicate(field, f));
    }
    const fn = preds.length === 0 ? () => true : preds.length === 1 ? preds[0] : (r) => { for (let i = 0; i < preds.length; i++) if (!preds[i](r)) return false; return true; };
    fn.dropped = dropped;
    return fn;
  };

  /** Records passing every filter (filters on different fields AND; values within one 'in' list OR). Returns the input array when there are no filters. */
  P.applyFilters = function (records, fieldById, filters) {
    if (!filters || !filters.length) return records;
    const pred = P.compileFilters(fieldById, filters);
    const out = [];
    for (let i = 0; i < records.length; i++) if (pred(records[i])) out.push(records[i]);
    return out;
  };

  /** Parse a grid-style number expression (">100", "<=5", "100..200", "=0", "blank", "nonblank") into a filter fragment. */
  P.parseNumberExpr = function (text) {
    const s = String(text === undefined || text === null ? '' : text).trim().replace(/\s+/g, '');
    if (!s) return null;
    const l = s.toLowerCase();
    if (l === 'blank' || l === 'empty') return { op: 'blank' };
    if (l === 'nonblank' || l === 'notblank' || l === '*') return { op: 'nonblank' };
    let m;
    if ((m = s.match(/^(-?[\d.,]+)\.\.(-?[\d.,]+)$/))) return { op: 'between', value: [U.toNumber(m[1]), U.toNumber(m[2])] };
    if ((m = s.match(/^(>=|<=|<>|!=|>|<|=)(-?[\d.,]+%?)$/))) {
      const v = U.toNumber(m[2]);
      if (!isNum(v)) return null;
      return { op: { '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt', '=': 'eq', '<>': 'neq', '!=': 'neq' }[m[1]], value: v };
    }
    const v = U.toNumber(s);
    return isNum(v) ? { op: 'eq', value: v } : null;
  };

  // ---------- distinct values ----------
  /**
   * Distinct labels of a field with record counts (and the sum of `measure`, e.g. exposure, when
   * given) — feeds the Explorer's filter picker. Sorted by count descending, then natural label
   * order, with "(blank)" last among equal counts.
   */
  P.distinctValues = function (records, field, measure) {
    const get = getter(typeof field === 'string' ? { id: field } : field);
    const mget = measure ? getter(typeof measure === 'string' ? { id: measure } : measure) : null;
    const m = new Map();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const k = labelOf(get(r));
      let e = m.get(k);
      if (!e) { e = { value: k, count: 0 }; if (mget) e.sum = 0; m.set(k, e); }
      e.count++;
      if (mget) { const v = mget(r); if (isNum(v)) e.sum += v; }
    }
    const arr = Array.from(m.values());
    arr.sort((a, b) => b.count - a.count || (a.value === BLANK ? 1 : b.value === BLANK ? -1 : a.value.localeCompare(b.value, undefined, { numeric: true })));
    return arr;
  };

  // ---------- accumulators ----------
  // One accumulator per (cell, value). perAsset accumulators hold a Map asset_code → first record and are finalised lazily,
  // so they can be merged (top-N "Other") without double counting.
  /** Fresh accumulator for one value spec: running sum / count, weighted numerator / denominator, min / max, distinct set or per-asset map. */
  function newAcc(spec) {
    const a = { n: 0, s: 0, num: 0, den: 0, min: Infinity, max: -Infinity, set: null, per: null };
    if (spec.agg === 'countDistinct') a.set = new Set();
    if (spec.perAsset) a.per = new Map();
    return a;
  }
  /**
   * Add a record to an accumulator. perAsset measures (asset-level facts repeated on every position,
   * such as GHG emissions or transaction size) only remember the first record per asset_code, so a
   * cell counts each asset once however many positions it has.
   */
  function accAdd(a, spec, rec) {
    if (spec.perAsset) { const k = rec.asset_code === undefined ? '' : rec.asset_code; if (!a.per.has(k)) a.per.set(k, rec); return; }
    accAddRaw(a, spec, rec);
  }
  /**
   * Fold one record into the accumulator by aggregation type. wavg is Σ(v × w) / Σw with the weight
   * from spec.weight (exposure by default), as the workbook's exposure-weighted margin / WAL / rating;
   * records with a missing value or zero / missing weight are left out of both sums.
   */
  function accAddRaw(a, spec, rec) {
    const v = spec.get(rec);
    switch (spec.agg) {
      case 'sum': if (isNum(v)) a.s += v; a.n++; return;
      case 'wavg': { const w = spec.weight(rec); if (isNum(v) && isNum(w) && w !== 0) { a.num += v * w; a.den += w; a.n++; } return; }
      case 'avg': if (isNum(v)) { a.s += v; a.n++; } return;
      case 'count': if (!isBlank(v)) a.n++; return;
      case 'countDistinct': { const k = spec.distinctKey ? spec.distinctKey(rec) : v; if (!isBlank(k)) a.set.add(k); return; }
      case 'min': if (isNum(v)) { if (v < a.min) a.min = v; a.n++; } return;
      case 'max': if (isNum(v)) { if (v > a.max) a.max = v; a.n++; } return;
      default: return;
    }
  }
  /** Merge accumulator b into a (used to build the top-N "Other" row from the folded siblings). */
  function accMerge(a, b, spec) {
    if (spec.perAsset) { for (const [k, r] of b.per) if (!a.per.has(k)) a.per.set(k, r); return; }
    a.n += b.n; a.s += b.s; a.num += b.num; a.den += b.den; if (b.min < a.min) a.min = b.min; if (b.max > a.max) a.max = b.max;
    if (a.set && b.set) for (const k of b.set) a.set.add(k);
  }
  /** Final value of an accumulator; NaN when nothing numeric was seen (sum and count give 0). perAsset accumulators are replayed into a plain one here. */
  function accValue(a, spec) {
    if (spec.perAsset) { const t = newAcc(Object.assign({}, spec, { perAsset: false })); for (const r of a.per.values()) accAddRaw(t, spec, r); return accValue(t, Object.assign({}, spec, { perAsset: false })); }
    switch (spec.agg) {
      case 'sum': return a.s;
      case 'wavg': return a.den ? a.num / a.den : NaN;
      case 'avg': return a.n ? a.s / a.n : NaN;
      case 'count': return a.n;
      case 'countDistinct': return a.set.size;
      case 'min': return a.n ? a.min : NaN;
      case 'max': return a.n ? a.max : NaN;
      default: return NaN;
    }
  }

  // Default value labels: "Wavg Margin", "Distinct Asset", "Exposure (% of row)", ...
  const AGG_PREFIX = { sum: '', wavg: 'Wavg ', avg: 'Avg ', count: 'Count of ', countDistinct: 'Distinct ', min: 'Min ', max: 'Max ' };
  const SHOWAS_SUFFIX = { pctOfTotal: ' (% of total)', pctOfRow: ' (% of row)', pctOfCol: ' (% of column)' };
  const defaultWeight = (r) => r.exposure; // wavg weight when neither the value spec nor the field names one

  /**
   * Normalise a values[] entry into an aggregation spec. Returns null when the field is unknown.
   * Entry: a field id, or { field, agg?, showAs?, label?, weight?, perAsset? }. The aggregation falls
   * back to the field's default; dimensions can only be counted (count / countDistinct) or take min / max.
   */
  function valueSpec(fieldById, v, i) {
    const field = resolveField(fieldById, typeof v === 'string' ? v : v.field);
    if (!field) return null;
    const o = typeof v === 'string' ? {} : v;
    let agg = o.agg || field.agg || (field.kind === 'dimension' ? 'count' : 'sum');
    if (AGGS.indexOf(agg) < 0) agg = field.kind === 'dimension' ? 'count' : 'sum';
    if (field.kind === 'dimension' && agg !== 'count' && agg !== 'countDistinct' && agg !== 'min' && agg !== 'max') agg = 'count';
    const showAs = o.showAs && SHOWAS_SUFFIX[o.showAs] !== undefined ? o.showAs : 'value';
    const weightField = o.weight ? resolveField(fieldById, o.weight) : null;
    const weight = weightField ? getter(weightField) : typeof field.weight === 'function' ? field.weight : defaultWeight;
    const perAsset = o.perAsset !== undefined ? !!o.perAsset : !!field.perAsset;
    const baseLabel = (AGG_PREFIX[agg] || '') + (field.label || field.id);
    const label = o.label || baseLabel + (SHOWAS_SUFFIX[showAs] || '');
    const isCount = agg === 'count' || agg === 'countDistinct';
    const format = showAs !== 'value' ? (x) => U.fmt.pct(x) : isCount ? (x) => U.fmt.int(x) : typeof field.format === 'function' ? field.format : (x) => U.fmt.n1(x);
    return { index: i, field: field.id, fieldRef: field, agg, showAs, label, format, get: getter(field), weight, perAsset, distinctKey: field.distinctKey, unit: showAs !== 'value' ? 1 : field.unit || 1, unitLabel: showAs !== 'value' ? '%' : field.unitLabel || '' };
  }

  // ---------- label ordering ----------
  // Numeric-aware, case-insensitive collation ("Asset 2" before "Asset 10").
  const collator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
  const localeCmp = (a, b) => (collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);
  /**
   * Comparator for labels of one dimension field: sortRank (if any), then natural locale order; "(blank)" last in both directions.
   * sortRank gives ordinal scales their natural order (rating notches, maturity buckets, workbook column order of
   * investors); labels without a rank follow the ranked ones, and a rank of Infinity is always last.
   */
  P.labelComparator = function (field, dir) {
    const sign = dir === 'desc' ? -1 : 1;
    const rank = field && typeof field.sortRank === 'function' ? field.sortRank : null;
    return (a, b) => {
      const ab = a === BLANK || a === '', bb = b === BLANK || b === '';
      if (ab || bb) return ab && bb ? 0 : ab ? 1 : -1; // blanks last regardless of direction
      if (rank) {
        let ra = rank(a), rb = rank(b);
        const na = !(typeof ra === 'number') || isNaN(ra), nb = !(typeof rb === 'number') || isNaN(rb);
        if (na || nb) { if (na && nb) return sign * localeCmp(a, b); return na ? 1 : -1; }
        if (ra !== rb) { if (ra === Infinity) return 1; if (rb === Infinity) return -1; return sign * (ra < rb ? -1 : 1); }
      }
      return sign * localeCmp(a, b);
    };
  };
  /** Comparator on numbers: NaN/undefined last in both directions. */
  P.valueComparator = function (dir) {
    const sign = dir === 'desc' ? -1 : 1;
    return (a, b) => { const na = !isNum(a), nb = !isNum(b); if (na || nb) return na && nb ? 0 : na ? 1 : -1; return a === b ? 0 : sign * (a < b ? -1 : 1); };
  };

  // ---------- run ----------
  /**
   * Build the cross-tab in one pass over the records.
   * opts: { records, fieldById, rowDims:[id], colDims:[id], values:[id | spec], filters:[{field,op,value}],
   *         sort:{ by:'label'|'value', dir, valueIndex }, topN:{ n, valueIndex }, subtotals, grandTotal }
   * Unknown dimension, value and filter fields are skipped and listed in result.dropped (never thrown).
   * result.rows is depth-first: each group row, its descendants, then its subtotal row (kind 'group' |
   * 'subtotal' | 'total'). Each row has cells[colKey] = [value per spec] and rowTotal; colKeys lists the
   * leaf columns (plus column subtotals) in label order.
   */
  P.run = function (opts) {
    const records = opts.records || [], fieldById = opts.fieldById || {};
    const dropped = [];
    // Resolve a row / column dimension, recording unknown ids in `dropped` instead of failing.
    const dimOf = (id) => { const f = resolveField(fieldById, id); if (!f) dropped.push(typeof id === 'string' ? id : id && id.id); return f; };
    const rowFields = (opts.rowDims || []).map(dimOf).filter(Boolean);
    const colFields = (opts.colDims || []).map(dimOf).filter(Boolean);
    const specs = [];
    (opts.values || []).forEach((v, i) => { const s = valueSpec(fieldById, v, specs.length); if (s) specs.push(s); else dropped.push(typeof v === 'string' ? v : v && v.field); });
    const subtotals = opts.subtotals !== false, grandTotal = opts.grandTotal !== false;
    const sort = opts.sort || { by: 'label', dir: 'asc' };
    const topN = opts.topN && opts.topN.n > 0 ? opts.topN : null;

    const pred = P.compileFilters(fieldById, opts.filters);
    for (const d of pred.dropped) dropped.push(d);
    const R = rowFields.length, C = colFields.length, V = specs.length;
    const rowGet = rowFields.map(getter), colGet = colFields.map(getter);

    // trees: a row tree and a column tree keyed by label at each level. Every record is added to the cell of
    // every ancestor row node × every ancestor column key, so subtotals and totals are aggregated from records
    // (not summed from children) and stay correct for weighted averages, distinct counts and per-asset measures.
    const mkNode = (key, path, level, label) => ({ key, path, level, label, children: new Map(), cells: new Map(), count: 0, kind: 'group' });
    const root = mkNode('', [], -1, ''), colRoot = mkNode('', [], -1, '');
    // Accumulators of a node for one column key (created on first use, one per value spec).
    const cellOf = (node, colKey) => { let c = node.cells.get(colKey); if (!c) { c = new Array(V); for (let i = 0; i < V; i++) c[i] = newAcc(specs[i]); node.cells.set(colKey, c); } return c; };
    const rowNodes = new Array(R + 1), colKeys = new Array(C + 1);
    let filteredCount = 0;
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!pred(rec)) continue;
      filteredCount++;
      // row path nodes (root + one per level)
      rowNodes[0] = root;
      let node = root, key = '';
      for (let l = 0; l < R; l++) {
        const label = labelOf(rowGet[l](rec));
        let child = node.children.get(label);
        if (!child) { key = l === 0 ? label : key + SEP + label; child = mkNode(key, node.path.concat([label]), l, label); node.children.set(label, child); }
        else key = child.key;
        node = child; rowNodes[l + 1] = node;
      }
      // column keys (root + one per level), also registering column nodes for ordering
      colKeys[0] = '';
      let cnode = colRoot, ckey = '';
      for (let l = 0; l < C; l++) {
        const label = labelOf(colGet[l](rec));
        let child = cnode.children.get(label);
        if (!child) { ckey = l === 0 ? label : ckey + SEP + label; child = mkNode(ckey, cnode.path.concat([label]), l, label); cnode.children.set(label, child); }
        else ckey = child.key;
        cnode = child; colKeys[l + 1] = ckey;
      }
      for (let a = 0; a <= R; a++) {
        const n = rowNodes[a]; n.count++;
        for (let b = 0; b <= C; b++) { const cell = cellOf(n, colKeys[b]); for (let v = 0; v < V; v++) accAdd(cell[v], specs[v], rec); }
      }
    }

    // column order: label order per level (depth-first), leaf columns plus optional column subtotals
    const colList = [];
    (function walkCols(n) {
      const cmp = P.labelComparator(colFields[n.level + 1], 'asc');
      const kids = Array.from(n.children.values()).sort((x, y) => cmp(x.label, y.label));
      for (const k of kids) {
        if (k.children.size) { walkCols(k); if (subtotals) colList.push({ key: k.key, path: k.path, label: k.label + ' total', level: k.level, kind: 'subtotal' }); }
        else colList.push({ key: k.key, path: k.path, label: k.label, level: k.level, kind: 'group' });
      }
    })(colRoot);

    // top-N at the deepest row level, folding the remainder into "Other (k)"; the Other node merges the folded
    // siblings' accumulators, so parent subtotals still reconcile to the sum of their visible children.
    const foldOther = (parent) => {
      const kids = Array.from(parent.children.values());
      if (kids.length <= topN.n) return kids;
      const vi = Math.min(Math.max(topN.valueIndex || 0, 0), Math.max(V - 1, 0));
      // Ranking value of a sibling: the chosen value's row total, or the record count when there are no values.
      const val = (n) => (V ? accValue(cellOf(n, '')[vi], specs[vi]) : n.count);
      kids.sort((x, y) => P.valueComparator('desc')(val(x), val(y)));
      const keep = kids.slice(0, topN.n), rest = kids.slice(topN.n);
      const other = mkNode((parent.key ? parent.key + SEP : '') + 'Other', parent.path.concat(['Other (' + rest.length + ')']), parent.level + 1, 'Other (' + rest.length + ')');
      other.other = true; other.folded = rest.length; other.foldedLabels = rest.map((n) => n.label);
      for (const n of rest) {
        other.count += n.count;
        for (const [ck, cell] of n.cells) { const oc = cellOf(other, ck); for (let v = 0; v < V; v++) accMerge(oc[v], cell[v], specs[v]); }
      }
      keep.push(other);
      return keep;
    };

    // row order: sort siblings per parent; top-N applied at the deepest level; Other last
    const sortKids = (kids, level) => {
      const others = kids.filter((k) => k.other), plain = kids.filter((k) => !k.other);
      if (sort.by === 'value' && V) {
        const vi = Math.min(Math.max(sort.valueIndex || 0, 0), V - 1);
        const cmpV = P.valueComparator(sort.dir || 'desc'), cmpL = P.labelComparator(rowFields[level], 'asc');
        plain.sort((x, y) => cmpV(accValue(cellOf(x, '')[vi], specs[vi]), accValue(cellOf(y, '')[vi], specs[vi])) || cmpL(x.label, y.label));
      } else plain.sort((x, y) => P.labelComparator(rowFields[level], sort.dir || 'asc')(x.label, y.label));
      return plain.concat(others);
    };

    // finalise values with show-as: % of grand total, of the row's own total, or of the column's total
    const rawVals = (node, colKey) => { const cell = node.cells.get(colKey); const out = new Array(V); for (let v = 0; v < V; v++) out[v] = cell ? accValue(cell[v], specs[v]) : NaN; return out; };
    const grandRaw = rawVals(root, '');
    const colTotalRaw = {}; for (const c of colList) colTotalRaw[c.key] = rawVals(root, c.key);
    // pct: safe ratio (NaN when the base is missing or zero); showAs: apply each spec's show-as to a vector of raw values.
    const pct = (num, den) => (isNum(num) && isNum(den) && den !== 0 ? num / den : NaN);
    const showAs = (raw, rowRaw, colKey) => raw.map((x, v) => {
      const s = specs[v].showAs;
      if (s === 'pctOfTotal') return pct(x, grandRaw[v]);
      if (s === 'pctOfRow') return pct(x, rowRaw[v]);
      if (s === 'pctOfCol') return pct(x, colKey === '' ? grandRaw[v] : colTotalRaw[colKey] ? colTotalRaw[colKey][v] : NaN);
      return x;
    });
    /** Output row for a node; subtotal rows get key "<path>|__subtotal" and label "<label> total". */
    const emitRow = (node, kind) => {
      const rowRaw = rawVals(node, '');
      const cells = {};
      for (const c of colList) if (node.cells.has(c.key)) cells[c.key] = showAs(rawVals(node, c.key), rowRaw, c.key);
      const rowTotal = showAs(rowRaw, rowRaw, '');
      const row = { key: kind === 'subtotal' ? node.key + SEP + '__subtotal' : node.key, path: node.path, level: node.level, label: kind === 'subtotal' ? node.label + ' total' : kind === 'total' ? 'Grand total' : node.label, kind, cells, rowTotal, count: node.count, raw: rowRaw };
      if (node.other) { row.other = true; row.folded = node.folded; row.foldedLabels = node.foldedLabels; }
      return row;
    };
    const rows = [];
    let nodeCount = 0;
    // Depth-first emission: group row, its children (recursively), then its subtotal.
    (function walk(parent) {
      let kids = Array.from(parent.children.values());
      if (topN && parent.level === R - 2) kids = foldOther(parent);
      kids = sortKids(kids, parent.level + 1);
      for (const k of kids) {
        nodeCount++;
        rows.push(emitRow(k, 'group'));
        if (k.children.size) { walk(k); if (subtotals) rows.push(emitRow(k, 'subtotal')); }
      }
    })(root);
    if (grandTotal) rows.push(emitRow(root, 'total'));
    const grandRow = emitRow(root, 'total');
    const colTotals = {}; for (const c of colList) colTotals[c.key] = grandRow.cells[c.key] || new Array(V).fill(NaN);

    return {
      rows, colKeys: colList, colTotals, grandTotal: grandRow.rowTotal, recordCount: records.length, filteredCount,
      values: specs.map((s) => ({ field: s.field, agg: s.agg, label: s.label, format: s.format, showAs: s.showAs, unit: s.unit, unitLabel: s.unitLabel, perAsset: s.perAsset })),
      rowDims: rowFields.map((f) => ({ id: f.id, label: f.label })), colDims: colFields.map((f) => ({ id: f.id, label: f.label })),
      dropped, nodeCount, cellCount: rows.length * Math.max(1, colList.length + 1) * Math.max(1, V), subtotals, grandTotalOn: grandTotal,
    };
  };

  // ---------- aggregate over a flat set ----------
  /** One aggregate over a record set with the same rules as run() (e.g. the Explorer summary line and tie-out badge). */
  P.aggregate = function (records, field, agg, fieldById) {
    const f = typeof field === 'string' ? (fieldById && fieldById[field]) || { id: field } : field;
    const spec = valueSpec({ [f.id]: f }, { field: f.id, agg }, 0);
    if (!spec) return NaN;
    const a = newAcc(spec);
    for (let i = 0; i < records.length; i++) accAdd(a, spec, records[i]);
    return accValue(a, spec);
  };

  // ---------- export ----------
  /** Suffix repeated header names " (2)", " (3)" so CSV columns stay distinct. */
  const uniqueHeaders = (names) => { const seen = new Map(); return names.map((n) => { const k = n; if (!seen.has(k)) { seen.set(k, 1); return n; } const c = seen.get(k) + 1; seen.set(k, c); return n + ' (' + c + ')'; }); };
  /**
   * Flatten a run() result for CSV: a 'kind' column (group / subtotal / total) so totals can be filtered
   * out in Excel, one column per row dimension, then one column per column-key × value plus a total per
   * value. Numbers stay raw (millions, fractions for percentages). The header list is attached as .headers.
   */
  P.toRecords = function (result) {
    const rowDims = result.rowDims || [], values = result.values || [], colKeys = result.colKeys || [];
    const names = ['kind'].concat(rowDims.map((d) => d.label));
    if (!rowDims.length) names.push('Row');
    for (const v of values) { for (const c of colKeys) names.push(v.label + ' | ' + c.label); names.push(colKeys.length ? v.label + ' | Total' : v.label); }
    const H = uniqueHeaders(names);
    const out = [];
    for (const r of result.rows) {
      const o = {}; let i = 0;
      o[H[i++]] = r.kind;
      if (rowDims.length) for (let l = 0; l < rowDims.length; l++) o[H[i++]] = r.kind === 'total' ? (l === 0 ? 'Grand total' : '') : l < r.path.length ? (l === r.path.length - 1 && r.kind === 'subtotal' ? r.label : r.path[l]) : '';
      else o[H[i++]] = r.label;
      values.forEach((v, vi) => {
        for (const c of colKeys) { const cell = r.cells[c.key]; o[H[i++]] = cell && isNum(cell[vi]) ? cell[vi] : ''; }
        o[H[i++]] = isNum(r.rowTotal[vi]) ? r.rowTotal[vi] : '';
      });
      out.push(o);
    }
    out.headers = H;
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
