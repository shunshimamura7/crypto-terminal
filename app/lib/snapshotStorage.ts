"use client";

const STORAGE_KEY = "bell:scan:snapshots";
const MAX_SNAPSHOTS = 10;
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1時間: 連打防止

export interface SnapshotEntry {
  score: number;
  athDrop: number;
  volRatio: number;
  fr: number | null;
  oi: number;
  price: number;
}

export interface ScanSnapshot {
  timestamp: number;
  data: Record<string, SnapshotEntry>;
}

export function saveSnapshot(snap: ScanSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getSnapshots();
    const last = existing[existing.length - 1];
    // 1時間以内の連打はスキップ（上書き）
    if (last && snap.timestamp - last.timestamp < MIN_INTERVAL_MS) {
      existing[existing.length - 1] = snap;
    } else {
      existing.push(snap);
    }
    const trimmed = existing.slice(-MAX_SNAPSHOTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

export function getSnapshots(): ScanSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ScanSnapshot[];
  } catch {
    return [];
  }
}

// 指定シンボルの直近N回のFRを返す（古い順）
export function getFRHistory(symbol: string, snapshots: ScanSnapshot[], limit = 10): Array<number | null> {
  return snapshots
    .slice(-limit)
    .map(s => s.data[symbol]?.fr ?? null);
}

// 連続プラスFRカウント（最新から遡る）
export function getConsecutivePositiveFR(symbol: string, snapshots: ScanSnapshot[]): number {
  const history = getFRHistory(symbol, snapshots).reverse();
  let count = 0;
  for (const fr of history) {
    if (fr !== null && fr > 0) count++;
    else break;
  }
  return count;
}
