import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const SCORE_THRESHOLD = 12;
const NOTIFY_COOLDOWN = 8 * 60 * 60 * 1000; // 8時間
const _notifiedCache = new Map<string, number>(); // symbol → last notified timestamp
const MAX_NOTIFY = 5;

type Candidate = {
  symbol: string; shortScore: number; currentPrice: number;
  athDropPct: number; fundingRate: number | null; volumeChangeRatio: number;
  trendDirection: string; atrData?: { regime: string; atrPct: number } | null;
  allPatterns?: Array<{ type: string }>;
  tradeSetup?: { sl: number; tp1: number; rrRatio: number } | null;
  oiRatio: number; openInterest: number; priceChange24h: number;
};

function mexcUrl(symbol: string): string {
  const base = symbol.replace("_USDT", "");
  const ref = process.env.NEXT_PUBLIC_MEXC_REFERRAL_CODE;
  return ref
    ? `https://www.mexc.com/futures/${base}_USDT?inviteCode=${ref}`
    : `https://www.mexc.com/futures/${base}_USDT`;
}

async function sendTg(token: string, chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error(`[telegram/scan] Send failed: ${await res.text()}`);
  return res.ok;
}

export async function GET(req: NextRequest) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return Response.json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" }, { status: 500 });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [scanRes, new30Res] = await Promise.all([
      fetch("https://bell-sig.vercel.app/api/short-scan", { signal: AbortSignal.timeout(55000) }),
      fetch("https://bell-sig.vercel.app/api/short-scan?mode=new30", { signal: AbortSignal.timeout(55000) }),
    ]);
    const scanData  = await scanRes.json();
    const new30Data = await new30Res.json().catch(() => ({ success: false }));

    if (!scanData.success || !scanData.candidates?.length) {
      return Response.json({ ok: true, message: "No candidates" });
    }

    const candidates = scanData.candidates as Candidate[];
    const new30Candidates: Candidate[] = (new30Data.success ? new30Data.candidates : [])
      .filter((c: Candidate) => c.shortScore >= 10)
      .slice(0, 3);
    const nowStr = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // ── High-score alert ──────────────────────────────────────────────────────
    const highScore = candidates.filter(c => c.shortScore >= SCORE_THRESHOLD).slice(0, MAX_NOTIFY);

    // スロットリング: 8時間以内に通知済みの銘柄をスキップ
    const now = Date.now();
    const freshHighScore = highScore.filter(c => {
      const lastNotified = _notifiedCache.get(c.symbol);
      return !(lastNotified && now - lastNotified < NOTIFY_COOLDOWN);
    });
    for (const c of freshHighScore) _notifiedCache.set(c.symbol, now);
    // 24時間以上前のエントリをクリーンアップ
    for (const [sym, ts] of _notifiedCache) {
      if (now - ts > 24 * 60 * 60 * 1000) _notifiedCache.delete(sym);
    }

    let notified = 0;

    if (freshHighScore.length > 0) {
      const PATTERN_LABELS: Record<string, string> = {
        bear_flag: "🚩BF", dead_cat: "🐱DC", descending_wedge: "📐DW",
        break_of_structure: "💥BOS", fair_value_gap: "🕳FVG", supply_zone: "🏗SZ",
      };
      const lines = freshHighScore.map((c, i) => {
        const sym      = c.symbol.replace("_USDT", "");
        const fr       = c.fundingRate !== null ? `${(c.fundingRate * 100).toFixed(4)}%` : "N/A";
        const patterns = c.allPatterns?.map(p => PATTERN_LABELS[p.type] ?? p.type).join(" ") ?? "";
        const regime   = c.atrData ? `${c.atrData.regime}(${c.atrData.atrPct.toFixed(1)}%)` : "";
        const rr       = c.tradeSetup ? `R:R ${c.tradeSetup.rrRatio.toFixed(2)}` : "";
        const oi       = c.openInterest >= 1e6
          ? `$${(c.openInterest / 1e6).toFixed(1)}M`
          : `$${(c.openInterest / 1e3).toFixed(0)}K`;
        return (
          `${i + 1}. ${sym} ⚡${c.shortScore}pt\n` +
          `   💰 $${c.currentPrice} | ATH${c.athDropPct.toFixed(0)}%\n` +
          `   📊 FR:${fr} | OI:${oi} (${(c.oiRatio ?? 0).toFixed(1)}×)\n` +
          `   📉 Vol:${c.volumeChangeRatio.toFixed(2)}× | TF:${c.trendDirection}` +
          (regime   ? `\n   🌡️ ${regime}` : "") +
          (patterns ? `\n   📐 ${patterns}` : "") +
          (rr       ? `\n   ⚔️ ${rr}` : "") +
          `\n   🔗 ${mexcUrl(c.symbol)}`
        ).trimEnd();
      });

      const msg =
        `🚨 HIGH SCORE ALERT\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        lines.join("\n━━━━━━━━━━━━━━━━━━━━\n") +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `閾値: ${SCORE_THRESHOLD}pt以上\n` +
        `⏰ ${nowStr}`;

      const ok = await sendTg(token, chatId, msg);
      if (!ok) return Response.json({ error: "Telegram send failed" }, { status: 500 });
      notified = freshHighScore.length;
    }

    // ── 新規上場ハイスコア ────────────────────────────────────────────────
    if (new30Candidates.length > 0) {
      const newMsg =
        `🆕 新規上場 HIGH SCORE\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        new30Candidates.map((c, i) => {
          const sym = c.symbol.replace("_USDT", "");
          const fr  = c.fundingRate !== null ? `${(c.fundingRate * 100).toFixed(4)}%` : "N/A";
          return `${i + 1}. ${sym} ⚡${c.shortScore}pt | $${c.currentPrice} | ATH${c.athDropPct.toFixed(0)}% | FR:${fr}`;
        }).join("\n") +
        `\n⏰ ${nowStr}`;
      await sendTg(token, chatId, newMsg);
    }

    // ── FR転換警告（スクイーズリスク）──────────────────────────────────────
    const frNegative = candidates
      .filter(c => c.fundingRate !== null && c.fundingRate < -0.0005 && c.shortScore >= 8)
      .slice(0, 3);

    if (frNegative.length > 0) {
      const frMsg =
        `⚡ FR転換警告（スクイーズリスク）\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        frNegative.map(c => {
          const sym = c.symbol.replace("_USDT", "");
          const fr  = c.fundingRate !== null ? `${(c.fundingRate * 100).toFixed(4)}%` : "N/A";
          return `  ${sym}: FR ${fr} / Score ${c.shortScore}`;
        }).join("\n") +
        `\n⏰ ${nowStr}`;
      await sendTg(token, chatId, frMsg);
    }

    // ── 急落検知（-20%超）──────────────────────────────────────────────────
    const bigDump = candidates
      .filter(c => c.priceChange24h <= -20 && c.shortScore >= 6)
      .slice(0, 3);

    if (bigDump.length > 0) {
      const dumpMsg =
        `💀 急落検知（24h -20%超）\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        bigDump.map(c => {
          const sym = c.symbol.replace("_USDT", "");
          return `  ${sym}: ${c.priceChange24h.toFixed(1)}% / $${c.currentPrice} / Score ${c.shortScore}`;
        }).join("\n") +
        `\n⏰ ${nowStr}`;
      await sendTg(token, chatId, dumpMsg);
    }

    if (notified === 0 && new30Candidates.length === 0 && frNegative.length === 0 && bigDump.length === 0) {
      return Response.json({ ok: true, message: "No alerts triggered" });
    }

    return Response.json({
      ok: true,
      notified,
      skipped: highScore.length - freshHighScore.length,
      new30Alerts: new30Candidates.length,
      frAlerts: frNegative.length,
      dumpAlerts: bigDump.length,
      symbols: freshHighScore.map(c => c.symbol),
    });

  } catch (err) {
    console.error("[telegram/scan] Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
