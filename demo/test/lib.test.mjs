import test from 'node:test';
import assert from 'node:assert/strict';
import { parseZec, formatZec, hexToBytes, bytesToHex, memoHexForDisplay, reverseHex, rowToPayment, rowsToPayments, describeMemo, bannerFor } from '../src/lib.js';

test('parseZec', () => {
  assert.equal(parseZec('1'), 100000000n);
  assert.equal(parseZec('0.00012345'), 12345n);
  assert.equal(parseZec(' 1.5 '), 150000000n);
  for (const bad of ['', 'abc', '-1', '1.123456789', '1e3', '1,5', '.5', '1.']) assert.equal(parseZec(bad), null, bad);
});

test('formatZec round-trips', () => {
  assert.equal(formatZec(150000000n), '1.5');
  assert.equal(formatZec(1), '0.00000001');
  assert.equal(formatZec(0), '0');
  assert.equal(formatZec(-250000000), '-2.5');
  for (const z of [0n, 1n, 99999999n, 100000000n, 2100000000000000n]) assert.equal(parseZec(formatZec(z)), z);
});

test('hex memo parsing is strict', () => {
  assert.deepEqual([...hexToBytes('ff00 7A')], [255, 0, 122]);
  assert.deepEqual([...hexToBytes('0xFF')], [255]);
  assert.equal(hexToBytes('f'), null);
  assert.equal(hexToBytes('zz'), null);
  assert.equal(bytesToHex(Uint8Array.from([0, 15, 255])), '000fff');
});

test('memo display hides only trailing zero padding', () => {
  const full = new Uint8Array(512); full.set([0xff, 0, 1, 2]);
  assert.equal(memoHexForDisplay(full), 'ff000102');
  assert.equal(memoHexForDisplay(new Uint8Array(512)), '');
});

test('txid byte order reversal', () => {
  assert.equal(reverseHex('0102ab'), 'ab0201');
  assert.equal(reverseHex(reverseHex('23acbef4')), '23acbef4');
});

test('rows become payments with the right memo kinds', () => {
  const t = rowToPayment({ to: 'u1x', amount: '0.001', memoKind: 'text', memo: 'hi' }, 0).payment;
  assert.equal(t.value, 100000n); assert.equal(t.memo, 'hi');
  const h = rowToPayment({ to: 'u1x', amount: '1', memoKind: 'hex', memo: 'ff01' }, 0).payment;
  assert.ok(h.memo instanceof Uint8Array); assert.deepEqual([...h.memo], [255, 1]);
  const n = rowToPayment({ to: 'u1x', amount: '1', memoKind: 'none', memo: 'ignored' }, 0).payment;
  assert.equal('memo' in n, false);
  const e = rowToPayment({ to: 'u1x', amount: '1', memoKind: 'text', memo: '' }, 0).payment;
  assert.equal('memo' in e, false);
});

test('row validation names the payment and the problem', () => {
  assert.match(rowToPayment({ to: '', amount: '1' }, 1).error, /Payment 2.*address/);
  assert.match(rowToPayment({ to: 'a', amount: 'x' }, 0).error, /amount/);
  assert.match(rowToPayment({ to: 'a', amount: '0' }, 0).error, /more than zero/);
  assert.match(rowToPayment({ to: 'a', amount: '1', memoKind: 'text', memo: 'é'.repeat(257) }, 0).error, /514 bytes/);
  assert.match(rowToPayment({ to: 'a', amount: '1', memoKind: 'hex', memo: '00'.repeat(513) }, 0).error, /513 bytes/);
  assert.match(rowToPayment({ to: 'a', amount: '1', memoKind: 'hex', memo: 'xyz' }, 0).error, /hex memo/);
  assert.match(rowsToPayments([]).error, /at least one/);
  assert.equal(rowsToPayments([{ to: 'a', amount: '1' }, { to: 'b', amount: '2' }]).payments.length, 2);
});

test('memos in history', () => {
  const bytes = new Uint8Array(512); bytes.set([0xff, 0xab]);
  assert.deepEqual(describeMemo({ memo_type: 'text', memo_text: 'hello', memo_bytes: bytes }), { label: 'text', text: 'hello' });
  assert.deepEqual(describeMemo({ memo_type: 'arbitrary', memo_bytes: bytes }), { label: 'binary', text: '0xffab' });
  assert.equal(describeMemo({ memo_type: 'empty', memo_bytes: bytes }).label, 'no memo');
});

test('banner follows the network status', () => {
  const ok = { supported: true, warnings: [], newest_known_upgrade: 'Nu7', chain_branch_id: '77190ad9', chain_height: 5, expected_branch_id: '77190ad9' };
  assert.equal(bannerFor(ok).level, 'ok');
  assert.equal(bannerFor({ ...ok, warnings: ['NU8 soon'] }).level, 'warn');
  assert.equal(bannerFor({ ...ok, supported: false }).level, 'bad');
  assert.equal(bannerFor(null, { code: 'unsupported_network_upgrade', message: 'm' }).title, 'Unsupported network upgrade');
  assert.equal(bannerFor(null, new Error('boom')).level, 'bad');
});
