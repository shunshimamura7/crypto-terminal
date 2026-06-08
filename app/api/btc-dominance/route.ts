import { NextResponse } from "next/server";

interface DominanceResult {
  dominance: number | null;
  dominanceDelta7d: number | null;
}

const EMPTY: DominanceResult = { dominance: null, dominanceDelta7d: null };

function cgUrl(path: string, extraParams: Record<string, string> = {}): string {
  const params = new URLSearchParams(extraParams);
  const key = process.env.NEXT_PUBLIC_COINGECKO_API_KEY;
  if (key) params.set("x_cg_demo_api_key", key);
  const qs = params.toString();
  return `https://api.coingecko.com/api/v3/${path}${qs ? "?" + qs : ""}`;
}

export async function GET() {
  try {
    const [globalData, btcChartData, totalChartData] = await Promise.allSettled([
      // Current BTC dominance
      fetch(cgUrl("global"), {
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 3600 },
      }).then(r => r.ok ? r.json() : null).catch(() => null),

      // BTC market cap history (7 days — [0] aligns with totalChart [0] = 7d ago)
      fetch(cgUrl("coins/bitcoin/market_chart", { vs_currency: "usd", days: "7", interval: "daily" }), {
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 3600 },
      }).then(r => r.ok ? r.json() : null).catch(() => null),

      // Total market cap history (7 days)
      fetch(cgUrl("global/market_cap_chart", { days: "7" }), {
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 3600 },
      }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const globalJson = globalData.status === "fulfilled" ? globalData.value : null;
    const btcChart   = btcChartData.status === "fulfilled" ? btcChartData.value : null;
    const totalChart = totalChartData.status === "fulfilled" ? totalChartData.value : null;

    // Current BTC dominance (%)
    const dominance: number | null = globalJson?.data?.market_cap_percentage?.btc ?? null;

    // 7-day delta: (current dominance) − (dominance 7d ago)
    // dominance 7d ago = btcMcap[0] / totalMcap[0] * 100
    // 仮値閾値 ±1.5pt — BT蓄積後に調整 (Phase 10)
    let dominanceDelta7d: number | null = null;
    if (dominance !== null && btcChart && totalChart) {
      const btcMcaps: [number, number][]   = btcChart?.market_caps ?? [];
      const totalMcaps: [number, number][] = totalChart?.market_cap_chart?.market_cap ?? [];

      if (btcMcaps.length > 0 && totalMcaps.length > 0) {
        const btcMcap7dAgo   = btcMcaps[0][1];
        const totalMcap7dAgo = totalMcaps[0][1];
        if (totalMcap7dAgo > 0) {
          const dominance7dAgo = (btcMcap7dAgo / totalMcap7dAgo) * 100;
          dominanceDelta7d = dominance - dominance7dAgo;
        }
      }
    }

    return NextResponse.json({ dominance, dominanceDelta7d });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
