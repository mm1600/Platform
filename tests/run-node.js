#!/usr/bin/env node
/* node tests/run-node.js: runs the same tests as tests/index.html, in Node.
 *
 * The app's scripts are classic browser scripts that attach to globalThis.Scope, so requiring them in index.html order
 * is enough (no module system, no test framework). The fixture is the synthetic demo workbook in data/demo.js (the four
 * input sheets and the Ownership grid as cell grids), loaded exactly as the browser loads it. Prints one line per case and exits 1 on any failure.
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis; // data/demo.js assigns window.SCOPE_DEMO
// Load order matters: util → csv → workbook reader → calculation → analysis → page helpers → test suites.
const FILES = [
  'js/core/util.js', 'js/core/csv.js', 'js/inputs/workbook.js', 'js/calc/aum.js', 'js/analysis/dataset.js', 'js/analysis/sheets.js', 'js/analysis/workbook-layout.js', 'js/analysis/tieout.js', 'js/analysis/pivot.js', 'js/analysis/lookthrough.js', 'js/analysis/ask.js',
  'js/core/store.js', 'js/core/drive-vc.js', 'js/core/shared.js', 'js/core/charts-extra.js', 'js/modules/layer2-concentration.js', 'js/report/pptx.js', 'js/report/house.js', 'js/report/quarterly.js', 'js/report/investor.js', 'js/report/widgets.js', 'data/world-map.js', 'data/europe-map.js', 'data/demo.js', 'tests/fixtures/scope-settings.js',
  'tests/aum.tests.js', 'tests/pivot.tests.js', 'tests/lookthrough.tests.js', 'tests/concentration.tests.js', 'tests/workbook.tests.js', 'tests/report.tests.js', 'tests/oracle.tests.js', 'tests/tieout.tests.js', 'tests/shared.tests.js', 'tests/ask.tests.js',
];
const fs = require('fs');
for (const f of FILES) require(path.join(ROOT, f)); // a missing or renamed file fails the run
// every script the app loads must at least parse (the page modules are browser-only and are not run here)
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) { try { new Function(fs.readFileSync(path.join(ROOT, m[1]), 'utf8')); } catch (e) { console.error(` FAIL ${m[1]} does not parse: ${e.message}`); process.exit(1); } }
globalThis.Scope.tests.run().then((results) => {
  for (const r of results) console.log((r.ok ? '  ok  ' : ' FAIL ') + r.name + (r.error ? '\n        ' + r.error : ''));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
});
