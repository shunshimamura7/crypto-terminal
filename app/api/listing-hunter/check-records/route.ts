import { NextResponse } from "next/server";
import type { HunterRecord, HunterRecordStatus } from "@/app/lib/listingHunterRecords";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEXC = "https://api.mexc.com";

interface KlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PricePoint {
  at: string;
  price: number;
  pnlPct: number;
}

export interface RecordCheckResult {
  id: string;
  currentPrice: number;
  currentPnlPct: number;
  tpHit: { hitAt: string; pnlPct: number } | null;
  slHit: { hitAt: string; pnlPct: number } | null;
  firstHit: "tp" | "sl" | "none";
  firstHitAt?: string;
  maxFavorable: PricePoint;
  maxAdverse: PricePoint;
  isExpired: boolean;
  suggestedStatus: HunterRecordStatus;
  suggestedFinalPnl: number;
}

export interface CheckResponse {
  results: RecordCheckResult[];
}

type RecordInput = Pick<
  HunterRecord,
  "id" | "symbol" | "entryAt" | "entryPrice" | "tpPrice" | "slPrice" | "deadline"
>;

interface CheckRequest {
  records: RecordInput[];
}

interface MexcKlineRaw {
  success: boolean;
  data?: {
    time: number[];
    open: string[];
    close: string[];
    high: string[];
    low: string[];
  };
}

async function fetchKlines(
  symbol: string,
  startSec: number,
  endSec: number,
): Promise<KlineBar[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const url = `${MEXC}/api/v1/contract/kline/${symbol}?interval=Min15&start=${startSec}&end=${endSec}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "bell-crypto-terminal/check-records" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json: MexcKlineRaw = await res.json();
    if (!json.success || !json.data) return [];
    const { time, open, high, low, close } = json.data;
    const bars: KlineBar[] = [];
    for (let i = 0; i < (time?.length ?? 0); i++) {
      const o = parseFloat(open[i] ?? "0");
      const h = parseFloat(high[i] ?? "0");
      const l = parseFloat(low[i] ?? "0");
      const c = parseFloat(close[i] ?? "0");
      if (time[i] > 0 && o > 0 && c > 0) {
        bars.push({ time: time[i], open: o, high: h, low: l, close: c });
      }
    }
    return bars;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function checkRecord(record: RecordInput): Promise<RecordCheckResult> {
  const { id, symbol, entryAt, entryPrice, tpPrice, slPrice, deadline } = record;
  const now = Date.now();
  const entryMs = new Date(entryAt).getTime();
  const deadlineMs = new Date(deadline).getTime();
  const endMs = Math.min(now, deadlineMs);

  const startSec = Math.floor(entryMs / 1000);
  const endSec = Math.floor(endMs / 1000);

  const bars = await fetchKlines(symbol, startSec, endSec);

  let currentPrice = entryPrice;
  let tpHit: RecordCheckResult["tpHit"] = null;
  let slHit: RecordCheckResult["slHit"] = null;
  let maxFavPrice = entryPrice;
  let maxFavTime = entryAt;
  let maxAdvPrice = entryPrice;
  let maxAdvTime = entryAt;

  for (const bar of bars) {
    const barTimeIso = new Date(bar.time * 1000).toISOString();
    currentPrice = bar.close;

    if (bar.low < maxFavPrice) { maxFavPrice = bar.low; maxFavTime = barTimeIso; }
    if (bar.high > maxAdvPrice) { maxAdvPrice = bar.high; maxAdvTime = barTimeIso; }

    // TP: short profit = price falls to tpPrice (low <= tpPrice)
    if (tpHit === null && bar.low <= tpPrice) {
      tpHit = {
        hitAt: barTimeIso,
        pnlPct: (entryPrice - tpPrice) / entryPrice * 100,
      };
    }
    // SL: short loss = price rises to slPrice (high >= slPrice)
    if (slHit === null && bar.high >= slPrice) {
      slHit = {
        hitAt: barTimeIso,
        pnlPct: (entryPrice - slPrice) / entryPrice * 100,
      };
    }
    if (tpHit && slHit) break;
  }

  let firstHit: "tp" | "sl" | "none" = "none";
  let firstHitAt: string | undefined;
  if (tpHit && slHit) {
    if (tpHit.hitAt <= slHit.hitAt) { firstHit = "tp"; firstHitAt = tpHit.hitAt; }
    else { firstHit = "sl"; firstHitAt = slHit.hitAt; }
  } else if (tpHit) {
    firstHit = "tp"; firstHitAt = tpHit.hitAt;
  } else if (slHit) {
    firstHit = "sl"; firstHitAt = slHit.hitAt;
  }

  // PnL% = (entry - exit) / entry × 100
  const currentPnlPct = (entryPrice - currentPrice) / entryPrice * 100;
  const maxFavPnlPct = (entryPrice - maxFavPrice) / entryPrice * 100; // positive = price dropped (good for short)
  const maxAdvPnlPct = (entryPrice - maxAdvPrice) / entryPrice * 100; // negative = price rose (bad for short)
  const isExpired = now >= deadlineMs;

  let suggestedStatus: HunterRecordStatus = "open";
  let suggestedFinalPnl = currentPnlPct;

  if (firstHit === "tp") { suggestedStatus = "win"; suggestedFinalPnl = tpHit!.pnlPct; }
  else if (firstHit === "sl") { suggestedStatus = "loss"; suggestedFinalPnl = slHit!.pnlPct; }
  else if (isExpired) { suggestedStatus = "timeout"; suggestedFinalPnl = currentPnlPct; }

  return {
    id, currentPrice, currentPnlPct,
    tpHit, slHit, firstHit, firstHitAt,
    maxFavorable: { at: maxFavTime, price: maxFavPrice, pnlPct: maxFavPnlPct },
    maxAdverse: { at: maxAdvTime, price: maxAdvPrice, pnlPct: maxAdvPnlPct },
    isExpired, suggestedStatus, suggestedFinalPnl,
  };
}

export async function POST(req: Request): Promise<Response> {
  let body: CheckRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.records) || body.records.length === 0) {
    return NextResponse.json<CheckResponse>({ results: [] });
  }

  // Limit to 10 records per call to stay within timeout
  const records = body.records.slice(0, 10);
  const settled = await Promise.allSettled(records.map(r => checkRecord(r)));
  const results: RecordCheckResult[] = settled
    .filter((s): s is PromiseFulfilledResult<RecordCheckResult> => s.status === "fulfilled")
    .map(s => s.value);

  return NextResponse.json<CheckResponse>({ results });
}
