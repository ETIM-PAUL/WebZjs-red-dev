import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2]; const PORT = +process.argv[3] || 8090;
const T = {'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.ts':'text/plain'};
http.createServer((q,r)=>{
  const u = decodeURIComponent(q.url.split('?')[0]);
  // /h/* serves the harness's own files (worker script); everything else comes from the packages dir
  if (u.startsWith('/h/')) { const hf = path.join(import.meta.dirname, u.slice(3)); if (!hf.startsWith(import.meta.dirname)) { r.writeHead(403); return r.end(); } return fs.readFile(hf, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, {'content-type': T[path.extname(hf)] || 'application/octet-stream','cross-origin-embedder-policy':'require-corp','cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin'}); r.end(b); }); }
  let f0 = path.join(ROOT,u); if(u!=='/' && fs.existsSync(f0) && fs.statSync(f0).isDirectory()){ const pj=JSON.parse(fs.readFileSync(path.join(f0,'package.json'))); const m=pj.module||pj.main; q.url=path.posix.join(u,m); }
  const u2 = decodeURIComponent(q.url.split('?')[0]);
  const f = u2 === '/' ? path.join(import.meta.dirname,'index.html') : path.join(ROOT,u2);
  if(!f.startsWith(ROOT) && !f.startsWith(import.meta.dirname)){r.writeHead(403);return r.end();}
  fs.readFile(f,(e,b)=>{ if(e){r.writeHead(404);return r.end();}
    r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream','cross-origin-embedder-policy':'require-corp','cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin'}); r.end(b);});
}).listen(PORT,'127.0.0.1');
