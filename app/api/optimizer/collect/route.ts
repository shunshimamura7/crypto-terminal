import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEXC = "https://contract.mexc.com";
const BATCH_SIZE = 20;
const SYMBOL_DELAY_MS = 110; // 20 req/2s → ~100ms each, 10ms buffer
const BUDGET_MS = 52_000;

const DAYS_180_MS = 180 * 24 * 3_600_000;
const HOURS_72_SEC = 72 * 3_600;

// Explicit exclusion list (stocks, commodities, non-crypto synthetics)
const EXCLUDED_BASE = new Set([
  "USOIL", "UKOIL", "XAUT", "USIB", "USIN",
  "ANTHROPIC", "OPENAI", "SPACEX",
  "NVDA", "TSLA", "AAPL", "META", "GOOGL", "AMZN", "MSFT", "NFLX", "AMD", "COIN", "MSTR",
]);

// 非crypto除外キーワード（株式/コモディティ/指数）
const EXCLUDE_KEYWORDS = [
  // 株式トークン
  "ANTHROPIC", "OPENAI", "SPACEX", "TRUMP", "MUSK",
  "NVIDIA", "TSLA", "AAPL", "GOOGL", "MSFT", "META",
  "AMZN", "NFLX", "UBER", "COIN", "HOOD",
  // コモディティ
  "USOIL", "XAUT", "ALUMINUM", "SILVER", "COPPER",
  "NATGAS", "WHEAT", "CORN", "OIL", "CRUDE",
  // 指数
  "SPX500", "SPX", "US30", "HK50", "JP225", "NAS100",
  "NIFTY", "DAX", "FTSE", "CAC40", "ASX200", "VIX",
  // FX系
  "EURUSD", "GBPUSD", "USDJPY",
];

function isExcluded(symbol: string): boolean {
  const base = symbol.replace(/_USDT$/i, "").toUpperCase();
  if (EXCLUDED_BASE.has(base)) return true;
  // e.g. AAPLSTOCK_USDT, NFLXSTOCK_USDT
  if (/STOCK$/i.test(base)) return true;
  // キーワードフィルタ（非crypto除外）
  if (EXCLUDE_KEYWORDS.some(kw => base.includes(kw))) return true;
  return false;
}

async function mexcGet(path: string, ms = 10_000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${MEXC}${path}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "bell-crypto-terminal/optimizer" },
    });
    clearTimeout(id);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(id);
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export interface CsvRow {
  symbol: string;
  listingTime: number; // unix seconds
  candleTime: number;  // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CollectResponse {
  batch: number;
  totalBatches: number;
  totalSymbols: number;
  processedSymbols: number;
  rows: CsvRow[];
  done: boolean;
  error?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse<CollectResponse>> {
  const { searchParams } = new URL(req.url);
  const batch = Math.max(0, parseInt(searchParams.get("batch") ?? "0", 10) || 0);
  const deadline = Date.now() + BUDGET_MS;

  const detailRes = await mexcGet("/api/v1/contract/detail", 15_000);
  if (!detailRes?.data) {
    return NextResponse.json(
      { batch, totalBatches: 0, totalSymbols: 0, processedSymbols: 0, rows: [], done: true, error: "MEXC API接続失敗" },
      { status: 502 },
    );
  }

  const now = Date.now();
  const cutoff = now - DAYS_180_MS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const symbols: Array<{ symbol: string; listingTimeSec: number }> = (detailRes.data as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => {
      if (c.state !== 0) return false;
      if (!c.symbol?.endsWith("_USDT")) return false;
      if (isExcluded(c.symbol as string)) return false;
      const ct = Number(c.createTime || 0);
      return ct > 0 && ct >= cutoff;
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => ({
      symbol: c.symbol as string,
      listingTimeSec: Math.floor(Number(c.createTime) / 1000),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const totalSymbols = symbols.length;
  const totalBatches = Math.max(1, Math.ceil(totalSymbols / BATCH_SIZE));

  if (totalSymbols === 0 || batch >= totalBatches) {
    return NextResponse.json({
      batch,
      totalBatches,
      totalSymbols,
      processedSymbols: 0,
      rows: [],
      done: true,
    });
  }

  const batchSymbols = symbols.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
  const rows: CsvRow[] = [];
  let processedSymbols = 0;

  for (let i = 0; i < batchSymbols.length; i++) {
    if (Date.now() >= deadline) break;
    const { symbol, listingTimeSec } = batchSymbols[i];
    if (i > 0) await sleep(SYMBOL_DELAY_MS);

    const klineRes = await mexcGet(
      `/api/v1/contract/kline/${symbol}?interval=Min15&start=${listingTimeSec}&end=${listingTimeSec + HOURS_72_SEC}`,
      8_000,
    );

    processedSymbols++;

    if (!klineRes?.data) continue;
    const kd = klineRes.data;
    const times:  number[] = (kd.time  || []).map(Number);
    const opens:  number[] = (kd.open  || []).map(Number);
    const highs:  number[] = (kd.high  || []).map(Number);
    const lows:   number[] = (kd.low   || []).map(Number);
    const closes: number[] = (kd.close || []).map(Number);
    // amount = USD volume (preferred), vol = contract units
    const vols:   number[] = (
      (kd.amount && (kd.amount as number[]).length > 0 ? kd.amount : kd.vol) || []
    ).map(Number);

    for (let j = 0; j < closes.length; j++) {
      const c = closes[j];
      if (c > 0) {
        rows.push({
          symbol,
          listingTime: listingTimeSec,
          candleTime:  times[j]  ?? 0,
          open:        opens[j]  ?? c,
          high:        highs[j]  ?? c,
          low:         lows[j]   ?? c,
          close:       c,
          volume:      vols[j]   ?? 0,
        });
      }
    }
  }

  return NextResponse.json({
    batch,
    totalBatches,
    totalSymbols,
    processedSymbols,
    rows,
    done: batch + 1 >= totalBatches,
  });
}
