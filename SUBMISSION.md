# WebZjs NU7 + Memo Tooling: submission (ZECATHON, Core & Tooling track)

This entry makes the WebZjs browser wallet library work on Zcash's **NU7 testnet** and adds the
tooling an app needs to send **one transaction to several people, each with its own memo** (text
or raw bytes), to **read memos back exactly**, and to **detect an unsupported network upgrade**
before it breaks anything.

Everything below was run against the live NU7 testnet. Where something was not run live, or is
mocked, this document says so (see [What is real and what is mocked](#4-what-is-real-and-what-is-mocked)
and [Known limits](#5-known-limits)).

| | |
|---|---|
| Code (this repo) | [`ETIM-PAUL/WebZjs-red-dev`](https://github.com/ETIM-PAUL/WebZjs-red-dev), branch `submission` |
| Store crate | [`ETIM-PAUL/zcash_client_memory`](https://github.com/ETIM-PAUL/zcash_client_memory/tree/feat/nu7), branch `feat/nu7` (this repo pins it by git revision) |
| Upstream PRs | [red-dev-inc/zcash_client_memory#23](https://github.com/red-dev-inc/zcash_client_memory/pull/23), [red-dev-inc/WebZjs#21](https://github.com/red-dev-inc/WebZjs/pull/21), [#22](https://github.com/red-dev-inc/WebZjs/pull/22), [#23](https://github.com/red-dev-inc/WebZjs/pull/23), [#24](https://github.com/red-dev-inc/WebZjs/pull/24), all open |
| Live demo | **TODO: URL not yet deployed.** Run it locally with [`demo/README.md`](demo/README.md) |
| Video | **TODO: not yet recorded** |
| Built with | Claude Code (Anthropic) assistance |

## 1. What existed before

Two upstream projects. Neither contained any NU7 or memo code at these commits. On 2026-10-07,
red.dev announced NU7 plans on the Zcash forum. An NU6.3-only Ironwood PR for the store,
`zcash/zcash_client_memory` #17, was open and unmerged. Both are credited in section 6.

| Project | Repo and ref | Commit |
|---|---|---|
| WebZjs | `red-dev-inc/WebZjs` `main` | `86c339578817f6630f662f189b832cef91edf4ac` (2026-10-20) |
| zcash_client_memory | `red-dev-inc/zcash_client_memory` `feat/snap-nu63` | `1feb38d92d214ec65d410a01c0f9da42b787f76b` (2026-07-22) |

The work started from `ZcashCommunityGrants/WebZjs` `main` at `bdbc6f2`. It was later rebased onto
red.dev's `main`, which differs only by formatting and lint fixes (red.dev PR #20).

What those gave us: a WebAssembly Zcash wallet library for the NU6.3 ("Ironwood") release, an
in-memory wallet store, a React web wallet and a MetaMask Snap. What they did **not** have:

- No NU7 support. The testnet is on NU7 (branch ID `0x77190AD9`, activation height 4,465,026).
  The code depended on pre-NU7 librustzcash crates.
- The store had no Ironwood pool (NU6.3's new shielded pool). Ironwood funds were invisible and
  could not be spent.
- Sending was one recipient and no memo (`propose_transfer`, built with `Payment::without_memo`).
- Memos could not be read back byte for byte, and received memos were never read at all.
- No check that the server's chain is on an upgrade the library understands.
- **Syncing against the NU7 testnet endpoint failed outright**: `malformed response` after
  about 2 seconds, for every new wallet. We observed this live on 2026-10-10, before any change of
  ours.

## 2. What we wrote

WebZjs commits are on branch `submission` of this repo, `86c3395..5bdadd0`. zcash_client_memory
commits are on `feat/nu7` of the fork, `1feb38d..24e3be4`.

| Area | What it does | Commits |
|---|---|---|
| **NU7 port of `zcash_client_memory`** | Moves to the librustzcash `-pre.1` crates (the NU7 set) and implements the new `OutputLockStore`. Adds **Ironwood pool support**: a third note-commitment tree, nullifiers, note selection, balances and spending. Saved wallets use format v2, and a **v1 migration** rescans so old wallets find their Ironwood funds. Also fixes several store bugs (listed below). | memory `4a44266` |
| **NU7 port of WebZjs** | The same dependency move. The change pool comes from the upgrade in force at the target height (`change_pool_at`) instead of being hard-coded. Fixes a latent bug that would have used the wrong proving circuit under NU7. Adds a browser-safe clock. | WebZjs `4242c30` |
| **Sync fix for the testnet endpoint** | Accepts "Trailers-Only" gRPC-web responses, through a vendored copy of `tonic-web-wasm-client` 0.8.0 with a small header-aware patch (upstream issue #99, PR #113). Newer releases carry the same bug and conflict with the pinned wasm-bindgen. | WebZjs `1986e27` |
| **Ironwood balance in JavaScript** | Adds `ironwood_balance` to the balance object, so JS and the web wallet no longer show 0 for a wallet whose funds are all in Ironwood. | WebZjs `e8b71b2` |
| **Pinned store dependency** | `zcash_client_memory` is a git revision of the fork, so a clean clone builds. | WebZjs `b08f4a7` |
| **Multi-payment + memo API** | Adds `propose_payments(account, [{to, value, memo?}])`, `propose_from_zip321`, PCZT variants of both, `Proposal.fee()` and `Proposal.describe()`. A memo is a `string` (text) or a `Uint8Array` (raw bytes) of at most 512 bytes. Errors are typed, with stable codes (`memo_too_long`, `wrong_network`, `insufficient_funds`, ...). The ZIP 302 encoding is librustzcash's, not hand-rolled. `propose_transfer` and `pczt_create` behave as before. | WebZjs `1a152b2`, `abcca19` |
| **Raw memo access** | Each history entry gains an `outputs[]` list. Every output has `memo_type` (`empty`, `text`, `arbitrary`, `future`, `invalid_text`), `memo_bytes` (always the full 512 bytes, never trimmed) and `memo_text`. `sync` now downloads and decrypts the full transactions that pay the wallet, which is what makes received memos readable at all. The existing `memo` text field is unchanged. | memory `f15f512`, WebZjs `4f24ba5` |
| **Network-upgrade check** | Compares the server's `consensusBranchId` and height with the branch the library's own consensus parameters give. Supported upgrades are *derived* from those parameters, never listed by hand. On an unsupported chain it throws a typed `unsupported_network_upgrade` error carrying the chain's branch ID, height and the newest known upgrade. `getNetworkStatus()` returns the status without throwing. The check runs before `sync` and before building a transaction, and warns when the server announces an upgrade the library lacks. | WebZjs `08b4f52` |
| **Demo page** | A standalone static page: several payments, each with a text or hex memo; a review step with the ZIP 317 fee; history showing memos; and an upgrade banner. Testnet only, with throwaway keys kept in the browser. | WebZjs `b09d275`, [`demo/`](demo/) |
| **Live check scripts** | The Playwright scripts behind section 3, with their recorded results. | WebZjs `5bdadd0`, [`live-tests/`](live-tests/) |
| **Build fix** | Makes `bip32` a normal dependency so `zcash_client_memory` builds with default features. | memory `24e3be4` |

Bugs we found and fixed in the existing code along the way:

- Saved wallets lost the transparent receiver of their addresses (`UnifiedAddress::encode` is
  now the sharing form).
- Notes selected for spending lacked `mined_height`, and `TargetValue::AllFunds` was
  `unimplemented!()`.
- A re-stored transaction overwrote its known fee with `None`.
- Orchard-family note IDs and `pool()` ignored Ironwood, and sent-note serialization hit
  `unreachable!()` for Ironwood.
- The wrong Orchard circuit would have been used for proofs under NU7.

Not ours, and credited as such: the librustzcash crates, `tonic-web-wasm-client` (vendored with
one patch), and the MetaMask Snap and web wallet code (we changed only the Ironwood balance sums).

## 3. Proof: live testnet transactions

All on the NU7 testnet (`chain test`, branch `0x77190ad9`) through
`https://zjs.zec.rocks/testnet`. Txids are in the order block explorers display.

| What | txid | Result |
|---|---|---|
| Faucet payout to our wallet (received, not sent by us) | `7418b4de44f02264e09edc606cafef10f1ecfc79b378151497c4730fba8bf8ed` | Wallet receives it **in the Ironwood pool** |
| **Spend of an Ironwood note**, one recipient | `37268e66bffcf2185c7b4bc5cd81dfdee7566ff093d3f4c848cba8a81129d4b5` | Mined at 4,506,299. Decoded independently from the node: branch ID `0x77190ad9`, transaction version 6 |
| **Multi-payment with memos** (script): 2 recipients, 3 outputs with a text memo, a binary memo and no memo | `23acbef465b98583f581977927ded0f9749e15987de43fe64254b05606a7e891` | Mined at 4,508,088. Fee 20,000 zatoshis (ZIP 317). Both recipients received the exact amounts, and the sender's balance fell by the outputs plus that fee |
| **The same, sent through the demo page's UI**: 3 payments, 2 recipients, text, hex and no memo | `f2c155668367a9204c5cae83647c73907697d5f38e6fe1c06d9e3c955d593dad` | Confirmed. History shows the text memo as text, the binary memo as hex, and the output with no memo |

The **binary memo reads back byte for byte** (the full 512 bytes, zero-padded) for the recipient,
for the sender (restored from its seed, using its outgoing viewing key), and after save and reload.

### Live check scripts and results

The scripts drive real Chrome against the real network and print only PASS/FAIL, txids, heights
and error codes. They and their result files are in [`live-tests/`](live-tests/), which also
explains how to rerun them with your own throwaway testnet seeds.

| Check | Script | Result |
|---|---|---|
| Baseline of the *unmodified* build | (manual) | Sync **fails** on the NU7 testnet (`malformed response`) |
| NU7 end to end: sync, receive into Ironwood, save and restore, spend, mined | `phase8.mjs` | 18 of 18 |
| Multi-payment, typed errors, PCZT creation | `phase10.mjs` | 28 of 31. The 3 failures were memo read-back from history, caused by a gap we then fixed |
| Raw memo access | `phase11.mjs` | 16 of 16 |
| Network-upgrade check (testnet match, mainnet match, forced mismatch) | `phase12.mjs` | 9 of 9 |
| Demo page driven through its UI, including a real send | `phase13.mjs` | 14 of 14 |

### Test suites

- `zcash_client_memory`: 88 pass with all features (29 ignored), 46 with default features.
  rustfmt is clean. Clippy reports 5 errors that already exist on `feat/snap-nu63`; the base
  branch has 30.
- WebZjs: `cargo test --workspace` passes (wallet crate 72 tests). rustfmt and clippy pass with
  the flags in `.github/workflows/rust-checks.yml`. The wasm build compiles at every PR's tip.
- Demo helpers: 9 pass (`node --test demo/test/lib.test.mjs`).
- Pre-existing failures we did **not** cause and did not fix: 8 web-wallet vitest tests, 3 Snap
  lint errors, and the e2e package's stale `@chainsafe` imports. The same ones fail on the
  unmodified base.

## 4. What is real and what is mocked

**Real, nothing mocked:** every transaction in section 3, including the proofs, signatures,
broadcast, the scan of real NU7 blocks, the faucet and the lightwalletd server. The live scripts
above.

**Mocked or simulated, on purpose and labelled as such:**

- **Network-upgrade unit tests** use *fake* `GetLightdInfo` answers, marked as fakes in the tests.
  The live network can't produce an unknown branch, a newer upgrade or a library-ahead-of-chain
  case on demand. The live check covers a testnet match, a mainnet match, and a real mismatch (a
  testnet wallet pointed at a mainnet server).
- **Ironwood store tests** come from librustzcash's shared test suite plus our additions. They run
  on an in-memory simulated chain, not a network.

**Not exercised live:**

- The **early-warning** path, where the server announces an upgrade the library lacks. Upstream
  lightwalletd does report `upgradeName` and `upgradeHeight`, so the path is implemented. But
  neither live server (testnet, or mainnet via `zjs.zec.rocks`) announces an upgrade today, so it
  is covered by unit tests only.
- **PCZT with several payments** was only created, not signed, proved and sent. The
  single-payment PCZT flow is unchanged from before.
- The **ZIP 321 URI path**: unit tests cover success. Live, only the rejection of a malformed URI
  was exercised, and the demo's URI prompt was not clicked through.
- The claim that **an unported build is rejected on send**. We never saw that, because the
  unmodified build can't even sync on this testnet, so it never reaches a send. What we
  *observed* is the sync failure before our change and the successful send after it.

## 5. Known limits

- **Mainnet:** NU7 has no mainnet activation height yet, so none of this is tested on mainnet NU7.
  The upgrade check correctly reports mainnet as supported on NU6.3.
- **MetaMask Snap and `packages/web-wallet`** compile with our changes but were **not run
  against the NU7 testnet**. The demo deliberately does not use them.
- **ZIP 318 pool migration** is not supported by the in-memory store. 5 related backend tests are
  ignored, with the reasons recorded.
- **Raw memo bytes are always the full 512 bytes**, because trailing zeros can't be told apart
  from data. Use `memo_text` for the unpadded text.
- **History txids** are in the wallet's internal byte order, the reverse of block explorers. This
  is existing behaviour, documented in the type, and the demo reverses them for display.
- `sync` may leave a memo unread if downloading that transaction fails. It is logged and retried
  on the next sync, but JavaScript gets no signal.
- **Saved wallets:** v1 wallets load and are queued for a rescan. Wallets saved by this build are
  v2, and the old build can't read them.
- Each guarded call (`sync`, building a transaction) makes one extra `GetLightdInfo` request.

## 6. Upstream status

- **Five PRs are open** on red.dev's repos, split so each can be reviewed alone. They merge in this
  order: zcash_client_memory#23 (NU7 port) → WebZjs#21 (NU7 port, sync fix, Ironwood balance) →
  #22 (payments and memo API) → #23 (raw memo access) → #24 (network-upgrade check). The demo
  and live scripts are not part of any PR. CI on the PRs is waiting for a maintainer to approve
  workflow runs, as GitHub requires for a first-time contributor.
- We contacted red.dev (who maintain WebZjs) on 2026-10-09, and they offered to review the work.
  On 2026-10-07 they had said on the Zcash forum that they would bring `zcash/zcash_client_memory`
  PR #17 (an NU6.3 Ironwood store by craftsoldier) into their fork and release NU7 work soon. Our
  Ironwood store work overlaps that PR's scope. Our port to the NU7 pre-release crates is not in
  it.
- **Overlapping work:** on 2026-10-19, sqhell opened a stack of PRs on red.dev's repos
  (zcash_client_memory #16–#22, WebZjs #6–#19) for the NU6.3 line. It covers an Ironwood pool in
  the store and wallet, wallet-format changes, and the same Trailers-Only fix. It doesn't touch
  NU7, the multi-payment and memo API, raw memo access, the upgrade check or a demo. Two things
  still need agreeing with red.dev, and each PR says so: who owns the Ironwood store code, and a
  single "wallet format v2" definition, since theirs and ours differ.

## 7. Reproduce it

```bash
git clone -b submission https://github.com/ETIM-PAUL/WebZjs-red-dev.git && cd WebZjs-red-dev

# toolchain: Rust nightly-2025-06-15 (pinned), wasm-pack, just, Node 24; on macOS, Homebrew LLVM:
export CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang
export AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar

just build                      # wasm packages
cargo test --workspace          # native tests
just check-wasm
cd demo && node build.mjs && node serve.mjs 8080   # http://127.0.0.1:8080/
```

The demo needs a funded testnet address. Create a wallet in the page and request funds from
<https://faucet.testnet.valargroup.dev> (testnet coins, TAZ, have no real value). Full steps are
in [`demo/README.md`](demo/README.md). To rerun the live checks, see
[`live-tests/README.md`](live-tests/README.md).

## 8. Scope

This entry stands on its own. Its demo doesn't depend on Zealed, and it doesn't claim Zealed's
work. The WebZjs and zcash_client_memory code remains its authors'; this submission is the diff
on top of the commits listed in section 1.
