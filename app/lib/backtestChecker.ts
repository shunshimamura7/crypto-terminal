"use client";

import type { ShortCandidate } from "./shortScorer";
import { getRecords, saveRecords } from "./backtestStorage";
import type { BacktestRecord } from "./backtestStorage";
import { findBestStrategy } from "./strategies";
import type { DangerZoneResult } from "./strategies";
import type { CandidateInput } from "./strategies/types";

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
    if (currentPrice <= record.tp1) record.reachedTP1 = true;
    if (currentPrice <= record.tp2) record.reachedTP2 = true;
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
export function recordNewCandidates(
  candidates: ShortCandidate[],
  preset: "low_lev" | "new_listing" | "high_lev" | "unknown" = "unknown",
): BacktestRecord[] {
  const records = getRecords();
  const activeSymbols = new Set(records.filter(r => r.status === "active").map(r => r.symbol));
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentSymbols = new Set(records.filter(r => r.recordedAt >= recentCutoff).map(r => r.symbol));
  const now = Date.now();

  const newRecords: BacktestRecord[] = candidates
    .filter(c => {
      if (c.tradeSetup === null) return false;
      if (activeSymbols.has(c.symbol)) return false;
      if (recentSymbols.has(c.symbol)) return false;
      switch (preset) {
        case "low_lev":
          return c.shortScore >= 10
            && c.athDropPct <= -30
            && c.volumeChangeRatio < 0.7
            && c.volume24h >= 50_000
            && c.openInterest >= 20_000;
        case "new_listing":
          return c.shortScore >= 8 && c.listedDaysAgo <= 30;
        case "high_lev":
          return c.shortScore >= 12
            && c.athDropPct <= -70
            && c.volumeChangeRatio < 0.3
            && c.volume24h >= 500_000
            && c.openInterest >= 200_000;
        default:
          return c.shortScore >= SCORE_THRESHOLD;
      }
    })
    .map(c => {
      const ts = c.tradeSetup!;
      return {
        id: `${c.symbol}_${now}`,
        symbol: c.symbol,
        score: c.shortScore,
        scoreMax: 23,
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
        preset,
      };
    });

  if (newRecords.length > 0) {
    saveRecords([...records, ...newRecords]);
    console.log(`[backtest] Recorded ${newRecords.length} new candidates:`, newRecords.map(r => r.symbol).join(", "));
  }

  return newRecords;
}

// Extended candidate shape needed for strategy matching
export interface ExtendedCandidateLike extends ShortCandidate {
  displayScore: number;
  exclusivityScore: number;
  frBonus: number;
}

// Step 3: patch active records that have no strategyTag yet with strategy + market context
export function recordNewCandidatesWithStrategy(
  extended: ExtendedCandidateLike[],
  dangerZoneResult: DangerZoneResult,
  marketCtx: { btcChange24h: number; fearGreed: number | null; avgFundingRate: number | null },
): BacktestRecord[] {
  const records = getRecords();
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentSymbols = new Set(records.filter(r => r.recordedAt >= recentCutoff).map(r => r.symbol));
  const extMap = new Map(extended.map(c => [c.symbol, c]));

  let changed = false;
  const patched: BacktestRecord[] = [];

  for (const record of records) {
    if (record.status !== "active" || record.strategyTag !== undefined) continue;
    if (!recentSymbols.has(record.symbol)) continue; // skip stale unpatched records outside cooldown window
    const ext = extMap.get(record.symbol);
    if (!ext) continue;

    const input: CandidateInput = {
      athDropPct:          ext.athDropPct,
      volumeChangeRatio:   ext.volumeChangeRatio,
      fundingRate:         ext.fundingRate,
      oiRatio:             ext.oiRatio,
      listedDaysAgo:       ext.listedDaysAgo,
      priceChange7d:       ext.priceChange7d,
      priceChange24h:      ext.priceChange24h,
      btcCorrelation:      ext.btcCorrelation,
      displayScore:        ext.displayScore,
      shortScore:          ext.shortScore,
      chartPattern:        ext.chartPattern,
      trendMultiTF:        ext.trendMultiTF,
      exclusivityScore:    ext.exclusivityScore,
      frBonus:             ext.frBonus,
      volumeSpike:         ext.volumeSpike,
    };

    const best = findBestStrategy(input);
    record.strategyTag    = best?.tag;
    record.confidence     = best?.confidence;
    record.matchReasons   = best?.reasons;
    record.matchWarnings  = best?.warnings;
    record.dangerLevel              = dangerZoneResult.level;
    record.btcChange24hAtEntry      = marketCtx.btcChange24h;
    record.fearGreedAtEntry         = marketCtx.fearGreed ?? undefined;
    record.avgFundingRateAtEntry    = marketCtx.avgFundingRate ?? undefined;
    record.candidateSnapshot = {
      athDropPct:          ext.athDropPct,
      volumeChangeRatio:   ext.volumeChangeRatio,
      fundingRate:         ext.fundingRate,
      oiRatio:             ext.oiRatio,
      listedDaysAgo:       ext.listedDaysAgo,
      priceChange7d:       ext.priceChange7d,
      priceChange24h:      ext.priceChange24h,
      btcCorrelation:      ext.btcCorrelation,
      chartPatternType:    ext.chartPattern?.type ?? null,
      trendAlignment:      ext.trendMultiTF?.alignment ?? null,
      exclusivityScore:    ext.exclusivityScore,
    };

    changed = true;
    patched.push(record);
  }

  if (changed) saveRecords(records);
  return patched;
}
