import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const KV_KEY = "bell:fr-watchlist";

function createRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL   ?? process.env.KV_REST_API_URL   ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function getWatchlist(redis: Redis): Promise<string[]> {
  const result = await redis.get<string[]>(KV_KEY);
  if (!result || !Array.isArray(result)) return [];
  return result;
}

export async function GET() {
  const redis = createRedis();
  if (!redis) return Response.json({ watchlist: [] });
  try {
    const list = await getWatchlist(redis);
    return Response.json({ watchlist: list });
  } catch {
    return Response.json({ watchlist: [] });
  }
}

export async function POST(request: NextRequest) {
  const redis = createRedis();
  if (!redis) return Response.json({ error: "KV not configured" }, { status: 500 });
  try {
    const { action, symbol } = await request.json();
    if (!action || !symbol) {
      return Response.json({ error: "action and symbol required" }, { status: 400 });
    }
    const upper = String(symbol).toUpperCase().trim();
    const list  = await getWatchlist(redis);

    if (action === "add") {
      if (!list.includes(upper)) list.push(upper);
    } else if (action === "remove") {
      const idx = list.indexOf(upper);
      if (idx !== -1) list.splice(idx, 1);
    } else {
      return Response.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
    }

    await redis.set(KV_KEY, list);
    return Response.json({ ok: true, watchlist: list });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
