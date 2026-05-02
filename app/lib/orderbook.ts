import type { LiquidityInfo } from "@/app/lib/shortScorer";
export type { LiquidityInfo };

const MEXC_FUTURES = "https://api.mexc.com";
const _cache = new Map<string, { data: LiquidityInfo; ts: number }>();
const TTL = 60_000; // 1 min

type Level = [string, string]; // [price, qty]

function slippage(levels: Level[], sizeUsd: number, isSell: boolean): number {
  if (levels.length === 0 || sizeUsd <= 0) return 0;
  const bestPrice = parseFloat(levels[0][0]);
  if (bestPrice <= 0) return 0;

  let remaining = sizeUsd;
  let totalUsd = 0;
  let totalContracts = 0;

  for (const [pStr, qStr] of levels) {
    if (remaining <= 0) break;
    const p = parseFloat(pStr);
    const q = parseFloat(qStr);
    if (p <= 0 || q <= 0) continue;
    const fillUsd = Math.min(remaining, p * q);
    totalUsd += fillUsd;
    totalContracts += fillUsd / p;
    remaining -= fillUsd;
  }

  if (totalContracts === 0) return 99;
  const avgPrice = totalUsd / totalContracts;
  return isSell
    ? Math.max(0, (bestPrice - avgPrice) / bestPrice * 100)
    : Math.max(0, (avgPrice - bestPrice) / bestPrice * 100);
}

function maxSafe(levels: Level[], maxSlipPct: number): number {
  if (levels.length === 0) return 0;
  const bestPrice = parseFloat(levels[0][0]);
  if (bestPrice <= 0) return 0;

  let cumUsd = 0, totalVal = 0, totalQty = 0;
  for (const [pStr, qStr] of levels) {
    const p = parseFloat(pStr);
    const q = parseFloat(qStr);
    if (p <= 0 || q <= 0) continue;
    const levelUsd = p * q;
    totalVal += levelUsd;
    totalQty += q;
    cumUsd += levelUsd;
    const avg = totalVal / totalQty;
    const slip = (bestPrice - avg) / bestPrice * 100;
    if (slip > maxSlipPct) return Math.max(0, cumUsd - levelUsd);
  }
  return cumUsd;
}

export async function fetchLiquidityInfo(symbol: string): Promise<LiquidityInfo | null> {
  const hit = _cache.get(symbol);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  try {
    const res = await fetch(`${MEXC_FUTURES}/api/v1/contract/depth/${symbol}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const d = json?.data;
    if (!d?.asks || !d?.bids) return null;

    const asks: Level[] = d.asks;
    const bids: Level[] = d.bids;
    if (asks.length === 0 || bids.length === 0) return null;

    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const mid = (bestBid + bestAsk) / 2;
    const spread = mid > 0 ? (bestAsk - bestBid) / mid * 100 : 0;

    const bidDepth = bids.reduce((s, [p, q]) => s + parseFloat(p) * parseFloat(q), 0);
    const askDepth = asks.reduce((s, [p, q]) => s + parseFloat(p) * parseFloat(q), 0);

    const info: LiquidityInfo = {
      sellSlippage10k: slippage(bids, 10_000, true),
      sellSlippage50k: slippage(bids, 50_000, true),
      buySlippage10k:  slippage(asks, 10_000, false),
      buySlippage50k:  slippage(asks, 50_000, false),
      bidDepth, askDepth, spread,
      maxSafePosition: maxSafe(bids, 1.0),
    };

    _cache.set(symbol, { data: info, ts: Date.now() });
    return info;
  } catch {
    return null;
  }
}
