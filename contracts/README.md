# Contracts

## `EthersAirGenesisV2.sol`

A numbered ERC-721 collection for Base: fixed supply, tiered pricing by token id, ERC-2981
royalties, and collection-level metadata that marketplaces can read from the chain.

It exists because v1 of a live collection had three gaps that only showed up in production.
Each gap maps to one change here.

| Problem in v1 | Fix in v2 |
|---|---|
| `tokenURI` returned `baseURI + id` (no `.json`), so metadata files could not keep their extension | `tokenURI` concatenates `baseURI + id + ".json"` explicitly |
| No `contractURI()`, so OpenSea showed a bare collection until it was claimed by hand | `contractURI()` + `setContractURI()`, plus an event on change |
| Marketplaces kept serving cached metadata after a base-URI change | emits `BatchMetadataUpdate` (ERC-4906) whenever `setBaseURI` runs |

### Key functions

| Function | Who | Purpose |
|---|---|---|
| `mint(uint256 tokenId)` | anyone, when `mintOpen` | pays exactly `priceOf(tokenId)` |
| `priceOf(uint256)` | view | tier price for a token id |
| `setMintOpen(bool)` | owner | opens or closes minting |
| `setPrices(p1,p2,p3,p4)` | owner | updates the four tier prices |
| `setBaseURI(string)` | owner | moves metadata, emits ERC-4906 |
| `setContractURI(string)` | owner | collection name/logo/banner for marketplaces |
| `setRoyalty(address,uint96)` | owner | ERC-2981 default royalty |
| `withdraw(address payable)` | owner | sweeps the sale balance |

Tier boundaries (50 / 200 / 600) are public state and can be changed only at construction;
edit the source if you need different bands.

### Deploy

```bash
npm i -D solc ethers @openzeppelin/contracts

# dry run: compiles and prints the constructor arguments, sends nothing
node scripts/deploy-v2.mjs \
  --owner 0xYourOwner \
  --base-uri https://your-domain.xyz/metadata/ \
  --contract-uri https://your-domain.xyz/contract.json \
  --royalty 500 \
  --prices 0.05,0.03,0.015,0.008

# broadcast (PRIVATE_KEY in .env)
node scripts/deploy-v2.mjs ... --deploy
```

The deploy script writes `verify/standard-json-input.json` and `verify/constructor-args.txt`
so BaseScan verification needs no recompilation and no guessing about compiler settings.

### Metadata expectations

- `<baseURI><id>.json` — one file per token, extension included.
- `<contractURI>` — collection-level JSON with `name`, `description`, `image`, `banner_image`,
  `featured_image`, `external_link`, `seller_fee_basis_points`, `fee_recipient`.

Serving these from your own domain (as `genesis-web` does) avoids IPFS re-pinning whenever
copy or artwork changes.

### Safety notes

- `MAX_SUPPLY` is constant; `totalMinted` tracks actual mints.
- `mint` reverts on wrong payment rather than accepting overpayment, so a wallet cannot
  accidentally send more than the tier price.
- Royalty is capped at 1000 bps in both the constructor and `setRoyalty`.
- Ownership transfer should go to a multisig; the live collection uses a 2-of-3 Safe.
