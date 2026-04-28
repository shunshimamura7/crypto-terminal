import { NextRequest } from "next/server";

export const runtime = "nodejs";

const MEXC = "https://contract.mexc.com";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  try {
    const res = await fetch(`${MEXC}/api/v1/contract/depth/${symbol}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return Response.json({ error: "MEXC API error" }, { status: 502 });
    const json = await res.json();
    return Response.json(json?.data ?? null);
  } catch {
    return Response.json({ error: "timeout" }, { status: 504 });
  }
}
