// Phase 10: live NU7-testnet test of the multi-payment + memo API. Nothing is mocked.
// Prints only PASS/FAIL, public txids and heights. Never prints seeds, addresses, memo contents or balances (plan rule 7).
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// Repo root (this folder's parent) and the throwaway testnet seeds, kept outside every repo.
const ROOT = path.resolve(import.meta.dirname, '..');
const SEEDS_FILE = process.env.SEEDS_FILE || path.join(os.homedir(), '.zecathon-secrets', 'testnet-seeds.json');
const require = createRequire(path.join(ROOT, 'packages/e2e-tests/'));
const { chromium } = require('@playwright/test');

const LWD = 'https://zjs.zec.rocks/testnet';
const SVC = LWD + '/cash.z.wallet.sdk.rpc.CompactTxStreamer/';
const SECRETS = SEEDS_FILE;
const STATE = path.join(import.meta.dirname, 'phase10-state.json');   // public data only
const P8 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'phase8-state.json')));
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
const seeds = JSON.parse(fs.readFileSync(SECRETS));
const results = [];
const clean = (s) => String(s).replace(/\b(u|ztestsapling|tm|t1|utest)1[0-9a-z]{20,}/g, '<addr>').slice(0, 300);
const rec = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + clean(note) : ''}`); return ok; };
const stop = (why) => { console.log('\nGATE: stopping —', clean(why)); fs.writeFileSync(path.join(import.meta.dirname, 'phase10-results.json'), JSON.stringify(results, null, 1)); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function getTx(hashInternal) { const msg = Uint8Array.from([0x1a, 32, ...hashInternal]); const r = await grpc('GetTransaction', msg);
  if (r.status && r.status !== '0') return null; const p = parsePb(r.data[0] || new Uint8Array()); return p[1] ? { data: p[1], height: p[2] || 0 } : null; }
const hexDisplay = (internal) => Buffer.from(internal).reverse().toString('hex');

const browser = await chromium.launch({ channel: 'chrome' }); const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', clean(e)));
page.on('worker', (w) => { try { w.on('console', (m) => console.log('WORKER', m.type(), clean(m.text()))); } catch (e) {} });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('PAGE', m.type(), clean(m.text())); });
await page.goto('http://127.0.0.1:8090/'); await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
await page.evaluate(() => window.startWorker());
const call = (op, ...args) => page.evaluate(([o, a]) => window.rpc(o, a), [op, args]);
const total = (b) => b ? ['sapling_balance', 'orchard_balance', 'ironwood_balance', 'unshielded_balance', 'pending_change', 'pending_spendable'].reduce((s, k) => s + Number(b[k] || 0), 0) : 0;
const bal = async (name) => { const s = await call('summary', name); return s ? { tip: s.tip, scanned: s.scanned, b: (s.balances[0] || [0, null])[1] } : null; };
async function syncUntilTip(name) { for (let i = 0; i < 4; i++) { await call('sync', name); const s = await bal(name); if (s && s.scanned >= s.tip) return s; } return await bal(name); }

const V_TEXT = 150_000, V_BIN = 120_000, V_NONE = 110_000;     // zatoshis
const FEE_BOUND = 100_000;
const TEXT_MEMO = 'ZECATHON phase 10: text memo';
const BIN_MEMO = [0xff, 0x7a, 0x65, 0x63, 0x61, 0x74, 0x68, 0x6f, 0x6e, 0x00, 0x01, 0x02, 0xfe];   // 0xFF-led arbitrary data incl. a 0x00 inside

try {
  const info = await lightdInfo();
  rec('0. endpoint is the NU7 testnet', info.chain === 'test' && info.branch === '77190ad9', `chain=${info.chain} branch=0x${info.branch} tip=${info.height}`);
  if (!(info.chain === 'test' && info.branch === '77190ad9')) stop('endpoint is not on NU7 testnet');
  rec('0. wasm + thread pool initialised', await call('init', 4));

  // third throwaway recipient seed (stored outside every repo)
  if (seeds.length < 3) { seeds.push(await page.evaluate(() => window.api.generate_seed_phrase())); fs.writeFileSync(SECRETS, JSON.stringify(seeds), { mode: 0o600 }); }

  // ---- 1. wallet A (funded in Phase 8) restored from seed, synced ----
  await call('open', 'A', LWD, null);
  const idA = await call('createAccount', 'A', seeds[0], P8.birthday);
  let s = await syncUntilTip('A');
  rec('1. restore + sync the funded wallet', s && s.scanned >= s.tip, `scanned=${s?.scanned} tip=${s?.tip}`);
  const spendable = Number(s?.b?.ironwood_balance || 0) + Number(s?.b?.orchard_balance || 0) + Number(s?.b?.sapling_balance || 0);
  const need = V_TEXT + V_BIN + V_NONE + FEE_BOUND;
  rec('1. enough spendable shielded funds for the test', spendable >= need, `need>=${need} have>=need:${spendable >= need}`);
  if (spendable < need) stop('wallet A has too little spendable balance; fund it from the faucet and rerun');

  // ---- 2. recipients ----
  const tipNow = (await lightdInfo()).height;
  await call('open', 'B', LWD, null); const idB = await call('createAccount', 'B', seeds[1], state.bBirthday ?? (state.bBirthday = tipNow - 2)); save();
  await call('open', 'C', LWD, null); const idC = await call('createAccount', 'C', seeds[2], state.cBirthday ?? (state.cBirthday = tipNow - 2)); save();
  const addrB = await call('address', 'B', idB), addrC = await call('address', 'C', idC);
  const tAddr = await call('transparentAddress', 'A', idA);
  rec('2. recipient wallets B and C created', addrB.startsWith('utest1') && addrC.startsWith('utest1'));

  // ---- 3. typed errors reach JavaScript with stable codes (real wasm, real wallet) ----
  const ok1 = (to, extra = {}) => ({ to, value: 10_000, ...extra });
  const cases = [
    ['no_payments', []],
    ['invalid_address', [ok1('not-an-address')]],
    ['memo_for_transparent_recipient', [ok1(tAddr, { memo: { text: 'hi' } })]],
    ['memo_too_long', [ok1(addrB, { memo: { bytes: new Array(513).fill(0xff) } })]],
    ['memo_too_long', [ok1(addrB, { memo: { text: 'é'.repeat(257) } })]],            // 514 UTF-8 bytes, 257 characters
    ['invalid_memo_type', [ok1(addrB, { memo: { raw: 5 } })]],
    ['malformed_payment', [{ value: 1 }]],
    ['invalid_amount', [{ to: addrB, value: 1, valueRaw: 1.5 }]],
    ['invalid_amount', [{ to: addrB, value: 1, valueRaw: -1 }]],
    ['insufficient_funds', [{ to: addrB, value: 2_100_000_000_000_000 }]],
  ];
  for (const [code, payments] of cases) {
    const r = await call('tryPayments', 'A', idA, payments);
    rec(`3. rejects with code ${code}`, !r.ok && r.isError === true && r.code === code, `got ${r.ok ? 'success' : r.code}`);
  }
  const u = await call('tryUri', 'A', idA, 'zcash:not-a-real-request');
  rec('3. malformed ZIP-321 URI rejected with code invalid_uri', !u.ok && u.code === 'invalid_uri', `got ${u.code}`);

  // ---- 4. proposal: two recipients, three outputs ----
  const payments = [
    { to: addrB, value: V_TEXT, memo: { text: TEXT_MEMO } },
    { to: addrB, value: V_BIN, memo: { bytes: BIN_MEMO } },
    { to: addrC, value: V_NONE },
  ];
  // PCZT variants first (they only create the unsigned PCZT; nothing is sent)
  rec('4. pczt_create_payments builds a PCZT for the same payments', await call('pcztPayments', 'A', idA, payments));
  rec('4. existing pczt_create still works unchanged', await call('pcztTransfer', 'A', idA, addrC, 50_000));
  const prop = await call('proposePayments', 'A', idA, payments, 'p10');
  const outs = prop.steps.flatMap((st) => st.outputs);
  rec('4. proposal reports three outputs with the right memo kinds', outs.length === 3 && outs.map((o) => o.memoKind).join() === 'text,bytes,none', outs.map((o) => o.memoKind).join());
  rec('4. proposal reports amounts', outs.map((o) => o.value).join() === [V_TEXT, V_BIN, V_NONE].join());
  rec('4. raw memo is reported as the full 512 bytes', outs[1].memoLen === 512, `len=${outs[1].memoLen}`);
  const fee = Number(prop.fee);
  rec('4. proposal reports a ZIP 317 fee (multiple of 5000, plausible)', fee > 0 && fee % 5000 === 0 && fee <= FEE_BOUND && prop.fee === prop.describedFee, `fee=${fee}`);

  // ---- 5. build, prove, sign, broadcast ----
  const sBeforeA = await syncUntilTip('A'); const beforeTotal = total(sBeforeA?.b);
  const txidsInternal = await call('createAndSend', 'A', 'p10', seeds[0]);
  const txid = Uint8Array.from(txidsInternal.slice(0, 32)); state.multiTxid = hexDisplay(txid); save();
  rec('5. one transaction built, proved, signed and broadcast', txidsInternal.length === 32, `txid ${state.multiTxid}`);

  // ---- 6. mined ----
  let mined = null; for (let i = 0; i < 40 && !mined; i++) { const t = await getTx(txid); if (t && t.height > 0) mined = t; else await sleep(10000); }
  rec('6. transaction is mined', !!mined, mined ? `height ${mined.height}` : 'not mined in ~6.5 min');
  if (!mined) stop('multi-payment transaction was not mined');
  state.minedHeight = mined.height; save();
  const d = mined.data, dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  rec('6. transaction carries consensus branch id 0x77190ad9', dv.getUint32(8, true) === 0x77190ad9, `branch=0x${dv.getUint32(8, true).toString(16)}`);

  // ---- 7. both recipients receive their outputs ----
  let sB = null, sC = null;
  for (let i = 0; i < 12; i++) { sB = await syncUntilTip('B'); sC = await syncUntilTip('C'); if (total(sB?.b) >= V_TEXT + V_BIN && total(sC?.b) >= V_NONE) break; await sleep(15000); }
  rec('7. recipient B received both its outputs (exact total)', total(sB?.b) === V_TEXT + V_BIN, `ok=${total(sB?.b) === V_TEXT + V_BIN}`);
  rec('7. recipient C received its output (exact amount)', total(sC?.b) === V_NONE, `ok=${total(sC?.b) === V_NONE}`);
  const sAfterA = await syncUntilTip('A'); const spent = beforeTotal - total(sAfterA?.b);
  rec('7. sender balance fell by outputs + the reported fee', spent === V_TEXT + V_BIN + V_NONE + fee, `fee-matches=${spent === V_TEXT + V_BIN + V_NONE + fee}`);

  // ---- 8. memo read-back through today's history API ----
  // Known gaps (findings F13/F14), fixed in Phase 11, so these are reported as INFO and not as failures:
  //  F13: sync() scans compact blocks only and never fetches full transactions, so received memos are never decrypted.
  //  F14: history reports txids in internal byte order, not the order explorers display.
  const rev = (x) => x.match(/../g).reverse().join('');
  const histA = (await call('history', 'A', idA)).filter((h) => h.txid === rev(state.multiTxid));
  console.log(`INFO  8. sender history: entries=${histA.length}, text memo present=${histA.some((h) => h.memo === TEXT_MEMO)}`);
  const histB = (await call('history', 'B', idB)).filter((h) => h.txid === rev(state.multiTxid));
  console.log(`INFO  8. recipient history: entries=${histB.length}, text memo present=${histB.some((h) => h.memo === TEXT_MEMO)} (F13)`);
  console.log('NOTE: byte-for-byte read-back of the binary memo is Phase 11 (raw memo access).');
} catch (e) {
  rec('UNEXPECTED ERROR', false, e.message || e);
} finally {
  fs.writeFileSync(path.join(import.meta.dirname, 'phase10-results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length} checks, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
