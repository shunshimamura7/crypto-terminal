"use client";

import type { ShortCandidate } from "./shortScorer";
import type { HunterPattern } from "./types/hunter";

export interface HunterEvalResult {
  matchedPatterns: HunterPattern[];
  isCandidate: boolean;
  primaryPattern: HunterPattern | null;
}

export function evaluateHunterPatterns(
  c: ShortCandidate,
  closes1h?: number[],
): HunterEvalResult {
  const matched: HunterPattern[] = [];
  const hours = c.hoursFromFutures;
  const fr = c.fundingRate ?? 0;

  // P1: ATH分配ショート
  if (
    typeof hours === "number" &&
    hours >= 3 &&
    hours <= 48 &&
    c.athDropPct >= -10 &&
    fr > 0.0005
  ) matched.push("P1");

  // P2: デッドキャットショート（直近6hで15-30%戻し）
  if (c.athDropPct <= -30) {
    const src = closes1h ?? c.closes1h;
    if (src && src.length >= 6) {
      const low6h  = Math.min(...src.slice(-6));
      const last   = src[src.length - 1];
      const bounce = low6h > 0 ? (last - low6h) / low6h * 100 : 0;
      if (bounce >= 15 && bounce <= 30) matched.push("P2");
    }
  }

  // P3: FR過熱ショート
  if (
    typeof hours === "number" &&
    hours <= 72 &&
    fr > 0.001
  ) matched.push("P3");

  // P4: 出来高枯渇ショート
  if (c.athDropPct <= -20 && c.volumeChangeRatio <= 0.5) matched.push("P4");

  // P5: 時間切れショート
  if (
    typeof hours === "number" &&
    hours >= 24 &&
    hours <= 48 &&
    c.athDropPct >= -5
  ) matched.push("P5");

  return {
    matchedPatterns: matched,
    isCandidate: matched.length > 0,
    primaryPattern: matched[0] ?? null,
  };
}
