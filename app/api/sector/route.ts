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

### 1. セクター総合フェーズ
蓄積期/上昇初期/過熱/分配期/底値圏 から選択。判断基準：
- 蓄積期: セクターTVL横ばい or 微増、出来高低迷、F&G < 30
- 上昇初期: TVL増加トレンド、出来高増加、新規プロジェクト参入
- 過熱: TVL急増後の頭打ち、出来高急増、F&G > 70、ミームコイン乱立
- 分配期: TVL減少開始、大口の取引所流入増、出来高減少
- 底値圏: TVL大幅減、プロジェクト撤退・開発停止増、F&G < 20

### 2. Gems Top10テーブル
Alpha/Riskスコア + S〜Fランク + 根拠1行。

スコアリング定量アンカー（必ず参照）：

Alpha基準（0-100、ベースライン40）:
- MC/FDV > 0.8: +0 / 0.4-0.8: +10 / 0.2-0.4: +15 / <0.2: +5（希薄化相殺）
- ATH比 -90%+: +15 / -70%+: +10 / -50%+: +5
- 出来高トレンド7d増加: +5 / 減少: -5
- TVL成長30d > 20%: +10 / > 10%: +5
- セクター内シェア拡大中: +5
- 開発活動活発（GitHub更新頻繁）: +5

Risk基準（0-100、ベースライン40）:
- MC/FDV < 0.2: +20 / 0.2-0.4: +10 / > 0.8: -5
- Vol/MC < 3%: +10（流動性不足）/ > 50%: +8（Wash疑い）
- 30日以内アンロック10%+: +20 / 5%+: +10
- 監査なし or セキュリティ問題: +10
- 7d変動 +100%以上: +10（過熱）
- ホルダー集中度 Top10 > 50%: +10（推定可能な場合）

ランク判定（Alpha/Riskから機械的に決定）:
S = Alpha≥85 かつ Risk≤35
A = Alpha≥70 かつ Risk≤50
B = Alpha≥55 かつ Risk≤60
C = Alpha≥40
D = Alpha<40 かつ Risk<50
E = Risk>70
F = Risk>85 またはScam疑い

重要: データ不足時はベースライン値40を使え。推測で極端な値（90や10）を出すな。各銘柄のMC/FDV比・Vol/MC比はCoinGeckoデータから計算して必ずスコアに反映せよ。

### 3. Warning Top5
リスク理由を具体的に。以下のいずれかに該当する銘柄を優先：
- MC/FDV < 0.2（深刻な希薄化リスク）
- Vol/MC > 50%（Wash Trading疑い）
- 30日以内に大型アンロック
- TVL急減（30d -20%以上）
- 開発活動停止（GitHub 90日以上更新なし）
- セキュリティインシデント歴

### 4. セクター全体アクションプラン
具体的な推奨アクション。ロング/ショート/様子見の判断根拠を含む。

### 5. ショート候補（該当あれば）
セクター内でショート候補になり得る銘柄があれば、理由とともに記載。
MEXC先物で取引可能かどうかも考慮。

### 6. ホルダー分析サマリー
セクター上位銘柄のホルダー構造を俯瞰：
- セクター全体のホルダー集中傾向（分散的 or 寡占的）
- 機関投資家/VCの参入度合い
- インサイダーリスクが高い銘柄の特定
- 上位10ウォレット保有率が50%超の銘柄をリストアップ（データから判断できる範囲で）

7. 末尾に必ずJSON出力（プレースホルダーのまま出力するな・必ず実際の評価値を入れよ）：
\`\`\`json
{"sector":"${sector}","phase":"上昇初期","fear_greed_value":55,"fear_greed_label":"Greed","action_plan":"セクター全体の推奨アクションを1〜2行で","short_candidates":["銘柄:理由"],"holder_concentration":"分散的|やや寡占|寡占的","high_concentration_tickers":["MC/FDV<0.2やTop10>50%の銘柄"],"gems":[{"rank":1,"ticker":"SOL","alpha":80,"risk":30,"grade":"A","reason":"TVL急増・機関投資家流入","mc_fdv_ratio":0.85,"vol_mc_ratio":0.15}],"warnings":[{"ticker":"XXX","risk_reason":"流動性不足","risk_score":75}]}
\`\`\``;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: "あなたは世界トップクラスの仮想通貨フォレンジック・アナリストです。提供データのみを根拠に客観的に分析せよ。スコアリングは定量アンカーに厳密に従い、データ不足時はベースライン値40を使用。推測で極端なスコアを出すな。各銘柄のMC/FDV比はCoinGeckoデータから必ず計算してスコアに反映せよ。",
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
