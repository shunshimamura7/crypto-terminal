"use client";

import type { BitgetBacktestRecord } from "./bitgetBacktestStorage";

export interface BitgetBacktestStats {
  totalRecords: number;
  resolved:     number;
  active:       number;
  expired:      number;
  tp1Hits:      number;
  tp2Hits:      number;
  tp3Hits:      number;
  slHits:       number;
  winRate:      number;
  avgRR:        number;
  expectancy:   number;
  bestTrade:    { symbol: string; profit: number } | null;
  worstTrade:   { symbol: string; loss:   number } | null;
  byScore:      Record<string, { wins: number; losses: number; winRate: number }>;
  periodStart:  number | null;
  periodEnd:    number | null;
}

const SCORE_RANGES = ["10-12", "13-15", "16-30"] as const;

export function calculateStats(records: BitgetBacktestRecord[]): BitgetBacktestStats {
  const active   = records.filter(r => r.status === "active");
  const resolved = records.filter(r => r.status !== "active");
  const wins     = resolved.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit");
  const losses   = resolved.filter(r => r.status === "sl_hit");
  const expired  = resolved.filter(r => r.status === "expired");

  const winRate = resolved.length > 0 ? (wins.length / resolved.length) * 100 : 0;

  function realizedR(r: BitgetBacktestRecord): number {
    if (!r.resolvedPrice) return 0;
    const profit = r.resolvedPrice - r.entryPrice; // ロングなので上がれば利益
    const risk   = r.entryPrice - r.sl;
    return risk > 0 ? profit / risk : 0;
  }

  const realizedRRs = resolved.map(realizedR);
  const avgRR = realizedRRs.length > 0
    ? realizedRRs.reduce((a, b) => a + b, 0) / realizedRRs.length
    : 0;

  const avgWinR = wins.length > 0
    ? wins.map(realizedR).reduce((a, b) => a + b, 0) / wins.length
    : 0;
  const avgLossR = losses.length > 0
    ? losses.map(r => Math.abs(realizedR(r))).reduce((a, b) => a + b, 0) / losses.length
    : 0;

  const expectancy = (winRate / 100) * avgWinR - ((100 - winRate) / 100) * avgLossR;

  let bestTrade:  { symbol: string; profit: number } | null = null;
  let worstTrade: { symbol: string; loss:   number } | null = null;

  for (const r of wins) {
    const profit = r.resolvedPrice ? ((r.resolvedPrice - r.entryPrice) / r.entryPrice) * 100 : 0;
    if (!bestTrade || profit > bestTrade.profit) bestTrade = { symbol: r.symbol, profit };
  }
  for (const r of losses) {
    const loss = r.resolvedPrice ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice) * 100 : 0;
    if (!worstTrade || loss > worstTrade.loss) worstTrade = { symbol: r.symbol, loss };
  }

  const byScore: Record<string, { wins: number; losses: number; winRate: number }> = {};
  for (const range of SCORE_RANGES) {
    const [min, max] = range.split("-").map(Number);
    const inRange   = resolved.filter(r => r.score >= min && r.score <= max);
    const rangeWins = inRange.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit");
    byScore[range] = {
      wins:    rangeWins.length,
      losses:  inRange.length - rangeWins.length,
      winRate: inRange.length > 0 ? (rangeWins.length / inRange.length) * 100 : 0,
    };
  }

  const timestamps = records.map(r => r.recordedAt);

  return {
    totalRecords: records.length,
    resolved:  resolved.length,
    active:    active.length,
    expired:   expired.length,
    tp1Hits:   resolved.filter(r => r.status === "tp1_hit").length,
    tp2Hits:   resolved.filter(r => r.status === "tp2_hit").length,
    tp3Hits:   resolved.filter(r => r.status === "tp3_hit").length,
    slHits:    losses.length,
    winRate,
    avgRR,
    expectancy,
    bestTrade,
    worstTrade,
    byScore,
    periodStart: timestamps.length > 0 ? Math.min(...timestamps) : null,
    periodEnd:   timestamps.length > 0 ? Math.max(...timestamps) : null,
  };
}
