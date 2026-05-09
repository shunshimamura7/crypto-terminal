import type { KlineBar } from "./mexc";

export interface EntryPoint {
  barIndex: number;
  timeSec: number;
  price: number;
}

export type EntryDetector = (bars: KlineBar[], createTimeSec: number) => EntryPoint | null;

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  detector: EntryDetector;
}

const HOUR_BARS = 4;
const DAY_BARS = 96;

function findBarAtTime(bars: KlineBar[], targetSec: number): number | null {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i][0] >= targetSec) return i;
  }
  return null;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    const v = values[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

const s01_listing_24h: EntryDetector = (bars, createTimeSec) => {
  const targetSec = createTimeSec + 24 * 3600;
  const idx = findBarAtTime(bars, targetSec);
  if (idx === null) return null;
  return { barIndex: idx, timeSec: bars[idx][0], price: bars[idx][4] };
};

const s02_listing_48h: EntryDetector = (bars, createTimeSec) => {
  const targetSec = createTimeSec + 48 * 3600;
  const idx = findBarAtTime(bars, targetSec);
  if (idx === null) return null;
  return { barIndex: idx, timeSec: bars[idx][0], price: bars[idx][4] };
};

const s03_listing_72h: EntryDetector = (bars, createTimeSec) => {
  const targetSec = createTimeSec + 72 * 3600;
  const idx = findBarAtTime(bars, targetSec);
  if (idx === null) return null;
  return { barIndex: idx, timeSec: bars[idx][0], price: bars[idx][4] };
};

const s04_listing_7d: EntryDetector = (bars, createTimeSec) => {
  const targetSec = createTimeSec + 7 * 86400;
  const idx = findBarAtTime(bars, targetSec);
  if (idx === null) return null;
  return { barIndex: idx, timeSec: bars[idx][0], price: bars[idx][4] };
};

const s05_ath_30retest: EntryDetector = (bars) => {
  if (bars.length < 4) return null;
  let ath = bars[0][2];
  let athIdx = 0;
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i][2];
    if (high > ath) {
      ath = high;
      athIdx = i;
      continue;
    }
    if (i > athIdx + 4) {
      const close = bars[i][4];
      const drawdown = (ath - close) / ath;
      if (drawdown >= 0.30) {
        return { barIndex: i, timeSec: bars[i][0], price: close };
      }
    }
  }
  return null;
};

const s06_ath_50retest: EntryDetector = (bars) => {
  if (bars.length < 4) return null;
  let ath = bars[0][2];
  let athIdx = 0;
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i][2];
    if (high > ath) {
      ath = high;
      athIdx = i;
      continue;
    }
    if (i > athIdx + 4) {
      const close = bars[i][4];
      const drawdown = (ath - close) / ath;
      if (drawdown >= 0.50) {
        return { barIndex: i, timeSec: bars[i][0], price: close };
      }
    }
  }
  return null;
};

const s07_volume_peak_after: EntryDetector = (bars) => {
  const W = HOUR_BARS;
  if (bars.length < W * 4) return null;

  let peakSum = 0;
  let peakEndIdx = -1;
  for (let i = W - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < W; j++) sum += bars[i - j][6];
    if (sum > peakSum) {
      peakSum = sum;
      peakEndIdx = i;
    }
  }
  if (peakEndIdx === -1 || peakSum === 0) return null;

  for (let i = peakEndIdx + 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < W; j++) sum += bars[i - j][6];
    if (sum < peakSum * 0.5) {
      return { barIndex: i, timeSec: bars[i][0], price: bars[i][4] };
    }
  }
  return null;
};

const s08_rave_pattern: EntryDetector = (bars) => {
  const W = DAY_BARS;
  if (bars.length < W * 2 + 1) return null;

  for (let i = W * 2; i < bars.length; i++) {
    const recentClose = bars[i][4];
    const past24hClose = bars[i - W][4];
    let recentVol = 0;
    let prevVol = 0;
    for (let j = 0; j < W; j++) {
      recentVol += bars[i - j][6];
      prevVol += bars[i - W - j][6];
    }

    const priceUp = (recentClose - past24hClose) / past24hClose;
    const volChange = prevVol > 0 ? (recentVol - prevVol) / prevVol : 0;

    if (priceUp >= 0.05 && volChange <= -0.30) {
      return { barIndex: i, timeSec: bars[i][0], price: recentClose };
    }
  }
  return null;
};

const s09_initial_retest_fail: EntryDetector = (bars) => {
  if (bars.length < 50) return null;
  const initial = bars[0][4];
  let leftInitial = false;

  for (let i = 1; i < bars.length - 1; i++) {
    const close = bars[i][4];
    const distFromInitial = Math.abs(close - initial) / initial;

    if (!leftInitial && distFromInitial > 0.10) {
      leftInitial = true;
    }

    if (leftInitial && distFromInitial < 0.02) {
      const next = bars[i + 1];
      if (next[4] < next[1]) {
        return { barIndex: i + 1, timeSec: next[0], price: next[4] };
      }
    }
  }
  return null;
};

const s10_listing_24h_down: EntryDetector = (bars, createTimeSec) => {
  const targetSec = createTimeSec + 24 * 3600;
  const idx = findBarAtTime(bars, targetSec);
  if (idx === null || idx < 21) return null;

  const closes = bars.slice(0, idx + 1).map(b => b[4]);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const last9 = ema9[ema9.length - 1];
  const last21 = ema21[ema21.length - 1];

  if (last9 < last21 && (last21 - last9) / last21 > 0.005) {
    return { barIndex: idx, timeSec: bars[idx][0], price: bars[idx][4] };
  }
  return null;
};

export function findBarAtTimeExported(bars: KlineBar[], targetSec: number): number | null {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i][0] >= targetSec) return i;
  }
  return null;
}

export function makeListingHourDetector(hours: number): EntryDetector {
  return (bars, createTimeSec) => {
    const targetSec = createTimeSec + hours * 3600;
    const idx = findBarAtTimeExported(bars, targetSec);
    if (idx === null) return null;
    return { barIndex: idx, timeSec: bars[idx][0], price: bars[idx][4] };
  };
}

export const STRATEGIES: StrategyDef[] = [
  { id: "S01", name: "listing+24h",         description: "上場後24h時点",           detector: s01_listing_24h },
  { id: "S02", name: "listing+48h",         description: "上場後48h時点",           detector: s02_listing_48h },
  { id: "S03", name: "listing+72h",         description: "上場後72h時点",           detector: s03_listing_72h },
  { id: "S04", name: "listing+7d",          description: "上場後7日時点",           detector: s04_listing_7d },
  { id: "S05", name: "ATH-30%retest",       description: "ATH更新後30%引き戻し",    detector: s05_ath_30retest },
  { id: "S06", name: "ATH-50%retest",       description: "ATH更新後50%引き戻し",    detector: s06_ath_50retest },
  { id: "S07", name: "volume-peak-after",   description: "1h出来高ピーク→50%減",   detector: s07_volume_peak_after },
  { id: "S08", name: "RAVE-pattern",        description: "価格上昇+出来高減",       detector: s08_rave_pattern },
  { id: "S09", name: "initial-retest-fail", description: "初値リテスト失敗",        detector: s09_initial_retest_fail },
  { id: "S10", name: "listing+24h-down",    description: "上場+24h かつ DOWN-trend", detector: s10_listing_24h_down },
];
