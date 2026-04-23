// Discord Webhook 通知ヘルパー
// 環境変数 DISCORD_WEBHOOK_URL が未設定の場合はサイレント

export const DISCORD_COLORS = {
  green:  0x00ff00,
  red:    0xff0000,
  yellow: 0xffff00,
  blue:   0x0099ff,
} as const;

export type DiscordColor = keyof typeof DISCORD_COLORS;

export interface DiscordAlertOptions {
  title: string;
  description?: string;
  color?: DiscordColor | number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
}

// fire-and-forget: 呼び出し側は await 不要、失敗してもアプリに影響しない
export function sendDiscordAlert(opts: DiscordAlertOptions): void {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("[discord] DISCORD_WEBHOOK_URL が未設定のためスキップ");
    return;
  }

  const color =
    typeof opts.color === "number"
      ? opts.color
      : DISCORD_COLORS[opts.color ?? "blue"];

  const payload = {
    embeds: [
      {
        title: opts.title,
        description: opts.description,
        color,
        fields: opts.fields,
        footer: opts.footer ? { text: opts.footer } : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn("[discord] Webhook 送信失敗:", err instanceof Error ? err.message : err);
  });
}
