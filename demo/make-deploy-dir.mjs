// Copy the built demo (./dist) plus its server into a standalone folder that can be uploaded to any
// Node host (for Railway: `railway up` from that folder). Kept out of git on purpose: it contains
// the 60 MB wallet wasm.
// Usage: node build.mjs && node make-deploy-dir.mjs <output-folder>
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const out = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('Usage: node make-deploy-dir.mjs <output-folder>'); process.exit(1); }
if (!fs.existsSync(path.join(here, 'dist', 'index.html'))) { console.error('Run `node build.mjs` first.'); process.exit(1); }
if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
  console.error(`${out} is not empty; choose a new or empty folder.`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(here, 'dist'), path.join(out, 'dist'), { recursive: true });
fs.copyFileSync(path.join(here, 'serve.mjs'), path.join(out, 'serve.mjs'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: 'webzjs-testnet-demo-site',
  private: true,
  type: 'module',
  scripts: { start: 'node serve.mjs' },
  engines: { node: '>=18' },
}, null, 2) + '\n');
console.log(`Deploy folder ready: ${out}`);
