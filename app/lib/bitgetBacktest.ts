import type { BitgetShortCandidate } from "@/app/lib/bitgetScorer";

const STORAGE_KEY = "bitgetBtRecords";
const EXPIRY_MS   = 7 * 24 * 60 * 60 * 1000;

export interface BitgetBtRecord {
  symbol:         string;
  entryPrice:     number;
  entryTime:      number;
  score:          number;
  stopLoss:       number;
  tp1:            number;
  tp2:            number;
  recommendedLev: 1 | 2;
  fundingRate:    number;
  status:         "active" | "tp1" | "tp2" | "sl" | "expired";
  exitPrice?:     number;
  exitTime?:      number;
  pnlPct?:        number; // (entry - exit) / entry * 100 * lev
}

export interface BitgetBtStats {
  total:       number;
  resolved:    number;
  active:      number;
  wins:        number;
  losses:      number;
  winRate:     number;
  avgPnl:      number;
  avgRR:       number;
  expectancy:  number;
  bestPnl:     number;
  worstPnl:    number;
  byScore:     Array<{ range: string; wins: number; losses: number; winRate: number }>;
}

export function loadRecords(): BitgetBtRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BitgetBtRecord[]) : [];
  } catch {
    return [];
  }
}

function saveRecords(records: BitgetBtRecord[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
}

export function resetRecords(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// Add new candidates (skip already-recorded symbol+day pairs)
export function recordCandidates(candidates: BitgetShortCandidate[]): BitgetBtRecord[] {
  const records = loadRecords();
  const today   = Math.floor(Date.now() / 86_400_000);
  const existing = new Set(records.map(r => `${r.symbol}:${Math.floor(r.entryTime / 86_400_000)}`));

  for (const c of candidates) {
    if (!c.tradeSetup || c.shortScore < 10) continue;
    const key = `${c.symbol}:${today}`;
    if (existing.has(key)) continue;
    existing.add(key);
    records.push({
      symbol:         c.symbol,
      entryPrice:     c.currentPrice,
      entryTime:      Date.now(),
      score:          c.shortScore,
      stopLoss:       c.tradeSetup.sl,
      tp1:            c.tradeSetup.tp1,
      tp2:            c.tradeSetup.tp2,
      recommendedLev: Math.min(2, c.recommendedLev) as 1 | 2,
      fundingRate:    c.fundingRate ?? 0,
      status:         "active",
    });
  }

  saveRecords(records);
  return records;
}

// Settle active records against current scan prices
export function settleRecords(currentPrices: Map<string, number>): BitgetBtRecord[] {
  const records = loadRecords();
  let changed   = false;
  const now     = Date.now();

  for (const r of records) {
    if (r.status !== "active") continue;
    const price = currentPrices.get(r.symbol);

    if (now - r.entryTime > EXPIRY_MS) {
      r.status    = "expired";
      r.exitPrice = price ?? r.entryPrice;
      r.exitTime  = now;
      r.pnlPct    = (r.entryPrice - r.exitPrice) / r.entryPrice * 100 * r.recommendedLev;
      changed     = true;
      continue;
    }

    if (price === undefined) continue;

    if (price >= r.stopLoss) {
      r.status    = "sl";
      r.exitPrice = r.stopLoss;
      r.exitTime  = now;
      r.pnlPct    = (r.entryPrice - r.stopLoss) / r.entryPrice * 100 * r.recommendedLev;
      changed     = true;
    } else if (price <= r.tp2) {
      r.status    = "tp2";
      r.exitPrice = r.tp2;
      r.exitTime  = now;
      r.pnlPct    = (r.entryPrice - r.tp2) / r.entryPrice * 100 * r.recommendedLev;
      changed     = true;
    } else if (price <= r.tp1) {
      r.status    = "tp1";
      r.exitPrice = r.tp1;
      r.exitTime  = now;
      r.pnlPct    = (r.entryPrice - r.tp1) / r.entryPrice * 100 * r.recommendedLev;
      changed     = true;
    }
  }

  if (changed) saveRecords(records);
  return records;
}

export function calcStats(records: BitgetBtRecord[]): BitgetBtStats {
  const resolved = records.filter(r => r.status !== "active");
  const wins     = resolved.filter(r => r.status === "tp1" || r.status === "tp2");
  const losses   = resolved.filter(r => r.status === "sl"  || r.status === "expired");
  const pnls     = resolved.map(r => r.pnlPct ?? 0);

  const avgPnl   = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const bestPnl  = pnls.length > 0 ? Math.max(...pnls) : 0;
  const worstPnl = pnls.length > 0 ? Math.min(...pnls) : 0;
  const winRate  = resolved.length > 0 ? wins.length / resolved.length * 100 : 0;

  const rrVals = wins.map(r => {
    const risk = Math.abs((r.stopLoss - r.entryPrice) / r.entryPrice * 100 * r.recommendedLev);
    return risk > 0 ? (r.pnlPct ?? 0) / risk : 0;
  });
  const avgRR = rrVals.length > 0 ? rrVals.reduce((a, b) => a + b, 0) / rrVals.length : 0;

  const scoreRanges = [
    { range: "20-30", min: 20, max: 30 },
    { range: "15-19", min: 15, max: 19 },
    { range: "10-14", min: 10, max: 14 },
    { range: "0-9",   min: 0,  max:  9 },
  ];

  const byScore = scoreRanges.map(({ range, min, max }) => {
    const inRange = resolved.filter(r => r.score >= min && r.score <= max);
    const w       = inRange.filter(r => r.status === "tp1" || r.status === "tp2").length;
    return { range, wins: w, losses: inRange.length - w, winRate: inRange.length > 0 ? w / inRange.length * 100 : 0 };
  });

  return {
    total: records.length, resolved: resolved.length,
    active: records.filter(r => r.status === "active").length,
    wins: wins.length, losses: losses.length,
    winRate, avgPnl, avgRR, expectancy: avgPnl,
    bestPnl, worstPnl, byScore,
  };
}

export function exportCsv(records: BitgetBtRecord[]): void {
  const headers = [
    "symbol","entryPrice","entryTime","score","stopLoss",
    "tp1","tp2","lev","fundingRate","status",
    "exitPrice","exitTime","pnlPct",
  ];
  const rows = records.map(r => [
    r.symbol, r.entryPrice, new Date(r.entryTime).toISOString(),
    r.score, r.stopLoss.toFixed(8), r.tp1.toFixed(8), r.tp2.toFixed(8),
    r.recommendedLev, r.fundingRate, r.status,
    r.exitPrice?.toFixed(8) ?? "",
    r.exitTime ? new Date(r.exitTime).toISOString() : "",
    r.pnlPct?.toFixed(2) ?? "",
  ]);
  const csv  = [headers, ...rows].map(row => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `bitget-backtest-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
