"use client";

import type { HunterRecord } from "./listingHunterRecords";
import { HUNTER_RECORDS_KEY } from "./listingHunterRecords";

const MAX_RECORDS = 500;

export function getHunterRecords(): HunterRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HUNTER_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HunterRecord[];
  } catch { return []; }
}

export function saveHunterRecord(record: HunterRecord): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords();
    const idx = records.findIndex(r => r.id === record.id);
    if (idx >= 0) records[idx] = record;
    else records.push(record);
    localStorage.setItem(HUNTER_RECORDS_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch { /* quota */ }
}

export function updateHunterRecord(id: string, updates: Partial<HunterRecord>): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return;
    records[idx] = { ...records[idx], ...updates };
    localStorage.setItem(HUNTER_RECORDS_KEY, JSON.stringify(records));
  } catch { /* ignore */ }
}

export function deleteHunterRecord(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords().filter(r => r.id !== id);
    localStorage.setItem(HUNTER_RECORDS_KEY, JSON.stringify(records));
  } catch { /* ignore */ }
}

export function exportHunterCSV(): string {
  const records = getHunterRecords();
  const header = [
    "id", "symbol", "status", "entryAt", "entryPrice", "tpPrice", "slPrice",
    "deadline", "closedAt", "closeReason", "finalPnlPct",
    "maxDrawdownPct", "maxAdversePct", "hoursSinceListing", "recordedManually",
  ].join(",");
  const rows = records.map(r => [
    r.id, r.symbol, r.status, r.entryAt, r.entryPrice, r.tpPrice, r.slPrice,
    r.deadline, r.closedAt ?? "", r.closeReason ?? "", r.finalPnlPct ?? "",
    r.maxDrawdownPct ?? "", r.maxAdversePct ?? "", r.hoursSinceListing, r.recordedManually,
  ].join(","));
  return [header, ...rows].join("\n");
}

export function getHunterStats(records: HunterRecord[]) {
  const resolved = records.filter(r =>
    r.status === "win" || r.status === "loss" || r.status === "timeout"
  );
  const wins = resolved.filter(r => r.status === "win").length;
  const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 0;

  const withPnl = resolved.filter(r => r.finalPnlPct !== undefined);
  const expectedValue = withPnl.length > 0
    ? withPnl.reduce((s, r) => s + r.finalPnlPct!, 0) / withPnl.length
    : 0;

  const grossWin  = withPnl.filter(r => r.status === "win")
    .reduce((s, r) => s + r.finalPnlPct!, 0);
  const grossLoss = Math.abs(withPnl.filter(r => r.status !== "win")
    .reduce((s, r) => s + r.finalPnlPct!, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  return {
    total: records.length,
    resolved: resolved.length,
    wins,
    losses: resolved.filter(r => r.status === "loss").length,
    winRate,
    expectedValue,
    profitFactor,
  };
}

// closeReason をパターン代替として使用（listingHunterRecords に patternTriggered は存在しない）
export function getPatternStats(records: HunterRecord[]) {
  const resolved = records.filter(r =>
    r.status === "win" || r.status === "loss" || r.status === "timeout"
  );
  const groups = [
    { key: "TP到達",      filter: (r: HunterRecord) => r.closeReason === "tp_hit" },
    { key: "SL到達",      filter: (r: HunterRecord) => r.closeReason === "sl_hit" },
    { key: "タイムアウト", filter: (r: HunterRecord) => r.closeReason === "timeout" },
    { key: "未分類",      filter: (r: HunterRecord) => !r.closeReason },
  ];
  return groups.map(g => {
    const pRecs = resolved.filter(g.filter);
    const wins  = pRecs.filter(r => r.status === "win").length;
    const withPnl = pRecs.filter(r => r.finalPnlPct !== undefined);
    const avgPnl = withPnl.length > 0
      ? withPnl.reduce((s, r) => s + r.finalPnlPct!, 0) / withPnl.length
      : 0;
    return {
      pattern: g.key,
      name: g.key,
      total: pRecs.length,
      wins,
      losses: pRecs.length - wins,
      winRate: pRecs.length > 0 ? (wins / pRecs.length) * 100 : 0,
      avgRR: avgPnl,
    };
  });
}

const HOUR_BUCKETS = [
  { label: "0-6h",   min: 0,  max: 6  },
  { label: "6-12h",  min: 6,  max: 12 },
  { label: "12-24h", min: 12, max: 24 },
  { label: "24-48h", min: 24, max: 48 },
  { label: "48-72h", min: 48, max: 72 },
];

export function getHourBucketStats(records: HunterRecord[]) {
  const resolved = records.filter(r =>
    r.status === "win" || r.status === "loss" || r.status === "timeout"
  );
  return HOUR_BUCKETS.map(b => {
    const bRecs = resolved.filter(r =>
      r.hoursSinceListing >= b.min && r.hoursSinceListing < b.max
    );
    const wins = bRecs.filter(r => r.status === "win").length;
    return {
      label: b.label,
      total: bRecs.length,
      wins,
      winRate: bRecs.length > 0 ? (wins / bRecs.length) * 100 : 0,
    };
  });
}

export async function checkAndUpdateHunterRecords(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const records = getHunterRecords();
  const active = records.filter(r => r.status === "open");
  if (active.length === 0) return false;

  const apiRecords = active.map(r => ({
    id: r.id,
    symbol: r.symbol,
    entryAt: r.entryAt,
    entryPrice: r.entryPrice,
    tpPrice: r.tpPrice,
    slPrice: r.slPrice,
    deadline: r.deadline,
  }));

  let changed = false;
  for (let i = 0; i < apiRecords.length; i += 10) {
    const batch = apiRecords.slice(i, i + 10);
    try {
      const res = await fetch("/api/listing-hunter/check-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: batch }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const json = await res.json() as {
        results: Array<{
          id: string;
          firstHit: "tp" | "sl" | "none";
          firstHitAt?: string;
          isExpired: boolean;
          currentPrice: number;
          suggestedStatus: "open" | "win" | "loss" | "timeout";
        }>;
      };
      const now = new Date().toISOString();
      for (const result of json.results) {
        const idx = records.findIndex(r => r.id === result.id);
        if (idx === -1) continue;
        if (result.suggestedStatus === "win") {
          records[idx] = { ...records[idx], status: "win", closedAt: result.firstHitAt ?? now, closeReason: "tp_hit" };
          changed = true;
        } else if (result.suggestedStatus === "loss") {
          records[idx] = { ...records[idx], status: "loss", closedAt: result.firstHitAt ?? now, closeReason: "sl_hit" };
          changed = true;
        } else if (result.suggestedStatus === "timeout") {
          records[idx] = { ...records[idx], status: "timeout", closedAt: now, closeReason: "timeout" };
          changed = true;
        }
      }
    } catch { /* network error — skip batch */ }
  }

  if (changed) {
    localStorage.setItem(HUNTER_RECORDS_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  }
  return changed;
}
