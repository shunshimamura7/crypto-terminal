import { NextRequest } from "next/server";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { researchCoin } from "@/app/lib/coinResearch";

export const runtime = "nodejs";
export const maxDuration = 120;

const COINGECKO_CATEGORY_MAP: Record<string, string> = {
  "AI":      "artificial-intelligence",
  "RWA":     "real-world-assets-rwa",
  "DeFi":    "decentralized-finance-defi",
  "GameFi":  "gaming",
  "DePIN":   "depin",
  "L1":      "layer-1",
  "L2":      "layer-2",
  "Meme":    "meme-token",
  "Privacy": "privacy-coins",
};

const SECTOR_DEFILLAMA_MAP: Record<string, string[]> = {
  "AI":      ["AI Agents", "Artificial Intelligence", "AI"],
  "RWA":     ["RWA", "Real World Assets"],
  "DeFi":    ["DEX", "Lending", "Yield Aggregator", "Derivatives", "DeFi"],
  "GameFi":  ["Gaming", "GameFi"],
  "DePIN":   ["DePIN"],
  "L1":      ["Layer 1", "Chain"],
  "L2":      ["Layer 2", "Rollup"],
  "Meme":    ["Meme"],
  "Privacy": ["Privacy"],
};

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCategoryCoins(categoryId: string): Promise<Array<{
  id: string; symbol: string; name: string;
  current_price: number; market_cap: number; total_volume: number;
  price_change_percentage_24h: number; price_change_percentage_7d_in_currency: number;
  ath: number;
}>> {
  const res = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${categoryId}&order=market_cap_desc&per_page=15&page=1&sparkline=false&price_change_percentage=7d`,
    8000
  );
  if (!res?.ok) return [];
  try { return await res.json(); } catch { return []; }
}

async function fetchDeFiLlama(sector: string): Promise<string> {
  try {
    const res = await fetchWithTimeout("https://api.llama.fi/protocols", 8000);
    if (!res?.ok) return "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocols: any[] = await res.json();
    const categories = SECTOR_DEFILLAMA_MAP[sector] || [sector];
    const matched = protocols
      .filter(p => categories.some(cat => p.category?.toLowerCase().includes(cat.toLowerCase())))
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 15)
      .map(p => `${p.name}(${p.symbol}): TVL ${fmtUsd(p.tvl)}, 7d: ${p.change_7d?.toFixed(1) ?? "N/A"}%`)
      .join("\n");
    return matched ? `【DeFiLlama ${sector}セクターTVLランキング】\n${matched}` : "";
  } catch { return ""; }
}

async function fetchFearGreed(): Promise<string> {
  try {
    const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", 4000);
    if (!res?.ok) return "";
    const json = await res.json();
    const d = json?.data?.[0];
    return d ? `Fear & Greed: ${d.value}/100 (${d.value_classification})` : "";
  } catch { return ""; }
}

export async function POST(req: NextRequest) {
  try {
    const { sector } = await req.json();
    if (!sector) return Response.json({ error: "sector required" }, { status: 400 });

    const categoryId = COINGECKO_CATEGORY_MAP[sector] ?? sector.toLowerCase();

    // Parallel: DeFiLlama + FearGreed + CoinGecko category coins
    const [defiLlamaContext, fearGreed, categoryCoins] = await Promise.all([
      fetchDeFiLlama(sector),
      fetchFearGreed(),
      fetchCategoryCoins(categoryId),
    ]);

    // Format category coins overview (top 15)
    const coinsOverview = categoryCoins.map(c => {
      const athDrop = c.ath > 0 ? ((c.ath - c.current_price) / c.ath * 100).toFixed(0) : "N/A";
      return `${c.symbol.toUpperCase()}(${c.name}): $${c.current_price}, MC:${fmtUsd(c.market_cap)}, Vol:${fmtUsd(c.total_volume)}, 24h:${c.price_change_percentage_24h?.toFixed(1)}%, 7d:${c.price_change_percentage_7d_in_currency?.toFixed(1)}%, ATH比:-${athDrop}%`;
    }).join("\n");

    // Deep research on top 10 coins with 500ms intervals
    const top10 = categoryCoins.slice(0, 10);
    const deepResearch: string[] = [];
    for (let i = 0; i < top10.length; i++) {
      if (i > 0) await sleep(500);
      const coin = top10[i];
      const research = await researchCoin(coin.symbol);
      deepResearch.push(`=== ${coin.symbol.toUpperCase()} ===\n${research}`);
    }
    const deepResearchContext = deepResearch.join("\n\n");

    const client = new Anthropic();
    const prompt = `セクター「${sector}」の包括的分析を実施せよ。

## DeFiLlamaデータ
${defiLlamaContext || "データなし"}

## CoinGeckoカテゴリTop15概要
${coinsOverview || "データなし（取得失敗）"}

## 上位10銘柄詳細調査データ
${deepResearchContext || "データなし"}

## マクロ指標
${fearGreed || "データなし"}

## 指示
以下を日本語で出力せよ：
1. セクター総合フェーズ（蓄積期/上昇初期/過熱/分配期/底値圏）
2. Gems Top10テーブル（Alpha/Riskスコア + S〜Fランク + 根拠1行）
3. Warning Top5（リスク理由）
4. セクター全体アクションプラン
5. 末尾に必ずJSON出力（プレースホルダーのまま出力するな・必ず実際の評価値を入れよ）：
\`\`\`json
{"sector":"${sector}","phase":"上昇初期","fear_greed_value":55,"fear_greed_label":"Greed","action_plan":"セクター全体の推奨アクションを1〜2行で","gems":[{"rank":1,"ticker":"SOL","alpha":80,"risk":30,"grade":"A","reason":"TVL急増・機関投資家流入"}],"warnings":[{"ticker":"XXX","risk_reason":"流動性不足"}]}
\`\`\``;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: "あなたは世界トップクラスの仮想通貨フォレンジック・アナリストです。提供データのみを根拠に客観的に分析せよ。",
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
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
