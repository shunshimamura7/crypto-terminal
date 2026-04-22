"use client";

import type { ShortCandidate } from "./shortScorer";
import { getRecords, saveRecords } from "./backtestStorage";
import type { BacktestRecord } from "./backtestStorage";

const EXPIRE_DAYS = 14;
const SCORE_THRESHOLD = 8;

// Step 1: check existing active records against current scan prices
export function checkAndUpdateRecords(candidates: ShortCandidate[]): void {
  const records = getRecords();
  const priceMap = new Map<string, number>(candidates.map(c => [c.symbol, c.currentPrice]));

  let changed = false;
  for (const record of records) {
    if (record.status !== "active") continue;

    const currentPrice = priceMap.get(record.symbol);
    if (currentPrice === undefined) continue; // not in this scan, skip

    const pnlPct = ((record.entryPrice - currentPrice) / record.entryPrice) * 100;
    record.currentPrice = currentPrice;
    record.lastCheckedAt = Date.now();
    record.maxProfit   = Math.max(record.maxProfit   ?? 0, pnlPct);
    record.maxDrawdown = Math.min(record.maxDrawdown ?? 0, pnlPct);
    changed = true;

    // TP3 → TP2 → TP1 の順でチェック（最も深いTPから）
    if (currentPrice <= record.tp3) {
      record.status = "tp3_hit";
    } else if (currentPrice <= record.tp2) {
      record.status = "tp2_hit";
    } else if (currentPrice <= record.tp1) {
      record.status = "tp1_hit";
    } else if (currentPrice >= record.sl) {
      record.status = "sl_hit";
    }

    if (record.status !== "active") {
      record.resolvedAt    = Date.now();
      record.resolvedPrice = currentPrice;
      console.log(`[backtest] ${record.symbol} resolved as ${record.status}`);
    }

    // 14日経過で未決着 → expired
    const daysSince = (Date.now() - record.recordedAt) / (1000 * 60 * 60 * 24);
    if (daysSince > EXPIRE_DAYS && record.status === "active") {
      record.status       = "expired";
      record.resolvedAt   = Date.now();
      record.resolvedPrice = currentPrice;
      console.log(`[backtest] ${record.symbol} expired after ${daysSince.toFixed(1)} days`);
    }
  }

  if (changed) saveRecords(records);
}

// Step 2: record new candidates with score >= threshold
export function recordNewCandidates(candidates: ShortCandidate[]): BacktestRecord[] {
  const records = getRecords();
  const activeSymbols = new Set(records.filter(r => r.status === "active").map(r => r.symbol));
  const now = Date.now();

  const newRecords: BacktestRecord[] = candidates
    .filter(c => c.shortScore >= SCORE_THRESHOLD && c.tradeSetup !== null && !activeSymbols.has(c.symbol))
    .map(c => {
      const ts = c.tradeSetup!;
      return {
        id: `${c.symbol}_${now}`,
        symbol: c.symbol,
        score: c.shortScore,
        scoreMax: 16,
        recordedAt: now,
        entryPrice: c.currentPrice,
        sl:      ts.sl,
        tp1:     ts.tp1,
        tp2:     ts.tp2,
        tp3:     ts.tp3,
        rrRatio: ts.rrRatio,
        trendDirection: c.trendDirection,
        status:       "active" as const,
        resolvedAt:   null,
        resolvedPrice: null,
        maxDrawdown:  null,
        maxProfit:    null,
        currentPrice: c.currentPrice,
        lastCheckedAt: now,
      };
    });

  if (newRecords.length > 0) {
    saveRecords([...records, ...newRecords]);
    console.log(`[backtest] Recorded ${newRecords.length} new candidates:`, newRecords.map(r => r.symbol).join(", "));
  }

  return newRecords;
}
