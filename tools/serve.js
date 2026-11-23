#!/usr/bin/env node
/* Zero-dependency static server for Scope.
 *
 *   node tools/serve.js [port]          (default 8130; also reads $PORT)
 *   HOST=0.0.0.0 node tools/serve.js    (listen on every interface; the default is this machine only)
 *
 * Optional: the app also runs from a double-clicked index.html (the demo is embedded in data/demo.js, nothing is
 * fetched). Serving it over HTTP lets the tests fetch their fixture workbook and keeps browsers from caching old
 * copies of the scripts: responses carry Cache-Control: no-store so edited files are always picked up. Only GET and HEAD are served, only files inside the project
 * folder, and never hidden files or folders (names starting with a dot).
 *
 * The data folder (tools/data-folder.js): when scope.config.json names one, /source/periods lists its periods and
 * /source/file?period=<id>&name=<file> sends one workbook from it, so the Data page and the AUM comparison can load a
 * period without a file drop. The config is read on every request (edit it without restarting); scope.config.json
 * itself is never served.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const DATA = require('./data-folder');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || process.env.PORT || 8130);
const HOST = process.env.HOST || '127.0.0.1';
// When the app is published under a sub-path by a reverse proxy (e.g. https://host/scope/), that prefix is stripped.
const BASE_PATH = (process.env.BASE_PATH || '/scope').replace(/\/+$/, '');

// Content types for the file kinds in the project; anything else is served as application/octet-stream.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Send a short plain-text response. */
function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

/** Send a JSON response. */
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** The request path with the BASE_PATH prefix removed, or null when it is malformed. */
function requestPath(url) {
  let p;
  try { p = decodeURIComponent(String(url).split('?')[0].split('#')[0]); } catch (e) { return null; } // malformed %-encoding
  if (p.includes('\0')) return null;
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(BASE_PATH + '/'))) p = p.slice(BASE_PATH.length) || '/';
  return p;
}

/** /source/periods and /source/file: the periods of the data folder and one file of a period. */
function sourceRoute(req, res, p) {
  const cfg = DATA.readConfig(ROOT);
  if (p === '/source/periods') {
    if (!cfg.folder) return sendJson(res, 200, { configured: false, error: cfg.error || '' });
    let ok = false;
    try { ok = fs.statSync(cfg.folder).isDirectory(); } catch (e) { ok = false; }
    if (!ok) return sendJson(res, 200, { configured: true, folder: cfg.folder, name: path.basename(cfg.folder), periods: [], error: `The data folder ${cfg.folder} cannot be opened.` });
    return sendJson(res, 200, { configured: true, folder: cfg.folder, name: path.basename(cfg.folder), periods: DATA.listPeriods(cfg.folder) });
  }
  if (p === '/source/file') {
    const q = new URL(req.url, 'http://x').searchParams;
    const file = cfg.folder ? DATA.resolveFile(cfg.folder, q.get('period'), q.get('name')) : null;
    if (!file) return send(res, 404, 'not found');
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store', 'Last-Modified': st.mtime.toUTCString() });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  }
  return send(res, 404, 'not found');
}

/** Resolve a request URL to a file path inside ROOT, or null when it must be refused. */
function resolvePath(url) {
  const p0 = requestPath(url);
  if (p0 === null) return null;
  const p = p0.endsWith('/') ? p0 + 'index.html' : p0;
  const file = path.resolve(ROOT, '.' + path.posix.normalize('/' + p));
  const rel = path.relative(ROOT, file);
  // refuse anything outside ROOT ("../" traversal, sibling folders) and any hidden path segment (.git, .env, …)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) return null;
  if (rel === 'scope.config.json') return null; // the data folder's location stays on this machine
  return file;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  const p = requestPath(req.url);
  if (p && p.startsWith('/source/')) return sourceRoute(req, res, p);
  const file = resolvePath(req.url);
  if (!file) return send(res, 403, 'forbidden');
  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
});

// A clear message instead of a stack trace when the port is taken.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Try: node tools/serve.js ${PORT + 1}`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => console.log(`Scope running at http://localhost:${PORT}/  (Ctrl+C to stop)`));
