// 共通パターン定義モジュール
// app/api/historical/analyze と app/api/pattern/detect で共有

export interface Candle {
  time: number;   // unix seconds
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PatternFn = (cs: Candle[], i: number, listedDaysAgo: number) => boolean;

export interface PatternDef {
  id: string;
  name: string;
  description: string;
  fn: PatternFn;
}

// ─── Pattern Utils ────────────────────────────────────────────────────────────
export function athDrop(candles: Candle[], upTo: number): number {
  const maxHigh = Math.max(...candles.slice(0, upTo + 1).map(c => c.high));
  return maxHigh > 0 ? (candles[upTo].close - maxHigh) / maxHigh : 0;
}

export function avgVol(candles: Candle[], from: number, len: number): number {
  if (from < 0 || len <= 0) return 0;
  const sl = candles.slice(from, from + len);
  if (sl.length === 0) return 0;
  return sl.reduce((s, c) => s + c.volume, 0) / sl.length;
}

export function ageAt(listedDaysAgo: number, csLen: number, i: number): number {
  return listedDaysAgo - (csLen - 1 - i);
}

export function calcRSI(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ─── Pattern Definitions ──────────────────────────────────────────────────────
export const PATTERNS: PatternDef[] = [
  // ── A: 上場後タイミング ────────────────────────────────────────────────────
  {
    id: "A1", name: "上場30日崩壊", description: "上場25-45日 + ATH-30%以上",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = ageAt(listed, cs.length, i);
      return age >= 25 && age <= 45 && athDrop(cs, i) <= -0.30;
    },
  },
  {
    id: "A2", name: "上場60日崩壊", description: "上場55-75日 + ATH-40%以上",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = ageAt(listed, cs.length, i);
      return age >= 55 && age <= 75 && athDrop(cs, i) <= -0.40;
    },
  },
  {
    id: "A3", name: "上場後ポンプフェード", description: "上場7-30日 + 7日+20%以上 + 当日-5%以上",
    fn(cs, i, listed) {
      if (i < 7) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 7 || age > 30) return false;
      const ref = cs[i - 7].close;
      if (ref <= 0) return false;
      return (cs[i].close - ref) / ref >= 0.20 && (cs[i].close - cs[i - 1].close) / cs[i - 1].close <= -0.05;
    },
  },
  {
    id: "A4", name: "上場後出来高崩壊", description: "上場14-90日 + 直近7日出来高が前週比20%未満",
    fn(cs, i, listed) {
      if (i < 14) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 14 || age > 90) return false;
      const earlyVol  = avgVol(cs, i - 14, 7);
      const recentVol = avgVol(cs, i - 7, 7);
      return earlyVol > 0 && recentVol / earlyVol < 0.20;
    },
  },
  {
    id: "A5", name: "上場ハネムーン終了", description: "上場20-50日 + ATH-25%以上 + 出来高前週比40%未満",
    fn(cs, i, listed) {
      if (i < 14) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 20 || age > 50) return false;
      const vol7d  = avgVol(cs, i - 7, 7);
      const vol14d = avgVol(cs, i - 14, 7);
      return athDrop(cs, i) <= -0.25 && vol14d > 0 && vol7d / vol14d < 0.40;
    },
  },

  // ── B: 出来高 ──────────────────────────────────────────────────────────────
  {
    id: "B7", name: "出来高スパイク反転", description: "前日出来高9日平均の3倍以上 + 陽線 → 当日陰線",
    fn(cs, i) {
      if (i < 10) return false;
      const base = avgVol(cs, i - 10, 9);
      if (base <= 0) return false;
      const prev = cs[i - 1];
      return prev.volume / base >= 3.0 && prev.close > cs[i - 2].close && cs[i].close < prev.close;
    },
  },
  {
    id: "B8", name: "出来高下降継続", description: "3日連続出来高減少 + 当日終値切り下げ",
    fn(cs, i) {
      if (i < 4) return false;
      return cs[i].volume < cs[i - 1].volume &&
             cs[i - 1].volume < cs[i - 2].volume &&
             cs[i - 2].volume < cs[i - 3].volume &&
             cs[i].close <= cs[i - 1].close;
    },
  },
  {
    id: "B9", name: "低出来高下落継続", description: "7日間出来高が14日平均の40%未満 + 7日で下落",
    fn(cs, i) {
      if (i < 14) return false;
      const base = avgVol(cs, i - 14, 14);
      if (base <= 0) return false;
      return cs.slice(i - 6, i + 1).every(c => c.volume / base < 0.40) && cs[i].close < cs[i - 6].close;
    },
  },

  // ── C: 価格構造 ────────────────────────────────────────────────────────────
  {
    id: "C10", name: "デッドキャットバウンス", description: "ATH-50%以上 + 7日で20-40%反発中",
    fn(cs, i) {
      if (i < 14) return false;
      const ref7 = cs[i - 7].close;
      if (ref7 <= 0) return false;
      const bounce7 = (cs[i].close - ref7) / ref7;
      return athDrop(cs, i) <= -0.50 && bounce7 >= 0.20 && bounce7 <= 0.40;
    },
  },
  {
    id: "C12", name: "レジスタンス拒否", description: "前日が10日高値圏 + 当日-3%以上下落",
    fn(cs, i) {
      if (i < 11) return false;
      const resistance = Math.max(...cs.slice(i - 10, i).map(c => c.high));
      return cs[i - 1].high >= resistance * 0.97 && cs[i].close < cs[i - 1].close * 0.97;
    },
  },
  {
    id: "C13", name: "ブレイクダウンリテスト", description: "サポート割れ後リテスト → 再下落",
    fn(cs, i) {
      if (i < 11) return false;
      const support  = Math.min(...cs.slice(i - 10, i - 2).map(c => c.low));
      const broke    = cs[i - 2].close < support;
      const retested = cs[i - 1].close >= support * 0.98 && cs[i - 1].close <= support * 1.03;
      return broke && retested && cs[i].close < cs[i - 1].close;
    },
  },
  {
    id: "C14", name: "ベアリッシュエンガルフ", description: "前日陽線 + 当日が前々日終値以下に急落",
    fn(cs, i) {
      if (i < 3) return false;
      const prev = cs[i - 1], curr = cs[i];
      return prev.close > cs[i - 2].close && curr.close < cs[i - 2].close;
    },
  },
  {
    id: "C17", name: "価格圧縮ブレイクダウン", description: "7日間レンジ8%未満 + 下方ブレイク",
    fn(cs, i) {
      if (i < 10) return false;
      const slice   = cs.slice(i - 7, i);
      const rangeHi = Math.max(...slice.map(c => c.high));
      const rangeLo = Math.min(...slice.map(c => c.low));
      return rangeLo > 0 && (rangeHi - rangeLo) / rangeLo < 0.08 && cs[i].close < rangeLo * 0.98;
    },
  },

  // ── D: RSI/モメンタム ──────────────────────────────────────────────────────
  {
    id: "D18", name: "RSIオーバーボート反転", description: "RSI70超から70割れ + 当日陰線",
    fn(cs, i) {
      if (i < 15) return false;
      const rsi = calcRSI(cs.slice(0, i + 1).map(c => c.close));
      return rsi[i - 1] >= 70 && rsi[i] < 70 && cs[i].close < cs[i - 1].close;
    },
  },

  // ── E: BTC相関 ─────────────────────────────────────────────────────────────
  {
    id: "E22", name: "BTC非相関独立下落", description: "7日で-10%以上の独立下落",
    fn(cs, i) {
      if (i < 14) return false;
      const ref = cs[i - 7].close;
      return ref > 0 && (cs[i].close - ref) / ref <= -0.10;
    },
  },
  {
    id: "E23", name: "BTC下落増幅", description: "7日で-20%以上の急落",
    fn(cs, i) {
      if (i < 7) return false;
      const ref = cs[i - 7].close;
      return ref > 0 && (cs[i].close - ref) / ref <= -0.20;
    },
  },

  // ── 上場日数細分化 ──────────────────────────────────────────────────────────
  {
    id: "listing_10_20d", name: "上場10-20日ショート", description: "上場10-20日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 10 && a <= 20; },
  },
  {
    id: "listing_20_30d", name: "上場20-30日ショート", description: "上場20-30日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 20 && a <= 30; },
  },
  {
    id: "listing_30_40d", name: "上場30-40日ショート", description: "上場30-40日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 30 && a <= 40; },
  },
  {
    id: "listing_40_50d", name: "上場40-50日ショート", description: "上場40-50日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 40 && a <= 50; },
  },
  {
    id: "listing_50_60d", name: "上場50-60日ショート", description: "上場50-60日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 50 && a <= 60; },
  },
  {
    id: "listing_60_70d", name: "上場60-70日ショート", description: "上場60-70日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 60 && a <= 70; },
  },
  {
    id: "listing_70_80d", name: "上場70-80日ショート", description: "上場70-80日目のショート成績検証",
    fn(cs, i, listed) { const a = ageAt(listed, cs.length, i); return a >= 70 && a <= 80; },
  },

  // ── 上場×ATH下落率 ─────────────────────────────────────────────────────────
  {
    id: "listing_under30d_ath50", name: "上場30日未満+ATH-50%", description: "上場30日未満 + ATHから-50%以上下落",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = ageAt(listed, cs.length, i);
      return age > 0 && age < 30 && athDrop(cs, i) <= -0.50;
    },
  },
  {
    id: "listing_30_60d_ath50", name: "上場30-60日+ATH-50%", description: "上場30-60日 + ATHから-50%以上下落",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = ageAt(listed, cs.length, i);
      return age >= 30 && age <= 60 && athDrop(cs, i) <= -0.50;
    },
  },
  {
    id: "listing_30_60d_ath70", name: "上場30-60日+ATH-70%", description: "上場30-60日 + ATHから-70%以上下落",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = ageAt(listed, cs.length, i);
      return age >= 30 && age <= 60 && athDrop(cs, i) <= -0.70;
    },
  },
  {
    id: "listing_30_60d_ath90", name: "上場30-60日+ATH-90%", description: "上場30-60日 + ATHから-90%以上下落",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = ageAt(listed, cs.length, i);
      return age >= 30 && age <= 60 && athDrop(cs, i) <= -0.90;
    },
  },

  // ── 上場×出来高 ────────────────────────────────────────────────────────────
  {
    id: "listing_30_60d_vol_declining", name: "上場30-60日+出来高7日連続減", description: "上場30-60日 + 7日連続で出来高が前日比減少",
    fn(cs, i, listed) {
      if (i < 7) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 30 || age > 60) return false;
      for (let k = i - 6; k <= i; k++) {
        if (cs[k].volume >= cs[k - 1].volume) return false;
      }
      return true;
    },
  },
  {
    id: "listing_30_60d_vol_low", name: "上場30-60日+出来高枯渇", description: "上場30-60日 + 当日出来高が7日平均の30%未満",
    fn(cs, i, listed) {
      if (i < 7) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 30 || age > 60) return false;
      const avg7 = avgVol(cs, i - 7, 7);
      return avg7 > 0 && cs[i].volume < avg7 * 0.30;
    },
  },
  {
    id: "listing_30_60d_vol_spike", name: "上場30-60日+出来高スパイク", description: "上場30-60日 + 前日出来高が7日平均の3倍以上",
    fn(cs, i, listed) {
      if (i < 8) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 30 || age > 60) return false;
      const base = avgVol(cs, i - 8, 7);
      return base > 0 && cs[i - 1].volume / base >= 3.0;
    },
  },

  // ── 上場×価格パターン ───────────────────────────────────────────────────────
  {
    id: "listing_post_pump", name: "上場ポンプ後崩壊", description: "上場30日以内にATH + 現在ATHから-40%以上",
    fn(cs, i, listed) {
      if (i < 10) return false;
      const ageAtI = ageAt(listed, cs.length, i);
      if (ageAtI < 30 || ageAtI > 90) return false;
      let maxHighIdx = 0, maxHighVal = 0;
      for (let k = 0; k <= i; k++) {
        if (cs[k].high > maxHighVal) { maxHighVal = cs[k].high; maxHighIdx = k; }
      }
      const ageAtATH = ageAt(listed, cs.length, maxHighIdx);
      return ageAtATH > 0 && ageAtATH <= 30 && athDrop(cs, i) <= -0.40;
    },
  },
  {
    id: "listing_slow_bleed", name: "上場後スローブリード", description: "上場30-60日 + 7日連続で高値切り下げ",
    fn(cs, i, listed) {
      if (i < 7) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 30 || age > 60) return false;
      for (let k = i - 6; k <= i; k++) {
        if (cs[k].high >= cs[k - 1].high) return false;
      }
      return true;
    },
  },
  {
    id: "listing_bounce_short", name: "上場後バウンスショート", description: "上場30-60日 + ATH-50%後に安値から20%以上反発",
    fn(cs, i, listed) {
      if (i < 14) return false;
      const age = ageAt(listed, cs.length, i);
      if (age < 30 || age > 60) return false;
      if (athDrop(cs, i) > -0.50) return false;
      const recentLow = Math.min(...cs.slice(Math.max(0, i - 13), i + 1).map(c => c.low));
      return recentLow > 0 && (cs[i].close - recentLow) / recentLow >= 0.20;
    },
  },
];
