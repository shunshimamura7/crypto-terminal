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
}

export interface BadgeDetectionResult {
  badges: StrategyBadgeId[];
  convictionLevel: ConvictionLevel;
  expiryDays: number | undefined;
}

function getFRFromSnapshots(symbol: string, snapshots: ScanSnapshot[], limit = 10): Array<number | null> {
  return snapshots.slice(-limit).map(s => s.data[symbol]?.fr ?? null);
}

export function detectBadges(ctx: BadgeDetectionContext): BadgeDetectionResult {
  const {
    candidate: c,
    snapshots = [],
    listedOnBinance,
    listedOnBybit,
    cgMarketCap,
    cgFdv,
    sectorCollapseActive,
  } = ctx;

  const badges: StrategyBadgeId[] = [];

  // 1. post_listing_decay: 上場30-90日 + ATH下落30%以上
  if (c.listedDaysAgo >= 30 && c.listedDaysAgo <= 90 && c.athDropPct <= -30) {
    badges.push("post_listing_decay");
  }

  // 2. volume_death: vol24h/volAvg7d < 15%
  if (c.volumeChangeRatio < 0.15) {
    badges.push("volume_death");
  }

  // 3. exclusivity_trap: Binance/Bybit未上場 + volumeChangeRatio < 0.5
  if (listedOnBinance === false && listedOnBybit === false && c.volumeChangeRatio < 0.5) {
    badges.push("exclusivity_trap");
  }

  // 4. fdv_overhang: MC/FDV < 0.2 + 上場60日以上
  if (
    cgMarketCap != null && cgFdv != null &&
    cgFdv > 0 && cgMarketCap / cgFdv < 0.2 &&
    c.listedDaysAgo >= 60
  ) {
    badges.push("fdv_overhang");
  }

  // 5. fr_normalization: スナップショット3件以上でFRが高水準→低下開始
  if (snapshots.length >= 3 && c.fundingRate !== null) {
    const frHistory = getFRFromSnapshots(c.symbol, snapshots, 10);
    const last3 = frHistory.slice(-3);
    const allHigh = last3.length >= 3 && last3.every(fr => fr !== null && fr >= 0.0005);
    if (allHigh && c.fundingRate < 0.0005) {
      badges.push("fr_normalization");
    }
  }

  // 6. dead_cat_bounce: ATH下落50%以上 + 7d +20〜+40%反発中
  if (c.athDropPct <= -50 && c.priceChange7d >= 20 && c.priceChange7d <= 40) {
    badges.push("dead_cat_bounce");
  }

  // 7. sector_collapse: 外部から注入 (同カテゴリ3銘柄以上が7d-20%超)
  if (sectorCollapseActive === true) {
    badges.push("sector_collapse");
  }

  // 8. btc_divergence: BTC相関 < 0.2
  if (c.btcCorrelation < 0.2) {
    badges.push("btc_divergence");
  }

  // 9. leverage_trap: OI急増 + 価格横ばい (スナップショットで検証 or oiRatioで代替)
  if (snapshots.length >= 2) {
    const oldest = snapshots[0].data[c.symbol];
    if (oldest && oldest.oi > 0) {
      const oiGrowth = ((c.openInterest - oldest.oi) / oldest.oi) * 100;
      const priceStable = Math.abs(c.priceChange7d) < 5;
      if (oiGrowth >= 50 && priceStable) {
        badges.push("leverage_trap");
      }
    }
  } else if (c.oiRatio > 3 && Math.abs(c.priceChange7d) < 5) {
    badges.push("leverage_trap");
  }

  // 10. asia_dump: 直近24hで+15%以上ポンプ (12h priceChangeの代替)
  if (c.priceChange24h >= 15) {
    badges.push("asia_dump");
  }

  const convictionLevel = getConvictionLevel(badges.length);
  const expiryDays = badges.length > 0 ? getMaxExpiryDays(badges) : undefined;

  return { badges, convictionLevel, expiryDays };
}
