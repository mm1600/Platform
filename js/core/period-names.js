/* Scope core: data-folder period names (Scope.periodNames), shared by the browser (js/core/source.js, a folder picked in
 * the browser) and the server (tools/data-folder.js, the folder named in scope.config.json), so both find the same periods
 * in the same order.
 *
 * A period is a folder up to three levels down that holds a workbook (.xlsx, .xlsm) or sheet CSVs (.csv, .tsv); hidden
 * files and Excel's ~$ lock files are skipped. Periods sort by the date their path names (key), then by name.
 */
(function (global) {
  'use strict';
  const EXT = /\.(xlsx|xlsm|csv|tsv)$/i;
  const MAX_DEPTH = 3, MAX_FOLDERS = 2000; // a deep or huge share stops the scan rather than hanging
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /** Is a file or folder name one to look at (not hidden, not an Excel lock file)? */
  const usable = (name) => !name.startsWith('.') && !name.startsWith('~$');

  /**
   * Where a folder name sits in time, from the words in its path: year (2026, FY26, Q1 26, 3Q26), quarter (Q1, 1Q) and month
   * (March, Mar, 2026-03, 03.2026). Where none of those gives a year, a date written as digits only: 20260930 (YYYYMMDD),
   * 30092026 (DDMMYYYY) or 260930 (YYMMDD; six digits are always read year first). Unknown parts are 0; a quarter folder
   * sorts after its months.
   */
  function key(parts) {
    const s = parts.join(' / ');
    let year = 0, quarter = 0, month = 0;
    const y = /(?:^|[^\d])(20\d{2})(?!\d)/.exec(s) || /\bFY\s?(\d{2})\b/i.exec(s) || /\b[1-4]Q(\d{2})\b/i.exec(s) || /\b(?:Q[1-4]|[A-Za-z]{3,9})[\s\-_'.]+(\d{2})\b/.exec(s);
    if (y) year = y[1].length === 2 ? 2000 + +y[1] : +y[1];
    else {
      const D = '(0[1-9]|[12]\\d|3[01])', M = '(0[1-9]|1[0-2])', at = (re) => new RegExp('(?<!\\d)' + re + '(?!\\d)').exec(s);
      const d8 = at('(20\\d{2})' + M + D), e8 = d8 ? null : at(D + M + '(20\\d{2})'), d6 = d8 || e8 ? null : at('(\\d{2})' + M + D);
      if (d8) { year = +d8[1]; month = +d8[2]; } else if (e8) { year = +e8[3]; month = +e8[2]; } else if (d6) { year = 2000 + +d6[1]; month = +d6[2]; }
    }
    const q = /\bQ([1-4])\b/i.exec(s) || /\b([1-4])Q(?:\d{2})?\b/i.exec(s);
    if (q) quarter = +q[1];
    const last = parts.length ? parts[parts.length - 1] : '';
    if (!month) for (const p of [last, s]) {
      const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(p);
      const n = /\b20\d{2}[-_.](0[1-9]|1[0-2])\b/.exec(p) || /\b(0[1-9]|1[0-2])[-_.]20\d{2}\b/.exec(p);
      if (m) { month = MONTHS.indexOf(m[1].toLowerCase()) + 1; break; }
      if (n) { month = +n[1]; break; }
    }
    if (!quarter && month) quarter = Math.ceil(month / 3);
    return [year, quarter, month || 13];
  }

  /** Compare two periods ({ id, parts }) by time, then by name (natural order: "Month 2" before "Month 10"). */
  function compare(a, b) {
    const ka = key(a.parts), kb = key(b.parts);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
  }

  const api = { EXT, MAX_DEPTH, MAX_FOLDERS, usable, key, compare };
  const Scope = global.Scope || (global.Scope = {});
  Scope.periodNames = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
