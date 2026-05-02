// derivativesData.ts
// Derivatives data fetcher: OKX public API (primary) + Gate.io (fallback)
// Note: Originally named coinglass.ts but does NOT use Coinglass API.

export interface CoinglassData {
  fundingRate: number | null;
  openInterest: number | null;
  openInterestChange24h: number | null;
  longRatio: number | null;
  fundingRateExchange: string | null;  // exchange that supplied the FR
  mexcFundingRate: number | null;      // MEXC-specific FR (null = no MEXC perp)
}

export interface ShortSignal {
  isRecommended: boolean;
  reason: string;
  level: "danger" | "caution" | "neutral" | "favorable" | "strong";
}

const _cache = new Map<string, { data: CoinglassData; ts: number }>();
const TTL = 5 * 60_000;

async function apiFetch(url: string, opts: RequestInit = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(tid);
    return null;
  }
}

// OKX: funding rate for SWAP (perpetual)
// GET /api/v5/public/funding-rate?instId=BTC-USDT-SWAP
// data[0].fundingRate → string like "-0.0000051366464414"
async function fetchFrOkx(sym: string): Promise<number | null> {
  const raw = await apiFetch(
    `https://www.okx.com/api/v5/public/funding-rate?instId=${sym}-USDT-SWAP`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  const fr = d?.data?.[0]?.fundingRate;
  return fr !== undefined ? parseFloat(fr) : null;
}

// Gate.io: FR fallback
// GET /api/v4/futures/usdt/tickers?contract=BTC_USDT
// [0].funding_rate → string like "-0.000136"
async function fetchFrGate(sym: string): Promise<number | null> {
  const raw = await apiFetch(
    `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${sym}_USDT`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  const fr = d?.[0]?.funding_rate;
  return fr !== undefined ? parseFloat(fr) : null;
}

// MEXC: funding rate
// GET https://api.mexc.com/api/v1/contract/funding_rate/{symbol}_USDT
// data.fundingRate → number
async function fetchFrMexc(sym: string): Promise<number | null> {
  const raw = await apiFetch(
    `https://api.mexc.com/api/v1/contract/funding_rate/${sym}_USDT`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  const fr = d?.data?.fundingRate;
  if (fr === undefined || fr === null) return null;
  const parsed = parseFloat(String(fr));
  return isNaN(parsed) ? null : parsed;
}

// OKX: open interest + 24h change
// GET /api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=1H
// data: array of [timestamp_ms, oi_usd, volume_usd]
// data[0] = newest, data[23] ≈ 24h ago
async function fetchOiOkx(sym: string): Promise<{ oi: number | null; change24h: number | null }> {
  const raw = await apiFetch(
    `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${sym}&period=1H`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  const data: string[][] = d?.data ?? [];
  if (data.length === 0) return { oi: null, change24h: null };

  const current = parseFloat(data[0]?.[1] ?? "0");
  const ago24 = parseFloat(data[Math.min(23, data.length - 1)]?.[1] ?? "0");
  const change24h = ago24 > 0 ? ((current - ago24) / ago24) * 100 : null;

  return {
    oi: current > 0 ? current : null,
    change24h,
  };
}

// OKX: long/short ratio (top traders)
// GET /api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader?ccy=BTC&period=1H
// data: array of [timestamp_ms, longShortRatio_string]
async function fetchLsOkx(sym: string): Promise<number | null> {
  const raw = await apiFetch(
    `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader?ccy=${sym}&period=1H`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;
  const ratio = d?.data?.[0]?.[1];
  if (ratio === undefined || ratio === null) return null;
  // ratio > 1 means more longs; convert to long% = ratio / (1 + ratio)
  const r = parseFloat(ratio);
  return isNaN(r) ? null : r / (1 + r);
}

export async function fetchCoinglassData(symbol: string): Promise<CoinglassData> {
  const sym = symbol.toUpperCase().replace(/USDT$|USDC$|BUSD$/, "");
  const hit = _cache.get(sym);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const [fr1, { oi, change24h }, ls, frMexc] = await Promise.all([
    fetchFrOkx(sym),
    fetchOiOkx(sym),
    fetchLsOkx(sym),
    fetchFrMexc(sym),
  ]);

  // Gate.io FR fallback if OKX returned null
  const fr2 = fr1 ?? (await fetchFrGate(sym));
  // Final fallback: MEXC
  const fr = fr2 ?? frMexc;

  let frExchange: string | null = null;
  if (fr1 !== null) frExchange = "OKX";
  else if (fr2 !== null) frExchange = "Gate.io";
  else if (frMexc !== null) frExchange = "MEXC";

  const data: CoinglassData = {
    fundingRate: fr,
    openInterest: oi,
    openInterestChange24h: change24h,
    longRatio: ls,
    fundingRateExchange: frExchange,
    mexcFundingRate: frMexc,
  };

  _cache.set(sym, { data, ts: Date.now() });
  return data;
}

export function formatCoinglass(d: CoinglassData): string {
  const parts: string[] = [];
  if (d.fundingRate !== null) {
    const frPct = d.fundingRate * 100;
    parts.push(`FR:${frPct >= 0 ? "+" : ""}${frPct.toFixed(4)}%/8h`);
  }
  if (d.openInterest !== null) {
    const oi =
      d.openInterest >= 1e9
        ? `$${(d.openInterest / 1e9).toFixed(2)}B`
        : `$${(d.openInterest / 1e6).toFixed(1)}M`;
    parts.push(`OI:${oi}`);
  }
  if (d.openInterestChange24h !== null) {
    parts.push(`OI24h:${d.openInterestChange24h >= 0 ? "+" : ""}${d.openInterestChange24h.toFixed(1)}%`);
  }
  if (d.longRatio !== null) {
    parts.push(`ロング率:${(d.longRatio * 100).toFixed(1)}%`);
  }
  return parts.length > 0 ? `Coinglass[${parts.join(", ")}]` : "";
}

export function evaluateShortSignal(fr: number | null): ShortSignal {
  if (fr === null) {
    return { isRecommended: false, reason: "FR取得不可 - 判定不能", level: "neutral" };
  }
  const frPct = fr * 100;
  if (frPct < -0.1) {
    return { isRecommended: false, reason: "FRマイナス危険域 - ショートスクイーズリスク", level: "danger" };
  }
  if (frPct < 0) {
    return { isRecommended: false, reason: "FRマイナス - ショート非推奨", level: "caution" };
  }
  if (frPct <= 0.05) {
    return { isRecommended: true, reason: "FR中立 - ショート可", level: "neutral" };
  }
  if (frPct <= 0.1) {
    return { isRecommended: true, reason: "FR高め - ショート有利", level: "favorable" };
  }
  return { isRecommended: true, reason: "FR過熱 - ショート強く推奨", level: "strong" };
}
