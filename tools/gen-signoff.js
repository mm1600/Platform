#!/usr/bin/env node
/* Scope: production sign-off guide generator (zero dependencies).
 *
 *   node tools/gen-signoff.js            → docs/production-signoff.html
 *   node tools/gen-signoff.js --check    → exit 1 when a rule's line of code no longer matches (drift)
 *
 * Reads docs/signoff/rules.json: one entry per rule the code applies ({ id, area, title, rule, example, file, line, code,
 * tests, origin, confirm }). For every rule it re-reads the source file, finds the recorded line of code (at the recorded
 * line, else anywhere in the file) and writes the current line number; a rule whose code is gone is marked "changed".
 * Every test name listed is checked against the test files; a name that no longer exists is dropped and reported.
 *
 * The page is one self-contained HTML file: part 1 lists the decisions made without a stated spec (origin "scope"), part 2
 * every rule in the workbook's order. Each rule has ✓ / ✗ and a comment, kept in the reader's browser (keyed by rule id and
 * its code, so a changed rule asks again), exportable to CSV (opens in Excel) and importable back.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'signoff', 'rules.json');
const OUT = path.join(ROOT, 'docs', 'production-signoff.html');
const check = process.argv.includes('--check');

const rules = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const files = new Map();
const lines = (f) => { if (!files.has(f)) { const p = path.join(ROOT, f); files.set(f, fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n') : null); } return files.get(f); };
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// every test case name in the suites
const testNames = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => x.endsWith('.tests.js'))) {
  const t = fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8');
  for (const m of t.matchAll(/(?:T\.add|\badd)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) testNames.add(m[2].replace(/\\(.)/g, '$1'));
}

let changed = 0, moved = 0, droppedTests = 0;
for (const r of rules) {
  const L = lines(r.file);
  // the recorded code without ellipses at either end (an abbreviated snippet), the longest middle piece if it has one inside
  const pieces = squash(r.code).split(/\s*…\s*|\s*\.\.\.\s*/).map((x) => x.trim()).filter((x) => x.length >= 12).sort((a, b) => b.length - a.length);
  const want = (pieces[0] || squash(r.code)).slice(0, 120);
  r.status = 'ok';
  if (!L) { r.status = 'changed'; r.why = `file ${r.file} not found`; changed++; continue; }
  const at = (i) => i >= 0 && i < L.length && squash(L[i]).includes(want);
  if (!at(r.line - 1)) {
    // the code moved: look nearby first, then anywhere in the file
    let found = -1;
    for (let d = 1; d <= 60 && found < 0; d++) { if (at(r.line - 1 - d)) found = r.line - 1 - d; else if (at(r.line - 1 + d)) found = r.line - 1 + d; }
    if (found < 0) found = L.findIndex((x) => squash(x).includes(want));
    if (found >= 0) { r.line = found + 1; moved++; }
    else { r.status = 'changed'; r.why = 'this line of code is no longer in the file: the rule may have changed'; changed++; }
  }
  const kept = (r.tests || []).filter((n) => testNames.has(n));
  droppedTests += (r.tests || []).length - kept.length;
  r.tests = kept;
  r.key = crypto.createHash('sha1').update(r.id + '|' + want).digest('hex').slice(0, 12);
}
console.log(`${rules.length} rules · ${rules.filter((r) => r.origin === 'scope').length} to confirm (${rules.filter((r) => r.top).length} in part 1) · ${rules.filter((r) => !r.tests.length).length} untested · ${moved} moved · ${changed} changed · ${droppedTests} unknown test names dropped`);
if (check) { if (changed) { for (const r of rules.filter((x) => x.status === 'changed')) console.log(`  ${r.id} ${r.file}:${r.line} ${r.title}`); process.exit(1); } process.exit(0); }

// areas in the order they first appear (the extraction files are already in the workbook's order)
const areas = []; for (const r of rules) if (!areas.includes(r.area)) areas.push(r.area);
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const data = rules.map((r) => ({ id: r.id, key: r.key, area: r.area, title: r.title, rule: r.rule, example: r.example, file: r.file, line: r.line, code: r.code, tests: r.tests, origin: r.origin, top: !!r.top, confirm: r.confirm || '', status: r.status, why: r.why || '' }));
const stamp = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scope production sign-off</title>
<style>
:root { --green: #0f7164; --green-dk: #073831; --mint: #e7f4f1; --ink: #1d1d1b; --muted: #6f6f6f; --line: #d8d8d8; --bg: #f2f2f2; --red: #c3454b; --orange: #f1885a; --ok: #00a76c; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 "Helvetica Neue", Arial, sans-serif; color: var(--ink); background: var(--bg); }
header { background: var(--green-dk); color: #fff; padding: 18px 24px; position: sticky; top: 0; z-index: 5; }
header h1 { margin: 0 0 4px; font-size: 20px; } header p { margin: 0; color: #cfe8dc; font-size: 13px; }
.bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.bar input, .bar select, .bar button { font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid #8acbbb; border-radius: 3px; background: #fff; color: var(--ink); }
.bar button { cursor: pointer; } .bar button.primary { background: var(--green); color: #fff; border-color: var(--green); }
.progress { height: 6px; background: #3d5b55; border-radius: 3px; overflow: hidden; flex: 1 1 200px; min-width: 160px; } .progress > div { height: 100%; background: #8acbbb; }
.wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 0; }
nav { position: sticky; top: 120px; align-self: start; max-height: calc(100vh - 130px); overflow: auto; padding: 16px; font-size: 13px; }
nav a { display: flex; justify-content: space-between; color: var(--ink); text-decoration: none; padding: 3px 6px; border-radius: 3px; } nav a:hover { background: var(--mint); }
nav .n { color: var(--muted); } nav h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 14px 0 4px; }
main { padding: 16px 24px 80px; }
section > h2 { font-size: 17px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--green); color: var(--green-dk); }
.intro { background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 14px 18px; margin-top: 12px; }
.lead { color: var(--muted, #555); margin: 0 0 12px; font-size: 14px; }
.intro li { margin: 4px 0; }
.card { background: #fff; border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: 4px; padding: 10px 14px; margin: 8px 0; }
.card.ok { border-left-color: var(--ok); } .card.no { border-left-color: var(--red); } .card.changed { border-left-color: var(--orange); }
.card h4 { margin: 0 0 4px; font-size: 14px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.id { font: 12px ui-monospace, Menlo, monospace; color: var(--muted); }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
.b-workbook { background: #e9ebed; color: #465055; } .b-user { background: var(--mint); color: var(--green-dk); } .b-scope { background: #fce7de; color: #98370c; }
.b-untested { background: #f2d9db; color: #953035; } .b-changed { background: #fce7de; color: #98370c; }
.rule { margin: 2px 0; } .ex { color: #343430; font-size: 13px; margin: 4px 0; } .ex b { color: var(--muted); font-weight: 600; }
.confirm { background: #fff6f1; border: 1px solid #f6b79b; border-radius: 3px; padding: 6px 8px; margin: 6px 0; font-size: 13px; }
details { margin-top: 4px; font-size: 12.5px; } summary { cursor: pointer; color: var(--muted); }
pre { margin: 4px 0; padding: 6px 8px; background: #f7f7f6; border: 1px solid var(--line); border-radius: 3px; white-space: pre-wrap; word-break: break-word; font: 12px ui-monospace, Menlo, monospace; }
.where a { color: var(--green); } .tests { margin: 4px 0 0; padding-left: 18px; color: #343430; }
.sign { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.sign button { font: inherit; font-size: 12.5px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 3px; background: #fff; cursor: pointer; }
.sign button.on-ok { background: var(--ok); border-color: var(--ok); color: #fff; } .sign button.on-no { background: var(--red); border-color: var(--red); color: #fff; }
.sign input { flex: 1 1 260px; font: inherit; font-size: 12.5px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 3px; }
.hidden { display: none !important; }
@media (max-width: 900px) { .wrap { grid-template-columns: 1fr; } nav { position: static; max-height: none; } header { position: static; } }
@media print { header .bar, nav, .sign button { display: none; } .wrap { display: block; } .card { break-inside: avoid; } }
</style></head><body>
<header>
  <h1>Scope · production sign-off</h1>
  <p>Every rule the code applies, in plain words, with where it lives and the test that proves it. Generated ${stamp} from the code (tools/gen-signoff.js); a rule whose code changes asks to be signed off again.</p>
  <div class="bar">
    <input id="q" type="search" placeholder="Search rules, examples, files…" aria-label="Search">
    <select id="show" aria-label="Show">
      <option value="all">All rules</option><option value="todo">Not yet reviewed</option><option value="scope">Decisions to confirm</option>
      <option value="no">Marked wrong</option><option value="untested">Not tested</option><option value="changed">Code changed since</option>
    </select>
    <div class="progress" title="reviewed"><div id="prog"></div></div><span id="count" style="font-size:13px"></span>
    <button id="exp" class="primary" type="button">Export to Excel (.csv)</button>
    <label style="font-size:13px;cursor:pointer"><input id="imp" type="file" accept=".csv" class="hidden">Import marked-up .csv</label>
  </div>
</header>
<div class="wrap"><nav id="nav"></nav><main id="main">
  <div class="intro">
    <b>How to use this.</b>
    <ul>
      <li>For the whole story in order, from loading the workbook to the last slide, read <b>Scope, step by step</b> (docs/scope-step-by-step.md, or the Word copy). Each of its steps names the rules below that it covers.</li>
      <li><b>Part 1</b> is the short list: the decisions made in the code without your spec that change a number or what a deck says. Read these first; each asks a question.</li>
      <li><b>Part 2</b> is every rule, in your workbook's order: inputs → positions → assets and views → Output → pages → reports → write-ups.</li>
      <li>For each rule press <b>✓ Matches</b> or <b>✗ Wrong</b> and say what it should be. Your marks stay in this browser; <b>Export</b> gives a CSV you can open in Excel, mark up and send back (or <b>Import</b> it again).</li>
      <li><b>Workbook</b> = reproduces your Excel; <b>You asked</b> = something you requested; <b>Scope's choice</b> = decided in the code with no stated spec. <b>Not tested</b> = no automatic test would catch a change.</li>
      <li>Click a file reference to open that line of code; "Show the code" shows the exact line.</li>
    </ul>
  </div>
</main></div>
<script>
const RULES = ${JSON.stringify(data)};
const AREAS = ${JSON.stringify(areas)};
const KEY = 'scope.signoff';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
let marks = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (e) { /* private window: marks last for this visit */ } };
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ORIGIN = { workbook: ['Workbook', 'b-workbook'], user: ['You asked', 'b-user'], scope: ["Scope's choice", 'b-scope'] };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
function card(r, inPart1) {
  const m = marks[r.key] || {}, o = ORIGIN[r.origin] || ORIGIN.scope;
  return '<div class="card ' + (r.status === 'changed' ? 'changed' : m.v === 'ok' ? 'ok' : m.v === 'no' ? 'no' : '') + '" data-key="' + r.key + '" id="' + (inPart1 ? 'c-' : '') + r.id + '">'
    + '<h4><span class="id">' + r.id + '</span>' + esc(r.title) + ' <span class="badge ' + o[1] + '">' + o[0] + '</span>'
    + (r.tests.length ? '' : '<span class="badge b-untested">Not tested</span>') + (r.status === 'changed' ? '<span class="badge b-changed">Code changed</span>' : '') + '</h4>'
    + '<div class="rule">' + esc(r.rule) + '</div>'
    + (r.example ? '<div class="ex"><b>Example:</b> ' + esc(r.example) + '</div>' : '')
    + (r.confirm ? '<div class="confirm"><b>Confirm:</b> ' + esc(r.confirm) + '</div>' : '')
    + (r.status === 'changed' ? '<div class="confirm">' + esc(r.why) + '</div>' : '')
    + '<details><summary>Show the code · ' + esc(r.file) + ':' + r.line + (r.tests.length ? ' · ' + r.tests.length + ' test' + (r.tests.length > 1 ? 's' : '') : '') + '</summary>'
    + '<div class="where"><a href="../' + esc(r.file) + '" target="_blank" rel="noopener">' + esc(r.file) + '</a> line ' + r.line + '</div><pre>' + esc(r.code) + '</pre>'
    + (r.tests.length ? '<div>Proved by:</div><ul class="tests">' + r.tests.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '<div style="color:#953035">No automatic test covers this rule.</div>')
    + '</details>'
    + '<div class="sign"><button type="button" data-v="ok" class="' + (m.v === 'ok' ? 'on-ok' : '') + '">✓ Matches</button><button type="button" data-v="no" class="' + (m.v === 'no' ? 'on-no' : '') + '">✗ Wrong</button>'
    + '<input type="text" placeholder="What it should be / comment" value="' + esc(m.c || '') + '" aria-label="Comment on ' + r.id + '"></div></div>';
}
function render() {
  const main = document.getElementById('main'), nav = document.getElementById('nav');
  main.querySelectorAll('section').forEach((s) => s.remove());
  const top = RULES.filter((r) => r.top);
  let navHtml = '<h3>Part 1</h3><a href="#part1">Read these first <span class="n">' + top.length + '</span></a><h3>Part 2 · every rule</h3>';
  let html = '<section id="part1"><h2>Part 1 · Read these first: ' + top.length + ' decisions that change numbers or what a deck says</h2>'
    + '<p class="lead">Each was decided in the code without a spec from you. The other ' + (RULES.filter((r) => r.origin === 'scope').length - top.length) + ' smaller choices are marked <b>Scope&#39;s choice</b> in Part 2, each with its own question.</p>'
    + top.map((r) => card(r, true)).join('') + '</section>';
  for (const a of AREAS) {
    const list = RULES.filter((r) => r.area === a);
    navHtml += '<a href="#' + slug(a) + '">' + esc(a) + ' <span class="n">' + list.length + '</span></a>';
    html += '<section id="' + slug(a) + '"><h2>' + esc(a) + ' (' + list.length + ')</h2>' + list.map((r) => card(r, false)).join('') + '</section>';
  }
  nav.innerHTML = navHtml; main.insertAdjacentHTML('beforeend', html); applyFilter(); tally();
}
function tally() {
  const done = RULES.filter((r) => marks[r.key] && marks[r.key].v).length, no = RULES.filter((r) => marks[r.key] && marks[r.key].v === 'no').length;
  document.getElementById('prog').style.width = (100 * done / RULES.length).toFixed(1) + '%';
  document.getElementById('count').textContent = done + ' of ' + RULES.length + ' reviewed' + (no ? ' · ' + no + ' wrong' : '');
}
function applyFilter() {
  const q = document.getElementById('q').value.trim().toLowerCase(), show = document.getElementById('show').value;
  for (const el of document.querySelectorAll('.card')) {
    const r = RULES.find((x) => x.key === el.dataset.key), m = marks[r.key] || {};
    const text = (r.id + ' ' + r.title + ' ' + r.rule + ' ' + r.example + ' ' + r.file + ' ' + r.confirm + ' ' + r.area).toLowerCase();
    const pass = (!q || text.includes(q)) && (show === 'all' || (show === 'todo' && !m.v) || (show === 'scope' && r.origin === 'scope') || (show === 'no' && m.v === 'no') || (show === 'untested' && !r.tests.length) || (show === 'changed' && r.status === 'changed'));
    el.classList.toggle('hidden', !pass);
  }
  // part 1 repeats the scope rules: hide it unless showing everything or the decisions
  document.getElementById('part1').classList.toggle('hidden', !(show === 'all' || show === 'scope' || show === 'todo') || (show === 'all' && q));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.sign button'); if (!b) return;
  const key = b.closest('.card').dataset.key, v = b.dataset.v, m = marks[key] || {};
  m.v = m.v === v ? '' : v; marks[key] = m; save();
  for (const c of document.querySelectorAll('.card[data-key="' + key + '"]')) { c.classList.toggle('ok', m.v === 'ok'); c.classList.toggle('no', m.v === 'no'); c.querySelectorAll('.sign button').forEach((x) => { x.classList.toggle('on-ok', x.dataset.v === 'ok' && m.v === 'ok'); x.classList.toggle('on-no', x.dataset.v === 'no' && m.v === 'no'); }); }
  tally();
});
document.addEventListener('change', (e) => {
  const i = e.target.closest('.sign input'); if (!i) return;
  const key = i.closest('.card').dataset.key; marks[key] = Object.assign(marks[key] || {}, { c: i.value }); save();
  for (const x of document.querySelectorAll('.card[data-key="' + key + '"] .sign input')) if (x !== i) x.value = i.value;
});
document.getElementById('q').addEventListener('input', applyFilter);
document.getElementById('show').addEventListener('change', applyFilter);
const csvCell = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
document.getElementById('exp').addEventListener('click', () => {
  const head = ['ID', 'Area', 'Title', 'Rule', 'Example', 'Origin', 'Confirm', 'File', 'Line', 'Tested', 'Your verdict', 'Your comment', 'Key'];
  const rows = RULES.map((r) => { const m = marks[r.key] || {}; return [r.id, r.area, r.title, r.rule, r.example, (ORIGIN[r.origin] || ORIGIN.scope)[0], r.confirm, r.file, r.line, r.tests.length ? 'Yes' : 'No', m.v === 'ok' ? 'Matches' : m.v === 'no' ? 'Wrong' : '', m.c || '', r.key]; });
  const text = '\\ufeff' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\\r\\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = 'scope-signoff.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
function parseCsv(t) { const out = []; let row = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\\n' || c === '\\r') { if (c === '\\r' && t[i + 1] === '\\n') i++; row.push(cell); out.push(row); row = []; cell = ''; } else cell += c; } if (cell || row.length) { row.push(cell); out.push(row); } return out; }
document.getElementById('imp').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return; const rows = parseCsv((await f.text()).replace(/^\\ufeff/, '')); const h = rows.shift() || [];
  const iv = h.indexOf('Your verdict'), ic = h.indexOf('Your comment'), ik = h.indexOf('Key'), iid = h.indexOf('ID'); let n = 0;
  for (const r of rows) { const rule = RULES.find((x) => (ik >= 0 && x.key === r[ik]) || x.id === r[iid]); if (!rule) continue; const v = /^match/i.test(r[iv] || '') ? 'ok' : /^wrong/i.test(r[iv] || '') ? 'no' : ''; marks[rule.key] = { v, c: r[ic] || '' }; n++; }
  save(); render(); e.target.value = ''; alert(n + ' rules imported');
});
render();
</script></body></html>
`;
fs.writeFileSync(OUT, html);
console.log('wrote', path.relative(ROOT, OUT), (html.length / 1024).toFixed(0) + ' KB');
