export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory state — resets on cold start (acceptable per spec)
let lastUpdateId = 0;
let initialized = false;

interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

interface TgPost {
  message_id: number;
  chat: TgChat;
  text?: string;
  date: number;
}

interface TgUpdate {
  update_id: number;
  message?: TgPost;
  channel_post?: TgPost;
}

interface GetUpdatesResponse {
  ok: boolean;
  result: TgUpdate[];
  description?: string;
}

async function sendMessage(token: string, chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}

// Vercel cron は GET でこのエンドポイントを叩く
export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const destChatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    return Response.json(
      { error: "TELEGRAM_BOT_TOKEN が未設定です。Vercel 環境変数を確認してください。" },
      { status: 500 }
    );
  }
  if (!destChatId) {
    return Response.json(
      { error: "TELEGRAM_CHAT_ID が未設定です。.env.local と Vercel 環境変数に追加してください。" },
      { status: 500 }
    );
  }

  // 監視対象チャット（カンマ区切りの chat_id または @username）
  // 未設定の場合はボットが受信した全メッセージを転送
  const monitorSources = (process.env.TELEGRAM_MONITOR_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // getUpdates を呼ぶ
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("timeout", "0");
  url.searchParams.set("allowed_updates", '["message","channel_post"]');
  // コールドスタート直後は offset 未指定で保留中の全更新を取得し、スキップする
  if (lastUpdateId > 0) {
    url.searchParams.set("offset", String(lastUpdateId + 1));
  }

  let data: GetUpdatesResponse;
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return Response.json(
        { error: `Telegram API エラー (HTTP ${res.status})` },
        { status: 502 }
      );
    }
    data = (await res.json()) as GetUpdatesResponse;
  } catch (err) {
    return Response.json(
      { error: `Telegram リクエスト失敗: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 502 }
    );
  }

  if (!data.ok) {
    return Response.json(
      { error: "getUpdates 失敗", detail: data.description },
      { status: 502 }
    );
  }

  const updates = data.result;

  // コールドスタート時: 既存のバックログを offset だけ進めて転送しない
  // （再起動のたびに大量のメッセージが届くのを防ぐ）
  if (!initialized) {
    initialized = true;
    if (updates.length > 0) {
      lastUpdateId = updates[updates.length - 1].update_id;
    }
    return Response.json({
      ok: true,
      status: "initialized",
      skipped: updates.length,
      lastUpdateId,
    });
  }

  let forwarded = 0;

  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);

    // channel_post（チャンネル投稿）と message（グループ/DM）両方に対応
    const post = update.channel_post ?? update.message;
    if (!post?.text) continue;

    const chatIdStr = String(post.chat.id);
    const chatAt = post.chat.username ? `@${post.chat.username}` : null;

    const isMonitored =
      monitorSources.length === 0 ||
      monitorSources.some((s) => s === chatIdStr || (chatAt !== null && s === chatAt));

    if (!isMonitored) continue;

    const label = post.chat.title ?? post.chat.username ?? chatIdStr;
    const ok = await sendMessage(token, destChatId, `📢 [${label}]\n\n${post.text}`);
    if (ok) forwarded++;
  }

  return Response.json({ ok: true, processed: updates.length, forwarded, lastUpdateId });
}
