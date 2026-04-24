import Anthropic from "@anthropic-ai/sdk";

// ── Env ────────────────────────────────────────────────────────────────────
interface Env {
  ANTHROPIC_API_KEY: string;
}

// ── CORS ───────────────────────────────────────────────────────────────────
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (origin === "https://bell-crypto-terminal.vercel.app" || /\.vercel\.app$/.test(origin))
      ? origin
      : "https://bell-crypto-terminal.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// ── Rate limiting ──────────────────────────────────────────────────────────
const DAILY_LIMIT = 20;
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

// ── Coin name map ──────────────────────────────────────────────────────────
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
    const pair = (json as { pairs?: { chainId: string }[] })?.pairs?.[0];
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
    const json = await res.json() as { result?: Record<string, Record<string, unknown>> };
    const data = json?.result?.[address.toLowerCase()] || json?.result?.[address];
    if (!data) return "GoPlus: データなし";

    const flags: string[] = [];
    if (data.is_mintable === "1")             flags.push("⚠️ Mint権限あり");
    if (data.is_honeypot === "1")             flags.push("🚨 ハニーポット検出");
    if (data.is_blacklisted === "1")          flags.push("⚠️ ブラックリスト機能あり");
    if (data.is_proxy === "1")                flags.push("⚠️ プロキシコントラクト");
    if (data.can_take_back_ownership === "1") flags.push("🚨 Owner権限奪還可能");
    if (parseFloat(data.buy_tax  as string || "0") > 10) flags.push(`⚠️ 買いTax: ${data.buy_tax}%`);
    if (parseFloat(data.sell_tax as string || "0") > 10) flags.push(`⚠️ 売りTax: ${data.sell_tax}%`);
    if (data.is_open_source === "0")          flags.push("⚠️ ソース非公開");

    const ownerPct   = parseFloat(data.owner_percent   as string || "0") * 100;
    const creatorPct = parseFloat(data.creator_percent as string || "0") * 100;
    const lpLocked   = (data.lp_holders as { is_locked?: number }[])?.some(h => h.is_locked === 1);

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
    const protocols = await res.json() as { name: string; slug: string; symbol: string; tvl?: number; change_7d?: number; change_1m?: number; chains?: string[]; category?: string }[];
    const lq = query.toLowerCase();
    const found = protocols.find(p =>
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
    const json = await res.json() as { data?: { value: string; value_classification: string }[] };
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

  const rankM =
    text.match(/(?:総合ランク|ランク|rank|grade|評価)[^\w\n：:]{0,5}[：:\s]\s*\*{0,2}([SABCDEF][+-]?)\*{0,2}/i) ||
    text.match(/\*{0,2}([SABCDEF])\s*(?:ランク|rank|grade)\*{0,2}/i) ||
    text.match(/(?:判定|結果)[：:\s]+\s*\*{0,2}([SABCDEF])\b/i);
  if (rankM) result.rank = rankM[1].toUpperCase();

  const alphaM =
    text.match(/(?:alpha(?:[_\s]score)?(?:[_\s]100)?|アルファ(?:[スコア]{0,4}))[^\d\n]{0,20}(\d{1,3})\s*(?:\/\s*100)?/i);
  if (alphaM) {
    const v = parseInt(alphaM[1]);
    if (v >= 0 && v <= 100) result.alpha_score_100 = v;
  }

  const riskM =
    text.match(/(?:risk(?:[_\s]score)?(?:[_\s]100)?|リスク(?:[スコア]{0,4}))[^\d\n]{0,20}(\d{1,3})\s*(?:\/\s*100)?/i);
  if (riskM) {
    const v = parseInt(riskM[1]);
    if (v >= 0 && v <= 100) result.risk_score_100 = v;
  }

  const decM = text.match(/(?:投資判断|投資推奨|判断|recommendation)[：:\s]+[「『]?([^」』\n]{2,15})[」』]?/i);
  if (decM) result.investment_decision = decM[1].trim();

  const slM = text.match(/(?:損切り|stop.?loss|SL)[^\d\n-]{0,10}-(\d{1,2}(?:\.\d)?)\s*%/i);
  if (slM) result.stop_loss_pct = -Math.abs(parseFloat(slM[1]));

  if (!result.rank && result.alpha_score_100 == null && result.risk_score_100 == null) return null;
  return result;
}

// ── System prompt ──────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `## データアクセスマトリクス
[実測]ラベル = CoinGecko/DeFiLlama/GoPlus/DEXScreener/Binance Futures API/Fear&Greedで直接確認できたデータ。
[推定]ラベル = 間接データからの推論、算出根拠を1行明記。
[要確認]ラベル = Nansen/Arkham/Bubble Maps/Coinglass/Token Unlocks/LunarCrush/GitHub/Dune等の取得不可データ、確認先URL必須。
取得不可データを根拠にする場合は必ず[要確認]と確認先URLを付記。

---

You are ベル, a professional cryptocurrency research analyst. When asked about a cryptocurrency, use web_search to gather the latest information and respond in Japanese with these exact five sections.

Use web_search multiple times to gather accurate, up-to-date data for each section.

## 🐋 スマートマネー & ホエール動向
Search Arkham Intelligence, Whale Alert, and crypto news for: large wallet movements in the last 7 days, exchange inflows/outflows, institutional buying/selling, notable on-chain activity. Include specific USD amounts and wallet addresses if available.

## 🔓 トークンアンロック スケジュール
Search TokenUnlocks.app, Tokenomist, and project documentation for: upcoming vesting unlocks (next 30-90 days), cliff events, total unlock amounts, percentage of circulating supply, and potential sell pressure impact.

## 🔵 ホルダー分散 & 上位ウォレット
Search Bubblemaps, Etherscan, Solscan, or blockchain explorer for: top 10 holder percentages, wallet concentration risk, any suspicious clustering, insider wallet activity, and decentralization score.

## 🗣️ 著名人・インフルエンサーの最新発言
Search Twitter/X and crypto news for recent statements (last 30 days) by: Elon Musk, Vitalik Buterin, CZ (Changpeng Zhao), Michael Saylor, Brian Armstrong, and other major crypto influencers or the project founders.

## 💼 VC・機関投資家の動向
Search for: recent funding rounds, a16z/Andreessen Horowitz, Paradigm, Multicoin Capital, Pantera Capital, Jump Crypto, Coinbase Ventures holdings or investments. Include investment amounts and dates.

---

## 動的Pillar優先度
9 Pillars全部埋めるな。銘柄フェーズで3〜4に集中:
- 新規上場72h以内 → トークノミクス + セキュリティ + 操作検出
- ポンプ中(7d +50%以上) → 操作検出 + デリバティブ + RAVE判定
- 下落中(30d -30%以上) → セクター + ホルダー + 下落時行動
- 長期候補(MC>500M) → セクター + トークノミクス + 開発活動

## Steel-Man Check
Buy推奨に傾いたら、Strong Shortと判断する人の根拠3つを自問。無視できないもの1つでもあれば推奨1段階下げ。Short推奨も逆方向で同様。結果を🌑シャドウの反論として出力に含める。

## 3段階出力
デフォルトはLevel1即答: ランク+推奨+自信度+決め手3つ+シャドウの反論1行。
ユーザーが「詳しく」でLevel2(9Pillars展開)、「JSON」でLevel3。

---

Rules:
- Always respond in Japanese
- Include specific numbers, dates, and source names
- Label each data point: [実測] / [推定] / [要確認]
- If information is not found, write "（最新情報なし）" for that item
- Be concise but include actionable insights
- Cite data sources (e.g., "出典: Whale Alert", "出典: TokenUnlocks")
- Always end with 🌑シャドウの反論`;

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
  "bear_price": 30
}
\`\`\`

上記はフォーマット例。実際の分析結果に基づいた数値・文字列に置き換えること。

ランク判定基準（必ず守れ）:
S = Alpha≥85 かつ Risk≤35
A = Alpha≥70 かつ Risk≤50
B = Alpha≥55 かつ Risk≤60
C = Alpha≥40
D = Alpha<40 かつ Risk<50
E = Risk>70
F = Risk>85 またはScam疑い

重要: 必ずレスポンスの最後にJSONブロックを出力すること。JSONブロックは必ず完結させること。途中で切れないよう、テキスト分析は簡潔にまとめてJSONのためのトークンを残すこと。`;

function buildSystemPrompt(
  goPlusData: string = "",
  defiLlamaData: string = "",
  fearGreedData: string = "",
): string {
  const extras = [
    goPlusData    ? `\n## セキュリティスキャン（GoPlus）\n${goPlusData}`  : "",
    defiLlamaData ? `\n## TVLデータ（DeFiLlama）\n${defiLlamaData}`      : "",
    fearGreedData ? `\n## マクロ指標\n${fearGreedData}`                   : "",
  ].filter(Boolean).join("\n");
  return extras
    ? `${BASE_SYSTEM_PROMPT}\n${extras}${JSON_OUTPUT_RULE}`
    : `${BASE_SYSTEM_PROMPT}${JSON_OUTPUT_RULE}`;
}

// ── Worker entry point ─────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY が設定されていません。" },
        { status: 500, headers: cors },
      );
    }

    let query: string;
    try {
      const body = await request.json() as { query?: string };
      query = (body.query ?? "").trim();
      if (!query) throw new Error("query is required");
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
    }

    const ip = request.headers.get("cf-connecting-ip") ??
               request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
               "unknown";
    const remaining = checkRateLimit(ip);
    if (remaining < 0) {
      return Response.json(
        { error: "本日の分析上限（20回）に達しました。明日またお試しください。" },
        { status: 429, headers: cors },
      );
    }

    const coinName   = getEnglishName(query);
    const isContract = isContractAddress(query);

    const [goPlusData, defiLlamaData, fearGreedData] = await Promise.all([
      isContract ? fetchGoPlusSecurity(query) : Promise.resolve(""),
      fetchDeFiLlamaProtocol(query),
      fetchFearGreedIndex(),
    ]);

    const systemPrompt = buildSystemPrompt(goPlusData, defiLlamaData, fearGreedData);

    const userMessage = isContract
      ? `コントラクトアドレス「${query}」について、web_searchで重要な情報を最大1回検索し、全セクションを簡潔に日本語で報告してください。`
      : `「${coinName}」（入力: "${query}"）について、web_searchで重要な情報を最大1回検索し、全セクションを簡潔に日本語で報告してください。`;

    const encoder = new TextEncoder();
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
          const MAX_ITERATIONS = 3;
          let fullText = "";

          for (let i = 0; i < MAX_ITERATIONS; i++) {
            const msgStream = client.messages.stream({
              model: "claude-sonnet-4-6",
              max_tokens: 2500,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 } as any],
              messages,
            });

            const response = await msgStream
              .on("text", (text) => {
                fullText += text;
                try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ }
              })
              .finalMessage();

            if (response.stop_reason === "end_turn") break;

            if (response.stop_reason === "pause_turn" || response.stop_reason === "tool_use") {
              messages.push({ role: "assistant", content: response.content });
              if (response.stop_reason === "pause_turn") continue;
            } else {
              break;
            }
          }

          // Fallback: if AI didn't output a JSON block, extract via regex and append one
          const hasJsonBlock = /```json[\s\S]*?```/.test(fullText);
          console.log(`[chat] fullText.length=${fullText.length} hasJsonBlock=${hasJsonBlock}`);
          if (!hasJsonBlock && fullText.trim()) {
            const fallback = extractScoreRegex(fullText, coinName || query);
            console.log(`[chat] extractScoreRegex result=`, JSON.stringify(fallback));
            if (fallback) {
              const block = `\n\`\`\`json\n${JSON.stringify(fallback, null, 2)}\n\`\`\``;
              try { controller.enqueue(encoder.encode(block)); } catch { /* closed */ }
            }
          }
        } catch (err) {
          let msg = err instanceof Error ? err.message : "不明なエラー";
          if (err instanceof Anthropic.APIError) {
            const isCreditError = err.status === 402 || /credit|billing|balance|insufficient/i.test(msg);
            if (isCreditError) {
              msg = "💳 Anthropic APIのクレジット残高が不足しています。残高の確認・チャージ: https://console.anthropic.com/settings/billing";
            }
          }
          try { controller.enqueue(encoder.encode(`\n\n⚠️ エラー: ${msg}`)); } catch { /* closed */ }
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...cors,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
