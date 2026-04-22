import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Japanese / abbreviation → English display name for the AI prompt
const COIN_NAME_MAP: Record<string, string> = {
  ビットコイン: "Bitcoin", btc: "Bitcoin", bitcoin: "Bitcoin",
  イーサリアム: "Ethereum", eth: "Ethereum", ethereum: "Ethereum",
  ソラナ: "Solana", sol: "Solana", solana: "Solana",
  リップル: "Ripple/XRP", xrp: "Ripple/XRP", ripple: "Ripple/XRP",
  バイナンスコイン: "BNB/Binance Coin", bnb: "BNB/Binance Coin",
  ドージコイン: "Dogecoin", doge: "Dogecoin", dogecoin: "Dogecoin",
  ポリゴン: "Polygon/MATIC", matic: "Polygon/MATIC", polygon: "Polygon/MATIC",
  アバランチ: "Avalanche", avax: "Avalanche", avalanche: "Avalanche",
  チェーンリンク: "Chainlink", link: "Chainlink", chainlink: "Chainlink",
  ユニスワップ: "Uniswap", uni: "Uniswap", uniswap: "Uniswap",
  シバイヌ: "Shiba Inu", shib: "Shiba Inu",
  カルダノ: "Cardano", ada: "Cardano", cardano: "Cardano",
  ポルカドット: "Polkadot", dot: "Polkadot", polkadot: "Polkadot",
  コスモス: "Cosmos/ATOM", atom: "Cosmos/ATOM", cosmos: "Cosmos/ATOM",
  ニア: "NEAR Protocol", near: "NEAR Protocol",
  アービトラム: "Arbitrum", arb: "Arbitrum", arbitrum: "Arbitrum",
  オプティミズム: "Optimism", op: "Optimism", optimism: "Optimism",
  スイ: "Sui", sui: "Sui",
  アプトス: "Aptos", apt: "Aptos", aptos: "Aptos",
  pepe: "Pepe (PEPE)", trump: "Official Trump (TRUMP)",
  wif: "dogwifhat (WIF)", bonk: "Bonk (BONK)",
  ltc: "Litecoin", litecoin: "Litecoin", ライトコイン: "Litecoin",
  inj: "Injective", injective: "Injective",
};

function getEnglishName(query: string): string {
  return COIN_NAME_MAP[query.toLowerCase().trim()] ?? query;
}

const SYSTEM_PROMPT = `You are a professional cryptocurrency research analyst. When asked about a cryptocurrency, use web_search to gather the latest information and respond in Japanese with these exact five sections.

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

Rules:
- Always respond in Japanese
- Include specific numbers, dates, and source names
- If information is not found, write "（最新情報なし）" for that item
- Be concise but include actionable insights
- Cite data sources (e.g., "出典: Whale Alert", "出典: TokenUnlocks")`;

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
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

  const coinName = getEnglishName(query);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      try {
        const messages: Anthropic.MessageParam[] = [
          {
            role: "user",
            content: `「${coinName}」（ユーザー入力: "${query}"）について、5つのセクション全てを調査して日本語で報告してください。各セクションで必ずweb_searchを使って最新情報を検索してください。`,
          },
        ];

        // Loop to handle pause_turn (server-side tool iteration limit)
        let continueLoop = true;
        while (continueLoop) {
          const aiStream = client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 8000,
            system: SYSTEM_PROMPT,
            tools: [{ type: "web_search_20260209", name: "web_search" }],
            messages,
          });

          for await (const event of aiStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send({ type: "text", text: event.delta.text });
            }
          }

          const finalMsg = await aiStream.finalMessage();

          if (finalMsg.stop_reason === "pause_turn") {
            // Server hit iteration limit; continue from where we left off
            messages.push({ role: "assistant", content: finalMsg.content });
          } else {
            continueLoop = false;
          }
        }

        send({ type: "done" });
      } catch (error) {
        const msg =
          error instanceof Anthropic.APIError
            ? `APIエラー ${error.status}: ${error.message}`
            : error instanceof Error
            ? error.message
            : "不明なエラー";
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
