import { NextRequest } from "next/server";

export const runtime = "nodejs";

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

const SYSTEM_PROMPT = `あなたは暗号通貨の専門リサーチアナリストです。指定された暗号通貨について、Googleの最新情報を使って以下の5つのセクションで日本語で報告してください。

## 🐋 スマートマネー & ホエール動向
Arkham Intelligence、Whale Alert、暗号通貨ニュースから：過去7日間の大口ウォレット移動、取引所への流出入、機関投資家の売買動向、注目すべきオンチェーン活動。具体的なUSD金額やウォレットアドレスがあれば記載。

## 🔓 トークンアンロック スケジュール
TokenUnlocks.app、Tokenomist、プロジェクト公式情報から：直近30〜90日のベスティングアンロック予定、クリフイベント、アンロック総量、流通量に対する割合、市場への売り圧力の影響予測。

## 🔵 ホルダー分散 & 上位ウォレット
Bubblemaps、Etherscan、Solscan等のブロックチェーンエクスプローラーから：上位10ウォレットの保有割合、集中リスク、不審なクラスタリング、インサイダーウォレットの動向、分散化スコア。

## 🗣️ 著名人・インフルエンサーの最新発言
Twitter/XやニュースからElon Musk、Vitalik Buterin、CZ (Changpeng Zhao)、Michael Saylor、Brian Armstrong等の過去30日以内の最新コメントや投稿。

## 💼 VC・機関投資家の動向
a16z/Andreessen Horowitz、Paradigm、Multicoin Capital、Pantera Capital、Jump Crypto、Coinbase Venturesの投資情報。最新の投資ラウンド、機関保有情報、投資金額と日付。

ルール：
- 必ず日本語で回答
- 具体的な数値、日付、情報源名を含める
- 情報が見つからない場合は「（最新情報なし）」と記載
- 各セクションは簡潔かつ実用的な内容にする
- 情報源を明記する（例：「出典: Whale Alert」「出典: TokenUnlocks」）`;

export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "GEMINI_API_KEY が設定されていません。Vercelの環境変数を確認してください。" },
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
        const prompt = `「${coinName}」（ユーザー入力: "${query}"）について、5つのセクション全てを調査して日本語で報告してください。`;

        // Use Gemini v1 REST API directly for SSE streaming
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:streamGenerateContent?key=${process.env.GEMINI_API_KEY}&alt=sse`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 8192 },
            }),
          }
        );

        if (!geminiRes.ok || !geminiRes.body) {
          const errText = await geminiRes.text().catch(() => "Unknown error");
          throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
        }

        const reader = geminiRes.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              const text: string =
                parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
              if (text) send({ type: "text", text });
            } catch {
              // skip malformed chunks
            }
          }
        }

        send({ type: "done" });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "不明なエラー";
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
