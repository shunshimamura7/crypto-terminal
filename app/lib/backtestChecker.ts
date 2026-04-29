"use client";

import type { ShortCandidate } from "./shortScorer";
import { getRecords, saveRecords } from "./backtestStorage";
import type { BacktestRecord, BacktestStatus } from "./backtestStorage";
import { findBestStrategy } from "./strategies";
import type { DangerZoneResult } from "./strategies";
import type { CandidateInput } from "./strategies/types";
import type { MarketContext } from "./marketContext";

const EXPIRE_DAYS = 7;
const SCORE_THRESHOLD = 8;
export const SCORING_VERSION = "v2.0";

function isPending(status: BacktestStatus): boolean {
  return status === "pending_tp1" || status === "pending_tp2" || status === "pending_tp3" || status === "pending_sl";
}

// Fetch prices from our server-side proxy to avoid CORS
async function fetchPricesFromAPI(symbols: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (symbols.length === 0) return result;
  try {
    const res = await fetch(
      `/api/price-check?symbols=${symbols.join(",")}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return result;
    const json = await res.json();
    const prices: Record<string, number> = json?.prices ?? {};
    for (const [sym, price] of Object.entries(prices)) {
      if (price > 0) result.set(sym, price);
    }
  } catch {
    // network error — return empty, caller falls back to scan prices
  }
  return result;
}

// SL到達理由の自動分類
function detectSlReason(record: BacktestRecord): string {
  const daysSince = ((record.resolvedAt ?? Date.now()) - record.recordedAt) / 86_400_000;
  const freshnessScore = record.scoreBreakdown?.freshnessScore ?? 0;

  if (daysSince < 1 && freshnessScore >= 2) {
    return "新規上場直後のスクイーズ";
  }

  const entryFr = record.candidateSnapshot?.fundingRate;
  if (entryFr != null && entryFr < -0.0003) {
    return "FRマイナス転換（ショートスクイーズ）";
  }

  if ((record.candidateSnapshot?.btcCorrelation ?? 0) > 0.7) {
    return "BTC急騰の連れ上げ";
  }

  return "通常のSL到達";
}

// Apply two-check pending logic for SL/TP hits
function applyPriceCheck(
  record: BacktestRecord,
  currentPrice: number,
  priceSource: "scan" | "direct_api",
): void {
  const prev = record.status;

  if (currentPrice <= record.tp3) {
    if (prev === "pending_tp3") {
      record.status = "tp3_hit";
      record.resolvedAt = Date.now();
      record.resolvedPrice = currentPrice;
      record.priceSource = priceSource;
    } else if (prev === "active" || isPending(prev)) {
      record.status = "pending_tp3";
    }
  } else if (currentPrice <= record.tp2) {
    if (prev === "pending_tp2") {
      record.status = "tp2_hit";
      record.resolvedAt = Date.now();
      record.resolvedPrice = currentPrice;
      record.priceSource = priceSource;
    } else if (prev === "active" || isPending(prev)) {
      record.status = "pending_tp2";
    }
  } else if (currentPrice <= record.tp1) {
    if (prev === "pending_tp1") {
      record.status = "tp1_hit";
      record.resolvedAt = Date.now();
      record.resolvedPrice = currentPrice;
      record.priceSource = priceSource;
    } else if (prev === "active" || isPending(prev)) {
      record.status = "pending_tp1";
    }
  } else if (currentPrice >= record.sl) {
    if (prev === "pending_sl") {
      record.status = "sl_hit";
      record.resolvedAt = Date.now();
      record.resolvedPrice = currentPrice;
      record.priceSource = priceSource;
      record.slReason = detectSlReason(record);
    } else if (prev === "active" || isPending(prev)) {
      record.status = "pending_sl";
    }
  } else {
    // No condition met — reset pending back to active
    if (isPending(prev)) {
      record.status = "active";
    }
  }
}

// Step 1: check existing active/pending records — now fetches live prices via API
export async function checkAndUpdateRecords(candidates: ShortCandidate[]): Promise<void> {
  const records = getRecords();
  const scanPriceMap = new Map<string, number>(candidates.map(c => [c.symbol, c.currentPrice]));

  const trackableRecords = records.filter(r => r.status === "active" || isPending(r.status));
  if (trackableRecords.length === 0) return;

  // Prefer direct API prices for accuracy; fall back to scan prices
  const apiPrices = await fetchPricesFromAPI(trackableRecords.map(r => r.symbol));

  let changed = false;
  for (const record of records) {
    if (record.status !== "active" && !isPending(record.status)) continue;

    const apiPrice  = apiPrices.get(record.symbol);
    const scanPrice = scanPriceMap.get(record.symbol);
    const currentPrice = apiPrice ?? scanPrice;
    const priceSource: "scan" | "direct_api" = apiPrice !== undefined ? "direct_api" : "scan";

    if (currentPrice === undefined) continue;

    const pnlPct = ((record.entryPrice - currentPrice) / record.entryPrice) * 100;
    record.currentPrice  = currentPrice;
    record.lastCheckedAt = Date.now();
    record.maxProfit   = Math.max(record.maxProfit   ?? 0, pnlPct);
    record.maxDrawdown = Math.min(record.maxDrawdown ?? 0, pnlPct);
    if (currentPrice <= record.tp1) record.reachedTP1 = true;
    if (currentPrice <= record.tp2) record.reachedTP2 = true;
    changed = true;

    applyPriceCheck(record, currentPrice, priceSource);

    if (record.status !== "active" && !isPending(record.status)) {
      console.log(`[backtest] ${record.symbol} resolved as ${record.status} (${priceSource})`);
    }

    // 7日経過で未決着 → expired
    const daysSince = (Date.now() - record.recordedAt) / (1000 * 60 * 60 * 24);
    if (daysSince > EXPIRE_DAYS && (record.status === "active" || isPending(record.status))) {
      record.status        = "expired";
      record.resolvedAt    = Date.now();
      record.resolvedPrice = currentPrice;
    }
  }

  if (changed) saveRecords(records);
}

interface ClientScoreEntry {
  exclusivityScore?: number;
  frBonus?: number;
  oiChangeScore?: number;
}

// Step 2: record new candidates with score >= threshold
export function recordNewCandidates(
  candidates: ShortCandidate[],
  preset: "low_lev" | "new_listing" | "high_lev" | "unknown" = "unknown",
  clientScores?: Map<string, ClientScoreEntry>,
  marketContext?: MarketContext | null,
): BacktestRecord[] {
  const records = getRecords();
  const activeSymbols = new Set(
    records.filter(r => r.status === "active" || isPending(r.status)).map(r => r.symbol),
  );
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
            && c.volumeChangeRatio < 1.5
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
      const cs = clientScores?.get(c.symbol);

      // Build scoreBreakdown from server data + client scores
      const bd = c.scoreBreakdown;
      const scoreBreakdown: BacktestRecord["scoreBreakdown"] = {
        dropScore:      bd?.dropScore,
        volumeDryScore: bd?.volumeDryScore,
        frScore:        bd?.frScore,
        freshnessScore: bd?.freshnessScore,
        oiScore:        bd?.oiScore,
        oiChangeScore:  cs?.oiChangeScore ?? bd?.oiChangeScore,
        trendScore:     bd?.trendScore,
        pumpScore:      bd?.pumpScore,
        btcCorrScore:   bd?.btcCorrScore,
        patternScore:   bd?.patternScore,
        rsiScore:       bd?.rsiScore,
        exclusivityScore: cs?.exclusivityScore,
        frBonus:          cs?.frBonus,
        unlockScore:    bd?.unlockScore,
        // futuresHeatScore/snsHeatScore/mcFdvScore patched later via patchBacktestCgData
      };

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
        priceSource: "scan" as const,
        scoreBreakdown,
        marketContext: marketContext ?? undefined,
        version: SCORING_VERSION,
        unlockData: c.nextUnlockDays != null ? {
          daysUntil: c.nextUnlockDays,
          percent:   c.nextUnlockPercent,
          date:      c.nextUnlockDate,
        } : c.unlockData ? {
          daysUntil: c.unlockData.nextUnlockDays,
          percent:   c.unlockData.nextUnlockPercent,
          date:      c.unlockData.nextUnlockDate,
        } : undefined,
        newsContext: c.newsContext,
        liquidityInfo: c.liquidityInfo,
      };
    });

  if (newRecords.length > 0) {
    saveRecords([...records, ...newRecords]);
    console.log(`[backtest] Recorded ${newRecords.length} new candidates (${SCORING_VERSION}):`, newRecords.map(r => r.symbol).join(", "));
  }

  return newRecords;
}

// Step 2b: patch CG-derived scores onto recently recorded backtest records
export function patchBacktestCgData(
  cgPatch: Map<string, {
    futuresHeatScore?: number;
    snsHeatScore?: number;
    mcFdvScore?: number;
    categories?: string[];
  }>,
): void {
  if (cgPatch.size === 0) return;
  if (typeof window === "undefined") return;
  const records = getRecords();
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;

  for (const record of records) {
    if (record.recordedAt < recentCutoff) continue;
    const patch = cgPatch.get(record.symbol);
    if (!patch) continue;

    if (!record.scoreBreakdown) record.scoreBreakdown = {};
    if (patch.futuresHeatScore !== undefined) record.scoreBreakdown.futuresHeatScore = patch.futuresHeatScore;
    if (patch.snsHeatScore     !== undefined) record.scoreBreakdown.snsHeatScore     = patch.snsHeatScore;
    if (patch.mcFdvScore       !== undefined) record.scoreBreakdown.mcFdvScore       = patch.mcFdvScore;
    if (patch.categories       !== undefined) record.categories = patch.categories;
    changed = true;
  }

  if (changed) saveRecords(records);
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
    if ((record.status !== "active" && !isPending(record.status)) || record.strategyTag !== undefined) continue;
    if (!recentSymbols.has(record.symbol)) continue;
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
