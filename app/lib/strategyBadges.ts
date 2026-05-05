export type StrategyBadgeId =
  | "post_listing_decay"
  | "volume_death"
  | "exclusivity_trap"
  | "fdv_overhang"
  | "fr_normalization"
  | "dead_cat_bounce"
  | "sector_collapse"
  | "btc_divergence"
  | "leverage_trap"
  | "asia_dump";

export type ConvictionLevel = "normal" | "high" | "maximum";

export interface StrategyBadgeDef {
  id: StrategyBadgeId;
  label: string;
  icon: string;
  description: string;
  expiryDays: number;
}

export const STRATEGY_BADGES: Record<StrategyBadgeId, StrategyBadgeDef> = {
  post_listing_decay: {
    id: "post_listing_decay",
    label: "上場後崩壊",
    icon: "📉",
    description: "上場30-90日+ATH下落30%以上",
    expiryDays: 14,
  },
  volume_death: {
    id: "volume_death",
    label: "出来高死亡",
    icon: "💀",
    description: "出来高が通常の15%未満まで枯渇",
    expiryDays: 10,
  },
  exclusivity_trap: {
    id: "exclusivity_trap",
    label: "独占トラップ",
    icon: "🪤",
    description: "Binance/Bybit未上場+出来高枯渇",
    expiryDays: 10,
  },
  fdv_overhang: {
    id: "fdv_overhang",
    label: "FDV圧力",
    icon: "⚖️",
    description: "MC/FDV<0.2+上場60日以上",
    expiryDays: 14,
  },
  fr_normalization: {
    id: "fr_normalization",
    label: "FR正常化",
    icon: "📊",
    description: "高FR継続後の低下開始",
    expiryDays: 7,
  },
  dead_cat_bounce: {
    id: "dead_cat_bounce",
    label: "デッドキャット",
    icon: "🐱",
    description: "大幅下落後20-40%反発中",
    expiryDays: 10,
  },
  sector_collapse: {
    id: "sector_collapse",
    label: "セクター崩壊",
    icon: "🌊",
    description: "同カテゴリ3銘柄以上が7d-20%超",
    expiryDays: 7,
  },
  btc_divergence: {
    id: "btc_divergence",
    label: "BTC乖離",
    icon: "🔀",
    description: "BTC相関0.2未満の独立下落",
    expiryDays: 7,
  },
  leverage_trap: {
    id: "leverage_trap",
    label: "レバトラップ",
    icon: "⚡",
    description: "OI急増+価格横ばい",
    expiryDays: 6,
  },
  asia_dump: {
    id: "asia_dump",
    label: "アジアダンプ",
    icon: "🌏",
    description: "直近12hで+15%以上ポンプ後",
    expiryDays: 6,
  },
};

export function getConvictionLevel(badgeCount: number): ConvictionLevel {
  if (badgeCount >= 3) return "maximum";
  if (badgeCount >= 2) return "high";
  return "normal";
}

export function getMaxExpiryDays(badgeIds: string[]): number {
  let max = 0;
  for (const id of badgeIds) {
    const def = STRATEGY_BADGES[id as StrategyBadgeId];
    if (def && def.expiryDays > max) max = def.expiryDays;
  }
  return max;
}
