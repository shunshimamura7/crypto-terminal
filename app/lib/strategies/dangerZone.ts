export type DangerLevel = "safe" | "caution" | "danger";

export interface DangerZoneInputs {
  btcChange24h: number;
  fearGreed: number | null;
  longBiasRatio: number;
  avgFundingRate: number | null;
  candidateCount: number;
}

export interface DangerZoneResult {
  level: DangerLevel;
  primaryReason: string;
  details: string[];
  shouldBlockEntry: boolean;
  recommendedAction: string;
  inputs: DangerZoneInputs;
}

/**
 * 「ショートが構造的に勝てない瞬間」を検知する番人。
 * 複雑なレジーム判定はしない。1個だけ精度高く検知する。
 */
export function evaluateDangerZone(inputs: DangerZoneInputs): DangerZoneResult {
  const { btcChange24h, fearGreed, longBiasRatio, avgFundingRate } = inputs;
  const details: string[] = [];

  // ── DANGER: BTC急騰 + Greed過熱 ──
  if (btcChange24h >= 4 && fearGreed !== null && fearGreed >= 65) {
    return {
      level: "danger",
      primaryReason: "BTC急騰 × Greed過熱",
      details: [
        `BTC 24h +${btcChange24h.toFixed(1)}%`,
        `F&G ${fearGreed} (Greed以上)`,
        "アルトのβ追随でショートは踏み上げられる典型パターン",
      ],
      shouldBlockEntry: true,
      recommendedAction: "新規ショート全停止。既存ポジは最低限のSL設定で死守、または利確",
      inputs,
    };
  }

  // ── DANGER: ロング優位率40%超 ──
  if (longBiasRatio >= 0.4) {
    return {
      level: "danger",
      primaryReason: "市場全体がロング相場",
      details: [
        `ロング優位銘柄が全体の${(longBiasRatio * 100).toFixed(0)}%`,
        "個別ショートを試みても市場全体に踏まれる確率が高い",
      ],
      shouldBlockEntry: true,
      recommendedAction: "ショート休止。むしろ逆張りロング検討。",
      inputs,
    };
  }

  // ── DANGER: 平均FRマイナス領域 ──
  if (avgFundingRate !== null && avgFundingRate < -0.0001) {
    return {
      level: "danger",
      primaryReason: "市場全体スクイーズ警戒",
      details: [
        `平均FR ${(avgFundingRate * 100).toFixed(3)}%/8h（マイナス）`,
        "ショート過密。少しの上昇で連鎖踏み上げの可能性",
      ],
      shouldBlockEntry: true,
      recommendedAction: "ショート禁止。FRが0以上に戻るのを待つ。",
      inputs,
    };
  }

  // ── CAUTION: BTC急落 ──
  if (btcChange24h <= -5) {
    details.push(`BTC 24h ${btcChange24h.toFixed(1)}%急落`);
    details.push("デッドキャットバウンスの反発リスクあり");
    return {
      level: "caution",
      primaryReason: "BTC急落直後",
      details,
      shouldBlockEntry: false,
      recommendedAction: "新規エントリーは戻り売り限定。サイズ半分。",
      inputs,
    };
  }

  // ── CAUTION: BTC上昇中 ──
  if (btcChange24h >= 3) {
    details.push(`BTC 24h +${btcChange24h.toFixed(1)}%上昇中`);
    return {
      level: "caution",
      primaryReason: "BTC上昇中",
      details,
      shouldBlockEntry: false,
      recommendedAction: "ショートは個別の弱さに集中。BTC連動高い銘柄は避ける。",
      inputs,
    };
  }

  // ── CAUTION: Extreme Fear ──
  if (fearGreed !== null && fearGreed <= 25) {
    details.push(`F&G ${fearGreed}（Extreme Fear）`);
    return {
      level: "caution",
      primaryReason: "Extreme Fear局面",
      details,
      shouldBlockEntry: false,
      recommendedAction: "底値圏反発リスクあり。サイズ控えめ、SLタイト。",
      inputs,
    };
  }

  // ── SAFE ──
  return {
    level: "safe",
    primaryReason: "通常のショート環境",
    details: [
      `BTC 24h ${btcChange24h >= 0 ? "+" : ""}${btcChange24h.toFixed(1)}%`,
      fearGreed !== null ? `F&G ${fearGreed}` : "F&G データなし",
      `ロング優位率 ${(longBiasRatio * 100).toFixed(0)}%`,
    ],
    shouldBlockEntry: false,
    recommendedAction: "通常運用OK。各戦略のシグナルに従ってエントリー。",
    inputs,
  };
}
