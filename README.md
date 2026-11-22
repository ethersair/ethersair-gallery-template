# Open ERC-721 Gallery Template (Base)

A dependency-free template for launching a numbered NFT collection on **Base**: a gallery,
per-token pages (`/1` … `/N`), a metadata server, and a mint button — deployable to
Cloudflare Pages in one command.

It was extracted from [EthersAir Genesis](https://airethers.xyz), a live 656-edition
collection on Base, so every piece here has run in production.

## What you get

| Piece | File | What it does |
|---|---|---|
| Gallery + router | `web/app.js` | grid with search, tier filter, sort; routes `/1` … `/N` and `/nft/<id>` |
| Token page | `web/app.js` | artwork, traits, rank, price, prev/next, mint button |
| Wallet + mint | `web/app.js` | injected wallet, switches to Base, calls `mint(uint256)` with the on-chain price |
| Metadata server | `data/config.json` + build output | serves `/metadata/<id>.json` from the same domain |
| Metadata builder | `scripts/build-metadata.mjs` | images + trait table → OpenSea-compatible ERC-721 JSON |
| Thumbnail builder | `scripts/build-thumbs.py` | 480px WebP thumbnails so the gallery loads instantly |
| SPA fallback | `web/_redirects` | makes `/1` … `/N` work on Cloudflare Pages |

## Quick start

```bash
# 1. thumbnails (from your source PNGs)
python scripts/build-thumbs.py ./images ./web/thumbs

# 2. metadata (needs a collection index: tokenId, traits, tier, rank)
node scripts/build-metadata.mjs ./metadata-out --source ./collection.json \
  --image-cid <IPFS_IMAGE_CID> --base-url https://your-domain.xyz

# 3. point the site at your collection
cp data/config.example.json data/config.json   # then edit contract, CID, pricing

# 4. preview
npx serve web

# 5. deploy
npx wrangler pages deploy web --project-name my-collection
```

## Contract expectations

The mint button calls `mint(uint256 tokenId)` with `msg.value` equal to `priceOf(tokenId)`.
If your contract exposes different names, change two constants in `web/app.js`:

```js
const MINT_SELECTOR = "0xa0712d68"; // mint(uint256)
const SEL = { priceOf: "0xb9186d7d", mintOpen: "0x24bbd049", ... };
```

A ready-to-deploy contract that matches this site is included: [`contracts/EthersAirGenesisV2.sol`](contracts/EthersAirGenesisV2.sol)
— ERC-721 with tiered pricing, ERC-2981 royalties, `contractURI()` so marketplaces read the
collection metadata from the chain, explicit `.json` token URIs, and ERC-4906 refresh events.
See [`contracts/README.md`](contracts/README.md) for the deploy and verify recipe.

The site reads `totalMinted()`, `mintOpen()`, `tier1End/2End/3End` and `priceOf(uint256)`
straight from the chain, racing three public RPCs so a slow provider cannot block the page.
Prices fall back to `data/config.json → pricing` while the RPC is quiet.

## Deploy and verify notes

- Cloudflare Pages needs `_redirects` with `/* /index.html 200`, otherwise `/1` returns 404.
- For BaseScan verification, compile with the exact settings you deploy with
  (`optimizer runs: 200`, matching `evmVersion`); most "bytecode does not match" errors
  come from a mismatch here.
- Keep metadata on a domain you control (as here) or pin it to IPFS and set
  `baseURI = ipfs://<CID>/`. The contract appends `<tokenId>.json`.

## License

MIT — see `LICENSE`.

## Status

Extracted from a live project; the gallery, metadata pipeline and mint flow are tested
against a deployed ERC-721 on Base mainnet. Contributions welcome.
