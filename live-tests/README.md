# Live tests

These scripts check the work in this branch against the **live Zcash testnet** (NU7). They drive a real Chrome through Playwright against the real lightwalletd server (`https://zjs.zec.rocks/testnet`) and the real faucet. Nothing is mocked.

They print only PASS/FAIL, public txids, block heights and error codes. They never print seeds, addresses, memo contents or balances.

| Script | What it checks | Recorded result |
|---|---|---|
| `phase8.mjs` | NU7 end to end: sync, faucet funds land in the Ironwood pool, save and restore, a spend that is mined as a v6 transaction with branch `0x77190ad9` | [18 / 18](phase8-results.json) |
| `phase10.mjs` | One transaction to two recipients with a text memo, a binary memo and no memo, the typed error codes, PCZT creation | [28 / 31](phase10-results.json)¹ |
| `phase11.mjs` | Raw memo access: recipients and the restored sender read every memo back byte for byte | [16 / 16](phase11-results.json) |
| `phase12.mjs` | Network-upgrade check: testnet matches, mainnet matches, and a testnet wallet on a mainnet server throws `unsupported_network_upgrade` | [9 / 9](phase12-results.json) |
| `phase13.mjs` | The demo page driven through its UI, including a real send | [14 / 14](phase13-results.json) |

¹ The 3 failures were memo read-back from history. They exposed the missing memo download, which was fixed afterwards and is covered by `phase11.mjs`.

The `*-state.json` files hold public data from our runs (wallet birthday heights and txids). Later scripts read them, for example `phase10.mjs` reuses the wallet funded in `phase8.mjs`.

## Run them

You need Chrome, Node 24, and the build toolchain from the root README.

```bash
just build                                  # wasm packages into packages/
corepack yarn install                       # brings @playwright/test (packages/e2e-tests)
node live-tests/server.mjs "$PWD/packages" 8090 &   # harness page with COOP/COEP headers

# Throwaway testnet seeds, kept OUTSIDE the repo: a JSON array of at least two
# 24-word seed phrases (phase10 adds a third). Default path
# ~/.zecathon-secrets/testnet-seeds.json, or set SEEDS_FILE.
export SEEDS_FILE=~/.zecathon-secrets/testnet-seeds.json

rm live-tests/phase*-state.json             # start fresh with your own wallets
node live-tests/phase8.mjs                  # claims faucet funds for seed 0, then spends
node live-tests/phase10.mjs                 # adds a third seed if needed
node live-tests/phase11.mjs
node live-tests/phase12.mjs

(cd demo && node build.mjs && node serve.mjs 8091 &)
node live-tests/phase13.mjs                 # or DEMO_URL=<deployed URL> node live-tests/phase13.mjs
```

The scripts stop with a `GATE:` line when something outside the code goes wrong, such as the faucet refusing a claim or a wallet with too little balance. Testnet coins (TAZ) have no value. Never put a real seed phrase in the seeds file.
