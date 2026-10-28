// Phase 11: raw memo access, verified against the real Phase 10 transaction on NU7 testnet. No new spend.
// Prints only PASS/FAIL. Never prints seeds, addresses, memo contents or balances (plan rule 7).
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// Repo root (this folder's parent) and the throwaway testnet seeds, kept outside every repo.
const ROOT = path.resolve(import.meta.dirname, '..');
const SEEDS_FILE = process.env.SEEDS_FILE || path.join(os.homedir(), '.zecathon-secrets', 'testnet-seeds.json');
const require = createRequire(path.join(ROOT, 'packages/e2e-tests/'));
const { chromium } = require('@playwright/test');
const LWD = 'https://zjs.zec.rocks/testnet';
const seeds = JSON.parse(fs.readFileSync(SEEDS_FILE));
const P8 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'phase8-state.json')));
const P10 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'phase10-state.json')));
const results = [];
const rec = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + String(note).slice(0, 200) : ''}`); return ok; };
const rev = (x) => x.match(/../g).reverse().join('');
const TXID = rev(P10.multiTxid);                       // history uses internal byte order
const TEXT_MEMO = 'ZECATHON phase 10: text memo';
const BIN = [0xff, 0x7a, 0x65, 0x63, 0x61, 0x74, 0x68, 0x6f, 0x6e, 0x00, 0x01, 0x02, 0xfe];
const pad512 = (a) => { const o = new Array(512).fill(0); a.forEach((v, i) => (o[i] = v)); return o; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const textBytes = pad512([...Buffer.from(TEXT_MEMO)]);
const emptyBytes = pad512([0xf6]);

const browser = await chromium.launch({ channel: 'chrome' }); const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:8090/'); await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
const call = (op, ...args) => page.evaluate(([o, a]) => window.rpc(o, a), [op, args]);
async function syncTo(name) { for (let i = 0; i < 4; i++) { await call('sync', name); const s = await call('summary', name); if (s && s.scanned >= s.tip) return; } }
try {
  await call('init', 4);
  // ---- recipient B: sees two received outputs ----
  await call('open', 'B', LWD, null); const idB = await call('createAccount', 'B', seeds[1], P10.bBirthday);
  await syncTo('B');
  const b = await call('txOutputs', 'B', idB, TXID);
  rec('1. recipient history lists the Phase 10 transaction', !!b);
  const bo = (b?.outputs ?? []).filter((o) => o.direction === 'received');
  rec('1. two received outputs', bo.length === 2, `n=${bo.length}`);
  const t = bo.find((o) => o.type === 'text'), a = bo.find((o) => o.type === 'arbitrary');
  rec('1. one is a text memo, one is arbitrary data', !!t && !!a, bo.map((o) => o.type).join());
  rec('1. text memo: decoded text is exact', t?.text === TEXT_MEMO);
  rec('1. text memo: raw bytes are the full 512, byte-for-byte', !!t && t.bytes.length === 512 && same(t.bytes, textBytes));
  rec('1. binary memo: raw bytes read back byte-for-byte (512, zero padded)', !!a && a.bytes.length === 512 && same(a.bytes, pad512(BIN)));
  rec('1. binary memo has no decoded text', a?.text === null);
  rec('1. raw bytes arrive in JavaScript as a Uint8Array', !!t && !!a && t.isU8 && a.isU8);
  rec('1. existing text field still works', b?.memo === TEXT_MEMO);

  // ---- recipient C: output without a memo ----
  await call('open', 'C', LWD, null); const idC = await call('createAccount', 'C', seeds[2], P10.cBirthday);
  await syncTo('C');
  const c = await call('txOutputs', 'C', idC, TXID);
  const co = (c?.outputs ?? []).filter((o) => o.direction === 'received');
  rec('2. no-memo output reports type empty with 0xF6 padding', co.length === 1 && co[0].type === 'empty' && same(co[0].bytes, emptyBytes) && co[0].text === null, co.map((o) => o.type).join());
  rec('2. existing text field is null for it', c?.memo === null);

  // ---- sender restored from seed: reads the memos it sent, via its outgoing viewing key ----
  await call('open', 'A', LWD, null); const idA = await call('createAccount', 'A', seeds[0], P8.birthday);
  await syncTo('A');
  const s = await call('txOutputs', 'A', idA, TXID);
  const so = (s?.outputs ?? []).filter((o) => o.direction === 'sent');
  rec('3. sender sees three sent outputs', so.length === 3, `n=${so.length}`);
  rec('3. sent: text memo exact', so.some((o) => o.type === 'text' && o.text === TEXT_MEMO && same(o.bytes, textBytes)));
  rec('3. sent: binary memo byte-for-byte', so.some((o) => o.type === 'arbitrary' && same(o.bytes, pad512(BIN))));
  rec('3. sent: no-memo output is empty', so.some((o) => o.type === 'empty' && same(o.bytes, emptyBytes)));

  // ---- memos survive save + reload ----
  const bytes = await call('dump', 'B'); await call('open', 'B2', LWD, bytes);
  const r = await call('txOutputs', 'B2', idB, TXID);
  const ro = (r?.outputs ?? []).filter((o) => o.direction === 'received');
  rec('4. after save/reload the memos are still there, byte-for-byte', ro.length === 2 && ro.some((o) => o.type === 'arbitrary' && same(o.bytes, pad512(BIN))) && ro.some((o) => o.type === 'text' && o.text === TEXT_MEMO), `n=${ro.length}`);
} catch (e) { rec('UNEXPECTED ERROR', false, e.message || e); }
finally {
  fs.writeFileSync(path.join(import.meta.dirname, 'phase11-results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length} checks, ${results.filter((r) => !r.ok).length} failed`);
  await browser.close(); process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
