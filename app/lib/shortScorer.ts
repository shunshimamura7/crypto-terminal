// Short-scan scoring logic for MEXC Futures candidates

export type TrendDirection = "UP" | "DOWN" | "NEUTRAL";

// ─── Shared interfaces (used server + client) ────────────────────────────────

export interface CoinNewsContext {
  positiveCount: number;
  negativeCount: number;
  hasMajorListing: boolean;
  hasPartnership: boolean;
  hasSecurity: boolean;
  newsUrls: string[];
}

export interface LiquidityInfo {
  sellSlippage10k: number;
  sellSlippage50k: number;
  buySlippage10k: number;
  buySlippage50k: number;
  bidDepth: number;
  askDepth: number;
  spread: number;
  maxSafePosition: number;
}

export interface ShortScoreBreakdown {
  dropScore: number;       // 0-3
  volumeDryScore: number;  // 0-3
  frScore: number;         // 0-2
  freshnessScore: number;  // 0-2
  oiScore: number;         // 0-2
  oiChangeScore: number;   // 0-2 (OI変化率: クライアントサイドスナップショット)
  trendScore: number;      // 0-3 (マルチTF一致度: 3TF全DOWN=3, 2=2, 1=1, 0=0)
  pumpScore: number;       // 0-2 (7d急騰度)
  btcCorrScore: number;    // 0-1 (BTC非連動ボーナス)
  patternScore: number;    // 0-3 (SMCパターン: Task3で拡張)
  rsiScore: number;        // 0-2 (RSI過熱度)
}

// ─── Chart Pattern (施策4 + Phase2 Task3: SMC拡張) ───────────────────────────

export type PatternType = "bear_flag" | "dead_cat" | "descending_wedge" | "break_of_structure" | "fair_value_gap" | "supply_zone";

export interface ChartPattern {
  type: PatternType;
  confidence: number; // 0-1
}

// detectChartPatterns: 全パターンを返す (Phase2 Task3)
export function detectChartPatterns(
  closes: number[],
  highs: number[],
  lows: number[],
  priceChange24h: number,
  athDropPct: number,
): ChartPattern[] {
  const patterns: ChartPattern[] = [];
  if (closes.length < 10) return patterns;

  const n = closes.length;
  const split = Math.floor(n * 0.6);
  const phase1 = closes.slice(0, split);
  const phase2 = closes.slice(split);

  // ── Bear Flag: 急落 → 横ばい/小反発 ──
  if (phase1.length >= 5 && phase2.length >= 3) {
    const p1High = Math.max(...phase1);
    const p1Low  = Math.min(...phase1);
    const p1Drop = p1High > 0 ? (p1High - p1Low) / p1High : 0;
    const p2First = phase2[0];
    const p2Last  = phase2[phase2.length - 1];
    const p2Change = p2First > 0 ? (p2Last - p2First) / p2First : 0;
    const p2High   = Math.max(...phase2);
    if (p1Drop > 0.30 && Math.abs(p2Change) < 0.15 && p2High < p1High * 0.9) {
      patterns.push({ type: "bear_flag", confidence: Math.min(1, p1Drop) });
    }
  }

  // ── Dead Cat Bounce: 大幅下落後の短期反発 ──
  if (athDropPct <= -40 && priceChange24h >= 5) {
    patterns.push({ type: "dead_cat", confidence: 0.7 });
  }

  // ── Descending Wedge: 高値・安値ともに下降しレンジが収縮 ──
  if (highs.length >= 10 && lows.length >= 10) {
    const rHigh = highs.slice(-10);
    const rLow  = lows.slice(-10);
    const highDecline  = rHigh[0] > rHigh[rHigh.length - 1];
    const lowDecline   = rLow[0]  > rLow[rLow.length - 1];
    const rangeFirst   = rHigh[0] - rLow[0];
    const rangeLast    = rHigh[rHigh.length - 1] - rLow[rLow.length - 1];
    const narrowing    = rangeFirst > 0 && rangeLast < rangeFirst * 0.7;
    if (highDecline && lowDecline && narrowing) {
      patterns.push({ type: "descending_wedge", confidence: 0.6 });
    }
  }

  // ── Break of Structure (SMC): 切り下がり高値 + 切り下がり安値 ──
  if (highs.length >= 6 && lows.length >= 6) {
    const rH = highs.slice(-6);
    const rL = lows.slice(-6);
    const bosHighs = rH[0] > rH[2] && rH[2] > rH[4];
    const bosLows  = rL[1] > rL[3] && rL[3] > rL[5];
    if (bosHighs && bosLows) {
      patterns.push({ type: "break_of_structure", confidence: 0.7 });
    }
  }

  // ── Fair Value Gap (SMC): 下方向のギャップ (candle[i-2].low > candle[i].high) ──
  if (highs.length >= 3) {
    for (let i = 2; i < highs.length; i++) {
      if (lows[i - 2] > highs[i]) {
        const gapPct = closes[i] > 0 ? (lows[i - 2] - highs[i]) / closes[i] : 0;
        if (gapPct > 0.005) {
          patterns.push({ type: "fair_value_gap", confidence: Math.min(1, gapPct * 10) });
          break;
        }
      }
    }
  }

  // ── Supply Zone (SMC): 現在価格より上の高出来高反発ゾーン (高ひげ判定) ──
  if (highs.length >= 10) {
    const current = closes[closes.length - 1];
    for (let i = Math.max(0, highs.length - 10); i < highs.length - 1; i++) {
      if (highs[i] > current * 1.02) {
        const range = highs[i] - lows[i];
        const upperWick = highs[i] - Math.max(closes[i], (highs[i] + lows[i]) / 2);
        if (range > 0 && upperWick / range > 0.5) {
          patterns.push({ type: "supply_zone", confidence: 0.65 });
          break;
        }
      }
    }
  }

  return patterns;
}

// backwards-compat wrapper: 最初のパターンのみ返す
export function detectChartPattern(
  closes: number[],
  highs: number[],
  lows: number[],
  priceChange24h: number,
  athDropPct: number,
): ChartPattern | null {
  const all = detectChartPatterns(closes, highs, lows, priceChange24h, athDropPct);
  return all.length > 0 ? all[0] : null;
}

// patternScore (0-3): allPatternsがあれば件数、なければ従来の0-1
export function calcPatternScore(pattern: ChartPattern | null, allPatterns?: ChartPattern[]): number {
  if (allPatterns !== undefined) return Math.min(3, allPatterns.length);
  return pattern !== null ? 1 : 0;
}

// ─── Volume Spike (施策3) ────────────────────────────────────────────────────
export interface VolumeSpike {
  ratio: number;
  direction: "pump" | "dump" | "neutral";
  spikeLevel: number;  // 0-3
}

export function calcVolumeSpike(volChangeRatio: number, priceChange24h: number): VolumeSpike {
  const spikeLevel = volChangeRatio >= 5 ? 3 : volChangeRatio >= 2 ? 2 : volChangeRatio >= 1 ? 1 : 0;
  let direction: "pump" | "dump" | "neutral" = "neutral";
  if (volChangeRatio >= 2.0) {
    if (priceChange24h > 5)  direction = "pump";
    else if (priceChange24h < -5) direction = "dump";
  }
  return { ratio: volChangeRatio, direction, spikeLevel };
}

export interface MultiTFTrend {
  h1: TrendDirection;
  h4: TrendDirection;
  d1: TrendDirection;
  alignment: number;  // 0-3: DOWNのTF数
}

export interface ShortCandidate {
  symbol: string;
  currentPrice: number;
  ath14d: number;
  athDropPct: number;
  ath14dFromKline: boolean;  // true when ath14d was computed from actual kline4h data
  volume24h: number;
  volumeAvg7d: number;
  volumeChangeRatio: number;
  vol7dFromKline: boolean;  // true when volumeAvg7d was computed from actual kline data
  fundingRate: number | null;
  openInterest: number;
  oiRatio: number;
  trendDirection: TrendDirection;
  listedDaysAgo: number;
  priceChange24h: number;   // % (施策6)
  priceChange7d: number;    // % (施策6)
  volumeProfile: VolumeProfile | null;
  tradeSetup: TradeSetup | null;
  btcCorrelation: number;    // -1.0〜+1.0 (BTC相関係数)
  trendMultiTF: MultiTFTrend | null;  // マルチタイムフレームトレンド
  volumeSpike: VolumeSpike | null;    // 出来高異常検知 (施策3)
  chartPattern: ChartPattern | null;      // チャートパターン (施策4, 後方互換)
  allPatterns: ChartPattern[];             // 全パターン (Phase2 Task3)
  atrData: ATRData | null;                 // ATRボラティリティレジーム (Phase2 Task2)
  liquidationZone: LiquidationZone | null; // 清算カスケードゾーン (施策5)
  initialPrice: number | null; // 上場初日の始値 (新規上場モード用)
  priceDeviation: number | null; // MEXC lastPrice vs indexPrice 乖離%
  dex?: {
    liquidity: number | null;
    liquidityMcRatio: number | null;
    topPair: string | null;
    dexVolume24h: number | null;
  };
  shortScore: number;
  scoreBreakdown: ShortScoreBreakdown;
  // ─── optional enrichment (Phase B / Stage 3.5) ───────────────────────────
  newsContext?: CoinNewsContext;
  liquidityInfo?: LiquidityInfo;
}

// ─── Liquidation Zone (施策5) ─────────────────────────────────────────────────

export interface LiquidationZone {
  priceLevel: number;    // 清算が集中する推定価格帯
  direction: "long" | "short"; // ロング清算 (価格下落で発動) / ショート清算 (価格上昇で発動)
  intensity: "high" | "medium" | "low"; // 清算強度
  distancePct: number;   // 現在価格からの距離 (%)
}

// OI × VolumeProfile から清算カスケードゾーンを推定 (スコア加算なし、表示のみ)
export function calcLiquidationZone(
  currentPrice: number,
  openInterest: number,
  volumeProfile: VolumeProfile | null,
  oiRatio: number,
): LiquidationZone | null {
  if (!volumeProfile || openInterest <= 0) return null;

  // POC価格帯が現在価格より下にある場合: ロング玉が溜まっている → 価格下落でロング清算カスケード
  const poc = volumeProfile.poc;
  const pocPct = volumeProfile.pocVsPricePct; // (現在価格 - POC) / POC * 100

  // 現在価格がPOCより10%以上高い → POC付近でロング清算が起きやすい
  if (pocPct > 10) {
    const intensity: LiquidationZone["intensity"] = oiRatio > 3 ? "high" : oiRatio > 1.5 ? "medium" : "low";
    return {
      priceLevel: poc,
      direction: "long",
      intensity,
      distancePct: -pocPct,  // 下方向
    };
  }

  // 現在価格がPOCより10%以上低い → POC付近でショート清算が起きやすい (反発注意)
  if (pocPct < -10) {
    return {
      priceLevel: poc,
      direction: "short",
      intensity: oiRatio > 2 ? "medium" : "low",
      distancePct: Math.abs(pocPct),  // 上方向
    };
  }

  return null;
}

// ─── ATR Volatility Regime (Phase2 Task2) ────────────────────────────────────

export type VolatilityRegime = "high" | "medium" | "trending" | "low";

export interface ATRData {
  atr: number;          // ATR絶対値
  atrPct: number;       // ATR / currentPrice * 100 (%)
  regime: VolatilityRegime;
}

export function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period + 1 || highs.length !== lows.length || highs.length !== closes.length) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

export function classifyVolatilityRegime(atrPct: number): VolatilityRegime {
  if (atrPct >= 8) return "high";
  if (atrPct >= 4) return "medium";
  if (atrPct >= 2) return "trending";
  return "low";
}

export function calcATRData(
  highs: number[],
  lows: number[],
  closes: number[],
  currentPrice: number,
  period = 14,
): ATRData | null {
  if (highs.length < period + 1) return null;
  const atr = calcATR(highs, lows, closes, period);
  if (atr <= 0 || currentPrice <= 0) return null;
  const atrPct = (atr / currentPrice) * 100;
  return { atr, atrPct, regime: classifyVolatilityRegime(atrPct) };
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
  rrRatio: number;      // TP2基準 (後方互換維持)
  rrWarning: boolean;   // TP2基準でR:R < 1.5
  resistanceLevel: number; // 高出来高レジスタンス
  rrTp1: number;        // TP1基準R:R（参考）
  rrTp2: number;        // TP2基準R:R（メイン評価）
  rrTp3: number;        // TP3基準R:R（フルスイング目標）
}

export function calcTradeSetup(
  currentPrice: number,
  highs: number[],
  lows: number[],
  volumes: number[],
  volumeProfile: VolumeProfile | null,
  atrData?: ATRData | null,
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
  // ATR高ボラ時はSLを拡張 (最大+15%)
  if (atrData && atrData.regime === "high") {
    resistanceLevel = Math.min(resistanceLevel * 1.1, currentPrice * 1.15);
  }
  const sl = resistanceLevel;

  // ── TP1/2/3: ATRベース (atrDataあり) or パーセントフォールバック ──
  let tp1: number;
  let tp2: number;
  let tp3: number;

  if (atrData && atrData.atr > 0) {
    // ATR × 1.0 / 2.0 / 4.0 — R:R 1.0以上を目指す
    tp1 = currentPrice - atrData.atr * 1.0;
    tp2 = currentPrice - atrData.atr * 2.0;
    tp3 = currentPrice - atrData.atr * 4.0;

    // ボリュームプロファイルでTP1を微調整
    if (volumeProfile) {
      const supportBuckets = volumeProfile.buckets
        .filter(b => b.high < currentPrice && b.high >= currentPrice * 0.80)
        .sort((a, b) => b.vol - a.vol);
      if (supportBuckets.length > 0) {
        const vtp1 = Math.max(supportBuckets[0].low, currentPrice * 0.80);
        tp1 = Math.min(tp1, vtp1); // TP1はより浅い方を採用
      }
    }

    // 直近安値でTP2を調整（より深い方）
    if (lows.length >= 2) {
      const recent20 = lows.slice(-Math.min(20, lows.length)).filter(v => v > 0);
      if (recent20.length > 0) {
        tp2 = Math.min(tp2, Math.min(...recent20));
      }
    }

    // 最低フロア: TP1≥-25%, TP2≥-45%, TP3≥-65%
    tp1 = Math.max(tp1, currentPrice * 0.75);
    tp2 = Math.max(tp2, currentPrice * 0.55);
    tp3 = Math.max(tp3, currentPrice * 0.35);
    // 最大シーリング: TP1<-2% (エントリーから少なくとも下に)
    tp1 = Math.min(tp1, currentPrice * 0.98);
    // TP順序保証: tp3 < tp2 < tp1 < currentPrice
    tp2 = Math.min(tp2, tp1 * 0.97);
    tp3 = Math.min(tp3, tp2 * 0.95);
  } else {
    // フォールバック: パーセントベース
    tp1 = currentPrice * 0.93; // デフォルト -7%
    if (volumeProfile) {
      const supportBuckets = volumeProfile.buckets
        .filter(b => b.high < currentPrice && b.high >= currentPrice * 0.90)
        .sort((a, b) => b.vol - a.vol);
      if (supportBuckets.length > 0) {
        tp1 = Math.max(supportBuckets[0].low, currentPrice * 0.90);
      }
    }
    tp1 = Math.max(tp1, currentPrice * 0.90);
    tp1 = Math.min(tp1, currentPrice * 0.95);

    tp2 = currentPrice * 0.70;
    if (lows.length >= 2) {
      const recent20 = lows.slice(-Math.min(20, lows.length)).filter(v => v > 0);
      if (recent20.length > 0) tp2 = Math.min(...recent20);
    }

    tp3 = Math.max(currentPrice * 0.55, tp2 * 0.9);
  }

  // ── TP順序正規化: ショート前提で価格降順（浅→中→深）──
  // 各ブランチで逆転が起きうるため、ソートで強制統一する
  const tpsSorted = [tp1, tp2, tp3].sort((a, b) => b - a);
  tp1 = tpsSorted[0]; // 最も浅い（現在価格に近い）
  tp2 = tpsSorted[1];
  tp3 = tpsSorted[2]; // 最も深い

  // TP1は現在価格から最低3%以上離す
  const minDist = currentPrice * 0.03;
  if (currentPrice - tp1 < minDist) tp1 = currentPrice - minDist;

  // TP間の最小ギャップ確保（同値・微差を防ぐ）
  if (Math.abs(tp1 - tp2) < currentPrice * 0.01) tp2 = tp1 - currentPrice * 0.02;
  if (Math.abs(tp2 - tp3) < currentPrice * 0.01) tp3 = tp2 - currentPrice * 0.02;

  // ── R:R 計算（TP2基準をメインに） ──
  const risk  = sl - currentPrice;
  const rrTp1 = risk > 0 ? (currentPrice - tp1) / risk : 0;
  const rrTp2 = risk > 0 ? (currentPrice - tp2) / risk : 0;
  const rrTp3 = risk > 0 ? (currentPrice - tp3) / risk : 0;
  const rrRatio = rrTp2;

  return { sl, tp1, tp2, tp3, rrRatio, rrWarning: rrTp2 < 1.5, resistanceLevel, rrTp1, rrTp2, rrTp3 };
}

// btcCorrScore (0-1): BTC非連動ボーナス
export function calcBtcCorrScore(corr: number): number {
  return corr < 0.3 ? 1 : 0;
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

// oiChangeScore (0-2): OI変化率スコア (Phase2 Task1: クライアントサイドスナップショットから計算)
export function calcOIChangeScore(oiChange4hPct: number | null): number {
  if (oiChange4hPct === null) return 0;
  if (oiChange4hPct >= 30) return 2;
  if (oiChange4hPct >= 15) return 1;
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

// 単一TFのトレンド判定（EMA9/EMA21）
export function calcTrendDirection(closes: number[]): TrendDirection {
  if (closes.length < 21) return "NEUTRAL";
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  if (ema21 === 0) return "NEUTRAL";
  const diffPct = (ema9 - ema21) / ema21 * 100;
  if (diffPct < -0.5) return "DOWN";
  if (diffPct > 0.5)  return "UP";
  return "NEUTRAL";
}

// trendScore (0-2→0-3): マルチTF一致度 (施策2)
export function calcTrendScore(closes4h: number[]): { score: number; direction: TrendDirection } {
  const dir = calcTrendDirection(closes4h);
  // 単独4hの場合: DOWN=2, UP=0, NEUTRAL=1（後方互換）
  if (dir === "DOWN")    return { score: 2, direction: "DOWN" };
  if (dir === "UP")      return { score: 0, direction: "UP" };
  return { score: 1, direction: "NEUTRAL" };
}

// マルチTFトレンドスコア (0-3): 施策2
export function calcMultiTFScore(closes1h: number[], closes4h: number[], closes1d: number[]): {
  score: number;
  multiTF: MultiTFTrend;
} {
  const h1 = calcTrendDirection(closes1h);
  const h4 = calcTrendDirection(closes4h);
  const d1 = calcTrendDirection(closes1d);
  const alignment = [h1, h4, d1].filter(d => d === "DOWN").length;
  return {
    score: alignment,  // 0-3点
    multiTF: { h1, h4, d1, alignment },
  };
}

// RSI計算（period=14）
export function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// RSIスコア（ショート視点: 過熱=高スコア）
export function calcRSIScore(closes4h: number[]): number {
  const rsi = calcRSI(closes4h);
  if (rsi === null) return 0;
  if (rsi >= 70) return 2;
  if (rsi >= 60) return 1;
  return 0;
}

// exclusivityScore (0-2): 取引所独占度 (施策2, client-side)
export function calcExclusivityScore(listedOnBinance: boolean, listedOnBybit: boolean): number {
  if (!listedOnBinance && !listedOnBybit) return 2;
  if (!listedOnBinance || !listedOnBybit) return 1;
  return 0;
}

// Server-side score max: 3+3+2+2+2+3+2+1+3+2 = 23 (Phase2: oiChange+2, pattern0-3+2, rsiScore+2)
export function calcShortScore(
  athDropPct: number,
  volumeChangeRatio: number,
  fundingRate: number | null,
  listedDaysAgo: number,
  openInterest: number,
  volume24h: number,
  closes4h: number[],
  priceChange7d: number,
  btcCorrelation: number,
  closes1h: number[],      // 施策2: マルチTF
  closes1d: number[],      // 施策2: マルチTF
  highs4h: number[],       // 施策4: パターン検知
  lows4h: number[],        // 施策4: パターン検知
  priceChange24h: number,  // 施策4: デッドキャット判定
  oiChange4hPct: number | null = null,  // Phase2 Task1: OI変化率 (サーバーはnull固定)
): {
  score: number;
  breakdown: ShortScoreBreakdown;
  oiRatio: number;
  trendDirection: TrendDirection;
  trendMultiTF: MultiTFTrend;
  chartPattern: ChartPattern | null;
  allPatterns: ChartPattern[];
} {
  const dropScore      = calcDropScore(athDropPct);
  const volumeDryScore = calcVolumeDryScore(volumeChangeRatio);
  const frScore        = calcFRScore(fundingRate);
  const freshnessScore = calcFreshnessScore(listedDaysAgo);
  const oiRatio        = volume24h > 0 ? openInterest / volume24h : 0;
  const oiScore        = calcOIScore(oiRatio);
  const oiChangeScore  = calcOIChangeScore(oiChange4hPct); // 常に0 (サーバーはnull渡し)
  const pumpScore      = calcPumpScore(priceChange7d);
  const btcCorrScore   = calcBtcCorrScore(btcCorrelation);

  // 施策2: マルチTFトレンド（4hデータがあれば3TF、なければ4h単独）
  const { score: trendScore, multiTF: trendMultiTF } = closes1h.length >= 10 || closes1d.length >= 5
    ? calcMultiTFScore(closes1h, closes4h, closes1d)
    : { score: calcTrendScore(closes4h).score, multiTF: { h1: "NEUTRAL" as TrendDirection, h4: calcTrendDirection(closes4h), d1: "NEUTRAL" as TrendDirection, alignment: calcTrendDirection(closes4h) === "DOWN" ? 1 : 0 } };

  const trendDirection = trendMultiTF.h4; // 後方互換: 4hが主トレンド

  // Phase2 Task3: SMCパターン拡張 (0-3点)
  const allPatterns  = detectChartPatterns(closes4h, highs4h, lows4h, priceChange24h, athDropPct);
  const chartPattern = allPatterns.length > 0 ? allPatterns[0] : null;
  const patternScore = calcPatternScore(null, allPatterns);

  const rsiScore = calcRSIScore(closes4h);

  return {
    score: dropScore + volumeDryScore + frScore + freshnessScore + oiScore + oiChangeScore + trendScore + pumpScore + btcCorrScore + patternScore + rsiScore,
    breakdown: { dropScore, volumeDryScore, frScore, freshnessScore, oiScore, oiChangeScore, trendScore, pumpScore, btcCorrScore, patternScore, rsiScore },
    oiRatio,
    trendDirection,
    trendMultiTF,
    chartPattern,
    allPatterns,
  };
}

// フィルタ条件 (通常スキャン)
export function passesFilter(
  athDropPct: number,
  volumeChangeRatio: number,
  volume24h: number,
): boolean {
  return (
    athDropPct <= -10 &&
    volumeChangeRatio < 5.0 &&
    volume24h >= 50_000
  );
}

// ─── TWAP Execution Simulator ─────────────────────────────────────────────────

export interface SlippageEstimate {
  orderSizeUsd: number;
  estimatedSlippagePct: number;
  impactLevel: "low" | "medium" | "high" | "extreme";
  twapRecommendation: string;
  avgBarVolume: number;
}

export function estimateSlippage(
  orderSizeUsd: number,
  volumes4h: number[],
  openInterest: number,
): SlippageEstimate {
  const recentVols = volumes4h.slice(-10).filter(v => v > 0);
  const avgBarVolume = recentVols.length > 0 ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 0;

  const volRatio = avgBarVolume > 0 ? orderSizeUsd / avgBarVolume : 1;
  const oiRatio  = openInterest > 0 ? orderSizeUsd / openInterest : 1;

  let slip: number;
  if      (volRatio <= 0.01) slip = volRatio * 10;
  else if (volRatio <= 0.1)  slip = 0.1 + (volRatio - 0.01) * 10;
  else if (volRatio <= 0.5)  slip = 1   + (volRatio - 0.1)  * 10;
  else                       slip = 5   + (volRatio - 0.5)  * 20;

  if (oiRatio > 0.05) slip *= 1.5;
  if (oiRatio > 0.1)  slip *= 2;
  const estimatedSlippagePct = Math.min(slip, 20);

  const impactLevel: SlippageEstimate["impactLevel"] =
    estimatedSlippagePct >= 5 ? "extreme" :
    estimatedSlippagePct >= 2 ? "high"    :
    estimatedSlippagePct >= 0.5 ? "medium" : "low";

  const twapRecommendation =
    estimatedSlippagePct < 0.5 ? "✅ 成行OK" :
    estimatedSlippagePct < 2   ? "⚠️ 指値推奨" :
    `🔴 TWAP推奨: ${Math.min(Math.ceil(estimatedSlippagePct / 0.5), 10)}チャンクに分割`;

  return { orderSizeUsd, estimatedSlippagePct, impactLevel, twapRecommendation, avgBarVolume };
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
