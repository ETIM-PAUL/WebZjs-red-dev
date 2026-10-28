// Serve ./dist (or the directory this file sits in, when deployed) with the headers the wallet's
// threads need (SharedArrayBuffer). Compresses text and wasm once per file and keeps the result in
// memory, because the wallet wasm is about 60 MB.
//
// Local:    node serve.mjs [port]        -> http://127.0.0.1:<port>/
// Hosted:   PORT is set by the host (Railway, Fly, Render, ...); binds all interfaces.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const here = import.meta.dirname;
const root = fs.existsSync(path.join(here, 'dist')) ? path.join(here, 'dist') : here;
const hosted = Boolean(process.env.PORT);
const port = Number(process.env.PORT || process.argv[2]) || 8080;
const host = hosted ? '0.0.0.0' : '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
const headers = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
const cache = new Map(); // file -> { raw, gzip?, br? }

function load(file) {
  let hit = cache.get(file);
  if (!hit) { hit = { raw: fs.readFileSync(file) }; cache.set(file, hit); }
  return hit;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, url === '/' ? 'index.html' : url);
  if (url.endsWith('/_headers') || !file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, headers);
    return res.end('not found');
  }
  const ext = path.extname(file);
  const entry = load(file);
  const accept = String(req.headers['accept-encoding'] || '');
  const out = { ...headers, 'content-type': types[ext] || 'application/octet-stream', vary: 'accept-encoding' };
  if (ext === '.wasm' || ext === '.js' || ext === '.css' || ext === '.html') out['cache-control'] = 'public, max-age=300';
  let body = entry.raw;
  if (/\bbr\b/.test(accept)) {
    entry.br ??= zlib.brotliCompressSync(entry.raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.raw.length } });
    body = entry.br; out['content-encoding'] = 'br';
  } else if (/\bgzip\b/.test(accept)) {
    entry.gzip ??= zlib.gzipSync(entry.raw, { level: 6 });
    body = entry.gzip; out['content-encoding'] = 'gzip';
  }
  out['content-length'] = body.length;
  res.writeHead(200, out);
  res.end(body);
}).listen(port, host, () => console.log(`serving ${root} on http://${host}:${port}/`));
