export interface ScoreRecord {
  ticker: string
  date: string
  rank: string
  alpha: number
  risk: number
  price?: number
  savedAt: number
}

export interface RankChange {
  ticker: string
  from: string
  to: string
  direction: "up" | "down"
  alphaDelta: number
}

const RANK_ORDER = ["S","A","B","C","D","E","F"];

export function saveScore(record: ScoreRecord): void {
  if (typeof window === "undefined") return;
  const key = `score_${record.ticker.toUpperCase()}`;
  const existing: ScoreRecord[] = JSON.parse(localStorage.getItem(key) || "[]");
  existing.unshift(record);
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 30)));
}

export function getPreviousScore(ticker: string): ScoreRecord | null {
  if (typeof window === "undefined") return null;
  const key = `score_${ticker.toUpperCase()}`;
  const records: ScoreRecord[] = JSON.parse(localStorage.getItem(key) || "[]");
  return records.length >= 2 ? records[1] : null;
}

export function detectRankChange(current: ScoreRecord): RankChange | null {
  const prev = getPreviousScore(current.ticker);
  if (!prev || prev.rank === current.rank) return null;
  const prevIdx = RANK_ORDER.indexOf(prev.rank);
  const currIdx = RANK_ORDER.indexOf(current.rank);
  return {
    ticker: current.ticker,
    from: prev.rank,
    to: current.rank,
    direction: currIdx < prevIdx ? "up" : "down",
    alphaDelta: current.alpha - prev.alpha,
  };
}

export function getAllHistory(): { ticker: string; records: ScoreRecord[] }[] {
  if (typeof window === "undefined") return [];
  return Object.keys(localStorage)
    .filter(k => k.startsWith("score_"))
    .map(k => ({
      ticker: k.replace("score_", ""),
      records: JSON.parse(localStorage.getItem(k) || "[]"),
    }));
}
