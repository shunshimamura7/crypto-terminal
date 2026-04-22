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
  volumeProfile: VolumeProfile | null;  // 施策8
  tradeSetup: TradeSetup | null;        // 施策10
  shortScore: number;       // server max 16
  scoreBreakdown: ShortScoreBreakdown;
}

// ─── Volume Profile (施策8) ───────────────────────────────────────────────────

export interface VolumeProfileBucket {
  low: number;
  high: number;
  vol: number;
}

export interface VolumeProfile {
  poc: number;                       // Point of Control (最大出来高価格帯の中央値)
  buckets: VolumeProfileBucket[];    // 10バケット (安値→高値順)
  pocVsPricePct: number;             // (現在価格 - POC) / POC * 100
}

export function calcVolumeProfile(
  highs: number[],
  lows: number[],
  volumes: number[],
  currentPrice: number,
  bucketCount = 10,
): VolumeProfile | null {
  if (highs.length === 0 || highs.length !== lows.length || highs.length !== volumes.length) return null;

  const rangeHigh = Math.max(...highs);
  const rangeLow  = Math.min(...lows.filter(v => v > 0));
  if (rangeLow <= 0 || rangeHigh <= rangeLow) return null;

  const step = (rangeHigh - rangeLow) / bucketCount;
  const buckets: VolumeProfileBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    low:  rangeLow + i * step,
    high: rangeLow + (i + 1) * step,
    vol:  0,
  }));

  for (let i = 0; i < highs.length; i++) {
    const vol = volumes[i];
    if (!vol || vol <= 0) continue;
    // ローソクが跨ぐバケットに分配
    for (const b of buckets) {
      const overlap = Math.min(highs[i], b.high) - Math.max(lows[i], b.low);
      if (overlap > 0) {
        const span = highs[i] - lows[i];
        b.vol += span > 0 ? vol * (overlap / span) : vol / bucketCount;
      }
    }
  }

  const maxBucket = buckets.reduce((a, b) => b.vol > a.vol ? b : a, buckets[0]);
  const poc = (maxBucket.low + maxBucket.high) / 2;

  return {
    poc,
    buckets,
    pocVsPricePct: poc > 0 ? (currentPrice - poc) / poc * 100 : 0,
  };
}

// ─── Trade Setup (施策10) ─────────────────────────────────────────────────────

export interface TradeSetup {
  sl: number;           // 損切りライン
  tp1: number;          // 利確1 (POC or サポート近傍)
  tp2: number;          // 利確2 (直近安値)
  tp3: number;          // 利確3 (保守的深め)
  rrRatio: number;      // (エントリー - TP1) / (SL - エントリー)
  rrWarning: boolean;   // R:R < 1.5
  resistanceLevel: number; // 高出来高レジスタンス
}

export function calcTradeSetup(
  currentPrice: number,
  highs: number[],
  lows: number[],
  volumes: number[],
  volumeProfile: VolumeProfile | null,
): TradeSetup {
  // ── SL: 高出来高レジスタンス TOP3 high の最大値 × 1.02、または現在価格×1.08 の小さい方 ──
  let resistanceLevel = currentPrice * 1.08;
  if (highs.length >= 3 && volumes.length === highs.length) {
    // 直近10本のKlineでvolume TOP3のhighを取得
    const recent = Math.min(10, highs.length);
    const recent10 = highs
      .slice(-recent)
      .map((h, i) => ({ high: h, vol: volumes[volumes.length - recent + i] }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 3);
    if (recent10.length > 0) {
      const resistHigh = Math.max(...recent10.map(r => r.high)) * 1.02;
      resistanceLevel = Math.min(resistHigh, currentPrice * 1.08);
    }
  }
  const sl = resistanceLevel;

  // ── TP1: POC または POCの下のサポートバケット (出来高多い帯の下限) ──
  let tp1 = currentPrice * 0.85;
  if (volumeProfile) {
    const supportBuckets = volumeProfile.buckets
      .filter(b => b.high < currentPrice)
      .sort((a, b) => b.vol - a.vol);
    if (supportBuckets.length > 0) {
      tp1 = supportBuckets[0].low;
    }
  }

  // ── TP2: 直近安値 (最近20本のKline中最低値) ──
  let tp2 = currentPrice * 0.70;
  if (lows.length >= 2) {
    const recent20 = lows.slice(-Math.min(20, lows.length)).filter(v => v > 0);
    if (recent20.length > 0) tp2 = Math.min(...recent20);
  }

  // ── TP3: 現在価格×0.55 or 直近安値×0.9 の大きい方（より保守的） ──
  const tp3 = Math.max(currentPrice * 0.55, tp2 * 0.9);

  // ── R:R 計算 ──
  const risk   = sl - currentPrice;
  const reward = currentPrice - tp1;
  const rrRatio = risk > 0 ? reward / risk : 0;

  return { sl, tp1, tp2, tp3, rrRatio, rrWarning: rrRatio < 1.5, resistanceLevel };
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
