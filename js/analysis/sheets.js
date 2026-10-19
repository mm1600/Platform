/* Scope · custom sheets (js/analysis/sheets.js): a sheet definition → headers and rows, from the dataset fields.
 *
 * A custom sheet is { name, grain: 'assets' | 'positions', columns: [{ id, header }], includeExcluded }. The columns are
 * dataset field ids (js/analysis/dataset.js: every named field and every raw sheet column); the header is the user's
 * own heading for the column, or the field's label. Rows are the current result's records of that grain (the selected
 * view, currency and global filters), so the sheet shows what every page shows. No DOM: the same rows are written to
 * .xlsx / CSV on the Custom sheets page and checked in Node.
 *
 *   Scope.sheets.build(res, def) → { headers, rows (display text), values (export values: numbers in the field's unit), fields }
 *   Scope.sheets.PRESETS          starting column sets
 */
(function (global) {
  'use strict';
  const Scope = (global.Scope = global.Scope || {});
  const U = Scope.util;
  const SH = (Scope.sheets = {});
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  SH.PRESETS = {
    'Output sheet (standard)': { grain: 'assets', columns: ['rank', 'asset_code', 'asset_name', 'sector', 'subsector', 'country', 'currency', 'rating', 'ig_label', 'fixed_floating', 'repayment_type', 'maturity_date', 'remaining_years', 'exposure', 'exposure_drawn', 'drawn_pct', 'nominal', 'attributed', 'margin_bps', 'wal_years', 'watchlist', 'sponsor'] },
    'Credit view': { grain: 'assets', columns: ['rank', 'asset_name', 'sector', 'country', 'rating', 'internal_grade', 'external_grade', 'ig_label', 'watchlist', 'covenant_compliance', 'maturity_date', 'remaining_years', 'margin_bps', 'exposure'] },
    'Positions (one per Holdings row)': { grain: 'positions', columns: ['asset_code', 'asset_name', 'investor_label', 'investor_group', 'tranche', 'currency', 'nominal', 'drawn', 'undrawn', 'exposure', 'rating', 'maturity_date', 'margin_bps', 'excluded'] },
  };

  /** Headers, display rows and export values of a sheet definition on a result. */
  SH.build = function (res, def) {
    const DS = Scope.engine && Scope.engine.dataset; if (!DS) throw new Error('the dataset layer is not loaded');
    const grain = def.grain === 'positions' ? 'positions' : 'assets';
    const ds = grain === 'positions' ? DS.build(res) : DS.buildAssets(res);
    const cols = (def.columns || []).map((c) => (typeof c === 'string' ? { id: c } : c)).map((c) => Object.assign({}, c, { field: ds.fieldById[c.id] })).filter((c) => c.field);
    let records = ds.records;
    if (grain === 'positions' && !def.includeExcluded) records = records.filter((r) => r.excluded !== 'Yes');
    const headers = cols.map((c) => { const f = c.field; const unit = f.kind === 'measure' && f.unitLabel ? ` (${f.unitLabel})` : ''; return (c.header && String(c.header).trim()) || f.label + unit; });
    const rows = records.map((r) => cols.map((c) => { const v = c.field.get(r); return c.field.format ? c.field.format(v) : (v === null || v === undefined ? '' : String(v)); }));
    const values = records.map((r) => cols.map((c) => { const f = c.field, v = f.get(r); if (f.kind === 'measure') return isNum(v) ? (f.unit && f.unit !== 1 ? +(v / f.unit).toFixed(6) : v) : null; if (v instanceof Date) return U.isoDate(v); if (f.type === 'date' && v) { const d = U.parseDate(v); return d ? U.isoDate(d) : String(v); } return v === null || v === undefined ? null : typeof v === 'number' ? v : String(v); }));
    return { headers, rows, values, fields: cols.map((c) => c.field), grain, count: records.length, missing: (def.columns || []).map((c) => (typeof c === 'string' ? c : c.id)).filter((id) => !ds.fieldById[id]) };
  };

  /** The .xlsx bytes of a sheet (one tab named after it). */
  SH.toXlsx = function (res, def) {
    const b = SH.build(res, def), write = Scope.inputs && Scope.inputs.writeXlsx; if (!write) throw new Error('the workbook writer is not loaded');
    const name = String(def.name || 'Custom sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    return write({ [name]: { name, rows: [b.headers].concat(b.values) } });
  };
})(typeof window !== 'undefined' ? window : globalThis);
