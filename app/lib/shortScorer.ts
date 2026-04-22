// Short-scan scoring logic for MEXC Futures candidates

export type TrendDirection = "UP" | "DOWN" | "NEUTRAL";

export interface ShortScoreBreakdown {
  dropScore: number;       // 0-3
  volumeDryScore: number;  // 0-3
  frScore: number;         // 0-2
  freshnessScore: number;  // 0-2
  oiScore: number;         // 0-2 (施策1)
  trendScore: number;      // 0-2 (EMA9/EMA21)
  pumpScore: number;       // 0-2 (施策6: 7d急騰度)
}

export interface ShortCandidate {
  symbol: string;
  currentPrice: number;
  ath14d: number;
  athDropPct: number;
  volume24h: number;
  volumeAvg7d: number;
  volumeChangeRatio: number;
  fundingRate: number | null;
  openInterest: number;
  oiRatio: number;
  trendDirection: TrendDirection;
  listedDaysAgo: number;
  priceChange24h: number;   // % (施策6)
  priceChange7d: number;    // % (施策6)
  shortScore: number;       // server max 16
  scoreBreakdown: ShortScoreBreakdown;
}

// dropScore (0-3)
export function calcDropScore(athDropPct: number): number {
  const d = Math.abs(athDropPct);
  if (d >= 70) return 3;
  if (d >= 50) return 2;
  if (d >= 30) return 1;
  return 0;
}

// volumeDryScore (0-3)
export function calcVolumeDryScore(ratio: number): number {
  if (ratio < 0.1) return 3;
  if (ratio < 0.3) return 2;
  if (ratio < 0.5) return 1;
  return 0;
}

// frScore (0-2)
export function calcFRScore(fr: number | null): number {
  if (fr === null) return 0;
  if (fr > 0.0001) return 2;
  if (fr >= 0) return 1;
  return 0;
}

// freshnessScore (0-2)
export function calcFreshnessScore(listedDaysAgo: number): number {
  if (listedDaysAgo <= 3) return 2;
  if (listedDaysAgo <= 14) return 1;
  return 0;
}

// oiScore (0-2)
export function calcOIScore(oiRatio: number): number {
  if (oiRatio > 3.0) return 2;
  if (oiRatio > 1.5) return 1;
  return 0;
}

// pumpScore (0-2): 7d急騰度
export function calcPumpScore(priceChange7d: number): number {
  if (priceChange7d >= 100) return 2;
  if (priceChange7d >= 50)  return 1;
  return 0;
}

// EMA計算
function calcEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// trendScore (0-2): EMA9/EMA21によるトレンド判定
export function calcTrendScore(closes4h: number[]): { score: number; direction: TrendDirection } {
  if (closes4h.length < 21) return { score: 1, direction: "NEUTRAL" };
  const ema9  = calcEMA(closes4h, 9);
  const ema21 = calcEMA(closes4h, 21);
  if (ema21 === 0) return { score: 1, direction: "NEUTRAL" };
  const diffPct = (ema9 - ema21) / ema21 * 100;
  if (diffPct < -0.5) return { score: 2, direction: "DOWN" };
  if (diffPct > 0.5)  return { score: 0, direction: "UP" };
  return { score: 1, direction: "NEUTRAL" };
}

// exclusivityScore (0-2): 取引所独占度 (施策2, client-side)
export function calcExclusivityScore(listedOnBinance: boolean, listedOnBybit: boolean): number {
  if (!listedOnBinance && !listedOnBybit) return 2;
  if (!listedOnBinance || !listedOnBybit) return 1;
  return 0;
}

// Server-side score max: 3+3+2+2+2+2+2 = 16
export function calcShortScore(
  athDropPct: number,
  volumeChangeRatio: number,
  fundingRate: number | null,
  listedDaysAgo: number,
  openInterest: number,
  volume24h: number,
  closes4h: number[],
  priceChange7d: number,
): {
  score: number;
  breakdown: ShortScoreBreakdown;
  oiRatio: number;
  trendDirection: TrendDirection;
} {
  const dropScore      = calcDropScore(athDropPct);
  const volumeDryScore = calcVolumeDryScore(volumeChangeRatio);
  const frScore        = calcFRScore(fundingRate);
  const freshnessScore = calcFreshnessScore(listedDaysAgo);
  const oiRatio        = volume24h > 0 ? openInterest / volume24h : 0;
  const oiScore        = calcOIScore(oiRatio);
  const { score: trendScore, direction: trendDirection } = calcTrendScore(closes4h);
  const pumpScore      = calcPumpScore(priceChange7d);

  return {
    score: dropScore + volumeDryScore + frScore + freshnessScore + oiScore + trendScore + pumpScore,
    breakdown: { dropScore, volumeDryScore, frScore, freshnessScore, oiScore, trendScore, pumpScore },
    oiRatio,
    trendDirection,
  };
}

// フィルタ条件 (通常スキャン)
export function passesFilter(
  athDropPct: number,
  volumeChangeRatio: number,
  volume24h: number,
): boolean {
  return (
    athDropPct <= -30 &&
    volumeChangeRatio < 0.7 &&
    volume24h >= 100_000
  );
}

// フィルタ条件 (新規上場30日スキャン)
export function passesFilterNew30(
  athDropPct: number,
  volumeChangeRatio: number,
  volume24h: number,
  listedDaysAgo: number,
): boolean {
  return (
    athDropPct <= -10 &&
    volumeChangeRatio < 1.5 &&
    volume24h >= 10_000 &&
    listedDaysAgo <= 30
  );
}
