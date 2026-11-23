/* The data folder: dated copies of the input workbook, one folder per period, which Scope can load without a file drop.
 *
 * scope.config.json, next to index.html, names the folder one level above the periods (it stays on your machine and is
 * never published):
 *
 *   { "dataFolder": "S:/Team/AUM/Quarterly data" }
 *
 *   Quarterly data/
 *     Q1 2026/            ← a period: the input workbook(s) as at that date
 *     Q2 2026/
 *       April/            ← a period inside a period: the month's copy
 *       May/
 *
 * Backslashes may be written single (S:\Team\AUM) or doubled. The SCOPE_DATA_FOLDER environment variable, when set,
 * wins over the file. Which folders are periods, and their order, is js/core/period-names.js (the same rules as a folder
 * picked in the browser). tools/serve.js answers /source/periods and /source/file with these functions; nothing outside
 * the data folder is ever read.
 */
'use strict';
const fs = require('fs'), path = require('path');

const PN = require('../js/core/period-names.js'); // the period rules, shared with the browser's folder picker
const { EXT, MAX_DEPTH, MAX_FOLDERS, usable } = PN;
const periodKey = PN.key, comparePeriods = PN.compare;

/** The data folder from the environment or scope.config.json in `root`: { folder } or { error } (folder '' when none is set). */
function readConfig(root) {
  if (process.env.SCOPE_DATA_FOLDER) return { folder: path.resolve(process.env.SCOPE_DATA_FOLDER) };
  const file = path.join(root, 'scope.config.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { folder: '' }; }
  let cfg;
  // a Windows path is usually written with single backslashes, which JSON reads as escapes (\n, \t) or rejects:
  // every single backslash is taken as written, a doubled one stays as it is
  try { cfg = JSON.parse(text.replace(/\\\\|\\/g, (m) => (m.length === 2 ? m : '\\\\'))); } catch (e) { return { folder: '', error: `scope.config.json could not be read: ${e.message}` }; }
  const f = cfg && typeof cfg.dataFolder === 'string' ? cfg.dataFolder.trim() : '';
  return { folder: f ? path.resolve(root, f) : '' };
}

/**
 * Every period under `folder`, oldest first: { id: 'Q2 2026/May' (always with /), parts, files: [{ name, size, modified }] }.
 * The data folder itself is a period too (id '') when workbooks sit directly in it.
 */
function listPeriods(folder) {
  const out = [];
  let seen = 0;
  (function walk(dir, parts) {
    if (++seen > MAX_FOLDERS) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    const files = [];
    for (const e of entries) {
      if (!usable(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isFile() && EXT.test(e.name)) { try { const st = fs.statSync(p); files.push({ name: e.name, size: st.size, modified: st.mtime.toISOString() }); } catch (err) { /* gone since the listing */ } }
    }
    if (files.length) out.push({ id: parts.join('/'), parts: parts.slice(), files: files.sort((a, b) => a.name.localeCompare(b.name)) });
    if (parts.length >= MAX_DEPTH) return;
    for (const e of entries) if (usable(e.name) && e.isDirectory()) walk(path.join(dir, e.name), parts.concat(e.name));
  })(folder, []);
  return out.sort(comparePeriods);
}

/** Absolute path of one file of one period, or null when the request leaves the data folder or names no input file. */
function resolveFile(folder, id, name) {
  const parts = String(id || '').split('/').filter(Boolean);
  if (!name || !EXT.test(name) || !usable(name) || /[\\/]/.test(name) || name.includes('\0')) return null;
  if (parts.length > MAX_DEPTH || parts.some((p) => p === '.' || p === '..' || !usable(p) || p.includes('\\') || p.includes('\0'))) return null;
  const file = path.resolve(folder, ...parts, name);
  const rel = path.relative(path.resolve(folder), file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

module.exports = { readConfig, listPeriods, resolveFile, periodKey, comparePeriods };
