import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEXC = "https://api.mexc.com";

const STRATEGY_CONFIG = {
  A1: { tpPct: -3,  slPct: 9,  winRate: 89.7, ev: 1.86, sharpe: 0.542 },
  A2: { tpPct: -5,  slPct: 13, winRate: 86.8, ev: 2.78, sharpe: 0.476 },
  A3: { tpPct: -7,  slPct: 13, winRate: 79.4, ev: 3.12, sharpe: 0.403 },
} as const;

type StrategyKey = keyof typeof STRATEGY_CONFIG;

const WINDOW_MIN_H = 33;
const WINDOW_MAX_H = 39;
const MIN_VOL_24H_USD = 50_000;
const MIN_OI_USD = 5_000;
const HIGH_FR_THRESHOLD = 0.0005;

// ── インメモリキャッシュ ────────────────────────────────────────────
const _cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return e.data as T;
}
function setCached(key: string, data: unknown) {
  _cache.set(key, { data, ts: Date.now() });
}

// ── 型 ────────────────────────────────────────────────────────────
interface ContractDetail {
  symbol: string;
  baseCoin?: string;
  createTime?: number;
}
interface Ticker {
  symbol: string;
  lastPrice?: string;
  fairPrice?: string;
  amount24?: string;
  volume24?: string;
  fundingRate?: string;
  holdVol?: string;
}

export interface Strategy36hCandidate {
  symbol: string;
  baseCoin: string;
  hoursSinceListing: number;
  currentPrice: number;
  fundingRate: number;
  openInterestUsd: number;
  vol24hUsd: number;
  tpPrice: number;
  slPrice: number;
  priority: "high" | "caution";
  warnings: string[];
}

export interface Strategy36hResponse {
  success: boolean;
  strategy: StrategyKey;
  scanTime: string;
  candidates: Strategy36hCandidate[];
  totalScanned: number;
  error?: string;
}

// ── MEXC fetch ─────────────────────────────────────────────────────
async function mexcGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${MEXC}${path}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "bell-crypto-terminal/strategy-36h" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── ハンドラ ───────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<Response> {
  const rawKey = req.nextUrl.searchParams.get("strategy") ?? "A1";
  const strategyKey: StrategyKey = rawKey in STRATEGY_CONFIG ? (rawKey as StrategyKey) : "A1";
  const strategy = STRATEGY_CONFIG[strategyKey];

  // キャッシュ取得
  let detail = getCached<ContractDetail[]>("detail");
  let ticker = getCached<Ticker[]>("ticker");

  const fetches: Promise<void>[] = [];
  if (!detail) {
    fetches.push(
      mexcGet<{ success: boolean; data: ContractDetail[] }>("/api/v1/contract/detail").then(r => {
        if (r?.success && Array.isArray(r.data)) { detail = r.data; setCached("detail", r.data); }
      }),
    );
  }
  if (!ticker) {
    fetches.push(
      mexcGet<{ success: boolean; data: Ticker[] }>("/api/v1/contract/ticker").then(r => {
        if (r?.success && Array.isArray(r.data)) { ticker = r.data; setCached("ticker", r.data); }
      }),
    );
  }
  if (fetches.length) await Promise.all(fetches);

  if (!detail || !ticker) {
    return NextResponse.json<Strategy36hResponse>(
      { success: false, strategy: strategyKey, scanTime: new Date().toISOString(), candidates: [], totalScanned: 0, error: "MEXC API接続失敗" },
      { status: 502 },
    );
  }

  const tickerMap = new Map(ticker.map(t => [t.symbol, t]));
  const now = Date.now();
  const STOCK_RE = /STOCK_USDT$/i;
  let totalScanned = 0;
  const candidates: Strategy36hCandidate[] = [];

  for (const c of detail) {
    if (!c.symbol?.endsWith("_USDT")) continue;
    if (STOCK_RE.test(c.symbol)) continue;
    if (!c.createTime) continue;

    const hoursSince = (now - c.createTime) / 3_600_000;
    if (hoursSince < WINDOW_MIN_H || hoursSince > WINDOW_MAX_H) continue;
    totalScanned++;

    const t = tickerMap.get(c.symbol);
    if (!t) continue;

    const price = parseFloat(t.lastPrice ?? t.fairPrice ?? "0");
    if (!price || price <= 0) continue;

    const vol24h = parseFloat(t.amount24 ?? "0") || parseFloat(t.volume24 ?? "0") * price;
    const openInterest = parseFloat(t.holdVol ?? "0") * price;
    const fundingRate = parseFloat(t.fundingRate ?? "0");

    const tpPrice = price * (1 + strategy.tpPct / 100);
    const slPrice = price * (1 + strategy.slPct / 100);

    const warnings: string[] = [];
    if (vol24h < MIN_VOL_24H_USD) warnings.push("流動性低");
    if (openInterest < MIN_OI_USD) warnings.push("OI不足");
    if (fundingRate > HIGH_FR_THRESHOLD) warnings.push("FR高騰(ロング過熱)");

    candidates.push({
      symbol: c.symbol,
      baseCoin: c.baseCoin ?? c.symbol.replace(/_USDT$/, ""),
      hoursSinceListing: parseFloat(hoursSince.toFixed(1)),
      currentPrice: price,
      fundingRate,
      openInterestUsd: openInterest,
      vol24hUsd: vol24h,
      tpPrice,
      slPrice,
      priority: warnings.length === 0 ? "high" : "caution",
      warnings,
    });
  }

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    return a.hoursSinceListing - b.hoursSinceListing;
  });

  return NextResponse.json<Strategy36hResponse>({
    success: true,
    strategy: strategyKey,
    scanTime: new Date().toISOString(),
    candidates,
    totalScanned,
  });
}
