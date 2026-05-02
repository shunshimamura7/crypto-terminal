import { NextRequest } from "next/server";
import { detectPhase } from "@/app/lib/phaseDetector";
import type { PhaseResult } from "@/app/lib/phaseDetector";

export const runtime = "nodejs";

export interface FrRateItem {
  fr: number | null;
  priceChange24h: number | null;
  phase: PhaseResult | null;
}

async function fetchTicker(symbol: string): Promise<FrRateItem | null> {
  try {
    const res = await fetch(
      `https://api.mexc.com/api/v1/contract/ticker/${symbol}_USDT`,
      { signal: AbortSignal.timeout(6_000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.data) return null;
    const d = json.data;
    const fr: number | null = d.fundingRate != null ? Number(d.fundingRate) : null;
    // riseFallRate is decimal: 0.05 → +5%, -0.03 → -3%
    const priceChange24h: number | null = d.riseFallRate != null ? Number(d.riseFallRate) * 100 : null;
    const phase = fr !== null && priceChange24h !== null
      ? detectPhase(fr, null, null, priceChange24h)
      : null;
    return { fr, priceChange24h, phase };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  if (symbols.length === 0) return Response.json({});

  const results = await Promise.allSettled(symbols.map(fetchTicker));

  const rates: Record<string, FrRateItem | null> = {};
  symbols.forEach((sym, i) => {
    const r = results[i];
    rates[sym] = r.status === "fulfilled" ? r.value : null;
  });

  return Response.json(rates);
}
