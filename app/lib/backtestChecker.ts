"use client";

import type { ShortCandidate } from "./shortScorer";
import { isExcessivePump } from "./shortScorer";
import { getRecords, saveRecords } from "./backtestStorage";
import type { BacktestRecord, BacktestStatus } from "./backtestStorage";
import { findBestStrategy } from "./strategies";
import type { DangerZoneResult } from "./strategies";
import type { CandidateInput } from "./strategies/types";
import type { MarketContext } from "./marketContext";

const EXPIRE_DAYS = 14;
const SCORE_THRESHOLD = 13;
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
      record.reachedTP1 = true;
      record.reachedTP2 = true;
      record.reachedTP3 = true;
    } else if (prev === "active" || isPending(prev)) {
      record.status = "pending_tp3";
    }
  } else if (currentPrice <= record.tp2) {
    if (prev === "pending_tp2") {
      record.status = "tp2_hit";
      record.resolvedAt = Date.now();
      record.resolvedPrice = currentPrice;
      record.priceSource = priceSource;
      record.reachedTP1 = true;
      record.reachedTP2 = true;
    } else if (prev === "active" || isPending(prev)) {
      record.status = "pending_tp2";
    }
  } else if (currentPrice <= record.tp1) {
    if (prev === "pending_tp1") {
      record.status = "tp1_hit";
      record.resolvedAt = Date.now();
      record.resolvedPrice = currentPrice;
      record.priceSource = priceSource;
      record.reachedTP1 = true;
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

  const frMap = new Map(
    candidates.filter(c => c.fundingRate != null).map(c => [c.symbol, c.fundingRate!]),
  );
  let changed = false;
  const now = Date.now();
  for (const record of records) {
    if (record.status !== "active" && !isPending(record.status)) continue;

    // 期限切れチェックを最優先（スキャン外の銘柄でも確実に expired にする）
    const daysSince = (now - record.recordedAt) / (1000 * 60 * 60 * 24);
    if (daysSince > (record.expiryDays ?? EXPIRE_DAYS)) {
      const lastPrice = apiPrices.get(record.symbol) ?? scanPriceMap.get(record.symbol) ?? record.currentPrice ?? record.entryPrice;
      record.status        = "expired";
      record.resolvedAt    = now;
      record.resolvedPrice = lastPrice;
      changed = true;
      console.log(`[backtest] ${record.symbol} expired after ${daysSince.toFixed(1)} days`);
      continue;
    }

    const apiPrice  = apiPrices.get(record.symbol);
    const scanPrice = scanPriceMap.get(record.symbol);
    const currentPrice = apiPrice ?? scanPrice;
    const priceSource: "scan" | "direct_api" = apiPrice !== undefined ? "direct_api" : "scan";

    if (currentPrice === undefined) continue;

    const pnlPct = ((record.entryPrice - currentPrice) / record.entryPrice) * 100;
    record.currentPrice  = currentPrice;
    record.lastCheckedAt = now;
    const fr = frMap.get(record.symbol);
    if (fr != null) {
      record.frCumulativeCost = (record.frCumulativeCost ?? 0) + Math.abs(fr) * 100;
      record.frCheckCount = (record.frCheckCount ?? 0) + 1;
      record.lastFundingRate = fr;
    }
    record.maxProfit   = Math.max(record.maxProfit   ?? 0, pnlPct);
    record.maxDrawdown = Math.min(record.maxDrawdown ?? 0, pnlPct);
    if (currentPrice <= record.tp1) record.reachedTP1 = true;
    if (currentPrice <= record.tp2) record.reachedTP2 = true;
    if (currentPrice <= record.tp3) record.reachedTP3 = true;
    changed = true;

    applyPriceCheck(record, currentPrice, priceSource);

    if (record.status !== "active" && !isPending(record.status)) {
      if (["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit"].includes(record.status) && record.resolvedPrice != null && record.adjustedPnlPct == null) {
        const rawPnl = ((record.entryPrice - record.resolvedPrice) / record.entryPrice) * 100;
        record.adjustedPnlPct = rawPnl - (record.frCumulativeCost ?? 0);
      }
      console.log(`[backtest] ${record.symbol} resolved as ${record.status} (${priceSource})`);
    }
  }

  if (changed) saveRecords(records);
}

// スキャン外銘柄も含めて期限切れを一括処理するスタンドアロン関数
export function expireOldRecords(): number {
  if (typeof window === "undefined") return 0;
  const records = getRecords();
  const now = Date.now();
  let count = 0;

  for (const record of records) {
    if (record.status !== "active" && !isPending(record.status)) continue;
    const daysSince = (now - record.recordedAt) / (1000 * 60 * 60 * 24);
    if (daysSince > (record.expiryDays ?? EXPIRE_DAYS)) {
      record.status        = "expired";
      record.resolvedAt    = now;
      record.resolvedPrice = record.currentPrice ?? record.entryPrice;
      count++;
    }
  }

  if (count > 0) {
    saveRecords(records);
    console.log(`[backtest] expireOldRecords: ${count} records expired (>${EXPIRE_DAYS}d)`);
  }
  return count;
}

interface ClientScoreEntry {
  exclusivityScore?: number;
  frBonus?: number;
  oiChangeScore?: number;
}

interface BadgeEntry {
  strategyBadges?: string[];
  convictionLevel?: string;
  expiryDays?: number;
}

function estimateSlippage(vol24h: number): number {
  if (vol24h < 50_000)   return 5.0;
  if (vol24h < 200_000)  return 2.0;
  if (vol24h < 1_000_000) return 0.5;
  return 0.1;
}

// Step 2: record new candidates with score >= threshold
export function recordNewCandidates(
  candidates: ShortCandidate[],
  preset: "low_lev" | "new_listing" | "high_lev" | "unknown" | "collect" | "production" = "unknown",
  clientScores?: Map<string, ClientScoreEntry>,
  marketContext?: MarketContext | null,
  badgesMap?: Map<string, BadgeEntry>,
): BacktestRecord[] {
  const records = getRecords();
  const activeSymbols = new Set(
    records.filter(r => r.status === "active" || isPending(r.status)).map(r => r.symbol),
  );
  const cooldownCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentSymbols = new Set(records.filter(r => r.recordedAt >= cooldownCutoff).map(r => r.symbol));
  const recentlyResolved = new Set(
    records.filter(r => r.resolvedAt != null && r.resolvedAt >= cooldownCutoff).map(r => r.symbol),
  );
  const slHitSymbols = new Set(
    records.filter(r => r.status === "sl_hit" && r.resolvedAt != null && r.resolvedAt >= cooldownCutoff).map(r => r.symbol),
  );
  const now = Date.now();

  const newRecords: BacktestRecord[] = candidates
    .filter(c => {
      if (c.tradeSetup === null) return false;
      if (activeSymbols.has(c.symbol)) return false;
      if (recentSymbols.has(c.symbol)) return false;
      if (recentlyResolved.has(c.symbol)) return false;
      if (slHitSymbols.has(c.symbol)) return false;
      if (isExcessivePump(c)) return false;
      switch (preset) {
        case "low_lev":
          return c.shortScore >= 10
            && c.athDropPct <= -30
            && c.volumeChangeRatio < 1.5
            && c.volume24h >= 50_000
            && c.openInterest >= 20_000;
        case "new_listing":
          return c.shortScore >= SCORE_THRESHOLD && c.listedDaysAgo <= 30;
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
        pocDistanceScore: bd?.pocDistanceScore,
        volTrendScore:    bd?.volTrendScore,
        exclusivityScore: cs?.exclusivityScore,
        frBonus:          cs?.frBonus,
        // futuresHeatScore/snsHeatScore/mcFdvScore patched later via patchBacktestCgData
      };

      return {
        id: `${c.symbol}_${now}`,
        symbol: c.symbol,
        score: c.shortScore,
        scoreMax: 27,
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
        newsContext: c.newsContext,
        liquidityInfo: c.liquidityInfo,
        estimatedSlippage: estimateSlippage(c.volume24h),
        entrySpread: c.liquidityInfo?.spread ?? undefined,
        isNewListing: c.listedDaysAgo <= 30,
        listedDaysAgo: c.listedDaysAgo,
        pumpFromListingPct: (c.initialPrice && c.initialPrice > 0 && c.ath14d > 0)
          ? ((c.ath14d - c.initialPrice) / c.initialPrice) * 100
          : undefined,
        ...(() => {
          const b = badgesMap?.get(c.symbol);
          if (!b || !b.strategyBadges?.length) return {};
          return {
            strategyBadges: b.strategyBadges,
            convictionLevel: b.convictionLevel as import("./strategyBadges").ConvictionLevel | undefined,
            expiryDays: b.expiryDays,
          };
        })(),
      };
    });

  if (newRecords.length > 0) {
    saveRecords([...records, ...newRecords]);
    console.log(`[backtest] Recorded ${newRecords.length} new candidates (${SCORING_VERSION}):`, newRecords.map(r => r.symbol).join(", "));
  }

  return newRecords;
}

// Apply live price + FR updates from /api/backtest-check response
export function applyApiUpdates(
  updates: { symbol: string; price: number; fundingRate: number | null }[],
): boolean {
  if (updates.length === 0) return false;
  const records = getRecords();
  const updateMap = new Map(updates.map(u => [u.symbol, u]));
  let changed = false;
  const now = Date.now();

  for (const record of records) {
    if (record.status !== "active" && !isPending(record.status)) continue;
    const update = updateMap.get(record.symbol);
    if (!update) continue;

    const { price, fundingRate } = update;
    const pnlPct = ((record.entryPrice - price) / record.entryPrice) * 100;
    record.currentPrice  = price;
    record.lastCheckedAt = now;

    if (fundingRate != null) {
      record.frCumulativeCost = (record.frCumulativeCost ?? 0) + Math.abs(fundingRate) * 100;
      record.frCheckCount     = (record.frCheckCount ?? 0) + 1;
      record.lastFundingRate  = fundingRate;
    }

    record.maxProfit   = Math.max(record.maxProfit   ?? 0, pnlPct);
    record.maxDrawdown = Math.min(record.maxDrawdown ?? 0, pnlPct);
    if (price <= record.tp1) record.reachedTP1 = true;
    if (price <= record.tp2) record.reachedTP2 = true;
    if (price <= record.tp3) record.reachedTP3 = true;
    changed = true;

    applyPriceCheck(record, price, "direct_api");

    if (record.status !== "active" && !isPending(record.status)) {
      if (["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit"].includes(record.status) && record.resolvedPrice != null && record.adjustedPnlPct == null) {
        const rawPnl = ((record.entryPrice - record.resolvedPrice) / record.entryPrice) * 100;
        record.adjustedPnlPct = rawPnl - (record.frCumulativeCost ?? 0);
      }
    }
  }

  if (changed) saveRecords(records);
  return changed;
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
