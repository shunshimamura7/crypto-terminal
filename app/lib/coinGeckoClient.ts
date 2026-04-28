"use client";

const CG_BASE = "https://api.coingecko.com/api/v3";
const COINS_LIST_KEY = "cg:coins_list";
const COINS_LIST_TTL = 24 * 60 * 60 * 1000; // 24時間

export interface CgMarketData {
  spotVolume: number | null;       // USD全取引所合計
  marketCap: number | null;
  fdv: number | null;
  twitterFollowers: number | null;
  telegramMembers: number | null;
  mexcSharePct: number | null;     // MEXC出来高シェア%
  cgId: string | null;
  mcFdvRatio: number | null;       // MC/FDV比（小さいほど希薄化リスク大）
  exchangeFlowSignal: "inflow" | "outflow" | "neutral" | null; // MEXC出来高集中度
}

interface CoinListEntry { id: string; symbol: string; name: string }

// coins/listをlocalStorageにキャッシュ（24h）
async function fetchCoinsList(apiKey: string): Promise<CoinListEntry[]> {
  if (typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(COINS_LIST_KEY);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < COINS_LIST_TTL) return data as CoinListEntry[];
    }
  } catch { /* ignore */ }

  const url = `${CG_BASE}/coins/list?x_cg_demo_api_key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data: CoinListEntry[] = await res.json();
  try {
    localStorage.setItem(COINS_LIST_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota */ }
  return data;
}

// MexcシンボルからCoinGecko idを解決（複数ヒット時はリストの先頭を使用）
function resolveCgId(base: string, list: CoinListEntry[]): string | null {
  const lower = base.toLowerCase();
  const matches = list.filter(c => c.symbol === lower);
  if (matches.length === 0) return null;
  // 完全一致を優先
  const exact = matches.find(c => c.id === lower || c.id === lower + "-token" || c.name.toLowerCase() === lower);
  return (exact ?? matches[0]).id;
}

// coins/{id}を叩いてデータ取得
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCoinDetail(id: string, apiKey: string): Promise<any | null> {
  const params = new URLSearchParams({
    localization: "false",
    tickers: "true",
    market_data: "true",
    community_data: "true",
    developer_data: "false",
    sparkline: "false",
    x_cg_demo_api_key: apiKey,
  });
  try {
    const res = await fetch(`${CG_BASE}/coins/${id}?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCoinDetail(detail: any, mexcSymbol: string): CgMarketData {
  const md = detail?.market_data ?? {};
  const cd = detail?.community_data ?? {};

  const spotVolume    = md.total_volume?.usd ?? null;
  const marketCap     = md.market_cap?.usd ?? null;
  const fdv           = md.fully_diluted_valuation?.usd ?? null;
  const twitterFollowers = cd.twitter_followers ?? null;
  const telegramMembers  = cd.telegram_channel_user_count ?? null;

  // MEXC出来高シェア計算
  let mexcSharePct: number | null = null;
  const tickers: Array<{ market: { identifier: string }; converted_volume?: { usd?: number } }> = detail?.tickers ?? [];
  if (tickers.length > 0) {
    const totalVol = tickers.reduce((s, t) => s + (t.converted_volume?.usd ?? 0), 0);
    const mexcVol  = tickers
      .filter(t => t.market.identifier.toLowerCase().includes("mexc"))
      .reduce((s, t) => s + (t.converted_volume?.usd ?? 0), 0);
    if (totalVol > 0) mexcSharePct = (mexcVol / totalVol) * 100;
  }

  const mcFdvRatio = (marketCap && fdv && fdv > 0) ? marketCap / fdv : null;

  let exchangeFlowSignal: CgMarketData["exchangeFlowSignal"] = null;
  if (mexcSharePct !== null) {
    if (mexcSharePct > 80) exchangeFlowSignal = "inflow";
    else if (mexcSharePct > 50) exchangeFlowSignal = "neutral";
    else exchangeFlowSignal = "outflow";
  }

  return {
    spotVolume, marketCap, fdv, twitterFollowers, telegramMembers, mexcSharePct,
    cgId: detail?.id ?? null,
    mcFdvRatio,
    exchangeFlowSignal,
  };
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// スコア上位の銘柄（最大20件）のCGデータを取得
// 3並列 → 200ms wait → 次の3件
export async function fetchCoinGeckoData(
  symbols: string[],   // "BASE_USDT" 形式
  apiKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, CgMarketData>> {
  const result = new Map<string, CgMarketData>();
  const list = await fetchCoinsList(apiKey);
  if (list.length === 0) {
    console.warn("[CoinGecko] coins/list empty or failed");
    return result;
  }
  console.log(`[CoinGecko] coins/list: ${list.length} entries`);

  const BATCH = 3;
  let done = 0;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    await Promise.all(batch.map(async (sym) => {
      const base = sym.replace(/_USDT$/, "");
      const id = resolveCgId(base, list);
      if (!id) {
        result.set(sym, { spotVolume: null, marketCap: null, fdv: null, twitterFollowers: null, telegramMembers: null, mexcSharePct: null, cgId: null, mcFdvRatio: null, exchangeFlowSignal: null });
        return;
      }
      const detail = await fetchCoinDetail(id, apiKey);
      if (detail) {
        result.set(sym, parseCoinDetail(detail, sym));
      } else {
        result.set(sym, { spotVolume: null, marketCap: null, fdv: null, twitterFollowers: null, telegramMembers: null, mexcSharePct: null, cgId: null, mcFdvRatio: null, exchangeFlowSignal: null });
      }
    }));
    done += batch.length;
    onProgress?.(done, symbols.length);
    if (i + BATCH < symbols.length) await sleep(200);
  }
  return result;
}

// スコア計算
export function calcFuturesHeatScore(
  futuresVol: number,
  spotVol: number | null,
): number {
  if (!spotVol || spotVol === 0) return 0;
  const ratio = (futuresVol / spotVol) * 100;
  if (ratio > 500) return 2;
  if (ratio > 200) return 1;
  return 0;
}

export function calcSnsHeatScore(
  twitterFollowers: number | null,
  telegramMembers: number | null,
  priceChange7d: number,
): number {
  const totalSns = (twitterFollowers ?? 0) + (telegramMembers ?? 0);
  if (totalSns < 5000 && priceChange7d > 50) return 1;
  return 0;
}

// MC/FDV乖離スコア: FDV/MC比が高い（MC/FDV比が低い）ほど希薄化リスク大 → ショートに有利
export function calcMcFdvScore(mcFdvRatio: number | null): number {
  if (mcFdvRatio === null || mcFdvRatio <= 0) return 0;
  if (mcFdvRatio < 0.1) return 3;  // FDVがMCの10倍以上
  if (mcFdvRatio < 0.2) return 2;  // FDVがMCの5倍以上
  if (mcFdvRatio < 0.5) return 1;  // FDVがMCの2倍以上
  return 0;
}
