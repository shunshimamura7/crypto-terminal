import { NextRequest } from "next/server";
import TelegramBot from "node-telegram-bot-api";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---- Types ----------------------------------------------------------------

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name: string; username?: string };
    text?: string;
  };
}

// ---- Coin name → CoinGecko ID map ----------------------------------------

const COIN_ALIASES: Record<string, string> = {
  ビットコイン: "bitcoin",    btc: "bitcoin",        bitcoin: "bitcoin",
  イーサリアム: "ethereum",   eth: "ethereum",       ethereum: "ethereum",
  ソラナ: "solana",           sol: "solana",          solana: "solana",
  リップル: "ripple",         xrp: "ripple",          ripple: "ripple",
  バイナンスコイン: "binancecoin", bnb: "binancecoin",
  ドージコイン: "dogecoin",   doge: "dogecoin",       dogecoin: "dogecoin",
  ポリゴン: "matic-network",  matic: "matic-network", polygon: "matic-network",
  アバランチ: "avalanche-2",  avax: "avalanche-2",    avalanche: "avalanche-2",
  チェーンリンク: "chainlink", link: "chainlink",     chainlink: "chainlink",
  ユニスワップ: "uniswap",    uni: "uniswap",         uniswap: "uniswap",
  シバイヌ: "shiba-inu",      shib: "shiba-inu",
  カルダノ: "cardano",        ada: "cardano",         cardano: "cardano",
  ポルカドット: "polkadot",   dot: "polkadot",        polkadot: "polkadot",
  コスモス: "cosmos",         atom: "cosmos",         cosmos: "cosmos",
  ニア: "near",               near: "near",
  アービトラム: "arbitrum",   arb: "arbitrum",        arbitrum: "arbitrum",
  オプティミズム: "optimism",  op: "optimism",        optimism: "optimism",
  スイ: "sui",                sui: "sui",
  アプトス: "aptos",          apt: "aptos",           aptos: "aptos",
  pepe: "pepe",               trump: "official-trump",
  wif: "dogwifcoin",          bonk: "bonk",
  ltc: "litecoin",            litecoin: "litecoin",   ライトコイン: "litecoin",
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

/** Escape special characters for Telegram MarkdownV2 */
function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/** Split text into Telegram-safe chunks (max 4000 chars each) */
function splitText(text: string): string[] {
  const MAX = 4000;
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0 && chunks.length < 5) {
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

    // Plain text (Telegram sendMessage default parse_mode: undefined)
    return (
      `📊 ${c.name} (${c.symbol.toUpperCase()})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 価格: ${fmtPrice(c.current_price)}\n` +
      `${pct24h >= 0 ? "▲" : "▼"} 24h変動: ${pct24h.toFixed(2)}%\n` +
      `${pct7d >= 0 ? "▲" : "▼"} 7d変動: ${pct7d.toFixed(2)}%\n` +
      `📈 時価総額: ${fmtLarge(c.market_cap)}\n` +
      `💹 24h取引量: ${fmtLarge(c.total_volume)}\n` +
      `🏆 ランク: #${c.market_cap_rank}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `出典: CoinGecko`
    );
  } catch {
    return null;
  }
}

/** Call the Vercel AI analysis endpoint */
async function fetchAiAnalysis(query: string): Promise<string> {
  try {
    const res = await fetch("https://bell-sig.vercel.app/api/chat", {
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

/** Send a message via Telegram Bot API using node-telegram-bot-api */
async function sendTelegramMessage(
  bot: TelegramBot,
  chatId: number,
  text: string
): Promise<void> {
  await bot.sendMessage(chatId, text, { parse_mode: undefined });
}

/** Process a single Telegram text message */
async function handleMessage(
  bot: TelegramBot,
  chatId: number,
  query: string
): Promise<void> {
  // Fetch in parallel
  const [priceText, aiText] = await Promise.all([
    fetchCoinPrice(query),
    fetchAiAnalysis(query),
  ]);

  // Send price card first
  if (priceText) {
    await sendTelegramMessage(bot, chatId, priceText);
  }

  // Send AI analysis in chunks
  const chunks = splitText(aiText);
  for (const chunk of chunks) {
    await sendTelegramMessage(bot, chatId, chunk);
  }

  if (!priceText && chunks.length === 0) {
    await sendTelegramMessage(
      bot,
      chatId,
      "情報を取得できませんでした。銘柄名を確認して再度お試しください。\n例: BTC / ソラナ / ethereum"
    );
  }
}

// ---- Webhook handlers -----------------------------------------------------

const HELP_TEXT =
  "🤖 Crypto Terminal Bot\n\n" +
  "【コマンド】\n" +
  "  /scan — MEXCショートスキャンTOP5\n" +
  "  /market — 市場環境サマリー\n" +
  "  銘柄名 — AI分析（例: BTC, ソラナ）\n\n" +
  "【銘柄分析の例】\n" +
  "  BTC / ETH / SOL / DOGE\n" +
  "  ソラナ / イーサリアム\n\n" +
  "提供情報:\n" +
  "  📊 リアルタイム価格\n" +
  "  🐋 スマートマネー動向\n" +
  "  🔓 アンロックスケジュール\n" +
  "  🔵 ホルダー分散\n" +
  "  🎯 ショートスキャン\n" +
  "  📈 市場環境";

export async function GET() {
  return new Response("Crypto Terminal Telegram Webhook OK", { status: 200 });
}

export async function POST(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not set");
    return new Response("Server configuration error", { status: 500 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = update.message;

  // Ignore non-text updates
  if (!message?.text || !message.chat?.id) {
    return new Response("OK", { status: 200 });
  }

  const chatId = message.chat.id;
  const text   = message.text.trim();

  // Instantiate bot in webhook mode (no polling)
  const bot = new TelegramBot(token, { polling: false });

  // Handle commands
  if (text === "/start" || text === "/help") {
    await bot.sendMessage(chatId, HELP_TEXT);
    return new Response("OK", { status: 200 });
  }

  // ── /scan: ショートスキャンTOP5 ──
  if (text === "/scan" || text === "/short") {
    await bot.sendMessage(chatId, "🔍 ショートスキャン実行中...");
    try {
      const scanRes = await fetch("https://bell-sig.vercel.app/api/short-scan", {
        signal: AbortSignal.timeout(55000),
      });
      const scanData = await scanRes.json();
      if (!scanData.success || !scanData.candidates?.length) {
        await bot.sendMessage(chatId, "❌ スキャン結果が取得できませんでした");
        return new Response("OK", { status: 200 });
      }
      const top5 = scanData.candidates.slice(0, 5);
      const lines = top5.map((c: { symbol: string; shortScore: number; currentPrice: number; athDropPct: number; fundingRate: number | null; volumeChangeRatio: number; trendDirection: string }, i: number) => {
        const sym = c.symbol.replace("_USDT", "");
        const fr  = c.fundingRate !== null ? `${(c.fundingRate * 100).toFixed(4)}%` : "N/A";
        return (
          `${i + 1}. ${sym}\n` +
          `   Score: ${c.shortScore} | $${c.currentPrice}\n` +
          `   ATH: ${c.athDropPct.toFixed(0)}% | FR: ${fr}\n` +
          `   Vol比: ${c.volumeChangeRatio.toFixed(2)}× | TF: ${c.trendDirection}`
        );
      });
      const msg =
        `🎯 MEXC SHORT SCAN TOP5\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join("\n━━━━━━━━━━━━━━━━━━━━\n") +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 対象: ${scanData.meta?.filtered ?? "?"}銘柄\n` +
        `⏰ ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`;
      await sendTelegramMessage(bot, chatId, msg);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ スキャンエラー: ${err instanceof Error ? err.message : "Unknown"}`);
    }
    return new Response("OK", { status: 200 });
  }

  // ── /market: 市場環境概要 ──
  if (text === "/market" || text === "/env") {
    try {
      const envRes = await fetch("https://bell-sig.vercel.app/api/market-env", {
        signal: AbortSignal.timeout(10000),
      });
      const env = await envRes.json();
      const fng    = env?.fng;
      const fngStr = fng ? `${fng.value}/100 (${fng.valueText ?? "—"})` : "N/A";
      const btcP   = env?.btcPrice   ? `$${Number(env.btcPrice).toLocaleString()}`  : "N/A";
      const ethP   = env?.ethPrice   ? `$${Number(env.ethPrice).toLocaleString()}`  : "N/A";
      const btcC   = env?.btcChange24h != null ? `${Number(env.btcChange24h) >= 0 ? "+" : ""}${Number(env.btcChange24h).toFixed(2)}%` : "N/A";
      const ethC   = env?.ethChange24h != null ? `${Number(env.ethChange24h) >= 0 ? "+" : ""}${Number(env.ethChange24h).toFixed(2)}%` : "N/A";
      const fngVal = fng?.value ?? null;
      const btcChg = Number(env?.btcChange24h ?? 0);
      let shortEnv = "🟡 普通";
      if (btcChg <= -5 || (fngVal !== null && fngVal <= 24)) shortEnv = "🔴 危険（パニック相場）";
      else if (btcChg >= 5  || (fngVal !== null && fngVal <= 49)) shortEnv = "🟠 注意";
      else if (fngVal !== null && fngVal >= 75) shortEnv = "🟢 良好（過熱→ショート有利）";
      const msg =
        `📊 市場環境サマリー\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `₿ BTC: ${btcP} (${btcC})\n` +
        `Ξ ETH: ${ethP} (${ethC})\n` +
        `😱 F&G: ${fngStr}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `ショート環境: ${shortEnv}\n` +
        `⏰ ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`;
      await sendTelegramMessage(bot, chatId, msg);
    } catch (err) {
      await bot.sendMessage(chatId, `❌ 市況取得エラー: ${err instanceof Error ? err.message : "Unknown"}`);
    }
    return new Response("OK", { status: 200 });
  }

  // Strip leading slash if user typed "/btc" style
  const query = text.startsWith("/") ? text.slice(1) : text;

  await handleMessage(bot, chatId, query).catch(async (err) => {
    console.error("handleMessage error:", err);
    await bot
      .sendMessage(chatId, `❌ エラーが発生しました: ${err instanceof Error ? err.message : "Unknown"}`)
      .catch(console.error);
  });

  return new Response("OK", { status: 200 });
}
