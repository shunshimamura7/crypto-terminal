import { kv } from "@vercel/kv";
import type { TradeLog, TradeStats } from "@/app/types/trade";

// KV利用可否フラグ
function isKvReady(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// ── Key helpers ──────────────────────────────────────────────────────────────
const IDX_ALL = "bell:trades:all";
function tickerIdxKey(ticker: string) {
  return `bell:trades:ticker:${ticker.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}
function tradeKey(ts: string, ticker: string) {
  return `trade:${ts}:${ticker.toUpperCase()}`;
}

// ── Save ─────────────────────────────────────────────────────────────────────
export async function saveTradeLog(log: TradeLog): Promise<boolean> {
  if (!isKvReady()) return false;
  try {
    const key = tradeKey(log.timestamp, log.ticker);
    const score = new Date(log.timestamp).getTime();

    await Promise.all([
      kv.set(key, JSON.stringify(log)),
      // sorted set: score = unix ms, member = key (for ordered retrieval)
      kv.zadd(IDX_ALL, { score, member: key }),
      kv.zadd(tickerIdxKey(log.ticker), { score, member: key }),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ── Get latest N ─────────────────────────────────────────────────────────────
export async function getTradeLogs(limit = 20): Promise<TradeLog[] | null> {
  if (!isKvReady()) return null;
  try {
    // zrange with rev:true returns highest scores (= latest timestamps) first
    const keys = await kv.zrange(IDX_ALL, 0, limit - 1, { rev: true }) as string[];
    if (!keys.length) return [];
    const raws = await Promise.all(keys.map((k) => kv.get<string>(k)));
    return raws
      .filter((r): r is string => !!r)
      .map((r) => JSON.parse(r) as TradeLog);
  } catch {
    return null;
  }
}

// ── Get by ticker ─────────────────────────────────────────────────────────────
export async function getTradeLogsByTicker(ticker: string): Promise<TradeLog[] | null> {
  if (!isKvReady()) return null;
  try {
    const keys = await kv.zrange(tickerIdxKey(ticker), 0, -1, { rev: true }) as string[];
    if (!keys.length) return [];
    const raws = await Promise.all(keys.map((k) => kv.get<string>(k)));
    return raws
      .filter((r): r is string => !!r)
      .map((r) => JSON.parse(r) as TradeLog);
  } catch {
    return null;
  }
}

// ── Delete by key ─────────────────────────────────────────────────────────────
export async function deleteTradeLog(ts: string, ticker: string): Promise<boolean> {
  if (!isKvReady()) return false;
  try {
    const key = tradeKey(ts, ticker);
    await Promise.all([
      kv.del(key),
      kv.zrem(IDX_ALL, key),
      kv.zrem(tickerIdxKey(ticker), key),
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
    // Fetch all trade keys (up to 1000)
    const keys = await kv.zrange(IDX_ALL, 0, 999, { rev: true }) as string[];
    if (!keys.length) {
      return { total: 0, entries: 0, exits: 0, tpHits: 0, slHits: 0, manualExits: 0, winRate: null, byRank: {} };
    }
    const raws = await Promise.all(keys.map((k) => kv.get<string>(k)));
    const logs: TradeLog[] = raws
      .filter((r): r is string => !!r)
      .map((r) => JSON.parse(r) as TradeLog);

    let entries = 0, tpHits = 0, slHits = 0, manualExits = 0;
    const byRank: TradeStats["byRank"] = {};

    for (const log of logs) {
      if (log.action === "entry") {
        entries++;
        const rank = log.bell_rank_at_entry ?? "N/A";
        if (!byRank[rank]) byRank[rank] = { entries: 0, tpHits: 0, slHits: 0, winRate: null };
        byRank[rank].entries++;
      } else if (log.action === "exit_tp") {
        tpHits++;
        // Attach to entry rank via linked_entry_id (best-effort)
      } else if (log.action === "exit_sl") {
        slHits++;
      } else if (log.action === "exit_manual") {
        manualExits++;
      }
    }

    const decidedExits = tpHits + slHits;
    const winRate = decidedExits > 0 ? Math.round((tpHits / decidedExits) * 100) : null;

    // Rank-level win rate (approximation: entries vs exits for same rank)
    for (const rank of Object.keys(byRank)) {
      const r = byRank[rank];
      const decided = r.tpHits + r.slHits;
      r.winRate = decided > 0 ? Math.round((r.tpHits / decided) * 100) : null;
    }

    return {
      total: logs.length,
      entries,
      exits: tpHits + slHits + manualExits,
      tpHits,
      slHits,
      manualExits,
      winRate,
      byRank,
    };
  } catch {
    return null;
  }
}
