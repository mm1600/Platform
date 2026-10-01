#!/usr/bin/env node
/* node tests/run-node.js — runs the same engine tests as tests/index.html against data/demo/*.csv
 *
 * The core and engine files are classic browser scripts that attach to globalThis.Scope, so plain
 * require() in index.html order is enough (no module system, no test framework). The test files
 * register cases on Scope.tests; this runner supplies the demo CSV texts, runs them in order,
 * prints one line per case and exits 1 if any case failed (usable in CI).
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
// Load order matters: util → csv → engines (aum → dataset → pivot) → test suites.
for (const f of ['js/core/util.js', 'js/core/csv.js', 'js/engine/aum.js', 'js/engine/dataset.js', 'js/engine/pivot.js', 'js/engine/lookthrough.js', 'js/core/charts-extra.js', 'js/modules/layer2-concentration.js', 'tests/engine.tests.js', 'tests/pivot.tests.js', 'tests/lookthrough.tests.js', 'tests/concentration.tests.js']) require(path.join(ROOT, f));
const Scope = globalThis.Scope;
// Demo inputs keyed by file name, the same shape as window.SCOPE_DEMO in the browser (data/demo.js).
const files = {};
for (const n of fs.readdirSync(path.join(ROOT, 'data', 'demo'))) if (n.endsWith('.csv')) files[n] = fs.readFileSync(path.join(ROOT, 'data', 'demo', n), 'utf8');
Scope.tests.files = files;
Scope.tests.run().then((results) => {
  for (const r of results) console.log((r.ok ? '  ok  ' : ' FAIL ') + r.name + (r.error ? '\n        ' + r.error : ''));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
});
