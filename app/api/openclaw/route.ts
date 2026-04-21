import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const COIN_NAME_MAP: Record<string, string> = {
  ビットコイン: "Bitcoin",    btc: "Bitcoin",        bitcoin: "Bitcoin",
  イーサリアム: "Ethereum",   eth: "Ethereum",       ethereum: "Ethereum",
  ソラナ: "Solana",           sol: "Solana",          solana: "Solana",
  リップル: "Ripple/XRP",     xrp: "Ripple/XRP",     ripple: "Ripple/XRP",
  バイナンスコイン: "BNB",    bnb: "BNB",
  ドージコイン: "Dogecoin",   doge: "Dogecoin",       dogecoin: "Dogecoin",
  ポリゴン: "Polygon/MATIC",  matic: "Polygon/MATIC", polygon: "Polygon/MATIC",
  アバランチ: "Avalanche",    avax: "Avalanche",      avalanche: "Avalanche",
  チェーンリンク: "Chainlink", link: "Chainlink",     chainlink: "Chainlink",
  ユニスワップ: "Uniswap",    uni: "Uniswap",         uniswap: "Uniswap",
  シバイヌ: "Shiba Inu",      shib: "Shiba Inu",
  カルダノ: "Cardano",        ada: "Cardano",         cardano: "Cardano",
  ポルカドット: "Polkadot",   dot: "Polkadot",        polkadot: "Polkadot",
  コスモス: "Cosmos/ATOM",    atom: "Cosmos/ATOM",    cosmos: "Cosmos/ATOM",
  ニア: "NEAR Protocol",      near: "NEAR Protocol",
  アービトラム: "Arbitrum",   arb: "Arbitrum",        arbitrum: "Arbitrum",
  オプティミズム: "Optimism",  op: "Optimism",        optimism: "Optimism",
  スイ: "Sui",                sui: "Sui",
  アプトス: "Aptos",          apt: "Aptos",           aptos: "Aptos",
  pepe: "Pepe (PEPE)",        trump: "Official Trump (TRUMP)",
  wif: "dogwifhat (WIF)",     bonk: "Bonk (BONK)",
  ltc: "Litecoin",            litecoin: "Litecoin",   ライトコイン: "Litecoin",
  inj: "Injective",
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

// ---- CoinGecko -------------------------------------------------------------

interface CoinMarket {
  name: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  market_cap: number;
  total_volume: number;
  market_cap_rank: number;
  ath: number;
  ath_change_percentage: number;
  circulating_supply: number;
  total_supply: number | null;
}

async function fetchCoinData(query: string): Promise<CoinMarket | null> {
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
    const coins: CoinMarket[] = await r.json();
    return coins[0] ?? null;
  } catch {
    return null;
  }
}

// ---- Anthropic AI analysis -------------------------------------------------

const SYSTEM_PROMPT = `あなたは暗号通貨の専門リサーチアナリストです。指定された暗号通貨について、以下の5つのセクションで日本語で報告してください。

## 🐋 スマートマネー & ホエール動向
過去7日間の大口ウォレット移動、取引所への流出入、機関投資家の売買動向。

## 🔓 トークンアンロック スケジュール
直近30〜90日のアンロック予定、クリフイベント、市場への売り圧力予測。

## 🔵 ホルダー分散 & 上位ウォレット
上位10ウォレットの保有割合、集中リスク、インサイダー動向。

## 🗣️ 著名人・インフルエンサーの最新発言
Elon Musk、Vitalik Buterin、CZ等の過去30日以内の発言。

## 💼 VC・機関投資家の動向
a16z、Paradigm、Multicoin Capital等の最新投資情報。

ルール：
- 必ず日本語で回答
- 情報が見つからない場合は「（最新情報なし）」と記載`;

async function fetchAiAnalysis(query: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "（ANTHROPIC_API_KEY未設定のためAI分析スキップ）";
  }
  try {
    const coinName = COIN_NAME_MAP[query.toLowerCase().trim()] ?? query;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `「${coinName}」（入力: "${query}"）について5セクションで日本語報告してください。`,
        },
      ],
    });
    return message.content[0]?.type === "text" ? message.content[0].text : "（分析結果なし）";
  } catch (err) {
    return `（AI分析エラー: ${err instanceof Error ? err.message : "Unknown"}）`;
  }
}

// ---- Route handlers -------------------------------------------------------

export async function GET() {
  return Response.json({
    service: "Crypto Terminal OpenClaw API",
    version: "1.0.0",
    endpoints: {
      "POST /api/openclaw": "銘柄名を送ってCoinGecko価格+AI分析を取得",
    },
    example: {
      request: { query: "BTC" },
      response: { coin: {}, aiAnalysis: "" },
    },
  });
}

export async function POST(request: NextRequest) {
  let query: string;
  try {
    const body = await request.json();
    query = (body.query ?? "").trim();
    if (!query) throw new Error("query is required");
  } catch {
    return Response.json({ error: "Invalid request. Body: { query: string }" }, { status: 400 });
  }

  // Parallel fetch
  const [coinData, aiAnalysis] = await Promise.all([
    fetchCoinData(query),
    fetchAiAnalysis(query),
  ]);

  // Build coin summary
  let coinSummary: string | null = null;
  if (coinData) {
    const pct24h = coinData.price_change_percentage_24h ?? 0;
    const pct7d  = coinData.price_change_percentage_7d_in_currency ?? 0;
    coinSummary =
      `📊 ${coinData.name} (${coinData.symbol.toUpperCase()})\n` +
      `💰 価格: ${fmtPrice(coinData.current_price)}\n` +
      `${pct24h >= 0 ? "▲" : "▼"} 24h: ${pct24h.toFixed(2)}%　` +
      `${pct7d >= 0 ? "▲" : "▼"} 7d: ${pct7d.toFixed(2)}%\n` +
      `📈 時価総額: ${fmtLarge(coinData.market_cap)}\n` +
      `💹 24h取引量: ${fmtLarge(coinData.total_volume)}\n` +
      `🏆 ランク: #${coinData.market_cap_rank}\n` +
      `📉 ATH: ${fmtPrice(coinData.ath)} (${coinData.ath_change_percentage.toFixed(1)}%)\n` +
      `出典: CoinGecko`;
  }

  return Response.json({
    query,
    coin: coinData
      ? {
          name: coinData.name,
          symbol: coinData.symbol.toUpperCase(),
          price: coinData.current_price,
          change24h: coinData.price_change_percentage_24h,
          change7d: coinData.price_change_percentage_7d_in_currency,
          marketCap: coinData.market_cap,
          volume24h: coinData.total_volume,
          rank: coinData.market_cap_rank,
          ath: coinData.ath,
          athChange: coinData.ath_change_percentage,
          circulatingSupply: coinData.circulating_supply,
          totalSupply: coinData.total_supply,
          summary: coinSummary,
        }
      : null,
    aiAnalysis,
    // Combined text for OpenClaw to display directly
    text: [coinSummary, aiAnalysis].filter(Boolean).join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n"),
  });
}
