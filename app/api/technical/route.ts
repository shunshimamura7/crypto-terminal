import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEXC = "https://api.mexc.com";

// ─── Indicator helpers ────────────────────────────────────────────────────────

function calcSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcEma(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss -= changes[i];
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMacd(closes: number[]): { macdLine: number; signal: number; histogram: number } | null {
  if (closes.length < 35) return null;
  const ema12 = calcEma(closes, 12);
  const ema26 = calcEma(closes, 26);
  const macdSeries = ema12.map((v, i) => v - ema26[i]);
  const signalSeries = calcEma(macdSeries, 9);
  const last = closes.length - 1;
  return {
    macdLine:  macdSeries[last],
    signal:    signalSeries[last],
    histogram: macdSeries[last] - signalSeries[last],
  };
}

function calcBb(closes: number[], period = 20, mult = 2): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  return { upper: middle + mult * stddev, middle, lower: middle - mult * stddev };
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mexcGet(path: string): Promise<any> {
  try {
    const res = await fetch(`${MEXC}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const symbol = (body.symbol ?? "").toUpperCase().replace(/_?USDT$/, "");
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });

  const mexcSym = `${symbol}_USDT`;
  const nowSec  = Math.floor(Date.now() / 1000);

  const [kline4hData, kline1dData, tickerData] = await Promise.all([
    mexcGet(`/api/v1/contract/kline/${mexcSym}?interval=Hour4&start=${nowSec - 50 * 4 * 3600}&end=${nowSec}`),
    mexcGet(`/api/v1/contract/kline/${mexcSym}?interval=Day1&start=${nowSec - 210 * 86400}&end=${nowSec}`),
    mexcGet("/api/v1/contract/ticker"),
  ]);

  // Parse closes
  const parseCloses = (data: unknown): number[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (data as any)?.data?.close;
    if (!Array.isArray(raw)) return [];
    return (raw as string[]).map(Number).filter(n => n > 0);
  };
  const closes4h = parseCloses(kline4hData);
  const closes1d = parseCloses(kline1dData);

  // Ticker
  let currentPrice = 0, priceChange24h = 0;
  if (Array.isArray(tickerData?.data)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (tickerData.data as any[]).find((x: any) => x.symbol === mexcSym);
    if (t) {
      currentPrice    = parseFloat(t.lastPrice || "0");
      priceChange24h  = parseFloat(t.riseFallRate || "0") * 100;
    }
  }

  const price = currentPrice || (closes4h.at(-1) ?? 0);

  // Indicators — MA uses daily closes; RSI/MACD/BB use 4h closes
  const ma20  = calcSma(closes1d, 20);
  const ma50  = calcSma(closes1d, 50);
  const ma200 = calcSma(closes1d, 200);
  const rsi14 = calcRsi(closes4h, 14);
  const macdVal = calcMacd(closes4h);
  const bb    = calcBb(closes4h, 20);

  const ath14d = closes4h.length > 0 ? Math.max(...closes4h) : price;
  const athDrop = ath14d > 0 ? (price - ath14d) / ath14d * 100 : 0;

  // Build prompt text
  const pos = (v: number | null) => v != null ? (v >= 0 ? "+" : "") + v.toFixed(2) + "%" : "N/A";
  const fv  = (v: number | null) => v != null ? v.toFixed(4) : "N/A";
  const maRel = (ma: number | null) => !ma || !price ? "" : price > ma ? " ▲上" : " ▼下";

  const indicatorBlock = [
    `## ${symbol}/USDT テクニカルデータ`,
    `現在価格: $${price.toLocaleString()} (24h: ${pos(priceChange24h)})`,
    `直近ATH比: ${pos(athDrop)}`,
    "",
    "### 移動平均線 (日足)",
    `MA20:  ${fv(ma20)}${maRel(ma20)}`,
    `MA50:  ${fv(ma50)}${maRel(ma50)}`,
    `MA200: ${ma200 != null ? fv(ma200) + maRel(ma200) : "データ不足"}`,
    "",
    "### RSI (14, 4h)",
    `RSI: ${rsi14 != null ? rsi14.toFixed(2) : "N/A"} ${rsi14 != null ? (rsi14 >= 70 ? "⚠️買われすぎ" : rsi14 <= 30 ? "⚠️売られすぎ" : "中立") : ""}`,
    "",
    "### MACD (12,26,9, 4h)",
    `MACDライン: ${fv(macdVal?.macdLine ?? null)}`,
    `シグナル:   ${fv(macdVal?.signal ?? null)}`,
    `ヒスト:     ${fv(macdVal?.histogram ?? null)} ${macdVal ? (macdVal.histogram > 0 ? "↑強気" : "↓弱気") : ""}`,
    "",
    "### ボリンジャーバンド (20,2, 4h)",
    `上限: ${fv(bb?.upper ?? null)}`,
    `中央: ${fv(bb?.middle ?? null)}`,
    `下限: ${fv(bb?.lower ?? null)}`,
    bb && price ? `現在位置: ${price > bb.upper ? "上限突破" : price < bb.lower ? "下限割れ" : "バンド内"}` : "",
  ].filter(Boolean).join("\n");

  // Stream response: first line = JSON indicators, then AI text
  const encoder = new TextEncoder();
  const indicators = { price, priceChange24h, athDrop, ma20, ma50, ma200, rsi14, macd: macdVal, bb };

  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ indicators }) + "\n"));

      try {
        const client = new Anthropic();
        const msgStream = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system: "あなたはプロの暗号通貨テクニカルアナリスト。与えられたインジケーターデータを元に、具体的な価格帯を含む実践的な日本語分析を提供する。各セクションを見出し（**太字**）で区切り、簡潔かつ具体的に述べる。",
          messages: [{
            role: "user",
            content: `${indicatorBlock}\n\n以下の5つの観点で分析してください：\n\n1. **トレンド判定** — 現在のトレンド（上昇/下降/レンジ）の根拠\n2. **インジケーター解説** — MA・RSI・MACD・BBそれぞれの現状と意味\n3. **サポート・レジスタンス** — 具体的な価格帯と根拠\n4. **短期・中期見通し** — 2シナリオ（強気/弱気）で説明\n5. **エントリーポイント候補** — 具体的な価格帯・損切りライン・利確目標`,
          }],
        });

        msgStream.on("text", text => {
          try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ }
        });

        await msgStream.finalMessage();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "不明なエラー";
        try { controller.enqueue(encoder.encode(`\n\n⚠️ エラー: ${msg}`)); } catch { /* closed */ }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
