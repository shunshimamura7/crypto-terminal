/**
 * 22hハンター API
 *
 * MEXC新規上場銘柄のうち、上場後20-32hの銘柄を検出する。
 * S01-listing+22h戦略の実装（バックテスト勝率69.6%、期待値+1.50%）。
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEXC = "https://api.mexc.com";

// ─── インメモリキャッシュ（warm instance reuse） ──────────────
const _apiCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const e = _apiCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    _apiCache.delete(key);
    return null;
  }
  return e.data as T;
}

function setCached(key: string, data: unknown): void {
  _apiCache.set(key, { data, ts: Date.now() });
}

// ─── 戦略パラメータ（バックテスト確定値） ──────────────────────
const STRATEGY = {
  entryHourTarget: 22,
  entryWindowMin: 20,
  entryWindowMax: 24,
  subEntryMin: 26,
  subEntryMax: 30,
  expiredAfter: 32,
  approachingFrom: 6,
  tpPct: -10,
  slPct: 18,
};

const MIN_VOL_24H_USD = 50_000;
const MIN_OI_USD = 5_000;

// ─── 型 ─────────────────────────────────────────────────────────
interface ContractDetail {
  symbol: string;
  baseCoin?: string;
  createTime?: number;
  state?: number;
}

interface Ticker {
  symbol: string;
  lastPrice?: string;
  amount24?: string;
  volume24?: string;
  riseFallRate?: string;
  fundingRate?: string;
  fairPrice?: string;
  holdVol?: string;
  high24Price?: string;
  low24Price?: string;
}

export interface ListingHunterCandidate {
  symbol: string;
  baseCoin: string;
  category: "entry-window" | "approaching" | "sub-window" | "expired";
  hoursSinceListing: number;
  hoursUntilEntry: number | null;
  currentPrice: number;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  vol24hUsd: number;
  openInterestUsd: number;
  fundingRate: number;
  tradeSetup: {
    entryPrice: number;
    tpPrice: number;
    slPrice: number;
    rr: string;
  };
  warnings: {
    lowVolume: boolean;
    lowOI: boolean;
    negativeFR: boolean;
    extremePump: boolean;
  };
  listedAt: string;
}

export interface ListingHunterResponse {
  success: boolean;
  scanTime: string;
  strategy: typeof STRATEGY & { tpPctFmt: string; slPctFmt: string };
  candidates: ListingHunterCandidate[];
  meta: {
    totalContracts: number;
    listedWithin72h: number;
    excludedStocks: number;
    inEntryWindow: number;
    inSubWindow: number;
    approaching: number;
    expired: number;
  };
  error?: string;
}

// ─── MEXC API 取得 ────────────────────────────────────────────
async function mexcGet<T>(path: string, timeoutMs = 20_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${MEXC}${path}`, {
      headers: { "User-Agent": "bell-crypto-terminal/listing-hunter" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[listing-hunter] MEXC ${path} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    clearTimeout(timer);
    console.error(`[listing-hunter] MEXC ${path} fetch error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

interface MexcDetailResponse {
  success: boolean;
  data: ContractDetail[];
}

interface MexcTickerResponse {
  success: boolean;
  data: Ticker[];
}

// ─── ハンドラ ────────────────────────────────────────────────
export async function GET(): Promise<Response> {
  // キャッシュ取得
  let detail = getCached<ContractDetail[]>("detail");
  let ticker = getCached<Ticker[]>("ticker");

  // キャッシュ未ヒットのものだけ並列取得
  const fetches: Promise<void>[] = [];
  if (!detail) {
    fetches.push(
      mexcGet<MexcDetailResponse>("/api/v1/contract/detail").then((r) => {
        if (r?.success && Array.isArray(r.data)) {
          detail = r.data;
          setCached("detail", r.data);
        }
      }),
    );
  }
  if (!ticker) {
    fetches.push(
      mexcGet<MexcTickerResponse>("/api/v1/contract/ticker").then((r) => {
        if (r?.success && Array.isArray(r.data)) {
          ticker = r.data;
          setCached("ticker", r.data);
        }
      }),
    );
  }

  if (fetches.length > 0) await Promise.all(fetches);

  if (!detail || !ticker) {
    const detailMissing = !detail;
    const tickerMissing = !ticker;
    return NextResponse.json<ListingHunterResponse>(
      {
        success: false,
        scanTime: new Date().toISOString(),
        strategy: { ...STRATEGY, tpPctFmt: `${STRATEGY.tpPct}%`, slPctFmt: `+${STRATEGY.slPct}%` },
        candidates: [],
        meta: { totalContracts: 0, listedWithin72h: 0, excludedStocks: 0, inEntryWindow: 0, inSubWindow: 0, approaching: 0, expired: 0 },
        error: `MEXC API接続失敗 (detail: ${detailMissing ? "FAIL" : "OK"}, ticker: ${tickerMissing ? "FAIL" : "OK"})`,
      },
      { status: 502 },
    );
  }

  const tickerMap = new Map<string, Ticker>(ticker.map((t) => [t.symbol, t]));
  const now = Date.now();

  // 株式先物（AAPLSTOCK_USDT, NFLXSTOCK_USDT 等）は S01 の統計的根拠から外れるため除外
  const STOCK_PATTERN = /STOCK_USDT$/i;

  const excludedStocks = detail.filter((c) =>
    c.symbol?.endsWith("_USDT") &&
    STOCK_PATTERN.test(c.symbol) &&
    !!c.createTime &&
    (now - c.createTime) / 3_600_000 <= 72
  ).length;

  const fresh = detail.filter((c) => {
    if (!c.symbol?.endsWith("_USDT")) return false;
    if (!c.createTime) return false;
    if (STOCK_PATTERN.test(c.symbol)) return false;
    const hours = (now - c.createTime) / 3_600_000;
    return hours <= 72;
  });

  const candidates: ListingHunterCandidate[] = [];

  for (const c of fresh) {
    const t = tickerMap.get(c.symbol);
    if (!t) continue;

    const price = parseFloat(t.lastPrice || t.fairPrice || "0");
    if (!price || price <= 0) continue;

    const hoursSince = (now - c.createTime!) / 3_600_000;

    let category: ListingHunterCandidate["category"];
    let hoursUntilEntry: number | null = null;

    if (hoursSince >= STRATEGY.expiredAfter) {
      category = "expired";
    } else if (hoursSince > STRATEGY.entryWindowMax && hoursSince < STRATEGY.subEntryMin) {
      // 24-26h の隙間 → sub-window 寄りに分類
      category = "sub-window";
    } else if (hoursSince >= STRATEGY.subEntryMin && hoursSince <= STRATEGY.subEntryMax) {
      category = "sub-window";
    } else if (hoursSince > STRATEGY.subEntryMax && hoursSince < STRATEGY.expiredAfter) {
      // 30-32h の隙間 → expired 寄り
      category = "expired";
    } else if (hoursSince >= STRATEGY.entryWindowMin && hoursSince <= STRATEGY.entryWindowMax) {
      category = "entry-window";
    } else if (hoursSince >= STRATEGY.approachingFrom) {
      category = "approaching";
      hoursUntilEntry = STRATEGY.entryHourTarget - hoursSince;
    } else {
      continue;
    }

    const vol24h = parseFloat(t.amount24 || "0") || (parseFloat(t.volume24 || "0") * price);
    const openInterest = parseFloat(t.holdVol || "0") * price;
    const fundingRate = parseFloat(t.fundingRate || "0");
    const priceChange24h = parseFloat(t.riseFallRate || "0") * 100;
    const high24 = parseFloat(t.high24Price || "0") || price;
    const low24 = parseFloat(t.low24Price || "0") || price;

    const tpPrice = price * (1 + STRATEGY.tpPct / 100);
    const slPrice = price * (1 + STRATEGY.slPct / 100);
    const rr = (Math.abs(STRATEGY.tpPct) / STRATEGY.slPct).toFixed(2);

    candidates.push({
      symbol: c.symbol,
      baseCoin: c.baseCoin ?? c.symbol.replace(/_USDT$/, ""),
      category,
      hoursSinceListing: parseFloat(hoursSince.toFixed(1)),
      hoursUntilEntry: hoursUntilEntry !== null ? parseFloat(hoursUntilEntry.toFixed(1)) : null,
      currentPrice: price,
      high24h: high24,
      low24h: low24,
      priceChange24h,
      vol24hUsd: vol24h,
      openInterestUsd: openInterest,
      fundingRate,
      tradeSetup: { entryPrice: price, tpPrice, slPrice, rr: `1:${rr}` },
      warnings: {
        lowVolume: vol24h < MIN_VOL_24H_USD,
        lowOI: openInterest < MIN_OI_USD,
        negativeFR: fundingRate < 0,
        extremePump: priceChange24h >= 50,
      },
      listedAt: new Date(c.createTime!).toISOString(),
    });
  }

  const order: Record<ListingHunterCandidate["category"], number> = {
    "entry-window": 0,
    "sub-window": 1,
    "approaching": 2,
    "expired": 3,
  };
  candidates.sort((a, b) => {
    const o = order[a.category] - order[b.category];
    if (o !== 0) return o;
    return a.hoursSinceListing - b.hoursSinceListing;
  });

  const response: ListingHunterResponse = {
    success: true,
    scanTime: new Date().toISOString(),
    strategy: { ...STRATEGY, tpPctFmt: `${STRATEGY.tpPct}%`, slPctFmt: `+${STRATEGY.slPct}%` },
    candidates,
    meta: {
      totalContracts: detail.length,
      listedWithin72h: fresh.length,
      excludedStocks,
      inEntryWindow: candidates.filter((c) => c.category === "entry-window").length,
      inSubWindow: candidates.filter((c) => c.category === "sub-window").length,
      approaching: candidates.filter((c) => c.category === "approaching").length,
      expired: candidates.filter((c) => c.category === "expired").length,
    },
  };

  return NextResponse.json(response);
}
