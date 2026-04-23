import { NextRequest } from "next/server";
import { saveTradeLog, getTradeLogs, getTradeLogsByTicker, deleteTradeLog } from "@/app/lib/kv";
import type { TradeLog, TradeAction, TradeDirection } from "@/app/types/trade";
import { sendDiscordAlert } from "@/app/lib/discord";
import type { DiscordColor } from "@/app/lib/discord";

export const runtime = "nodejs";
export const maxDuration = 30;

function uuid(): string {
  return crypto.randomUUID();
}

// ── Discord 通知ビルダー ───────────────────────────────────────────────────────
function notifyTrade(log: TradeLog): void {
  const sym  = log.ticker.replace(/USDT?$/, "");
  const dir  = log.direction === "long" ? "LONG 🟢" : "SHORT 🔴";
  const px   = `$${log.price.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  const sz   = log.size_pct > 0 ? ` | ${log.size_pct}%` : "";
  const rank = log.bell_rank_at_entry ? ` | ランク ${log.bell_rank_at_entry}` : "";

  let title: string;
  let description: string;
  let color: DiscordColor;

  switch (log.action) {
    case "entry":
      title       = `${log.direction === "long" ? "🟢" : "🔴"} ${dir} Entry: ${sym} ${px}`;
      description = `サイズ: ${log.size_pct > 0 ? `${log.size_pct}%` : "—"}${rank}${log.notes ? `\n📝 ${log.notes}` : ""}`;
      color       = log.direction === "long" ? "green" : "red";
      break;
    case "exit_tp":
      title       = `✅ TP Hit: ${sym} ${px}`;
      description = `方向: ${dir}${sz}${log.notes ? `\n📝 ${log.notes}` : ""}`;
      color       = "green";
      break;
    case "exit_sl":
      title       = `🔴 SL Hit: ${sym} ${px}`;
      description = `方向: ${dir}${sz}${log.notes ? `\n📝 ${log.notes}` : ""}`;
      color       = "red";
      break;
    case "exit_manual":
      title       = `📌 手動決済: ${sym} ${px}`;
      description = `方向: ${dir}${sz}${log.notes ? `\n📝 ${log.notes}` : ""}`;
      color       = "yellow";
      break;
  }

  sendDiscordAlert({
    title,
    description,
    color,
    footer: `ベル Crypto Terminal | ${new Date(log.timestamp).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`,
  });
}

// ── GET /api/trades?limit=20&ticker=BTC ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 200);

  const logs = ticker
    ? await getTradeLogsByTicker(ticker)
    : await getTradeLogs(limit);

  if (logs === null) {
    return Response.json(
      { success: false, error: "KV未接続 (KV_REST_API_URL / KV_REST_API_TOKEN を設定してください)", logs: [] },
      { status: 503 }
    );
  }

  return Response.json({ success: true, logs });
}

// ── POST /api/trades ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: Partial<TradeLog>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const validActions: TradeAction[] = ["entry", "exit_tp", "exit_sl", "exit_manual"];
  const validDirections: TradeDirection[] = ["long", "short"];

  const action = body.action;
  const ticker = (body.ticker ?? "").toString().trim().toUpperCase();
  const direction = body.direction;
  const price = Number(body.price);
  const size_pct = Number(body.size_pct ?? 0);

  if (!action || !validActions.includes(action)) {
    return Response.json({ success: false, error: "action は entry|exit_tp|exit_sl|exit_manual のいずれか" }, { status: 400 });
  }
  if (!ticker) {
    return Response.json({ success: false, error: "ticker は必須" }, { status: 400 });
  }
  if (!direction || !validDirections.includes(direction)) {
    return Response.json({ success: false, error: "direction は long|short のいずれか" }, { status: 400 });
  }
  if (isNaN(price) || price <= 0) {
    return Response.json({ success: false, error: "price は正の数値" }, { status: 400 });
  }

  const log: TradeLog = {
    id: uuid(),
    action,
    ticker,
    direction,
    price,
    size_pct,
    timestamp: new Date().toISOString(),
    ...(body.bell_rank_at_entry !== undefined && { bell_rank_at_entry: String(body.bell_rank_at_entry) }),
    ...(body.bell_alpha_at_entry !== undefined && { bell_alpha_at_entry: Number(body.bell_alpha_at_entry) }),
    ...(body.bell_risk_at_entry  !== undefined && { bell_risk_at_entry:  Number(body.bell_risk_at_entry)  }),
    ...(body.notes               !== undefined && { notes: String(body.notes).slice(0, 500) }),
    ...(body.linked_entry_id     !== undefined && { linked_entry_id: String(body.linked_entry_id) }),
  };

  const ok = await saveTradeLog(log);
  if (!ok) {
    return Response.json(
      { success: false, error: "KV未接続 — ログは保存されませんでした", log },
      { status: 503 }
    );
  }

  // fire-and-forget: 通知失敗でもレスポンスには影響しない
  notifyTrade(log);

  return Response.json({ success: true, log }, { status: 201 });
}

// ── DELETE /api/trades?ts=...&ticker=... ──────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ts     = searchParams.get("ts") ?? "";
  const ticker = searchParams.get("ticker") ?? "";

  if (!ts || !ticker) {
    return Response.json({ success: false, error: "ts と ticker は必須" }, { status: 400 });
  }

  const ok = await deleteTradeLog(ts, ticker);
  if (!ok) {
    return Response.json({ success: false, error: "削除失敗 (KV未接続またはキーなし)" }, { status: 503 });
  }

  return Response.json({ success: true });
}
