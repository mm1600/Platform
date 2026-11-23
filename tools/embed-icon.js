#!/usr/bin/env node
/* Scope tool: copy launcher/Scope.ico into the two shortcut scripts as base64, so the shortcut's icon is written on each PC
 * instead of being read from the shared drive (Windows often shows a blank icon for a shortcut whose icon lives on a network
 * share or in a cloud-only OneDrive / SharePoint file).
 *
 *   node tools/embed-icon.js          write the icon into launcher/create-shortcut.ps1 and launcher/create-shortcut.vbs
 *   node tools/embed-icon.js --check  exit 1 when either script's copy differs from launcher/Scope.ico
 *
 * The scripts keep Windows line endings. tests/compare.tests.js runs the check.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ICO = path.join(ROOT, 'launcher', 'Scope.ico');
const PS1 = path.join(ROOT, 'launcher', 'create-shortcut.ps1');
const VBS = path.join(ROOT, 'launcher', 'create-shortcut.vbs');

/** The icon as base64. */
const iconBase64 = () => fs.readFileSync(ICO).toString('base64');

/** The PowerShell script with the icon line set: $IconBase64 = '…'. */
function ps1With(text, b64) {
  const line = `$IconBase64 = '${b64}'`;
  if (!/^\$IconBase64 = '[^']*'\r?$/m.test(text)) throw new Error('create-shortcut.ps1 has no $IconBase64 line');
  return text.replace(/^\$IconBase64 = '[^']*'(\r?)$/m, (m, cr) => line + cr);
}

/** The VBScript with the IconBase64() function between its ICON-START and ICON-END lines (900 characters a line). */
function vbsWith(text, b64) {
  const a = text.indexOf("'' ICON-START"), b = text.indexOf("'' ICON-END");
  if (a < 0 || b < a) throw new Error('create-shortcut.vbs has no ICON-START / ICON-END lines');
  const head = text.slice(a, text.indexOf('\n', a) + 1);
  const lines = ['Function IconBase64()', '  Dim b', '  b = ""'];
  for (let i = 0; i < b64.length; i += 900) lines.push(`  b = b & "${b64.slice(i, i + 900)}"`);
  lines.push('  IconBase64 = b', 'End Function');
  return text.slice(0, a) + head + lines.join('\r\n') + '\r\n' + text.slice(b);
}

/** Both scripts' text with the current icon, and whether each is already so. */
function plan() {
  const b64 = iconBase64();
  const crlf = (t) => t.replace(/\r?\n/g, '\r\n');
  return [[PS1, ps1With], [VBS, vbsWith]].map(([file, fn]) => {
    const now = fs.readFileSync(file, 'utf8'), next = crlf(fn(crlf(now), b64));
    return { file, next, same: now === next };
  });
}

/** The icon each script would write, decoded (for the tests). */
function embedded() {
  const ps = /^\$IconBase64 = '([^']*)'/m.exec(fs.readFileSync(PS1, 'utf8'));
  const vb = [...fs.readFileSync(VBS, 'utf8').matchAll(/^ {2}b = b & "([^"]*)"/gm)].map((m) => m[1]).join('');
  return { ps1: ps ? Buffer.from(ps[1], 'base64') : null, vbs: vb ? Buffer.from(vb, 'base64') : null, ico: fs.readFileSync(ICO) };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const p = plan(), stale = p.filter((x) => !x.same);
  if (check) {
    for (const x of stale) console.log(`out of date: ${path.relative(ROOT, x.file)} (run node tools/embed-icon.js)`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const x of stale) { fs.writeFileSync(x.file, x.next); console.log(`wrote ${path.relative(ROOT, x.file)}`); }
  if (!stale.length) console.log('both scripts already carry launcher/Scope.ico');
}

module.exports = { plan, embedded, ps1With, vbsWith };
