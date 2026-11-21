#!/usr/bin/env node
// Builds OpenSea-compatible ERC-721 metadata from a collection index.
//
// Usage:
//   node scripts/build-metadata.mjs <out-dir> --source <collection.json> \
//        --image-cid <CID> --base-url <https://your-domain> [--name "Collection"]
//
// collection.json shape:
//   { "items": [ { "tokenId": 1, "name": "...", "attributes": [
//        { "trait_type": "Skin", "value": "Silver" } ],
//        "properties": { "tier": "Tier 1", "rank": 1, "sourceId": 331 } } ] }
//
// Output: <out-dir>/<tokenId>.json for every item, plus contract.json.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith("--")) || "./metadata-out";
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const source = flag("source");
const imageCid = flag("image-cid");
const baseUrl = flag("base-url", "https://example.xyz");
const collectionName = flag("name", "Collection");

if (!source || !imageCid) {
  console.error("usage: node build-metadata.mjs <out-dir> --source <collection.json> --image-cid <CID> [--base-url ...]");
  process.exit(1);
}

const items = JSON.parse(fs.readFileSync(source, "utf8")).items;
if (!Array.isArray(items) || !items.length) throw new Error("collection.json has no items array");

const DESC = `${collectionName} is a limited collection of ${items.length} original digital characters.`;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let written = 0;
for (const it of items) {
  const id = Number(it.tokenId ?? it.id);
  if (!Number.isInteger(id) || id < 1) throw new Error(`bad tokenId: ${it.tokenId}`);

  const props = {
    ...(it.properties || {}),
    ...(it.tier ? { tier: it.tier } : {}),
    ...(it.rank ? { rank: it.rank } : {}),
    ...(it.orig ? { sourceId: it.orig } : {}),
  };

  let attrs = [];
  if (Array.isArray(it.attributes)) {
    attrs = it.attributes
      .filter((a) => a && a.value !== null && a.value !== undefined && a.value !== "" && a.value !== "None")
      .map((a) => ({ trait_type: a.trait_type, value: a.value }));
  } else if (it.traits && typeof it.traits === "object") {
    /* compact form: { "Skin": "Silver", ... } */
    attrs = Object.entries(it.traits)
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "None")
      .map(([k, v]) => ({ trait_type: k, value: v }));
  }

  if (props.tier) attrs.push({ trait_type: "Tier", value: props.tier });
  if (props.rank) attrs.push({ display_type: "number", trait_type: "Rank", value: Number(props.rank) });

  const meta = {
    name: it.name || `${collectionName} #${id}`,
    description: DESC,
    image: `ipfs://${imageCid}/${id}.png`,
    external_url: `${baseUrl.replace(/\/$/, "")}/${id}`,
    attributes: attrs,
    properties: {
      collection: collectionName,
      tokenId: id,
      network: "Base",
      chainId: 8453,
      ...(props.tier ? { tier: props.tier } : {}),
      ...(props.rank ? { rank: Number(props.rank) } : {}),
      ...(props.sourceId ? { sourceId: props.sourceId } : {}),
    },
  };

  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(meta, null, 2) + "\n");
  written++;
}

fs.writeFileSync(
  path.join(outDir, "contract.json"),
  JSON.stringify(
    {
      name: collectionName,
      description: DESC,
      image: `ipfs://${imageCid}/1.png`,
      external_link: baseUrl,
    },
    null,
    2
  ) + "\n"
);

console.log(`wrote ${written} token files + contract.json into ${outDir}`);
