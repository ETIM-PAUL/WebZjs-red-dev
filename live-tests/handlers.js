// Wallet driver for Phase 8. Runs on the page's MAIN thread: WebWallet.sync() asserts it is not called
// from a worker and spawns its own Web Worker for the scan (see bindgen/wallet.rs).
// Never logs seeds, addresses or amounts.
import initW, { initThreadPool, WebWallet } from '/webzjs-wallet/webzjs_wallet.js';
import initK from '/webzjs-keys/webzjs_keys.js';

const wallets = new Map();
const proposals = new Map();

export const H = {
  async init(threads) { await initW(); await initK(); await initThreadPool(threads); return true; },
  async open(name, url, bytes) { wallets.set(name, new WebWallet('test', url, 1, 1, bytes ? new Uint8Array(bytes) : null)); return true; },
  async createAccount(name, seed, birthday) { return await wallets.get(name).create_account('phase8', seed, 0, birthday); },
  async address(name, id) { return await wallets.get(name).get_current_address(id); },
  async sync(name) { await wallets.get(name).sync(); return true; },
  async summary(name) {
    const s = await wallets.get(name).get_wallet_summary();
    if (!s) return null;
    const balances = s.account_balances; // [[id, {sapling_balance, orchard_balance, ironwood_balance, ...}]]
    return { tip: s.chain_tip_height, scanned: s.fully_scanned_height, balances };
  },
  async dump(name) { return Array.from(await wallets.get(name).db_to_bytes()); },
  async propose(name, id, to, value, key) { proposals.set(key, await wallets.get(name).propose_transfer(id, to, BigInt(value))); return true; },
  async createAndSend(name, key, seed) {
    const w = wallets.get(name);
    const txids = await w.create_proposed_transactions(proposals.get(key), seed, 0);
    const out = Array.from(txids);
    await w.send_authorized_transactions(txids);
    return out;
  },
  // ---- Phase 10: multi-payment API ----
  // payments arrive as JSON: memo is {text} or {bytes:[...]}; converted to string / Uint8Array here.
  async proposePayments(name, id, payments, key) {
    const p = payments.map((x) => ({ to: x.to, value: BigInt(x.value), ...(x.memo === undefined ? {} : { memo: x.memo.text !== undefined ? x.memo.text : Uint8Array.from(x.memo.bytes) }) }));
    const prop = await wallets.get(name).propose_payments(id, p);
    proposals.set(key, prop);
    const d = prop.describe();
    return { fee: String(prop.fee), describedFee: String(d.fee), steps: d.steps.map((st) => ({ fee: String(st.fee),
      outputs: st.outputs.map((o) => ({ value: String(o.value), memoKind: o.memo === undefined ? 'none' : typeof o.memo === 'string' ? 'text' : (o.memo instanceof Uint8Array ? 'bytes' : '?'), memoLen: o.memo === undefined ? 0 : o.memo.length })),
      change: st.change.map((c) => ({ pool: c.pool, value: String(c.value) })) })) };
  },
  // Returns {code, message-less} so no address or memo can leak into the report.
  async tryPayments(name, id, payments) {
    try {
      const p = payments.map((x) => ({ ...x, value: x.valueRaw !== undefined ? x.valueRaw : BigInt(x.value), ...(x.memo === undefined ? {} : { memo: x.memo.text !== undefined ? x.memo.text : x.memo.bytes ? Uint8Array.from(x.memo.bytes) : x.memo.raw }) }));
      p.forEach((x) => { delete x.valueRaw; });
      await wallets.get(name).propose_payments(id, p); return { ok: true };
    } catch (e) { return { ok: false, code: e && e.code, isError: e instanceof Error }; }
  },
  async tryUri(name, id, uri) {
    try { await wallets.get(name).propose_from_zip321(id, uri); return { ok: true }; } catch (e) { return { ok: false, code: e && e.code }; }
  },
  async history(name, id) {
    const h = await wallets.get(name).get_transaction_history(id, 50, 0);
    return h.transactions.map((t) => ({ txid: t.txid, memo: t.memo ?? null, value: Number(t.value), status: t.status, height: t.block_height ?? null }));
  },
  async pcztPayments(name, id, payments) {
    const p = payments.map((x) => ({ to: x.to, value: BigInt(x.value), ...(x.memo === undefined ? {} : { memo: x.memo.text !== undefined ? x.memo.text : Uint8Array.from(x.memo.bytes) }) }));
    const z = await wallets.get(name).pczt_create_payments(id, p); return !!z;
  },
  async pcztTransfer(name, id, to, value) { return !!(await wallets.get(name).pczt_create(id, to, BigInt(value))); },
  async transparentAddress(name, id) { return await wallets.get(name).get_current_address_transparent(id); },
  async rawHistory(name, id) { const h = await wallets.get(name).get_transaction_history(id, 50, 0); return { total: h.total_count, tx: h.transactions }; },
  // Phase 11: history entry of one tx, with memo bytes as plain arrays and a flag for the JS type of memo_bytes.
  async txOutputs(name, id, txidInternal) {
    const h = await wallets.get(name).get_transaction_history(id, 100, 0);
    const e = h.transactions.find((t) => t.txid === txidInternal);
    if (!e) return null;
    return { memo: e.memo ?? null, outputs: e.outputs.map((o) => ({ pool: o.pool, index: o.output_index, direction: o.direction, value: o.value, type: o.memo_type,
      isU8: o.memo_bytes instanceof Uint8Array, bytes: Array.from(o.memo_bytes), text: o.memo_text ?? null })) };
  },
  // Phase 12
  async openNet(name, network, url) { wallets.set(name, new WebWallet(network, url, 1, 1, null)); return true; },
  async netStatus(name) { return await wallets.get(name).getNetworkStatus(); },
  async trySync(name) {
    try { await wallets.get(name).sync(); return { ok: true }; }
    catch (e) { return { ok: false, isError: e instanceof Error, code: e && e.code, chain_branch_id: e && e.chain_branch_id, chain_height: e && e.chain_height, newest_known_upgrade: e && e.newest_known_upgrade, hasMessage: !!(e && e.message) }; }
  },
};
