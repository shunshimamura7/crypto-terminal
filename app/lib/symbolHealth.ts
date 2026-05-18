"use client";

import type { BacktestRecord } from "./backtestStorage";

const STORAGE_KEY = "bell:symbolHealth";
const MAX_RECORDS = 1000;
const MAX_HISTORY = 10;
const EXPIRE_DAYS = 30;

interface SymbolHealthEntry {
  symbol: string;
  recent: boolean[];   // last MAX_HISTORY results: true=success, false=failure
  lastChecked: number;
  lastSuccess: number; // 0 if never
}

export interface SymbolHealth {
  symbol: string;
  attempts: number;
  successes: number;
  lastChecked: number;
  lastSuccess: number;
}

function loadEntries(): Map<string, SymbolHealthEntry> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as SymbolHealthEntry[];
    if (!Array.isArray(parsed)) return new Map();
    const expireCutoff = Date.now() - EXPIRE_DAYS * 86_400_000;
    const map = new Map<string, SymbolHealthEntry>();
    for (const e of parsed) {
      if (!e.symbol || e.lastChecked < expireCutoff) continue;
      map.set(e.symbol, e);
    }
    return map;
  } catch { return new Map(); }
}

function saveEntries(map: Map<string, SymbolHealthEntry>): void {
  if (typeof window === "undefined") return;
  try {
    const entries = [...map.values()].sort((a, b) => b.lastChecked - a.lastChecked);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECORDS)));
  } catch { /* ignore quota errors */ }
}

function toHealth(e: SymbolHealthEntry): SymbolHealth {
  const successes = e.recent.filter(x => x).length;
  return { symbol: e.symbol, attempts: e.recent.length, successes, lastChecked: e.lastChecked, lastSuccess: e.lastSuccess };
}

export function recordAttempt(symbol: string, success: boolean): void {
  const map = loadEntries();
  const e = map.get(symbol) ?? { symbol, recent: [], lastChecked: 0, lastSuccess: 0 };
  e.recent = [...e.recent.slice(-(MAX_HISTORY - 1)), success];
  e.lastChecked = Date.now();
  if (success) e.lastSuccess = Date.now();
  map.set(symbol, e);
  saveEntries(map);
}

// Batch update: record Phase A outcomes in a single localStorage write
export function recordScanResults(phaseASucceeded: string[], sentAsActive: string[]): void {
  if (typeof window === "undefined") return;
  if (phaseASucceeded.length === 0 && sentAsActive.length === 0) return;
  const map = loadEntries();
  const now = Date.now();
  const succeededSet = new Set(phaseASucceeded);
  const processed = new Set<string>();

  for (const sym of phaseASucceeded) {
    const e = map.get(sym) ?? { symbol: sym, recent: [], lastChecked: 0, lastSuccess: 0 };
    e.recent = [...e.recent.slice(-(MAX_HISTORY - 1)), true];
    e.lastChecked = now;
    e.lastSuccess = now;
    map.set(sym, e);
    processed.add(sym);
  }

  for (const sym of sentAsActive) {
    if (processed.has(sym) || succeededSet.has(sym)) continue;
    const e = map.get(sym) ?? { symbol: sym, recent: [], lastChecked: 0, lastSuccess: 0 };
    e.recent = [...e.recent.slice(-(MAX_HISTORY - 1)), false];
    e.lastChecked = now;
    map.set(sym, e);
  }

  saveEntries(map);
}

export function getHealthMap(): Map<string, SymbolHealth> {
  const map = loadEntries();
  const result = new Map<string, SymbolHealth>();
  for (const [sym, e] of map) result.set(sym, toHealth(e));
  return result;
}

export function getSuccessRate(symbol: string): number {
  const map = loadEntries();
  const e = map.get(symbol);
  if (!e || e.recent.length === 0) return 0.5; // unknown = neutral
  return e.recent.filter(x => x).length / e.recent.length;
}

// Returns symbols with ≥3 attempts and successRate ≥ threshold
export function getActiveSymbols(threshold = 0.7): Set<string> {
  const map = loadEntries();
  const result = new Set<string>();
  for (const [sym, e] of map) {
    if (e.recent.length >= 3 && e.recent.filter(x => x).length / e.recent.length >= threshold) {
      result.add(sym);
    }
  }
  return result;
}

// Returns symbols with ≥3 attempts and successRate < threshold
export function getDeadSymbols(threshold = 0.1): Set<string> {
  const map = loadEntries();
  const result = new Set<string>();
  for (const [sym, e] of map) {
    if (e.recent.length >= 3 && e.recent.filter(x => x).length / e.recent.length < threshold) {
      result.add(sym);
    }
  }
  return result;
}

export function clearHealth(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ── 危険銘柄リスト (SL 3回以上ヒット) ──────────────────────────────────────
const DANGER_KEY = "bell:dangerSymbols";
const SL_THRESHOLD = 3;

export interface DangerSymbol {
  symbol: string;
  slCount: number;
  totalLossPct: number;
  reason: string;
  blacklistedAt: string;
}

function loadDangerList(): Map<string, DangerSymbol> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(DANGER_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as DangerSymbol[];
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.map(d => [d.symbol, d]));
  } catch { return new Map(); }
}

function saveDangerList(map: Map<string, DangerSymbol>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DANGER_KEY, JSON.stringify([...map.values()]));
  } catch { /* ignore quota errors */ }
}

export function getDangerSymbols(): DangerSymbol[] {
  return [...loadDangerList().values()];
}

export function isDangerSymbol(symbol: string): boolean {
  return loadDangerList().has(symbol);
}

export function addToDangerList(symbol: string, reason: string, slCount = SL_THRESHOLD, totalLossPct = 0): void {
  const map = loadDangerList();
  if (map.has(symbol)) return;
  map.set(symbol, {
    symbol,
    slCount,
    totalLossPct,
    reason,
    blacklistedAt: new Date().toISOString(),
  });
  saveDangerList(map);
}

export function removeFromDangerList(symbol: string): void {
  const map = loadDangerList();
  if (!map.has(symbol)) return;
  map.delete(symbol);
  saveDangerList(map);
}

// バックテスト記録から自動的に危険銘柄リストを構築
export function buildDangerListFromRecords(records: BacktestRecord[]): void {
  if (typeof window === "undefined") return;
  const slMap = new Map<string, { count: number; totalLossPct: number }>();

  for (const r of records) {
    if (r.status !== "sl_hit") continue;
    const entry = slMap.get(r.symbol) ?? { count: 0, totalLossPct: 0 };
    entry.count++;
    entry.totalLossPct += ((r.sl - r.entryPrice) / r.entryPrice) * 100;
    slMap.set(r.symbol, entry);
  }

  const dangerMap = loadDangerList();
  let changed = false;
  for (const [symbol, { count, totalLossPct }] of slMap) {
    if (count >= SL_THRESHOLD && !dangerMap.has(symbol)) {
      dangerMap.set(symbol, {
        symbol,
        slCount: count,
        totalLossPct,
        reason: `SL ${count}回ヒット (累計損失 ${totalLossPct.toFixed(1)}%)`,
        blacklistedAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  if (changed) saveDangerList(dangerMap);
}
