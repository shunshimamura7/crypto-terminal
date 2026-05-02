"use client";

import type { StrategyTag } from "./strategies/types";
import type { DangerLevel } from "./strategies/dangerZone";
import type { CoinNewsContext, LiquidityInfo } from "./shortScorer";

const STORAGE_KEY = "bell:backtest:records";
const MAX_RECORDS = 1000;

export type BacktestStatus =
  | "active"
  | "tp1_hit" | "tp2_hit" | "tp3_hit" | "sl_hit"
  | "expired"
  | "pending_tp1" | "pending_tp2" | "pending_tp3" | "pending_sl";

export interface BacktestRecord {
  id: string;
  symbol: string;
  score: number;
  scoreMax: number;
  recordedAt: number;
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rrRatio: number;
  trendDirection: string;
  status: BacktestStatus;
  resolvedAt: number | null;
  resolvedPrice: number | null;
  maxDrawdown: number | null;
  maxProfit: number | null;
  currentPrice: number | null;
  lastCheckedAt: number | null;
  reachedTP1?: boolean;
  reachedTP2?: boolean;
  reachedTP3?: boolean;

  // ★ v6: 戦略メタ
  strategyTag?: StrategyTag;
  confidence?: number;
  matchReasons?: string[];
  matchWarnings?: string[];

  // ★ v6: 市場メタ
  dangerLevel?: DangerLevel;
  btcChange24hAtEntry?: number;
  fearGreedAtEntry?: number;
  avgFundingRateAtEntry?: number;

  // ★ v6: 候補スナップショット（エントリー時の根拠データ）
  candidateSnapshot?: {
    athDropPct: number;
    volumeChangeRatio: number;
    fundingRate: number | null;
    oiRatio: number;
    listedDaysAgo: number;
    priceChange7d: number;
    priceChange24h: number;
    btcCorrelation: number;
    chartPatternType: string | null;
    trendAlignment: number | null;
    exclusivityScore: number;
  };

  // プリセット識別
  preset: "low_lev" | "new_listing" | "high_lev" | "unknown";

  // 価格ソース（undefined = レガシー・スキャン結果のみ）
  priceSource?: "scan" | "direct_api";

  // ★ v2.0: スコア内訳
  scoreBreakdown?: {
    dropScore?: number; volumeDryScore?: number; frScore?: number;
    freshnessScore?: number; oiScore?: number; oiChangeScore?: number;
    trendScore?: number; pumpScore?: number; btcCorrScore?: number;
    patternScore?: number; rsiScore?: number;
    pocDistanceScore?: number; volTrendScore?: number;
    exclusivityScore?: number; frBonus?: number;
    futuresHeatScore?: number; snsHeatScore?: number; mcFdvScore?: number;
  };

  // ★ v2.0: エントリー時市場コンテキスト
  marketContext?: {
    btcPrice: number; ethPrice: number;
    fearGreed: number | null; fearGreedLabel: string | null;
    btcChange24h: number;
    marketPhase: "risk_on" | "neutral" | "risk_off";
  };

  // ★ v2.0: スコアリングバージョン
  version?: string;

  // ★ v2.0: CoinGeckoカテゴリ
  categories?: string[];

  // ★ v2.0: SL到達理由の自動分類
  slReason?: string;

  // ★ v2.1: エントリー時の追加コンテキスト
  unlockData?: { daysUntil: number | null; percent: number | null; date: string | null };
  newsContext?: CoinNewsContext;
  liquidityInfo?: LiquidityInfo;
}

export function getRecords(): BacktestRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: BacktestRecord) => ({ ...r, preset: r.preset ?? "unknown" }));
  } catch { return []; }
}

export function saveRecords(records: BacktestRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch { /* ignore quota errors */ }
}

export function clearRecords(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
