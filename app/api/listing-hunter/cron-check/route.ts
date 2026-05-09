import { NextResponse } from "next/server";

export const runtime = "nodejs";

// TODO: localStorage はサーバーサイドからアクセス不可のため現状はスタブ実装。
// open レコードのサーバー側永続化（Upstash Redis 等）を導入した際に本格実装する。
export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    message: "cron-check stub — server-side DB not yet implemented",
    ts: new Date().toISOString(),
  });
}
