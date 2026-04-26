import type { StrategyDef, StrategyMatch, CandidateInput } from "./types";
import { emptyMatch } from "./types";

/**
 * 戦略C: Stale Drift (緩慢な崩壊)
 *
 * 出来高が完全に枯渇した銘柄 + チャートパターン検出 + BTC非連動。
 * 「誰も興味を持たない死にかけ銘柄」の最後の保有者の損切り波で崩壊するパターン。
 */
export const strategyC: StrategyDef = {
  tag: "C_STALE_DRIFT",
  name: "Stale Drift",
  shortName: "緩崩壊",
  icon: "🪦",
  thesis: "出来高枯渇の死にかけ銘柄を主力でショート",
  fullThesis: `出来高が7日平均の30%未満まで枯れた銘柄は、買い手が完全に去った状態。
残った保有者は損切りタイミングを探しているだけで、わずかな売りで崩れる。
- ATH-50%以上：明確な弱気トレンド
- volumeChangeRatio < 0.3：volumeDryScore 2以上
- BTC相関 < 0.3：個別の弱さ
- チャートパターン検出 or 出来高ratio<0.1：強力シグナル`,

  evaluate(c: CandidateInput): StrategyMatch {
    const reasons: string[] = [];
    const warnings: string[] = [];

    // ── REQUIRE ──
    if (c.athDropPct > -50) return emptyMatch();
    if (c.volumeChangeRatio > 0.3) return emptyMatch();
    if (c.btcCorrelation > 0.5) return emptyMatch();
    if (c.shortScore < 8) return emptyMatch();

    // 強力シグナル必須
    const hasPattern = c.chartPattern !== null;
    const extremeDry = c.volumeChangeRatio < 0.1;
    if (!hasPattern && !extremeDry) return emptyMatch();

    reasons.push(`ATH ${c.athDropPct.toFixed(0)}%下落`);
    reasons.push(`出来高 ${(c.volumeChangeRatio * 100).toFixed(0)}%（枯渇）`);
    reasons.push(`BTC相関 ${c.btcCorrelation.toFixed(2)}（独立）`);
    if (hasPattern) reasons.push(`${c.chartPattern!.type}検出`);
    if (extremeDry) reasons.push("出来高枯渇極端（volumeDryScore満点）");

    // ── PREFER ──
    let conf = 55;
    if (c.athDropPct < -70) { conf += 10; reasons.push("ATH-70%超"); }
    if (c.volumeChangeRatio < 0.05) { conf += 10; reasons.push("出来高ほぼゼロ"); }
    if (hasPattern && extremeDry) { conf += 10; reasons.push("両シグナル成立"); }
    if (c.exclusivityScore === 2) { conf += 5; reasons.push("MEXC独占"); }
    if (c.fundingRate !== null && c.fundingRate > 0) { conf += 5; reasons.push("FRプラス（残ロング搾取可）"); }

    // ── 警告 ──
    if (c.listedDaysAgo < 30) warnings.push("上場30日以内：CEX上場で踏み上げリスク");
    if (c.priceChange24h > 10) warnings.push("直近24h+10%超：突発的反発、エントリー待機推奨");
    if (c.oiRatio > 5) warnings.push("OI/Vol極端：流動性に対しレバ過剰、変動激しい可能性");

    return { matched: true, confidence: Math.min(90, conf), reasons, warnings };
  },

  recommendedSize: { min: 2, max: 3 },
  recommendedLeverage: 2,
  expectedHoldDays: { min: 5, max: 14 },
  rrTargetMin: 2.0,
};
