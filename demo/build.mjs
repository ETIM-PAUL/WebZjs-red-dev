// Assemble the static demo into ./dist from this folder and the built wasm packages
// (run `just build` in the repo root first). Output is plain files: host it anywhere that can
// send the two cross-origin-isolation headers listed in dist/_headers (Netlify reads that file).
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const pkgs = path.join(here, '..', 'packages');
const dist = path.join(here, 'dist');

const need = [
  ['webzjs-wallet', ['webzjs_wallet.js', 'webzjs_wallet_bg.wasm', 'snippets']],
  ['webzjs-keys', ['webzjs_keys.js', 'webzjs_keys_bg.wasm']],
];
for (const [pkg, files] of need) {
  for (const f of files) {
    if (!fs.existsSync(path.join(pkgs, pkg, f))) {
      console.error(`Missing packages/${pkg}/${f}. Run \`just build\` in the repository root first.`);
      process.exit(1);
    }
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join(here, f), path.join(dist, f));
fs.cpSync(path.join(here, 'src'), path.join(dist, 'src'), { recursive: true });
for (const [pkg, files] of need) {
  for (const f of files) fs.cpSync(path.join(pkgs, pkg, f), path.join(dist, pkg, f), { recursive: true });
}

// The generated worker helpers import the package by directory ("../../.."), which only works
// when the server maps a directory to the package's main file. Point them at the file instead so
// any static host works.
let patched = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js') && p.includes(`${path.sep}snippets${path.sep}`)) {
      const src = fs.readFileSync(p, 'utf8');
      const out = src
        .replace(/import\('((?:\.\.\/)+\.\.)'\)/g, (_, d) => `import('${d}/webzjs_wallet.js')`)
        .replace(/from "((?:\.\.\/)+)"/g, (_, d) => `from "${d}webzjs_wallet.js"`);
      if (out !== src) { fs.writeFileSync(p, out); patched++; }
    }
  }
})(path.join(dist, 'webzjs-wallet', 'snippets'));
if (patched !== 2) { console.error(`Expected to patch 2 worker helper files, patched ${patched}.`); process.exit(1); }

fs.writeFileSync(path.join(dist, '_headers'), `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
`);
const mb = (fs.statSync(path.join(dist, 'webzjs-wallet', 'webzjs_wallet_bg.wasm')).size / 1e6).toFixed(0);
console.log(`demo/dist ready (wallet wasm ${mb} MB).`);
