import { NextRequest } from "next/server";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  MessageParam,
  WebSearchTool20250305,
  ToolUseBlock,
  WebSearchToolResultBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// IP rate limiting (20 req/day per IP, resets at JST midnight)
// ─────────────────────────────────────────────────────────────────────────────
const DAILY_LIMIT = 20;

interface RateLimitEntry {
  count: number;
  dateJST: string; // "YYYY-MM-DD"
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function getDateJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

// Returns remaining count after this use, or -1 if limit exceeded
function checkRateLimit(ip: string): number {
  const today = getDateJST();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.dateJST !== today) {
    rateLimitMap.set(ip, { count: 1, dateJST: today });
    return DAILY_LIMIT - 1;
  }
  if (entry.count >= DAILY_LIMIT) return -1;
  entry.count++;
  return DAILY_LIMIT - entry.count;
}

// 全エラーを必ずJSON形式で返すヘルパー
function jsonError(message: string, status = 500, dataSources: DataSource[] = []): Response {
  console.error(`[chat/route] Error (${status}):`, message);
  return Response.json({ error: message, dataSources }, { status });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface DataSource {
  name: string;
  category: string;
  status: "available" | "unavailable";
  url: string;
  description: string;
}

interface CoinSummary {
  name: string;
  symbol: string;
  price: number;
  change24h: number;
  change7d: number | null;
  marketCap: number;
  volume24h: number;
  rank: number;
  ath: number;
  athChange: number;
  circulatingSupply: number;
  totalSupply: number | null;
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
function isTonAddress(q: string): boolean {
  return /^[0-9A-Za-z_-]{48}$/.test(q.trim());
}
function isSuiAddress(q: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(q.trim());
}
function isTronAddress(q: string): boolean {
  return /^T[0-9A-Za-z]{33}$/.test(q.trim());
}
function isContractAddress(q: string): boolean {
  return isEvmAddress(q) || isSolanaAddress(q) || isTonAddress(q) || isSuiAddress(q) || isTronAddress(q);
}

const CHAIN_ID_NAME: Record<string, string> = {
  "1": "Ethereum", "56": "BSC", "137": "Polygon",
  "42161": "Arbitrum", "10": "Optimism", "43114": "Avalanche",
  "8453": "Base", "solana": "Solana", "ton": "TON",
  "sui": "SUI", "tron": "TRON",
};
function getChainName(chainId: string): string {
  return CHAIN_ID_NAME[chainId] ?? `Chain ${chainId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coin alias maps
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

const COIN_NAME_MAP: Record<string, string> = {
  ビットコイン: "Bitcoin",    btc: "Bitcoin",        bitcoin: "Bitcoin",
  イーサリアム: "Ethereum",   eth: "Ethereum",       ethereum: "Ethereum",
  ソラナ: "Solana",           sol: "Solana",         solana: "Solana",
  リップル: "Ripple/XRP",     xrp: "Ripple/XRP",     ripple: "Ripple/XRP",
  バイナンスコイン: "BNB",    bnb: "BNB",
  ドージコイン: "Dogecoin",   doge: "Dogecoin",      dogecoin: "Dogecoin",
  ポリゴン: "Polygon/MATIC",  matic: "Polygon/MATIC", polygon: "Polygon/MATIC",
  アバランチ: "Avalanche",    avax: "Avalanche",     avalanche: "Avalanche",
  チェーンリンク: "Chainlink", link: "Chainlink",    chainlink: "Chainlink",
  ユニスワップ: "Uniswap",    uni: "Uniswap",        uniswap: "Uniswap",
  シバイヌ: "Shiba Inu",      shib: "Shiba Inu",
  カルダノ: "Cardano",        ada: "Cardano",        cardano: "Cardano",
  ポルカドット: "Polkadot",   dot: "Polkadot",       polkadot: "Polkadot",
  コスモス: "Cosmos/ATOM",    atom: "Cosmos/ATOM",   cosmos: "Cosmos/ATOM",
  ニア: "NEAR Protocol",      near: "NEAR Protocol",
  アービトラム: "Arbitrum",   arb: "Arbitrum",       arbitrum: "Arbitrum",
  オプティミズム: "Optimism",  op: "Optimism",       optimism: "Optimism",
  スイ: "Sui",                sui: "Sui",
  アプトス: "Aptos",          apt: "Aptos",          aptos: "Aptos",
  pepe: "Pepe (PEPE)",        trump: "Official Trump (TRUMP)",
  wif: "dogwifhat (WIF)",     bonk: "Bonk (BONK)",
  ltc: "Litecoin",            litecoin: "Litecoin",  ライトコイン: "Litecoin",
  inj: "Injective",           injective: "Injective",
};

// EVM contract address → CoinGecko platform ID
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
// Formatters
// ─────────────────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "N/A";
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}
function fmtUsd(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "N/A";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(6)}`;
}
function fmtPrice(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "N/A";
  if (n < 0.000001) return `$${n.toFixed(10)}`;
  if (n < 0.001)    return `$${n.toFixed(8)}`;
  if (n < 0.01)     return `$${n.toFixed(6)}`;
  if (n < 1)        return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// API fetch helpers
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 3000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

async function detectChain(address: string): Promise<string> {
  const res = await fetchWithTimeout(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`, {}, 5000
  );
  if (!res || !res.ok) return "1";
  try {
    const json = await res.json();
    const pair = json?.pairs?.[0];
    if (!pair) return "1";
    const MAP: Record<string, string> = {
      ethereum: "1",  bsc: "56",       polygon: "137",
      arbitrum: "42161", optimism: "10", avalanche: "43114",
      base: "8453",   solana: "solana", ton: "ton",
      sui: "sui",     tron: "tron",
    };
    return MAP[pair.chainId] ?? "1";
  } catch { return "1"; }
}

async function fetchCoinGeckoById(id: string) {
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/${id}` +
      `?localization=false&tickers=false&market_data=true` +
      `&community_data=true&developer_data=false&sparkline=false`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchCoinGeckoBySearch(query: string) {
  try {
    const sr = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`
    );
    if (!sr || !sr.ok) return null;
    const sd = await sr.json();
    const id: string | undefined = sd.coins?.[0]?.id;
    if (!id) return null;
    return await fetchCoinGeckoById(id);
  } catch { return null; }
}

async function fetchCoinGeckoByContract(platform: string, address: string) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address.toLowerCase()}`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchCoinGeckoTrending() {
  try {
    const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/search/trending");
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchDexScreenerByAddress(address: string) {
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    return (data.pairs ?? []).slice(0, 5);
  } catch { return null; }
}

async function fetchDexScreenerBySearch(query: string) {
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    return (data.pairs ?? []).slice(0, 5);
  } catch { return null; }
}

async function fetchGeckoTerminalToken(network: string, address: string) {
  try {
    const res = await fetchWithTimeout(
      `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address.toLowerCase()}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchGeckoTerminalPools(network: string, address: string) {
  try {
    const res = await fetchWithTimeout(
      `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address.toLowerCase()}/pools?page=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    return (data.data ?? []).slice(0, 3);
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 無料API統合ヘルパー（STEP1追加）
// ─────────────────────────────────────────────────────────────────────────────

/** GoPlus Security — コントラクトリスク自動判定（APIキー不要） */
async function fetchGoPlusSecurity(address: string): Promise<string> {
  let url: string;
  if (isEvmAddress(address)) {
    const chainId = await detectChain(address);
    if (["solana", "ton", "sui", "tron"].includes(chainId)) return "GoPlus: このチェーンは非対応";
    url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
  } else if (isSolanaAddress(address)) {
    url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
  } else {
    return "GoPlus: このチェーンは非対応";
  }

  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res || !res.ok) return "GoPlus: データ取得失敗";

  try {
    const json = await res.json();
    const data = json?.result?.[address.toLowerCase()] || json?.result?.[address];
    if (!data) return "GoPlus: データなし";

    const flags: string[] = [];
    if (data.is_mintable === "1") flags.push("⚠️ Mint権限あり");
    if (data.is_honeypot === "1") flags.push("🚨 ハニーポット検出");
    if (data.is_blacklisted === "1") flags.push("⚠️ ブラックリスト機能あり");
    if (data.is_proxy === "1") flags.push("⚠️ プロキシコントラクト");
    if (data.can_take_back_ownership === "1") flags.push("🚨 Owner権限奪還可能");
    if (parseFloat(data.buy_tax || "0") > 10) flags.push(`⚠️ 買いTax: ${data.buy_tax}%`);
    if (parseFloat(data.sell_tax || "0") > 10) flags.push(`⚠️ 売りTax: ${data.sell_tax}%`);
    if (data.is_open_source === "0") flags.push("⚠️ ソース非公開");

    const ownerPct = parseFloat(data.owner_percent || "0") * 100;
    const creatorPct = parseFloat(data.creator_percent || "0") * 100;
    const lpLocked = data.lp_holders?.some((h: {is_locked?: number}) => h.is_locked === 1);

    return [
      "【GoPlus セキュリティスキャン】",
      flags.length > 0 ? flags.join(" / ") : "✅ 主要リスクなし",
      `Owner保有率: ${ownerPct.toFixed(2)}% / Creator保有率: ${creatorPct.toFixed(2)}%`,
      `LP状況: ${lpLocked ? "✅ ロック済み" : "⚠️ ロックなし"}`,
      `監査: ${data.is_in_dex === "1" ? "DEX上場済み" : "未確認"}`,
    ].join("\n");
  } catch {
    return "GoPlus: パース失敗";
  }
}

/** DeFiLlama — TVL・プロトコル収益（完全無料） */
async function fetchDeFiLlamaProtocol(query: string): Promise<string> {
  const res = await fetchWithTimeout("https://api.llama.fi/protocols", {}, 5000);
  if (!res || !res.ok) return "DeFiLlama: データ取得失敗";

  try {
    const protocols = await res.json();
    const lq = query.toLowerCase();
    const found = protocols.find((p: {name: string; slug: string; symbol: string}) =>
      p.name?.toLowerCase().includes(lq) ||
      p.slug?.toLowerCase().includes(lq) ||
      p.symbol?.toLowerCase() === lq
    );
    if (!found) return "DeFiLlama: プロトコルデータなし";

    const tvl = found.tvl ?? 0;
    const change7d = found.change_7d ?? null;
    const change1m = found.change_1m ?? null;
    const chains = (found.chains || []).slice(0, 3).join(", ");

    return [
      "【DeFiLlama TVLデータ】",
      `TVL: ${fmtUsd(tvl)}`,
      change7d != null ? `7日変化: ${change7d > 0 ? "+" : ""}${change7d.toFixed(1)}%` : "",
      change1m != null ? `30日変化: ${change1m > 0 ? "+" : ""}${change1m.toFixed(1)}%` : "",
      chains ? `主要チェーン: ${chains}` : "",
      found.category ? `カテゴリ: ${found.category}` : "",
    ].filter(Boolean).join("\n");
  } catch {
    return "DeFiLlama: パース失敗";
  }
}

/** Fear & Greed Index（完全無料） */
async function fetchFearGreedIndex(): Promise<string> {
  const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", {}, 3000);
  if (!res || !res.ok) return "";
  try {
    const json = await res.json();
    const d = json?.data?.[0];
    if (!d) return "";
    const emoji = Number(d.value) >= 75 ? "🤑" : Number(d.value) >= 55 ? "😊" : Number(d.value) >= 45 ? "😐" : Number(d.value) >= 25 ? "😨" : "😱";
    return `Fear & Greed Index: ${d.value}/100 ${emoji} (${d.value_classification})`;
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain ID → GeckoTerminal network
// ─────────────────────────────────────────────────────────────────────────────
function chainIdToGeckoTerminalNetwork(chainId: string): string {
  const map: Record<string, string> = {
    ethereum:  "eth",
    bsc:       "bsc",
    polygon:   "polygon_pos",
    arbitrum:  "arbitrum",
    optimism:  "optimism",
    avalanche: "avax",
    base:      "base",
    solana:    "solana",
    sui:       "sui-network",
    aptos:     "aptos",
    near:      "near-protocol",
  };
  return map[chainId.toLowerCase()] ?? chainId.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Build dataSources array
// ─────────────────────────────────────────────────────────────────────────────
function buildDataSources(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cgData:     any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dexPairs:   any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gtToken:    any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gtPools:    any[] | null;
  query:      string;
  coinId:     string;
  coinSymbol: string;
  isEvm:      boolean;
  isSolana:   boolean;
  isContract: boolean;
}): DataSource[] {
  const { cgData, dexPairs, gtToken, gtPools, query, coinId, coinSymbol, isEvm, isSolana, isContract } = params;

  const hasCg  = !!cgData;
  const hasDex = !!(dexPairs && dexPairs.length > 0);
  const hasGt  = !!(gtToken?.data || (gtPools && gtPools.length > 0));

  // Build dynamic URLs
  const dexUrl = isContract
    ? `https://dexscreener.com/search?q=${encodeURIComponent(query)}`
    : `https://dexscreener.com/search?q=${encodeURIComponent(coinSymbol)}`;

  const gtUrl = isContract
    ? `https://www.geckoterminal.com/search?query=${encodeURIComponent(query)}`
    : `https://www.geckoterminal.com/search?query=${encodeURIComponent(coinSymbol)}`;

  const cgUrl = hasCg && cgData.id
    ? `https://www.coingecko.com/en/coins/${cgData.id}`
    : `https://www.coingecko.com/en/coins/${coinId}`;

  const sources: DataSource[] = [
    // ── Fixed unavailable (no free public API) ──
    {
      name: "Whale Alert",
      category: "スマートマネー",
      status: "unavailable",
      url: "https://whale-alert.io",
      description: "大口送金リアルタイム監視",
    },
    {
      name: "Nansen",
      category: "スマートマネー",
      status: "unavailable",
      url: "https://nansen.ai",
      description: "スマートマネー追跡",
    },
    {
      name: "Arkham Intelligence",
      category: "スマートマネー",
      status: "unavailable",
      url: "https://platform.arkhamintelligence.com",
      description: "ウォレットラベリング・追跡",
    },
    {
      name: "TokenUnlocks",
      category: "アンロック",
      status: "unavailable",
      url: "https://token.unlocks.app",
      description: "トークンアンロックスケジュール",
    },
    {
      name: "Tokenomist",
      category: "アンロック",
      status: "unavailable",
      url: "https://tokenomist.ai",
      description: "トークノミクス・アンロック情報",
    },
    {
      name: "Bubblemaps",
      category: "ホルダー分析",
      status: "unavailable",
      url: "https://bubblemaps.io",
      description: "ホルダー分散バブルマップ",
    },
    // ── Dynamic sources ──
    {
      name: "DEXScreener",
      category: "DEX",
      status: hasDex ? "available" : "unavailable",
      url: dexUrl,
      description: "DEXリアルタイム価格・流動性",
    },
    {
      name: "GeckoTerminal",
      category: "オンチェーン",
      status: hasGt ? "available" : "unavailable",
      url: gtUrl,
      description: "オンチェーンDEXデータ",
    },
    {
      name: "CoinGecko",
      category: "市場データ",
      status: hasCg ? "available" : "unavailable",
      url: cgUrl,
      description: "価格・時価総額・市場データ",
    },
  ];

  // Address-specific explorer links
  if (isSolana || (isContract && !isEvm)) {
    sources.push({
      name: "Solscan",
      category: "オンチェーン",
      status: "unavailable",
      url: `https://solscan.io/token/${query}`,
      description: "Solanaオンチェーンエクスプローラー",
    });
  }
  if (isEvm) {
    sources.push({
      name: "Etherscan",
      category: "オンチェーン",
      status: "unavailable",
      url: `https://etherscan.io/token/${query}`,
      description: "Ethereumオンチェーンエクスプローラー",
    });
  }

  return sources;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build structured coin summary from CoinGecko data
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCoinSummary(cgData: any): CoinSummary | null {
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

// ─────────────────────────────────────────────────────────────────────────────
// Build realtime context string
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRealtimeContext(params: {
  cgData:     any;
  dexPairs:   any[] | null;
  gtToken:    any;
  gtPools:    any[] | null;
  trending:   any;
  query:      string;
  coinName:   string;
  isContract: boolean;
}): string {
  const { cgData, dexPairs, gtToken, gtPools, trending, query, coinName, isContract } = params;
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const lines: string[] = [`【リアルタイムAPIデータ取得時刻: ${now} JST】`];

  if (cgData) {
    const md  = cgData.market_data;
    const cd  = cgData.community_data;
    lines.push(
      `\n[CoinGecko]`,
      `  銘柄: ${cgData.name ?? coinName} (${(cgData.symbol ?? "").toUpperCase()})`,
      `  現在価格: ${fmtPrice(md?.current_price?.usd)}`,
      `  騰落率: 24h ${fmt(md?.price_change_percentage_24h)}%  7d ${fmt(md?.price_change_percentage_7d)}%  30d ${fmt(md?.price_change_percentage_30d)}%`,
      `  時価総額: ${fmtUsd(md?.market_cap?.usd)}  ランク: #${md?.market_cap_rank ?? "N/A"}`,
      `  24h取引量: ${fmtUsd(md?.total_volume?.usd)}`,
      `  ATH: ${fmtPrice(md?.ath?.usd)}  ATH比: ${fmt(md?.ath_change_percentage?.usd)}%`,
      `  流通量: ${fmtUsd(md?.circulating_supply)}  総供給量: ${fmtUsd(md?.total_supply ?? md?.max_supply)}`,
      `  完全希薄化時価総額(FDV): ${fmtUsd(md?.fully_diluted_valuation?.usd)}`,
      `  Twitterフォロワー: ${fmt(cd?.twitter_followers, 0)}  Redditサブスクライバー: ${fmt(cd?.reddit_subscribers, 0)}`,
    );
    if (cgData.description?.en) {
      const desc = cgData.description.en.replace(/<[^>]+>/g, "").slice(0, 200);
      lines.push(`  概要: ${desc}…`);
    }
    if (cgData.categories?.length) {
      lines.push(`  カテゴリ: ${cgData.categories.slice(0, 5).join(", ")}`);
    }
    const platforms = cgData.platforms ?? cgData.detail_platforms;
    if (platforms && Object.keys(platforms).length > 0) {
      const addrs = Object.entries(platforms)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join("  |  ");
      lines.push(`  デプロイ済みチェーン: ${addrs}`);
    }
  } else {
    lines.push(`\n[CoinGecko] データなし（未上場またはアドレス直接検索）`);
  }

  if (dexPairs && dexPairs.length > 0) {
    lines.push(`\n[DEXScreener] 上位${dexPairs.length}ペア`);
    dexPairs.forEach((pair, i) => {
      const liq  = pair.liquidity?.usd;
      const vol  = pair.volume?.h24;
      const pch  = pair.priceChange?.h24;
      const txns = pair.txns?.h24;
      lines.push(
        `  ペア${i + 1}: ${pair.baseToken?.symbol ?? "?"}/${pair.quoteToken?.symbol ?? "?"}` +
        `  Chain: ${pair.chainId}  DEX: ${pair.dexId}`,
        `    価格: ${fmtPrice(parseFloat(pair.priceUsd ?? "0"))}` +
        `  24h変動: ${fmt(pch)}%` +
        `  流動性: ${fmtUsd(liq)}` +
        `  24h出来高: ${fmtUsd(vol)}` +
        `  24h買い/売り: ${txns?.buys ?? "N/A"}/${txns?.sells ?? "N/A"}`,
      );
    });
  }

  if (gtToken?.data) {
    const attr = gtToken.data.attributes ?? {};
    lines.push(
      `\n[GeckoTerminal Token]`,
      `  名前: ${attr.name ?? "N/A"}  シンボル: ${attr.symbol ?? "N/A"}`,
      `  価格: ${fmtPrice(parseFloat(attr.price_usd ?? "0"))}`,
      `  FDV: ${fmtUsd(parseFloat(attr.fdv_usd ?? "0"))}`,
      `  時価総額: ${fmtUsd(parseFloat(attr.market_cap_usd ?? "0"))}`,
      `  24h取引量: ${fmtUsd(parseFloat(attr.volume_usd?.h24 ?? "0"))}`,
    );
  }

  if (gtPools && gtPools.length > 0) {
    lines.push(`\n[GeckoTerminal プール]`);
    gtPools.forEach((pool, i) => {
      const a = pool.attributes ?? {};
      lines.push(
        `  プール${i + 1}: ${a.name ?? "N/A"}`,
        `    流動性: ${fmtUsd(parseFloat(a.reserve_in_usd ?? "0"))}` +
        `  24h出来高: ${fmtUsd(parseFloat(a.volume_usd?.h24 ?? "0"))}`,
      );
    });
  }

  if (trending?.coins?.length) {
    const topCoins = trending.coins.slice(0, 5).map(
      (c: { item: { name: string; symbol: string; market_cap_rank: number } }) =>
        `${c.item.name}(${c.item.symbol})#${c.item.market_cap_rank ?? "?"}`
    );
    lines.push(`\n[CoinGecko トレンド Top5] ${topCoins.join("  ")}`);
  }

  if (isContract) lines.push(`\n[検索クエリ] コントラクトアドレス: ${query}`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(
  coinData: string,
  goPlusData: string = "",
  defiLlamaData: string = "",
  fearGreedData: string = ""
): string {
  return `あなたは世界トップクラスの仮想通貨VCで「リスク検知」「スマートマネー追跡」「価格操作検出」「アルファ発掘」を統括するシニア・フォレンジック・アナリストです。

## 行動規範
- 表面的なマーケティングに惑わされず、提供されたデータのみを根拠とせよ
- 不確実・未検証の情報には必ず [推定] を付記せよ
- 断言できない場合は確率的表現（「〜の可能性が高い」）を使え
- 中立・客観を保ち、バイアスのある記述を避けよ

## 必須思考プロセス（出力前に内部で実行せよ）

<thinking>
Step 1 ── データ整合性チェック
- 提供データの矛盾確認・欠損データのリストアップ

Step 2 ── スコアリング（アンカー基準を厳守）
Alpha scoring anchor:
  90-100: MC/FDV>0.6 かつ 60日以内に大型カタリスト確定 かつ スマートマネー買い集め確認
  70-89:  MC/FDV>0.4 かつ 出来高増加トレンド かつ 開発活動活発
  50-69:  標準的な成長期待・特段のカタリストなし
  30-49:  FDV希薄化リスク高 or セクター逆風 or 開発停滞
  0-29:   Rug/Scam疑い or アンロック爆弾 or LP危機

Risk scoring anchor:
  90-100: Mint権限あり + LP未Lock + インサイダー保有>30% + 監査なし
  70-89:  重大なアンロック予定 or 取引所流入急増
  50-69:  標準的リスク水準
  30-49:  リスク管理良好・監査済み
  0-29:   LP永続Lock + 監査複数 + インサイダー<5%

Manipulation risk scoring anchor (100点満点):
  80-100: ウォッシュトレード確認・価格操作明確・フラッシュクラッシュ多発
  60-79:  異常な出来高スパイク・ウォレット集中度高
  40-59:  標準的な変動
  20-39:  分散したホルダー・自然な価格形成
  0-19:   完全な透明性・監査済み・機関参加

Smart money scoring anchor (100点満点):
  80-100: 複数のスマートマネーウォレットが買い集め・大手VCポジション増加
  60-79:  一部スマートマネー参加・良好なシグナル
  40-59:  標準的な参加度
  20-39:  スマートマネー売却・撤退シグナル
  0-19:   スマートマネー完全撤退・インサイダー売り

Community scoring anchor (100点満点):
  80-100: Twitter10万+・Discord活発・KOL多数・有機的成長
  60-79:  Twitter1万+・Discord普通・定期的な活動あり
  40-59:  Twitter1000+・活動は散発的
  20-39:  コミュニティ小規模・bot疑い多い
  0-19:   事実上コミュニティなし・放棄疑い

Step 3 ── 矛盾チェック（必須）
- Alpha>75 かつ Risk>70 → ⚡高リスク高期待フラグを付与して矛盾理由を記述
- GoPlus でハニーポット検出 → Risk を90以上に強制設定

Step 4 ── ランク確定（必ずJSONに含めること）
S: Alpha≥85 かつ Risk≤35 → 即時エントリー候補・ポートフォリオ10〜15%
A: Alpha≥70 かつ Risk≤50 → 優先検討・ポートフォリオ7〜10%
B: Alpha≥55 かつ Risk≤60 → 様子見・ポートフォリオ3〜5%
C: Alpha≥40              → シグナル弱・保留・1〜3%
D: Alpha<40 かつ Risk<50  → 静観・ポジションなし
E: Risk>70               → 悪化トレンド・回避推奨
F: Risk>85 または Scam疑い → 即回避・ポジションゼロ
</thinking>

## 提供データ
${coinData}
${goPlusData ? `\n## セキュリティスキャン（GoPlus）\n${goPlusData}` : ""}
${defiLlamaData ? `\n## TVLデータ（DeFiLlama）\n${defiLlamaData}` : ""}
${fearGreedData ? `\n## マクロ指標\n${fearGreedData}` : ""}

## 出力形式（必ず守ること）

### 📊 最終統合診断
【総合リスクスコア: _ / 100】
【爆上げ期待値: _ / 100】
【操作リスクスコア: _ / 100】
【スマートマネースコア: _ / 100】
【コミュニティスコア: _ / 100】
【ランク: S / A / B / C / D / E / F】
【投資判断: 推奨(Gem) / 投機的(Degen) / 要注意 / 回避推奨】

（以下、9 Pillars分析を実施）

### 💡 アクションプラン
- エントリー目安: 価格帯・テクニカルトリガー
- 利確トリガー: 具体的な価格・条件
- 損切りトリガー: 具体的な条件
- 推奨ポジションサイズ: ポートフォリオの何%

### 📤 システム連携用JSON（末尾に必ず出力）
\`\`\`json
{
  "ticker_ca": "",
  "rank": "S|A|B|C|D|E|F",
  "risk_score_100": 0,
  "alpha_score_100": 0,
  "manipulation_risk_score_100": 0,
  "smart_money_score_100": 0,
  "community_score_100": 0,
  "community_detail": "",
  "investment_decision": "",
  "entry_guidance": "",
  "profit_target_trigger": "",
  "stop_loss_trigger": "",
  "stop_loss_pct": 0,
  "stop_loss_price": 0,
  "recommended_position_size": "",
  "bull_price": 0,
  "base_price": 0,
  "bear_price": 0,
  "key_catalysts": [],
  "tail_risks": [],
  "security": {
    "goplus_flags": [],
    "lp_burn_status": "",
    "contract_risk": "",
    "insider_holding_ratio": ""
  }
}
\`\`\`
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic web_search tool
// ─────────────────────────────────────────────────────────────────────────────
const WEB_SEARCH_TOOL: WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // ── トップレベル try-catch: 未捕捉例外でもJSON を返す ──
  try {
    return await handlePost(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chat/route] Unhandled top-level error:", err);
    return Response.json({ error: `サーバーエラーが発生しました: ${msg}`, dataSources: [] }, { status: 500 });
  }
}

async function handlePost(request: NextRequest): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const remaining = checkRateLimit(ip);
  if (remaining < 0) {
    return Response.json(
      { error: "1日の利用上限（20回）に達しました。明日またお試しください。" },
      { status: 429 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError("ANTHROPIC_API_KEY が設定されていません。環境変数を確認してください。");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (err) {
    console.error("[chat/route] Request body parse error:", err);
    return jsonError("リクエストボディのJSONが不正です。", 400);
  }

  const query = (typeof body.query === "string" ? body.query : "").trim();
  if (!query) {
    return jsonError("query フィールドが空です。銘柄名またはアドレスを入力してください。", 400);
  }

  const qLower    = query.toLowerCase().trim();
  const isContract = isContractAddress(query);
  const isEvm      = isEvmAddress(query);
  const isSolana   = isSolanaAddress(query);
  const coinId     = COIN_ID_MAP[qLower] ?? qLower;
  const coinName   = COIN_NAME_MAP[qLower] ?? query;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cgData:   any             = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dexPairs: any[] | null    = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gtToken:  any             = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gtPools:  any[] | null    = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let trending: any             = null;

  if (isContract) {
    const network = isEvm ? "eth" : "solana";
    const [dex, gt, gtp] = await Promise.all([
      fetchDexScreenerByAddress(query),
      fetchGeckoTerminalToken(network, query),
      fetchGeckoTerminalPools(network, query),
    ]);
    dexPairs = dex;
    gtToken  = gt;
    gtPools  = gtp;

    if (isEvm) {
      const cgResults = await Promise.all(
        Object.values(EVM_PLATFORMS).map(p => fetchCoinGeckoByContract(p, query))
      );
      cgData = cgResults.find(r => r !== null) ?? null;
    }

    if (!cgData && dexPairs && dexPairs.length > 0) {
      const topPair = dexPairs[0] as { chainId?: string };
      if (topPair.chainId) {
        const refined = chainIdToGeckoTerminalNetwork(topPair.chainId);
        if (refined !== network) {
          const [gt2, gtp2] = await Promise.all([
            fetchGeckoTerminalToken(refined, query),
            fetchGeckoTerminalPools(refined, query),
          ]);
          if (gt2)  gtToken = gt2;
          if (gtp2) gtPools = gtp2;
        }
      }
    }
  } else {
    const [cgById, dex, trend] = await Promise.all([
      coinId !== qLower || COIN_ID_MAP[qLower]
        ? fetchCoinGeckoById(coinId)
        : fetchCoinGeckoBySearch(query),
      fetchDexScreenerBySearch(query),
      fetchCoinGeckoTrending(),
    ]);
    cgData   = cgById ?? await fetchCoinGeckoBySearch(query);
    dexPairs = dex;
    trending = trend;

    if (cgData?.platforms) {
      const platforms: Record<string, string> = cgData.platforms;
      const ethAddr = platforms["ethereum"] ?? platforms["solana"] ??
        Object.values(platforms).find(v => v);
      if (ethAddr) {
        const gtNetwork = platforms["ethereum"] ? "eth" : platforms["solana"] ? "solana" : "eth";
        const [gt, gtp] = await Promise.all([
          fetchGeckoTerminalToken(gtNetwork, ethAddr),
          fetchGeckoTerminalPools(gtNetwork, ethAddr),
        ]);
        gtToken = gt;
        gtPools = gtp;
      }
    }
  }

  // ── Build shared data ──
  const coinSymbol = cgData?.symbol?.toUpperCase() ?? coinName;

  const dataSources = buildDataSources({
    cgData, dexPairs, gtToken, gtPools,
    query, coinId, coinSymbol,
    isEvm, isSolana, isContract,
  });

  const coin = buildCoinSummary(cgData);

  const realtimeCtx = buildRealtimeContext({
    cgData, dexPairs, gtToken, gtPools, trending,
    query, coinName: cgData?.name ?? coinName, isContract,
  });

  // 無料API並列取得
  const [goPlusData, defiLlamaData, fearGreedData] = await Promise.all([
    isContractAddress(query) ? fetchGoPlusSecurity(query) : Promise.resolve(""),
    fetchDeFiLlamaProtocol(query),
    fetchFearGreedIndex(),
  ]);

  const systemPrompt  = buildSystemPrompt(realtimeCtx, goPlusData, defiLlamaData, fearGreedData); // coinData = realtimeCtx
  const userMessage   = isContract
    ? `コントラクトアドレス「${query}」（${isEvm ? "EVM系" : "Solana系"}）について、` +
      `web_searchで重要な情報を最大3回検索し、全セクションを簡潔に日本語で報告してください。`
    : `「${coinName}」（入力: "${query}"）について、` +
      `web_searchで重要な情報を最大3回検索し、全セクションを簡潔に日本語で報告してください。`;

  return runAgenticLoop(apiKey, systemPrompt, userMessage, dataSources, coin, remaining);
} // end handlePost

// ─────────────────────────────────────────────────────────────────────────────
// Agentic loop (streaming)
// ─────────────────────────────────────────────────────────────────────────────
async function runAgenticLoop(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  dataSources: DataSource[],
  coin: CoinSummary | null,
  remainingCount: number,
): Promise<Response> {
  const encoder = new TextEncoder();
  // First line: JSON metadata (dataSources + coin + rate limit info), then stream AI text
  const metaLine = JSON.stringify({ dataSources, coin, remainingCount, dailyLimit: DAILY_LIMIT }) + "\n";

  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(metaLine));

      try {
        const client = new Anthropic({ apiKey });
        const messages: MessageParam[] = [{ role: "user", content: userMessage }];
        const MAX_ITERATIONS = 4;
        let textStreamed = false;

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const msgStream = client.messages.stream({
            model: "claude-sonnet-4-5",
            max_tokens: 5000,
            system: systemPrompt,
            tools: [WEB_SEARCH_TOOL],
            messages,
          });

          // Stream each text token to the client as it arrives
          const response = await msgStream
            .on("text", (text) => {
              controller.enqueue(encoder.encode(text));
              textStreamed = true;
            })
            .finalMessage();

          if (response.stop_reason === "end_turn") break;

          if (response.stop_reason === "tool_use") {
            messages.push({ role: "assistant", content: response.content });
            const toolResults: MessageParam["content"] = [];
            for (const block of response.content) {
              if (block.type === "tool_use") {
                const tu = block as ToolUseBlock;
                toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "" });
              } else if (block.type === "web_search_tool_result") {
                const sr = block as WebSearchToolResultBlock;
                toolResults.push({ type: "tool_result", tool_use_id: sr.tool_use_id, content: "" });
              }
            }
            if (toolResults.length > 0) {
              messages.push({ role: "user", content: toolResults });
            }
            continue;
          }

          break;
        }

        if (!textStreamed) {
          console.error("[chat/route] Agentic loop completed but no text was extracted");
          controller.enqueue(encoder.encode("Anthropic APIからテキストレスポンスが返りませんでした。"));
        }
      } catch (error) {
        let msg = "不明なエラー";
        if (error instanceof APIError) {
          const status = error.status ?? 500;
          const errMsg = error.message ?? "";
          console.error(`[chat/route] Anthropic APIError (${status}):`, errMsg);
          const isCreditError =
            status === 402 ||
            /credit|billing|balance|insufficient/i.test(errMsg);
          if (isCreditError) {
            msg =
              "💳 Anthropic APIのクレジット残高が不足しています。\n" +
              "残高の確認・チャージはこちら:\n" +
              "https://console.anthropic.com/settings/billing";
          } else if (status === 401) {
            msg = "ANTHROPIC_API_KEY が無効です。キーを確認してください。";
          } else if (status === 429) {
            msg = "APIのレート制限に達しました。しばらく待ってから再試行してください。";
          } else if (status === 529) {
            msg = "Anthropic APIが過負荷状態です。しばらく待ってから再試行してください。";
          } else {
            msg = `Anthropic API エラー (${status}): ${errMsg}`;
          }
        } else if (error instanceof Error) {
          msg = error.message;
        }
        console.error("[chat/route] runAgenticLoop error:", error);
        controller.enqueue(encoder.encode(`\n\n[エラー] ${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
