import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import type { UpgradeEvent } from '@/app/lib/upgradeTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function createRedis(): Redis {
  const url   = process.env.UPSTASH_REDIS_REST_URL   ?? process.env.KV_REST_API_URL   ?? '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '';
  return new Redis({ url, token });
}

function isKvReady(): boolean {
  return !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL        && process.env.KV_REST_API_TOKEN)
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol')?.toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const importanceFilter = searchParams.get('importance') ?? 'all';

  if (!isKvReady()) {
    return NextResponse.json({ symbol, events: [] });
  }

  try {
    const redis = createRedis();
    const raw = await redis.get<UpgradeEvent[]>(`bell:upgrades:${symbol}`);
    if (!raw) {
      return NextResponse.json({ symbol, events: [] });
    }

    // daysUntil を現在時刻ベースで再計算
    let events = raw.map(e => ({
      ...e,
      daysUntil: e.scheduledAt
        ? Math.ceil((new Date(e.scheduledAt).getTime() - Date.now()) / 86400000)
        : undefined,
    }));

    // 重要度フィルタ
    if (importanceFilter === 'critical') {
      events = events.filter(e => e.importance === 'critical');
    } else if (importanceFilter === 'major') {
      events = events.filter(e => e.importance !== 'minor');
    }

    return NextResponse.json({ symbol, events });
  } catch {
    return NextResponse.json({ symbol, events: [] });
  }
}
