import type { StrategyDef, StrategyMatch, CandidateInput } from "./types";
import { emptyMatch } from "./types";

/**
 * 戦略A: Pump Exhaustion (急騰枯渇)
 *
 * 7日で50%以上急騰した銘柄が、出来高ピーク+価格停滞+FR過熱の三条件を満たすとき、
 * Wyckoffの Distribution Phase / RAVEパターン Phase 3 突入の確率が高い。
 */
export const strategyA: StrategyDef = {
  tag: "A_PUMP_EXHAUSTION",
  name: "Pump Exhaustion",
  shortName: "急騰枯渇",
  icon: "🎯",
  thesis: "急騰銘柄の分配フェーズ突入を捕捉",
  fullThesis: `7日で50%以上の急騰銘柄が、
1) 直近24hで停滞 (±5%以内)
2) 出来高がピークから減少傾向
3) FRがプラス過熱状態
を同時に満たす場合、分配フェーズに突入した可能性が高い。
これは Wyckoffの Distribution Phase および RAVE パターンのフェーズ3に相当する。
歴史的に、この条件を満たした銘柄の72h以内反落確率は約60-70%とされる。`,

  evaluate(c: CandidateInput): StrategyMatch {
    const reasons: string[] = [];
    const warnings: string[] = [];

    // ── REQUIRE: 必須条件 ──
    if (c.priceChange7d < 50) return emptyMatch();
    if (c.priceChange24h > 5 || c.priceChange24h < -10) return emptyMatch();
    if (c.fundingRate === null || c.fundingRate < 0.0001) return emptyMatch();
    if (c.volumeChangeRatio > 1.5) return emptyMatch();
    if (c.shortScore < 7) return emptyMatch();

    reasons.push(`7日+${c.priceChange7d.toFixed(0)}%の急騰`);
    reasons.push(`FR ${(c.fundingRate * 100).toFixed(3)}%/8h（過熱）`);
    if (c.priceChange24h > -3 && c.priceChange24h < 3) reasons.push("24h停滞（分配の典型）");
    if (c.volumeChangeRatio < 0.7) reasons.push(`出来高 ${(c.volumeChangeRatio * 100).toFixed(0)}%（減速）`);

    // ── PREFER: ボーナス（confidence加点）──
    let conf = 50;
    if (c.priceChange7d >= 100) { conf += 15; reasons.push("7d+100%超（pumpScore満点）"); }
    if (c.fundingRate >= 0.0005) { conf += 10; reasons.push("FR 0.05%超（強過熱）"); }
    if (c.frBonus === 1) { conf += 10; reasons.push("FR連続プラス3日+"); }
    if (c.oiRatio > 1.5) { conf += 10; reasons.push(`OI/Vol ${c.oiRatio.toFixed(1)}（レバ蓄積）`); }
    if (c.chartPattern?.type === "bear_flag" || c.chartPattern?.type === "descending_wedge") {
      conf += 10;
      reasons.push(`${c.chartPattern.type}検出`);
    }
    if (c.volumeSpike?.spikeLevel === 3 && c.volumeSpike.direction === "pump") {
      conf -= 5;
      warnings.push("出来高スパイク3レベル：ピーク前の可能性も");
    }

    // ── 警告 ──
    if (c.fundingRate >= 0.001) warnings.push("FR 0.1%超：スクイーズ警戒");
    if (c.exclusivityScore !== 2 && c.priceChange7d > 100) {
      warnings.push("Binance/Bybitに上場済み + 大型急騰：流動性厚く崩しにくい可能性");
    }

    return { matched: true, confidence: Math.min(95, conf), reasons, warnings };
  },

  recommendedSize: { min: 2, max: 4 },
  recommendedLeverage: 3,
  expectedHoldDays: { min: 1, max: 3 },
  rrTargetMin: 1.8,
};
