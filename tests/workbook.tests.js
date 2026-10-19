/* Scope workbook input tests — run in the browser (tests/index.html) or Node (node tests/run-node.js). Loads after engine.tests.js.
 *
 * Covers js/inputs/workbook.js: Excel coordinates, sheet-name matching, pasted / CSV text, the xlsx writer and
 * reader (round trips, a 2,000 x 220 timing check, and a hand-built workbook using shared strings, deflate,
 * data descriptors, namespace prefixes and cached formula values) and readFiles() over mixed drops.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, IN = Scope.inputs;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const add = T.add;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  // Assert deep equality of JSON-representable values, showing both sides on failure.
  const same = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg || ''} expected ${y}, got ${x}`); };
  // Millisecond clock (high resolution where available).
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const enc = new TextEncoder(); // string → UTF-8 bytes
  // A dropped file as readFiles() receives it: name plus arrayBuffer() (bytes or text) or text().
  const fileOf = (name, content) => (typeof content === 'string' && name.endsWith('.txt')
    ? { name, text: async () => content }
    : { name, arrayBuffer: async () => { const b = typeof content === 'string' ? enc.encode(content) : content; return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });

  /** Raw deflate of bytes: Node's zlib, else CompressionStream in browsers; null when neither exists. */
  async function deflateRaw(bytes) {
    if (typeof require === 'function') { try { return new Uint8Array(require('zlib').deflateRawSync(bytes)); } catch (e) { /* not Node */ } }
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
        w.write(bytes); w.close();
        return new Uint8Array(await new Response(cs.readable).arrayBuffer());
      } catch (e) { /* deflate-raw unsupported */ }
    }
    return null;
  }

  /**
   * Independent zip builder for the reader tests: entries { name, text, method (0 stored / 8 deflate),
   * descriptor (sizes and CRC after the data, zeros in the local header) }. Returns null if deflate is unavailable.
   */
  async function buildZip(entries) {
    const parts = [], central = [];
    let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = enc.encode(e.text), crc = IN.crc32(data);
      const body = e.method === 8 ? await deflateRaw(data) : data;
      if (!body) return null;
      const flags = 0x0800 | (e.descriptor ? 8 : 0);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, flags, true); lh.setUint16(8, e.method, true);
      if (!e.descriptor) { lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true); }
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, body);
      let size = 30 + name.length + body.length;
      if (e.descriptor) {
        const dd = new DataView(new ArrayBuffer(16));
        dd.setUint32(0, 0x08074b50, true); dd.setUint32(4, crc, true); dd.setUint32(8, body.length, true); dd.setUint32(12, data.length, true);
        parts.push(new Uint8Array(dd.buffer)); size += 16;
      }
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, flags, true); ch.setUint16(10, e.method, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += size;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(eocd.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  /** A hand-written workbook in the shape Excel saves: shared strings, formulas with cached values, mixed cell types. */
  const handBuilt = () => buildZip([
    { name: '[Content_Types].xml', method: 8, text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', method: 8, text: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', method: 8, descriptor: true, text: `<?xml version="1.0" encoding="UTF-8"?>\n<workbook ${MAIN}><workbookPr date1904="1"/><sheets>`
      + '<sheet name="Holdings" sheetId="1" r:id="rId2"/><sheet name="R&amp;D" sheetId="2" r:id="rId1"/><sheet name="ESG Hardcoded" sheetId="3" state="hidden" r:id="rId3"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', method: 0, text: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="/xl/worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId3" Type="${REL}/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    { name: 'xl/sharedStrings.xml', method: 8, descriptor: true, text: `<?xml version="1.0"?><sst ${MAIN} count="8" uniqueCount="8">`
      + '<si><t>Investor</t></si>'
      + '<si><r><rPr><b/><sz val="11"/></rPr><t>Rich </t></r><r><t xml:space="preserve">text &amp; more</t></r></si>'
      + '<si><t>Line 1&#10;Line 2</t></si>'
      + '<si><t>CR_x000D_LF</t></si>'
      + '<si><t>literal _x005F_x0041_ text</t></si>'
      + '<si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><phoneticPr fontId="1"/></si>'
      + '<si/>'
      + '<si><t>£ é – &lt;tag&gt; &quot;q&quot; &#x41;</t></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', method: 8, text: `<?xml version="1.0"?><worksheet ${MAIN}><dimension ref="A1:J5"/><sheetData>`
      + '<row r="1" spans="1:6"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" s="3" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c></row>'
      + '<row r="2"><c r="A2"><v>1234.5</v></c><c r="B2"><f>A2*2</f><v>2469</v></c><c r="C2" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="D2" t="b"><v>1</v></c>'
      + '<c r="E2" t="b"><f>FALSE()</f><v>0</v></c><c r="F2" t="e"><f>NA()</f><v>#N/A</v></c><c r="G2" t="e"><v>#DIV/0!</v></c><c r="H2" s="2"/><c r="I2" t="s"><v>7</v></c>'
      + '<c r="J2" t="d"><v>2026-09-30T00:00:00</v></c></row>'
      + '<row r="4"><c><v>1</v></c><c><v>2</v></c><c r="E4" t="inlineStr"><is><t>inline</t></is></c><c><v>-3.5E-2</v></c></row>'
      + '<row><c t="s"><v>6</v></c><c r="B5"><f>1/0</f></c><c r="C5" t="s"><v>2</v></c><c r="D5" t="str"><f>""</f><v></v></c></row>'
      + '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>' },
    { name: 'xl/worksheets/sheet2.xml', method: 0, text: `<worksheet ${MAIN}><sheetData/></worksheet>` },
    { name: 'xl/worksheets/sheet3.xml', method: 8, descriptor: true, text: '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>'
      + '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Asset code</x:t></x:is></x:c><x:c r="B1"><x:v>42</x:v></x:c></x:row>'
      + '<x:row r="3"><x:c r="C3"><x:f>B1</x:f><x:v>42</x:v></x:c></x:row></x:sheetData></x:worksheet>' },
  ]);

  // ---------- coordinates and names ----------
  add('workbook: colName / colIndex / cellRef round trips', () => {
    const cases = { A: 0, Z: 25, AA: 26, AZ: 51, BA: 52, ZZ: 701, AAA: 702, XFD: 16383 };
    for (const [l, i] of Object.entries(cases)) { assert(IN.colName(i) === l, `colName(${i}) = ${IN.colName(i)}`); assert(IN.colIndex(l) === i, `colIndex(${l})`); }
    for (let i = 0; i < 20000; i++) if (IN.colIndex(IN.colName(i)) !== i) throw new Error('round trip at ' + i);
    assert(IN.colIndex('ab') === 27 && IN.colIndex('A1') === -1 && IN.colIndex('') === -1, 'colIndex edge cases');
    assert(IN.cellRef(0, 0) === 'A1' && IN.cellRef(11, 27) === 'AB12' && IN.cellRef(99, 702) === 'AAA100', 'cellRef');
    same(IN.parseRef('AB12'), { r: 11, c: 27 }); same(IN.parseRef('$c$3'), { r: 2, c: 2 });
    assert(IN.parseRef('A0') === null && IN.parseRef('12') === null && IN.parseRef('A1:B2') === null, 'parseRef rejects non-cells');
  });

  add('workbook: sheetKey matches tab names exactly and file names by suffix (ESG Hardcoded before Hardcoded)', () => {
    const expect = {
      Holdings: 'Holdings', holdings: 'Holdings', ' HOLDINGS ': 'Holdings', Mapping: 'Mapping', 'Hardcoded ': 'Hardcoded', 'hard-coded': 'Hardcoded',
      'ESG Hardcoded': 'ESG Hardcoded', ESG_Hardcoded: 'ESG Hardcoded', 'esg hardcoded': 'ESG Hardcoded', ESGHardcoded: 'ESG Hardcoded', 'esg-hard_coded': 'ESG Hardcoded',
      'Holdings.csv': 'Holdings', 'My workbook - Holdings.csv': 'Holdings', 'AUM_ESG_Hardcoded.csv': 'ESG Hardcoded', 'AUM - Hardcoded.tsv': 'Hardcoded',
      'ESGHardcoded.CSV': 'ESG Hardcoded', 'esg hardcoded.txt': 'ESG Hardcoded', 'Holdings (1).csv': 'Holdings', 'BookMapping.csv': 'Mapping', 'C:\\exports\\Mapping.csv': 'Mapping',
      'Old Holdings': null, 'Holdings2': null, Output: null, 'ESG': null, '': null, 'Shareholdings.csv': null, 'notes.txt': null, 'Holdings.xlsx': null, 'Holdings 2026.csv': null,
    };
    for (const [n, k] of Object.entries(expect)) assert(IN.sheetKey(n) === k, `sheetKey(${JSON.stringify(n)}) = ${IN.sheetKey(n)}, expected ${k}`);
    assert(IN.sheetKey(null) === null && IN.sheetKey(undefined) === null, 'null input');
    same(IN.SHEETS, ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'], 'SHEETS');
  });

  // ---------- text ----------
  add('workbook: parseText reads Excel clipboard TSV with quoted multi-line cells', () => {
    // As Excel copies it: CRLF rows, a cell with Alt+Enter line breaks quoted, quotes inside it doubled.
    const clip = 'Asset\tNotes\tAmount\r\nA1\t"Line one\nLine ""two""\twith tab"\t1,234.50\r\nA2\t5" pipe\t\r\n\t\t\r\nA4\t trailing space \t-7\r\n';
    const g = IN.parseText(clip);
    same(g.rows, [['Asset', 'Notes', 'Amount'], ['A1', 'Line one\nLine "two"\twith tab', '1,234.50'], ['A2', '5" pipe'], [], ['A4', ' trailing space ', '-7']]);
    same(IN.parseText('"unterminated\tx\r\ny\tz').rows, [['"unterminated', 'x'], ['y', 'z']], 'unclosed quote kept literally');
    same(IN.parseText('"ab"c\td').rows, [['"ab"c', 'd']], 'stray text after a closing quote kept literally');
    same(IN.parseText('single').rows, [['single']], 'one cell');
    same(IN.parseText('').rows, [], 'empty text');
  });

  add('workbook: parseText reads CSV and semicolon CSV, strips a BOM, keeps text exactly', () => {
    same(IN.parseText('\ufeffa,b,c\r\n1,"x, y",\r\n,,\r\n" q ",007,=1+1\r\n').rows, [['a', 'b', 'c'], ['1', 'x, y'], [], [' q ', '007', '=1+1']]);
    same(IN.parseText('Name;Amount\nA;1,5\nB;"2;5"\n').rows, [['Name', 'Amount'], ['A', '1,5'], ['B', '2;5']], 'semicolon CSV');
    same(IN.parseText('a,b\rc,d\r').rows, [['a', 'b'], ['c', 'd']], 'classic Mac line endings');
    same(IN.parseText('"a\tb",c\n').rows, [['a\tb', 'c']], 'quoted tab does not make it TSV');
    same(IN.parseText('title\n\nx,y\n').rows, [['title'], [], ['x', 'y']], 'delimiter found on a later record');
    same(IN.parseText('a\tb', { delimiter: ',' }).rows, [['a\tb']], 'explicit delimiter');
  });

  add('workbook: parseText origin C3 places the first pasted cell at C3', () => {
    const g = IN.parseText('h1\th2\r\n1\t2\r\n\r\n3\r\n', { origin: 'C3', name: 'Paste' });
    assert(g.name === 'Paste', 'name');
    same(g.rows, [[], [], [null, null, 'h1', 'h2'], [null, null, '1', '2'], [], [null, null, '3']]);
    assert(g.rows[2][2] === 'h1' && IN.cellRef(2, 2) === 'C3', 'C3 holds the first cell');
    let threw = false; try { IN.parseText('x', { origin: 'nope' }); } catch (e) { threw = true; } assert(threw, 'bad origin rejected');
  });

  add('workbook: gridToCsv round-trips through parseText', () => {
    const rows = [['Hea,der', 'tab\there', 'semi;colon', 'quote "q"'], ['multi\r\nline', null, '  spaced  ', 'é £ – 東京'], [], [null, null, 'x'], ['=SUM(A1)', '"', '', 'end']];
    const csv = IN.gridToCsv({ name: 'g', rows });
    assert(csv.endsWith('\r\n') && csv.indexOf('\r\n') > 0, 'CRLF');
    const back = IN.parseText(csv).rows;
    same(back, [rows[0], rows[1], [], [null, null, 'x'], ['=SUM(A1)', '"', null, 'end']]);
    same(IN.parseText(IN.gridToCsv([[1, 2.5, -0.001], [true, false, null, 1e21]])).rows, [['1', '2.5', '-0.001'], ['TRUE', 'FALSE', null, '1e+21']], 'numbers and booleans as text');
    assert(IN.gridToCsv([]) === '', 'empty grid');
  });

  // ---------- xlsx ----------
  add('workbook: writeXlsx → readXlsx round trip (four sheets, special characters, unicode, gaps)', async () => {
    const sheets = {
      Holdings: { rows: [['Portfolio', 'Holding', 'Nominal', 'Rate'], ['P1', 'H & <1>', 1000000, 0.0425], ['P2', 'He said "hi"', -2.5e-7, 1e21], [], [null, 'gap before', null, 'x']] },
      Mapping: { rows: [['Source header', 'Canonical'], ['Café £ – ü', 'name'], ['  leading', 'trailing  '], ['tab\tand\nnewline', 'cr\rhere'], ['literal _x0041_ and _x005F_', 'ctrl\u0001char']] },
      Hardcoded: [['Asset', 'Flag', 'When'], ['A1', true, new Date(Date.UTC(2026, 8, 30))], ['A2', false, 46022]],
      'ESG Hardcoded': { rows: [] },
    };
    const bytes = IN.writeXlsx(sheets);
    assert(bytes instanceof Uint8Array && bytes[0] === 0x50 && bytes[1] === 0x4b, 'zip signature');
    const r = await IN.readXlsx(bytes);
    same(r.order, ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'], 'tab order');
    same(r.sheets.Holdings.rows, sheets.Holdings.rows, 'Holdings');
    same(r.sheets.Mapping.rows, sheets.Mapping.rows, 'Mapping');
    same(r.sheets.Hardcoded.rows, [['Asset', 'Flag', 'When'], ['A1', 'TRUE', 46295], ['A2', 'FALSE', 46022]], 'booleans as TRUE/FALSE, Date as serial');
    same(r.sheets['ESG Hardcoded'].rows, [], 'empty sheet');
    assert(r.sheets.Holdings.name === 'Holdings' && r.warnings.length === 0 && r.date1904 === false, 'name and no warnings');
    // Array form, awkward tab names made valid and unique; ArrayBuffer input.
    const b2 = IN.writeXlsx([{ name: 'A/B:C*?[x]', rows: [['v']] }, { name: 'a/b:c*?[x]', rows: [] }, { name: "R&D 'x' <y>", rows: [[1]] }]);
    const r2 = await IN.readXlsx(b2.buffer.slice(b2.byteOffset, b2.byteOffset + b2.byteLength));
    same(r2.order, ['A_B_C___x_', 'a_b_c___x_ (2)', "R&D 'x' <y>"], 'tab names');
    const only = await IN.readXlsx(bytes, { sheets: ['Mapping'] });
    same(Object.keys(only.sheets), ['Mapping'], 'sheet filter');
  });

  add('workbook: 2,000 x 220 sheet writes and reads back in under 2 s', async () => {
    const R = 2000, C = 220, rows = [];
    for (let r = 0; r < R; r++) {
      const row = new Array(C);
      for (let c = 0; c < C; c++) row[c] = r === 0 ? 'Column ' + IN.colName(c) : c % 5 === 0 ? 'Asset ' + r + '/' + c : (r * C + c) / 7;
      rows.push(row);
    }
    const t0 = now();
    const bytes = IN.writeXlsx({ Holdings: { rows }, Mapping: { rows: [['a']] }, Hardcoded: { rows: [['b']] }, 'ESG Hardcoded': { rows: [['c']] } });
    const t1 = now();
    const res = await IN.readXlsx(bytes);
    const t2 = now();
    const g = res.sheets.Holdings.rows;
    assert(g.length === R && g[R - 1].length === C, `shape ${g.length} x ${g[R - 1].length}`);
    assert(g[0][219] === 'Column HL' && g[1999][219] === (1999 * C + 219) / 7 && g[1234][5] === 'Asset 1234/5', 'cells');
    assert(t1 - t0 < 2000, `write took ${Math.round(t1 - t0)} ms`);
    assert(t2 - t1 < 2000, `read took ${Math.round(t2 - t1)} ms`);
  });

  add('workbook: reads shared strings, rich text, deflate, data descriptors, prefixes and cached formula values', async () => {
    const zip = await handBuilt();
    if (!zip) return; // no deflate available in this environment
    const r = await IN.readXlsx(zip);
    same(r.order, ['Holdings', 'R&D', 'ESG Hardcoded'], 'tab order and decoded names');
    const h = r.sheets.Holdings.rows;
    same(h[0], ['Investor', 'Rich text & more', 'Line 1\nLine 2', 'CR\rLF', 'literal _x0041_ text', '東京'], 'shared strings');
    same(h[1], [1234.5, 2469, 'xy', 'TRUE', 'FALSE', '#N/A', '#DIV/0!', null, '£ é – <tag> "q" A', 46295 - 1462], 'values, formulas, errors, 1904 date');
    same(h[2], [], 'missing row 3');
    same(h[3], [1, 2, null, null, 'inline', -0.035], 'cells without r follow on');
    same(h[4], [null, null, 'Line 1\nLine 2'], 'row without r; blank shared string, uncached formula and empty text are blank');
    assert(h.length === 5, 'no trailing rows');
    same(r.sheets['R&D'].rows, [], 'empty sheetData');
    same(r.sheets['ESG Hardcoded'].rows, [['Asset code', 42], [], [null, null, 42]], 'namespace-prefixed worksheet');
    assert(r.date1904 === true, 'date1904');
    assert(r.warnings.some((w) => /1904/.test(w)) && r.warnings.some((w) => /"Holdings" has 1 formula cell without a saved value/.test(w)), 'warnings: ' + r.warnings.join(' | '));
  });

  add('workbook: readFiles takes the four sheets from a workbook and CSVs, later files win', async () => {
    const book = IN.writeXlsx({ Output: [['ignored']], Holdings: [['from', 'workbook']], ' mapping ': [['m']], Hardcoded: [['h', 1]] });
    const res = await IN.readFiles([
      fileOf('AUM.xlsx', book),
      fileOf('AUM - ESG_Hardcoded.csv', 'Asset,Score\r\nA1,80\r\n'),
      fileOf('Holdings.txt', 'from\tpaste\r\n'),
      fileOf('Notes.csv', 'x\n'),
      fileOf('Old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])),
    ]);
    same(Object.keys(res.sheets).sort(), ['ESG Hardcoded', 'Hardcoded', 'Holdings', 'Mapping'], 'four sheets');
    same(res.sheets.Holdings.rows, [['from', 'paste']], 'later file replaces the workbook sheet');
    same(res.sheets.Hardcoded.rows, [['h', 1]], 'numbers kept from xlsx');
    same(res.sheets['ESG Hardcoded'].rows, [['Asset', 'Score'], ['A1', '80']], 'CSV text kept');
    assert(res.sheets.Mapping.name === 'Mapping', 'grid named by canonical sheet');
    same(res.sources.Mapping, { kind: 'xlsx', file: 'AUM.xlsx', sheetName: ' mapping ' }, 'xlsx source');
    same(res.sources.Holdings, { kind: 'csv', file: 'Holdings.txt', sheetName: null }, 'csv source');
    const w = res.warnings.join(' | ');
    assert(/Holdings\.txt replaces/.test(w) && /Notes\.csv: skipped/.test(w) && /Old\.xls: skipped/.test(w), w);
    assert(!/no "ESG Hardcoded" sheet/.test(w), 'missing sheet supplied by a CSV is not reported');
    const res2 = await IN.readFiles([fileOf('Partial.xlsx', IN.writeXlsx({ Holdings: [['x']] })), fileOf('Broken.xlsx', enc.encode('not a zip'))]);
    const w2 = res2.warnings.join(' | ');
    assert(/Partial\.xlsx: no "Mapping" sheet found \(tabs: "Holdings"\)/.test(w2) && /Broken\.xlsx: could not be read/.test(w2), w2);
    same(Object.keys(res2.sheets), ['Holdings'], 'partial workbook still read');
  });

  add('workbook: CSV files decode as UTF-8, Windows-1252 or UTF-16', async () => {
    const cp1252 = new Uint8Array([0x41, 0x2c, 0xa3, 0x31, 0x30, 0x0d, 0x0a, 0xe9, 0x2c, 0x96, 0x0d, 0x0a]); // A,£10 / é,–
    const utf16 = new Uint8Array([0xff, 0xfe].concat(...Array.from('a\t\u00e9\r\n').map((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])));
    const res = await IN.readFiles([fileOf('Mapping.csv', cp1252), fileOf('Hardcoded.txt', utf16), fileOf('Holdings.csv', enc.encode('\ufeffé,東京\n'))]);
    same(res.sheets.Mapping.rows, [['A', '£10'], ['é', '–']], 'Windows-1252');
    same(res.sheets.Hardcoded.rows, [['a', 'é']], 'UTF-16 with BOM');
    same(res.sheets.Holdings.rows, [['é', '東京']], 'UTF-8 with BOM');
    if (typeof document === 'undefined') assert(IN.downloadBytes('x.xlsx', new Uint8Array(1)) === false, 'downloadBytes is a no-op outside a browser');
  });
})(typeof window !== 'undefined' ? window : globalThis);
