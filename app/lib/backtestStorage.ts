"use client";

const STORAGE_KEY = "bell:backtest:records";
const MAX_RECORDS = 1000;

export type BacktestStatus = "active" | "tp1_hit" | "tp2_hit" | "tp3_hit" | "sl_hit" | "expired";

export interface BacktestRecord {
  id: string;
  symbol: string;
  score: number;
  scoreMax: number;
  recordedAt: number;
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rrRatio: number;
  trendDirection: string;
  status: BacktestStatus;
  resolvedAt: number | null;
  resolvedPrice: number | null;
  maxDrawdown: number | null;
  maxProfit: number | null;
  currentPrice: number | null;
  lastCheckedAt: number | null;
}

export function getRecords(): BacktestRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BacktestRecord[]) : [];
  } catch { return []; }
}

export function saveRecords(records: BacktestRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch { /* ignore quota errors */ }
}

export function clearRecords(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
