// Pure helpers for the demo. No DOM, no wasm: unit-tested with `node --test`.

export const ZATOSHI_PER_ZEC = 100_000_000n;
export const MAX_MEMO_BYTES = 512;

/** "1.5" -> 150000000n. Returns null for anything that is not a plain decimal with at most 8 places. */
export function parseZec(text) {
  const t = String(text).trim();
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]) * ZATOSHI_PER_ZEC + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
}

/** 150000000n -> "1.5". Accepts bigint or number. */
export function formatZec(zatoshis) {
  const z = BigInt(zatoshis);
  const neg = z < 0n;
  const abs = neg ? -z : z;
  const whole = abs / ZATOSHI_PER_ZEC;
  const frac = (abs % ZATOSHI_PER_ZEC).toString().padStart(8, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Strict hex -> bytes. Accepts an optional 0x prefix and spaces. Returns null if it is not whole bytes of hex. */
export function hexToBytes(text) {
  const t = String(text).trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (t.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(t)) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex of a memo for display: trailing zero padding is hidden (the chain always stores 512 bytes). */
export function memoHexForDisplay(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytesToHex(bytes.subarray(0, end));
}

/** The txid as block explorers show it, from the wallet's internal byte order (or the reverse). */
export function reverseHex(hex) {
  return (hex.match(/../g) ?? []).reverse().join('');
}

/**
 * One form row -> the library's PaymentRequest, or { error } naming the problem.
 * row: { to, amount, memoKind: 'none' | 'text' | 'hex', memo }
 */
export function rowToPayment(row, index) {
  const label = `Payment ${index + 1}`;
  const to = String(row.to ?? '').trim();
  if (!to) return { error: `${label}: enter a recipient address.` };
  const value = parseZec(row.amount ?? '');
  if (value === null) return { error: `${label}: enter an amount in ZEC (up to 8 decimal places).` };
  if (value === 0n) return { error: `${label}: the amount must be more than zero.` };
  const payment = { to, value };
  if (row.memoKind === 'text' && row.memo) {
    const bytes = new TextEncoder().encode(row.memo);
    if (bytes.length > MAX_MEMO_BYTES) return { error: `${label}: the memo is ${bytes.length} bytes; the limit is ${MAX_MEMO_BYTES}.` };
    payment.memo = row.memo;
  } else if (row.memoKind === 'hex' && String(row.memo ?? '').trim()) {
    const bytes = hexToBytes(row.memo);
    if (bytes === null) return { error: `${label}: the hex memo must be whole bytes of 0-9 and a-f.` };
    if (bytes.length > MAX_MEMO_BYTES) return { error: `${label}: the memo is ${bytes.length} bytes; the limit is ${MAX_MEMO_BYTES}.` };
    payment.memo = bytes;
  }
  return { payment };
}

/** All rows -> { payments } or { error } (the first problem). */
export function rowsToPayments(rows) {
  if (rows.length === 0) return { error: 'Add at least one payment.' };
  const payments = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rowToPayment(rows[i], i);
    if (r.error) return { error: r.error };
    payments.push(r.payment);
  }
  return { payments };
}

/** How a history output's memo reads: { label, text } where text is what to show. */
export function describeMemo(output) {
  switch (output.memo_type) {
    case 'text':
      return { label: 'text', text: output.memo_text ?? '' };
    case 'empty':
      return { label: 'no memo', text: '' };
    case 'arbitrary':
      return { label: 'binary', text: '0x' + memoHexForDisplay(output.memo_bytes) };
    case 'future':
      return { label: 'future format', text: '0x' + memoHexForDisplay(output.memo_bytes) };
    case 'invalid_text':
      return { label: 'invalid text', text: '0x' + memoHexForDisplay(output.memo_bytes) };
    default:
      return { label: String(output.memo_type), text: '' };
  }
}

/** Banner model from a NetworkStatus (or an error thrown by the library): { level, title, detail }. */
export function bannerFor(status, error) {
  if (error) {
    if (error.code === 'unsupported_network_upgrade') {
      return { level: 'bad', title: 'Unsupported network upgrade', detail: error.message };
    }
    return { level: 'bad', title: 'Cannot reach the network', detail: String(error.message ?? error) };
  }
  if (!status.supported) {
    return {
      level: 'bad',
      title: 'Unsupported network upgrade',
      detail: `The server reports consensus branch ${status.chain_branch_id} at height ${status.chain_height}; this library expects ${status.expected_branch_id} (newest known upgrade: ${status.newest_known_upgrade}). Sending is disabled.`,
    };
  }
  if (status.warnings.length > 0) {
    return { level: 'warn', title: 'Upgrade coming', detail: status.warnings.join(' ') };
  }
  const next = status.next_upgrade ? ` Next: ${status.next_upgrade.name} at height ${status.next_upgrade.height}.` : '';
  return {
    level: 'ok',
    title: `Network supported (${status.newest_known_upgrade})`,
    detail: `Branch ${status.chain_branch_id} at height ${status.chain_height}.${next}`,
  };
}
