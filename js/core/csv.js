/* Scope core: CSV parse/serialise (RFC 4180-ish, BOM + CRLF tolerant).
 *
 * Registers `Scope.csv` with parse() and serialize(). CSV files are the integration
 * boundary of the app: every input table (one per workbook sheet, see data/SCHEMA.md)
 * arrives through CSV.parse via the store, and every export (Output, grids, pivot)
 * leaves through CSV.serialize. Loaded second by index.html, after util.js; also
 * loads in Node for the tests.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const CSV = (Scope.csv = {});

  /**
   * Parse CSV text with a header row.
   * Character-by-character state machine: quoted fields may contain commas, newlines
   * and doubled quotes (""); bare \r is ignored so CRLF and LF files parse alike; a
   * leading UTF-8 BOM (Excel's "CSV UTF-8" export) is dropped. Headers and cells are trimmed.
   * @param {string} text
   * @returns {{headers: string[], rows: string[][], records: (Object<string,string>|null)[]}}
   *   rows: raw data rows (header excluded); records: one object per data row keyed by
   *   header, or null for an all-blank row so that index + 2 is still the file line number.
   */
  CSV.parse = function (text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], field = '', i = 0, inQ = false;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      // Inside quotes: "" is an escaped quote, a lone " closes the field; everything else is literal.
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    // Flush the last row when the file does not end with a newline.
    if (field.length || row.length) { row.push(field); rows.push(row); }
    // drop fully blank trailing rows
    while (rows.length && rows[rows.length - 1].every((x) => x.trim() === '')) rows.pop();
    if (!rows.length) return { headers: [], rows: [], records: [] };
    const headers = rows[0].map((h) => h.trim());
    const records = [];
    for (let r = 1; r < rows.length; r++) {
      const src = rows[r];
      if (src.every((x) => String(x).trim() === '')) { records.push(null); continue; } // padding row → null (kept for line numbering)
      const o = {};
      headers.forEach((h, k) => { o[h] = (src[k] === undefined ? '' : src[k]).trim(); });
      records.push(o);
    }
    return { headers, rows: rows.slice(1), records };
  };

  /**
   * Serialise records to CSV text (LF line endings, trailing newline).
   * Fields containing a quote, comma or line break are quoted with quotes doubled;
   * Dates become yyyy-mm-dd; null / undefined become empty cells.
   * @param {Object[]} records
   * @param {string[]} [headers] column order; defaults to the keys of the first record
   * @returns {string}
   */
  CSV.serialize = function (records, headers) {
    headers = headers || (records.length ? Object.keys(records[0]) : []);
    // One cell: null → '', Date → ISO day, otherwise quoted only when needed.
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const out = [headers.map(esc).join(',')];
    for (const r of records) out.push(headers.map((h) => esc(r[h])).join(','));
    return out.join('\n') + '\n';
  };
})(typeof window !== 'undefined' ? window : globalThis);
