"use client";

import type { BitgetLongCandidate } from "./bitgetLongScorer";
import { getRecords, saveRecords } from "./bitgetBacktestStorage";
import type { BitgetBacktestRecord } from "./bitgetBacktestStorage";

const EXPIRE_DAYS = 14;
const SCORE_THRESHOLD = 10;

export function checkAndUpdateRecords(candidates: BitgetLongCandidate[]): void {
  const records = getRecords();
  const priceMap = new Map<string, number>(candidates.map(c => [c.symbol, c.currentPrice]));

  let changed = false;
  for (const record of records) {
    if (record.status !== "active") continue;

    const currentPrice = priceMap.get(record.symbol);
    if (currentPrice === undefined) continue;

    // ロング: 上がれば利益
    const pnlPct = ((currentPrice - record.entryPrice) / record.entryPrice) * 100;
    record.currentPrice  = currentPrice;
    record.lastCheckedAt = Date.now();
    record.maxProfit   = Math.max(record.maxProfit   ?? 0, pnlPct);
    record.maxDrawdown = Math.min(record.maxDrawdown ?? 0, pnlPct);
    changed = true;

    // TP3 → TP2 → TP1 の順でチェック（最も深いTPから）
    if (currentPrice >= record.tp3) {
      record.status = "tp3_hit";
    } else if (currentPrice >= record.tp2) {
      record.status = "tp2_hit";
    } else if (currentPrice >= record.tp1) {
      record.status = "tp1_hit";
    } else if (currentPrice <= record.sl) {
      record.status = "sl_hit";
    }

    if (record.status !== "active") {
      record.resolvedAt    = Date.now();
      record.resolvedPrice = currentPrice;
    }

    const daysSince = (Date.now() - record.recordedAt) / (1000 * 60 * 60 * 24);
    if (daysSince > EXPIRE_DAYS && record.status === "active") {
      record.status        = "expired";
      record.resolvedAt    = Date.now();
      record.resolvedPrice = currentPrice;
    }
  }

  if (changed) saveRecords(records);
}

export function recordNewCandidates(candidates: BitgetLongCandidate[]): BitgetBacktestRecord[] {
  const records = getRecords();
  const activeSymbols = new Set(records.filter(r => r.status === "active").map(r => r.symbol));
  const now = Date.now();

  const newRecords: BitgetBacktestRecord[] = candidates
    .filter(c => c.longScore >= SCORE_THRESHOLD && c.tradeSetup !== null && !activeSymbols.has(c.symbol))
    .map(c => {
      const ts = c.tradeSetup!;
      return {
        id:             `${c.symbol}_${now}`,
        symbol:         c.symbol,
        score:          c.longScore,
        scoreMax:       30,
        recordedAt:     now,
        entryPrice:     ts.entry,
        sl:             ts.sl,
        tp1:            ts.tp1,
        tp2:            ts.tp2,
        tp3:            ts.entry * 1.5, // +50%
        rrRatio:        ts.rrRatio,
        trendDirection: `H1:${c.trendH1} H4:${c.trendH4} D1:${c.trendD1}`,
        status:         "active" as const,
        resolvedAt:     null,
        resolvedPrice:  null,
        maxDrawdown:    null,
        maxProfit:      null,
        currentPrice:   c.currentPrice,
        lastCheckedAt:  now,
        fundingRate:    c.fundingRate,
        athDropPct:     c.athDropPct,
        recommendedLev: c.recommendedLev,
      };
    });

  if (newRecords.length > 0) {
    saveRecords([...records, ...newRecords]);
  }

  return newRecords;
}
