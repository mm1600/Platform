#!/usr/bin/env node
/* Scope diagnostics: load input files exactly as the Data page does and print how the AUM calculation read them.
 *   node tools/diagnose.js "AUM workbook.xlsx"            (or the four sheets as CSVs: Holdings.csv Mapping.csv …)
 * Prints: sheets found, header rows, every column role (which header it resolved to, or MISSING), the six Mapping
 * tables (where found, columns, rows), views, investors, FX check, workbook formula checks, issue summary and totals.
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
  const d = res.inputs;
  console.log('\n== HEADER ROWS'); for (const [k, x] of Object.entries(d.sheets)) console.log(`  ${k.padEnd(15)} ${x.present ? (k === 'Mapping' ? 'present' : 'header row ' + (x.headerRow || 'NOT FOUND') + ' · ' + ((x.columns || []).length) + ' headers') : 'MISSING'}`);
  console.log('\n== COLUMN ROLES (sheet.role → column; MISSING = not found)');
  for (const r of d.roles) if (!r.role.startsWith('wb_')) console.log(`  ${(r.sheet + '.' + r.role).padEnd(34)} ${r.letter ? (r.letter + ' "' + r.header + '"' + (r.output ? ' (row 2: "' + r.output + '")' : '') + ' via ' + r.via) : (r.required ? 'MISSING (required)' : 'missing (optional)') + ' · looked for: ' + r.candidates.join(' | ')}`);
  console.log('\n== MAPPING TABLES'); for (const [k, t] of Object.entries(d.tables)) console.log(`  ${k.padEnd(16)} title "${t.title}" ${t.foundBy} at ${t.titleCell} · header row ${t.headerRow} · columns ${JSON.stringify(t.columns)} · ${t.rows} rows`);
  const m = S.calc.aum; const mapGrid = read.sheets.Mapping;
  if (mapGrid) { console.log('  Mapping rows 2–3 as found (titles and headers):'); for (const r of [1, 2]) console.log('   row ' + (r + 1) + ': ' + (mapGrid.rows[r] || []).map((v, c) => (v === null || v === undefined || v === '' ? null : m.colName(c) + '=' + JSON.stringify(v))).filter(Boolean).join(' ')); }
  for (const k of ['Holdings', 'Hardcoded', 'ESG Hardcoded']) { const x = d.sheets[k]; if (x && x.columns) console.log(`\n== ${k.toUpperCase()} HEADERS (row ${x.headerRow}): ` + x.columns.map((c) => c.letter + '=' + JSON.stringify(c.header)).join(' ')); }
  console.log('\n== VIEWS (Mapping column H)'); for (const v of d.views) console.log(`  ${v.view.padEnd(30)} ${v.kind}`);
  console.log(`\n== INVESTORS ${d.investors.length} · unclassified ${d.investors.filter((i) => i.source === 'default').length} · settings sheet ${d.settings.present ? 'present' : 'absent'}`);
  console.log(`\n== FX quote ${d.fx.quote} · RC check ${JSON.stringify(d.fx.test)} · rates ${d.fx.table.map((x) => x.currency + '=' + x.rate).join(' ')}`);
  console.log('\n== WORKBOOK FORMULA CHECKS'); for (const c of d.checks) console.log(`  ${c.status.padEnd(8)} ${c.matched}/${c.total}${c.failed ? ' (' + c.failed + ' formula errors skipped)' : ''}  ${c.label}`);
  const groups = new Map(); for (const i of res.issues) { const k = i.severity + ' | ' + i.table + ' | ' + i.message.replace(/\d[\d,.]*/g, '#').replace(/"[^"]*"/g, '"…"').slice(0, 120); groups.set(k, (groups.get(k) || 0) + 1); }
  console.log(`\n== ISSUES ${JSON.stringify(res.issueCounts)}`); for (const [k, n] of Array.from(groups).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)} × ${k}`);
  console.log(`\n== RESULT view "${res.platformId}" · positions ${res.stats.positions} (${res.stats.excluded} excluded) · assets in Output ${res.rows.length} · total ${res.metrics.total_exposure_m.toFixed(1)}m ${res.displayCurrency} · reporting date ${S.util.isoDate(res.reportingDate)}`);
  console.log(res.fatal ? '\nFATAL: the calculation cannot value positions (a required Holdings column or sheet is missing).' : '');
})().catch((e) => { console.error('diagnose failed:', e); process.exit(1); });
