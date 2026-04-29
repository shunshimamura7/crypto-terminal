import { NextRequest } from "next/server";

export const runtime = "nodejs";

type MexcTicker = { symbol: string; lastPrice: string };

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
  if (symbols.length === 0) return Response.json({ prices: {} });

  const prices: Record<string, number> = {};

  try {
    const res = await fetch("https://contract.mexc.com/api/v1/contract/ticker", {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      const tickers: MexcTicker[] = json?.data ?? [];
      const symSet = new Set(symbols);
      for (const t of tickers) {
        if (symSet.has(t.symbol)) {
          const p = parseFloat(t.lastPrice);
          if (p > 0) prices[t.symbol] = p;
        }
      }
    }
  } catch {
    // timeout or network error — return empty prices (caller handles gracefully)
  }

  return Response.json({ prices });
}
