import { NextRequest } from "next/server";
import { createHmac } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel function timeout in seconds

// ---- Types ----------------------------------------------------------------

interface LineTextMessage {
  type: "text";
  id: string;
  text: string;
}

interface LineMessageEvent {
  type: "message";
  replyToken: string;
  message: LineTextMessage | { type: string };
}

interface LineWebhookBody {
  destination: string;
  events: (LineMessageEvent | { type: string })[];
}

// ---- Coin name → CoinGecko ID map ----------------------------------------

const COIN_ALIASES: Record<string, string> = {
  ビットコイン: "bitcoin",   btc: "bitcoin",       bitcoin: "bitcoin",
  イーサリアム: "ethereum",  eth: "ethereum",      ethereum: "ethereum",
  ソラナ: "solana",          sol: "solana",         solana: "solana",
  リップル: "ripple",        xrp: "ripple",         ripple: "ripple",
  バイナンスコイン: "binancecoin", bnb: "binancecoin",
  ドージコイン: "dogecoin",  doge: "dogecoin",      dogecoin: "dogecoin",
  ポリゴン: "matic-network", matic: "matic-network", polygon: "matic-network",
  アバランチ: "avalanche-2", avax: "avalanche-2",   avalanche: "avalanche-2",
  チェーンリンク: "chainlink", link: "chainlink",   chainlink: "chainlink",
  ユニスワップ: "uniswap",   uni: "uniswap",        uniswap: "uniswap",
  シバイヌ: "shiba-inu",     shib: "shiba-inu",
  カルダノ: "cardano",       ada: "cardano",        cardano: "cardano",
  ポルカドット: "polkadot",  dot: "polkadot",       polkadot: "polkadot",
  コスモス: "cosmos",        atom: "cosmos",        cosmos: "cosmos",
  ニア: "near",              near: "near",
  アービトラム: "arbitrum",  arb: "arbitrum",       arbitrum: "arbitrum",
  オプティミズム: "optimism", op: "optimism",       optimism: "optimism",
  スイ: "sui",               sui: "sui",
  アプトス: "aptos",         apt: "aptos",          aptos: "aptos",
  pepe: "pepe",              trump: "official-trump",
  wif: "dogwifcoin",         bonk: "bonk",
  ltc: "litecoin",           litecoin: "litecoin",  ライトコイン: "litecoin",
  inj: "injective-protocol",
};

// ---- Helpers ---------------------------------------------------------------

function fmtPrice(n: number): string {
  if (!n) return "$0";
  if (n < 0.001) return `$${n.toFixed(8)}`;
  if (n < 0.01)  return `$${n.toFixed(6)}`;
  if (n < 1)     return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtLarge(n: number): string {
  if (!n) return "$0";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Split long text into LINE-safe chunks (max 4800 chars, up to 4 chunks) */
function splitText(text: string): string[] {
  const MAX = 4800;
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0 && chunks.length < 4) {
    if (remaining.length <= MAX) {
      chunks.push(remaining);
      break;
    }
    const cut = remaining.lastIndexOf("\n", MAX);
    const pos = cut > 0 ? cut : MAX;
    chunks.push(remaining.slice(0, pos).trim());
    remaining = remaining.slice(pos).trim();
  }
  return chunks;
}

/** Verify LINE webhook signature (HMAC-SHA256, base64-encoded) */
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const hash = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return hash === signature;
}

/** Send reply via LINE Reply API */
async function lineReply(
  replyToken: string,
  messages: { type: string; text: string }[]
): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error(`LINE Reply API error ${res.status}: ${err}`);
  }
}

/** Fetch CoinGecko price card */
async function fetchCoinPrice(query: string): Promise<string | null> {
  try {
    let id = COIN_ALIASES[query.toLowerCase().trim()] ?? null;

    if (!id) {
      const sr = await fetch(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      const sd = await sr.json();
      id = sd.coins?.[0]?.id ?? null;
    }
    if (!id) return null;

    const r = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets` +
        `?vs_currency=usd&ids=${id}&sparkline=false&price_change_percentage=24h,7d`,
      { signal: AbortSignal.timeout(6000) }
    );
    const coins = await r.json();
    const c = coins[0];
    if (!c) return null;

    const pct24h = c.price_change_percentage_24h ?? 0;
    const pct7d  = c.price_change_percentage_7d_in_currency ?? 0;

    return (
      `📊 ${c.name} (${c.symbol.toUpperCase()})\n` +
      `💰 価格: ${fmtPrice(c.current_price)}\n` +
      `${pct24h >= 0 ? "▲" : "▼"} 24h: ${pct24h.toFixed(2)}%　` +
      `${pct7d >= 0 ? "▲" : "▼"} 7d: ${pct7d.toFixed(2)}%\n` +
      `📈 時価総額: ${fmtLarge(c.market_cap)}\n` +
      `💹 24h取引量: ${fmtLarge(c.total_volume)}\n` +
      `🏆 ランク: #${c.market_cap_rank}\n` +
      `出典: CoinGecko`
    );
  } catch {
    return null;
  }
}

/** Call the Vercel AI analysis endpoint */
async function fetchAiAnalysis(query: string): Promise<string> {
  try {
    const res = await fetch("https://crypto-terminal-psi.vercel.app/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(55000),
    });
    const data = await res.json();
    if (data.error) return `❌ AI分析エラー: ${data.error}`;
    return data.text ?? "（分析結果なし）";
  } catch (err) {
    return `❌ AI分析の取得に失敗しました: ${err instanceof Error ? err.message : "Unknown"}`;
  }
}

/** Process a single LINE text message event */
async function handleTextEvent(event: LineMessageEvent): Promise<void> {
  const msg = event.message as LineTextMessage;
  const query = msg.text.trim();
  const { replyToken } = event;

  // Fetch CoinGecko price and AI analysis in parallel
  const [priceText, aiText] = await Promise.all([
    fetchCoinPrice(query),
    fetchAiAnalysis(query),
  ]);

  const messages: { type: string; text: string }[] = [];

  // 1. Price card
  if (priceText) {
    messages.push({ type: "text", text: priceText });
  }

  // 2. AI analysis (split into up to 4 chunks; max 5 messages total)
  for (const chunk of splitText(aiText)) {
    if (messages.length >= 5) break;
    messages.push({ type: "text", text: chunk });
  }

  // Fallback
  if (messages.length === 0) {
    messages.push({
      type: "text",
      text: "情報を取得できませんでした。銘柄名を確認して再度お試しください。\n例: BTC / ソラナ / ethereum",
    });
  }

  await lineReply(replyToken, messages);
}

// ---- Route handlers -------------------------------------------------------

/** GET: health check / webhook URL verification */
export async function GET() {
  return new Response("Crypto Terminal LINE Webhook OK", { status: 200 });
}

/** POST: receive LINE webhook events */
export async function POST(request: NextRequest) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken   = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !accessToken) {
    console.error("LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN is not set");
    return new Response("Server configuration error", { status: 500 });
  }

  // Read raw body (needed for signature verification)
  const rawBody = await request.text();

  // Verify LINE signature
  const signature = request.headers.get("x-line-signature") ?? "";
  if (!verifySignature(rawBody, signature, channelSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Process text message events (skip empty verification pings)
  for (const event of body.events) {
    if (event.type !== "message") continue;
    const msgEvent = event as LineMessageEvent;
    if (msgEvent.message.type !== "text") continue;

    // Await each event sequentially (usually only one event per webhook call)
    await handleTextEvent(msgEvent).catch((err) => {
      console.error("handleTextEvent error:", err);
    });
  }

  return new Response("OK", { status: 200 });
}
