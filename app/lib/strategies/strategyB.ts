import type { StrategyDef, StrategyMatch, CandidateInput } from "./types";
import { emptyMatch } from "./types";

/**
 * 戦略B: Cascade Setup (清算カスケード仕掛け)
 *
 * 既に下降トレンドに入った銘柄でレバレッジが過剰に蓄積されている場合、
 * 価格下落 → ロング清算 → さらに下落 のカスケードが発生する。
 */
export const strategyB: StrategyDef = {
  tag: "B_CASCADE_SETUP",
  name: "Cascade Setup",
  shortName: "清算誘発",
  icon: "💥",
  thesis: "OI過剰の下降トレンド銘柄でカスケード清算を狙う",
  fullThesis: `下降トレンドが確立した銘柄でレバレッジが過剰に蓄積されている場合、
わずかな下落がロング清算を連鎖的に引き起こす。
- ATH-30%以上：トレンド方向の確認
- 1H/4H/1D全TF DOWN：トレンド継続性が最も高い状態
- OI/Vol > 1.5：清算燃料の蓄積
- BTC相関 < 0.5：個別の弱さ（β追随ではない）`,

  evaluate(c: CandidateInput): StrategyMatch {
    const reasons: string[] = [];
    const warnings: string[] = [];

    // ── REQUIRE ──
    if (c.athDropPct > -30) return emptyMatch();
    if (c.trendMultiTF?.alignment !== 3) return emptyMatch();
    if (c.oiRatio < 1.0) return emptyMatch();
    if (c.shortScore < 8) return emptyMatch();

    reasons.push(`ATH ${c.athDropPct.toFixed(0)}%下落`);
    reasons.push("1H/4H/1D 全TF DOWN");
    reasons.push(`OI/Vol ${c.oiRatio.toFixed(1)}（清算燃料）`);

    // ── PREFER ──
    let conf = 50;
    if (c.oiRatio > 3.0) { conf += 15; reasons.push("OI/Vol 3.0超（oiScore満点）"); }
    if (c.btcCorrelation < 0.3) { conf += 10; reasons.push(`BTC相関${c.btcCorrelation.toFixed(2)}（独立した弱さ）`); }
    if (c.fundingRate !== null && c.fundingRate > 0) {
      conf += 10;
      reasons.push("FRプラスで下落中（ロング耐えてる状態）");
    }
    if (c.volumeChangeRatio < 0.5) { conf += 5; reasons.push("出来高減少中"); }
    if (c.chartPattern?.type === "descending_wedge") { conf += 10; reasons.push("下降ウェッジ確認"); }
    if (c.athDropPct < -50) { conf += 5; reasons.push("ATH-50%超（dropScore満点）"); }

    // ── 警告 ──
    if (c.athDropPct < -70) {
      warnings.push("ATH-70%超：底値圏リバウンドリスク。SLタイト推奨");
    }
    if (c.fundingRate !== null && c.fundingRate < -0.0001) {
      warnings.push("FRマイナス：すでにショート過剰、スクイーズ警戒");
    }
    if (c.volumeChangeRatio > 2.0) {
      warnings.push("出来高急増：パニック売りピークの可能性、底打ちリスク");
    }

    return { matched: true, confidence: Math.min(95, conf), reasons, warnings };
  },

  recommendedSize: { min: 3, max: 5 },
  recommendedLeverage: 4,
  expectedHoldDays: { min: 1, max: 4 },
  rrTargetMin: 2.0,
};
