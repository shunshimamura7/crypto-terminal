import { NextRequest } from "next/server";
import { fetchCoinglassData, evaluateShortSignal } from "@/app/lib/coinglass";

export const runtime = "nodejs";
export const maxDuration = 15;

export interface DerivativesResponse {
  symbol: string;
  fundingRate: {
    current: number;
    currentPct: string;
    exchange: string;
    mexcRate: number | null;
    status: "danger" | "caution" | "neutral" | "favorable" | "strong";
  } | null;
  openInterest: {
    value: number;
    valueFmt: string;
    change24h: number;
  } | null;
  longShortRatio: number | null;
  shortSignal: {
    isRecommended: boolean;
    reason: string;
    level: string;
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase().replace(/USDT$|USDC$|BUSD$/, "");

  try {
    const data = await fetchCoinglassData(sym);
    const signal = evaluateShortSignal(data.fundingRate);

    const response: DerivativesResponse = {
      symbol: sym,
      fundingRate:
        data.fundingRate !== null
          ? {
              current: data.fundingRate,
              currentPct: `${(data.fundingRate * 100).toFixed(4)}%/8h`,
              exchange: data.fundingRateExchange ?? "unknown",
              mexcRate: data.mexcFundingRate,
              status: signal.level,
            }
          : null,
      openInterest:
        data.openInterest !== null
          ? {
              value: data.openInterest,
              valueFmt:
                data.openInterest >= 1e9
                  ? `$${(data.openInterest / 1e9).toFixed(2)}B`
                  : `$${(data.openInterest / 1e6).toFixed(1)}M`,
              change24h: data.openInterestChange24h ?? 0,
            }
          : null,
      longShortRatio: data.longRatio,
      shortSignal: signal,
    };

    return Response.json(response);
  } catch {
    return Response.json({
      symbol: sym,
      fundingRate: null,
      openInterest: null,
      longShortRatio: null,
      shortSignal: {
        isRecommended: false,
        reason: "データ取得エラー",
        level: "neutral",
      },
    } satisfies DerivativesResponse);
  }
}
