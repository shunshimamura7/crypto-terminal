import { NextRequest, NextResponse } from "next/server";
import {
  calcBitgetShortScore,
  calcBitgetTradeSetup,
  calcFrWeeklyCost,
  calcLongShortScore,
  calcRecommendedLev,
  calcTrendDir,
} from "@/app/lib/bitgetScorer";
import type { BitgetShortCandidate, TrendDir } from "@/app/lib/bitgetScorer";

export const runtime     = "nodejs";
export const maxDuration = 120;

const BITGET   = "https://api.bitget.com";
const PRODUCT  = "USDT-FUTURES";

// ─── In-memory cache (5-min TTL) ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCached(k: string): any | null {
  const e = _cache.get(k);
  return e && Date.now() - e.ts < CACHE_TTL ? e.data : null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCached(k: string, data: any) { _cache.set(k, { data, ts: Date.now() }); }

const MAJORS = new Set([
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT",
  "DOTUSDT","MATICUSDT","LINKUSDT","UNIUSDT","ATOMUSDT","LTCUSDT","BCHUSDT","NEARUSDT",
  "FILUSDT","APTUSDT","ARBUSDT","OPUSDT","MKRUSDT","AAVEUSDT","CRVUSDT","SNXUSDT",
  "COMPUSDT","TRXUSDT","ETCUSDT","XLMUSDT","ALGOUSDT","ICPUSDT","VETUSDT","HBARUSDT",
  "FTMUSDT","SANDUSDT","MANAUSDT","AXSUSDT","GALAUSDT","THETAUSDT","EOSUSDT","XTZUSDT",
  "FLOWUSDT","CHZUSDT","ENJUSDT","ZILUSDT","ONEUSDT","SUIUSDT","SEIUSDT","TIAUSDT",
  "JUPUSDT","WLDUSDT","PEPEUSDT","WIFUSDT","BONKUSDT","FLOKIUSDT","SHIBUSDT",
]);

const BATCH       = 10;
const BATCH_DELAY = 300;
const MAX_TARGETS = 200;
const LS_TOP_N    = 30; // Stage 3: fetch L/S ratio for top 30
const LS_BATCH    = 5;
const LS_DELAY    = 200;

async function fetchWithTimeout(url: string, ms = 10_000): Promise<Response | null> {
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
async function bitgetGet(path: string, ms = 10_000): Promise<any> {
  const res = await fetchWithTimeout(`${BITGET}${path}`, ms);
  if (!res?.ok) return null;
  try {
    const j = await res.json();
    return j?.code === "00000" ? j : null;
  } catch { return null; }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// kline row: [ts, open, high, low, close, baseVol, quoteVol]
function parseKlines(rows: string[][]): {
  closes: number[]; highs: number[]; lows: number[]; quoteVols: number[];
} {
  const closes: number[] = [], highs: number[] = [], lows: number[] = [], quoteVols: number[] = [];
  for (const row of rows) {
    const c = parseFloat(row[4]), h = parseFloat(row[2]), l = parseFloat(row[3]), q = parseFloat(row[6] ?? "0");
    if (c > 0) { closes.push(c); highs.push(h); lows.push(l); quoteVols.push(q); }
  }
  return { closes, highs, lows, quoteVols };
}

// Stage 3: fetch long/short position ratio (0-1 range)
// longShortPositionRatio is a ratio (e.g. 1.5 = long60% / short40%)
async function fetchLongShortRatio(symbol: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `${BITGET}/api/v2/mix/market/position-long-short?symbol=${symbol}&productType=usdt-futures`,
      5000,
    );
    if (!res?.ok) return null;
    const json = await res.json();
    if (json.code !== "00000" || !Array.isArray(json.data) || json.data.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latest = json.data[0] as any;
    const ratio = parseFloat(latest.longShortPositionRatio ?? latest.longShortRatio ?? "0");
    if (!ratio || isNaN(ratio) || ratio <= 0) return null;
    return ratio / (1 + ratio); // convert ratio → 0-1 (long%)
  } catch {
    return null;
  }
}

interface CandidateMeta {
  symbol:    string;
  preScore:  number;
  price:     number;
  vol24h:    number;
  fr:        number | null;
  oi:        number;   // USDT
  change24h: number;   // %
}

async function analyzeCandidate(meta: CandidateMeta): Promise<BitgetShortCandidate | null> {
  const { symbol, price, vol24h, fr, oi, change24h } = meta;

  const [r4h, r1h, r1d] = await Promise.allSettled([
    bitgetGet(`/api/v2/mix/market/candles?symbol=${symbol}&productType=${PRODUCT}&granularity=4H&limit=84`, 8000),
    bitgetGet(`/api/v2/mix/market/candles?symbol=${symbol}&productType=${PRODUCT}&granularity=1H&limit=48`, 7000),
    bitgetGet(`/api/v2/mix/market/candles?symbol=${symbol}&productType=${PRODUCT}&granularity=1D&limit=14`, 7000),
  ]);

  const kline4h = r4h.status === "fulfilled" && r4h.value?.data ? parseKlines(r4h.value.data as string[][]) : { closes: [], highs: [], lows: [], quoteVols: [] };
  const kline1h = r1h.status === "fulfilled" && r1h.value?.data ? parseKlines(r1h.value.data as string[][]) : { closes: [], highs: [], lows: [], quoteVols: [] };
  const kline1d = r1d.status === "fulfilled" && r1d.value?.data ? parseKlines(r1d.value.data as string[][]) : { closes: [], highs: [], lows: [], quoteVols: [] };

  const ath14d     = kline4h.highs.length > 0 ? Math.max(price, ...kline4h.highs) : price;
  const athDropPct = ath14d > 0 ? (price - ath14d) / ath14d * 100 : 0;

  let volumeAvg7d = vol24h;
  if (kline1d.quoteVols.length > 0) {
    const vals = kline1d.quoteVols.filter(v => v > 0);
    if (vals.length > 0) volumeAvg7d = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  let priceChange7d = 0;
  if (kline1d.closes.length >= 2) {
    const oldest = kline1d.closes[0];
    if (oldest > 0) priceChange7d = (price - oldest) / oldest * 100;
  }

  const oiRatio  = vol24h > 0 ? oi / vol24h : 0;
  const trendH1: TrendDir = calcTrendDir(kline1h.closes);
  const trendH4: TrendDir = calcTrendDir(kline4h.closes);
  const trendD1: TrendDir = calcTrendDir(kline1d.closes);

  const { score, breakdown, trendAlignment } = calcBitgetShortScore(
    athDropPct, fr, oiRatio, trendH1, trendH4, trendD1, priceChange7d,
  );

  const tradeSetup     = calcBitgetTradeSetup(price, kline4h.highs, kline4h.lows);
  const frWeeklyCost   = calcFrWeeklyCost(fr);
  const recommendedLev = calcRecommendedLev(athDropPct, trendAlignment, fr);

  return {
    symbol, currentPrice: price,
    ath14d, athDropPct,
    volume24h: vol24h, volumeAvg7d,
    fundingRate: fr, openInterest: oi, oiRatio,
    longRatio: null,  // populated in Stage 3
    priceChange24h: change24h, priceChange7d,
    trendH1, trendH4, trendD1, trendAlignment,
    shortScore: score, breakdown,
    tradeSetup, frWeeklyCost, recommendedLev,
  };
}

export async function GET(_req: NextRequest) {
  // ── Stage 0: all tickers (cached) ─────────────────────────────────────────
  let tickers = getCached("bitget:tickers");
  if (!tickers) {
    const res = await bitgetGet(`/api/v2/mix/market/tickers?productType=${PRODUCT}`, 12_000);
    if (!res?.data) {
      return NextResponse.json(
        { success: false, error: "Bitget API接続失敗。しばらく待ってから再試行してください。" },
        { status: 502 },
      );
    }
    tickers = res.data;
    setCached("bitget:tickers", tickers);
  }

  const totalPairs = (tickers as unknown[]).length;
  console.log(`[bitget-scan] Stage0: ${totalPairs} tickers`);

  // ── Stage 1: volume + major filter ────────────────────────────────────────
  const PRE_FILTER_VOL = 100_000;
  const metas: CandidateMeta[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of tickers as any[]) {
    const sym = String(t.symbol ?? "");
    if (!sym.endsWith("USDT")) continue;
    if (MAJORS.has(sym)) continue;

    const price = parseFloat(t.lastPr || t.markPrice || "0");
    if (!price) continue;

    const vol24h = parseFloat(t.usdtVolume || t.quoteVolume || "0");
    if (vol24h < PRE_FILTER_VOL) continue;

    const fr      = t.fundingRate != null ? parseFloat(String(t.fundingRate)) : null;
    const oiBase  = parseFloat(t.openInterest || "0");
    const oi      = oiBase * price;
    const changeRaw = parseFloat(t.change24h || t.chgUtc || "0");
    const change24h = Math.abs(changeRaw) > 1 ? changeRaw : changeRaw * 100;

    const quickOiRatio = vol24h > 0 ? oi / vol24h : 0;
    const quickScore   = (fr !== null && fr > 0 ? 3 : 0) + (quickOiRatio > 1.5 ? 2 : 0);

    metas.push({ symbol: sym, preScore: quickScore, price, vol24h, fr, oi, change24h });
  }

  const stage1Passed = metas.length;
  metas.sort((a, b) => b.preScore - a.preScore);
  const targets = metas.slice(0, MAX_TARGETS);
  console.log(`[bitget-scan] Stage1: ${stage1Passed} → ${targets.length} targets`);

  // ── Stage 2: kline analysis in batches ───────────────────────────────────
  const results: BitgetShortCandidate[] = [];
  let fetched = 0, failed = 0;
  const DEADLINE = Date.now() + 100_000; // reserve 10s for Stage 3

  for (let i = 0; i < targets.length; i += BATCH) {
    if (Date.now() >= DEADLINE) {
      console.warn(`[bitget-scan] Stage2 deadline at ${i}/${targets.length}`);
      break;
    }
    const batch   = targets.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(meta => analyzeCandidate(meta)));
    for (const r of settled) {
      if (r.status === "fulfilled") { fetched++; if (r.value) results.push(r.value); }
      else failed++;
    }
    if (i + BATCH < targets.length) await sleep(BATCH_DELAY);
  }

  const sorted = results.sort((a, b) => b.shortScore - a.shortScore);
  const top50  = sorted.slice(0, 50);
  console.log(`[bitget-scan] Stage2: fetched=${fetched}, failed=${failed}, passed=${results.length}, returned=${top50.length}`);

  // ── Stage 3: L/S ratio for top 30 (5-parallel, 200ms interval) ───────────
  const top30 = top50.slice(0, LS_TOP_N);
  let lsFetched = 0;

  for (let i = 0; i < top30.length; i += LS_BATCH) {
    const batch   = top30.slice(i, i + LS_BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchLongShortRatio(c.symbol)));
    for (let j = 0; j < batch.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled" && r.value !== null) {
        const lsScore = calcLongShortScore(r.value);
        batch[j].longRatio              = r.value;
        batch[j].breakdown.longShortRatio = lsScore;
        batch[j].shortScore             += lsScore;
        lsFetched++;
      }
    }
    if (i + LS_BATCH < top30.length) await sleep(LS_DELAY);
  }

  // Re-sort after Stage 3 score updates
  top50.sort((a, b) => b.shortScore - a.shortScore);
  console.log(`[bitget-scan] Stage3: L/S fetched=${lsFetched}/${top30.length}`);

  return NextResponse.json({
    success: true,
    scanTime: new Date().toISOString(),
    candidates: top50,
    meta: { totalPairs, stage1Passed, fetched, failed, filtered: results.length, lsFetched },
  });
}
