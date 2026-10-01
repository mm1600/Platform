/* Scope core: namespace + utilities.
 *
 * First script loaded by index.html. Creates the global `Scope` namespace (and
 * Scope.version) and registers `Scope.util`: number parsing, date parsing and the
 * workbook's YEARFRAC convention, rating-grade normalisation, display formatters
 * and small collection helpers. Every later core file, engine and module relies on it.
 *
 * Classic script (no ES modules) so the app works when opened from file://; the
 * IIFE takes `window` in the browser and `globalThis` in Node, so the engines and
 * tests can load it unchanged.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  Scope.version = '0.1.0';

  const U = (Scope.util = {});

  /** True only for finite numbers (rejects NaN, ±Infinity and numeric strings). */
  U.isNum = (x) => typeof x === 'number' && isFinite(x);

  /**
   * Lenient numeric parse for CSV cells exported from Excel.
   * Accepts thousands separators, currency symbols (€ £ $), a trailing % (stripped,
   * not divided by 100) and accounting negatives "(1,234)". Returns NaN rather than 0
   * for blanks and junk so callers can raise an issue instead of silently zeroing.
   * @param {*} v
   * @returns {number}
   */
  U.toNumber = function (v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    let s = String(v).trim();
    if (!s) return NaN;
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()\s,]/g, '').replace(/[€£$]/g, '');
    if (s.endsWith('%')) s = s.slice(0, -1);
    const n = Number(s);
    return isNaN(n) ? NaN : neg ? -n : n;
  };

  /**
   * Parse a date cell to a UTC-midnight Date, or null when blank / unparseable.
   * Accepts ISO (yyyy-mm-dd), dd/mm/yyyy, dd.mm.yyyy, mm/dd/yyyy when unambiguous, and
   * five-digit Excel serials. Dates are built in UTC so day arithmetic is timezone-free.
   * @param {*} v
   * @returns {Date|null}
   */
  U.parseDate = function (v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/))) {
      const a = +m[1], b = +m[2], y = +m[3];
      if (a > 12) return mk(y, b, a);           // dd/mm/yyyy
      if (b > 12) return mk(y, a, b);           // mm/dd/yyyy
      return mk(y, b, a);                        // ambiguous: assume dd/mm/yyyy (European extracts)
    }
    if (/^\d{5}$/.test(s)) { // Excel serial: day 0 is 1899-12-30 (absorbs Excel's 1900 leap-year bug)
      const d = new Date(Date.UTC(1899, 11, 30) + (+s) * 86400000);
      return isNaN(d) ? null : d;
    }
    // Last resort: let the JS engine try (e.g. "1 Jan 2027").
    const d = new Date(s);
    return isNaN(d) ? null : d;
    // Build a UTC date from year / 1-based month / day; null if invalid.
    function mk(y, mo, d) { const x = new Date(Date.UTC(y, mo - 1, d)); return isNaN(x) ? null : x; }
  };

  /** Date → 'yyyy-mm-dd' (UTC); '' for null. */
  U.isoDate = (d) => (d ? d.toISOString().slice(0, 10) : '');

  /**
   * Excel YEARFRAC basis 0 (US NASD 30/360), the workbook default, used for remaining
   * years to maturity. The day adjustments below follow Excel's rules in order:
   * both dates last-of-February → end day 30; start last-of-February → start day 30;
   * end 31 with start ≥ 30 → end day 30; start 31 → start day 30.
   * Unlike Excel, the result is signed (end before start gives a negative fraction).
   * @param {Date} start
   * @param {Date} end
   * @returns {number} years, NaN if either date is missing
   */
  U.yearfrac = function (start, end) {
    if (!start || !end) return NaN;
    let d1 = start.getUTCDate(), m1 = start.getUTCMonth() + 1, y1 = start.getUTCFullYear();
    let d2 = end.getUTCDate(), m2 = end.getUTCMonth() + 1, y2 = end.getUTCFullYear();
    // True when d is the last day of February (28th, or 29th in a leap year): day 0 of March.
    const lastFeb = (d) => d.getUTCMonth() === 1 && d.getUTCDate() === new Date(Date.UTC(d.getUTCFullYear(), 2, 0)).getUTCDate();
    if (lastFeb(start) && lastFeb(end)) d2 = 30;
    if (lastFeb(start)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
    return ((y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)) / 360;
  };

  /** Actual/365.25 year difference between two Dates (b − a); NaN if either is missing. */
  U.yearsBetween = (a, b) => (a && b ? (b - a) / (365.25 * 86400000) : NaN);

  /** Date → calendar-quarter caption such as "Q3 2026" (UTC). */
  U.quarterCaption = function (d) {
    if (!d) return '';
    return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + d.getUTCFullYear();
  };

  // Normalise a rating string: trims, collapses spaces/nbsp, unifies dashes ("BBB –" → "BBB-").
  // Case is preserved here; lookups compare case-insensitively (S&P "AA" vs Moody's "Aa1" never collide once a digit is present).
  U.normalizeGrade = function (g) {
    if (g === null || g === undefined) return '';
    return String(g).replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  };

  // ---------- formatting ----------
  // en-GB formatters are built once (Intl construction is relatively costly). Every
  // formatter returns an en dash for non-numbers so blanks never display as "0".
  const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf4 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  U.fmt = {
    int: (x) => (U.isNum(x) ? nf0.format(x) : '–'),
    n1: (x) => (U.isNum(x) ? nf1.format(x) : '–'),
    n2: (x) => (U.isNum(x) ? nf2.format(x) : '–'),
    n4: (x) => (U.isNum(x) ? nf4.format(x) : '–'),
    m: (x) => (U.isNum(x) ? nf1.format(x) : '–'),           // already in millions
    amount: (x) => (U.isNum(x) ? nf0.format(x) : '–'),
    pct: (x, d) => (U.isNum(x) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : '–'),
    bps: (x) => (U.isNum(x) ? nf0.format(x) + ' bps' : '–'),
    yrs: (x) => (U.isNum(x) ? nf1.format(x) + ' y' : '–'),
    date: (d) => (d ? U.isoDate(d) : '–'),
    ccy: (x, c) => (U.isNum(x) ? (c ? c + ' ' : '') + nf1.format(x) + 'm' : '–'),
  };

  /** Escape &, <, > and " for safe insertion into HTML text or attribute values. */
  U.escapeHtml = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- collection and misc helpers ----------
  /** Sum an array, optionally through an accessor f(x). */
  U.sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  /** Group into a Map of key → items, preserving first-seen key order. */
  U.groupBy = function (arr, keyFn) {
    const m = new Map();
    for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  };
  /** Distinct values in first-seen order. */
  U.uniq = (arr) => Array.from(new Set(arr));
  /** Comparator on object property `key`; dir 'desc' reverses. Uses plain < / > (no locale). */
  U.by = (key, dir) => (a, b) => { const x = a[key], y = b[key]; const r = x < y ? -1 : x > y ? 1 : 0; return dir === 'desc' ? -r : r; };
  /** Constrain x to the range [a, b]. */
  U.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  /** Short non-cryptographic unique id (random + timestamp), e.g. for adjustments and DOM ids. */
  U.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  /** Trailing-edge debounce: fn runs once, ms after the last call, with the last call's this / arguments. */
  U.debounce = function (fn, ms) { let t; return function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms); }; };
  /** Lower-case, hyphen-separated slug for ids and file names ("Solar PV / UK" → "solar-pv-uk"). */
  U.slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
})(typeof window !== 'undefined' ? window : globalThis);
