export type StrategyBadgeId =
  | "post_listing_decay"
  | "listing_vol_collapse"
  | "listing_pump_fade"
  | "listing_bounce_trap"
  | "listing_ath70"
  | "btc_crash_amplifier"
  | "dead_cat_bounce"
  | "rsi_reversal";

export type ConvictionLevel = "normal" | "high" | "maximum";

export interface StrategyBadgeDef {
  id: StrategyBadgeId;
  label: string;
  icon: string;
  description: string;
  expiryDays: number;
  category: "timing" | "structure" | "momentum";
}

export const STRATEGY_BADGES: Record<StrategyBadgeId, StrategyBadgeDef> = {
  post_listing_decay: {
    id: "post_listing_decay",
    label: "上場30-60日崩壊",
    icon: "🕐",
    description: "上場30-60日経過、FOMO消失で下落トレンド（勝率44%, BTC↓時71%）",
    expiryDays: 14,
    category: "timing",
  },
  listing_vol_collapse: {
    id: "listing_vol_collapse",
    label: "上場後出来高崩壊",
    icon: "📉",
    description: "上場後に出来高が7日平均の30%以下に枯渇（勝率55%, BTC↓時100%）",
    expiryDays: 14,
    category: "timing",
  },
  listing_pump_fade: {
    id: "listing_pump_fade",
    label: "上場ポンプ後崩壊",
    icon: "🎪",
    description: "上場30日以内ATH到達+現在ATHから-40%下落（勝率42%, BTC↓時78%）",
    expiryDays: 14,
    category: "timing",
  },
  listing_bounce_trap: {
    id: "listing_bounce_trap",
    label: "上場後バウンストラップ",
    icon: "🪤",
    description: "上場30-60日+ATH-50%下落後に20%反発中（勝率52%）",
    expiryDays: 10,
    category: "timing",
  },
  listing_ath70: {
    id: "listing_ath70",
    label: "上場30-60日+ATH-70%",
    icon: "💀",
    description: "上場30-60日でATHから-70%以上下落（勝率43%, PF 2.23）",
    expiryDays: 14,
    category: "timing",
  },
  btc_crash_amplifier: {
    id: "btc_crash_amplifier",
    label: "BTC下落増幅",
    icon: "📡",
    description: "BTC下落時にアルトが倍速で下がるパターン（勝率36%, BTC↓時41%）",
    expiryDays: 7,
    category: "momentum",
  },
  dead_cat_bounce: {
    id: "dead_cat_bounce",
    label: "デッドキャットバウンス",
    icon: "🐱",
    description: "-50%暴落後に反発、反発の頂点でショート（勝率35%, BTC↓時42%）",
    expiryDays: 10,
    category: "structure",
  },
  rsi_reversal: {
    id: "rsi_reversal",
    label: "RSI過熱反転",
    icon: "🌡️",
    description: "RSI14が70超過、過熱からの反転（勝率34%）",
    expiryDays: 7,
    category: "momentum",
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
