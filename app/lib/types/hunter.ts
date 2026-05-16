"use client";

export type HunterPattern = "P1" | "P2" | "P3" | "P4" | "P5";

export const HUNTER_PATTERN_META: Record<HunterPattern, { name: string; description: string }> = {
  P1: { name: "ATH分配ショート",      description: "先物上場後3-48h + ATHから-10%以内 + FR>+0.05%/8h" },
  P2: { name: "デッドキャットショート", description: "ATH比-30%以上下落後 + 直近6hで+15-30%の戻し" },
  P3: { name: "FR過熱ショート",        description: "先物上場後72h以内 + FR>+0.1%/8h" },
  P4: { name: "出来高枯渇ショート",    description: "ATH比-20%超 + 出来高が7日平均比50%以下" },
  P5: { name: "時間切れショート",      description: "先物上場後24-48h + ATHから-5%以内に残留" },
};

export interface HunterRecord {
  id: string;
  symbol: string;
  recordedAt: string;

  futuresListedAt: string;
  spotListedAt: string | null;
  hoursFromFutures: number;
  hoursFromSpot: number | null;

  matchedPatterns: HunterPattern[];
  patternTriggered: HunterPattern;

  entryPrice: number;
  athPrice: number;
  athDropPct: number;
  volumeRatio: number;
  frAtEntry: number;
  priceChange24h: number;

  sl: number;
  tp1: number;
  tp2: number;
  rrRatio: number;

  status:
    | "active"
    | "tp1_hit" | "tp2_hit"
    | "sl_hit"
    | "expired"
    | "pending_tp1" | "pending_sl";
  resolvedAt?: string;
  resolvedPrice?: number;
  slReason?: "スクイーズ" | "BTC急騰連れ上げ" | "通常SL";

  marketContext?: {
    btcPrice: number;
    fearGreed: number | null;
    marketPhase: "risk_on" | "neutral" | "risk_off";
  };
}
