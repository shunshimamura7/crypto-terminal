import { NextRequest } from "next/server";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { fetchCoinsForFilter, filterForSector } from "@/app/lib/primaryFilter";
import type { CoinFilterData } from "@/app/lib/primaryFilter";

export const runtime = "nodejs";
export const maxDuration = 60;

const SECTOR_CATEGORY_MAP: Record<string, string[]> = {
  "AI": ["AI Agents", "Artificial Intelligence", "AI"],
  "RWA": ["RWA", "Real World Assets"],
  "DeFi": ["DEX", "Lending", "Yield Aggregator", "Derivatives", "DeFi"],
  "GameFi": ["Gaming", "GameFi"],
  "DePIN": ["DePIN"],
  "L1": ["Layer 1", "Chain"],
  "L2": ["Layer 2", "Rollup"],
  "Meme": ["Meme"],
  "Privacy": ["Privacy"],
};

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch { clearTimeout(id); return null; }
}

export async function POST(req: NextRequest) {
  try {
    const { sector } = await req.json();
    if (!sector) return Response.json({ error: "sector required" }, { status: 400 });

    // DeFiLlama (8秒タイムアウト)
    let defiLlamaContext = "";
    try {
      const res = await fetchWithTimeout("https://api.llama.fi/protocols", 8000);
      if (res?.ok) {
        const protocols = await res.json();
        const categories = SECTOR_CATEGORY_MAP[sector] || [sector];
        const matched = protocols
          .filter((p: {category: string; tvl: number}) =>
            categories.some(cat => p.category?.toLowerCase().includes(cat.toLowerCase()))
          )
          .sort((a: {tvl: number}, b: {tvl: number}) => (b.tvl||0) - (a.tvl||0))
          .slice(0, 15)
          .map((p: {name: string; symbol: string; tvl: number; change_7d: number}) =>
            `${p.name}(${p.symbol}): TVL ${fmtUsd(p.tvl)}, 7d: ${p.change_7d?.toFixed(1) ?? "N/A"}%`
          )
          .join("\n");
        if (matched) defiLlamaContext = `【DeFiLlama ${sector}セクターTVLランキング】\n${matched}`;
      }
    } catch (e) { console.error("[sector] DeFiLlama fetch error:", e); }

    // Fear & Greed
    let fearGreed = "";
    try {
      const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", 5000);
      if (res?.ok) {
        const json = await res.json();
        const d = json?.data?.[0];
        if (d) fearGreed = `Fear & Greed: ${d.value}/100 (${d.value_classification})`;
      }
    } catch (e) { console.error("[sector] FearGreed fetch error:", e); }

    // CoinGecko coins (10秒タイムアウト。失敗時は空配列で続行)
    let coins: CoinFilterData[] = [];
    try {
      coins = await Promise.race([
        fetchCoinsForFilter(),
        new Promise<CoinFilterData[]>(resolve => setTimeout(() => resolve([]), 10000)),
      ]);
    } catch (e) { console.error("[sector] fetchCoinsForFilter error:", e); }

    const { passed } = filterForSector(coins);
    const coinsContext = passed.slice(0, 50).map(c => {
      const athDrop = ((c.ath - c.current_price) / c.ath * 100).toFixed(0);
      return `${c.symbol.toUpperCase()}: $${c.current_price}, MC:${fmtUsd(c.market_cap)}, Vol:${fmtUsd(c.total_volume)}, ATH比:-${athDrop}%, 7d:${c.price_change_percentage_7d_in_currency?.toFixed(1)}%`;
    }).join("\n");

    const client = new Anthropic();
    const prompt = `セクター「${sector}」の包括的分析を実施せよ。

## DeFiLlamaデータ
${defiLlamaContext || "データなし"}

## 市場データ（CoinGecko上位50銘柄）
${coinsContext || "データなし（取得タイムアウト）"}

## マクロ指標
${fearGreed || "データなし"}

## 指示
以下を日本語で出力せよ：
1. セクター総合フェーズ（蓄積期/上昇初期/過熱/分配期/底値圏）
2. Gems Top10テーブル（Alpha/Riskスコア + S〜Fランク + 根拠1行）
3. Warning Top5（リスク理由）
4. セクター全体アクションプラン
5. 末尾に必ずJSON出力：
\`\`\`json
{"sector":"","phase":"","fear_greed_value":0,"fear_greed_label":"","action_plan":"セクター全体の推奨アクションを1〜2行で","gems":[{"rank":1,"ticker":"","alpha":0,"risk":0,"grade":"","reason":""}],"warnings":[{"ticker":"","risk_reason":""}]}
\`\`\``;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system: "あなたは世界トップクラスの仮想通貨フォレンジック・アナリストです。提供データのみを根拠に客観的に分析せよ。",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as {type:"text";text:string}).text)
      .join("");
    return Response.json({ result: text });

  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof APIError) {
      const status = err.status ?? 500;
      const isCreditError = status === 402 || /credit|billing|balance|insufficient/i.test(message);
      if (isCreditError) {
        message =
          "💳 Anthropic APIのクレジット残高が不足しています。残高の確認・チャージ: https://console.anthropic.com/settings/billing";
      }
    }
    console.error("[sector] Unhandled error:", err);
    return Response.json({ error: "分析失敗", detail: message }, { status: 500 });
  }
}
