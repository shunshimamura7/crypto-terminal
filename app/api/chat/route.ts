import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { BASE_SYSTEM_PROMPT } from "@/app/lib/systemPrompts/bell_v5";
import { researchCoin } from "@/app/lib/coinResearch";
import { fetchCoinglassData } from "@/app/lib/derivativesData";
import type { CoinglassData } from "@/app/lib/derivativesData";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAILY_LIMIT = 20;

// ── Rate limiting ──────────────────────────────────────────────────────────
interface RateLimitEntry { count: number; dateJST: string; }
const rateLimitMap = new Map<string, RateLimitEntry>();
function getDateJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
function checkRateLimit(ip: string): number {
  const today = getDateJST();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.dateJST !== today) {
    rateLimitMap.set(ip, { count: 1, dateJST: today });
    return DAILY_LIMIT - 1;
  }
  if (entry.count >= DAILY_LIMIT) return -1;
  entry.count++;
  return DAILY_LIMIT - entry.count;
}

// ── Coin name map (from 074bcd2) ───────────────────────────────────────────
const COIN_NAME_MAP: Record<string, string> = {
  ビットコイン: "Bitcoin",      btc: "Bitcoin",        bitcoin: "Bitcoin",
  イーサリアム: "Ethereum",     eth: "Ethereum",       ethereum: "Ethereum",
  ソラナ: "Solana",             sol: "Solana",         solana: "Solana",
  リップル: "Ripple/XRP",       xrp: "Ripple/XRP",     ripple: "Ripple/XRP",
  バイナンスコイン: "BNB/Binance Coin", bnb: "BNB/Binance Coin",
  ドージコイン: "Dogecoin",     doge: "Dogecoin",      dogecoin: "Dogecoin",
  ポリゴン: "Polygon/MATIC",    matic: "Polygon/MATIC", polygon: "Polygon/MATIC",
  アバランチ: "Avalanche",      avax: "Avalanche",     avalanche: "Avalanche",
  チェーンリンク: "Chainlink",  link: "Chainlink",     chainlink: "Chainlink",
  ユニスワップ: "Uniswap",      uni: "Uniswap",        uniswap: "Uniswap",
  シバイヌ: "Shiba Inu",        shib: "Shiba Inu",
  カルダノ: "Cardano",          ada: "Cardano",        cardano: "Cardano",
  ポルカドット: "Polkadot",     dot: "Polkadot",       polkadot: "Polkadot",
  コスモス: "Cosmos/ATOM",      atom: "Cosmos/ATOM",   cosmos: "Cosmos/ATOM",
  ニア: "NEAR Protocol",        near: "NEAR Protocol",
  アービトラム: "Arbitrum",     arb: "Arbitrum",       arbitrum: "Arbitrum",
  オプティミズム: "Optimism",   op: "Optimism",        optimism: "Optimism",
  スイ: "Sui",                  sui: "Sui",
  アプトス: "Aptos",            apt: "Aptos",          aptos: "Aptos",
  pepe: "Pepe (PEPE)",          trump: "Official Trump (TRUMP)",
  wif: "dogwifhat (WIF)",       bonk: "Bonk (BONK)",
  ltc: "Litecoin",              litecoin: "Litecoin",  ライトコイン: "Litecoin",
  inj: "Injective",             injective: "Injective",
};

function getEnglishName(query: string): string {
  return COIN_NAME_MAP[query.toLowerCase().trim()] ?? query;
}

// ── Address helpers ────────────────────────────────────────────────────────
function isEvmAddress(q: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(q.trim());
}
function isSolanaAddress(q: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim()) && !isEvmAddress(q.trim());
}
function isContractAddress(q: string): boolean {
  return isEvmAddress(q) || isSolanaAddress(q);
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, timeout = 4000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

async function detectChain(address: string): Promise<string> {
  const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${address}`, 5000);
  if (!res || !res.ok) return "1";
  try {
    const json = await res.json();
    const pair = json?.pairs?.[0];
    if (!pair) return "1";
    const MAP: Record<string, string> = {
      ethereum: "1", bsc: "56", polygon: "137",
      arbitrum: "42161", optimism: "10", avalanche: "43114", base: "8453",
    };
    return MAP[pair.chainId] ?? "1";
  } catch { return "1"; }
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

// ── GoPlus Security ────────────────────────────────────────────────────────
async function fetchGoPlusSecurity(address: string): Promise<string> {
  let url: string;
  if (isEvmAddress(address)) {
    const chainId = await detectChain(address);
    url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
  } else if (isSolanaAddress(address)) {
    url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
  } else {
    return "GoPlus: このチェーンは非対応";
  }

  const res = await fetchWithTimeout(url, 5000);
  if (!res || !res.ok) return "GoPlus: データ取得失敗";
  try {
    const json = await res.json();
    const data = json?.result?.[address.toLowerCase()] || json?.result?.[address];
    if (!data) return "GoPlus: データなし";

    const flags: string[] = [];
    if (data.is_mintable === "1")             flags.push("⚠️ Mint権限あり");
    if (data.is_honeypot === "1")             flags.push("🚨 ハニーポット検出");
    if (data.is_blacklisted === "1")          flags.push("⚠️ ブラックリスト機能あり");
    if (data.is_proxy === "1")                flags.push("⚠️ プロキシコントラクト");
    if (data.can_take_back_ownership === "1") flags.push("🚨 Owner権限奪還可能");
    if (parseFloat(data.buy_tax  || "0") > 10) flags.push(`⚠️ 買いTax: ${data.buy_tax}%`);
    if (parseFloat(data.sell_tax || "0") > 10) flags.push(`⚠️ 売りTax: ${data.sell_tax}%`);
    if (data.is_open_source === "0")          flags.push("⚠️ ソース非公開");

    const ownerPct   = parseFloat(data.owner_percent   || "0") * 100;
    const creatorPct = parseFloat(data.creator_percent || "0") * 100;
    const lpLocked   = data.lp_holders?.some((h: { is_locked?: number }) => h.is_locked === 1);

    return [
      "【GoPlus セキュリティスキャン】",
      flags.length > 0 ? flags.join(" / ") : "✅ 主要リスクなし",
      `Owner保有率: ${ownerPct.toFixed(2)}% / Creator保有率: ${creatorPct.toFixed(2)}%`,
      `LP状況: ${lpLocked ? "✅ ロック済み" : "⚠️ ロックなし"}`,
    ].join("\n");
  } catch {
    return "GoPlus: パース失敗";
  }
}

// ── DeFiLlama ─────────────────────────────────────────────────────────────
async function fetchDeFiLlamaProtocol(query: string): Promise<string> {
  const res = await fetchWithTimeout("https://api.llama.fi/protocols", 5000);
  if (!res || !res.ok) return "DeFiLlama: データ取得失敗";
  try {
    const protocols = await res.json();
    const lq = query.toLowerCase();
    const found = protocols.find((p: { name: string; slug: string; symbol: string }) =>
      p.name?.toLowerCase().includes(lq) ||
      p.slug?.toLowerCase().includes(lq) ||
      p.symbol?.toLowerCase() === lq
    );
    if (!found) return "DeFiLlama: プロトコルデータなし";
    const tvl  = found.tvl ?? 0;
    const ch7d = found.change_7d ?? null;
    const ch1m = found.change_1m ?? null;
    const chains = (found.chains || []).slice(0, 3).join(", ");
    return [
      "【DeFiLlama TVLデータ】",
      `TVL: ${fmtUsd(tvl)}`,
      ch7d != null ? `7日変化: ${ch7d > 0 ? "+" : ""}${ch7d.toFixed(1)}%` : "",
      ch1m != null ? `30日変化: ${ch1m > 0 ? "+" : ""}${ch1m.toFixed(1)}%` : "",
      chains ? `主要チェーン: ${chains}` : "",
      found.category ? `カテゴリ: ${found.category}` : "",
    ].filter(Boolean).join("\n");
  } catch {
    return "DeFiLlama: パース失敗";
  }
}

// ── Fear & Greed Index ─────────────────────────────────────────────────────
async function fetchFearGreedIndex(): Promise<string> {
  const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", 3000);
  if (!res || !res.ok) return "";
  try {
    const json = await res.json();
    const d = json?.data?.[0];
    if (!d) return "";
    const emoji =
      Number(d.value) >= 75 ? "🤑" :
      Number(d.value) >= 55 ? "😊" :
      Number(d.value) >= 45 ? "😐" :
      Number(d.value) >= 25 ? "😨" : "😱";
    return `Fear & Greed Index: ${d.value}/100 ${emoji} (${d.value_classification})`;
  } catch {
    return "";
  }
}

// ── Score fallback extraction (regex) ─────────────────────────────────────
function extractScoreRegex(text: string, ticker: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = { ticker_ca: ticker };

  // rank: 総合ランク：A / ランク: B / Rank: S / 評価：C など
  const rankM =
    text.match(/(?:総合ランク|ランク|rank|grade|評価)[^\w\n：:]{0,5}[：:\s]\s*\*{0,2}([SABCDEF][+-]?)\*{0,2}/i) ||
    text.match(/\*{0,2}([SABCDEF])\s*(?:ランク|rank|grade)\*{0,2}/i) ||
    text.match(/(?:判定|結果)[：:\s]+\s*\*{0,2}([SABCDEF])\b/i);
  if (rankM) result.rank = rankM[1].toUpperCase();

  // alpha_score_100: Alpha Score: 72/100 / アルファスコア: 72 など
  const alphaM =
    text.match(/(?:alpha(?:[_\s]score)?(?:[_\s]100)?|アルファ(?:[スコア]{0,4}))[^\d\n]{0,20}(\d{1,3})\s*(?:\/\s*100)?/i);
  if (alphaM) {
    const v = parseInt(alphaM[1]);
    if (v >= 0 && v <= 100) result.alpha_score_100 = v;
  }

  // risk_score_100: Risk Score: 45/100 / リスクスコア: 55 など
  const riskM =
    text.match(/(?:risk(?:[_\s]score)?(?:[_\s]100)?|リスク(?:[スコア]{0,4}))[^\d\n]{0,20}(\d{1,3})\s*(?:\/\s*100)?/i);
  if (riskM) {
    const v = parseInt(riskM[1]);
    if (v >= 0 && v <= 100) result.risk_score_100 = v;
  }

  // investment_decision
  const decM = text.match(/(?:投資判断|投資推奨|判断|recommendation)[：:\s]+[「『]?([^」』\n]{2,15})[」』]?/i);
  if (decM) result.investment_decision = decM[1].trim();

  // stop_loss_pct
  const slM = text.match(/(?:損切り|stop.?loss|SL)[^\d\n-]{0,10}-(\d{1,2}(?:\.\d)?)\s*%/i);
  if (slM) result.stop_loss_pct = -Math.abs(parseFloat(slM[1]));

  if (!result.rank && result.alpha_score_100 == null && result.risk_score_100 == null) return null;
  return result;
}

// ── Stablecoin Market Cap ──────────────────────────────────────────────────
async function fetchStablecoinMarketCap(): Promise<string> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=5&page=1",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return "";
    const coins = await res.json();
    const totalMC = coins.reduce((sum: number, c: { market_cap?: number }) => sum + (c.market_cap ?? 0), 0);
    return totalMC > 0 ? `ステーブルコイン上位5 MC合計: $${(totalMC / 1e9).toFixed(1)}B` : "";
  } catch { return ""; }
}

// ── System prompt ──────────────────────────────────────────────────────────
// BASE_SYSTEM_PROMPT は app/lib/systemPrompts/bell_v5.ts からインポート

// JSON rule is always appended LAST so the model outputs it at the very end
const JSON_OUTPUT_RULE = `

## 【必須】最終JSON出力
分析完了後、必ず以下のJSON形式で実際の評価値を入れて出力せよ。絶対に省略するな。プレースホルダーのまま出力するな。

\`\`\`json
{
  "ticker_ca": "銘柄名",
  "rank": "A",
  "risk_score_100": 45,
  "alpha_score_100": 72,
  "manipulation_risk_score_100": 30,
  "smart_money_score_100": 65,
  "community_score_100": 55,
  "investment_decision": "推奨",
  "stop_loss_pct": -15,
  "stop_loss_price": 34.50,
  "entry_guidance": "$38〜$42",
  "profit_target_trigger": "$55（+30%）",
  "stop_loss_trigger": "$34以下で確定足",
  "recommended_position_size": "5%",
  "bull_price": 80,
  "base_price": 55,
  "bear_price": 30,
  "data_confidence": {
    "measured": 5,
    "estimated": 3,
    "needs_verification": 2
  }
}
\`\`\`

上記はフォーマット例。実際の分析結果に基づいた数値・文字列に置き換えること。

data_confidence の算出方法:
- measured: レポート内で [実測] ラベルを付けた項目数
- estimated: [推定] ラベルを付けた項目数
- needs_verification: [要確認] ラベルを付けた項目数
必ず実際にカウントして入力せよ。適当な数を入れるな。

スコアリング定量アンカー（必ず参照）:

Alpha基準:
- MC/FDV > 0.8: +0（全流通済み）
- MC/FDV 0.4-0.8: +10（適度な成長余地）
- MC/FDV 0.2-0.4: +15（成長余地大だが希薄化注意）
- MC/FDV < 0.2: +5（希薄化リスクが成長余地を相殺）
- ATH比 -90%+: +15 / -70%+: +10 / -50%+: +5
- ベースライン: 40（特筆事項なし）

Risk基準:
- MC/FDV < 0.2: +20（深刻な希薄化）
- FR > 0.1%/8h: +15
- ロング比率 > 70%: +10
- 30日以内アンロック10%+: +20 / 5%+: +10
- Vol/MC < 3%: +10（流動性不足）
- 監査なし: +10
- ベースライン: 40（特筆事項なし）

重要: データ不足時はベースライン値40を使え。推測で極端な値（90や10）を出すな。

ランク判定基準（必ず守れ）:
S = Alpha≥85 かつ Risk≤35
A = Alpha≥70 かつ Risk≤50
B = Alpha≥55 かつ Risk≤60
C = Alpha≥40
D = Alpha<40 かつ Risk<50
E = Risk>70
F = Risk>85 またはScam疑い

重要: 必ずレスポンスの最後にJSONブロックを出力すること。JSONブロックは必ず完結させること。途中で切れないよう、テキスト分析は簡潔にまとめてJSONのためのトークンを残すこと。

分析テキストは各セクション2-3行に絞って簡潔にすること。JSONブロックの生成を最優先にすること。テキストが長くなりそうな場合は省略してJSONを必ず出力すること。

web_searchを最大1回使用して最新情報を収集し、必ず最後にJSONブロックを出力すること。`;

function buildSystemPrompt(
  goPlusData: string = "",
  defiLlamaData: string = "",
  fearGreedData: string = "",
  coinResearchData: string = "",
  coinglassData: CoinglassData | null = null,
  stableMcData: string = "",
): string {
  const glassParts: string[] = [];
  if (coinglassData) {
    if (coinglassData.fundingRate !== null)
      glassParts.push(`FR: ${(coinglassData.fundingRate * 100).toFixed(4)}%/8h`);
    if (coinglassData.openInterest !== null)
      glassParts.push(`OI: ${(coinglassData.openInterest / 1e6).toFixed(1)}M`);
    if (coinglassData.longRatio !== null) {
      const longPct = coinglassData.longRatio > 1 ? coinglassData.longRatio : coinglassData.longRatio * 100;
      glassParts.push(`Long比率: ${longPct.toFixed(1)}%`);
    }
  }
  const extras = [
    goPlusData       ? `\n## セキュリティスキャン（GoPlus）\n${goPlusData}`             : "",
    defiLlamaData    ? `\n## TVLデータ（DeFiLlama）\n${defiLlamaData}`                 : "",
    fearGreedData    ? `\n## マクロ指標\n${fearGreedData}`                              : "",
    coinResearchData ? `\n## 銘柄基本データ（CoinGecko/DexScreener）\n${coinResearchData}` : "",
    glassParts.length > 0 ? `\n## デリバティブデータ（Coinglass）\n${glassParts.join(", ")}` : "",
    stableMcData     ? `\n## ステーブルコイン市場\n${stableMcData}`                     : "",
  ].filter(Boolean).join("\n");
  // extras go BEFORE JSON_OUTPUT_RULE so the JSON instruction is always last
  return extras
    ? `${BASE_SYSTEM_PROMPT}\n${extras}${JSON_OUTPUT_RULE}`
    : `${BASE_SYSTEM_PROMPT}${JSON_OUTPUT_RULE}`;
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY が設定されていません。Vercelの環境変数を確認してください。" },
      { status: 500 }
    );
  }

  let query: string;
  try {
    const body = await request.json();
    query = (body.query ?? "").trim();
    if (!query) throw new Error("query is required");
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const remaining = checkRateLimit(ip);
  if (remaining < 0) {
    return Response.json(
      { error: "本日の分析上限（20回）に達しました。明日またお試しください。" },
      { status: 429 }
    );
  }

  const coinName   = getEnglishName(query);
  const isContract = isContractAddress(query);

  // 6つのAPIを並列取得
  const [goPlusData, defiLlamaData, fearGreedData, coinResearchData, coinglassData, stableMcData] = await Promise.all([
    isContract ? fetchGoPlusSecurity(query) : Promise.resolve(""),
    fetchDeFiLlamaProtocol(query),
    fetchFearGreedIndex(),
    researchCoin(query).catch(() => ""),
    !isContract ? fetchCoinglassData(query).catch(() => null) : Promise.resolve(null),
    fetchStablecoinMarketCap(),
  ]);

  const systemPrompt = buildSystemPrompt(goPlusData, defiLlamaData, fearGreedData, coinResearchData, coinglassData, stableMcData);

  const userMessage = isContract
    ? `コントラクトアドレス「${query}」について、web_searchで重要な情報を最大1回検索し、全セクションを簡潔に日本語で報告してください。`
    : `「${coinName}」（入力: "${query}"）について、web_searchで重要な情報を最大1回検索し、全セクションを簡潔に日本語で報告してください。`;

  const encoder = new TextEncoder();
  // 1行目: JSONメタデータ（UIが dataSources / coin / remainingCount を読む）
  const metaLine = JSON.stringify({
    dataSources: [],
    coin: null,
    remainingCount: remaining,
    dailyLimit: DAILY_LIMIT,
  }) + "\n";

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(metaLine));

      try {
        const client = new Anthropic({
          apiKey,
          defaultHeaders: { "anthropic-beta": "prompt-caching-2024-07-31" },
        });

        const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
        let fullText = "";

        await client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 6000,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 } as any],
          messages,
        })
          .on("text", (text) => {
            fullText += text;
            try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ }
          })
          .finalMessage();

        // Fallback: if the AI didn't output a JSON block, extract scores via regex
        // and append a properly-formatted block that the client's extractJson will find.
        // stripJson on the client removes it from the display automatically.
        const hasJsonBlock = /```json[\s\S]*?```/.test(fullText);
        console.log(`[chat] fullText.length=${fullText.length} hasJsonBlock=${hasJsonBlock}`);
        console.log(`[chat] fullText[:500]=${fullText.slice(0, 500)}`);
        if (!hasJsonBlock && fullText.trim()) {
          const fallback = extractScoreRegex(fullText, coinName || query);
          console.log(`[chat] extractScoreRegex result=`, JSON.stringify(fallback));
          if (fallback) {
            const block = `\n\`\`\`json\n${JSON.stringify(fallback, null, 2)}\n\`\`\``;
            console.log(`[chat] appending fallback block`);
            try { controller.enqueue(encoder.encode(block)); } catch { /* closed */ }
          }
        }
      } catch (err) {
        let msg = err instanceof Error ? err.message : "不明なエラー";
        if (err instanceof APIError) {
          const isCreditError = err.status === 402 || /credit|billing|balance|insufficient/i.test(msg);
          if (isCreditError) {
            msg = "💳 Anthropic APIのクレジット残高が不足しています。残高の確認・チャージ: https://console.anthropic.com/settings/billing";
          }
        }
        if (/timeout|abort|FUNCTION_INVOCATION_TIMEOUT/i.test(msg)) {
          msg = "⏱️ 分析時間が上限に達しました。上記は途中までの結果です。";
        }
        try { controller.enqueue(encoder.encode(`\n\n⚠️ エラー: ${msg}`)); } catch { /* closed */ }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
