#!/usr/bin/env node
/* Scope diagnostics: load input files exactly as the Data page does and print how the AUM calculation read them.
 *   node tools/diagnose.js "AUM workbook.xlsx"            (or the four sheets as CSVs: Holdings.csv Mapping.csv …)
 * Prints the same diagnostics report as "Copy diagnostics" on the Data page (sheets, header rows, column roles, key
 * checks, Mapping tables with the headers found and sample IDs, settings, views, investors, look-through, gaps, FX,
 * workbook checks, issues grouped by cause), then the literal Mapping rows 2-3 and every header of the keyed sheets.
 * Reads only; changes nothing. Values from your data are not printed except headers, table titles and counts. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/core/util.js', 'js/core/csv.js', 'js/inputs/workbook.js', 'js/calc/aum.js']) require(path.join(ROOT, f));
const S = globalThis.Scope, AUM = S.calc.aum;
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) { console.log('usage: node tools/diagnose.js FILE.xlsx [more files]'); process.exit(1); }
(async () => {
  const objs = files.map((f) => ({ name: path.basename(f), arrayBuffer: async () => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }, text: async () => fs.readFileSync(f, 'utf8') }));
  const read = await S.inputs.readFiles(objs);
  console.log('\n== FILES'); for (const [k, src] of Object.entries(read.sources)) console.log(`  ${k.padEnd(15)} ${src.kind} ${src.file}${src.sheetName ? ' [' + src.sheetName + ']' : ''} · ${read.sheets[k].rows.length} rows`);
  for (const w of read.warnings) console.log('  WARNING ' + w);
  const res = AUM.run({ sheets: read.sheets, sources: read.sources, adjustments: [], platform: '', currency: 'EUR' });
  console.log(AUM.diagnosticsText(res));
  const mapGrid = read.sheets.Mapping;
  if (mapGrid) { console.log('== MAPPING ROWS 2-3 AS FOUND (titles and headers):'); for (const r of [1, 2]) console.log('   row ' + (r + 1) + ': ' + (mapGrid.rows[r] || []).map((v, c) => (v === null || v === undefined || v === '' ? null : AUM.colName(c) + '=' + JSON.stringify(v))).filter(Boolean).join(' ')); }
  for (const k of ['Holdings', 'Hardcoded', 'ESG Hardcoded']) { const x = res.inputs.sheets[k]; if (x && x.columns) console.log(`\n== ${k.toUpperCase()} HEADERS (row ${x.headerRow}): ` + x.columns.map((c) => c.letter + '=' + JSON.stringify(c.header) + (c.output ? '/' + JSON.stringify(c.output) : '')).join(' ')); }
})().catch((e) => { console.error('diagnose failed:', e); process.exit(1); });
