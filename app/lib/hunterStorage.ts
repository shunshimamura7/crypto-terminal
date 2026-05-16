"use client";

import type { HunterRecord } from "./types/hunter";
import { HUNTER_PATTERN_META } from "./types/hunter";

const STORAGE_KEY = "bell:hunter:records";
const MAX_RECORDS = 500;

export function getHunterRecords(): HunterRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    records.push(record);
    const trimmed = records.slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

export function updateHunterRecord(id: string, updates: Partial<HunterRecord>): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return;
    records[idx] = { ...records[idx], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch { /* ignore */ }
}

export function deleteHunterRecord(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch { /* ignore */ }
}

export function exportHunterCSV(): string {
  const records = getHunterRecords();
  const header = [
    "id", "symbol", "recordedAt", "futuresListedAt", "spotListedAt",
    "hoursFromFutures", "hoursFromSpot", "matchedPatterns", "patternTriggered",
    "entryPrice", "athPrice", "athDropPct", "volumeRatio", "frAtEntry", "priceChange24h",
    "sl", "tp1", "tp2", "rrRatio",
    "status", "resolvedAt", "resolvedPrice", "slReason",
    "btcPrice", "fearGreed", "marketPhase",
  ].join(",");

  const rows = records.map(r => [
    r.id,
    r.symbol,
    r.recordedAt,
    r.futuresListedAt,
    r.spotListedAt ?? "",
    r.hoursFromFutures,
    r.hoursFromSpot ?? "",
    r.matchedPatterns.join("|"),
    r.patternTriggered,
    r.entryPrice,
    r.athPrice,
    r.athDropPct,
    r.volumeRatio,
    r.frAtEntry,
    r.priceChange24h,
    r.sl,
    r.tp1,
    r.tp2,
    r.rrRatio,
    r.status,
    r.resolvedAt ?? "",
    r.resolvedPrice ?? "",
    r.slReason ?? "",
    r.marketContext?.btcPrice ?? "",
    r.marketContext?.fearGreed ?? "",
    r.marketContext?.marketPhase ?? "",
  ].join(","));

  return [header, ...rows].join("\n");
}

export function getHunterStats(records: HunterRecord[]) {
  const resolved = records.filter(r =>
    ["tp1_hit", "tp2_hit", "sl_hit"].includes(r.status)
  );
  const wins = resolved.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit").length;
  const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 0;

  const totalR = resolved.reduce((sum, r) => {
    if (r.status === "tp2_hit") return sum + r.rrRatio;
    if (r.status === "tp1_hit") return sum + 1;
    return sum - 1;
  }, 0);
  const expectedValue = resolved.length > 0 ? totalR / resolved.length : 0;

  const grossWin  = resolved.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit")
    .reduce((s, r) => s + (r.status === "tp2_hit" ? r.rrRatio : 1), 0);
  const grossLoss = resolved.filter(r => r.status === "sl_hit").length;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  return {
    total: records.length,
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    winRate,
    expectedValue,
    profitFactor,
  };
}

export function getPatternStats(records: HunterRecord[]) {
  const resolved = records.filter(r =>
    ["tp1_hit", "tp2_hit", "sl_hit"].includes(r.status)
  );
  const patternKeys = ["P1", "P2", "P3", "P4", "P5"] as const;
  return patternKeys.map(p => {
    const pRecs = resolved.filter(r => r.patternTriggered === p);
    const wins  = pRecs.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit").length;
    const avgRR = pRecs.length > 0
      ? pRecs.reduce((s, r) => s + r.rrRatio, 0) / pRecs.length
      : 0;
    return {
      pattern: p,
      name: HUNTER_PATTERN_META[p].name,
      total: pRecs.length,
      wins,
      losses: pRecs.length - wins,
      winRate: pRecs.length > 0 ? (wins / pRecs.length) * 100 : 0,
      avgRR,
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
    ["tp1_hit", "tp2_hit", "sl_hit"].includes(r.status)
  );
  return HOUR_BUCKETS.map(b => {
    const bRecs = resolved.filter(r =>
      r.hoursFromFutures >= b.min && r.hoursFromFutures < b.max
    );
    const wins = bRecs.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit").length;
    return {
      label: b.label,
      total: bRecs.length,
      wins,
      winRate: bRecs.length > 0 ? (wins / bRecs.length) * 100 : 0,
    };
  });
}
