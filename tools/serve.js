#!/usr/bin/env node
/* Zero-dependency static server for Scope.
 *
 *   node tools/serve.js [port]          (default 8130; also reads $PORT)
 *   HOST=0.0.0.0 node tools/serve.js    (listen on every interface; the default is this machine only)
 *
 * Optional: the app also runs from a double-clicked index.html. Serving it over HTTP lets the store fetch
 * data/demo/*.csv directly instead of the embedded copy in data/demo.js. Responses carry Cache-Control:
 * no-store so edited files are always picked up. Only GET and HEAD are served, only files inside the project
 * folder, and never hidden files or folders (names starting with a dot).
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +(process.argv[2] || process.env.PORT || 8130);
const HOST = process.env.HOST || '127.0.0.1';
// When the app is published under a sub-path by a reverse proxy (e.g. https://host/scope/), that prefix is stripped.
const BASE_PATH = (process.env.BASE_PATH || '/scope').replace(/\/+$/, '');

// Content types for the file kinds in the project; anything else is served as application/octet-stream.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

/** Send a short plain-text response. */
function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

/** Resolve a request URL to a file path inside ROOT, or null when it must be refused. */
function resolvePath(url) {
  let p;
  try { p = decodeURIComponent(String(url).split('?')[0].split('#')[0]); } catch (e) { return null; } // malformed %-encoding
  if (p.includes('\0')) return null;
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(BASE_PATH + '/'))) p = p.slice(BASE_PATH.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(ROOT, '.' + path.posix.normalize('/' + p));
  const rel = path.relative(ROOT, file);
  // refuse anything outside ROOT ("../" traversal, sibling folders) and any hidden path segment (.git, .env, …)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) return null;
  return file;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
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
