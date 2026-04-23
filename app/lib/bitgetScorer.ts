// Bitget Low-Lev Short Finder — scoring logic
// Max total: 6+6+3+3+4+5+3 = 30pt

export type TrendDir = "UP" | "DOWN" | "NEUTRAL";

export interface BitgetShortScoreBreakdown {
  dropScore:      number; // 0-6: ATH14d drop depth
  frScore:        number; // 0-6: Funding rate (positive FR = shorts get paid)
  frBiasScore:    number; // 0-3: Extreme FR bonus (FR偏り重視)
  volumeDryScore: number; // 0-3: Volume dryness vs avg7d (出来高枯渇)
  oiScore:        number; // 0-4: OI / vol24h ratio
  trendScore:     number; // 0-5: Multi-TF downtrend alignment
  pumpScore:      number; // 0-3: 7d pump (dead-cat setup)
}

export interface BitgetTradeSetup {
  entry:     number;
  sl:        number;   // stop loss: above entry for shorts
  tp1:       number;   // first target
  tp2:       number;   // second target (recent 14d low)
  rrRatio:   number;
  rrWarning: boolean;  // true when R:R < 1.5
}

export interface BitgetShortCandidate {
  symbol:         string;
  currentPrice:   number;
  ath14d:         number;
  athDropPct:     number;
  volume24h:      number;  // USDT
  volumeAvg7d:    number;  // USDT (7d daily avg)
  volumeChangeRatio: number; // vol24h / avg7d
  fundingRate:    number | null;
  openInterest:   number;  // USDT value
  oiRatio:        number;  // OI / vol24h
  longRatio:      number | null; // 0-1: long position ratio from Stage 3 (display only)
  priceChange24h: number;  // %
  priceChange7d:  number;  // %
  trendH1:        TrendDir;
  trendH4:        TrendDir;
  trendD1:        TrendDir;
  trendAlignment: number;  // count of DOWN timeframes (0-3)
  shortScore:     number;  // 0-30
  breakdown:      BitgetShortScoreBreakdown;
  tradeSetup:     BitgetTradeSetup | null;
  frWeeklyCost:   number;  // % weekly: negative = earning, positive = paying
  recommendedLev: number;  // 1-5x
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

// ─── Sub-scores ───────────────────────────────────────────────────────────────

export function calcDropScore(athDropPct: number): number {
  const d = Math.abs(athDropPct);
  if (d >= 80) return 6;
  if (d >= 60) return 5;
  if (d >= 40) return 4;
  if (d >= 25) return 3;
  if (d >= 15) return 2;
  if (d >= 5)  return 1;
  return 0;
}

// Positive FR = longs pay shorts = favorable for shorts (0-6)
export function calcFrScore(fr: number | null): number {
  if (fr === null) return 0;
  if (fr >= 0.0010)  return 6;
  if (fr >= 0.0005)  return 5;
  if (fr >= 0.0002)  return 4;
  if (fr >= 0.0001)  return 3;
  if (fr >= 0)       return 2;
  if (fr >= -0.0001) return 1;
  return 0;
}

// Extra bonus for extreme positive FR (FRの偏り重視, 0-3)
export function calcFrBiasScore(fr: number | null): number {
  if (fr === null) return 0;
  if (fr >= 0.002)  return 3;
  if (fr >= 0.001)  return 2;
  if (fr >= 0.0005) return 1;
  return 0;
}

// Volume dryness: vol24h / avg7d (出来高枯渇, 0-3)
export function calcVolumeDryScore(volumeChangeRatio: number): number {
  if (volumeChangeRatio < 0.3) return 3;
  if (volumeChangeRatio < 0.5) return 2;
  if (volumeChangeRatio < 0.7) return 1;
  return 0;
}

export function calcOiScore(oiRatio: number): number {
  if (oiRatio >= 5.0) return 4;
  if (oiRatio >= 3.0) return 3;
  if (oiRatio >= 1.5) return 2;
  if (oiRatio >= 0.5) return 1;
  return 0;
}

export function calcTrendScore(h1: TrendDir, h4: TrendDir, d1: TrendDir): { score: number; alignment: number } {
  const downCount = [h1, h4, d1].filter(t => t === "DOWN").length;
  const score = downCount >= 3 ? 5 : downCount === 2 ? 4 : downCount === 1 ? 2 : 0;
  return { score, alignment: downCount };
}

export function calcPumpScore(priceChange7d: number): number {
  if (priceChange7d >= 100) return 3;
  if (priceChange7d >= 50)  return 2;
  if (priceChange7d >= 20)  return 1;
  return 0;
}

// Weekly FR cost for shorts: negative = earning (positive = paying out)
// Bitget settles 3x/day → 21 settlements/week
export function calcFrWeeklyCost(fr: number | null): number {
  if (fr === null) return 0;
  return -(fr * 21 * 100);
}

// Recommended leverage (1-5x) based on volatility proxies
export function calcRecommendedLev(athDropPct: number, trendAlignment: number, fr: number | null): number {
  const d = Math.abs(athDropPct);
  let lev = d >= 70 ? 2 : d >= 40 ? 3 : 4;
  if (trendAlignment >= 3) lev = Math.min(5, lev + 1);
  if (fr !== null && fr < -0.0003) lev = Math.max(1, lev - 1);
  return lev;
}

export function calcBitgetTradeSetup(
  currentPrice: number,
  highs4h: number[],
  lows4h: number[],
): BitgetTradeSetup | null {
  if (highs4h.length < 3) return null;

  const recentHigh = Math.max(...highs4h.slice(-10));
  const sl = Math.min(recentHigh * 1.03, currentPrice * 1.10);

  const tp1 = currentPrice * 0.85;
  const validLows = lows4h.filter(v => v > 0);
  const tp2 = validLows.length > 0 ? Math.min(...validLows) : currentPrice * 0.70;

  const risk   = sl - currentPrice;
  const reward = currentPrice - tp1;
  const rrRatio = risk > 0 ? reward / risk : 0;

  return { entry: currentPrice, sl, tp1, tp2, rrRatio, rrWarning: rrRatio < 1.5 };
}

// ─── Composite score (30pt max) ───────────────────────────────────────────────

export function calcBitgetShortScore(
  athDropPct:          number,
  fr:                  number | null,
  volumeChangeRatio:   number,
  oiRatio:             number,
  h1:                  TrendDir,
  h4:                  TrendDir,
  d1:                  TrendDir,
  priceChange7d:       number,
): { score: number; breakdown: BitgetShortScoreBreakdown; trendAlignment: number } {
  const dropScore      = calcDropScore(athDropPct);
  const frScore        = calcFrScore(fr);
  const frBiasScore    = calcFrBiasScore(fr);
  const volumeDryScore = calcVolumeDryScore(volumeChangeRatio);
  const oiScore        = calcOiScore(oiRatio);
  const { score: trendScore, alignment: trendAlignment } = calcTrendScore(h1, h4, d1);
  const pumpScore      = calcPumpScore(priceChange7d);

  return {
    score: dropScore + frScore + frBiasScore + volumeDryScore + oiScore + trendScore + pumpScore,
    breakdown: { dropScore, frScore, frBiasScore, volumeDryScore, oiScore, trendScore, pumpScore },
    trendAlignment,
  };
}
