"use client";

export interface MarketContext {
  btcPrice: number;
  ethPrice: number;
  fearGreed: number | null;
  fearGreedLabel: string | null;
  btcChange24h: number;
  marketPhase: "risk_on" | "neutral" | "risk_off";
}

export async function getCurrentMarketContext(): Promise<MarketContext | null> {
  try {
    const res = await fetch("/api/market-env", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const btcPrice     = (data.btcPrice    as number) ?? 0;
    const ethPrice     = (data.ethPrice    as number) ?? 0;
    const btcChange24h = (data.btcChange24h as number) ?? 0;
    const fearGreed      = (data.fng?.value    as number | undefined) ?? null;
    const fearGreedLabel = (data.fng?.valueText as string | undefined) ?? null;

    let marketPhase: MarketContext["marketPhase"] = "neutral";
    if (fearGreed !== null && (fearGreed < 30 || btcChange24h < -3)) {
      marketPhase = "risk_off";
    } else if (fearGreed !== null && fearGreed > 70 && btcChange24h > 0) {
      marketPhase = "risk_on";
    }

    return { btcPrice, ethPrice, fearGreed, fearGreedLabel, btcChange24h, marketPhase };
  } catch { return null; }
}
