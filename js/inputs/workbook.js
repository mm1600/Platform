/* Scope inputs: read the AUM workbook, sheet by sheet, into plain cell grids.
 *
 * Registers `Scope.inputs`. The AUM inputs are four sheets of an Excel workbook (Scope.inputs.SHEETS).
 * Users can drop the .xlsx / .xlsm workbook itself, drop one CSV or TSV file per sheet, or paste a
 * range copied from Excel. Whatever the source, the result is a grid addressed like Excel:
 *
 *   Grid = { name, rows }    rows[r][c] is the cell at Excel row r + 1, column c + 1 (rows[0][0] is A1)
 *
 * Rows are ragged and end at their last non-blank cell, a blank row is [], and a blank cell is null
 * (an empty text cell counts as blank, as Excel's own CSV export cannot tell them apart). xlsx numeric
 * cells stay JS numbers (dates as Excel serial numbers, styles are not read); text from CSV or a paste
 * is kept exactly as typed. Booleans become 'TRUE' / 'FALSE' and error cells their error text ('#N/A').
 * This file holds no business logic: deciding which header means what belongs to the caller.
 *
 * The xlsx reader is a small zip reader (stored and deflate entries, data descriptors) plus string
 * scanning of the SpreadsheetML parts rather than a DOM parser, so a 2,000 x 220 sheet reads in well
 * under a second. Deflate uses DecompressionStream('deflate-raw') (current browsers, Node 18+),
 * falling back to Node's zlib. writeXlsx() produces a minimal uncompressed workbook that Excel and
 * LibreOffice open, and gridToCsv() a CSV that parseText() reads back.
 *
 * Classic script, no dependencies; the IIFE takes `window` in the browser and `globalThis` in Node.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const IN = (Scope.inputs = Scope.inputs || {});

  /** The four workbook sheets the AUM inputs come from, in their canonical spelling. */
  IN.SHEETS = Object.freeze(['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded']);
  // Optional sheets: read when present, never reported missing ('Scope Settings' holds names, groups, views, look-through).
  IN.OPTIONAL_SHEETS = Object.freeze(['Scope Settings']);

  // ---------- Excel coordinates ----------

  /** 0-based column index → Excel column letters (0 → 'A', 25 → 'Z', 26 → 'AA', 702 → 'AAA'); '' if invalid. */
  IN.colName = function (index0) {
    let n = Math.floor(Number(index0)) + 1, s = '';
    if (!(n >= 1) || !isFinite(n)) return '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; }
    return s;
  };

  /** Excel column letters → 0-based index ('A' → 0, 'AB' → 27), case-insensitive; -1 if not letters. */
  IN.colIndex = function (letters) {
    const s = String(letters === null || letters === undefined ? '' : letters).trim().toUpperCase();
    if (!/^[A-Z]+$/.test(s)) return -1;
    let n = 0;
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  };

  /** 0-based row and column → A1-style reference (cellRef(11, 27) → 'AB12'). */
  IN.cellRef = (r0, c0) => IN.colName(c0) + (Math.floor(r0) + 1);

  /** A1-style reference ('AB12', '$AB$12') → { r, c } 0-based; null if it is not a single-cell reference. */
  IN.parseRef = function (ref) {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?([1-9]\d*)\s*$/.exec(String(ref === null || ref === undefined ? '' : ref));
    return m ? { r: +m[2] - 1, c: IN.colIndex(m[1]) } : null;
  };

  const COLS = [];
  /** Memoised colName for the writer's hot loop. */
  const col = (c) => COLS[c] || (COLS[c] = IN.colName(c));

  // ---------- sheet names ----------

  // Separators ignored when comparing names: whitespace (including non-breaking), underscore, hyphens and dashes.
  const SEP = /[\s_\-\u2010-\u2015]/;
  const SEP_ALL = /[\s_\-\u2010-\u2015]+/g;
  /** Comparison form of a name: lower case without separators ('ESG_Hardcoded ' → 'esghardcoded'). */
  const normName = (s) => String(s).toLowerCase().replace(SEP_ALL, '');
  // Canonical names longest first, so a suffix match prefers 'ESG Hardcoded' over 'Hardcoded'.
  const CANON = IN.SHEETS.concat(IN.OPTIONAL_SHEETS).map((name) => ({ name, key: normName(name) })).sort((a, b) => b.key.length - a.key.length);
  const TEXT_EXT = /\.(csv|tsv|tab|txt)$/i;

  /**
   * Canonical sheet name for a workbook tab or a per-sheet file name, or null.
   * Tab names must match exactly once case, spaces, underscores and hyphens are ignored ('esg_hardcoded',
   * 'ESGHardcoded' → 'ESG Hardcoded'; 'Old Holdings' → null). File names (.csv, .tsv, .tab, .txt) may carry
   * a prefix: the base name must end with a sheet name that starts at a word boundary ('My workbook -
   * Holdings.csv', 'AUM_ESG_Hardcoded.csv', 'Holdings (1).csv' match; 'Shareholdings.csv' does not), and the
   * longest match wins.
   * @param {string} name
   * @returns {string|null}
   */
  IN.sheetKey = function (name) {
    if (name === null || name === undefined) return null;
    const s = String(name).trim();
    const k = normName(s);
    if (!k) return null;
    for (const c of CANON) if (c.key === k) return c.name;
    if (!TEXT_EXT.test(s)) return null;
    // File name: drop folders, the extension and a browser copy marker such as " (1)".
    const base = s.replace(/^.*[\\/]/, '').replace(TEXT_EXT, '').replace(/\s*\(\d+\)$/, '');
    let nb = '';
    const at = []; // at[i] = position in `base` of the i-th character of `nb`
    for (let i = 0; i < base.length; i++) { if (!SEP.test(base[i])) { nb += base[i].toLowerCase(); at.push(i); } }
    for (const c of CANON) {
      if (!nb.endsWith(c.key)) continue;
      const start = nb.length - c.key.length;
      if (start === 0) return c.name;
      const prev = base[at[start] - 1], cur = base[at[start]];
      // Word boundary: a separator or punctuation before the name, or a lower-to-upper case change ('BookHoldings').
      if (!/[A-Za-z0-9]/.test(prev) || (/[a-z0-9]/.test(prev) && /[A-Z]/.test(cur))) return c.name;
    }
    return null;
  };

  // ---------- delimited text (CSV, TSV, Excel clipboard) ----------

  /**
   * Parse a CSV / TSV file or a range pasted from Excel into a grid.
   * The delimiter is detected on the first record that has one, ignoring quoted text: a tab means TSV (the
   * Excel clipboard format), else a comma, else a semicolon (European Excel CSV). Quoted fields may hold
   * delimiters, line breaks and doubled quotes as Excel writes them; a quote inside an unquoted field, or a
   * quoted field that does not close properly, is kept as literal text. A UTF-8 BOM is dropped, CRLF, LF and
   * old Mac CR line endings are accepted, and cell text is kept exactly apart from a trailing \r.
   * @param {string} text
   * @param {{origin?: string, delimiter?: string, name?: string}} [opts] origin: Excel cell where the first
   *   pasted cell lands (default 'A1'; 'C3' prepends two blank rows and two blank columns).
   * @returns {{name: string, rows: Array<Array<string|null>>}}
   */
  IN.parseText = function (text, opts) {
    opts = opts || {};
    let s = text === null || text === undefined ? '' : String(text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    if (s.indexOf('\n') < 0 && s.indexOf('\r') >= 0) s = s.replace(/\r/g, '\n'); // classic Mac line endings
    const origin = IN.parseRef(opts.origin || 'A1');
    if (!origin) throw new Error(`Paste origin "${opts.origin}" is not a cell reference such as C3.`);
    const rows = tidy(splitDelimited(s, opts.delimiter || detectDelimiter(s)));
    return { name: opts.name || '', rows: shift(rows, origin.r, origin.c) };
  };

  /** Delimiter of delimited text: tab, else comma, else semicolon, judged on the first record (of up to 50) that has any; quoted text is skipped. */
  function detectDelimiter(s) {
    const n = s.length;
    let i = 0;
    for (let rec = 0; rec < 50 && i < n; rec++) {
      let tabs = 0, commas = 0, semis = 0, start = true;
      while (i < n) {
        const ch = s.charCodeAt(i);
        if (start && ch === 34) { // quoted field: jump past its closing quote
          let j = i + 1;
          for (;;) {
            const q = s.indexOf('"', j);
            if (q < 0) { j = -1; break; } // never closes: the parser keeps it as literal text
            if (s.charCodeAt(q + 1) === 34) { j = q + 2; continue; }
            j = q + 1; break;
          }
          start = false;
          if (j > 0) { i = j; continue; }
        }
        i++;
        if (ch === 10) break;
        start = ch === 9 || ch === 44 || ch === 59;
        if (ch === 9) tabs++; else if (ch === 44) commas++; else if (ch === 59) semis++;
      }
      if (tabs) return '\t';
      if (commas) return ',';
      if (semis) return ';';
    }
    return ',';
  }

  /** Split delimited text into rows of raw string fields; quoting as RFC 4180 / Excel, lenient with stray quotes. */
  function splitDelimited(s, delim) {
    const rows = [], n = s.length, D = delim.charCodeAt(0);
    if (!n) return rows;
    let row = [], i = 0, nextD = -1, nextNL = -1;
    // End of an unquoted field starting at `from`: the next delimiter or line feed (positions cached between fields).
    const stop = (from) => {
      if (nextD < from) { nextD = s.indexOf(delim, from); if (nextD < 0) nextD = n; }
      if (nextNL < from) { nextNL = s.indexOf('\n', from); if (nextNL < 0) nextNL = n; }
      return nextD < nextNL ? nextD : nextNL;
    };
    for (;;) {
      let val = '', end = -1, quoted = false;
      if (s.charCodeAt(i) === 34) {
        let j = i + 1, buf = '';
        for (;;) {
          const q = s.indexOf('"', j);
          if (q < 0) break;
          if (s.charCodeAt(q + 1) === 34) { buf += s.slice(j, q + 1); j = q + 2; continue; }
          buf += s.slice(j, q);
          const a = q + 1, ch = s.charCodeAt(a);
          // A closing quote must be followed by a delimiter, a line break or the end of the text.
          if (a >= n || ch === D || ch === 10 || (ch === 13 && (a + 1 >= n || s.charCodeAt(a + 1) === 10))) { val = buf; end = a; quoted = true; }
          break;
        }
        if (!quoted) { end = stop(i); val = s.slice(i, end); } // not a well-formed quoted field: keep it literally
      } else {
        end = stop(i); val = s.slice(i, end);
      }
      let ch = end < n ? s.charCodeAt(end) : -1;
      if (ch === 13) { end++; ch = end < n ? s.charCodeAt(end) : -1; } // CRLF (or a final CR) after a quoted field
      else if (!quoted && ch !== D && val.charCodeAt(val.length - 1) === 13) val = val.slice(0, -1); // CRLF line ending
      row.push(val);
      if (ch === D) {
        i = end + 1;
        if (i >= n) { row.push(''); rows.push(row); break; } // trailing delimiter: one more (empty) field
        continue;
      }
      rows.push(row); row = [];
      i = end + 1;
      if (ch === -1 || i >= n) break;
    }
    return rows;
  }

  /** Normalise raw rows in place: '' → null, trailing blanks trimmed from each row, trailing blank rows dropped. */
  function tidy(rows) {
    for (const row of rows) {
      let last = -1;
      for (let c = 0; c < row.length; c++) { if (row[c] === '' || row[c] === undefined) row[c] = null; else last = c; }
      row.length = last + 1;
    }
    let len = rows.length;
    while (len && !rows[len - 1].length) len--;
    rows.length = len;
    return rows;
  }

  /** Offset a block of rows so its first cell lands at 0-based (r0, c0): blank rows above, null cells to the left. */
  function shift(rows, r0, c0) {
    if (!r0 && !c0) return rows;
    const out = [];
    for (let r = 0; r < r0; r++) out.push([]);
    const pad = new Array(c0).fill(null);
    for (const row of rows) out.push(row.length && c0 ? pad.concat(row) : row);
    return out;
  }

  /**
   * Serialise a grid (or a bare rows array) to CSV: RFC 4180, CRLF line endings, a field is quoted when it
   * holds a quote, comma, semicolon, tab or line break (so delimiter detection cannot be misled), and null is
   * an empty field. parseText() reads the result back to the same rows (numbers come back as their text).
   * @param {{rows: Array<Array<*>>}|Array<Array<*>>} grid
   * @returns {string}
   */
  IN.gridToCsv = function (grid) {
    const rows = Array.isArray(grid) ? grid : (grid && grid.rows) || [];
    const lines = [];
    for (const row of rows) {
      const cells = [];
      for (let c = 0; c < (row ? row.length : 0); c++) cells.push(csvCell(row[c]));
      lines.push(cells.join(','));
    }
    return lines.length ? lines.join('\r\n') + '\r\n' : '';
  };

  /** One CSV field: blank for null, TRUE / FALSE for booleans, yyyy-mm-dd for Dates, quoted when needed. */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    const s = v instanceof Date ? (isNaN(v) ? '' : v.toISOString().slice(0, 10)) : String(v);
    return /[",;\t\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- zip archives ----------

  /** Little-endian unsigned 16-bit read. */
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  /** Little-endian unsigned 32-bit read. */
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const UTF8 = new TextDecoder('utf-8');
  /** UTF-8 bytes → string (a leading BOM is dropped). */
  const utf8 = (bytes) => UTF8.decode(bytes);

  /** ArrayBuffer / typed array / Node Buffer → Uint8Array view (no copy). */
  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data && ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new TypeError('Expected an ArrayBuffer or Uint8Array.');
  }

  /**
   * Index a zip archive from its central directory: lower-cased entry path → { name, flags, method, csize,
   * usize, off }. Sizes come from the central directory, so entries written with data descriptors (sizes
   * only after the data) read correctly. ZIP64 archives are refused with a clear message.
   */
  function zipIndex(b) {
    if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
      throw new Error('this is a password-protected workbook or an old .xls file; remove the password or save it as .xlsx');
    }
    let e = -1;
    for (let i = b.length - 22, lo = Math.max(0, b.length - 22 - 65535); i >= lo; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { e = i; break; }
    }
    if (e < 0) throw new Error('not a valid .xlsx file (no zip directory found)');
    const count = u16(b, e + 10), cdOff = u32(b, e + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error('ZIP64 workbooks are not supported; re-save the file in Excel');
    const map = new Map();
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error('corrupt zip directory');
      const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32);
      const name = utf8(b.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/');
      map.set(name.replace(/^\/+/, '').toLowerCase(), {
        name, flags: u16(b, p + 8), method: u16(b, p + 10), csize: u32(b, p + 20), usize: u32(b, p + 24), off: u32(b, p + 42),
      });
      p += 46 + nl + xl + cl;
    }
    return map;
  }

  /** Uncompressed bytes of one zip entry (stored or deflate). */
  async function zipRead(b, ent) {
    const o = ent.off;
    if (o + 30 > b.length || u32(b, o) !== 0x04034b50) throw new Error(`corrupt zip entry ${ent.name}`);
    if (ent.flags & 1) throw new Error('the workbook is encrypted');
    const start = o + 30 + u16(b, o + 26) + u16(b, o + 28);
    if (start + ent.csize > b.length) throw new Error(`the file is truncated (${ent.name})`);
    const raw = b.subarray(start, start + ent.csize);
    if (ent.method === 0) return raw;
    if (ent.method === 8) return inflateRaw(raw);
    throw new Error(`unsupported compression method ${ent.method} in ${ent.name}`);
  }

  let zlibMod;
  /** Node's zlib module when running under Node, else null (loaded once). */
  function nodeZlib() {
    if (zlibMod === undefined) {
      try { zlibMod = typeof require === 'function' ? require('zlib') : null; } catch (e) { zlibMod = null; }
    }
    return zlibMod;
  }

  /** Inflate raw deflate data: DecompressionStream('deflate-raw') where available, else Node's zlib. */
  async function inflateRaw(bytes) {
    let streamError = null;
    if (typeof DecompressionStream === 'function') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const w = ds.writable.getWriter();
        w.write(bytes).catch(() => {});
        w.close().catch(() => {});
        return await readAll(ds.readable);
      } catch (e) { streamError = e; }
    }
    const z = nodeZlib();
    if (z) return new Uint8Array(z.inflateRawSync(bytes));
    if (streamError) throw new Error('the workbook data could not be decompressed (' + streamError.message + ')');
    throw new Error('this browser cannot open .xlsx files; use a current Chrome, Edge, Firefox or Safari, or drop one CSV per sheet');
  }

  /** Read a ReadableStream of byte chunks into one Uint8Array. */
  async function readAll(stream) {
    const reader = stream.getReader(), parts = [];
    let len = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); len += value.length;
    }
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // CRC-32 (IEEE 802.3) lookup table, built once.
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();

  /** CRC-32 checksum of a byte array, as zip archives record it (unsigned 32-bit). */
  IN.crc32 = function (bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  /** Zip archive (every entry STORED, UTF-8 names) from [{ name, data: Uint8Array }]. */
  function zipStore(files) {
    const enc = new TextEncoder();
    const items = files.map((f) => ({ name: enc.encode(f.name), data: f.data, crc: IN.crc32(f.data) }));
    let total = 22;
    for (const it of items) total += 30 + 46 + 2 * it.name.length + it.data.length;
    if (total > 0xffffffff) throw new Error('workbook too large to write');
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    // Fields shared by the local header (from offset 4) and the central record (from offset 6).
    const common = (p, it) => {
      dv.setUint16(p, 20, true); dv.setUint16(p + 2, 0x0800, true); dv.setUint16(p + 4, 0, true);
      dv.setUint16(p + 6, time, true); dv.setUint16(p + 8, date, true); dv.setUint32(p + 10, it.crc, true);
      dv.setUint32(p + 14, it.data.length, true); dv.setUint32(p + 18, it.data.length, true); dv.setUint16(p + 22, it.name.length, true);
    };
    let p = 0;
    for (const it of items) {
      it.off = p;
      dv.setUint32(p, 0x04034b50, true); common(p + 4, it); dv.setUint16(p + 28, 0, true);
      out.set(it.name, p + 30); out.set(it.data, p + 30 + it.name.length);
      p += 30 + it.name.length + it.data.length;
    }
    const cd = p;
    for (const it of items) {
      dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); common(p + 6, it);
      dv.setUint16(p + 30, 0, true); dv.setUint16(p + 32, 0, true); dv.setUint16(p + 34, 0, true);
      dv.setUint16(p + 36, 0, true); dv.setUint32(p + 38, 0, true); dv.setUint32(p + 42, it.off, true);
      out.set(it.name, p + 46);
      p += 46 + it.name.length;
    }
    dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 4, 0, true); dv.setUint16(p + 6, 0, true);
    dv.setUint16(p + 8, items.length, true); dv.setUint16(p + 10, items.length, true);
    dv.setUint32(p + 12, p - cd, true); dv.setUint32(p + 16, cd, true); dv.setUint16(p + 20, 0, true);
    return out;
  }

  // ---------- SpreadsheetML reading ----------

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  /** Decode XML text: entities (&amp; &#10; &#x0A; …) only; for attribute values such as sheet names. */
  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
      if (e[0] !== '#') return ENT[e];
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    });
  }

  /** Decode cell text: XML line-end normalisation, entities, then Excel's _xHHHH_ escapes (_x005F_ is a literal underscore). */
  function cellText(s) {
    if (s.indexOf('\r') >= 0) s = s.replace(/\r\n?/g, '\n');
    s = decodeEntities(s);
    if (s.indexOf('_x') >= 0) s = s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return s;
  }

  /** Attributes of an XML start tag's attribute text → { name: decoded value } (either quote style). */
  function attrsOf(s) {
    const o = {}, re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(s))) o[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
    return o;
  }

  const ATTR_RE = {};
  /** One attribute's raw value from a start tag's attribute text, or null; fast path for name="…". */
  function attr(s, name) {
    const i = s.indexOf(' ' + name + '="');
    if (i >= 0) { const st = i + name.length + 3; return s.slice(st, s.indexOf('"', st)); }
    if (s.indexOf(name) < 0) return null;
    const re = ATTR_RE[name] || (ATTR_RE[name] = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')'));
    const m = re.exec(s);
    return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
  }

  /** Relationship entries of a .rels part → [{ id, type, target, external }]. */
  function relationships(xml) {
    const out = [], re = /<(?:[\w.-]+:)?Relationship\b([^>]*)>/g;
    let m;
    while ((m = re.exec(xml || ''))) {
      const a = attrsOf(m[1]);
      out.push({ id: a.Id, type: a.Type || '', target: a.Target || '', external: /^external$/i.test(a.TargetMode || '') });
    }
    return out;
  }

  /** Resolve a relationship target against the folder of the part that owns it ('xl/' + 'worksheets/sheet1.xml'). */
  function resolvePath(dir, target) {
    let t = String(target).replace(/\\/g, '/');
    try { t = decodeURIComponent(t); } catch (e) { /* keep as written */ }
    const parts = (t[0] === '/' ? t.slice(1) : dir + t).split('/'), out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/');
  }

  const T_RE = /<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g;
  /** Text of a shared-string <si> or inline <is> body: every <t> run joined, phonetic guides (<rPh>) left out. */
  function richText(body) {
    // Fast path: a single plain <t>…</t>.
    if (body.startsWith('<t>') && body.indexOf('<', 3) === body.length - 4 && body.endsWith('</t>')) return cellText(body.slice(3, -4));
    if (body.indexOf('rPh') >= 0) body = body.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, '');
    let s = '', m;
    T_RE.lastIndex = 0;
    while ((m = T_RE.exec(body))) s += m[1];
    return cellText(s);
  }

  /** Shared-string table of xl/sharedStrings.xml, in index order (an empty <si/> keeps its slot). */
  function parseSharedStrings(xml) {
    const out = [], re = /<(?:[\w.-]+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?si>)/g;
    let m;
    while ((m = re.exec(xml))) out.push(m[1] === undefined ? '' : richText(m[1]));
    return out;
  }

  /** ISO date or date-time text (t="d" cells) → Excel serial number in the workbook's date system; text if unreadable. */
  function isoToSerial(s, date1904) {
    const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?/.exec(s);
    if (!m) return s;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) + Math.round(+(m[6] || 0) * 1000);
    return ms / 86400000 + 25569 - (date1904 ? 1462 : 0);
  }

  /**
   * Cells of one worksheet part → { rows, uncached }. Scans <sheetData> with one regular expression over
   * row and cell elements; cell and row positions come from their r attributes or, where those are missing,
   * follow on from the previous cell / row. Formula cells give their cached <v>; uncached counts formula
   * cells that have none (they read as blank).
   */
  function parseSheet(xml, sst, date1904) {
    const rows = [];
    let uncached = 0;
    const sd = /<([\w.-]+:)?sheetData\b[^>]*?(\/?)>/.exec(xml);
    if (!sd || sd[2]) return { rows, uncached };
    const pre = sd[1] || '', p = pre.replace(/[.]/g, '\\.');
    const close = xml.indexOf('</' + pre + 'sheetData>', sd.index);
    const body = xml.slice(sd.index + sd[0].length, close < 0 ? xml.length : close);
    const RE = new RegExp('<' + p + 'row\\b([^>]*?)/?>|</' + p + 'row>|<' + p + 'c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + p + 'c>)', 'g');
    const vOpen = '<' + pre + 'v>', vClose = '</' + pre + 'v>', fOpen = '<' + pre + 'f';
    const V_RE = new RegExp('<' + p + 'v(?:\\s[^>]*)?>([\\s\\S]*?)</' + p + 'v>');
    const IS_RE = new RegExp('<' + p + 'is\\b[^>]*>([\\s\\S]*?)</' + p + 'is>');
    let m, r = -1, c = -1;
    while ((m = RE.exec(body))) {
      const attrs = m[2];
      if (attrs === undefined) { // <row> or </row>
        if (m[0].charCodeAt(1) === 47) continue;
        const ra = attr(m[1], 'r');
        r = ra ? +ra - 1 : r + 1; c = -1;
        continue;
      }
      // Cell position: letters then digits of r="AB12" (a $ is tolerated); missing parts follow on.
      const ref = attr(attrs, 'r');
      let cr = r < 0 ? 0 : r, cc = c + 1;
      if (ref) {
        let k = 0, cn = 0, rn = 0;
        for (; k < ref.length; k++) {
          const ch = ref.charCodeAt(k);
          if (ch >= 65 && ch <= 90) cn = cn * 26 + ch - 64; else if (ch >= 97 && ch <= 122) cn = cn * 26 + ch - 96; else if (ch !== 36) break;
        }
        for (; k < ref.length; k++) { const ch = ref.charCodeAt(k); if (ch >= 48 && ch <= 57) rn = rn * 10 + ch - 48; else if (ch !== 36) break; }
        if (cn) cc = cn - 1;
        if (rn) cr = rn - 1;
      }
      c = cc; r = cr;
      const content = m[3];
      if (!content) continue; // <c …/> or <c …></c>: styled but blank
      // Raw <v> text, or null when there is none.
      let raw = null;
      const v0 = content.indexOf(vOpen);
      if (v0 >= 0) { const v1 = content.indexOf(vClose, v0); raw = content.slice(v0 + vOpen.length, v1 < 0 ? content.length : v1); }
      else { const vm = V_RE.exec(content); if (vm) raw = vm[1]; }
      const t = attr(attrs, 't');
      let v = null;
      if (t === 's') { if (raw !== null) { v = sst[+raw]; if (v === undefined) v = null; } }
      else if (t === 'inlineStr') { const im = IS_RE.exec(content); v = im ? richText(im[1]) : raw === null ? null : cellText(raw); }
      else if (t === 'str' || t === 'e') { if (raw !== null) v = cellText(raw); }
      else if (t === 'b') { if (raw !== null) { const b = raw.trim().toLowerCase(); v = b === '1' || b === 'true' ? 'TRUE' : 'FALSE'; } }
      else if (t === 'd') { if (raw !== null && raw.trim()) v = isoToSerial(cellText(raw), date1904); }
      else if (raw !== null && raw.trim() !== '') { const num = +raw; v = isFinite(num) ? num : cellText(raw); } // t="n" or no type
      if (raw === null && t !== 'inlineStr' && content.indexOf(fOpen) >= 0) uncached++;
      if (v === null || v === '') continue;
      if (cr >= rows.length) while (rows.length <= cr) rows.push([]);
      const rw = rows[cr];
      if (cc >= rw.length) { while (rw.length < cc) rw.push(null); rw.push(v); } else rw[cc] = v;
    }
    return { rows, uncached };
  }

  /**
   * Read an .xlsx / .xlsm workbook into grids, one per worksheet.
   * @param {ArrayBuffer|Uint8Array} data the workbook file's bytes
   * @param {{sheets?: string[]|function(string): boolean}} [opts] read only these worksheets (by tab name,
   *   or a predicate on it); the others are listed in `order` but not decompressed or parsed.
   * @returns {Promise<{sheets: Object<string, {name: string, rows: Array}>, order: string[], date1904: boolean, warnings: string[]}>}
   *   order: every tab name in workbook order; warnings: plain sentences (uncached formulas, missing parts, 1904 dates).
   */
  IN.readXlsx = async function (data, opts) {
    opts = opts || {};
    const b = toBytes(data);
    const zip = zipIndex(b);
    // Text of a part by path (case-insensitive), or null when the archive does not contain it.
    const part = async (path) => { const e = zip.get(path.toLowerCase()); return e ? utf8(await zipRead(b, e)) : null; };
    let wbPath = 'xl/workbook.xml';
    for (const rel of relationships(await part('_rels/.rels'))) {
      if (/\/officeDocument$/.test(rel.type) && !rel.external) { wbPath = resolvePath('', rel.target); break; }
    }
    const wbXml = await part(wbPath);
    if (wbXml === null) throw new Error('no workbook found inside the file; is it an Excel workbook?');
    const dir = wbPath.replace(/[^/]*$/, '');
    const targets = new Map();
    let sstPath = null;
    for (const rel of relationships(await part(dir + '_rels/' + wbPath.slice(dir.length) + '.rels'))) {
      if (rel.external) continue;
      targets.set(rel.id, resolvePath(dir, rel.target));
      if (/\/sharedStrings$/.test(rel.type)) sstPath = resolvePath(dir, rel.target);
    }
    if (!sstPath && zip.has((dir + 'sharedStrings.xml').toLowerCase())) sstPath = dir + 'sharedStrings.xml';
    const date1904 = /<(?:[\w.-]+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](?:1|true)["']/.test(wbXml);
    const tabs = [];
    const sheetsXml = (/<(?:[\w.-]+:)?sheets\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?sheets>/.exec(wbXml) || [])[1] || '';
    const tabRe = /<(?:[\w.-]+:)?sheet\b([^>]*)>/g;
    let m;
    while ((m = tabRe.exec(sheetsXml))) {
      const a = attrsOf(m[1]);
      const idKey = Object.keys(a).find((k) => /:id$/.test(k)) || 'id';
      tabs.push({ name: a.name || '', path: targets.get(a[idKey]) || null });
    }
    const want = Array.isArray(opts.sheets) ? (n) => opts.sheets.includes(n) : typeof opts.sheets === 'function' ? opts.sheets : () => true;
    const chosen = tabs.filter((t) => want(t.name));
    const warnings = [];
    if (date1904) warnings.push('The workbook uses the 1904 date system, so date serial numbers are 1,462 lower than in a standard workbook.');
    const [sstXml, ...xmls] = await Promise.all([chosen.length && sstPath ? part(sstPath) : null].concat(chosen.map((t) => (t.path ? part(t.path) : null))));
    const sst = sstXml ? parseSharedStrings(sstXml) : [];
    const sheets = {};
    chosen.forEach((t, i) => {
      if (xmls[i] === null) { warnings.push(`Sheet "${t.name}" has no worksheet data in the file and reads as empty.`); sheets[t.name] = { name: t.name, rows: [] }; return; }
      const res = parseSheet(xmls[i], sst, date1904);
      if (res.uncached) warnings.push(`Sheet "${t.name}" has ${res.uncached} formula cell${res.uncached === 1 ? '' : 's'} without a saved value (read as blank); open and save the workbook in Excel to store them.`);
      sheets[t.name] = { name: t.name, rows: res.rows };
    });
    return { sheets, order: tabs.map((t) => t.name), date1904, warnings };
  };

  // ---------- SpreadsheetML writing ----------

  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const CT = 'application/vnd.openxmlformats-';
  // Minimal stylesheet: style 0 General, style 1 the short-date number format (used for Date values).
  const STYLES = XML_HEAD + `<styleSheet xmlns="${NS_MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>`
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /** Escape &, <, > and " for XML text and attribute values. */
  const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Cell text → XML: literal _xHHHH_ protected as _x005F_xHHHH_, characters XML cannot carry (controls, CR) as _xHHHH_, then &, <, > escaped. */
  function escCellText(s) {
    if (/[_\u0000-\u0008\u000b-\u001f\ufffe\uffff]/.test(s)) {
      s = s.replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1')
        .replace(/[\u0000-\u0008\u000b-\u001f\ufffe\uffff]/g, (ch) => '_x' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '_');
    }
    return /[&<>]/.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : s;
  }

  /** Worksheet XML for a rows array: inline strings, plain numbers, booleans, Dates as styled serials; blanks omitted. */
  function sheetXml(rows) {
    const out = [];
    let maxR = 0, maxC = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row.length) continue;
      let cells = '';
      const rn = r + 1;
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v === null || v === undefined || v === '') continue;
        const ref = col(c) + rn;
        if (typeof v === 'number') cells += isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="e"><v>#NUM!</v></c>`;
        else if (typeof v === 'boolean') cells += `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        else if (v instanceof Date) { if (isNaN(v)) continue; cells += `<c r="${ref}" s="1"><v>${v.getTime() / 86400000 + 25569}</v></c>`; }
        else {
          const s = String(v);
          cells += `<c r="${ref}" t="inlineStr"><is><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${escCellText(s)}</t></is></c>`;
        }
        if (c >= maxC) maxC = c + 1;
      }
      if (cells) { out.push(`<row r="${rn}">${cells}</row>`); maxR = rn; }
    }
    const dim = maxR ? (maxR === 1 && maxC === 1 ? 'A1' : 'A1:' + col(maxC - 1) + maxR) : 'A1';
    return XML_HEAD + `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><dimension ref="${dim}"/><sheetData>${out.join('')}</sheetData></worksheet>`;
  }

  /** Valid, unique Excel tab names: no : \ / ? * [ ], no leading / trailing apostrophe, at most 31 characters. */
  function tabNames(names) {
    const used = new Set();
    return names.map((n, i) => {
      let base = String(n === null || n === undefined ? '' : n).replace(/[:\\/?*[\]]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31);
      if (!base.trim()) base = 'Sheet' + (i + 1);
      let name = base, k = 2;
      while (used.has(name.toLowerCase())) { const sfx = ` (${k++})`; name = base.slice(0, 31 - sfx.length) + sfx; }
      used.add(name.toLowerCase());
      return name;
    });
  }

  /**
   * Write grids to a minimal .xlsx workbook (uncompressed zip with CRC-32s): [Content_Types].xml, package and
   * workbook relationships, workbook, a minimal stylesheet and one worksheet per grid using inline strings.
   * Tab names are made valid for Excel (forbidden characters → '_', 31 characters, unique). Opens in Excel and
   * LibreOffice and reads back through readXlsx().
   * @param {Object<string, {rows: Array}|Array>|Array<{name: string, rows: Array}>} sheets in tab order
   * @returns {Uint8Array}
   */
  IN.writeXlsx = function (sheets) {
    let list = Array.isArray(sheets)
      ? sheets.map((s) => ({ name: s && s.name, rows: (s && s.rows) || [] }))
      : Object.keys(sheets || {}).map((k) => ({ name: k, rows: Array.isArray(sheets[k]) ? sheets[k] : (sheets[k] && sheets[k].rows) || [] }));
    if (!list.length) list = [{ name: 'Sheet1', rows: [] }];
    const names = tabNames(list.map((s) => s.name));
    const enc = new TextEncoder();
    const n = list.length;
    let types = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + `<Default Extension="rels" ContentType="${CT}package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="${CT}officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="${CT}officedocument.spreadsheetml.styles+xml"/>`;
    let wb = XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>`;
    let rels = XML_HEAD + `<Relationships xmlns="${NS_PKG}">`;
    const files = [];
    for (let i = 0; i < n; i++) {
      types += `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}officedocument.spreadsheetml.worksheet+xml"/>`;
      wb += `<sheet name="${escXml(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
      rels += `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(list[i].rows)) });
    }
    rels += `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`;
    return zipStore([
      { name: '[Content_Types].xml', data: enc.encode(types + '</Types>') },
      { name: '_rels/.rels', data: enc.encode(XML_HEAD + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
      { name: 'xl/workbook.xml', data: enc.encode(wb + '</sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(rels) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    ].concat(files));
  };

  // ---------- files ----------

  /**
   * Text of a CSV / TSV file's bytes: UTF-8 (with or without BOM), UTF-16 with a BOM (Excel's "Unicode
   * Text"), otherwise Windows-1252 (Excel's plain "CSV" on Windows), so £, é and – survive either way.
   * @param {ArrayBuffer|Uint8Array} data
   * @returns {string}
   */
  IN.decodeText = function (data) {
    const b = toBytes(data);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { /* not UTF-8 */ }
    try { return new TextDecoder('windows-1252').decode(b); } catch (e) { /* label unsupported: Latin-1 below */ }
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return s;
  };

  /** Bytes of a dropped file: File / Blob (arrayBuffer()), or { data } holding bytes or text. */
  async function bytesOf(f) {
    if (typeof f.arrayBuffer === 'function') return new Uint8Array(await f.arrayBuffer());
    if (typeof f.data === 'string') return new TextEncoder().encode(f.data);
    if (f.data) return toBytes(f.data);
    throw new Error('no file content');
  }

  /** Text of a dropped CSV / TSV file, decoded by decodeText() when its bytes are available. */
  async function textOf(f) {
    if (typeof f.arrayBuffer === 'function' || (f.data && typeof f.data !== 'string')) return IN.decodeText(await bytesOf(f));
    if (typeof f.text === 'function') return f.text();
    if (typeof f.data === 'string') return f.data;
    throw new Error('no file content');
  }

  /**
   * Read dropped files into the four input sheets.
   * A workbook (.xlsx / .xlsm) contributes every tab whose name matches a sheet (sheetKey; other tabs are not
   * parsed); a .csv / .tsv / .txt file is one sheet, named by its file name. Files apply in order, so a later
   * file replaces an earlier one's sheet. Problems never throw: unreadable files, unrecognised names and
   * sheets missing from a workbook (and not supplied by another file) become warnings.
   * @param {FileList|Array<File|{name: string, arrayBuffer?: function, text?: function, data?: *}>} files
   * @returns {Promise<{sheets: Object<string, {name: string, rows: Array}>, sources: Object<string, {kind: 'xlsx'|'csv', file: string, sheetName: string|null}>, warnings: string[]}>}
   *   sheets and sources are keyed by canonical sheet name; sheetName is the workbook tab (null for CSV).
   */
  IN.readFiles = async function (files) {
    const out = { sheets: {}, sources: {}, warnings: [] };
    const warn = (msg) => out.warnings.push(msg); // collect a plain-sentence warning
    const missing = [];
    const names = IN.SHEETS.map((s) => `"${s}"`).join(', ');
    // Store one sheet, noting when it replaces a sheet read from an earlier file.
    const put = (key, rows, src) => {
      const prev = out.sources[key];
      if (prev) warn(`${key}: ${src.file} replaces the sheet read from ${prev.file}.`);
      out.sheets[key] = { name: key, rows };
      out.sources[key] = src;
    };
    for (const f of Array.from(files || [])) {
      const name = String((f && f.name) || 'unnamed file');
      const ext = ((/\.([^./\\]+)$/.exec(name) || [])[1] || '').toLowerCase();
      try {
        if (ext === 'xlsx' || ext === 'xlsm') {
          const book = await IN.readXlsx(await bytesOf(f), { sheets: (n) => IN.sheetKey(n) !== null });
          const found = {};
          for (const tab of book.order) {
            const key = IN.sheetKey(tab);
            if (!key || !book.sheets[tab]) continue;
            if (found[key]) { warn(`${name}: tabs "${found[key]}" and "${tab}" both look like ${key}; using "${found[key]}".`); continue; }
            found[key] = tab;
            put(key, book.sheets[tab].rows, { kind: 'xlsx', file: name, sheetName: tab });
          }
          for (const w of book.warnings) warn(`${name}: ${w}`);
          for (const s of IN.SHEETS) if (!found[s]) missing.push({ file: name, sheet: s, tabs: book.order });
        } else if (ext === 'csv' || ext === 'tsv' || ext === 'tab' || ext === 'txt') {
          const key = IN.sheetKey(name);
          if (!key) { warn(`${name}: skipped, the file name does not say which sheet it is; name it after one of ${names} (for example "Holdings.csv").`); continue; }
          put(key, IN.parseText(await textOf(f), { name: key }).rows, { kind: 'csv', file: name, sheetName: null });
        } else if (ext === 'xls' || ext === 'xlsb' || ext === 'ods' || ext === 'numbers') {
          warn(`${name}: skipped, .${ext} files cannot be read; save the workbook as .xlsx, or save each sheet as CSV.`);
        } else {
          warn(`${name}: skipped, only .xlsx, .xlsm, .csv, .tsv and .txt files can be read.`);
        }
      } catch (e) {
        warn(`${name}: could not be read (${e && e.message ? e.message : e}).`);
      }
    }
    for (const m of missing) {
      if (!out.sheets[m.sheet]) warn(`${m.file}: no "${m.sheet}" sheet found (tabs: ${m.tabs.map((t) => `"${t}"`).join(', ') || 'none'}).`);
    }
    return out;
  };

  /**
   * Offer bytes or text to the user as a file download (Blob + temporary link). Browser only: returns false and
   * does nothing in Node.
   * @param {string} filename
   * @param {Uint8Array|ArrayBuffer|string} bytes
   * @param {string} [mime] defaults from the extension (.xlsx, .csv, else application/octet-stream)
   * @returns {boolean} true when the download was started
   */
  IN.downloadBytes = function (filename, bytes, mime) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
    const type = mime || (/\.xls[xm]$/i.test(filename) ? CT + 'officedocument.spreadsheetml.sheet'
      : /\.csv$/i.test(filename) ? 'text/csv;charset=utf-8' : 'application/octet-stream');
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000); // late revoke: some browsers start the download asynchronously
    return true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
