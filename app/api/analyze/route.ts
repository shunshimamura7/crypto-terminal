import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getBinanceFutures } from "@/app/lib/binanceFutures";
import type { BinanceFuturesData } from "@/app/types/binanceFutures";

export const runtime = "nodejs";
export const maxDuration = 60;

function formatBinanceForPrompt(d: BinanceFuturesData): string {
  const frPct = (d.fundingRate * 100).toFixed(4);
  const frSign = d.fundingRate >= 0 ? "+" : "";
  const oiStr =
    d.openInterestUsdt >= 1e9
      ? `$${(d.openInterestUsdt / 1e9).toFixed(2)}B`
      : `$${(d.openInterestUsdt / 1e6).toFixed(1)}M`;
  const oi24h =
    d.oiChange24h !== null
      ? `${d.oiChange24h >= 0 ? "+" : ""}${d.oiChange24h.toFixed(1)}%`
      : "N/A";
  const oi7d =
    d.oiChange7d !== null
      ? `${d.oiChange7d >= 0 ? "+" : ""}${d.oiChange7d.toFixed(1)}%`
      : "N/A";
  const mexcMin = (d.mexcFrEstMin * 100).toFixed(4);
  const mexcMax = (d.mexcFrEstMax * 100).toFixed(4);

  return [
    "## デリバティブデータ [実測・Binance]",
    `FR: ${frSign}${frPct}%/8h (シグナル: ${d.frSignal})`,
    `Mark価格: $${d.markPrice} / Index: $${d.indexPrice}`,
    `OI: ${oiStr} (24h: ${oi24h} / 7d: ${oi7d})`,
    `OIトレンド: ${d.oiTrend} / 清算リスク: ${d.liquidationRisk}`,
    `MEXC推定FR: ${mexcMin}〜${mexcMax}%/8h`,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawSymbol: string = (body.symbol ?? "").toUpperCase();
  if (!rawSymbol) {
    return Response.json({ error: "symbol required" }, { status: 400 });
  }

  const baseSymbol = rawSymbol.replace(/_?USDT$/, "");

  const binanceData = await getBinanceFutures(baseSymbol).catch(() => null);

  const derivSection = binanceData
    ? formatBinanceForPrompt(binanceData)
    : "## デリバティブデータ\nBinance未上場のため[要確認]。MEXC独占銘柄の可能性あり。";

  const client = new Anthropic();

  let analysis = "";
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system:
        "あなたは暗号通貨デリバティブアナリストです。簡潔な日本語で分析してください。",
      messages: [
        {
          role: "user",
          content: `銘柄: ${baseSymbol}USDT\n\n${derivSection}\n\nこのデータを元に、ショートトレードの観点から3〜5文で分析してください。FRシグナル・OIトレンド・清算リスクを中心に述べてください。`,
        },
      ],
    });

    analysis = response.content
      .filter((b) => b.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b) => (b as any).text as string)
      .join("");
  } catch (err) {
    analysis =
      err instanceof Error ? `分析エラー: ${err.message}` : "分析エラー";
  }

  return Response.json({
    symbol: baseSymbol,
    binance: binanceData,
    analysis,
    isBinanceListed: binanceData !== null,
  });
}
