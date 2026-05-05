import type { ShortCandidate } from "./shortScorer";
import type { ScanSnapshot } from "./snapshotStorage";
import type { StrategyBadgeId, ConvictionLevel } from "./strategyBadges";
import { getConvictionLevel, getMaxExpiryDays } from "./strategyBadges";

export interface BadgeDetectionContext {
  candidate: ShortCandidate;
  snapshots?: ScanSnapshot[];
  listedOnBinance?: boolean;
  listedOnBybit?: boolean;
  cgMarketCap?: number | null;
  cgFdv?: number | null;
  sectorCollapseActive?: boolean;
  // Market context
  btcChange24h?: number;
  marketPhase?: string;
  // Score components (optional — badge is skipped when undefined)
  rsiScore?: number;
}

export interface BadgeDetectionResult {
  badges: StrategyBadgeId[];
  convictionLevel: ConvictionLevel;
  expiryDays: number | undefined;
}

export function detectBadges(ctx: BadgeDetectionContext): BadgeDetectionResult {
  const { candidate: c, snapshots = [], btcChange24h, marketPhase, rsiScore } = ctx;
  const badges: StrategyBadgeId[] = [];

  // 1. post_listing_decay: 上場30-60日 + ATH-30%以上
  if (c.listedDaysAgo >= 30 && c.listedDaysAgo <= 60 && c.athDropPct <= -30) {
    badges.push("post_listing_decay");
  }

  // 2. listing_vol_collapse: 上場14-90日 + 出来高が7日平均の30%以下
  if (c.listedDaysAgo >= 14 && c.listedDaysAgo <= 90 && c.volumeChangeRatio < 0.30) {
    badges.push("listing_vol_collapse");
  }

  // 3. listing_pump_fade: 上場30日以内 + ATH-40%以上（上場直後ポンプ後崩壊）
  if (c.listedDaysAgo <= 30 && c.athDropPct <= -40) {
    badges.push("listing_pump_fade");
  }

  // 4. listing_bounce_trap: 上場30-60日 + ATH-50%以上 + 7日+10%以上反発中
  {
    const bounce = c.priceChange7d >= 10 ? c.priceChange7d : c.priceChange24h;
    if (
      c.listedDaysAgo >= 30 && c.listedDaysAgo <= 60 &&
      c.athDropPct <= -50 &&
      bounce >= 10
    ) {
      badges.push("listing_bounce_trap");
    }
  }

  // 5. listing_ath70: 上場30-60日 + ATH-70%以上
  if (c.listedDaysAgo >= 30 && c.listedDaysAgo <= 60 && c.athDropPct <= -70) {
    badges.push("listing_ath70");
  }

  // 6. btc_crash_amplifier: BTC相関が高い + Risk-Off or BTC急落中
  {
    const riskOff = marketPhase?.toUpperCase() === "RISK_OFF" || (btcChange24h !== undefined && btcChange24h < -2);
    if (c.btcCorrelation > 0.5 && riskOff) {
      badges.push("btc_crash_amplifier");
    }
  }

  // 7. dead_cat_bounce: ATH-50%以上下落後に20-40%反発中
  if (c.athDropPct <= -50 && c.priceChange7d >= 20 && c.priceChange7d <= 40) {
    badges.push("dead_cat_bounce");
  }

  // 8. rsi_reversal: RSIスコアが2以上（contextにない場合スキップ）
  if (rsiScore !== undefined && rsiScore >= 2) {
    badges.push("rsi_reversal");
  }

  // Deduplicate (listing_ath70 is a subset of post_listing_decay — keep both for conviction stacking)
  const convictionLevel = getConvictionLevel(badges.length);
  const expiryDays = badges.length > 0 ? getMaxExpiryDays(badges) : undefined;

  return { badges, convictionLevel, expiryDays };
}
