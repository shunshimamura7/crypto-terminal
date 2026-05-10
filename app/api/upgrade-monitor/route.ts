import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { UPGRADE_SOURCES } from '@/app/lib/upgradeSources';
import {
  fetchGitHubReleases,
  fetchBlogRSS,
  fetchCoinMarketCal,
  fetchTwitter,
} from '@/app/lib/upgradeFetcher';
import type { UpgradeEvent } from '@/app/lib/upgradeTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  // CRON_SECRET 認証（未設定時はVercel cron専用ヘッダーで代替）
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const bySymbol: Record<string, number> = {};
  let totalEvents = 0;

  for (const [symbol, config] of Object.entries(UPGRADE_SOURCES)) {
    const results = await Promise.allSettled([
      config.github          ? fetchGitHubReleases(config.github)          : Promise.resolve([]),
      config.blog_rss        ? fetchBlogRSS(config.blog_rss)               : Promise.resolve([]),
      config.coinmarketcal_id ? fetchCoinMarketCal(config.coinmarketcal_id) : Promise.resolve([]),
      config.twitter         ? fetchTwitter(config.twitter)                : Promise.resolve([]),
    ]);

    const events: UpgradeEvent[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        events.push(...r.value.map(e => ({ ...e, symbol })));
      }
    }

    // importance 降順 → publishedAt 降順、最大20件
    const sorted = events
      .sort((a, b) => {
        const imp = { critical: 3, major: 2, minor: 1 };
        const impDiff = (imp[b.importance] ?? 0) - (imp[a.importance] ?? 0);
        if (impDiff !== 0) return impDiff;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      })
      .slice(0, 20);

    if (sorted.length > 0 && isKvReady()) {
      try {
        const redis = createRedis();
        // 48時間TTL（2日分キャッシュ）
        await redis.set(`bell:upgrades:${symbol}`, sorted, { ex: 172800 });
      } catch {
        // KV保存失敗は無視
      }
    }

    bySymbol[symbol] = sorted.length;
    totalEvents += sorted.length;

    // レート制限対策: 200ms待機
    await new Promise(r => setTimeout(r, 200));
  }

  return NextResponse.json({
    success: true,
    totalEvents,
    bySymbol,
    processedAt: new Date().toISOString(),
  });
}
