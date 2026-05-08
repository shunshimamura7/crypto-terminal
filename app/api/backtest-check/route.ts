import { NextRequest } from "next/server";

export const runtime = "nodejs";

interface MexcTicker {
  symbol: string;
  lastPrice: string;
  fundingRate?: string;
}

interface PriceUpdate {
  symbol: string;
  price: number;
  fundingRate: number | null;
}

export async function POST(req: NextRequest) {
  let symbols: string[] = [];
  try {
    const body = await req.json();
    symbols = (body?.symbols ?? []).filter((s: unknown) => typeof s === "string" && s.length > 0);
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  if (symbols.length === 0) {
    return Response.json({ updates: [], checkedAt: Date.now() });
  }

  const updates: PriceUpdate[] = [];

  try {
    const res = await fetch("https://api.mexc.com/api/v1/contract/ticker", {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      const tickers: MexcTicker[] = json?.data ?? [];
      const symSet = new Set(symbols);
      for (const t of tickers) {
        if (!symSet.has(t.symbol)) continue;
        const price = parseFloat(t.lastPrice);
        if (!(price > 0)) continue;
        const fr = t.fundingRate != null ? parseFloat(t.fundingRate) : null;
        updates.push({ symbol: t.symbol, price, fundingRate: isNaN(fr as number) ? null : fr });
      }
    }
  } catch {
    // MEXC unreachable — return empty updates; client falls back to scan prices
  }

  return Response.json({ updates, checkedAt: Date.now() });
}
