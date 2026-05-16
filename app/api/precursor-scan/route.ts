import { NextResponse } from "next/server";
import { scanPrecursors, fetchTopTickers } from "@/app/lib/precursorScanner";
import type { PrecursorSignal } from "@/app/lib/precursorScanner";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CacheEntry {
  results: PrecursorSignal[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10分

export interface PrecursorScanResponse {
  results: PrecursorSignal[];
  fetchedAt: number;
  fromCache: boolean;
}

export async function GET(): Promise<Response> {
  const cached = cache.get("precursor");
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return NextResponse.json<PrecursorScanResponse>({
      results: cached.results,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    });
  }

  try {
    const tickers = await fetchTopTickers(200);
    if (tickers.length === 0) {
      return NextResponse.json({ error: "MEXC ticker fetch failed" }, { status: 502 });
    }

    const results = await scanPrecursors(tickers);
    const fetchedAt = Date.now();
    cache.set("precursor", { results, fetchedAt });

    return NextResponse.json<PrecursorScanResponse>({ results, fetchedAt, fromCache: false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
