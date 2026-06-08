// 市況判定ロジック
// バックテスト分析(2026-06-08)に基づく判定基準:
// - BTC急騰時(24h+5%超)はショートスクイーズリスク
// - F&G極端Fear(<15)は反発しやすい底圏
// - F&G極端Greed(>75)は過熱、ショート好機

export type MarketRegime = "shortFavorable" | "neutral" | "shortDangerous";

export interface MarketRegimeContext {
  btcChange24h: number;
  fearGreed: number;
  bondYield10y?: number;
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  reasons: string[];
  recommendedAction: string;
  positionSizeMultiplier: number;
}

export function judgeMarketRegime(ctx: MarketRegimeContext): MarketRegimeResult {
  const reasons: string[] = [];
  let dangerScore = 0;
  let favorableScore = 0;

  if (ctx.btcChange24h > 5) {
    dangerScore += 2;
    reasons.push(`BTC急騰中(+${ctx.btcChange24h.toFixed(1)}% 24h) スクイーズリスク`);
  } else if (ctx.btcChange24h > 2) {
    dangerScore += 1;
    reasons.push(`BTC上昇(+${ctx.btcChange24h.toFixed(1)}% 24h)`);
  } else if (ctx.btcChange24h < -2) {
    favorableScore += 1;
    reasons.push(`BTC下落(${ctx.btcChange24h.toFixed(1)}% 24h) ショート追い風`);
  }

  if (ctx.fearGreed < 15) {
    dangerScore += 2;
    reasons.push(`F&G ${ctx.fearGreed} (Extreme Fear) 反発しやすい底圏`);
  } else if (ctx.fearGreed > 75) {
    favorableScore += 2;
    reasons.push(`F&G ${ctx.fearGreed} (Extreme Greed) 過熱、ショート好機`);
  } else if (ctx.fearGreed >= 30 && ctx.fearGreed <= 50) {
    favorableScore += 1;
    reasons.push(`F&G ${ctx.fearGreed} (Fear〜Neutral) 通常運用OK`);
  }

  if (ctx.bondYield10y !== undefined) {
    if (ctx.bondYield10y < 4.0) {
      dangerScore += 1;
      reasons.push(`米10年債 ${ctx.bondYield10y.toFixed(2)}% (BTC追い風)`);
    } else if (ctx.bondYield10y > 4.3) {
      favorableScore += 1;
      reasons.push(`米10年債 ${ctx.bondYield10y.toFixed(2)}% (BTC逆風、ショート有利)`);
    }
  }

  if (dangerScore >= 2) {
    return {
      regime: "shortDangerous",
      reasons,
      recommendedAction: "エリート推奨のみ・ポジサイズ半分・最大2ポジまで",
      positionSizeMultiplier: 0.5,
    };
  }
  if (favorableScore >= 2) {
    return {
      regime: "shortFavorable",
      reasons,
      recommendedAction: "推奨+注意も検討OK・通常サイズ・最大5ポジ",
      positionSizeMultiplier: 1.0,
    };
  }
  return {
    regime: "neutral",
    reasons,
    recommendedAction: "推奨1-2銘柄・通常サイズ・最大3ポジ",
    positionSizeMultiplier: 1.0,
  };
}

// 前兆スキャン用推奨閾値
// shortDangerous時のみ厳格化（score≥7 OR signalCount≥5）
// shortFavorable / neutral は通常運用（score≥6 OR signalCount≥4）
export interface RecommendThreshold {
  minScore: number;
  minSignals: number;
  isStricter: boolean;
}

export function getPrecursorRecommendThreshold(regime: MarketRegime): RecommendThreshold {
  if (regime === "shortDangerous") {
    return { minScore: 7, minSignals: 5, isStricter: true };
  }
  return { minScore: 6, minSignals: 4, isStricter: false };
}

export function isPrecursorRecommended(
  score: number,
  signalCount: number,
  regime: MarketRegime,
): boolean {
  const t = getPrecursorRecommendThreshold(regime);
  return score >= t.minScore || signalCount >= t.minSignals;
}

// スコア型スキャナー用の推奨閾値
// shortDangerous時のみ+3pt厳格化
export interface ScoreScannerThreshold {
  withCG: number;
  noCG: number;
  isStricter: boolean;
}

export function getScoreScannerRecommendThreshold(regime: MarketRegime): ScoreScannerThreshold {
  if (regime === "shortDangerous") {
    return { withCG: 16, noCG: 14, isStricter: true };
  }
  return { withCG: 13, noCG: 11, isStricter: false };
}
