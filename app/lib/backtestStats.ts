"use client";

import type { BacktestRecord } from "./backtestStorage";

export interface BacktestStats {
  totalRecords: number;
  resolved: number;
  active: number;
  pending: number;
  expired: number;
  tp1Hits: number;
  tp2Hits: number;
  tp3Hits: number;
  slHits: number;
  winRate: number;
  avgRR: number;
  expectancy: number;
  bestTrade:  { symbol: string; profit: number } | null;
  worstTrade: { symbol: string; loss:   number } | null;
  byScore: Record<string, { wins: number; losses: number; winRate: number }>;
  periodStart: number | null;
  periodEnd:   number | null;
  // Phase3 Task2: 高度指標
  profitFactor: number;
  recoveryFactor: number;
  calmarRatio: number;
  avgDaysToResolve: number;
  medianDaysToResolve: number;
  // 信頼度
  apiVerifiedCount: number;
  scanOnlyCount: number;
}

const SCORE_RANGES = ["8-9", "10-11", "12-13", "14-15", "16-17", "18-19", "20-21", "22-23"] as const;

export function calculateStats(
  records: BacktestRecord[],
  presetFilter?: "low_lev" | "new_listing" | "high_lev" | "unknown" | "all",
): BacktestStats {
  const filtered = presetFilter && presetFilter !== "all"
    ? records.filter(r => r.preset === presetFilter)
    : records;
  records = filtered;
  const isPending = (s: string) => s.startsWith("pending_");
  const active   = records.filter(r => r.status === "active" || isPending(r.status));
  const pending  = records.filter(r => isPending(r.status));
  const resolved = records.filter(r => r.status !== "active" && !isPending(r.status));
  const wins     = resolved.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit");
  const losses   = resolved.filter(r => r.status === "sl_hit");
  const expired  = resolved.filter(r => r.status === "expired");

  const winRate = resolved.length > 0 ? (wins.length / resolved.length) * 100 : 0;

  function realizedR(r: BacktestRecord): number {
    if (!r.resolvedPrice) return 0;
    const profit = r.entryPrice - r.resolvedPrice; // ショートなので下がれば利益
    const risk   = r.sl - r.entryPrice;
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

  // ベスト/ワーストトレード
  let bestTrade:  { symbol: string; profit: number } | null = null;
  let worstTrade: { symbol: string; loss:   number } | null = null;

  for (const r of wins) {
    const profit = r.resolvedPrice ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice) * 100 : 0;
    if (!bestTrade || profit > bestTrade.profit) bestTrade = { symbol: r.symbol, profit };
  }
  for (const r of losses) {
    const loss = r.resolvedPrice ? ((r.resolvedPrice - r.entryPrice) / r.entryPrice) * 100 : 0;
    if (!worstTrade || loss > worstTrade.loss) worstTrade = { symbol: r.symbol, loss };
  }

  // スコア帯別勝率 (2pt刻み)
  const byScore: Record<string, { wins: number; losses: number; winRate: number }> = {};
  for (const range of SCORE_RANGES) {
    const [minStr, maxStr] = range.split("-");
    const min = parseInt(minStr);
    const max = parseInt(maxStr);
    const inRange = resolved.filter(r => r.score >= min && r.score <= max);
    const w = inRange.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit").length;
    const l = inRange.filter(r => r.status === "sl_hit").length;
    byScore[range] = {
      wins:    w,
      losses:  l,
      winRate: w + l > 0 ? (w / (w + l)) * 100 : 0,
    };
  }

  const timestamps = records.map(r => r.recordedAt);

  // ── Phase3 Task2: 高度指標 ──

  // Profit Factor
  let totalProfit = 0;
  let totalLoss   = 0;
  for (const r of resolved) {
    if (!r.resolvedPrice) continue;
    const pnlPct = ((r.entryPrice - r.resolvedPrice) / r.entryPrice) * 100;
    if (pnlPct > 0) totalProfit += pnlPct;
    else totalLoss += Math.abs(pnlPct);
  }
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  // 最大DD (エクイティカーブ R ベース)
  let equity = 0;
  let peak   = 0;
  let maxDD  = 0;
  const sortedResolved = [...resolved].sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
  for (const r of sortedResolved) {
    equity += realizedR(r);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  const netR = realizedRRs.reduce((a, b) => a + b, 0);
  const recoveryFactor = maxDD > 0 ? netR / maxDD : netR > 0 ? Infinity : 0;

  // Calmar Ratio
  const periodDays = timestamps.length >= 2
    ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24)
    : 0;
  const annualReturnR = periodDays > 0 ? netR * (365 / periodDays) : 0;
  const calmarRatio   = maxDD > 0 ? annualReturnR / maxDD : 0;

  // 平均・中央値決着日数
  const resolveDays = resolved
    .filter(r => r.resolvedAt)
    .map(r => ((r.resolvedAt ?? r.recordedAt) - r.recordedAt) / (1000 * 60 * 60 * 24));
  const avgDaysToResolve = resolveDays.length > 0
    ? resolveDays.reduce((a, b) => a + b, 0) / resolveDays.length
    : 0;
  const sortedDays = [...resolveDays].sort((a, b) => a - b);
  const mid = sortedDays.length;
  const medianDaysToResolve = mid > 0
    ? mid % 2 === 0
      ? (sortedDays[mid / 2 - 1] + sortedDays[mid / 2]) / 2
      : sortedDays[Math.floor(mid / 2)]
    : 0;

  return {
    totalRecords: records.length,
    resolved:  resolved.length,
    active:    active.length,
    pending:   pending.length,
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
    profitFactor,
    recoveryFactor,
    calmarRatio,
    avgDaysToResolve,
    medianDaysToResolve,
    apiVerifiedCount: resolved.filter(r => r.priceSource === "direct_api").length,
    scanOnlyCount:    resolved.filter(r => !r.priceSource || r.priceSource === "scan").length,
  };
}
