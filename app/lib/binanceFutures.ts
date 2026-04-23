import type { BinanceFuturesData, FrSignal, OiTrend, LiquidationRisk } from "@/app/types/binanceFutures";

const FAPI = "https://fapi.binance.com";

export function normalizeBinanceSymbol(raw: string): string {
  const s = raw.toUpperCase().replace(/[_\-\/]/g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

async function binanceFetch<T>(path: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${FAPI}${path}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function classifyFr(fr: number): FrSignal {
  if (fr <= -0.001) return "danger_squeeze";
  if (fr > 0.0005) return "extreme_long";
  if (fr >= 0.0001 && fr <= 0.0005) return "short_favorable";
  return "neutral";
}

function classifyOiTrend(change24h: number | null): OiTrend {
  if (change24h === null) return "stable";
  if (change24h > 5) return "increasing";
  if (change24h < -5) return "decreasing";
  return "stable";
}

function classifyLiqRisk(frSig: FrSignal, oiTrend: OiTrend): LiquidationRisk {
  if (frSig === "danger_squeeze" && oiTrend === "decreasing") return "high";
  if (frSig === "extreme_long" && oiTrend === "increasing") return "high";
  if (frSig === "short_favorable") return "medium";
  return "low";
}

interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

interface OpenInterest {
  openInterest: string;
  symbol: string;
}

interface OiHistEntry {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

export async function getBinanceFutures(symbol: string): Promise<BinanceFuturesData | null> {
  const sym = normalizeBinanceSymbol(symbol);

  const [premium, oi, oiHist] = await Promise.all([
    binanceFetch<PremiumIndex>(`/fapi/v1/premiumIndex?symbol=${sym}`),
    binanceFetch<OpenInterest>(`/fapi/v1/openInterest?symbol=${sym}`),
    // limit=168 gives 7 days of hourly data (ascending order, oldest first)
    binanceFetch<OiHistEntry[]>(`/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=168`),
  ]);

  if (!premium || !oi) return null;

  const fr = parseFloat(premium.lastFundingRate);
  const markPrice = parseFloat(premium.markPrice);
  const indexPrice = parseFloat(premium.indexPrice);
  const oiCoin = parseFloat(oi.openInterest);
  const oiUsdt = oiCoin * markPrice;

  let oiChange24h: number | null = null;
  let oiChange7d: number | null = null;

  if (oiHist && oiHist.length >= 2) {
    // Ascending order: oiHist[0] = oldest, oiHist[last] = newest
    const newest = oiHist[oiHist.length - 1];
    const current = parseFloat(newest?.sumOpenInterestValue ?? "0");

    if (oiHist.length >= 25) {
      const idx24h = oiHist.length - 25;
      const ago24 = parseFloat(oiHist[idx24h]?.sumOpenInterestValue ?? "0");
      if (ago24 > 0) oiChange24h = ((current - ago24) / ago24) * 100;
    }

    if (oiHist.length >= 7) {
      const ago7d = parseFloat(oiHist[0]?.sumOpenInterestValue ?? "0");
      if (ago7d > 0) oiChange7d = ((current - ago7d) / ago7d) * 100;
    }
  }

  const frSignal = classifyFr(fr);
  const oiTrend = classifyOiTrend(oiChange24h);
  const liquidationRisk = classifyLiqRisk(frSignal, oiTrend);

  return {
    symbol: sym,
    fundingRate: fr,
    markPrice,
    indexPrice,
    openInterestUsdt: oiUsdt,
    openInterestCoin: oiCoin,
    oiChange24h,
    oiChange7d,
    frSignal,
    oiTrend,
    liquidationRisk,
    mexcFrEstMin: fr - 0.0002,
    mexcFrEstMax: fr + 0.0002,
  };
}
