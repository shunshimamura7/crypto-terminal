// Bitget Low-Lev Short Finder — scoring logic
// Max total: 5+5+4+4+6+4+2 = 30pt

export type TrendDir = "UP" | "DOWN" | "NEUTRAL";

export interface BitgetShortScoreBreakdown {
  dropScore:       number; // 0-5: ATH14d drop depth
  frScore:         number; // 0-5: Funding rate bias
  volumeDryScore:  number; // 0-4: Volume dryness vs avg7d
  oiScore:         number; // 0-4: OI / vol24h ratio
  trendScore:      number; // 0-6: Multi-TF downtrend (2pt per DOWN TF)
  pumpScore:       number; // 0-4: 7d pump (dead-cat setup)
  btcNonCorrScore: number; // 0-2: Independence from BTC movement
}

export interface BitgetTradeSetup {
  entry:     number;
  entryZone: { low: number; high: number };
  sl:        number;
  tp1:       number;
  tp2:       number;
  rrRatio:   number;
  rrWarning: boolean;
}

export interface BitgetShortCandidate {
  symbol:            string;
  currentPrice:      number;
  ath14d:            number;
  athDropPct:        number;
  volume24h:         number;
  volumeAvg7d:       number;
  volumeChangeRatio: number;
  fundingRate:       number | null;
  openInterest:      number;
  oiRatio:           number;
  longRatio:         number | null;
  priceChange24h:    number;
  priceChange7d:     number;
  trendH1:           TrendDir;
  trendH4:           TrendDir;
  trendD1:           TrendDir;
  trendAlignment:    number;
  shortScore:        number;
  breakdown:         BitgetShortScoreBreakdown;
  tradeSetup:        BitgetTradeSetup | null;
  frWeeklyCost:      number;
  recommendedLev:    number;
}

// ─── EMA helpers ─────────────────────────────────────────────────────────────

function calcEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

export function calcTrendDir(closes: number[]): TrendDir {
  if (closes.length < 21) return "NEUTRAL";
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  if (ema21 === 0) return "NEUTRAL";
  const diffPct = (ema9 - ema21) / ema21 * 100;
  if (diffPct < -0.5) return "DOWN";
  if (diffPct > 0.5)  return "UP";
  return "NEUTRAL";
}

// ─── BTC correlation (Pearson on daily returns) ───────────────────────────────

export function calcBtcCorrelation(coinCloses: number[], btcCloses: number[]): number {
  const n = Math.min(coinCloses.length, btcCloses.length);
  if (n < 4) return 0.5;
  const a = coinCloses.slice(-n), b = btcCloses.slice(-n);
  const rA: number[] = [], rB: number[] = [];
  for (let i = 1; i < n; i++) {
    if (a[i - 1] > 0 && b[i - 1] > 0) {
      rA.push((a[i] - a[i - 1]) / a[i - 1]);
      rB.push((b[i] - b[i - 1]) / b[i - 1]);
    }
  }
  const m = rA.length;
  if (m < 3) return 0.5;
  const mA = rA.reduce((s, v) => s + v, 0) / m;
  const mB = rB.reduce((s, v) => s + v, 0) / m;
  let num = 0, ssA = 0, ssB = 0;
  for (let i = 0; i < m; i++) {
    const dA = rA[i] - mA, dB = rB[i] - mB;
    num += dA * dB; ssA += dA * dA; ssB += dB * dB;
  }
  const denom = Math.sqrt(ssA * ssB);
  return denom === 0 ? 0.5 : Math.max(-1, Math.min(1, num / denom));
}

// ─── Sub-scores ───────────────────────────────────────────────────────────────

export function calcDropScore(athDropPct: number): number {
  const d = Math.abs(athDropPct);
  if (d >= 70) return 5;
  if (d >= 55) return 4;
  if (d >= 40) return 3;
  if (d >= 30) return 2;
  if (d >= 20) return 1;
  return 0;
}

// Positive FR = longs pay shorts = favorable for shorts (0-5)
export function calcFrScore(fr: number | null): number {
  if (fr === null) return 0;
  if (fr >= 0.0005)  return 5;  // ≥ 0.05%/8h
  if (fr >= 0.0003)  return 4;  // ≥ 0.03%
  if (fr >= 0.0002)  return 3;  // ≥ 0.02%
  if (fr >= 0.0001)  return 2;  // ≥ 0.01%
  if (fr >= 0.00005) return 1;  // ≥ 0.005%
  return 0;
}

export function calcVolumeDryScore(volumeChangeRatio: number): number {
  if (volumeChangeRatio < 0.15) return 4;
  if (volumeChangeRatio < 0.30) return 3;
  if (volumeChangeRatio < 0.50) return 2;
  if (volumeChangeRatio < 0.70) return 1;
  return 0;
}

export function calcOiScore(oiRatio: number): number {
  if (oiRatio >= 5.0) return 4;
  if (oiRatio >= 3.0) return 3;
  if (oiRatio >= 1.5) return 2;
  if (oiRatio >= 0.5) return 1;
  return 0;
}

// 2pt per DOWN timeframe (max 6)
export function calcTrendScore(h1: TrendDir, h4: TrendDir, d1: TrendDir): { score: number; alignment: number } {
  const downCount = [h1, h4, d1].filter(t => t === "DOWN").length;
  return { score: downCount * 2, alignment: downCount };
}

export function calcPumpScore(priceChange7d: number): number {
  if (priceChange7d >= 100) return 4;
  if (priceChange7d >= 60)  return 3;
  if (priceChange7d >= 40)  return 2;
  if (priceChange7d >= 20)  return 1;
  return 0;
}

export function calcBtcNonCorrScore(btcCorr: number): number {
  if (btcCorr < 0.3) return 2;
  if (btcCorr < 0.5) return 1;
  return 0;
}

// Weekly FR cost for shorts: negative = earning (positive FR), positive = paying (negative FR)
// Bitget settles 3x/day → 21 settlements/week
export function calcFrWeeklyCost(fr: number | null): number {
  if (fr === null) return 0;
  return -(fr * 21 * 100);
}

export function calcRecommendedLev(athDropPct: number, trendAlignment: number, fr: number | null): number {
  const d = Math.abs(athDropPct);
  let lev = d >= 55 ? 2 : 1;
  if (trendAlignment >= 2 && lev < 2) lev = 2;
  if (fr !== null && fr < -0.0003) lev = 1;
  return lev;
}

export function calcBitgetTradeSetup(
  currentPrice: number,
  highs4h: number[],
  lows4h: number[],
): BitgetTradeSetup | null {
  if (highs4h.length < 3) return null;
  const recentHigh = Math.max(...highs4h.slice(-10));
  const sl  = Math.min(recentHigh * 1.03, currentPrice * 1.10);
  const tp1 = currentPrice * 0.85;
  const validLows = lows4h.filter(v => v > 0);
  const tp2 = validLows.length > 0 ? Math.min(...validLows) : currentPrice * 0.70;
  const risk    = sl - currentPrice;
  const reward  = currentPrice - tp1;
  const rrRatio = risk > 0 ? reward / risk : 0;
  const entryZone = {
    low:  currentPrice,
    high: Math.min(currentPrice * 1.02, sl * 0.97),
  };
  return { entry: currentPrice, entryZone, sl, tp1, tp2, rrRatio, rrWarning: rrRatio < 1.5 };
}

// ─── Composite score (30pt max) ───────────────────────────────────────────────

export function calcBitgetShortScore(
  athDropPct:        number,
  fr:                number | null,
  volumeChangeRatio: number,
  oiRatio:           number,
  h1:                TrendDir,
  h4:                TrendDir,
  d1:                TrendDir,
  priceChange7d:     number,
  btcCorr:           number = 0.5,
): { score: number; breakdown: BitgetShortScoreBreakdown; trendAlignment: number } {
  const dropScore       = calcDropScore(athDropPct);
  const frScore         = calcFrScore(fr);
  const volumeDryScore  = calcVolumeDryScore(volumeChangeRatio);
  const oiScore         = calcOiScore(oiRatio);
  const { score: trendScore, alignment: trendAlignment } = calcTrendScore(h1, h4, d1);
  const pumpScore       = calcPumpScore(priceChange7d);
  const btcNonCorrScore = calcBtcNonCorrScore(btcCorr);

  return {
    score: dropScore + frScore + volumeDryScore + oiScore + trendScore + pumpScore + btcNonCorrScore,
    breakdown: { dropScore, frScore, volumeDryScore, oiScore, trendScore, pumpScore, btcNonCorrScore },
    trendAlignment,
  };
}
