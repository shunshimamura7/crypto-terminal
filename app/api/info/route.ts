import { NextRequest } from "next/server";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface CoinLinks {
  website?: string;
  twitter?: string;
  telegram?: string;
  reddit?: string;
  github?: string;
  coingecko?: string;
  dexscreener?: string;
  discord?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Address detection
// ─────────────────────────────────────────────────────────────────────────────
function isEvmAddress(q: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(q.trim());
}
function isSolanaAddress(q: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim()) && !isEvmAddress(q.trim());
}
function isContractAddress(q: string): boolean {
  return isEvmAddress(q) || isSolanaAddress(q);
}

// ─────────────────────────────────────────────────────────────────────────────
// Coin maps
// ─────────────────────────────────────────────────────────────────────────────
const COIN_ID_MAP: Record<string, string> = {
  ビットコイン: "bitcoin",    btc: "bitcoin",        bitcoin: "bitcoin",
  イーサリアム: "ethereum",   eth: "ethereum",       ethereum: "ethereum",
  ソラナ: "solana",           sol: "solana",         solana: "solana",
  リップル: "ripple",         xrp: "ripple",         ripple: "ripple",
  バイナンスコイン: "binancecoin", bnb: "binancecoin",
  ドージコイン: "dogecoin",   doge: "dogecoin",      dogecoin: "dogecoin",
  ポリゴン: "matic-network",  matic: "matic-network", polygon: "matic-network",
  アバランチ: "avalanche-2",  avax: "avalanche-2",   avalanche: "avalanche-2",
  チェーンリンク: "chainlink", link: "chainlink",    chainlink: "chainlink",
  ユニスワップ: "uniswap",    uni: "uniswap",        uniswap: "uniswap",
  シバイヌ: "shiba-inu",      shib: "shiba-inu",
  カルダノ: "cardano",        ada: "cardano",        cardano: "cardano",
  ポルカドット: "polkadot",   dot: "polkadot",       polkadot: "polkadot",
  コスモス: "cosmos",         atom: "cosmos",        cosmos: "cosmos",
  ニア: "near",               near: "near",
  アービトラム: "arbitrum",   arb: "arbitrum",       arbitrum: "arbitrum",
  オプティミズム: "optimism",  op: "optimism",       optimism: "optimism",
  スイ: "sui",                sui: "sui",
  アプトス: "aptos",          apt: "aptos",          aptos: "aptos",
  pepe: "pepe",               trump: "official-trump",
  wif: "dogwifcoin",          bonk: "bonk",
  ltc: "litecoin",            litecoin: "litecoin",  ライトコイン: "litecoin",
  inj: "injective-protocol",  injective: "injective-protocol",
};

const EVM_PLATFORMS: Record<string, string> = {
  "1":     "ethereum",
  "56":    "binance-smart-chain",
  "137":   "polygon-pos",
  "42161": "arbitrum-one",
  "10":    "optimistic-ethereum",
  "43114": "avalanche",
  "8453":  "base",
};

// ─────────────────────────────────────────────────────────────────────────────
// TradingView symbol map
// ─────────────────────────────────────────────────────────────────────────────
const TV_SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BINANCE:BTCUSDT",      btc: "BINANCE:BTCUSDT",
  ethereum: "BINANCE:ETHUSDT",     eth: "BINANCE:ETHUSDT",
  solana: "BINANCE:SOLUSDT",       sol: "BINANCE:SOLUSDT",
  ripple: "BINANCE:XRPUSDT",       xrp: "BINANCE:XRPUSDT",
  dogecoin: "BINANCE:DOGEUSDT",    doge: "BINANCE:DOGEUSDT",
  binancecoin: "BINANCE:BNBUSDT",  bnb: "BINANCE:BNBUSDT",
  "avalanche-2": "BINANCE:AVAXUSDT", avax: "BINANCE:AVAXUSDT", avalanche: "BINANCE:AVAXUSDT",
  chainlink: "BINANCE:LINKUSDT",   link: "BINANCE:LINKUSDT",
  cardano: "BINANCE:ADAUSDT",      ada: "BINANCE:ADAUSDT",
  polkadot: "BINANCE:DOTUSDT",     dot: "BINANCE:DOTUSDT",
  arbitrum: "BINANCE:ARBUSDT",     arb: "BINANCE:ARBUSDT",
  sui: "BINANCE:SUIUSDT",
  near: "BINANCE:NEARUSDT",
  optimism: "BINANCE:OPUSDT",      op: "BINANCE:OPUSDT",
  aptos: "BINANCE:APTUSDT",        apt: "BINANCE:APTUSDT",
  "matic-network": "BINANCE:MATICUSDT", matic: "BINANCE:MATICUSDT", polygon: "BINANCE:MATICUSDT",
  uniswap: "BINANCE:UNIUSDT",      uni: "BINANCE:UNIUSDT",
  "shiba-inu": "BINANCE:SHIBUSDT", shib: "BINANCE:SHIBUSDT",
  cosmos: "BINANCE:ATOMUSDT",      atom: "BINANCE:ATOMUSDT",
  litecoin: "BINANCE:LTCUSDT",     ltc: "BINANCE:LTCUSDT",
  "injective-protocol": "BINANCE:INJUSDT", inj: "BINANCE:INJUSDT",
  pepe: "BINANCE:PEPEUSDT",
  bonk: "BINANCE:BONKUSDT",
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetch helpers (3s timeout)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, timeout = 3000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

async function fetchCoinGeckoById(id: string) {
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`
    );
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchCoinGeckoBySearch(query: string) {
  try {
    const sr = await fetchWithTimeout(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
    if (!sr || !sr.ok) return null;
    const sd = await sr.json();
    const id: string | undefined = sd.coins?.[0]?.id;
    if (!id) return null;
    return await fetchCoinGeckoById(id);
  } catch { return null; }
}

async function fetchCoinGeckoByContract(platform: string, address: string) {
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address.toLowerCase()}`
    );
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchDexScreenerByAddress(address: string) {
  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    if (!res || !res.ok) return null;
    const data = await res.json();
    return (data.pairs ?? []).slice(0, 5);
  } catch { return null; }
}

async function fetchDexScreenerBySearch(query: string) {
  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!res || !res.ok) return null;
    const data = await res.json();
    return (data.pairs ?? []).slice(0, 5);
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCoinSummary(cgData: any) {
  if (!cgData?.market_data) return null;
  const md = cgData.market_data;
  return {
    name:              cgData.name ?? "",
    symbol:            (cgData.symbol ?? "").toUpperCase(),
    price:             md.current_price?.usd ?? 0,
    change24h:         md.price_change_percentage_24h ?? 0,
    change7d:          md.price_change_percentage_7d ?? null,
    marketCap:         md.market_cap?.usd ?? 0,
    volume24h:         md.total_volume?.usd ?? 0,
    rank:              md.market_cap_rank ?? 0,
    ath:               md.ath?.usd ?? 0,
    athChange:         md.ath_change_percentage?.usd ?? 0,
    circulatingSupply: md.circulating_supply ?? 0,
    totalSupply:       md.total_supply ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLinks(cgData: any, dexPairs: any[] | null, coinId: string, coinSymbol: string): CoinLinks {
  const links: CoinLinks = {};

  if (cgData?.links) {
    const l = cgData.links;
    const homepage = Array.isArray(l.homepage) ? l.homepage.find((u: string) => u?.startsWith("http")) : null;
    if (homepage) links.website = homepage;
    if (l.twitter_screen_name) links.twitter = `https://x.com/${l.twitter_screen_name}`;
    if (l.telegram_channel_identifier) links.telegram = `https://t.me/${l.telegram_channel_identifier}`;
    if (l.subreddit_url && l.subreddit_url !== "") links.reddit = l.subreddit_url;
    const github = Array.isArray(l.repos_url?.github) ? l.repos_url.github.find((u: string) => u) : null;
    if (github) links.github = github;
    const discord = Array.isArray(l.chat_url)
      ? l.chat_url.find((u: string) => u?.includes("discord"))
      : null;
    if (discord) links.discord = discord;
  }

  if (cgData?.id) {
    links.coingecko = `https://www.coingecko.com/en/coins/${cgData.id}`;
  } else if (coinId && !coinId.startsWith("0x") && coinId.length < 50) {
    links.coingecko = `https://www.coingecko.com/en/coins/${coinId}`;
  }

  if (dexPairs && dexPairs.length > 0 && dexPairs[0].url) {
    links.dexscreener = dexPairs[0].url;
  } else {
    const q = coinSymbol || coinId;
    links.dexscreener = `https://dexscreener.com/search?q=${encodeURIComponent(q)}`;
  }

  return links;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/info
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = (typeof body.query === "string" ? body.query : "").trim();
  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const qLower     = query.toLowerCase().trim();
  const isContract = isContractAddress(query);
  const isEvm      = isEvmAddress(query);
  const coinId     = COIN_ID_MAP[qLower] ?? qLower;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cgData:   any          = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dexPairs: any[] | null = null;

  if (isContract) {
    dexPairs = await fetchDexScreenerByAddress(query);
    if (isEvm) {
      const results = await Promise.all(
        Object.values(EVM_PLATFORMS).map(p => fetchCoinGeckoByContract(p, query))
      );
      cgData = results.find(r => r !== null) ?? null;
    }
  } else {
    const [cgById, dex] = await Promise.all([
      COIN_ID_MAP[qLower] ? fetchCoinGeckoById(coinId) : fetchCoinGeckoBySearch(query),
      fetchDexScreenerBySearch(query),
    ]);
    cgData   = cgById ?? await fetchCoinGeckoBySearch(query);
    dexPairs = dex;
  }

  const coinSymbol = cgData?.symbol?.toUpperCase() ?? query.toUpperCase();
  const coin       = buildCoinSummary(cgData);
  const links      = extractLinks(cgData, dexPairs, coinId, coinSymbol);

  const tvKey            = cgData?.id ?? qLower;
  const tradingViewSymbol = TV_SYMBOL_MAP[tvKey] ?? TV_SYMBOL_MAP[qLower] ?? null;

  return Response.json({ coin, links, tradingViewSymbol });
}
