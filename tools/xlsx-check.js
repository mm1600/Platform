#!/usr/bin/env node
/* node tools/xlsx-check.js — see how Scope reads input files, or write workbooks to test with.
 *
 *   node tools/xlsx-check.js FILE...                 read files as the Data page does (Scope.inputs.readFiles):
 *                                                    sheets found, sizes, sources, warnings and timing
 *   node tools/xlsx-check.js FILE... --rows 5        also print the first 5 rows of each input sheet
 *   node tools/xlsx-check.js BOOK.xlsx --all         list every tab of a workbook with its size (readXlsx)
 *   node tools/xlsx-check.js FILE... --csv Holdings  print one input sheet as CSV (redirect it to a file)
 *   node tools/xlsx-check.js --sample OUT.xlsx       write a small four-sheet workbook to open in Excel or LibreOffice
 *   node tools/xlsx-check.js --bench [ROWS COLS]     time writing and reading a ROWS x COLS sheet (default 2000 x 220)
 *
 * Loads the same classic scripts as the browser (js/core/util.js, js/core/csv.js, js/inputs/workbook.js); no dependencies.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['js/core/util.js', 'js/core/csv.js', 'js/inputs/workbook.js']) require(path.join(ROOT, f));
const IN = globalThis.Scope.inputs;

const args = process.argv.slice(2);
/** Value following a --flag (or the default when absent). */
const opt = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt; };
/** Rows x columns of a grid: row count and widest row. */
const size = (rows) => `${rows.length} rows x ${rows.reduce((m, r) => Math.max(m, r.length), 0)} columns`;
/** Milliseconds since t0, rounded. */
const ms = (t0) => Math.round(performance.now() - t0) + ' ms';

/** Print the first n rows of a grid, one line per row, cells separated by ' | ' and labelled with Excel row numbers. */
function preview(rows, n) {
  for (let r = 0; r < Math.min(n, rows.length); r++) {
    console.log(`    ${String(r + 1).padStart(4)}: ` + rows[r].map((v) => (v === null ? '' : JSON.stringify(v))).join(' | '));
  }
}

/** Build a ROWS x COLS grid: a header row, every fifth column text, the rest numbers. */
function benchGrid(R, C) {
  const rows = [];
  for (let r = 0; r < R; r++) {
    const row = new Array(C);
    for (let c = 0; c < C; c++) row[c] = r === 0 ? 'Column ' + IN.colName(c) : c % 5 === 0 ? 'Text ' + r + '/' + c : (r * C + c) / 7;
    rows.push(row);
  }
  return rows;
}

/** Entry point: dispatch on the flags documented in the header. */
async function main() {
  if (args.includes('--sample')) {
    const out = opt('--sample');
    if (!out) throw new Error('usage: --sample OUT.xlsx');
    const bytes = IN.writeXlsx({
      Holdings: [['Column A', 'Column B', 'Amount', 'Date serial', 'Note'], ['X1', 'Y & <Z>', 1250000.5, 46022, 'Café £ – "quoted"'], ['X2', null, -0.035, 46295, 'two\nlines'], [], [null, 'after a blank row']],
      Mapping: [['Source', 'Target'], ['a', 'b']],
      Hardcoded: [['Key', 'Flag'], ['k1', true], ['k2', false]],
      'ESG Hardcoded': [['Key', 'Score'], ['k1', 80]],
    });
    fs.writeFileSync(out, bytes);
    console.log(`wrote ${out} (${bytes.length} bytes, sheets: ${IN.SHEETS.join(', ')})`);
    return;
  }
  if (args.includes('--bench')) {
    const i = args.indexOf('--bench'), R = +args[i + 1] || 2000, C = +args[i + 2] || 220;
    const rows = benchGrid(R, C);
    let t0 = performance.now();
    const bytes = IN.writeXlsx({ Holdings: rows });
    console.log(`write ${R} x ${C}: ${ms(t0)}, ${(bytes.length / 1048576).toFixed(1)} MB`);
    t0 = performance.now();
    const res = await IN.readXlsx(bytes);
    console.log(`read  ${R} x ${C}: ${ms(t0)} (${size(res.sheets.Holdings.rows)})`);
    t0 = performance.now();
    const csv = IN.gridToCsv(res.sheets.Holdings);
    const back = IN.parseText(csv);
    console.log(`CSV round trip: ${ms(t0)} (${(csv.length / 1048576).toFixed(1)} MB, ${size(back.rows)})`);
    return;
  }
  const files = args.filter((a, k) => !a.startsWith('--') && !['--rows', '--csv'].includes(args[k - 1]));
  if (!files.length) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 11).join('\n')); return; }
  if (args.includes('--all')) {
    for (const f of files) {
      const t0 = performance.now();
      const book = await IN.readXlsx(fs.readFileSync(f));
      console.log(`${f}: ${book.order.length} tabs, read in ${ms(t0)}${book.date1904 ? ' (1904 date system)' : ''}`);
      for (const tab of book.order) console.log(`  ${JSON.stringify(tab).padEnd(30)} ${size(book.sheets[tab].rows).padEnd(28)} → ${IN.sheetKey(tab) || '(not an input sheet)'}`);
      for (const w of book.warnings) console.log('  warning: ' + w);
    }
    return;
  }
  const t0 = performance.now();
  const res = await IN.readFiles(files.map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) })));
  const sheet = opt('--csv');
  if (sheet) {
    const key = IN.sheetKey(sheet);
    if (!key || !res.sheets[key]) throw new Error(`no ${sheet} sheet in the files given`);
    process.stdout.write(IN.gridToCsv(res.sheets[key]));
    return;
  }
  console.log(`read ${files.length} file(s) in ${ms(t0)}`);
  const n = +opt('--rows', 0);
  for (const s of IN.SHEETS) {
    const g = res.sheets[s], src = res.sources[s];
    if (!g) { console.log(`  ${s.padEnd(14)} missing`); continue; }
    console.log(`  ${s.padEnd(14)} ${size(g.rows).padEnd(28)} from ${src.file}${src.sheetName !== null ? ` [${src.sheetName}]` : ''}`);
    if (n) preview(g.rows, n);
  }
  for (const w of res.warnings) console.log('  warning: ' + w);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
