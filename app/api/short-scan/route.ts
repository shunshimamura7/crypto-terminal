import { NextRequest, NextResponse } from "next/server";
import { calcShortScore, passesFilter, passesFilterNew30, calcVolumeProfile, calcTradeSetup, calcVolumeSpike, calcLiquidationZone } from "@/app/lib/shortScorer";
import type { ShortCandidate, VolumeProfile, TradeSetup } from "@/app/lib/shortScorer";

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

const MEXC = "https://contract.mexc.com";

const MAJOR_PAIRS = new Set([
  "BTC_USDT","ETH_USDT","BNB_USDT","SOL_USDT","XRP_USDT","DOGE_USDT","ADA_USDT","AVAX_USDT",
  "DOT_USDT","MATIC_USDT","LINK_USDT","UNI_USDT","ATOM_USDT","LTC_USDT","BCH_USDT","NEAR_USDT",
  "FIL_USDT","APT_USDT","ARB_USDT","OP_USDT","MKR_USDT","AAVE_USDT","CRV_USDT","SNX_USDT",
  "COMP_USDT","TRX_USDT","ETC_USDT","XLM_USDT","ALGO_USDT","ICP_USDT","VET_USDT","HBAR_USDT",
  "FTM_USDT","SAND_USDT","MANA_USDT","AXS_USDT","GALA_USDT","THETA_USDT","EOS_USDT","XTZ_USDT",
  "FLOW_USDT","CHZ_USDT","ENJ_USDT","ZIL_USDT","ONE_USDT","SUI_USDT","SEI_USDT","TIA_USDT",
  "JUP_USDT","WLD_USDT","PEPE_USDT","WIF_USDT","BONK_USDT","FLOKI_USDT","SHIB_USDT",
]);

// Stage 2 concurrency
const BATCH = 10;
const BATCH_DELAY = 200;

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

interface CandidateMeta {
  symbol: string;
  listedDaysAgo: number;
  vol24hEst: number;
}

async function analyzeCandidate(
  meta: CandidateMeta,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticker: any,
  day14AgoSec: number,
  day7AgoSec: number,
  nowSec: number,
  isNew30: boolean,
  btcReturns: number[],  // 施策1: BTC収益率系列
): Promise<ShortCandidate | null> {
  const { symbol, listedDaysAgo } = meta;

  const price = parseFloat(ticker.lastPrice || ticker.indexPrice || "0");
  if (!price) return null;

  const vol24h = (() => {
    const a = parseFloat(ticker.amount24 || "0");
    if (a > 0) return a;
    return parseFloat(ticker.volume24 || "0") * price;
  })();

  // 24h変動率 (riseFallRate は小数表現: 0.05 = +5%)
  const priceChange24h = parseFloat(ticker.riseFallRate || "0") * 100;

  const day30AgoSec = nowSec - 30 * 86_400;
  const [kline1hRes, kline4hRes, kline1dRes, frRes] = await Promise.allSettled([
    mexcGet(`/api/v1/contract/kline/${symbol}?interval=Hour1&start=${day7AgoSec}&end=${nowSec}`, 8000),  // 施策2
    mexcGet(`/api/v1/contract/kline/${symbol}?interval=Hour4&start=${day14AgoSec}&end=${nowSec}`, 8000),
    mexcGet(`/api/v1/contract/kline/${symbol}?interval=Day1&start=${day30AgoSec}&end=${nowSec}`, 8000),
    mexcGet(`/api/v1/contract/funding_rate/${symbol}`, 5000),
  ]);

  // 施策2: 1h closes
  const closes1h: number[] = [];
  if (kline1hRes.status === "fulfilled" && kline1hRes.value?.data) {
    for (const c of (kline1hRes.value.data.close || []) as string[]) {
      const n = parseFloat(c);
      if (n > 0) closes1h.push(n);
    }
  }

  // ATH: max high from 4h klines
  let ath14d = price;
  const closes4h: number[] = [];
  let volumeProfile: VolumeProfile | null = null;
  let tradeSetup: TradeSetup | null = null;
  let kHighs4h: number[] = [];
  let kLows4h:  number[] = [];
  let kVols4h:  number[] = [];

  if (kline4hRes.status === "fulfilled" && kline4hRes.value?.data) {
    const kd = kline4hRes.value.data;
    kHighs4h = (kd.high || []).map(Number).filter((n: number) => n > 0);
    if (kHighs4h.length > 0) ath14d = Math.max(price, ...kHighs4h);
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

  // 施策10: Trade Setup (klineデータがあれば計算)
  if (kHighs4h.length >= 3) {
    tradeSetup = calcTradeSetup(price, kHighs4h, kLows4h, kVols4h, volumeProfile);
  }

  // 7-day avg daily volume + 7d price change + 施策2: closes1d
  let volumeAvg7d = vol24h;
  let priceChange7d = 0;
  const closes1d: number[] = [];
  if (kline1dRes.status === "fulfilled" && kline1dRes.value?.data) {
    const kd = kline1dRes.value.data;
    const useAmount = Array.isArray(kd.amount) && kd.amount.length > 0;
    const raw: string[] = useAmount ? kd.amount : (kd.vol || []);
    const nums: number[] = raw.map(Number).filter((n: number) => n > 0);
    if (nums.length > 0) {
      const vals = useAmount ? nums : nums.map(v => v * price);
      volumeAvg7d = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    for (const c of (kd.close || []) as string[]) {
      const n = parseFloat(c);
      if (n > 0) closes1d.push(n);
    }
    if (closes1d.length >= 2) {
      const oldest = closes1d[0];
      if (oldest > 0) priceChange7d = (price - oldest) / oldest * 100;
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

  const athDropPct = ath14d > 0 ? ((price - ath14d) / ath14d) * 100 : 0;
  const volumeChangeRatio = volumeAvg7d > 0 ? vol24h / volumeAvg7d : 1;
  const openInterest = parseFloat(ticker.holdVol || "0") * price;

  // Apply mode-appropriate filter
  const passes = isNew30
    ? passesFilterNew30(athDropPct, volumeChangeRatio, vol24h, listedDaysAgo)
    : passesFilter(athDropPct, volumeChangeRatio, vol24h);
  if (!passes) return null;

  // 施策1: BTC相関係数
  let btcCorrelation = 0;
  if (closes4h.length >= 10 && btcReturns.length >= 5) {
    const myReturns = priceToReturns(closes4h);
    const len = Math.min(myReturns.length, btcReturns.length);
    btcCorrelation = pearsonCorrelation(myReturns.slice(-len), btcReturns.slice(-len));
  }

  // 施策3: 出来高異常検知
  const volumeSpike = calcVolumeSpike(volumeChangeRatio, priceChange24h);

  const { score, breakdown, oiRatio, trendDirection, trendMultiTF, chartPattern } = calcShortScore(
    athDropPct, volumeChangeRatio, fundingRate, listedDaysAgo, openInterest, vol24h, closes4h, priceChange7d, btcCorrelation, closes1h, closes1d,
    kHighs4h, kLows4h, priceChange24h,  // 施策4: パターン検知
  );

  // 施策5: 清算カスケードゾーン推定
  const liquidationZone = calcLiquidationZone(price, openInterest, volumeProfile, oiRatio);

  return {
    symbol,
    currentPrice: price,
    ath14d,
    athDropPct,
    volume24h: vol24h,
    volumeAvg7d,
    volumeChangeRatio,
    fundingRate,
    openInterest,
    oiRatio,
    trendDirection,
    listedDaysAgo,
    priceChange24h,
    priceChange7d,
    volumeProfile,
    tradeSetup,
    btcCorrelation,
    trendMultiTF,
    volumeSpike,
    chartPattern,
    liquidationZone,
    shortScore: score,
    scoreBreakdown: breakdown,
  };
}

export async function GET(req: NextRequest) {
  const mode    = req.nextUrl.searchParams.get("mode") ?? "";
  const isNew30 = mode === "new30";

  // Stage 1 volume threshold: looser for new30
  const PRE_FILTER_VOL_USD = isNew30 ? 10_000 : 50_000;

  const now = Date.now();
  const nowSec      = Math.floor(now / 1000);
  const day14AgoSec = nowSec - 14 * 86_400;
  const day7AgoSec  = nowSec - 7 * 86_400;

  // 施策1: BTC 4h kline（1回取得して全銘柄で使い回す）
  const btcKlineRes = await mexcGet(`/api/v1/contract/kline/BTC_USDT?interval=Hour4&start=${day14AgoSec}&end=${nowSec}`, 8000);
  const btcCloses: number[] = btcKlineRes?.data?.close
    ? (btcKlineRes.data.close as string[]).map(Number).filter((n: number) => n > 0)
    : [];
  const btcReturns = priceToReturns(btcCloses);
  console.log(`[short-scan] BTC 4h closes: ${btcCloses.length} bars`);

  // Fetch contract list + all tickers in parallel
  const [detailRes, tickerRes] = await Promise.all([
    mexcGet("/api/v1/contract/detail"),
    mexcGet("/api/v1/contract/ticker"),
  ]);

  if (!detailRes?.data || !tickerRes?.data) {
    return NextResponse.json(
      { success: false, error: "MEXC API接続失敗。しばらく待ってから再試行してください。" },
      { status: 502 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickerMap: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of tickerRes.data as any[]) {
    tickerMap[t.symbol] = t;
  }

  const createTimeMap: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of detailRes.data as any[]) {
    if (c.symbol) createTimeMap[c.symbol] = Number(c.createTime || 0);
  }

  const totalTickerPairs = (tickerRes.data as unknown[]).length;

  // ── Stage 1: ticker-based pre-filter ────────────────────────────────────────
  const candidates: CandidateMeta[] = [];

  for (const t of tickerRes.data as Array<{
    symbol: string; lastPrice: string; amount24?: string; volume24?: string;
  }>) {
    const sym = t.symbol;
    if (!sym?.endsWith("_USDT")) continue;
    if (MAJOR_PAIRS.has(sym)) continue;

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

    // For new30 mode, pre-filter by listing date at Stage 1
    if (isNew30 && listedDaysAgo > 30) continue;

    candidates.push({ symbol: sym, listedDaysAgo, vol24hEst });
  }

  const stage1Passed = candidates.length;

  // ── Stage 2: fetch klines + FR ───────────────────────────────────────────────
  const results: ShortCandidate[] = [];
  let stage2Fetched = 0;
  let stage2Failed  = 0;

  const DEADLINE = Date.now() + 110_000;

  for (let i = 0; i < candidates.length; i += BATCH) {
    if (Date.now() >= DEADLINE) {
      console.warn(`[short-scan] deadline reached at batch ${i}/${candidates.length}`);
      break;
    }

    const batch = candidates.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(meta =>
        analyzeCandidate(meta, tickerMap[meta.symbol], day14AgoSec, day7AgoSec, nowSec, isNew30, btcReturns)
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

    if (i + BATCH < candidates.length) await sleep(BATCH_DELAY);
  }

  const top20 = results
    .sort((a, b) => b.shortScore - a.shortScore)
    .slice(0, 20);

  return NextResponse.json({
    success: true,
    scanTime: new Date().toISOString(),
    candidates: top20,
    mode: isNew30 ? "new30" : "normal",
    meta: {
      totalTickerPairs,
      stage1Passed,
      stage2Fetched,
      stage2Failed,
      filtered: results.length,
    },
  });
}
