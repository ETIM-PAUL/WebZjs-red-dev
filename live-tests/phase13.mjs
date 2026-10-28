// Phase 13: drive the real demo page (demo/dist) in Chrome against live NU7 testnet, through its UI.
// Prints only PASS/FAIL, txids and heights. Never prints seeds, addresses, memos or balances.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
// Repo root (this folder's parent) and the throwaway testnet seeds, kept outside every repo.
const ROOT = path.resolve(import.meta.dirname, '..');
const SEEDS_FILE = process.env.SEEDS_FILE || path.join(os.homedir(), '.zecathon-secrets', 'testnet-seeds.json');
const require = createRequire(path.join(ROOT, 'packages/e2e-tests/'));
const { chromium } = require('@playwright/test');
const DEMO = process.env.DEMO_URL || 'http://127.0.0.1:8091/';
const LWD_MAIN = 'https://zjs.zec.rocks/mainnet';
const seeds = JSON.parse(fs.readFileSync(SEEDS_FILE));
const P8 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'phase8-state.json')));
const P10 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'phase10-state.json')));
const OUT = path.join(import.meta.dirname, 'phase13-state.json');
const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const results = [];
const rec = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + String(note).slice(0, 200) : ''}`); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXT_MEMO = 'demo: hello from the UI';
const HEX_MEMO = 'ff4445 4d4f00a1';                       // typed with a space on purpose; bytes ff 44 45 4d 4f 00 a1
const HEX_BYTES = [0xff, 0x44, 0x45, 0x4d, 0x4f, 0x00, 0xa1];
const pad512 = (a) => { const o = new Array(512).fill(0); a.forEach((v, i) => (o[i] = v)); return o; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const browser = await chromium.launch({ channel: 'chrome' });

// ---- recipient addresses, from two throwaway wallets, using the library harness page ----
const aux = await browser.newPage();
await aux.goto('http://127.0.0.1:8090/'); await aux.waitForFunction(() => window.ready, null, { timeout: 30000 });
const acall = (op, ...args) => aux.evaluate(([o, a]) => window.rpc(o, a), [op, args]);
await acall('init', 4);
const LWD = 'https://zjs.zec.rocks/testnet';
await acall('open', 'B', LWD, null); const idB = await acall('createAccount', 'B', seeds[1], P10.bBirthday); const addrB = await acall('address', 'B', idB);
await acall('open', 'C', LWD, null); const idC = await acall('createAccount', 'C', seeds[2], P10.cBirthday); const addrC = await acall('address', 'C', idC);

try {
  // ---- unsupported network: a testnet wallet pointed at a mainnet server ----
  {
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    await p.goto(`${DEMO}?lwd=${encodeURIComponent(LWD_MAIN)}`); await p.waitForFunction(() => window.__demoReady, null, { timeout: 120000 });
    const cls = await p.locator('#banner').getAttribute('class');
    rec('1. banner turns red on an unsupported chain', cls.includes('bad') && /Unsupported network upgrade/.test(await p.locator('#banner').innerText()));
    rec('1. sending is disabled while the chain is unsupported', await p.locator('#propose').isDisabled());
    await p.screenshot({ path: path.join(import.meta.dirname, 'phase13-unsupported.png'), fullPage: true });
    await ctx.close();
  }

  // ---- supported network: the funded wallet from Phase 8, put in the page's storage ----
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
  await page.addInitScript(([seed, birthday]) => { localStorage.setItem('webzjs-demo-testnet-seed', seed); localStorage.setItem('webzjs-demo-testnet-birthday', String(birthday)); }, [seeds[0], P8.birthday]);
  await page.goto(DEMO); await page.waitForFunction(() => window.__demoReady, null, { timeout: 180000 });
  await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-status').textContent), null, { timeout: 300000 });
  const banner = await page.locator('#banner').innerText();
  rec('2. banner is green and names the supported upgrade', (await page.locator('#banner').getAttribute('class')).includes('ok') && /Nu7/.test(banner), banner.replace(/\n/g, ' | '));
  rec('2. wallet shows a testnet address', /^utest1/.test(await page.locator('#address').innerText()));
  const balText = await page.locator('#balance').innerText();
  rec('2. wallet has a spendable balance', /^[1-9]|^0\.[0-9]*[1-9]/.test(balText));

  // ---- send form: three payments, two recipients ----
  const fill = async (i, to, amount, kind, memo) => {
    const row = page.locator('.row').nth(i);
    await row.locator('input.to').fill(to); await row.locator('input.amount').fill(amount);
    await row.locator('select').selectOption(kind);
    if (kind !== 'none') await page.locator('.row').nth(i).locator('.memo-line input').fill(memo);
  };
  await fill(0, addrB, '0.0012', 'text', TEXT_MEMO);
  await page.click('#add-row'); await fill(1, addrC, '0.0011', 'hex', HEX_MEMO);
  await page.click('#add-row'); await fill(2, addrB, '0.0010', 'none', '');
  await page.screenshot({ path: path.join(import.meta.dirname, 'phase13-form.png'), fullPage: true });

  // a bad memo is rejected before anything is sent, with a readable reason
  await page.locator('.row').nth(1).locator('.memo-line input').fill('zz');
  await page.click('#propose');
  rec('3. a bad hex memo is refused with a clear message', /hex memo/.test(await page.locator('#result').innerText()));
  await page.locator('.row').nth(1).locator('.memo-line input').fill(HEX_MEMO);

  await page.click('#propose');
  await page.waitForSelector('#review table', { timeout: 120000 });
  const review = await page.locator('#review').innerText();
  rec('3. review lists the three outputs, the text memo, the binary memo and the fee', /text/.test(review) && /binary, 512 B on chain/.test(review) && review.includes(TEXT_MEMO) && /0xff44454d4f00a1/.test(review) && /Network fee \(ZIP 317\): 0\.0002 TAZ/.test(review), review.replace(/\s+/g, ' ').replace(/u(test)?1[0-9a-z…]+/g, '<addr>'));
  await page.screenshot({ path: path.join(import.meta.dirname, 'phase13-review.png'), fullPage: true });
  await page.click('#send-now');
  await page.waitForSelector('#sent-txid', { timeout: 600000 });
  const txid = (await page.locator('#sent-txid').innerText()).replace('txid ', '');
  state.demoTxid = txid; fs.writeFileSync(OUT, JSON.stringify(state, null, 1));
  rec('4. the UI sent one transaction', /^[0-9a-f]{64}$/.test(txid), `txid ${txid}`);

  // ---- mined, and the history view shows the memos ----
  let hist = '';
  for (let i = 0; i < 40; i++) {
    await page.click('#sync'); await page.waitForFunction(() => !document.getElementById('sync').disabled, null, { timeout: 300000 });
    hist = await page.locator('#history-list').innerText();
    if (hist.includes(txid) && /confirmed/.test(hist.split(txid)[0].split('\n').slice(-3).join(' ') + hist.split(txid)[1].slice(0, 400)) ) break;
    await sleep(15000);
  }
  rec('5. history lists the transaction as confirmed', hist.includes(txid) && /confirmed/.test(hist));
  rec('5. history shows the text memo as text', hist.includes(TEXT_MEMO));
  rec('5. history shows the binary memo as hex', /0xff44454d4f00a1/.test(hist));
  rec('5. history shows the output without a memo', /no memo/.test(hist));
  await page.screenshot({ path: path.join(import.meta.dirname, 'phase13-history.png'), fullPage: true });

  // ---- recipients read the same bytes through the library ----
  const internal = txid.match(/../g).reverse().join('');
  let b = null, c = null;
  for (let i = 0; i < 12 && !(b && c); i++) {
    for (const n of ['B', 'C']) { for (let k = 0; k < 3; k++) await acall('sync', n); }
    b = await acall('txOutputs', 'B', idB, internal); c = await acall('txOutputs', 'C', idC, internal);
    if (!(b && c)) await sleep(15000);
  }
  const bo = (b?.outputs ?? []).filter((o) => o.direction === 'received');
  rec('6. recipient B received the text memo and the no-memo output', bo.some((o) => o.type === 'text' && o.text === TEXT_MEMO) && bo.some((o) => o.type === 'empty'), bo.map((o) => o.type).join());
  const co = (c?.outputs ?? []).filter((o) => o.direction === 'received');
  rec('6. recipient C read the binary memo byte-for-byte', co.some((o) => o.type === 'arbitrary' && same(o.bytes, pad512(HEX_BYTES))), co.map((o) => o.type).join());
} catch (e) { rec('UNEXPECTED ERROR', false, e.message || e); }
finally {
  fs.writeFileSync(path.join(import.meta.dirname, 'phase13-results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length} checks, ${results.filter((r) => !r.ok).length} failed`);
  await browser.close(); process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
