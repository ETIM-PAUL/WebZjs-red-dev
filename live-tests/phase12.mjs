// Phase 12: live check of the network-upgrade check, real wasm and real servers. Prints no seeds or addresses.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'packages/e2e-tests/'));
const { chromium } = require('@playwright/test');
const TEST = 'https://zjs.zec.rocks/testnet', MAIN = 'https://zjs.zec.rocks/mainnet';
const results = [];
const rec = (name, ok, note = '') => { results.push({ name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + String(note).slice(0, 240) : ''}`); return ok; };
const info = (s) => console.log('INFO  ' + s);
const dts = fs.readFileSync(path.join(ROOT, 'packages/webzjs-wallet/webzjs_wallet.d.ts'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome' }); const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:8090/'); await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
const call = (op, ...args) => page.evaluate(([o, a]) => window.rpc(o, a), [op, args]);
const show = (s) => `branch=${s.chain_branch_id} height=${s.chain_height} next=${s.next_upgrade ? `${s.next_upgrade.name}@${s.next_upgrade.height}(${s.next_upgrade.source},lib=${s.next_upgrade.supported_by_library})` : 'none'} warnings=${s.warnings.length}`;
try {
  await call('init', 4);
  rec('0. typings declare getNetworkStatus(): Promise<NetworkStatus>', /getNetworkStatus\(\): Promise<NetworkStatus>/.test(dts) && /export interface NetworkStatus/.test(dts) && /export interface UnsupportedNetworkUpgradeError/.test(dts));

  // 1. the NU7 testnet build against the NU7 testnet: supported
  await call('openNet', 'T', 'test', TEST);
  const t = await call('netStatus', 'T');
  rec('1. testnet wallet vs testnet server: supported', t.supported === true, show(t));
  rec('1. server branch is the NU7 branch the library expects', t.chain_branch_id === '77190ad9' && t.expected_branch_id === '77190ad9');
  const k = t.known_upgrades;
  rec('1. known upgrades come from the library: newest is Nu7 at 4465026', t.newest_known_upgrade === 'Nu7' && k[k.length - 1].activation_height === 4465026 && k[0].name === 'Sprout', k.map((u) => u.name).join(','));
  info(`testnet server announces next upgrade: ${t.next_upgrade ? t.next_upgrade.name + ' @ ' + t.next_upgrade.height + ' (' + t.next_upgrade.source + ')' : 'none'}; warnings: ${JSON.stringify(t.warnings)}`);

  // 2. mainnet wallet vs mainnet server: a second real "match"
  await call('openNet', 'M', 'main', MAIN);
  const m = await call('netStatus', 'M');
  rec('2. mainnet wallet vs mainnet server: supported (real match on mainnet)', m.supported === true, show(m));
  rec('2. mainnet: newest known upgrade is not Nu7 (no mainnet height yet)', m.newest_known_upgrade !== 'Nu7', m.newest_known_upgrade);
  info(`mainnet server announces next upgrade: ${m.next_upgrade ? m.next_upgrade.name + ' @ ' + m.next_upgrade.height + ' (' + m.next_upgrade.source + ')' : 'none'}; warnings: ${JSON.stringify(m.warnings)}`);

  // 3. a real mismatch: a testnet-configured wallet pointed at a mainnet server
  await call('openNet', 'X', 'test', MAIN);
  const x = await call('netStatus', 'X');
  rec('3. mismatch: getNetworkStatus reports supported=false and does not throw', x.supported === false, show(x));
  const r = await call('trySync', 'X');
  rec('3. mismatch: sync throws an Error with code unsupported_network_upgrade', r.ok === false && r.isError && r.code === 'unsupported_network_upgrade', JSON.stringify({ code: r.code }));
  rec('3. mismatch: error carries chain branch id, chain height and newest known upgrade', r.chain_branch_id === x.chain_branch_id && typeof r.chain_height === 'number' && r.chain_height > 0 && r.newest_known_upgrade === 'Nu7' && r.hasMessage, `branch=${r.chain_branch_id} height=${r.chain_height} newest=${r.newest_known_upgrade}`);
} catch (e) { rec('UNEXPECTED ERROR', false, e.message || e); }
finally {
  fs.writeFileSync(path.join(import.meta.dirname, 'phase12-results.json'), JSON.stringify(results, null, 1));
  console.log(`\n${results.length} checks, ${results.filter((r) => !r.ok).length} failed`);
  await browser.close(); process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
