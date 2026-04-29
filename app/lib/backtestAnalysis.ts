"use client";

import type { BacktestRecord } from "./backtestStorage";

// ── API検証済みのみの統計 ──────────────────────────────────────────────────────
export interface VerifiedStats {
  count: number;
  winRate: number;
  profitFactor: number;
  avgRR: number;
}

// ── スコア×指標マトリクス ─────────────────────────────────────────────────────
export interface ScoreComboWinRate {
  label: string;
  wins: number;
  total: number;
  winRate: number;
}

// ── 市場フェーズ別負けパターン ───────────────────────────────────────────────
export interface PhaseLossPattern {
  phase: "risk_on" | "neutral" | "risk_off";
  label: string;
  wins: number;
  losses: number;
  winRate: number;
  avgLossPct: number;
}

// ── 時間帯別勝率 ──────────────────────────────────────────────────────────────
export interface TimezoneWinRate {
  zone: "asia" | "europe" | "us";
  label: string;
  hours: string;
  wins: number;
  losses: number;
  winRate: number;
}

export interface BacktestAnalysis {
  verifiedStats: VerifiedStats;
  topCombos: ScoreComboWinRate[];
  phaseLossPatterns: PhaseLossPattern[];
  timezoneWinRates: TimezoneWinRate[];
}

function isWin(r: BacktestRecord): boolean {
  return r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit";
}
function isResolved(r: BacktestRecord): boolean {
  return r.status !== "active" && !r.status.startsWith("pending_") && r.status !== "expired";
}

export function calcVerifiedStats(records: BacktestRecord[]): VerifiedStats {
  const verified = records.filter(r => isResolved(r) && r.priceSource === "direct_api");
  if (verified.length === 0) return { count: 0, winRate: 0, profitFactor: 0, avgRR: 0 };

  const wins   = verified.filter(isWin);
  const losses = verified.filter(r => r.status === "sl_hit");
  const winRate = (wins.length / verified.length) * 100;

  let totalGain = 0, totalLoss = 0;
  let sumRR = 0;
  for (const r of verified) {
    if (!r.resolvedPrice) continue;
    const pnlPct = ((r.entryPrice - r.resolvedPrice) / r.entryPrice) * 100;
    const risk   = r.sl - r.entryPrice;
    const rr     = risk > 0 ? (r.entryPrice - r.resolvedPrice) / risk : 0;
    sumRR += rr;
    if (pnlPct > 0) totalGain += pnlPct;
    else totalLoss += Math.abs(pnlPct);
  }

  return {
    count:        verified.length,
    winRate,
    profitFactor: totalLoss > 0 ? totalGain / totalLoss : totalGain > 0 ? Infinity : 0,
    avgRR:        verified.length > 0 ? sumRR / verified.length : 0,
  };
}

// dropScore + patternScore の組み合わせ別勝率（上位・下位を比較）
export function calcScoreComboWinRates(records: BacktestRecord[]): ScoreComboWinRate[] {
  const resolved = records.filter(isResolved);
  if (resolved.length < 5) return [];

  type ComboKey = string;
  const map = new Map<ComboKey, { wins: number; total: number }>();

  for (const r of resolved) {
    const bd = r.scoreBreakdown;
    if (!bd) continue;
    const drop    = bd.dropScore    ?? 0;
    const pattern = bd.patternScore ?? 0;
    const fr      = bd.frScore      ?? 0;
    const key     = `drop${drop}+pat${pattern}+fr${fr}`;
    const entry   = map.get(key) ?? { wins: 0, total: 0 };
    entry.total++;
    if (isWin(r)) entry.wins++;
    map.set(key, entry);
  }

  return [...map.entries()]
    .filter(([, v]) => v.total >= 2)
    .map(([key, v]) => {
      const [dropPart, patPart, frPart] = key.split("+");
      return {
        label:   `ATH下落${dropPart.replace("drop", "")} パターン${patPart.replace("pat", "")} FR${frPart.replace("fr", "")}`,
        wins:    v.wins,
        total:   v.total,
        winRate: (v.wins / v.total) * 100,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

export function calcPhaseLossPatterns(records: BacktestRecord[]): PhaseLossPattern[] {
  const phases: Array<{ key: "risk_on" | "neutral" | "risk_off"; label: string }> = [
    { key: "risk_on",  label: "📈 RISK ON" },
    { key: "neutral",  label: "⚪ NEUTRAL" },
    { key: "risk_off", label: "📉 RISK OFF" },
  ];

  return phases.map(({ key, label }) => {
    const recs    = records.filter(r => isResolved(r) && r.marketContext?.marketPhase === key);
    const wins    = recs.filter(isWin);
    const losses  = recs.filter(r => r.status === "sl_hit");
    const winRate = recs.length > 0 ? (wins.length / recs.length) * 100 : 0;

    const avgLossPct = losses.length > 0
      ? losses.reduce((sum, r) => {
          if (!r.resolvedPrice) return sum;
          return sum + ((r.resolvedPrice - r.entryPrice) / r.entryPrice) * 100;
        }, 0) / losses.length
      : 0;

    return { phase: key, label, wins: wins.length, losses: losses.length, winRate, avgLossPct };
  });
}

export function calcTimezoneWinRates(records: BacktestRecord[]): TimezoneWinRate[] {
  // UTCの時間帯で分類: Asia 1-9, Europe 9-17, US 13-22 (overlap重複あり→単純分類)
  const zones: Array<{ zone: "asia" | "europe" | "us"; label: string; hours: string; from: number; to: number }> = [
    { zone: "asia",   label: "🌏 アジア",  hours: "01-09 UTC", from: 1,  to: 9  },
    { zone: "europe", label: "🌍 欧州",    hours: "09-17 UTC", from: 9,  to: 17 },
    { zone: "us",     label: "🌎 米国",    hours: "17-01 UTC", from: 17, to: 25 }, // 25=next day 1
  ];

  return zones.map(({ zone, label, hours, from, to }) => {
    const recs = records.filter(r => {
      if (!isResolved(r)) return false;
      const h = new Date(r.recordedAt).getUTCHours();
      if (zone === "us") return h >= 17 || h < 1;
      return h >= from && h < to;
    });
    const wins   = recs.filter(isWin);
    const losses = recs.filter(r => r.status === "sl_hit");
    return {
      zone, label, hours,
      wins:    wins.length,
      losses:  losses.length,
      winRate: recs.length > 0 ? (wins.length / recs.length) * 100 : 0,
    };
  });
}

export function analyzeBacktestRecords(records: BacktestRecord[]): BacktestAnalysis {
  return {
    verifiedStats:     calcVerifiedStats(records),
    topCombos:         calcScoreComboWinRates(records),
    phaseLossPatterns: calcPhaseLossPatterns(records),
    timezoneWinRates:  calcTimezoneWinRates(records),
  };
}
