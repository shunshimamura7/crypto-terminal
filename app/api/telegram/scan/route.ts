import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const SCORE_THRESHOLD = 13;
const MAX_NOTIFY = 5;

export async function GET(req: NextRequest) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return Response.json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" }, { status: 500 });
  }

  const cronSecret   = process.env.CRON_SECRET;
  const authHeader   = req.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const scanRes = await fetch("https://bell-sig.vercel.app/api/short-scan", {
      signal: AbortSignal.timeout(110000),
    });
    const scanData = await scanRes.json();

    if (!scanData.success || !scanData.candidates?.length) {
      return Response.json({ ok: true, message: "No candidates" });
    }

    const highScore = (scanData.candidates as Array<{ shortScore: number }>)
      .filter(c => c.shortScore >= SCORE_THRESHOLD)
      .slice(0, MAX_NOTIFY);

    if (highScore.length === 0) {
      return Response.json({ ok: true, message: "No high-score candidates" });
    }

    const lines = (highScore as Array<{
      symbol: string; shortScore: number; currentPrice: number;
      athDropPct: number; fundingRate: number | null; volumeChangeRatio: number;
      trendDirection: string; atrData?: { regime: string } | null;
      allPatterns?: Array<{ type: string }>;
    }>).map((c, i) => {
      const sym      = c.symbol.replace("_USDT", "");
      const fr       = c.fundingRate !== null ? `${(c.fundingRate * 100).toFixed(4)}%` : "N/A";
      const regime   = c.atrData?.regime ?? "N/A";
      const patterns = c.allPatterns?.map(p => p.type).join(", ") ?? "";
      return (
        `${i + 1}. ${sym} ⚡${c.shortScore}pt\n` +
        `   $${c.currentPrice} | ATH${c.athDropPct.toFixed(0)}%\n` +
        `   FR:${fr} | Vol:${c.volumeChangeRatio.toFixed(2)}×\n` +
        `   TF:${c.trendDirection} | ATR:${regime}` +
        (patterns ? `\n   📐 ${patterns}` : "")
      );
    });

    const msg =
      `🚨 HIGH SCORE ALERT\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      lines.join("\n━━━━━━━━━━━━━━━━━━━━\n") +
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `閾値: ${SCORE_THRESHOLD}pt以上\n` +
      `⏰ ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });

    if (!tgRes.ok) {
      const errText = await tgRes.text();
      console.error(`[telegram/scan] Send failed: ${errText}`);
      return Response.json({ error: "Telegram send failed" }, { status: 500 });
    }

    return Response.json({
      ok: true,
      notified: highScore.length,
      symbols: (highScore as unknown as Array<{ symbol: string }>).map(c => c.symbol),
    });

  } catch (err) {
    console.error("[telegram/scan] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
