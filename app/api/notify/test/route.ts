import { NextRequest } from "next/server";
import { sendDiscordAlert, DISCORD_COLORS } from "@/app/lib/discord";
import type { DiscordColor } from "@/app/lib/discord";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { title?: string; description?: string; color?: string } = {};
  try {
    body = await req.json();
  } catch { /* use defaults */ }

  const title       = (body.title       ?? "🔔 ベル テスト通知").slice(0, 256);
  const description = (body.description ?? "Discord Webhook の接続確認です。").slice(0, 4096);
  const colorKey    = (body.color ?? "blue") as DiscordColor;
  const color       = colorKey in DISCORD_COLORS ? colorKey : "blue";

  const webhookSet = !!process.env.DISCORD_WEBHOOK_URL;

  sendDiscordAlert({
    title,
    description,
    color,
    footer: "ベル Crypto Terminal — テスト送信",
  });

  return Response.json({
    success: true,
    webhookConfigured: webhookSet,
    message: webhookSet
      ? "Discord に送信しました（fire-and-forget）"
      : "DISCORD_WEBHOOK_URL が未設定のためスキップしました",
  });
}
