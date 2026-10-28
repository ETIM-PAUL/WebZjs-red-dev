import initWallet, { initThreadPool, WebWallet } from '../webzjs-wallet/webzjs_wallet.js';
import initKeys, { generate_seed_phrase } from '../webzjs-keys/webzjs_keys.js';
import {
  bannerFor, bytesToHex, describeMemo, formatZec, memoHexForDisplay, reverseHex, rowsToPayments,
} from './lib.js';

const NETWORK = 'test'; // this demo only ever talks to testnet
const LIGHTWALLETD = new URLSearchParams(location.search).get('lwd') || 'https://zjs.zec.rocks/testnet';
const SYNC_EVERY_MS = 30_000;
const KEY_SEED = 'webzjs-demo-testnet-seed';
const KEY_BIRTHDAY = 'webzjs-demo-testnet-birthday';

const $ = (id) => document.getElementById(id);
/** Build an element. Text is always set as text, never as HTML: memos are untrusted input. */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: wallet will not be remembered */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let wallet = null;
let accountId = null;
let seed = null;
let networkOk = false;
let syncing = false;
let proposal = null;
const rows = [];

// ---------- banner ----------
function showBanner(model) {
  const b = $('banner');
  b.className = `banner ${model.level}`;
  b.replaceChildren(h('b', {}, model.title), model.detail);
}
async function refreshBanner() {
  try {
    const status = await wallet.getNetworkStatus();
    networkOk = status.supported;
    showBanner(bannerFor(status));
  } catch (e) {
    networkOk = false;
    showBanner(bannerFor(null, e));
  }
  updateSendEnabled();
}

// ---------- wallet ----------
function show(id, on) { $(id).hidden = !on; }

async function openAccount(seedPhrase, birthday) {
  seed = seedPhrase;
  accountId = await wallet.create_account('demo', seed, 0, birthday);
  $('address').textContent = await wallet.get_current_address(accountId);
  show('setup', false);
  show('account', true);
  updateSendEnabled();
  await syncNow();
}

async function createFresh() {
  const phrase = generate_seed_phrase();
  const tip = Number(await wallet.get_latest_block());
  const birthday = Math.max(tip - 5, 1);
  store.set(KEY_SEED, phrase);
  store.set(KEY_BIRTHDAY, String(birthday));
  await openAccount(phrase, birthday);
}

async function restore() {
  const phrase = $('seed-input').value.trim().replace(/\s+/g, ' ');
  if (!phrase) return;
  const typed = Number($('birthday-input').value);
  const tip = Number(await wallet.get_latest_block());
  const birthday = typed > 0 ? typed : Math.max(tip - 5, 1);
  store.set(KEY_SEED, phrase);
  store.set(KEY_BIRTHDAY, String(birthday));
  $('seed-input').value = '';
  await openAccount(phrase, birthday);
}

async function refreshBalance() {
  const summary = await wallet.get_wallet_summary();
  const entry = summary?.account_balances?.find(([id]) => id === accountId) ?? summary?.account_balances?.[0];
  const b = entry?.[1];
  const n = (k) => BigInt(b?.[k] ?? 0);
  const spendable = n('sapling_balance') + n('orchard_balance') + n('ironwood_balance');
  const pending = n('pending_change') + n('pending_spendable');
  $('balance').textContent = `${formatZec(spendable)} TAZ`;
  $('balance-detail').textContent =
    (pending > 0n ? `${formatZec(pending)} pending. ` : '') +
    (summary ? `Scanned to ${summary.fully_scanned_height ?? '?'} of ${summary.chain_tip_height ?? '?'}.` : 'Not synced yet.');
}

async function syncNow() {
  if (syncing || !wallet || accountId === null) return;
  syncing = true;
  $('sync').disabled = true;
  $('sync-status').textContent = 'Syncing…';
  try {
    await wallet.sync();
    $('sync-status').textContent = `Synced ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    $('sync-status').textContent = '';
    if (e?.code === 'unsupported_network_upgrade') showBanner(bannerFor(null, e));
    else $('sync-status').textContent = `Sync failed: ${e?.message ?? e}`;
  } finally {
    syncing = false;
    $('sync').disabled = false;
  }
  await refreshBalance();
  await refreshHistory();
  await refreshBanner();
}

function forget() {
  if (!confirm('Forget this wallet? Its seed phrase is only stored in this browser. Any funds on it are lost unless you saved the phrase.')) return;
  store.del(KEY_SEED);
  store.del(KEY_BIRTHDAY);
  location.reload();
}

// ---------- send ----------
function newRow() { return { to: '', amount: '', memoKind: 'none', memo: '' }; }

function renderRows() {
  $('rows').replaceChildren(...rows.map((row, i) => {
    const memoInput = h('input', {
      type: 'text', placeholder: row.memoKind === 'hex' ? 'hex bytes, e.g. ff00a1' : 'memo text', 'aria-label': `Payment ${i + 1} memo`,
      value: row.memo, class: row.memoKind === 'hex' ? 'mono' : '',
      oninput: (e) => { row.memo = e.target.value; updateMemoHint(); },
    });
    memoInput.disabled = row.memoKind === 'none';
    const hint = h('span', { class: 'hint' });
    function updateMemoHint() {
      if (row.memoKind === 'text') hint.textContent = `${new TextEncoder().encode(row.memo).length} / 512 bytes`;
      else if (row.memoKind === 'hex') {
        const t = row.memo.trim().replace(/^0x/i, '').replace(/\s+/g, '');
        hint.textContent = `${Math.ceil(t.length / 2)} / 512 bytes`;
      } else hint.textContent = '';
    }
    updateMemoHint();
    return h('div', { class: 'row' },
      h('input', { class: 'to mono', placeholder: 'recipient testnet address', 'aria-label': `Payment ${i + 1} recipient`, value: row.to, oninput: (e) => { row.to = e.target.value; } }),
      h('input', { class: 'amount', placeholder: 'amount (TAZ)', inputmode: 'decimal', 'aria-label': `Payment ${i + 1} amount`, value: row.amount, oninput: (e) => { row.amount = e.target.value; } }),
      h('div', { class: 'memo-line' },
        h('select', { 'aria-label': `Payment ${i + 1} memo type`, onchange: (e) => { row.memoKind = e.target.value; renderRows(); } },
          ...[['none', 'No memo'], ['text', 'Text memo'], ['hex', 'Hex memo (raw bytes)']].map(([v, label]) => {
            const o = h('option', { value: v }, label); if (v === row.memoKind) o.selected = true; return o;
          })),
        memoInput, hint),
      rows.length > 1 ? h('button', { class: 'small remove', onclick: () => { rows.splice(i, 1); renderRows(); clearReview(); } }, 'Remove') : null);
  }));
}

function updateSendEnabled() {
  $('propose').disabled = !(wallet && accountId !== null && networkOk);
}

function clearReview() { proposal = null; show('review', false); $('review').replaceChildren(); }
function say(text, cls = '') { $('result').replaceChildren(h('p', { class: cls }, text)); }
function errorText(e) { return e?.code ? `${e.message} (code: ${e.code})` : String(e?.message ?? e); }

function memoCell(memo) {
  if (memo === undefined) return h('span', { class: 'muted' }, 'none');
  if (typeof memo === 'string') return h('span', { class: 'memo' }, h('span', { class: 'badge' }, 'text'), ' ', memo);
  return h('span', { class: 'memo mono' }, h('span', { class: 'badge' }, `binary, ${memo.length} B on chain`), ' 0x', memoHexForDisplay(memo));
}

async function review() {
  clearReview();
  $('result').replaceChildren();
  const parsed = rowsToPayments(rows);
  if (parsed.error) { say(parsed.error, 'err'); return; }
  try {
    proposal = await wallet.propose_payments(accountId, parsed.payments);
  } catch (e) { say(errorText(e), 'err'); return; }
  const d = proposal.describe();
  const outputs = d.steps.flatMap((s) => s.outputs);
  const change = d.steps.flatMap((s) => s.change);
  $('review').replaceChildren(
    h('h3', {}, 'Review'),
    h('table', {},
      h('tr', {}, h('th', {}, 'To'), h('th', {}, 'Amount'), h('th', {}, 'Memo')),
      ...outputs.map((o) => h('tr', {}, h('td', { class: 'mono wrap' }, `${o.to.slice(0, 14)}…${o.to.slice(-6)}`), h('td', {}, `${formatZec(o.value)} TAZ`), h('td', {}, memoCell(o.memo)))),
      ...change.map((c) => h('tr', {}, h('td', { class: 'muted' }, `change (${c.pool})`), h('td', {}, `${formatZec(c.value)} TAZ`), h('td', {}))),
    ),
    h('p', {}, `Network fee (ZIP 317): ${formatZec(d.fee)} TAZ`),
    h('p', {}, h('button', { id: 'send-now', onclick: sendNow }, 'Send transaction'), ' ', h('button', { class: 'small', onclick: clearReview }, 'Cancel')),
  );
  show('review', true);
}

async function sendNow() {
  const p = proposal;
  if (!p) return;
  $('send-now').disabled = true;
  say('Building the transaction and its proof. This can take a minute…');
  try {
    const txids = await wallet.create_proposed_transactions(p, seed, 0);
    await wallet.send_authorized_transactions(txids);
    const ids = [];
    for (let i = 0; i < txids.length; i += 32) ids.push(reverseHex(bytesToHex(txids.subarray(i, i + 32))));
    clearReview();
    $('result').replaceChildren(
      h('p', { class: 'okmsg' }, 'Sent. It is mined within a few minutes; press “Sync now” to follow it.'),
      ...ids.map((id) => h('p', { class: 'mono wrap', id: 'sent-txid' }, `txid ${id}`)),
    );
    rows.splice(0, rows.length, newRow());
    renderRows();
    await syncNow();
  } catch (e) {
    clearReview();
    say(errorText(e), 'err');
  }
}

function fillFromUri() {
  const uri = prompt('Paste a ZIP 321 payment URI (zcash:…)');
  if (!uri) return;

  proposeFromUri(uri.trim());
}
async function proposeFromUri(uri) {
  clearReview();
  try {
    proposal = await wallet.propose_from_zip321(accountId, uri);
  } catch (e) { say(errorText(e), 'err'); return; }
  const d = proposal.describe();
  $('review').replaceChildren(
    h('h3', {}, 'Review (from payment URI)'),
    h('table', {}, h('tr', {}, h('th', {}, 'To'), h('th', {}, 'Amount'), h('th', {}, 'Memo')),
      ...d.steps.flatMap((s) => s.outputs).map((o) => h('tr', {}, h('td', { class: 'mono wrap' }, `${o.to.slice(0, 14)}…${o.to.slice(-6)}`), h('td', {}, `${formatZec(o.value)} TAZ`), h('td', {}, memoCell(o.memo))))),
    h('p', {}, `Network fee (ZIP 317): ${formatZec(d.fee)} TAZ`),
    h('p', {}, h('button', { id: 'send-now', onclick: sendNow }, 'Send transaction'), ' ', h('button', { class: 'small', onclick: clearReview }, 'Cancel')));
  show('review', true);
}

// ---------- history ----------
async function refreshHistory() {
  let list;
  try {
    list = (await wallet.get_transaction_history(accountId, 25, 0)).transactions;
  } catch (e) { $('history-list').textContent = `Could not read history: ${errorText(e)}`; return; }
  if (!list.length) { $('history-list').textContent = 'Nothing yet.'; return; }
  $('history-list').replaceChildren(...list.map((t) => h('div', { class: 'tx' },
    h('div', {}, h('b', {}, `${t.tx_type} ${formatZec(t.value)} TAZ`), ' ',
      h('span', { class: 'badge' }, t.status === 'Confirmed' ? `confirmed, ${t.confirmations} conf` : String(t.status).toLowerCase()), ' ',
      h('span', { class: 'muted' }, t.block_height ? `height ${t.block_height}` : '')),
    h('div', { class: 'mono wrap muted' }, reverseHex(t.txid)),
    t.outputs.length === 0 ? null : h('table', {},
      ...t.outputs.map((o) => {
        const m = describeMemo(o);
        return h('tr', {},
          h('td', {}, o.direction, ' ', h('span', { class: 'muted' }, o.pool)),
          h('td', {}, `${formatZec(o.value)} TAZ`),
          h('td', { class: 'memo' }, h('span', { class: 'badge' }, m.label), ' ', h('span', { class: o.memo_type === 'text' ? '' : 'mono' }, m.text)));
      })))));
}

// ---------- start ----------
async function main() {
  $('server').textContent = LIGHTWALLETD;
  $('create').addEventListener('click', () => createFresh().catch((e) => say(errorText(e), 'err')));
  $('restore').addEventListener('click', () => restore().catch((e) => say(errorText(e), 'err')));
  $('sync').addEventListener('click', syncNow);
  $('forget').addEventListener('click', forget);
  $('copy-address').addEventListener('click', () => navigator.clipboard?.writeText($('address').textContent));
  $('add-row').addEventListener('click', () => { rows.push(newRow()); renderRows(); clearReview(); });
  $('paste-uri').addEventListener('click', fillFromUri);
  $('propose').addEventListener('click', review);
  rows.push(newRow());
  renderRows();

  await initWallet();
  await initKeys();
  await initThreadPool(Math.min(navigator.hardwareConcurrency || 2, 4));
  wallet = new WebWallet(NETWORK, LIGHTWALLETD, 1, 1, null);
  await refreshBanner();

  const saved = store.get(KEY_SEED);
  if (saved) await openAccount(saved, Number(store.get(KEY_BIRTHDAY)) || 1);
  else show('setup', true);
  setInterval(() => { if (!document.hidden) syncNow(); }, SYNC_EVERY_MS);
  window.__demoReady = true;
}
main().catch((e) => showBanner({ level: 'bad', title: 'Could not start', detail: errorText(e) }));
