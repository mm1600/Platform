/* Scope analysis: two periods (or more) side by side (Scope.compare), for the comparison at the foot of the AUM overview.
 *
 * Works on what the AUM calculation already produced for each period (Output rows and their metrics), so it never
 * recalculates anything: key figures with their change, exposure by one dimension, and the asset-by-asset movement
 * (new, exited, up, down). "From" is the earlier period and "to" the later one; every change is to − from.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const num = (v) => (U.isNum(v) ? v : NaN);

  // The key figures compared: metric key, label and kind (m: millions, int: count, bps, yrs, pct: a share, rating).
  const FIGURES = [
    { key: 'total_exposure_m', label: 'Exposure', kind: 'm' },
    { key: 'total_drawn_m', label: 'Drawn', kind: 'm' },
    { key: 'total_undrawn_m', label: 'Undrawn', kind: 'm' },
    { key: 'total_commitment_m', label: 'Commitment', kind: 'm' },
    { key: 'n_assets', label: 'Assets', kind: 'int' },
    { key: 'n_positions', label: 'Positions', kind: 'int' },
    { key: 'w_margin_bps', label: 'Weighted spread', kind: 'bps' },
    { key: 'w_rating_label', label: 'Weighted rating', kind: 'rating', numeric: 'w_rating_numeric' },
    { key: 'w_wal_years', label: 'Weighted WAL', kind: 'yrs' },
    { key: 'fixed_share', label: 'Fixed rate share', kind: 'pct' },
    { key: 'sub_ig_share', label: 'Sub-IG share', kind: 'pct' },
    { key: 'watchlist_share', label: 'Watchlist share', kind: 'pct' },
  ];

  /**
   * Key figures of two periods: [{ key, label, kind, from, to, change, changePct }]. change is to − from (percentage
   * points for shares, notches for the rating, where a positive change is a lower grade); changePct only for amounts.
   */
  function figures(mFrom, mTo) {
    return FIGURES.map((f) => {
      const a = mFrom || {}, b = mTo || {};
      if (f.kind === 'rating') {
        const x = num(a[f.numeric]), y = num(b[f.numeric]);
        return { key: f.key, label: f.label, kind: f.kind, from: a[f.key] || '', to: b[f.key] || '', change: U.isNum(x) && U.isNum(y) ? y - x : NaN, changePct: NaN };
      }
      const x = num(a[f.key]), y = num(b[f.key]), change = U.isNum(x) && U.isNum(y) ? y - x : NaN;
      return { key: f.key, label: f.label, kind: f.kind, from: x, to: y, change, changePct: (f.kind === 'm' || f.kind === 'int') && x ? change / Math.abs(x) : NaN };
    });
  }

  /**
   * Exposure by one dimension in both periods: [{ label, from, to, change, shareFrom, shareTo }], largest first (by
   * the later period, then the earlier). labelOf(row) gives a row's label in that dimension.
   */
  function breakdown(rowsFrom, rowsTo, labelOf) {
    const map = new Map();
    const add = (rows, side) => { for (const r of rows || []) { const k = labelOf(r); const e = map.get(k) || { label: k, from: 0, to: 0 }; e[side] += num(r.exposure_m) || 0; map.set(k, e); } };
    add(rowsFrom, 'from'); add(rowsTo, 'to');
    const tf = U.sum(rowsFrom || [], (r) => num(r.exposure_m) || 0), tt = U.sum(rowsTo || [], (r) => num(r.exposure_m) || 0);
    return Array.from(map.values()).map((e) => Object.assign(e, { change: e.to - e.from, shareFrom: tf ? e.from / tf : NaN, shareTo: tt ? e.to / tt : NaN }))
      .sort((x, y) => y.to - x.to || y.from - x.from || String(x.label).localeCompare(String(y.label)));
  }

  /**
   * Asset by asset (matched on the asset code): [{ code, name, sector, country, from, to, change, status }], biggest
   * movement first. status: 'new' (only in the later period), 'exited' (only in the earlier), 'up', 'down' or 'same'
   * (a change under 0.05m, the precision shown).
   */
  function assets(rowsFrom, rowsTo) {
    const map = new Map();
    const add = (rows, side) => {
      for (const r of rows || []) {
        const e = map.get(r.code) || { code: r.code, name: r.name, sector: r.sector, country: r.country, from: NaN, to: NaN };
        e[side] = (U.isNum(e[side]) ? e[side] : 0) + (num(r.exposure_m) || 0);
        if (side === 'to') Object.assign(e, { name: r.name, sector: r.sector, country: r.country }); // the later name wins
        map.set(r.code, e);
      }
    };
    add(rowsFrom, 'from'); add(rowsTo, 'to');
    return Array.from(map.values()).map((e) => {
      const inFrom = U.isNum(e.from), inTo = U.isNum(e.to), change = (inTo ? e.to : 0) - (inFrom ? e.from : 0);
      const status = !inFrom ? 'new' : !inTo ? 'exited' : Math.abs(change) < 0.05 ? 'same' : change > 0 ? 'up' : 'down';
      return Object.assign(e, { change, status });
    }).sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || String(x.name).localeCompare(String(y.name)));
  }

  /** Count of assets per status: { new, exited, up, down, same } (and between: in a middle period only, with several periods). */
  function counts(list) {
    const c = { new: 0, exited: 0, up: 0, down: 0, same: 0, between: 0 };
    for (const a of list || []) c[a.status]++;
    return c;
  }

  // ---------- any number of periods (the comparison with more periods added), earliest first ----------
  /**
   * Key figures of several periods: [{ key, label, kind, values: [one per period], change, changePct }]; change is the
   * last − the first (as figures() for two).
   */
  function figuresN(Ms) {
    const n = (Ms || []).length;
    return FIGURES.map((f, i) => {
      const two = n ? figures(Ms[0], Ms[n - 1])[i] : { change: NaN, changePct: NaN };
      const values = (Ms || []).map((m) => (f.kind === 'rating' ? (m || {})[f.key] || '' : num((m || {})[f.key])));
      return { key: f.key, label: f.label, kind: f.kind, values, change: two.change, changePct: two.changePct };
    });
  }
  /** Exposure by one dimension in several periods: [{ label, values, shares, change }], largest first by the last period, then the earlier ones. */
  function breakdownN(rowsList, labelOf) {
    const n = (rowsList || []).length, map = new Map();
    rowsList.forEach((rows, i) => { for (const r of rows || []) { const k = labelOf(r); if (!map.has(k)) map.set(k, { label: k, values: new Array(n).fill(0) }); map.get(k).values[i] += num(r.exposure_m) || 0; } });
    const tot = rowsList.map((rows) => U.sum(rows || [], (r) => num(r.exposure_m) || 0));
    const cmp = (x, y) => { for (let i = n - 1; i >= 0; i--) if (y.values[i] !== x.values[i]) return y.values[i] - x.values[i]; return String(x.label).localeCompare(String(y.label)); };
    return Array.from(map.values()).map((e) => Object.assign(e, { shares: e.values.map((v, i) => (tot[i] ? v / tot[i] : NaN)), change: n ? e.values[n - 1] - e.values[0] : 0 })).sort(cmp);
  }
  /**
   * Asset by asset in several periods: [{ code, name, sector, country, values (NaN where the asset is absent), change,
   * status }], status and change between the first and the last period (as assets() for two), biggest movement first.
   */
  function assetsN(rowsList) {
    const n = (rowsList || []).length, map = new Map();
    rowsList.forEach((rows, i) => {
      for (const r of rows || []) {
        if (!map.has(r.code)) map.set(r.code, { code: r.code, name: r.name, sector: r.sector, country: r.country, values: new Array(n).fill(NaN), last: -1 });
        const e = map.get(r.code);
        e.values[i] = (U.isNum(e.values[i]) ? e.values[i] : 0) + (num(r.exposure_m) || 0);
        if (i >= e.last) Object.assign(e, { name: r.name, sector: r.sector, country: r.country, last: i }); // the latest name wins
      }
    });
    return Array.from(map.values()).map((e) => {
      delete e.last;
      const a = e.values[0], b = e.values[n - 1], inA = U.isNum(a), inB = U.isNum(b), change = (inB ? b : 0) - (inA ? a : 0);
      const status = !inA && !inB ? 'between' : !inA ? 'new' : !inB ? 'exited' : Math.abs(change) < 0.05 ? 'same' : change > 0 ? 'up' : 'down';
      return Object.assign(e, { change, status });
    }).sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || String(x.name).localeCompare(String(y.name)));
  }

  Scope.compare = { FIGURES, figures, breakdown, assets, counts, figuresN, breakdownN, assetsN };
})(typeof window !== 'undefined' ? window : globalThis);
