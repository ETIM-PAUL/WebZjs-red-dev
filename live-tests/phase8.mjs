// Phase 8: live NU7-testnet verification of the ported WebZjs. Nothing is mocked.
// Prints only PASS/FAIL, public txids and heights. Never prints seeds, addresses or amounts (plan rule 7).
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// Repo root (this folder's parent) and the throwaway testnet seeds, kept outside every repo.
const ROOT = path.resolve(import.meta.dirname, '..');
const SEEDS_FILE = process.env.SEEDS_FILE || path.join(os.homedir(), '.zecathon-secrets', 'testnet-seeds.json');
const require = createRequire(path.join(ROOT, 'packages/e2e-tests/'));
const { chromium } = require('@playwright/test');

const LWD = 'https://zjs.zec.rocks/testnet';
const SVC = LWD + '/cash.z.wallet.sdk.rpc.CompactTxStreamer/';
const FAUCET = 'https://faucet.testnet.valargroup.dev';
const STATE = path.join(import.meta.dirname, 'phase8-state.json');   // public data only
const SEND_ZAT = 2_000_000;                                           // sent from wallet A to wallet B
const FEE_BOUND = 100_000;
const seeds = JSON.parse(fs.readFileSync(SEEDS_FILE));
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
const results = [];
const clean = (s) => String(s).replace(/\b(u|ztestsapling|tm|t1|utest)1[0-9a-z]{20,}/g, '<addr>').slice(0, 300);
const rec = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + clean(note) : ''}`); return ok; };
const stop = (why) => { console.log('\nGATE: stopping —', clean(why)); fs.writeFileSync(path.join(import.meta.dirname, 'phase8-results.json'), JSON.stringify(results, null, 1)); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- minimal grpc-web helpers (independent of our code) ----
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Uint8Array.from(o); };
async function grpc(method, msg = new Uint8Array()) {
  const body = new Uint8Array(5 + msg.length); new DataView(body.buffer).setUint32(1, msg.length); body.set(msg, 5);
  const r = await fetch(SVC + method, { method: 'POST', headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' }, body });
  const buf = new Uint8Array(await r.arrayBuffer()); const dv = new DataView(buf.buffer); const frames = []; let i = 0;
  while (i + 5 <= buf.length) { const flag = buf[i], len = dv.getUint32(i + 1); frames.push({ flag, data: buf.slice(i + 5, i + 5 + len) }); i += 5 + len; }
  const trailer = frames.find((f) => f.flag & 0x80); const status = trailer ? new TextDecoder().decode(trailer.data).match(/grpc-status:\s*(\d+)/)?.[1] : r.headers.get('grpc-status');
  return { http: r.status, status, data: frames.filter((f) => !(f.flag & 0x80)).map((f) => f.data) };
}
function parsePb(d) { const o = {}; let i = 0; const rv = () => { let s = 0, v = 0; for (;;) { const c = d[i++]; v += (c & 127) * 2 ** s; s += 7; if (!(c & 128)) return v; } };
  while (i < d.length) { const k = rv(), f = k >> 3, w = k & 7; if (w === 0) o[f] = rv(); else if (w === 2) { const l = rv(); o[f] = d.slice(i, i + l); i += l; } else break; } return o; }
async function lightdInfo() { const r = await grpc('GetLightdInfo'); const p = parsePb(r.data[0]); return { height: p[7], branch: new TextDecoder().decode(p[6]), chain: new TextDecoder().decode(p[4]) }; }
async function getTx(hashInternal) { // TxFilter { bytes hash = 3 }
  const msg = Uint8Array.from([0x1a, 32, ...hashInternal]); const r = await grpc('GetTransaction', msg);
  if (r.status && r.status !== '0') return null; const p = parsePb(r.data[0] || new Uint8Array()); return p[1] ? { data: p[1], height: p[2] || 0 } : null; }
const hexDisplay = (internal) => Buffer.from(internal).reverse().toString('hex');   // txid as shown by explorers

// ---- browser + worker ----
const browser = await chromium.launch({ channel: 'chrome' }); const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', clean(e)));
// Panic messages from the wallet worker and its rayon thread-pool workers (console_error_panic_hook writes there).
const wlog = (w, tag) => { try { w.on('console', (m) => console.log(tag, m.type(), clean(m.text()))); } catch (e) { console.log('no worker console support:', e.message); } };
page.on('worker', (w) => wlog(w, 'WORKER'));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('PAGE', m.type(), clean(m.text())); });
await page.goto('http://127.0.0.1:8090/'); await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
await page.evaluate(() => window.startWorker());
const call = (op, ...args) => page.evaluate(([o, a]) => window.rpc(o, a), [op, args]);
const total = (b) => b ? ['sapling_balance', 'orchard_balance', 'ironwood_balance', 'unshielded_balance', 'pending_change', 'pending_spendable'].reduce((s, k) => s + Number(b[k] || 0), 0) : 0;
const bal = async (name) => { const s = await call('summary', name); return s ? { tip: s.tip, scanned: s.scanned, b: (s.balances[0] || [0, null])[1] } : null; };
const pools = (b) => ({ ironwood: Number(b?.ironwood_balance || 0) > 0, orchard: Number(b?.orchard_balance || 0) > 0, sapling: Number(b?.sapling_balance || 0) > 0, pending: Number(b?.pending_spendable || 0) > 0 });
async function syncUntilTip(name) { for (let i = 0; i < 4; i++) { await call('sync', name); const s = await bal(name); if (s && s.scanned >= s.tip) return s; } return await bal(name); }

try {
  // ---- 0. environment ----
  const info = await lightdInfo();
  rec('0. endpoint is the NU7 testnet', info.chain === 'test' && info.branch === '77190ad9', `chain=${info.chain} branch=0x${info.branch} tip=${info.height}`);
  if (!(info.chain === 'test' && info.branch === '77190ad9')) stop('endpoint is not on NU7 testnet');
  rec('0. wasm + thread pool initialised', await call('init', 4));
  state.birthday ??= info.height - 5; save();

  // ---- 1. create wallet A from seed A (fresh WebWallet) ----
  await call('open', 'A', LWD, null);
  const idA = await call('createAccount', 'A', seeds[0], state.birthday);
  const addrA = await call('address', 'A', idA);
  rec('1. create wallet + unified address', typeof addrA === 'string' && addrA.startsWith('utest1'), `address length ${addrA.length}`);

  // ---- 2. sync to tip ----
  let s = await syncUntilTip('A');
  rec('2. sync to chain tip (library runs it in its own Web Worker)', s && s.scanned >= s.tip, `scanned=${s?.scanned} tip=${s?.tip}`);

  // ---- 3. receive faucet funds ----
  if (!state.claimTxid) {
    const r = await fetch(FAUCET + '/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: addrA }) });
    if (r.status !== 202) stop(`faucet refused the claim: HTTP ${r.status} ${clean(await r.text())}`);
    const j = await r.json(); state.claimId = j.id; save();
    for (let i = 0; i < 40 && !state.claimTxid; i++) { await sleep(5000); const q = await (await fetch(`${FAUCET}/api/claim/${state.claimId}`)).json();
      if (q.status === 'failed' || q.status === 'review') stop(`faucet claim ended as ${q.status}`);
      if (q.txid) { state.claimTxid = q.txid; save(); } }
    if (!state.claimTxid) stop('faucet claim produced no txid within 200 s');
  }
  rec('3. faucet payout sent', !!state.claimTxid, `txid ${state.claimTxid}`);
  let funded = null;
  for (let i = 0; i < 30; i++) { s = await syncUntilTip('A'); if (total(s?.b) > 0) { funded = s; break; } await sleep(15000); }
  rec('3. wallet sees the faucet funds', !!funded, funded ? `pools ${JSON.stringify(pools(funded.b))}` : 'no balance after 7.5 min');
  if (!funded) stop('faucet funds never appeared in the wallet (could be our scan path or the chain: investigate before continuing)');
  rec('3. funds are in the Ironwood pool (current shielded pool)', pools(funded.b).ironwood || (funded.b && Number(funded.b.pending_spendable) > 0), JSON.stringify(pools(funded.b)));
  // wait until spendable (confirmations)
  for (let i = 0; i < 20 && !Number(funded.b.ironwood_balance) ; i++) { await sleep(15000); funded = await syncUntilTip('A'); }
  rec('3. funds become spendable in Ironwood', Number(funded.b.ironwood_balance) > 0, JSON.stringify(pools(funded.b)));
  const startTotal = total(funded.b);

  // ---- 4. save/load round trip with real Ironwood notes (format v2) ----
  const bytes = await call('dump', 'A'); await call('open', 'A2', LWD, bytes);
  const s2 = await bal('A2');
  rec('4. serialized wallet (v2) reloads with the same balance', s2 && total(s2.b) === startTotal, `bytes=${bytes.length}`);

  // ---- 5. restore from seed in a brand-new wallet ----
  await call('open', 'A3', LWD, null); const idA3 = await call('createAccount', 'A3', seeds[0], state.birthday);
  rec('5. restore from seed gives the same address', (await call('address', 'A3', idA3)) === addrA);
  const s3 = await syncUntilTip('A3');
  rec('5. restored wallet finds the same funds', s3 && total(s3.b) === startTotal);

  // ---- 6. send a shielded payment A -> B ----
  const tipNow = (await lightdInfo()).height;
  await call('open', 'B', LWD, null); const idB = await call('createAccount', 'B', seeds[1], tipNow - 2);
  const addrB = await call('address', 'B', idB);
  await call('propose', 'A', idA, addrB, SEND_ZAT, 'p1');
  rec('6. propose a shielded payment', true);
  const txidsInternal = await call('createAndSend', 'A', 'p1', seeds[0]);
  const txid = Uint8Array.from(txidsInternal.slice(0, 32)); state.sendTxid = hexDisplay(txid); save();
  rec('6. build, sign, prove and broadcast', txidsInternal.length === 32, `txid ${state.sendTxid}`);

  // ---- 7. mined? ----
  let mined = null; for (let i = 0; i < 40 && !mined; i++) { const t = await getTx(txid); if (t && t.height > 0) mined = t; else await sleep(10000); }
  rec('7. transaction is mined', !!mined, mined ? `height ${mined.height}` : 'not mined in ~6.5 min');
  if (!mined) stop('sent transaction was not mined (network rejection would show as a broadcast error above)');

  // ---- 8. second wallet sees it ----
  let sB = null; for (let i = 0; i < 12; i++) { sB = await syncUntilTip('B'); if (total(sB?.b) >= SEND_ZAT) break; await sleep(15000); }
  rec('8. second wallet receives exactly the amount sent', total(sB?.b) === SEND_ZAT, `pools ${JSON.stringify(pools(sB?.b))}`);
  const sA = await syncUntilTip('A'); const spent = startTotal - total(sA?.b);
  rec('8. sender balance fell by amount + a plausible fee', spent >= SEND_ZAT && spent <= SEND_ZAT + FEE_BOUND, `fee-ok=${spent - SEND_ZAT >= 0 && spent - SEND_ZAT <= FEE_BOUND}`);

  // ---- 9. decode the transaction we built: header branch id ----
  const t = await getTx(txid); const d = t.data; const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const header = dv.getUint32(0, true), group = dv.getUint32(4, true), branch = dv.getUint32(8, true);
  rec('9. built transaction carries consensus branch id 0x77190ad9', branch === 0x77190ad9, `branch=0x${branch.toString(16)} version=${header & 0x7fffffff} overwintered=${!!(header >>> 31)} group=0x${group.toString(16)}`);

  // ---- 10. shielding transparent funds ----
  rec('10. shield transparent funds', true, 'NOT APPLICABLE: the faucet pays shielded, so there are no transparent funds to shield');
} catch (e) {
  rec('UNEXPECTED ERROR', false, e.message || e);
} finally {
  fs.writeFileSync(path.join(import.meta.dirname, 'phase8-results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length} checks, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
