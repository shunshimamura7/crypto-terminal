// Bitget Low-Lev Long Finder — scoring logic
// Max total: 5+4+3+6+4+2+3+3 = 30pt

export type TrendDir = "UP" | "DOWN" | "NEUTRAL";

export interface BitgetLongScoreBreakdown {
  athDropScore: number; // 0-5: deep ATH drop = buy setup
  frScore:      number; // 0-4: negative FR = longs receive
  volRecScore:  number; // 0-3: volume recovery vs avg7d
  trendScore:   number; // 0-6: multi-TF uptrend (2pt per UP TF)
  rsiScore:     number; // 0-4: RSI oversold (≤30→4, ≤40→3, ≤50→1)
  btcCorrScore: number; // 0-2: high BTC correlation
  dip7dScore:   number; // 0-3: 7d price dip (buy the dip)
  oiScore:      number; // 0-3: low OI ratio (healthy)
}

export interface BitgetLongTradeSetup {
  entry:     number;
  entryZone: { low: number; high: number };
  sl:        number;
  tp1:       number;
  tp2:       number;
  rrRatio:   number;
  rrWarning: boolean;
}

export interface BitgetLongCandidate {
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
  trendAlignment:    number; // count of UP TFs
  longScore:         number;
  breakdown:         BitgetLongScoreBreakdown;
  tradeSetup:        BitgetLongTradeSetup | null;
  frWeeklyCost:      number;
  recommendedLev:    number;
  rsi:               number | null;
}

// ─── EMA / trend ─────────────────────────────────────────────────────────────

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

// Deep ATH drop = buy-the-dip opportunity
export function calcAthDropScore(athDropPct: number): number {
  const d = Math.abs(athDropPct);
  if (d >= 80) return 5;
  if (d >= 60) return 4;
  if (d >= 40) return 3;
  if (d >= 20) return 1;
  return 0;
}

// Negative FR = longs receive payments (good for longs)
export function calcLongFrScore(fr: number | null): number {
  if (fr === null) return 0;
  if (fr <= -0.001)  return 4; // ≤ -0.1%/8h
  if (fr <= -0.0005) return 3; // ≤ -0.05%
  if (fr <= 0)       return 2; // slightly negative or neutral
  if (fr <= 0.0005)  return 1; // ≤ +0.05%
  return 0;                     // > +0.05% = bad for longs
}

// Volume recovery vs 7d avg
export function calcVolRecScore(volumeChangeRatio: number): number {
  if (volumeChangeRatio >= 2.0) return 3;
  if (volumeChangeRatio >= 1.5) return 2;
  if (volumeChangeRatio >= 1.0) return 1;
  return 0;
}

// Multi-TF trend: UP counts for longs
export function calcLongTrendScore(h1: TrendDir, h4: TrendDir, d1: TrendDir): { score: number; alignment: number } {
  const upCount = [h1, h4, d1].filter(t => t === "UP").length;
  return { score: upCount * 2, alignment: upCount };
}

// RSI oversold = potential reversal for longs
export function calcLongRsiScore(closes: number[], period = 14): { score: number; rsiValue: number | null } {
  if (closes.length < period + 1) return { score: 0, rsiValue: null };
  const recent = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgLoss = losses / period;
  if (avgLoss === 0) return { score: 0, rsiValue: 100 };
  const rs = (gains / period) / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  const score = rsi <= 30 ? 4 : rsi <= 40 ? 3 : rsi <= 50 ? 1 : 0;
  return { score, rsiValue: rsi };
}

// High BTC correlation = follows BTC upside
export function calcBtcCorrScore(btcCorr: number): number {
  if (btcCorr >= 0.8) return 2;
  if (btcCorr >= 0.5) return 1;
  return 0;
}

// 7d dip = buy-the-dip signal
export function calcDip7dScore(priceChange7d: number): number {
  if (priceChange7d <= -30) return 3;
  if (priceChange7d <= -20) return 2;
  if (priceChange7d <= -10) return 1;
  return 0;
}

// Low OI ratio = less leveraged = healthier
export function calcLongOiScore(oiRatio: number): number {
  if (oiRatio <= 0.5) return 3;
  if (oiRatio <= 1.0) return 2;
  if (oiRatio <= 2.0) return 1;
  return 0;
}

// FR weekly cost for longs: positive = longs paying, negative = longs receiving
// Bitget settles 3x/day → 21 settlements/week
export function calcLongFrWeeklyCost(fr: number | null): number {
  if (fr === null) return 0;
  return fr * 21 * 100;
}

export function calcLongRecommendedLev(athDropPct: number, trendAlignment: number, fr: number | null): number {
  const d = Math.abs(athDropPct);
  let lev = d >= 60 ? 2 : 1;
  if (trendAlignment >= 2 && lev < 2) lev = 2;
  if (fr !== null && fr > 0.0003) lev = 1; // positive FR = costly for longs
  return lev;
}

// Long trade setup: entry near current, SL below recent low, TP above
export function calcBitgetLongTradeSetup(
  currentPrice: number,
  highs4h: number[],
  lows4h: number[],
): BitgetLongTradeSetup | null {
  if (lows4h.length < 3) return null;
  const validLows  = lows4h.filter(v => v > 0);
  const validHighs = highs4h.filter(v => v > 0);
  const recentLow  = Math.min(...validLows.slice(-10));
  const sl         = Math.max(recentLow * 0.97, currentPrice * 0.90);
  const tp1        = currentPrice * 1.15;
  const tp2        = validHighs.length > 0 ? Math.max(...validHighs) * 1.02 : currentPrice * 1.30;
  const risk       = currentPrice - sl;
  const reward     = tp1 - currentPrice;
  const rrRatio    = risk > 0 ? reward / risk : 0;
  const entryZone  = {
    low:  Math.max(currentPrice * 0.98, sl * 1.03),
    high: currentPrice,
  };
  return { entry: currentPrice, entryZone, sl, tp1, tp2, rrRatio, rrWarning: rrRatio < 1.5 };
}

// ─── Composite score ─────────────────────────────────────────────────────────

export function calcBitgetLongScore(
  athDropPct:        number,
  fr:                number | null,
  volumeChangeRatio: number,
  oiRatio:           number,
  h1:                TrendDir,
  h4:                TrendDir,
  d1:                TrendDir,
  priceChange7d:     number,
  btcCorr:           number = 0.5,
  closes4h:          number[] = [],
): { score: number; breakdown: BitgetLongScoreBreakdown; trendAlignment: number; rsi: number | null } {
  const athDropScore                          = calcAthDropScore(athDropPct);
  const frScore                               = calcLongFrScore(fr);
  const volRecScore                           = calcVolRecScore(volumeChangeRatio);
  const { score: trendScore, alignment }      = calcLongTrendScore(h1, h4, d1);
  const { score: rsiScore, rsiValue: rsi }    = calcLongRsiScore(closes4h);
  const btcCorrScore                          = calcBtcCorrScore(btcCorr);
  const dip7dScore                            = calcDip7dScore(priceChange7d);
  const oiScore                               = calcLongOiScore(oiRatio);

  return {
    score: athDropScore + frScore + volRecScore + trendScore + rsiScore + btcCorrScore + dip7dScore + oiScore,
    breakdown: { athDropScore, frScore, volRecScore, trendScore, rsiScore, btcCorrScore, dip7dScore, oiScore },
    trendAlignment: alignment,
    rsi,
  };
}
