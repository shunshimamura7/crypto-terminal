import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEXC = "https://api.mexc.com";
const BATCH_SIZE = 10;
const SYMBOL_DELAY_MS = 200;
const BUDGET_MS = 50_000;

// ─── Non-crypto filter (same patterns as short-scan) ─────────────────────────
const NON_CRYPTO_PATTERNS = [
  /^(GOLD|SILVER|COPPER|XAU|XAG|XPD|XPT)_/i,
  /^(HK50|SPX|NASDAQ|NDX|DJI|FTSE|DAX|NI225|HSI|KOSPI|CAC40|IBEX|ASX200)_/i,
  /^(WTI|BRENT|NATGAS|WHEAT|CORN|SOYBEAN|SUGAR|COFFEE|COTTON|COCOA)_/i,
  /^(EUR|GBP|JPY|AUD|CAD|CHF|NZD|KRW|HKD|CNH|SGD|MXN|BRL|INR|ZAR)_/i,
];
const STOCK_EXCEPTIONS = new Set<string>([]);
function isNonCrypto(symbol: string): boolean {
  if (NON_CRYPTO_PATTERNS.some(p => p.test(symbol))) return true;
  const stripped = symbol.replace(/_USDT$/i, "").toUpperCase();
  if (/STOCK/.test(stripped) && !STOCK_EXCEPTIONS.has(stripped)) return true;
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle {
  time: number;   // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD
}

interface SymbolResult {
  symbol: string;
  createTime: number;   // ms epoch (0 = unknown)
  listedDaysAgo: number; // -1 = unknown
  candles: Candle[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const batch = Math.max(0, parseInt(searchParams.get("batch") ?? "0", 10) || 0);

  // Single-symbol mode — used to fetch BTC benchmark candles
  const singleSymbol = searchParams.get("symbol");
  if (singleSymbol) {
    const nowMs  = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const day90AgoSec = nowSec - 90 * 86_400;
    const klineRes = await mexcGet(
      `/api/v1/contract/kline/${singleSymbol}?interval=Day1&start=${day90AgoSec}&end=${nowSec}`,
      8000,
    );
    const candles: Candle[] = [];
    if (klineRes?.data) {
      const kd = klineRes.data;
      const times  = (kd.time   || []).map(Number);
      const opens  = (kd.open   || []).map(Number);
      const highs  = (kd.high   || []).map(Number);
      const lows   = (kd.low    || []).map(Number);
      const closes = (kd.close  || []).map(Number);
      const vols   = ((kd.amount && kd.amount.length > 0 ? kd.amount : kd.vol) || []).map(Number);
      for (let j = 0; j < closes.length; j++) {
        const c = closes[j];
        if (c > 0) {
          candles.push({
            time:   times[j]  ?? 0,
            open:   opens[j]  ?? c,
            high:   highs[j]  ?? c,
            low:    lows[j]   ?? c,
            close:  c,
            volume: vols[j]   ?? 0,
          });
        }
      }
    }
    return NextResponse.json({
      results: [{ symbol: singleSymbol, createTime: 0, listedDaysAgo: -1, candles }],
    });
  }

  const deadline = Date.now() + BUDGET_MS;

  // Fetch ticker + detail in parallel (same endpoints as short-scan)
  const [tickerRes, detailRes] = await Promise.all([
    mexcGet("/api/v1/contract/ticker"),
    mexcGet("/api/v1/contract/detail"),
  ]);

  if (!tickerRes?.data || !detailRes?.data) {
    return NextResponse.json({ error: "MEXC API接続失敗" }, { status: 502 });
  }

  // createTime map: symbol → ms epoch
  const createTimeMap: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of detailRes.data as any[]) {
    if (c.symbol) createTimeMap[c.symbol] = Number(c.createTime || 0);
  }

  // All USDT futures symbols, non-crypto filtered, sorted for stable batching
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSymbols: string[] = (tickerRes.data as any[])
    .map((t: { symbol: string }) => t.symbol)
    .filter((s: string) => s.endsWith("_USDT") && !isNonCrypto(s))
    .sort();

  const totalSymbols = allSymbols.length;
  const totalBatches = Math.ceil(totalSymbols / BATCH_SIZE);
  const batchSymbols = allSymbols.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

  if (batchSymbols.length === 0) {
    return NextResponse.json({ batch, totalSymbols, totalBatches, results: [] });
  }

  const nowMs  = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const day90AgoSec = nowSec - 90 * 86_400;

  const results: SymbolResult[] = [];

  for (let i = 0; i < batchSymbols.length; i++) {
    if (Date.now() >= deadline) {
      console.log(`[historical/collect] budget exceeded at symbol ${i}/${batchSymbols.length}`);
      break;
    }

    const symbol = batchSymbols[i];
    if (i > 0) await sleep(SYMBOL_DELAY_MS);

    const klineRes = await mexcGet(
      `/api/v1/contract/kline/${symbol}?interval=Day1&start=${day90AgoSec}&end=${nowSec}`,
      8000,
    );

    const createTime = createTimeMap[symbol] ?? 0;
    const listedDaysAgo = createTime > 0
      ? Math.floor((nowMs - createTime) / 86_400_000)
      : -1;

    const candles: Candle[] = [];
    if (klineRes?.data) {
      const kd = klineRes.data;
      const times:  number[] = (kd.time  || []).map(Number);
      const opens:  number[] = (kd.open  || []).map(Number);
      const highs:  number[] = (kd.high  || []).map(Number);
      const lows:   number[] = (kd.low   || []).map(Number);
      const closes: number[] = (kd.close || []).map(Number);
      // prefer amount (USD volume) over vol (contract units)
      const vols: number[] = ((kd.amount && kd.amount.length > 0 ? kd.amount : kd.vol) || []).map(Number);

      for (let j = 0; j < closes.length; j++) {
        const c = closes[j];
        if (c > 0) {
          candles.push({
            time:   times[j]  ?? 0,
            open:   opens[j]  ?? c,
            high:   highs[j]  ?? c,
            low:    lows[j]   ?? c,
            close:  c,
            volume: vols[j]   ?? 0,
          });
        }
      }
    }

    results.push({ symbol, createTime, listedDaysAgo, candles });
  }

  return NextResponse.json({ batch, totalSymbols, totalBatches, results });
}
