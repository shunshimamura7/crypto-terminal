/**
 * Upstash Redis クライアント — トレード履歴 KV ヘルパー
 *
 * 必要な環境変数 (.env.local / Vercel ダッシュボード):
 *   UPSTASH_REDIS_REST_URL   = https://<name>.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN = <token>
 *
 * Vercel KV の環境変数名 (KV_REST_API_URL / KV_REST_API_TOKEN) でも動作:
 *   どちらか一方が設定されていれば自動で選択します。
 */
import { Redis } from "@upstash/redis";
import type { TradeLog, TradeStats } from "@/app/types/trade";

// ── Client ────────────────────────────────────────────────────────────────────
function isKvReady(): boolean {
  return !!(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL        && process.env.KV_REST_API_TOKEN)
  );
}

function createRedis(): Redis {
  // Upstash 標準 env vars を優先、なければ Vercel KV env vars を使う
  const url   = process.env.UPSTASH_REDIS_REST_URL   ?? process.env.KV_REST_API_URL   ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  return new Redis({ url, token });
}

// ── Key helpers ───────────────────────────────────────────────────────────────
const IDX_ALL = "bell:trades:all";
function tickerIdxKey(ticker: string) {
  return `bell:trades:ticker:${ticker.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}
function tradeKey(ts: string, ticker: string) {
  return `trade:${ts}:${ticker.toUpperCase()}`;
}

// ── Save ──────────────────────────────────────────────────────────────────────
export async function saveTradeLog(log: TradeLog): Promise<boolean> {
  if (!isKvReady()) return false;
  try {
    const redis = createRedis();
    const key   = tradeKey(log.timestamp, log.ticker);
    const score = new Date(log.timestamp).getTime();

    // @upstash/redis が自動で JSON シリアライズ/デシリアライズするのでオブジェクト直接保存
    await Promise.all([
      redis.set(key, log),
      redis.zadd(IDX_ALL,                 { score, member: key }),
      redis.zadd(tickerIdxKey(log.ticker), { score, member: key }),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ── Get latest N ──────────────────────────────────────────────────────────────
export async function getTradeLogs(limit = 20): Promise<TradeLog[] | null> {
  if (!isKvReady()) return null;
  try {
    const redis = createRedis();
    const keys = await redis.zrange<string[]>(IDX_ALL, 0, limit - 1, { rev: true });
    if (!keys.length) return [];
    const items = await Promise.all(keys.map((k) => redis.get<TradeLog>(k)));
    return items.filter((item): item is TradeLog => !!item);
  } catch {
    return null;
  }
}

// ── Get by ticker ─────────────────────────────────────────────────────────────
export async function getTradeLogsByTicker(ticker: string): Promise<TradeLog[] | null> {
  if (!isKvReady()) return null;
  try {
    const redis = createRedis();
    const keys = await redis.zrange<string[]>(tickerIdxKey(ticker), 0, -1, { rev: true });
    if (!keys.length) return [];
    const items = await Promise.all(keys.map((k) => redis.get<TradeLog>(k)));
    return items.filter((item): item is TradeLog => !!item);
  } catch {
    return null;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
export async function deleteTradeLog(ts: string, ticker: string): Promise<boolean> {
  if (!isKvReady()) return false;
  try {
    const redis = createRedis();
    const key   = tradeKey(ts, ticker);
    await Promise.all([
      redis.del(key),
      redis.zrem(IDX_ALL,                  key),
      redis.zrem(tickerIdxKey(ticker),     key),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export async function getTradeStats(): Promise<TradeStats | null> {
  if (!isKvReady()) return null;
  try {
    const redis = createRedis();
    const keys = await redis.zrange<string[]>(IDX_ALL, 0, 999, { rev: true });
    if (!keys.length) {
      return { total: 0, entries: 0, exits: 0, tpHits: 0, slHits: 0, manualExits: 0, winRate: null, byRank: {} };
    }
    const items = await Promise.all(keys.map((k) => redis.get<TradeLog>(k)));
    const logs  = items.filter((item): item is TradeLog => !!item);

    let entries = 0, tpHits = 0, slHits = 0, manualExits = 0;
    const byRank: TradeStats["byRank"] = {};

    for (const log of logs) {
      if (log.action === "entry") {
        entries++;
        const rank = log.bell_rank_at_entry ?? "N/A";
        if (!byRank[rank]) byRank[rank] = { entries: 0, tpHits: 0, slHits: 0, winRate: null };
        byRank[rank].entries++;
      } else if (log.action === "exit_tp")     { tpHits++; }
        else if (log.action === "exit_sl")     { slHits++; }
        else if (log.action === "exit_manual") { manualExits++; }
    }

    const decidedExits = tpHits + slHits;
    const winRate = decidedExits > 0 ? Math.round((tpHits / decidedExits) * 100) : null;

    for (const rank of Object.keys(byRank)) {
      const r       = byRank[rank];
      const decided = r.tpHits + r.slHits;
      r.winRate = decided > 0 ? Math.round((r.tpHits / decided) * 100) : null;
    }

    return { total: logs.length, entries, exits: tpHits + slHits + manualExits, tpHits, slHits, manualExits, winRate, byRank };
  } catch {
    return null;
  }
}
