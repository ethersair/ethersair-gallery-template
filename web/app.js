/* EthersAir Genesis — numbered collection UI.
   Vanilla ES module, no build step, no framework.
   Routes: /  (gallery)  ·  /<id>  and  /nft/<id>  (token page, id 1..656) */

const PAGE = 60;

const state = {
  config: null,
  items: [],
  byId: new Map(),
  q: "",
  tier: "all",
  sort: "id",
  shown: 0,
  filtered: [],
};

const app = document.getElementById("app");

/* ---------------- helpers ---------------- */

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children) if (child) node.append(child);
  return node;
};

const tierClass = (tier) => {
  const m = /Tier\s*(\d)/i.exec(tier || "");
  return m ? `tier-${m[1]}` : "";
};

const gateways = () =>
  state.config?.gateways?.length
    ? state.config.gateways
    : ["https://ipfs.filebase.io/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];

const imageUrl = (id, gwIndex = 0) => {
  const cid = state.config.imageCid;
  const base = gateways()[gwIndex] || gateways()[0];
  return `${base}${cid}/${id}.png`;
};

const thumbUrl = (id) => `/thumbs/${id}.webp`;

/* Tries each source in order; marks the image loaded when the first one paints. */
function attachImageChain(img, sources) {
  let i = 0;
  img.addEventListener("load", () => img.classList.add("loaded"));
  img.addEventListener("error", () => {
    i += 1;
    if (i < sources.length) img.src = sources[i];
    else img.classList.add("load-error");
  });
  img.src = sources[0];
}

const ipfsChain = (id) => gateways().map((_, i) => imageUrl(id, i));

/* ---------------- data ---------------- */

async function loadData() {
  const [config, data] = await Promise.all([
    fetch("/data/config.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("/data/items.json", { cache: "no-cache" }).then((r) => r.json()),
  ]);
  state.config = config;
  state.items = data.items;
  state.byId = new Map(state.items.map((it) => [it.id, it]));
}

/* ---------------- chrome ---------------- */

function paintChrome() {
  const pill = document.getElementById("contract-pill");
  const addr = state.config.contract;
  if (pill) {
    const short = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "NOT DEPLOYED";
    pill.className = `pill ${addr ? "live" : "pending"}`;
    pill.innerHTML = `<i class="dot"></i><span>${short}</span>`;
    if (addr) {
      pill.outerHTML = `<a class="pill live" id="contract-pill" href="https://basescan.org/token/${addr}" target="_blank" rel="noreferrer"><i class="dot"></i><span>${short}</span></a>`;
    }
  }
  const footer = document.getElementById("footer-cid");
  if (footer) footer.textContent = `IMG ${state.config.imageCid.slice(0, 12)}…`;

  const walletBtn = document.getElementById("wallet-btn");
  if (walletBtn && !walletBtn.dataset.bound) {
    walletBtn.dataset.bound = "1";
    walletBtn.addEventListener("click", () => connectWallet());
    if (window.ethereum) {
      window.ethereum.on?.("accountsChanged", (accs) => {
        state.wallet = accs?.[0] || null;
        paintWallet();
      });
      window.ethereum.request?.({ method: "eth_accounts" }).then((accs) => {
        if (accs?.[0]) { state.wallet = accs[0]; paintWallet(); }
      }).catch(() => {});
    }
  }
  paintWallet();
}

const openSeaUrl = (id) =>
  state.config.contract ? `https://opensea.io/assets/base/${state.config.contract}/${id}` : null;

const basescanUrl = (id) =>
  state.config.contract ? `https://basescan.org/token/${state.config.contract}?a=${id}` : null;

const metadataUrl = (id) => `/metadata/${id}.json`;

/* ---------------- live chain state ---------------- */

const SEL = {
  totalMinted: "0xa2309ff8",
  mintOpen: "0x24bbd049",
  priceOf: "0xb9186d7d",
  tier1End: "0xc8bffa93",
  tier2End: "0x62463079",
  tier3End: "0xd6c5a41e",
};

async function rpcCall(rpc, data, attempts = 1) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: state.config.contract, data }, "latest"] }),
      });
      const json = await res.json();
      if (!json.result || json.result === "0x") throw new Error(json.error?.message || "empty result");
      return json.result;
    } catch (e) {
      lastErr = e;
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw lastErr;
}

const CACHE_KEY = "eag.chain.v1";

function cacheChain(chain) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...chain, at: Date.now() }));
  } catch {}
}

function cachedChain() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c?.ends && c?.prices ? c : null;
  } catch {
    return null;
  }
}

async function readChainState() {
  const { contract, rpcs } = state.config;
  if (!contract || !rpcs?.length) return null;
  const word = (n) => n.toString(16).padStart(64, "0");

  /* One full read against a single RPC. */
  const readOne = async (rpc) => {
    const [mintedRaw, openRaw, t1, t2, t3] = await Promise.all([
      rpcCall(rpc, SEL.totalMinted),
      rpcCall(rpc, SEL.mintOpen),
      rpcCall(rpc, SEL.tier1End),
      rpcCall(rpc, SEL.tier2End),
      rpcCall(rpc, SEL.tier3End),
    ]);
    const ends = [Number(BigInt(t1)), Number(BigInt(t2)), Number(BigInt(t3))];
    const sampleIds = [1, ends[0] + 1, ends[1] + 1, ends[2] + 1];
    const priceRaw = await Promise.all(sampleIds.map((id) => rpcCall(rpc, SEL.priceOf + word(id))));
    const chain = {
      minted: Number(BigInt(mintedRaw)),
      open: BigInt(openRaw) !== 0n,
      ends,
      prices: priceRaw.map((p) => Number(BigInt(p)) / 1e18),
      pricesWei: priceRaw.map((p) => BigInt(p).toString()),
    };
    cacheChain(chain);
    return chain;
  };

  /* Race the RPCs: whichever answers first wins, so a slow provider cannot stall the page. */
  try {
    return await Promise.any(rpcs.map((rpc) => readOne(rpc)));
  } catch {
    return null;
  }
}

/* Price of one token, derived from the on-chain tier boundaries. */
const priceOf = (id) => {
  const c = state.chain;
  if (!c) return null;
  if (id <= c.ends[0]) return c.prices[0];
  if (id <= c.ends[1]) return c.prices[1];
  if (id <= c.ends[2]) return c.prices[2];
  return c.prices[3];
};

const priceWeiOf = (id) => {
  const c = state.chain;
  if (!c) return null;
  const i = id <= c.ends[0] ? 0 : id <= c.ends[1] ? 1 : id <= c.ends[2] ? 2 : 3;
  if (c.pricesWei?.[i]) return BigInt(c.pricesWei[i]);
  return BigInt(Math.round(c.prices[i] * 1e6)) * 10n ** 12n;
};

/* Applies cached numbers silently, so the first paint already has prices. */
function applyCachedChain() {
  const c = cachedChain() || configPricing();
  if (!c) return;
  state.chain = c;
  const mintedEl = document.getElementById("stat-minted");
  const saleEl = document.getElementById("stat-sale");
  if (c.minted !== undefined && mintedEl) mintedEl.textContent = `${c.minted} / ${state.config.supply}`;
  if (c.open !== undefined && saleEl) saleEl.textContent = c.open ? "OPEN" : "CLOSED";
  paintPrices();
}

/* Fallback tiers shipped in config.json, used before the chain answers. */
function configPricing() {
  const p = state.config?.pricing;
  if (!p?.ends || !p?.prices) return null;
  return {
    ends: p.ends,
    prices: p.prices,
    pricesWei: p.prices.map((v) => (BigInt(Math.round(v * 1e6)) * 10n ** 12n).toString()),
    minted: undefined,
    open: undefined,
  };
}

function paintChainState(chain) {
  state.chain = chain || cachedChain() || state.chain || null;
  const hasLive = !!chain;
  const mintedEl = document.getElementById("stat-minted");
  const saleEl = document.getElementById("stat-sale");
  const banner = document.getElementById("mint-banner");
  const text = document.getElementById("mint-banner-text");

  if (!hasLive && state.chain) {
    /* fall back to the last known / snapshot values, but say so */
    if (mintedEl && state.chain.minted !== undefined) mintedEl.textContent = `${state.chain.minted} / ${state.config.supply}`;
    if (saleEl && state.chain.open !== undefined) saleEl.textContent = state.chain.open ? "OPEN" : "CLOSED";
    if (banner) { banner.hidden = false; banner.className = "banner warn"; }
    if (text)
      text.textContent =
        state.chain.minted !== undefined
          ? `Live chain read unavailable — showing last known state (${state.chain.minted}/${state.config.supply} minted).`
          : "Live chain read unavailable — prices shown from the last snapshot. Check BaseScan for current state.";
    paintPrices();
    return;
  }

  if (!hasLive) {
    if (saleEl) saleEl.textContent = "—";
    if (banner) { banner.hidden = false; banner.className = "banner warn"; }
    if (text) text.textContent = "Live chain state unavailable — RPC did not answer. Read state on BaseScan.";
    return;
  }

  if (mintedEl) mintedEl.textContent = `${chain.minted} / ${state.config.supply}`;
  if (saleEl) saleEl.textContent = chain.open ? "OPEN" : "CLOSED";
  if (banner) { banner.hidden = false; banner.className = chain.open ? "banner live" : "banner warn"; }
  if (text) {
    const prices = chain.prices.map((p) => `${p} ETH`).join(" · ");
    text.textContent = chain.open
      ? `Minting is open on Base · tiers ${prices}`
      : `Minting is closed · ${chain.minted} of ${state.config.supply} minted · tiers ${prices}. OpenSea shows no items until tokens are minted.`;
  }
  paintPrices();
}

/* Fills every price badge once the on-chain tiers are known. */
function paintPrices() {
  if (!state.chain) return;
  for (const node of document.querySelectorAll("[data-price-id]")) {
    const p = priceOf(Number(node.dataset.priceId));
    if (p !== null) node.textContent = `${p} ETH`;
  }
  for (const btn of document.querySelectorAll("[data-mint-id]")) {
    const p = priceOf(Number(btn.dataset.mintId));
    if (p !== null && !btn.disabled) btn.textContent = `Mint · ${p} ETH`;
    const closed = state.chain.open === false;
    btn.setAttribute("aria-disabled", String(closed));
  }
}

/* ---------------- wallet + mint ---------------- */

const BASE_CHAIN = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

const MINT_SELECTOR = "0xa0712d68"; /* mint(uint256) */

const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function toast(message, kind = "info", href) {
  let box = document.getElementById("eag-toast");
  if (!box) {
    box = el("div", { id: "eag-toast", class: "toast" });
    document.body.append(box);
  }
  box.className = `toast ${kind}`;
  box.replaceChildren(el("span", { text: message }));
  if (href) box.append(el("a", { href, target: "_blank", rel: "noreferrer", text: "View tx ↗" }));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.remove(), href ? 20000 : 6000);
}

async function ensureBaseChain(eth) {
  const current = await eth.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === BASE_CHAIN.chainId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN.chainId }] });
  } catch (e) {
    if (e?.code === 4902) await eth.request({ method: "wallet_addEthereumChain", params: [BASE_CHAIN] });
    else throw e;
  }
}

async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) {
    toast("No wallet found. Install MetaMask or Coinbase Wallet, then reload.", "warn");
    return null;
  }
  try {
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    await ensureBaseChain(eth);
    state.wallet = accounts[0];
    paintWallet();
    return accounts[0];
  } catch (e) {
    toast(e?.code === 4001 ? "Connection request rejected." : e?.message || "Could not connect wallet.", "warn");
    return null;
  }
}

function paintWallet() {
  const btn = document.getElementById("wallet-btn");
  if (!btn) return;
  btn.textContent = state.wallet ? shortAddr(state.wallet) : "Connect";
  btn.classList.toggle("connected", !!state.wallet);
}

async function mintToken(id, btn) {
  const eth = window.ethereum;
  if (!eth) {
    toast("No wallet found. Install MetaMask or Coinbase Wallet, then reload.", "warn");
    return;
  }
  if (!state.wallet) {
    const a = await connectWallet();
    if (!a) return;
  }
  if (!state.chain?.open) {
    toast("Minting is closed right now.", "warn");
    return;
  }
  const wei = priceWeiOf(id);
  if (wei === null) {
    toast("Price unavailable — reload the page and try again.", "warn");
    return;
  }

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Confirm in wallet…";
  try {
    const data = MINT_SELECTOR + id.toString(16).padStart(64, "0");
    const txHash = await eth.request({
      method: "eth_sendTransaction",
      params: [{ from: state.wallet, to: state.config.contract, value: "0x" + wei.toString(16), data }],
    });
    btn.textContent = "Minting…";
    toast(`Transaction sent for #${id}. Waiting for confirmation…`, "info", `https://basescan.org/tx/${txHash}`);

    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (!receipt) continue;
      if (receipt.status === "0x1") {
        toast(`#${id} minted to ${shortAddr(state.wallet)}.`, "ok", `https://basescan.org/tx/${txHash}`);
        btn.textContent = "Minted ✓";
        readChainState().then(paintChainState).catch(() => {});
        return;
      }
      throw new Error("Transaction reverted");
    }
    toast("Still pending — check BaseScan in a minute.", "warn", `https://basescan.org/tx/${txHash}`);
    btn.textContent = original;
  } catch (e) {
    const msg = e?.code === 4001 ? "Transaction rejected in wallet." : e?.message || "Mint failed.";
    toast(msg, "warn");
    btn.textContent = original;
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- gallery ---------------- */

function card(item) {
  const img = el("img", { alt: item.name, loading: "lazy", decoding: "async" });
  attachImageChain(img, [thumbUrl(item.id), ...ipfsChain(item.id)]);

  return el(
    "a",
    { class: "card", href: `/${item.id}`, "data-link": "" },
    el(
      "div",
      { class: "card-image" },
      el("span", { class: "card-number", text: `#${item.id}` }),
      el("span", { class: `tag ${tierClass(item.tier)}`, text: item.tier }),
      el("span", { class: "card-price", "data-price-id": String(item.id), text: "" }),
      img,
      el("span", { class: "noimg", text: `#${item.id}` })
    ),
    el(
      "div",
      { class: "card-copy" },
      el("div", {}, el("h3", { text: item.name }), el("p", { html: `Rank ${item.rank}<span>·</span>ID ${item.orig}` })),
      el("span", { class: "tag", text: "BASE" })
    )
  );
}

function applyFilters() {
  const q = state.q.trim().toLowerCase();
  let list = state.items;

  if (state.tier !== "all") list = list.filter((it) => it.tier === state.tier);

  if (q) {
    const asNumber = /^#?\d{1,4}$/.test(q) ? Number(q.replace("#", "")) : null;
    list = list.filter((it) => {
      if (asNumber !== null && (it.id === asNumber || it.orig === asNumber)) return true;
      if (it.name.toLowerCase().includes(q)) return true;
      return Object.values(it.traits).some((v) => String(v).toLowerCase().includes(q));
    });
  }

  const sorters = {
    id: (a, b) => a.id - b.id,
    rank: (a, b) => a.rank - b.rank,
    tier: (a, b) => a.tier.localeCompare(b.tier) || a.id - b.id,
  };
  list = [...list].sort(sorters[state.sort] || sorters.id);
  state.filtered = list;
}

function renderGallery(reset = true) {
  if (reset) {
    applyFilters();
    state.shown = 0;
  }
  document.title = "EthersAir Genesis — 656 editions on Base";
  app.replaceChildren();

  const total = state.items.length;
  const hero = el(
    "section",
    { class: "hero" },
    el(
      "div",
      {},
      el("div", { class: "overline" }, el("i"), "ETHERSAIR · GENESIS"),
      el("h1", { html: "Six hundred fifty-six <em>originals</em>." }),
      el(
        "p",
        {
          text:
            "Every edition is addressable by its number: airethers.xyz/1 through airethers.xyz/656. Traits, tier and rank come straight from the on-chain metadata.",
        }
      )
    ),
    el(
      "div",
      { class: "hero-stats" },
      el("div", { class: "hero-stat" }, el("span", { text: "SUPPLY" }), el("b", { text: String(total) })),
      el("div", { class: "hero-stat" }, el("span", { text: "MINTED" }), el("b", { id: "stat-minted", text: "—" })),
      el("div", { class: "hero-stat" }, el("span", { text: "SALE" }), el("b", { id: "stat-sale", text: "—" })),
      el("div", { class: "hero-stat" }, el("span", { text: "NETWORK" }), el("b", { text: "Base" }))
    )
  );

  const tiers = ["all", ...new Set(state.items.map((i) => i.tier))];
  const chips = el(
    "div",
    { class: "chips" },
    ...tiers.map((t) =>
      el("button", {
        class: "chip",
        "aria-pressed": String(state.tier === t),
        text: t === "all" ? "All tiers" : t,
        onclick: () => {
          state.tier = t;
          renderGallery();
        },
      })
    )
  );

  const search = el("div", { class: "search" }, el("span", { text: "⌕" }));
  const input = el("input", {
    type: "search",
    placeholder: "Search #, name or trait…",
    value: state.q,
    oninput: (e) => {
      state.q = e.target.value;
      renderGallery();
      const again = document.querySelector(".search input");
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    },
  });
  search.append(input);

  const sort = el(
    "select",
    {
      onchange: (e) => {
        state.sort = e.target.value;
        renderGallery();
      },
    },
    el("option", { value: "id", text: "Sort: token ID" }),
    el("option", { value: "rank", text: "Sort: rank" }),
    el("option", { value: "tier", text: "Sort: tier" })
  );
  for (const opt of sort.options) if (opt.value === state.sort) opt.selected = true;

  const toolbar = el(
    "div",
    { class: "toolbar" },
    el("span", { class: "result-label" }, el("i"), `${state.filtered.length} of ${total} editions`),
    search,
    sort,
    chips
  );

  const grid = el("div", { class: "grid", id: "grid" });
  app.append(hero, toolbar, grid);

  if (!state.filtered.length) {
    app.append(el("div", { class: "empty", text: "No edition matches that search." }));
    return;
  }

  const more = el("button", {
    class: "load-more",
    text: "Load more editions",
    onclick: () => renderGallery(false),
  });
  const sentinel = el("div", { class: "sentinel" });
  app.append(more, sentinel);

  appendNextChunk(grid, more);

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) appendNextChunk(grid, more);
    });
    io.observe(sentinel);
  }
}

function appendNextChunk(grid, more) {
  const slice = state.filtered.slice(state.shown, state.shown + PAGE);
  const frag = document.createDocumentFragment();
  for (const item of slice) frag.append(card(item));
  grid.append(frag);
  state.shown += slice.length;
  if (state.shown >= state.filtered.length && more) more.remove();
  const label = more?.textContent;
  if (more && label) more.textContent = `Load more editions (${state.shown}/${state.filtered.length})`;
}

/* ---------------- detail ---------------- */

function renderDetail(id) {
  const item = state.byId.get(id);
  app.replaceChildren();

  if (!item) {
    document.title = `Edition #${id} not found — EthersAir Genesis`;
    app.append(
      el("a", { class: "back", href: "/", "data-link": "" }, "← Back to collection"),
      el("div", { class: "empty", html: `No edition with number <b>${id}</b>. Editions run from 1 to ${state.items.length}.` })
    );
    return;
  }

  document.title = `${item.name} — EthersAir Genesis`;
  const og = document.querySelector('meta[property="og:title"]');
  if (og) og.setAttribute("content", item.name);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", `https://airethers.xyz/${item.id}`);

  const img = el("img", { alt: item.name, decoding: "async" });
  attachImageChain(img, [thumbUrl(item.id), ...ipfsChain(item.id)]);
  /* Show the local thumb instantly, then swap in the canonical IPFS original. */
  const full = new Image();
  full.addEventListener("load", () => {
    img.src = full.src;
    img.classList.add("loaded");
  });
  full.src = imageUrl(item.id);

  const prev = id > 1 ? state.byId.get(id - 1) : null;
  const next = id < state.items.length ? state.byId.get(id + 1) : null;

  const traitNodes = Object.entries(item.traits).map(([k, v]) =>
    el("div", { class: "trait" }, el("span", { text: k }), el("b", { text: String(v) }))
  );

  const os = openSeaUrl(item.id);
  const bs = basescanUrl(item.id);

  const actions = el(
    "div",
    { class: "actions" },
    el("button", {
      class: "btn btn-primary",
      type: "button",
      onclick: (e) => mintToken(item.id, e.currentTarget),
      "data-mint-id": String(item.id),
      "aria-disabled": state.chain?.open === false ? "true" : "false",
      text: `Mint · ${priceOf(item.id) ?? "—"} ETH`,
    }),
    el(
      "a",
      {
        class: "btn btn-outline",
        href: os || "#",
        target: "_blank",
        rel: "noreferrer",
        "aria-disabled": String(!os),
      },
      "OpenSea"
    ),
    el(
      "a",
      { class: "btn btn-outline", href: bs || "#", target: "_blank", rel: "noreferrer", "aria-disabled": String(!bs) },
      "BaseScan"
    ),
    el("a", { class: "btn btn-outline", href: metadataUrl(item.id), target: "_blank", rel: "noreferrer" }, "Metadata (JSON)")
  );

  app.append(
    el("a", { class: "back", href: "/", "data-link": "" }, "← All editions"),
    el(
      "div",
      { class: "detail" },
      el(
        "div",
        {},
        el("div", { class: "detail-image" }, img),
        el(
          "div",
          { class: "detail-nav" },
          prev
            ? el("a", { href: `/${prev.id}`, "data-link": "" }, `← #${prev.id}`)
            : el("a", { "aria-disabled": "true" }, "← first"),
          next
            ? el("a", { href: `/${next.id}`, "data-link": "" }, `#${next.id} →`)
            : el("a", { "aria-disabled": "true" }, "last →")
        )
      ),
      el(
        "div",
        {},
        el("div", { class: "overline" }, el("i"), "ETHERSAIR · GENESIS"),
        el("span", { class: `tag ${tierClass(item.tier)}`, text: item.tier }),
        el("h1", { text: item.name }),
        el(
          "div",
          { class: "detail-meta" },
          el("div", {}, el("span", { text: "TOKEN ID" }), el("b", { text: String(item.id) })),
          el("div", {}, el("span", { text: "RARITY RANK" }), el("b", { text: String(item.rank) })),
          el("div", {}, el("span", { text: "SOURCE ID" }), el("b", { text: String(item.orig) })),
          el("div", {}, el("span", { text: "STANDARD" }), el("b", { text: "ERC-721 · Base" })),
          el(
            "div",
            {},
            el("span", { text: "PRICE" }),
            el("b", {
              "data-price-id": String(item.id),
              text: state.chain ? `${priceOf(item.id)} ETH` : "—",
            })
          ),
          el(
            "div",
            {},
            el("span", { text: "CONTRACT" }),
            el(
              "b",
              {},
              state.config.contract
                ? el("a", {
                    href: `https://basescan.org/token/${state.config.contract}`,
                    target: "_blank",
                    rel: "noreferrer",
                    text: `${state.config.contract.slice(0, 8)}…${state.config.contract.slice(-6)}`,
                  })
                : el("span", { text: "not deployed yet" })
            )
          )
        ),
        el("div", { class: "traits-label" }, "TRAITS", el("span", { text: String(traitNodes.length) })),
        traitNodes.length
          ? el("div", { class: "traits" }, ...traitNodes)
          : el("div", { class: "notice" }, el("span", { text: "i" }), el("span", {
              text: "This edition was added from the late-arrival batch and has no trait set yet. The artwork is final.",
            })),
        actions,
        state.config.contract
          ? null
          : el(
              "div",
              { class: "notice" },
              el("span", { text: "!" }),
              el("span", {
                text: "The contract is not deployed yet, so OpenSea and BaseScan links are inactive. This page is live for review before mint.",
              })
            )
      )
    )
  );
  window.scrollTo(0, 0);
}

/* ---------------- router ---------------- */

function route() {
  const path = location.pathname.replace(/\/+$/, "");
  const m = /^\/(?:nft\/)?(\d{1,4})$/.exec(path);
  if (m) renderDetail(Number(m[1]));
  else renderGallery();
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const href = link.getAttribute("href");
  if (href === location.pathname) return;
  history.pushState({}, "", href);
  route();
});

addEventListener("popstate", route);

loadData()
  .then(() => {
    paintChrome();
    route();
    applyCachedChain();
    const pending = readChainState();
    /* never let a slow RPC keep the banner in "reading…" forever */
    Promise.race([pending, new Promise((r) => setTimeout(() => r(null), 7000))]).then((c) => {
      if (c) paintChainState(c);
      else if (!state.chain || state.chain.minted === undefined) paintChainState(null);
    });
    pending.then((c) => { if (c) paintChainState(c); }).catch(() => {});
  })
  .catch((err) => {
    app.replaceChildren(
      el("div", { class: "empty", html: `Could not load collection data.<br><small>${String(err.message)}</small>` })
    );
  });



