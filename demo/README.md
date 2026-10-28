# WebZjs testnet demo

A small static page that shows three things the library now does, on live Zcash testnet:

1. **Multi-payment send with memos.** One transaction, several recipients, each payment with no memo, a text memo, or a hex memo (raw bytes, up to 512). A review step shows every output, its memo, the change and the ZIP 317 fee before anything is sent. A ZIP 321 payment URI can be used instead of the form.
2. **History with memos.** Every shielded output the wallet can read, with its memo as text, or as hex when it is binary.
3. **Network-upgrade banner.** Green when the server's chain is on a supported upgrade (and which), amber when the server announces an upgrade the library does not support yet, red (with sending disabled) when the chain is unsupported.

Keys are a throwaway testnet seed kept in this browser's `localStorage`. The page only talks to testnet and says so. **Never paste a real seed phrase.**

## Run it

From the repository root:

```bash
just build                 # builds the wasm packages (needs the toolchain described in the root README)
cd demo
node build.mjs             # assembles ./dist from the packages and this folder
node serve.mjs 8080        # http://127.0.0.1:8080/
```

`node --test test/lib.test.mjs` runs the unit tests for the page's helpers (amount parsing, memo parsing, banner logic).

Use another lightwalletd server with `?lwd=<url>` (it must serve gRPC-web with CORS).

## Host it

`dist/` is plain static files (the wallet wasm is about 60 MB). The only requirement is two response headers, because the wallet uses threads (`SharedArrayBuffer`):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`dist/_headers` already contains them in the format Netlify reads, so dropping the `dist` folder on Netlify works. Other hosts need the same two headers configured.

### Railway (or any Node host)

`serve.mjs` is also a production server: it sends the two headers, compresses files, and listens on `$PORT` when the host sets it. Because `dist/` holds the 60 MB wasm and is not committed, package it into a separate folder and upload that:

```bash
just build                                   # repo root, if the wasm packages are stale
cd demo && node build.mjs
node make-deploy-dir.mjs ~/webzjs-demo-deploy   # new, empty folder outside the repository

npm i -g @railway/cli                        # or: brew install railway
railway login
cd ~/webzjs-demo-deploy
railway init                                 # create a project
railway up                                   # uploads and starts it (`npm start`)
railway domain                               # gives it a public URL
```

Each first visit downloads about 55 MB (the wasm barely compresses), so expect that in the host's bandwidth.

## Get testnet funds

Create the wallet in the page, copy its address, and request funds from the [testnet faucet](https://faucet.testnet.valargroup.dev). They show up after a minute or two.
