import { NextRequest, NextResponse } from "next/server";
import { PATTERNS, type Candle } from "@/app/lib/patterns";

export const runtime = "nodejs";
export const maxDuration = 15;

const MEXC_API = "https://api.mexc.com";

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mexcGet(path: string): Promise<any> {
  const res = await fetchWithTimeout(`${MEXC_API}${path}`);
  if (!res?.ok) return null;
  try { return await res.json(); } catch { return null; }
}

export interface PatternMatch {
  id: string;
  name: string;
}

// Fetch 90d daily candles for a single MEXC futures symbol
async function fetchCandles(symbol: string): Promise<Candle[]> {
  const nowSec      = Math.floor(Date.now() / 1000);
  const day90AgoSec = nowSec - 90 * 86_400;
  const data = await mexcGet(
    `/api/v1/contract/kline/${symbol}?interval=Day1&start=${day90AgoSec}&end=${nowSec}`,
  );
  if (!data?.data) return [];
  const kd = data.data;
  const times  = (kd.time   || []).map(Number);
  const highs  = (kd.high   || []).map(Number);
  const lows   = (kd.low    || []).map(Number);
  const closes = (kd.close  || []).map(Number);
  const vols   = ((kd.amount && kd.amount.length > 0 ? kd.amount : kd.vol) || []).map(Number);

  const candles: Candle[] = [];
  for (let j = 0; j < closes.length; j++) {
    const c = closes[j];
    if (c > 0) {
      candles.push({
        time:   times[j]  ?? 0,
        high:   highs[j]  ?? c,
        low:    lows[j]   ?? c,
        close:  c,
        volume: vols[j]   ?? 0,
      });
    }
  }
  return candles;
}

// Fetch listedDaysAgo from MEXC contract detail
async function fetchListedDaysAgo(symbol: string): Promise<number> {
  const data = await mexcGet("/api/v1/contract/detail");
  if (!data?.data) return 999;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detail = (data.data as any[]).find((d: any) => d.symbol === symbol);
  if (!detail?.createTime) return 999;
  return Math.floor((Date.now() - Number(detail.createTime)) / 86_400_000);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { symbol: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { symbol } = body;
  if (!symbol || typeof symbol !== "string") {
    return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  }

  const [candles, listedDaysAgo] = await Promise.all([
    fetchCandles(symbol),
    fetchListedDaysAgo(symbol),
  ]);

  if (candles.length < 5) {
    return NextResponse.json({ ok: true, data: { symbol, matched: [], count: 0 } });
  }

  const i = candles.length - 1; // latest candle
  const matched: PatternMatch[] = [];

  for (const pattern of PATTERNS) {
    try {
      if (pattern.fn(candles, i, listedDaysAgo)) {
        matched.push({ id: pattern.id, name: pattern.name });
      }
    } catch {
      // skip patterns that error on insufficient data
    }
  }

  return NextResponse.json({ ok: true, data: { symbol, matched, count: matched.length } });
}
