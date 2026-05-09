import type { KlineBar } from "./mexc";
import type { EntryPoint } from "./strategies";

const TIMEOUT_HOURS = 14 * 24;
const MIN15_PER_HOUR = 4;

export interface SimOutcome {
  exitReason: "tp_hit" | "sl_hit" | "timeout";
  exitBarIndex: number;
  exitTimeSec: number;
  exitPrice: number;
  holdingHours: number;
  pnlPct: number;
  pnlR: number;
  maxFavorablePct: number;
  maxAdversePct: number;
}

/**
 * ショート前提:
 *   tpPct は負（例: -25 → 価格-25%でTP）
 *   slPct は正（例: 10 → 価格+10%でSL）
 *   PnL = (entryPrice - exitPrice) / entryPrice * 100（下落=利益）
 */
export function simulateExit(
  bars: KlineBar[],
  entry: EntryPoint,
  tpPct: number,
  slPct: number,
): SimOutcome {
  const entryPrice = entry.price;
  const tpPrice = entryPrice * (1 + tpPct / 100);
  const slPrice = entryPrice * (1 + slPct / 100);

  const maxBars = TIMEOUT_HOURS * MIN15_PER_HOUR;
  const lastIdx = Math.min(entry.barIndex + maxBars, bars.length - 1);

  let maxFav = 0;
  let maxAdv = 0;

  for (let i = entry.barIndex + 1; i <= lastIdx; i++) {
    const bar = bars[i];
    const high = bar[2];
    const low = bar[3];

    const tpHitInBar = low <= tpPrice;
    const slHitInBar = high >= slPrice;

    const favHere = (entryPrice - low) / entryPrice * 100;
    const advHere = (entryPrice - high) / entryPrice * 100;
    if (favHere > maxFav) maxFav = favHere;
    if (advHere < maxAdv) maxAdv = advHere;

    if (tpHitInBar && slHitInBar) {
      const pnlPct = (entryPrice - slPrice) / entryPrice * 100;
      return {
        exitReason: "sl_hit",
        exitBarIndex: i,
        exitTimeSec: bar[0],
        exitPrice: slPrice,
        holdingHours: (bar[0] - entry.timeSec) / 3600,
        pnlPct,
        pnlR: pnlPct / Math.abs(slPct),
        maxFavorablePct: maxFav,
        maxAdversePct: maxAdv,
      };
    }

    if (tpHitInBar) {
      const pnlPct = (entryPrice - tpPrice) / entryPrice * 100;
      return {
        exitReason: "tp_hit",
        exitBarIndex: i,
        exitTimeSec: bar[0],
        exitPrice: tpPrice,
        holdingHours: (bar[0] - entry.timeSec) / 3600,
        pnlPct,
        pnlR: pnlPct / Math.abs(slPct),
        maxFavorablePct: maxFav,
        maxAdversePct: maxAdv,
      };
    }

    if (slHitInBar) {
      const pnlPct = (entryPrice - slPrice) / entryPrice * 100;
      return {
        exitReason: "sl_hit",
        exitBarIndex: i,
        exitTimeSec: bar[0],
        exitPrice: slPrice,
        holdingHours: (bar[0] - entry.timeSec) / 3600,
        pnlPct,
        pnlR: pnlPct / Math.abs(slPct),
        maxFavorablePct: maxFav,
        maxAdversePct: maxAdv,
      };
    }
  }

  const last = bars[lastIdx];
  const pnlPct = (entryPrice - last[4]) / entryPrice * 100;
  return {
    exitReason: "timeout",
    exitBarIndex: lastIdx,
    exitTimeSec: last[0],
    exitPrice: last[4],
    holdingHours: (last[0] - entry.timeSec) / 3600,
    pnlPct,
    pnlR: pnlPct / Math.abs(slPct),
    maxFavorablePct: maxFav,
    maxAdversePct: maxAdv,
  };
}
