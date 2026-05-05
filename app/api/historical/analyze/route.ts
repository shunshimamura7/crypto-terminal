import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUDGET_MS   = 45_000;
const SL_PCT      = 0.08;
const TP_PCT      = 0.10;
const HORIZON     = 14;
const COOLDOWN    = 7;
const MIN_SAMPLES = 5;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle {
  time: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SymbolInput {
  symbol: string;
  listedDaysAgo: number;
  candles: Candle[];
}

interface TradeResult {
  outcome: "win" | "loss" | "neutral";
  btcTrend: "up" | "flat" | "down";
  pnlPct: number;
  hit5pct: boolean;
  hit10pct: boolean;
  hit15pct: boolean;
  hit20pct: boolean;
  maxDrop: number; // fraction ≥ 0, e.g. 0.15 = 15% drop
}

interface PatternStats {
  id: string;
  name: string;
  description: string;
  winRate: number;
  avgReturn: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number;
  sampleSize: number;
  wins: number;
  losses: number;
  neutrals: number;
  winRateByBtcTrend: { up: number | null; flat: number | null; down: number | null };
  winRate5pct: number;
  winRate10pct: number;
  winRate15pct: number;
  winRate20pct: number;
  avgMaxDrop: number;
}

// ─── RSI ──────────────────────────────────────────────────────────────────────
function calcRSI(closes: number[], period = 14): number[] {
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

// ─── Pattern Utils ────────────────────────────────────────────────────────────
function athDrop(candles: Candle[], upTo: number): number {
  const maxHigh = Math.max(...candles.slice(0, upTo + 1).map(c => c.high));
  return maxHigh > 0 ? (candles[upTo].close - maxHigh) / maxHigh : 0;
}

function avgVol(candles: Candle[], from: number, len: number): number {
  if (from < 0 || len <= 0) return 0;
  const sl = candles.slice(from, from + len);
  if (sl.length === 0) return 0;
  return sl.reduce((s, c) => s + c.volume, 0) / sl.length;
}

// Approximate age (days since listing) of coin at candle index i
function ageAt(listedDaysAgo: number, csLen: number, i: number): number {
  return listedDaysAgo - (csLen - 1 - i);
}

// ─── Trade Simulation ─────────────────────────────────────────────────────────
function simulateTrade(cs: Candle[], entryIdx: number): Omit<TradeResult, "btcTrend"> | null {
  const entryPrice = cs[entryIdx].close;
  if (entryPrice <= 0) return null;

  const slPrice = entryPrice * (1 + SL_PCT);
  const tp10    = entryPrice * (1 - TP_PCT);
  const tp5     = entryPrice * (1 - 0.05);
  const tp15    = entryPrice * (1 - 0.15);
  const tp20    = entryPrice * (1 - 0.20);

  let outcome: "win" | "loss" | "neutral" = "neutral";
  let exitPrice = cs[Math.min(entryIdx + HORIZON, cs.length - 1)].close;
  let minLow    = entryPrice;
  let hit5pct   = false, hit10pct = false, hit15pct = false, hit20pct = false;

  for (let j = entryIdx + 1; j <= Math.min(entryIdx + HORIZON, cs.length - 1); j++) {
    // SL checked first (high of the day)
    if (cs[j].high >= slPrice) {
      outcome   = "loss";
      exitPrice = slPrice;
      break;
    }
    // Track lows only on non-SL days
    if (cs[j].low < minLow) minLow = cs[j].low;
    if (cs[j].low <= tp5)  hit5pct  = true;
    if (cs[j].low <= tp10) hit10pct = true;
    if (cs[j].low <= tp15) hit15pct = true;
    if (cs[j].low <= tp20) hit20pct = true;
    // TP check
    if (cs[j].low <= tp10) {
      outcome   = "win";
      exitPrice = tp10;
      break;
    }
  }

  const pnlPct = outcome === "win"  ?  TP_PCT * 100
               : outcome === "loss" ? -SL_PCT * 100
               : ((entryPrice - exitPrice) / entryPrice) * 100;

  return { outcome, pnlPct, hit5pct, hit10pct, hit15pct, hit20pct, maxDrop: (entryPrice - minLow) / entryPrice };
}

// ─── Pattern Definitions ──────────────────────────────────────────────────────
type PatternFn = (cs: Candle[], i: number, listedDaysAgo: number) => boolean;

interface PatternDef {
  id: string;
  name: string;
  description: string;
  fn: PatternFn;
}

const PATTERNS: PatternDef[] = [
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

// ─── BTC index lookup ─────────────────────────────────────────────────────────
function findClosestIdx(candles: Candle[], targetTime: number): number {
  if (candles.length === 0) return -1;
  let best = 0, bestDiff = Math.abs(candles[0].time - targetTime);
  for (let i = 1; i < candles.length; i++) {
    const diff = Math.abs(candles[i].time - targetTime);
    if (diff < bestDiff) { best = i; bestDiff = diff; }
  }
  return best;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startMs  = Date.now();
  const deadline = startMs + BUDGET_MS;

  let body: { symbols: SymbolInput[]; btcCandles: Candle[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { symbols, btcCandles } = body;
  if (!Array.isArray(symbols) || !Array.isArray(btcCandles)) {
    return NextResponse.json({ error: "symbols and btcCandles are required arrays" }, { status: 400 });
  }

  const patternTrades = new Map<string, TradeResult[]>(PATTERNS.map(p => [p.id, []]));
  const cooldown      = new Map<string, number>();
  let symbolsProcessed = 0;
  let totalTrades      = 0;

  for (const sym of symbols) {
    if (Date.now() >= deadline) break;

    const { symbol, listedDaysAgo, candles } = sym;
    if (!Array.isArray(candles) || candles.length < 5) continue;
    symbolsProcessed++;

    for (const pattern of PATTERNS) {
      const tradeList = patternTrades.get(pattern.id)!;

      for (let i = 4; i < candles.length - 1; i++) {
        const cdKey = `${symbol}:${pattern.id}`;
        const last  = cooldown.get(cdKey);
        if (last !== undefined && candles[i].time - last < COOLDOWN * 86_400) continue;

        if (!pattern.fn(candles, i, listedDaysAgo)) continue;

        cooldown.set(cdKey, candles[i].time);

        const trade = simulateTrade(candles, i);
        if (!trade) continue;

        // BTC trend at entry (7-day return)
        let btcTrend: "up" | "flat" | "down" = "flat";
        const btcIdx = findClosestIdx(btcCandles, candles[i].time);
        if (btcIdx >= 7) {
          const btcRef = btcCandles[btcIdx - 7].close;
          if (btcRef > 0) {
            const r7 = (btcCandles[btcIdx].close - btcRef) / btcRef;
            if (r7 >  0.03) btcTrend = "up";
            else if (r7 < -0.03) btcTrend = "down";
          }
        }

        tradeList.push({ ...trade, btcTrend });
        totalTrades++;
      }
    }
  }

  // ── Compute stats ──────────────────────────────────────────────────────────
  const results: (PatternStats & { _score: number })[] = [];

  for (const pattern of PATTERNS) {
    const trades = patternTrades.get(pattern.id)!;
    if (trades.length < MIN_SAMPLES) continue;

    const wins     = trades.filter(t => t.outcome === "win");
    const losses   = trades.filter(t => t.outcome === "loss");
    const neutrals = trades.filter(t => t.outcome === "neutral");

    const winRate   = wins.length / trades.length;
    const avgReturn = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
    const avgWin    = wins.length   > 0 ? wins.reduce((s, t)    => s + t.pnlPct, 0) / wins.length    : null;
    const avgLoss   = losses.length > 0 ? losses.reduce((s, t)  => s + t.pnlPct, 0) / losses.length  : null;

    const totalProfit = trades.filter(t => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0);
    const totalLoss   = trades.filter(t => t.pnlPct < 0).reduce((s, t) => s + Math.abs(t.pnlPct), 0);
    const pf = totalLoss === 0 ? (totalProfit > 0 ? 99.99 : 1.0) : totalProfit / totalLoss;

    const n = trades.length;
    const byTrend = (trend: "up" | "flat" | "down"): number | null => {
      const sub = trades.filter(t => t.btcTrend === trend);
      return sub.length >= 3 ? sub.filter(t => t.outcome === "win").length / sub.length : null;
    };

    results.push({
      id:          pattern.id,
      name:        pattern.name,
      description: pattern.description,
      winRate,
      avgReturn,
      avgWin,
      avgLoss,
      profitFactor: pf,
      sampleSize:  n,
      wins:        wins.length,
      losses:      losses.length,
      neutrals:    neutrals.length,
      winRateByBtcTrend: { up: byTrend("up"), flat: byTrend("flat"), down: byTrend("down") },
      winRate5pct:  trades.filter(t => t.hit5pct).length  / n,
      winRate10pct: trades.filter(t => t.hit10pct).length / n,
      winRate15pct: trades.filter(t => t.hit15pct).length / n,
      winRate20pct: trades.filter(t => t.hit20pct).length / n,
      avgMaxDrop:   trades.reduce((s, t) => s + t.maxDrop, 0) / n,
      _score:       winRate * Math.log(Math.max(n, 1)),
    });
  }

  results.sort((a, b) => b._score - a._score);

  // Strip internal _score before returning
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const patterns = results.map(({ _score, ...rest }) => rest);

  return NextResponse.json({
    patterns,
    summary: {
      top8:             patterns.slice(0, 8).map(p => p.id),
      totalTrades,
      symbolsProcessed,
      processingTimeMs: Date.now() - startMs,
    },
  });
}
