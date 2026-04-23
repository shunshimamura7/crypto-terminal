import { NextRequest } from "next/server";
import { getBinanceFutures, normalizeBinanceSymbol } from "@/app/lib/binanceFutures";

export const runtime = "edge";

// In-memory cache for warm-instance reuse
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("symbol") ?? "";
  if (!raw.trim()) {
    return Response.json({ success: false, error: "symbol required" }, { status: 400 });
  }

  const sym = normalizeBinanceSymbol(raw);

  const hit = _cache.get(sym);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return Response.json(hit.data, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
    });
  }

  const data = await getBinanceFutures(sym);

  if (!data) {
    const err = {
      success: false,
      error: "Binance未上場またはAPIエラー",
      hint: "MEXC独占銘柄の可能性があります",
    };
    return Response.json(err, {
      status: 404,
      headers: { "Cache-Control": "public, s-maxage=60" },
    });
  }

  const resp = { success: true, data };
  _cache.set(sym, { data: resp, ts: Date.now() });

  return Response.json(resp, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
  });
}
