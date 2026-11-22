#!/usr/bin/env node
// Compiles contracts/EthersAirGenesisV2.sol and optionally deploys it to Base.
//
// Setup:  npm i -D solc ethers @openzeppelin/contracts
//
// Dry run (compiles + prints constructor args, sends nothing):
//   node scripts/deploy-v2.mjs --owner 0x... --base-uri https://x.xyz/metadata/ \
//        --contract-uri https://x.xyz/contract.json --royalty 500 \
//        --prices 0.05,0.03,0.015,0.008
//
// Deploy (needs PRIVATE_KEY in .env):
//   node scripts/deploy-v2.mjs ... --deploy
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = (await import("node:module")).createRequire(import.meta.url);
const solc = require("solc");
const { ethers } = require("ethers");

/* ---------- env ---------- */
if (fs.existsSync(path.join(ROOT, ".env"))) {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const k = line.slice(0, line.indexOf("=")).trim();
    if (!process.env[k]) process.env[k] = line.slice(line.indexOf("=") + 1).trim();
  }
}

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DEPLOY = argv.includes("--deploy");

const RPC = arg("rpc", process.env.BASE_RPC_URL || "https://mainnet.base.org");
const ENTRY = "EthersAirGenesisV2.sol";
const SOURCE = path.join(ROOT, "contracts", ENTRY);

/* ---------- compile ---------- */
const sources = {};
function addSource(name, content) {
  if (sources[name]) return;
  sources[name] = { content };
  for (const m of content.matchAll(/import\s+(?:\{[^}]*\}\s*from\s*)?["']([^"']+)["']/g)) {
    for (const cand of [
      path.posix.normalize(m[1]),
      path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1])),
    ]) {
      const p = path.join(ROOT, "node_modules", cand);
      if (fs.existsSync(p)) { addSource(cand, fs.readFileSync(p, "utf8")); break; }
    }
  }
}
addSource(ENTRY, fs.readFileSync(SOURCE, "utf8"));

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}
const artifact = out.contracts[ENTRY][ENTRY];
console.log(`compiled | solc ${solc.version()} | init code ${artifact.evm.bytecode.object.length / 2} bytes`);

/* ---------- constructor args ---------- */
const owner = arg("owner");
if (!owner) {
  console.error("--owner is required (receives ownership and default royalty)");
  process.exit(1);
}
const baseUri = arg("base-uri");
const contractUri = arg("contract-uri");
const royalty = Number(arg("royalty", "500"));
const prices = (arg("prices", "0.05,0.03,0.015,0.008")).split(",").map((p) => ethers.parseEther(p.trim()));

if (!baseUri || !contractUri) {
  console.error("--base-uri and --contract-uri are required (marketplaces read both)");
  process.exit(1);
}

const args = [owner, baseUri, contractUri, owner, royalty, ...prices];
console.log("owner       :", owner);
console.log("baseURI     :", baseUri);
console.log("contractURI :", contractUri);
console.log("royalty     :", royalty, "bps");
console.log("prices      :", prices.map((p) => ethers.formatEther(p)).join(" / "), "ETH");

if (!DEPLOY) {
  console.log("\ndry run — add --deploy to broadcast (PRIVATE_KEY required)");
  process.exit(0);
}

if (!process.env.PRIVATE_KEY) {
  console.error("PRIVATE_KEY missing (put it in .env)");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC, 8453, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
console.log("\ndeployer    :", wallet.address, "|", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

const factory = new ethers.ContractFactory(artifact.abi, "0x" + artifact.evm.bytecode.object, wallet);
const contract = await factory.deploy(...args);
console.log("tx          :", contract.deploymentTransaction().hash);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log("deployed    :", address);

/* ---------- verification inputs ---------- */
const outDir = path.join(ROOT, "verify");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "standard-json-input.json"), JSON.stringify(input, null, 2));
fs.writeFileSync(
  path.join(outDir, "constructor-args.txt"),
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "string", "string", "address", "uint96", "uint256", "uint256", "uint256", "uint256"],
    args
  ).slice(2) + "\n"
);
console.log("verification files written to verify/ (standard-json-input.json + constructor-args.txt)");
