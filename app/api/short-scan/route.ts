import { NextRequest, NextResponse } from "next/server";
import { calcShortScore, calcVolumeProfile, calcTradeSetup, calcVolumeSpike, calcLiquidationZone, calcATRData } from "@/app/lib/shortScorer";
import type { ShortCandidate, VolumeProfile, TradeSetup, ATRData } from "@/app/lib/shortScorer";
import { fetchGtDexData } from "@/app/lib/geckoTerminal";
import { fetchLiquidityInfo } from "@/app/lib/orderbook";
import { fetchCoinNews } from "@/app/lib/newsCheck";

// ─── BTC相関計算 (施策1) ──────────────────────────────────────────────────────
function priceToReturns(closes: number[]): number[] {
  return closes.slice(1).map((c, i) => closes[i] > 0 ? (c - closes[i]) / closes[i] : 0);
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  const xs = x.slice(0, n), ys = y.slice(0, n);
  const sumX  = xs.reduce((a, b) => a + b, 0);
  const sumY  = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, xi, i) => acc + xi * ys[i], 0);
  const sumX2 = xs.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = ys.reduce((acc, yi) => acc + yi * yi, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  return den === 0 ? 0 : Math.max(-1, Math.min(1, num / den));
}

export const runtime = "nodejs";
export const maxDuration = 120;

const MEXC = "https://api.mexc.com";

// ─── In-memory cache (warm instance reuse, 10-min TTL) ───────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _apiCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCached(key: string): any | null {
  const e = _apiCache.get(key);
  if (!e || Date.now() - e.ts > CACHE_TTL_MS) return null;
  return e.data;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCached(key: string, data: any) { _apiCache.set(key, { data, ts: Date.now() }); }

// ─── Phase A: 4h klineキャッシュ (10-min TTL) ────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _kline4hCache = new Map<string, { value: any; ts: number }>();
const KLINE4H_TTL = 10 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchKline4h(symbol: string, day14AgoSec: number, nowSec: number): Promise<any> {
  const key = `kline4h_${symbol}`;
  const cached = _kline4hCache.get(key);
  if (cached && Date.now() - cached.ts < KLINE4H_TTL) return cached.value;

  let res = await mexcGet(
    `/api/v1/contract/kline/${symbol}?interval=Hour4&start=${day14AgoSec}&end=${nowSec}`,
    10000,
  );
  // Retry once on null (timeout/network error); empty-data responses are not retried
  if (res === null) {
    await sleep(3000);
    res = await mexcGet(
      `/api/v1/contract/kline/${symbol}?interval=Hour4&start=${day14AgoSec}&end=${nowSec}`,
      10000,
    );
  }
  // Only cache valid responses; don't poison the cache with failed/empty fetches
  if (Array.isArray(res?.data?.close) && res.data.close.length > 0) {
    _kline4hCache.set(key, { value: res, ts: Date.now() });
  }
  return res;
}

// Non-crypto tokenized assets (equities, commodities, forex, indices)
const NON_CRYPTO_PATTERNS = [
  /^(GOLD|SILVER|COPPER|XAU|XAG|XPD|XPT)_/i,
  /^(HK50|SPX|NASDAQ|NDX|DJI|FTSE|DAX|NI225|HSI|KOSPI|CAC40|IBEX|ASX200)_/i,
  /^(WTI|BRENT|NATGAS|WHEAT|CORN|SOYBEAN|SUGAR|COFFEE|COTTON|COCOA)_/i,
  /^(EUR|GBP|JPY|AUD|CAD|CHF|NZD|KRW|HKD|CNH|SGD|MXN|BRL|INR|ZAR)_/i,
];
// STOCK文字列を含むシンボルの例外（除外しないcrypto銘柄）
const STOCK_EXCEPTIONS = new Set<string>([]);
function isNonCrypto(symbol: string): boolean {
  if (NON_CRYPTO_PATTERNS.some(p => p.test(symbol))) return true;
  // _USDTを除去してからSTOCKを含むか確認（NBISSTOCK_USDTなど末尾$が機能しないため）
  const stripped = symbol.replace(/_USDT$/i, "").toUpperCase();
  if (/STOCK/.test(stripped) && !STOCK_EXCEPTIONS.has(stripped)) return true;
  return false;
}

const MAJOR_PAIRS = new Set([
  "BTC_USDT","ETH_USDT","BNB_USDT","SOL_USDT","XRP_USDT","DOGE_USDT","ADA_USDT","AVAX_USDT",
  "DOT_USDT","MATIC_USDT","LINK_USDT","UNI_USDT","ATOM_USDT","LTC_USDT","BCH_USDT","NEAR_USDT",
  "FIL_USDT","APT_USDT","ARB_USDT","OP_USDT","MKR_USDT","AAVE_USDT","CRV_USDT","SNX_USDT",
  "COMP_USDT","TRX_USDT","ETC_USDT","XLM_USDT","ALGO_USDT","ICP_USDT","VET_USDT","HBAR_USDT",
  "FTM_USDT","SAND_USDT","MANA_USDT","AXS_USDT","GALA_USDT","THETA_USDT","EOS_USDT","XTZ_USDT",
  "FLOW_USDT","CHZ_USDT","ENJ_USDT","ZIL_USDT","ONE_USDT","SUI_USDT","SEI_USDT","TIA_USDT",
  "JUP_USDT","WLD_USDT","PEPE_USDT","WIF_USDT","BONK_USDT","FLOKI_USDT","SHIB_USDT",
]);

// Stage 2 concurrency: 30 parallel / 30ms delay (reduced to accommodate Spot API fallback per coin)
const MAX_KLINE_TARGETS = 400;
const BATCH = 30;
const BATCH_DELAY = 30;

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mexcGet(path: string, ms = 10000): Promise<any> {
  const res = await fetchWithTimeout(`${MEXC}${path}`, ms);
  if (!res?.ok) return null;
  try { return await res.json(); } catch { return null; }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ─── MEXC Spot API kline (先物kline失敗時のフォールバック) ───────────────────
// 先物シンボル "OKB_USDT" → スポットシンボル "OKBUSDT"（アンダースコアなし）
function toSpotSymbol(futuresSymbol: string): string {
  return futuresSymbol.replace("_", "");
}

const SPOT_INTERVAL: Record<string, string> = { Hour1: "1h", Hour4: "4h", Day1: "1d" };

async function mexcSpotKline(
  futuresSymbol: string,
  interval: "Hour1" | "Hour4" | "Day1",
  limit: number,
): Promise<{ closes: number[]; highs: number[]; lows: number[]; vols: number[] } | null> {
  const spotSymbol = toSpotSymbol(futuresSymbol);
  const spotInterval = SPOT_INTERVAL[interval];
  const url = `${MEXC}/api/v3/klines?symbol=${spotSymbol}&interval=${spotInterval}&limit=${limit}`;
  const res = await fetchWithTimeout(url, 8000);
  if (!res?.ok) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = await res.json();
    if (!Array.isArray(data) || data.length < 3) return null;
    // Spot kline format: [timestamp, open, high, low, close, volume, ...]
    const closes: number[] = [], highs: number[] = [], lows: number[] = [], vols: number[] = [];
    for (const bar of data) {
      const h = parseFloat(bar[2]), l = parseFloat(bar[3]), c = parseFloat(bar[4]), v = parseFloat(bar[5]);
      if (c > 0) { closes.push(c); highs.push(h); lows.push(l); vols.push(v); }
    }
    return closes.length >= 3 ? { closes, highs, lows, vols } : null;
  } catch { return null; }
}

interface CandidateMeta {
  symbol: string;
  listedDaysAgo: number;
  vol24hEst: number;
  riseFallRate: number;  // 24h price change ratio from ticker (for Stage 1 sort)
  createTime: number;   // ms epoch (0 = unknown)
}

async function analyzeCandidate(
  meta: CandidateMeta,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticker: any,
  day14AgoSec: number,
  day7AgoSec: number,
  day90AgoSec: number,
  nowSec: number,
  isNew30: boolean,
  btcReturns: number[],  // 施策1: BTC収益率系列
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prefetchedKline4h?: any,  // Phase Aで取得済みの4h klineデータ
): Promise<ShortCandidate | null> {
  const { symbol, listedDaysAgo, createTime } = meta;

  const price = parseFloat(ticker.lastPrice || ticker.indexPrice || "0");
  if (!price) return null;
  const indexPrice = parseFloat(ticker.indexPrice || "0");
  const priceDeviation = (indexPrice > 0 && price > 0) ? ((price - indexPrice) / indexPrice) * 100 : null;

  const vol24h = (() => {
    const a = parseFloat(ticker.amount24 || "0");
    if (a > 0) return a;
    return parseFloat(ticker.volume24 || "0") * price;
  })();

  // 24h変動率 (riseFallRate は小数表現: 0.05 = +5%)
  const priceChange24h = parseFloat(ticker.riseFallRate || "0") * 100;

  // 速度最適化: 1h=2日分(~48本), 1d=14日分, FR=tickerから取得済みなのでスキップ
  const day2AgoSec = nowSec - 2 * 86_400;
  const [kline1hRes, kline4hRes, kline1dRes, frRes, liquidityRes] = await Promise.allSettled([
    mexcGet(`/api/v1/contract/kline/${symbol}?interval=Hour1&start=${day2AgoSec}&end=${nowSec}`, 7000),
    prefetchedKline4h !== undefined
      ? Promise.resolve(prefetchedKline4h)
      : mexcGet(`/api/v1/contract/kline/${symbol}?interval=Hour4&start=${day14AgoSec}&end=${nowSec}`, 7000),
    mexcGet(`/api/v1/contract/kline/${symbol}?interval=Day1&start=${day90AgoSec}&end=${nowSec}`, 10000),
    mexcGet(`/api/v1/contract/funding_rate/${symbol}`, 4000),
    fetchLiquidityInfo(symbol),
  ]);

  // 施策2: 1h closes
  const closes1h: number[] = [];
  if (kline1hRes.status === "fulfilled" && kline1hRes.value?.data) {
    for (const c of (kline1hRes.value.data.close || []) as string[]) {
      const n = parseFloat(c);
      if (n > 0) closes1h.push(n);
    }
  }

  // 22hハンター: 先物上場タイムスタンプ
  const nowMs = nowSec * 1000;
  const futuresListedAt = createTime > 0 ? new Date(createTime).toISOString() : undefined;
  const hoursFromFutures = createTime > 0 ? (nowMs - createTime) / 3_600_000 : undefined;

  // ATH: max high from 4h klines
  let ath14d = price;
  let ath14dFromKline = false;
  const closes4h: number[] = [];
  let volumeProfile: VolumeProfile | null = null;
  let tradeSetup: TradeSetup | null = null;
  let atrData: ATRData | null = null;
  let kHighs4h: number[] = [];
  let kLows4h:  number[] = [];
  let kVols4h:  number[] = [];

  if (kline4hRes.status === "fulfilled" && kline4hRes.value?.data) {
    const kd = kline4hRes.value.data;
    kHighs4h = (kd.high || []).map(Number).filter((n: number) => n > 0);
    if (kHighs4h.length > 0) { ath14d = Math.max(price, ...kHighs4h); ath14dFromKline = true; }
    for (const c of (kd.close || []) as string[]) {
      const n = parseFloat(c);
      if (n > 0) closes4h.push(n);
    }
    kLows4h  = (kd.low || []).map(Number);
    kVols4h  = (kd.vol || []).map(Number);
    if (kHighs4h.length >= 3 && kLows4h.length === kHighs4h.length && kVols4h.length === kHighs4h.length) {
      volumeProfile = calcVolumeProfile(kHighs4h, kLows4h, kVols4h, price);
    }
  }

  // Spot API 4h fallback: futures kline has no data → try MEXC Spot API
  if (closes4h.length < 3) {
    const spotData = await mexcSpotKline(symbol, "Hour4", 84);
    if (spotData) {
      closes4h.push(...spotData.closes);
      kHighs4h = spotData.highs;
      kLows4h = spotData.lows;
      kVols4h = spotData.vols;
      if (kHighs4h.length > 0) { ath14d = Math.max(price, ...kHighs4h); ath14dFromKline = true; }
      if (kHighs4h.length >= 3 && kLows4h.length === kHighs4h.length && kVols4h.length === kHighs4h.length) {
        volumeProfile = calcVolumeProfile(kHighs4h, kLows4h, kVols4h, price);
      }
    }
  }

  // Kline quality gate: reject tokens with no meaningful price history
  // (tokenized equities/commodities often return empty or single-candle klines)
  if (closes4h.length < 3) return null;
  if (ath14d <= price * 1.001 && kHighs4h.length < 5) return null;

  // Phase2 Task2: ATRボラティリティレジーム
  if (kHighs4h.length >= 15) {
    atrData = calcATRData(kHighs4h, kLows4h, closes4h, price);
  }

  // 施策10: Trade Setup (klineデータがあれば計算、ATRデータをSL調整に使用)
  if (kHighs4h.length >= 3) {
    tradeSetup = calcTradeSetup(price, kHighs4h, kLows4h, kVols4h, volumeProfile, atrData);
  }

  // 7-day avg daily volume + 7d price change + 施策2: closes1d
  let volumeAvg7d = vol24h;
  let vol7dFromKline = false;
  let priceChange7d = 0;
  let initialPrice: number | null = null;
  let dailyVols: number[] = [];
  const closes1d: number[] = [];
  if (kline1dRes.status === "fulfilled" && kline1dRes.value?.data) {
    const kd = kline1dRes.value.data;
    const useAmount = Array.isArray(kd.amount) && kd.amount.length > 0;
    const raw: string[] = useAmount ? kd.amount : (kd.vol || []);
    const nums: number[] = raw.map(Number).filter((n: number) => n > 0);
    if (nums.length > 0) {
      const vals = useAmount ? nums : nums.map(v => v * price);
      dailyVols = vals;
      volumeAvg7d = vals.reduce((a, b) => a + b, 0) / vals.length;
      vol7dFromKline = true;
    }
    for (const c of (kd.close || []) as string[]) {
      const n = parseFloat(c);
      if (n > 0) closes1d.push(n);
    }
    if (closes1d.length >= 2) {
      const oldest = closes1d[0];
      if (oldest > 0) priceChange7d = (price - oldest) / oldest * 100;
    }
    // ATH: 1d klineのhighから90日高値を取得し、4h kline由来のath14dとマージ
    const highs1d: number[] = (kd.high || []).map(Number).filter((n: number) => n > 0);
    if (highs1d.length > 0) {
      ath14d = Math.max(ath14d, ...highs1d);
      ath14dFromKline = true;
    }
    // 修正8: 最古D1 open = 上場初日の始値
    if (isNew30 && Array.isArray(kd.open) && kd.open.length > 0) {
      const firstOpen = parseFloat(String(kd.open[0]));
      if (firstOpen > 0) initialPrice = firstOpen;
    }
  }

  // Spot API 1d fallback: futures 1d kline failed → try MEXC Spot API
  if (closes1d.length === 0) {
    const spotData1d = await mexcSpotKline(symbol, "Day1", 90);
    if (spotData1d) {
      closes1d.push(...spotData1d.closes);
      if (spotData1d.highs.length > 0) { ath14d = Math.max(ath14d, ...spotData1d.highs); ath14dFromKline = true; }
      if (spotData1d.vols.length >= 7 && spotData1d.closes.length >= 7) {
        const last7Vols = spotData1d.vols.slice(-7);
        const last7Closes = spotData1d.closes.slice(-7);
        dailyVols = spotData1d.vols.map((v, i) => v * (spotData1d.closes[i] ?? price));
        volumeAvg7d = last7Vols.reduce((a, v, i) => a + v * last7Closes[i], 0) / 7;
        vol7dFromKline = true;
      }
      if (spotData1d.closes.length >= 7) {
        const first = spotData1d.closes[spotData1d.closes.length - 7];
        if (first > 0) priceChange7d = ((price - first) / first) * 100;
      }
    }
  }

  // Last resort: synthesize daily closes from 4h klines (when both futures and Spot 1d fail)
  if (closes1d.length === 0 && closes4h.length >= 24) {
    for (let i = 5; i < closes4h.length; i += 6) {
      closes1d.push(closes4h[i]);
    }
    if (closes1d.length >= 2) {
      const oldest = closes1d[0];
      if (oldest > 0) priceChange7d = (price - oldest) / oldest * 100;
    }
  }

  // Spot API 1h fallback: futures 1h kline insufficient → try MEXC Spot API
  if (closes1h.length < 10) {
    const spotData1h = await mexcSpotKline(symbol, "Hour1", 48);
    if (spotData1h && spotData1h.closes.length > closes1h.length) {
      closes1h.length = 0;
      closes1h.push(...spotData1h.closes);
    }
  }

  // Funding rate — ticker field is primary (already in memory, no extra API call)
  // Fall back to dedicated FR endpoint if ticker doesn't have it
  let fundingRate: number | null = null;

  // Primary: ticker.fundingRate (MEXC ticker includes this field)
  if (ticker.fundingRate != null && ticker.fundingRate !== "") {
    const fr = parseFloat(String(ticker.fundingRate));
    if (!isNaN(fr)) fundingRate = fr;
  }

  // Fallback: dedicated funding_rate API
  if (fundingRate === null && frRes.status === "fulfilled" && frRes.value?.data) {
    const d = frRes.value.data;
    const fr = d.fundingRate ?? d.rate;
    if (fr != null) {
      const parsed = parseFloat(String(fr));
      if (!isNaN(parsed)) fundingRate = parsed;
    }
  }

  // Improve volumeAvg7d accuracy using kline4h when kline1d is unavailable.
  // vol7dFromKline stays false so the volumeChangeRatio filter is skipped for these coins.
  // Filter for kline1d-missing coins = ATH drop + vol24h only (no volRatio condition).
  if (!vol7dFromKline && kVols4h.length >= 6) {
    const BARS_PER_DAY = 6;
    const last7dBars = kVols4h.slice(-(7 * BARS_PER_DAY));
    const totalContractVol = last7dBars.reduce((a, b) => a + b, 0);
    if (totalContractVol > 0) {
      const days = last7dBars.length / BARS_PER_DAY;
      volumeAvg7d = (totalContractVol * price) / days;
      // intentionally not setting vol7dFromKline=true here:
      // kline4h-derived data improves score accuracy but does not trigger the volRatio filter
    }
  }

  const athDropPct = ath14d > 0 ? ((price - ath14d) / ath14d) * 100 : 0;
  const volumeChangeRatio = volumeAvg7d > 0 ? vol24h / volumeAvg7d : 1;
  const openInterest = parseFloat(ticker.holdVol || "0") * price;

  // フィルタはStage1（listedDaysAgo）とpost-stage2（params-based）で行う

  // 施策1: BTC相関係数
  let btcCorrelation = 0;
  if (closes4h.length >= 10 && btcReturns.length >= 5) {
    const myReturns = priceToReturns(closes4h);
    const len = Math.min(myReturns.length, btcReturns.length);
    btcCorrelation = pearsonCorrelation(myReturns.slice(-len), btcReturns.slice(-len));
  }

  // 施策3: 出来高異常検知
  const volumeSpike = calcVolumeSpike(volumeChangeRatio, priceChange24h);

  const { score, breakdown, oiRatio, trendDirection, trendMultiTF, chartPattern, allPatterns } = calcShortScore(
    athDropPct, volumeChangeRatio, fundingRate, listedDaysAgo, openInterest, vol24h, closes4h, priceChange7d, btcCorrelation, closes1h, closes1d,
    kHighs4h, kLows4h, priceChange24h, null,  // 施策4: パターン検知 / oiChange4hPct=null (サーバー固定)
    volumeProfile?.pocVsPricePct ?? null,       // pocDistanceScore用
    dailyVols,                                   // volTrendScore用
  );

  // 施策5: 清算カスケードゾーン推定
  const liquidationZone = calcLiquidationZone(price, openInterest, volumeProfile, oiRatio);

  return {
    symbol,
    currentPrice: price,
    ath14d,
    athDropPct,
    ath14dFromKline,
    volume24h: vol24h,
    volumeAvg7d,
    volumeChangeRatio,
    vol7dFromKline,
    fundingRate,
    openInterest,
    oiRatio,
    trendDirection,
    listedDaysAgo,
    priceChange24h,
    priceChange7d,
    initialPrice,
    volumeProfile,
    tradeSetup,
    btcCorrelation,
    trendMultiTF,
    volumeSpike,
    chartPattern,
    allPatterns,
    atrData,
    liquidationZone,
    shortScore: score,
    scoreBreakdown: breakdown,
    priceDeviation,
    liquidityInfo: liquidityRes.status === "fulfilled" && liquidityRes.value != null ? liquidityRes.value : undefined,
    futuresListedAt,
    hoursFromFutures,
    closes1h: closes1h.length > 0 ? closes1h : undefined,
  };
}

export async function GET(req: NextRequest) {
  const mode    = req.nextUrl.searchParams.get("mode") ?? "";
  const isNew30 = mode === "new30";

  // Filter params sent by client sliders (normal mode only)
  const qMinDrop     = Number(req.nextUrl.searchParams.get("minDrop")     ?? "10");
  const qMaxVolRatio = Number(req.nextUrl.searchParams.get("maxVolRatio") ?? "500");
  const qMinVol24k   = Number(req.nextUrl.searchParams.get("minVol24k")   ?? "50");
  const qMaxDays     = Number(req.nextUrl.searchParams.get("maxDays")     ?? "9999");
  const qMinOiK      = Number(req.nextUrl.searchParams.get("minOiK")      ?? "0");

  // Symbol health tiers: activeSymbols (Tier1 ≥70%) and deadSymbols (Tier3 <10%) from client
  const qActiveSymbols = req.nextUrl.searchParams.get("activeSymbols") ?? "";
  const qDeadSymbols   = req.nextUrl.searchParams.get("deadSymbols")   ?? "";
  const activeSet = new Set<string>(qActiveSymbols ? qActiveSymbols.split(",").filter(Boolean).map(s => `${s}_USDT`) : []);
  const deadSet   = new Set<string>(qDeadSymbols   ? qDeadSymbols.split(",").filter(Boolean).map(s => `${s}_USDT`)   : []);

  // Stage 1 volume threshold: driven by client param
  const PRE_FILTER_VOL_USD = qMinVol24k * 1_000;

  const now = Date.now();
  const nowSec      = Math.floor(now / 1000);
  const day14AgoSec = nowSec - 14 * 86_400;
  const day7AgoSec  = nowSec - 7 * 86_400;
  const day90AgoSec = nowSec - 90 * 86_400;

  // BTC 4h kline + ticker + detail を並列取得（ticker/detailはキャッシュ優先）
  let cachedTicker = getCached("ticker");
  let cachedDetail = getCached("detail");
  let cachedBtcReturns = getCached("btcReturns") as number[] | null;

  const fetchPromises: Promise<void>[] = [];

  if (!cachedTicker || !cachedDetail) {
    fetchPromises.push(
      Promise.all([
        mexcGet("/api/v1/contract/ticker"),
        mexcGet("/api/v1/contract/detail"),
      ]).then(([tr, dr]) => {
        if (tr?.data) { setCached("ticker", tr.data); cachedTicker = tr.data; }
        if (dr?.data) { setCached("detail", dr.data); cachedDetail = dr.data; }
      })
    );
  }

  if (!cachedBtcReturns) {
    fetchPromises.push(
      mexcGet(`/api/v1/contract/kline/BTC_USDT?interval=Hour4&start=${day14AgoSec}&end=${nowSec}`, 8000)
        .then(res => {
          const closes: number[] = res?.data?.close
            ? (res.data.close as string[]).map(Number).filter((n: number) => n > 0)
            : [];
          const returns = priceToReturns(closes);
          setCached("btcReturns", returns);
          cachedBtcReturns = returns;
        })
    );
  }

  await Promise.all(fetchPromises);

  if (!cachedTicker || !cachedDetail) {
    return NextResponse.json(
      { success: false, error: "MEXC API接続失敗。しばらく待ってから再試行してください。" },
      { status: 502 },
    );
  }

  const btcReturns: number[] = cachedBtcReturns ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickerMap: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of cachedTicker as any[]) {
    tickerMap[t.symbol] = t;
  }

  const createTimeMap: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of cachedDetail as any[]) {
    if (c.symbol) createTimeMap[c.symbol] = Number(c.createTime || 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalTickerPairs = (cachedTicker as any[]).length;
  console.log(`[short-scan] ── Stage0 ── ticker pairs total: ${totalTickerPairs}, BTC returns: ${btcReturns.length} bars`);

  // ── Stage 1: ticker-based pre-filter ────────────────────────────────────────
  const candidates: CandidateMeta[] = [];
  let nonCryptoFiltered = 0;

  for (const t of cachedTicker as Array<{
    symbol: string; lastPrice: string; amount24?: string; volume24?: string;
  }>) {
    const sym = t.symbol;
    if (!sym?.endsWith("_USDT")) continue;
    if (MAJOR_PAIRS.has(sym)) continue;
    if (isNonCrypto(sym)) { nonCryptoFiltered++; continue; }

    const price = parseFloat(t.lastPrice || "0");
    if (!price) continue;

    const vol24hEst = (() => {
      const a = parseFloat(t.amount24 || "0");
      if (a > 0) return a;
      return parseFloat(t.volume24 || "0") * price;
    })();

    if (vol24hEst < PRE_FILTER_VOL_USD) continue;

    const ct = createTimeMap[sym] || 0;
    const listedDaysAgo = ct > 0 ? Math.floor((now - ct) / 86_400_000) : 9999;

    // Pre-filter by listing date when maxDays is explicitly set
    if (qMaxDays < 9999 && listedDaysAgo > qMaxDays) continue;

    const riseFallRate = parseFloat((t as { riseFallRate?: string }).riseFallRate || "0");
    candidates.push({ symbol: sym, listedDaysAgo, vol24hEst, riseFallRate, createTime: ct });
  }

  const stage1Passed = candidates.length;

  // Sort by 24h price drop magnitude: most negative first → prioritise downtrend coins
  // Ensures the MAX_KLINE_TARGETS budget is spent on coins most likely to have ATH drop ≥ 30%
  if (!isNew30) {
    candidates.sort((a, b) => a.riseFallRate - b.riseFallRate);
  }

  // 出来高降順でソート → 安定した分析対象選定、スリッページ大銘柄を除外
  candidates.sort((a, b) => b.vol24hEst - a.vol24hEst);
  const klineTargets = candidates.slice(0, MAX_KLINE_TARGETS);
  console.log(`[short-scan] ── Stage1 ── passed: ${stage1Passed}, nonCrypto excluded: ${nonCryptoFiltered} (vol≥$${PRE_FILTER_VOL_USD.toLocaleString()}${isNew30 ? ", listed≤30d" : ""}), kline targets: ${klineTargets.length}/${MAX_KLINE_TARGETS}`);

  const DEADLINE = Date.now() + 110_000;

  // ── Tier-based Phase A ordering ──────────────────────────────────────────────
  // Tier 1: active symbols (≥70% success rate from client) — process first
  // Tier 2: monitoring / unknown — process second
  // Tier 3: dead symbols (<10% success rate from client) — skip entirely
  let tier1Count = 0, tier2Count = 0, tier3Count = 0;
  const orderedTargets: CandidateMeta[] = [];
  if (activeSet.size > 0 || deadSet.size > 0) {
    const tier1: CandidateMeta[] = [];
    const tier2: CandidateMeta[] = [];
    for (const m of klineTargets) {
      if (activeSet.has(m.symbol)) { tier1.push(m); tier1Count++; }
      else if (deadSet.has(m.symbol)) { tier3Count++; } // skip
      else { tier2.push(m); tier2Count++; }
    }
    orderedTargets.push(...tier1, ...tier2);
    console.log(`[short-scan] ── Tier ── T1(active)=${tier1Count}, T2(monitoring)=${tier2Count}, T3(dead/skipped)=${tier3Count}`);
  } else {
    orderedTargets.push(...klineTargets);
    tier2Count = klineTargets.length;
  }

  // ── Phase A: 4h kline一括取得（60並列・50msディレイ）─────────────────────────
  const PHASE_A_BATCH = 60;
  const PHASE_A_DELAY = 50;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validWithKline4h: Array<{ meta: CandidateMeta; kline4h: any }> = [];
  const failedKlineMetas: CandidateMeta[] = [];
  let phaseACacheHits = 0, phaseAFetched = 0, phaseAFailed = 0;

  for (let i = 0; i < orderedTargets.length; i += PHASE_A_BATCH) {
    if (Date.now() >= DEADLINE) {
      console.warn(`[short-scan] Phase A deadline reached at ${i}/${orderedTargets.length}`);
      break;
    }
    const batch = orderedTargets.slice(i, i + PHASE_A_BATCH);
    const phaseAResults = await Promise.allSettled(
      batch.map(async meta => {
        const key = `kline4h_${meta.symbol}`;
        const cached = _kline4hCache.get(key);
        const isCached = !!cached && Date.now() - cached.ts < KLINE4H_TTL;
        const kline4h = await fetchKline4h(meta.symbol, day14AgoSec, nowSec);
        return { meta, kline4h, isCached };
      })
    );
    for (const r of phaseAResults) {
      if (r.status === "fulfilled") {
        const { meta, kline4h, isCached } = r.value;
        const hasData = Array.isArray(kline4h?.data?.close) && kline4h.data.close.length > 0;
        if (isCached) phaseACacheHits++; else phaseAFetched++;
        if (hasData) validWithKline4h.push({ meta, kline4h });
        else { phaseAFailed++; failedKlineMetas.push(meta); }
      } else {
        phaseAFailed++;
      }
    }
    if (i + PHASE_A_BATCH < klineTargets.length) await sleep(PHASE_A_DELAY);
  }
  console.log(`[short-scan] ── Phase A ── futures 4h: fetched=${phaseAFetched}, cached=${phaseACacheHits}, valid=${validWithKline4h.length}, failed=${phaseAFailed} → spot fallback`);

  // ── Phase B (Stage 2): 補助データ取得 + フル分析 ──────────────────────────────
  // futures valid → prefetched kline4h を渡す
  // failed metas → null を渡す（analyzeCandidate 内の Spot fallback が対応）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaseBTargets: Array<{ meta: CandidateMeta; kline4h: any }> = [
    ...validWithKline4h,
    ...failedKlineMetas.map(meta => ({ meta, kline4h: null })),
  ];
  const futuresSucceededSyms = new Set(validWithKline4h.map(v => v.meta.symbol));
  const results: ShortCandidate[] = [];
  let stage2Fetched = 0;
  let stage2Failed  = 0;
  console.log(`[short-scan] ── Phase B ── futures valid: ${validWithKline4h.length}, spot fallback: ${failedKlineMetas.length}, total: ${phaseBTargets.length}`);

  for (let i = 0; i < phaseBTargets.length; i += BATCH) {
    if (Date.now() >= DEADLINE) {
      console.warn(`[short-scan] deadline reached at batch ${i}/${phaseBTargets.length}`);
      break;
    }

    const batch = phaseBTargets.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(({ meta, kline4h }) =>
        analyzeCandidate(meta, tickerMap[meta.symbol], day14AgoSec, day7AgoSec, day90AgoSec, nowSec, isNew30, btcReturns, kline4h)
      )
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        stage2Fetched++;
        if (r.value) results.push(r.value);
      } else {
        stage2Failed++;
        console.error("[short-scan]", r.reason);
      }
    }

    if (i + BATCH < phaseBTargets.length) await sleep(BATCH_DELAY);
  }

  // ── Diagnostic log: kline success rate + filter breakdown ───────────────────
  if (!isNew30) {
    const withAth  = results.filter(r => r.ath14dFromKline).length;
    const withVol  = results.filter(r => r.vol7dFromKline).length;
    const passAth  = results.filter(r => !r.ath14dFromKline || Math.abs(r.athDropPct) >= qMinDrop).length;
    const passVol  = results.filter(r => !r.vol7dFromKline  || r.volumeChangeRatio * 100 <= qMaxVolRatio).length;
    const passVol24 = results.filter(r => r.volume24h >= qMinVol24k * 1_000).length;
    // athDropPct distribution for coins that have actual kline4h ATH data
    const withAthResults = results.filter(r => r.ath14dFromKline);
    const ad10 = withAthResults.filter(r => Math.abs(r.athDropPct) < 10).length;
    const ad30 = withAthResults.filter(r => Math.abs(r.athDropPct) >= 10 && Math.abs(r.athDropPct) < 30).length;
    const ad50 = withAthResults.filter(r => Math.abs(r.athDropPct) >= 30 && Math.abs(r.athDropPct) < 50).length;
    const ad70 = withAthResults.filter(r => Math.abs(r.athDropPct) >= 50).length;
    console.log(`[short-scan] kline4h ATH: withData=${withAth}/${results.length}, athDrop: <10%=${ad10}, 10-30%=${ad30}, 30-50%=${ad50}, ≥50%=${ad70}`);
    const spotFallbackResults = results.filter(r => !futuresSucceededSyms.has(r.symbol)).length;
    console.log(`[short-scan] kline1d vol: withData=${withVol}/${results.length}, spot fallback results: ${spotFallbackResults}`);
    console.log(`[short-scan] filter: passAth=${passAth}, passVolRatio=${passVol}, passVol24h=${passVol24}, params=${JSON.stringify({ qMinDrop, qMaxVolRatio, qMinVol24k, qMaxDays, qMinOiK })}`);
  }

  // Apply client slider params as filter for normal mode (new30 already filtered in analyzeCandidate)
  // ATH escape hatch: ath14dFromKline=false → kline4h failed → athDropPct=0 → skip ATH filter to avoid false negatives
  // volRatio escape hatch: only when volumeChangeRatio===1 (exact fallback for missing kline1d data).
  //   vol7dFromKline=false but ratio > 1 means ratio was computed from other data sources and IS reliable.
  const filteredResults = results.filter(c =>
    (!c.ath14dFromKline || Math.abs(c.athDropPct) >= qMinDrop) &&
    (c.volumeChangeRatio * 100 <= qMaxVolRatio || (!c.vol7dFromKline && c.volumeChangeRatio === 1)) &&
    c.volume24h >= qMinVol24k * 1_000 &&
    c.listedDaysAgo <= qMaxDays &&
    c.openInterest >= qMinOiK * 1_000
  );

  const sorted = filteredResults.sort((a, b) => b.shortScore - a.shortScore);

  // ── Stage 3: GeckoTerminal DEX liquidity for top 20 of filtered results ──────
  const top20ForDex = sorted.slice(0, 20);
  await Promise.allSettled(
    top20ForDex.map(async c => {
      try {
        const dex = await fetchGtDexData(c.symbol);
        if (dex) {
          c.dex = dex;
          if (dex.liquidityMcRatio !== null && dex.liquidityMcRatio < 5) {
            c.shortScore += 1;
          }
        }
      } catch { /* ignore – don't let DEX failures break the scan */ }
    })
  );
  // Re-sort after potential score updates
  sorted.sort((a, b) => b.shortScore - a.shortScore);

  // ── Stage 3.5: News context for top 20 (CryptoPanic, optional, 30-min cache) ─
  if (Date.now() < DEADLINE) {
    await Promise.allSettled(
      sorted.slice(0, 20).map(async c => {
        try {
          const news = await fetchCoinNews(c.symbol);
          // Only attach if there's actual signal to avoid noise
          if (news.positiveCount > 0 || news.negativeCount > 0 ||
              news.hasMajorListing || news.hasPartnership || news.hasSecurity) {
            c.newsContext = news;
          }
        } catch { /* ignore */ }
      })
    );
  }

  const top100 = sorted.slice(0, 100);

  // ATH下落率の分布ログ
  const dropBuckets = { lt10: 0, lt30: 0, lt50: 0, lt70: 0, ge70: 0 };
  for (const r of filteredResults) {
    const d = Math.abs(r.athDropPct);
    if (d < 10) dropBuckets.lt10++;
    else if (d < 30) dropBuckets.lt30++;
    else if (d < 50) dropBuckets.lt50++;
    else if (d < 70) dropBuckets.lt70++;
    else dropBuckets.ge70++;
  }
  console.log(`[short-scan] ── Stage2 ── analyzed: ${stage2Fetched}, failed: ${stage2Failed}, total: ${results.length}, filtered: ${filteredResults.length}, returned: ${top100.length}`);
  console.log(`[short-scan] ATH drop dist: <10%=${dropBuckets.lt10}, 10-30%=${dropBuckets.lt30}, 30-50%=${dropBuckets.lt50}, 50-70%=${dropBuckets.lt70}, ≥70%=${dropBuckets.ge70}`);
  console.log(`[short-scan] volRatio dist: <0.3=${filteredResults.filter(r=>r.volumeChangeRatio<0.3).length}, 0.3-0.7=${filteredResults.filter(r=>r.volumeChangeRatio>=0.3&&r.volumeChangeRatio<0.7).length}, 0.7-2=${filteredResults.filter(r=>r.volumeChangeRatio>=0.7&&r.volumeChangeRatio<2).length}, ≥2=${filteredResults.filter(r=>r.volumeChangeRatio>=2).length}`);

  return NextResponse.json({
    success: true,
    scanTime: new Date().toISOString(),
    candidates: top100,
    mode: isNew30 ? "new30" : "normal",
    meta: {
      totalTickerPairs,
      stage1Passed,
      phaseAValid: validWithKline4h.length,
      phaseASucceededSymbols: validWithKline4h.map(v => v.meta.symbol),
      stage2Fetched,
      stage2Failed,
      filtered: filteredResults.length,
      tier1Count,
      tier3Skipped: tier3Count,
    },
  });
}
