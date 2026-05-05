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
  open: number;
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
}

interface PatternStats {
  patternId: string;
  label: string;
  category: string;
  sampleSize: number;
  winRate: number;
  avgPnlPct: number;
  score: number;
  winRateByBtcTrend: { up: number | null; flat: number | null; down: number | null };
}

// ─── Math Helpers ─────────────────────────────────────────────────────────────
function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (i === period - 1) {
      result.push(values.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      result.push(values[i] * k + result[i - 1] * (1 - k));
    }
  }
  return result;
}

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function calcBBands(closes: number[], period = 20, mult = 2): { mid: number[]; upper: number[]; lower: number[] } {
  const mid: number[] = [], upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { mid.push(NaN); upper.push(NaN); lower.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    mid.push(mean);
    upper.push(mean + mult * std);
    lower.push(mean - mult * std);
  }
  return { mid, upper, lower };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function calcCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - meanA, dB = b[i] - meanB;
    num += dA * dB; da += dA * dA; db += dB * dB;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function dailyReturns(candles: Candle[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    ret.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  return ret;
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

// ─── Pattern Definitions ──────────────────────────────────────────────────────
type PatternFn = (cs: Candle[], i: number, listedDaysAgo: number) => boolean;

interface PatternDef {
  id: string;
  label: string;
  category: string;
  fn: PatternFn;
}

const PATTERNS: PatternDef[] = [
  // ── A: 上場後タイミング ────────────────────────────────────────────────────
  {
    id: "A1", label: "上場30日崩壊", category: "A",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = listed - (cs.length - 1 - i);
      return age >= 25 && age <= 45 && athDrop(cs, i) <= -0.30;
    },
  },
  {
    id: "A2", label: "上場60日崩壊", category: "A",
    fn(cs, i, listed) {
      if (i < 4) return false;
      const age = listed - (cs.length - 1 - i);
      return age >= 55 && age <= 75 && athDrop(cs, i) <= -0.40;
    },
  },
  {
    id: "A3", label: "上場後ポンプフェード", category: "A",
    fn(cs, i, listed) {
      if (i < 7) return false;
      const age = listed - (cs.length - 1 - i);
      if (age < 7 || age > 30) return false;
      const ref = cs[i - 7].close;
      if (ref <= 0) return false;
      const pump = (cs[i].close - ref) / ref;
      const drop1d = (cs[i].close - cs[i - 1].close) / cs[i - 1].close;
      return pump >= 0.20 && drop1d <= -0.05;
    },
  },
  {
    id: "A4", label: "上場後出来高崩壊", category: "A",
    fn(cs, i, listed) {
      if (i < 14) return false;
      const age = listed - (cs.length - 1 - i);
      if (age < 14 || age > 90) return false;
      const earlyVol = avgVol(cs, i - 14, 7);
      const recentVol = avgVol(cs, i - 7, 7);
      return earlyVol > 0 && recentVol / earlyVol < 0.20;
    },
  },
  {
    id: "A5", label: "上場ハネムーン終了", category: "A",
    fn(cs, i, listed) {
      if (i < 10) return false;
      const age = listed - (cs.length - 1 - i);
      if (age < 20 || age > 50) return false;
      const vol7d  = avgVol(cs, i - 7, 7);
      const vol14d = avgVol(cs, i - 14, 7);
      return athDrop(cs, i) <= -0.25 && vol14d > 0 && vol7d / vol14d < 0.40;
    },
  },

  // ── B: 出来高 ──────────────────────────────────────────────────────────────
  {
    id: "B6", label: "出来高枯渇", category: "B",
    fn(cs, i) {
      if (i < 14) return false;
      const base = avgVol(cs, i - 14, 14);
      return base > 0 && cs[i].volume / base < 0.15;
    },
  },
  {
    id: "B7", label: "出来高スパイク反転", category: "B",
    fn(cs, i) {
      if (i < 10) return false;
      const base = avgVol(cs, i - 10, 9);
      const prev = cs[i - 1];
      if (base <= 0) return false;
      const spiked   = prev.volume / base >= 3.0;
      const wasUp    = prev.close > prev.open;
      const reversal = cs[i].close < prev.close;
      return spiked && wasUp && reversal;
    },
  },
  {
    id: "B8", label: "出来高下降継続", category: "B",
    fn(cs, i) {
      if (i < 4) return false;
      return (
        cs[i].volume < cs[i - 1].volume &&
        cs[i - 1].volume < cs[i - 2].volume &&
        cs[i - 2].volume < cs[i - 3].volume &&
        cs[i].close <= cs[i - 1].close
      );
    },
  },
  {
    id: "B9", label: "低出来高下落継続", category: "B",
    fn(cs, i) {
      if (i < 14) return false;
      const base = avgVol(cs, i - 14, 14);
      if (base <= 0) return false;
      const allLow = cs.slice(i - 6, i + 1).every(c => c.volume / base < 0.40);
      return allLow && cs[i].close < cs[i - 6].close;
    },
  },

  // ── C: 価格構造 ────────────────────────────────────────────────────────────
  {
    id: "C10", label: "デッドキャットバウンス", category: "C",
    fn(cs, i) {
      if (i < 14) return false;
      const drop    = athDrop(cs, i);
      const ref7    = cs[i - 7].close;
      if (ref7 <= 0) return false;
      const bounce7 = (cs[i].close - ref7) / ref7;
      return drop <= -0.50 && bounce7 >= 0.20 && bounce7 <= 0.40;
    },
  },
  {
    id: "C11", label: "ロワーハイ継続", category: "C",
    fn(cs, i) {
      if (i < 6) return false;
      return (
        cs[i].high < cs[i - 2].high &&
        cs[i - 2].high < cs[i - 4].high &&
        cs[i].close < cs[i - 1].close
      );
    },
  },
  {
    id: "C12", label: "レジスタンス拒否", category: "C",
    fn(cs, i) {
      if (i < 11) return false;
      const resistance = Math.max(...cs.slice(i - 10, i).map(c => c.high));
      const nearRes    = cs[i - 1].high >= resistance * 0.97;
      const rejected   = cs[i].close < cs[i - 1].close * 0.97;
      return nearRes && rejected;
    },
  },
  {
    id: "C13", label: "ブレイクダウンリテスト", category: "C",
    fn(cs, i) {
      if (i < 11) return false;
      const support  = Math.min(...cs.slice(i - 10, i - 2).map(c => c.low));
      const broke    = cs[i - 2].close < support;
      const retested = cs[i - 1].close >= support * 0.98 && cs[i - 1].close <= support * 1.03;
      const rejected = cs[i].close < cs[i - 1].close;
      return broke && retested && rejected;
    },
  },
  {
    id: "C14", label: "ベアリッシュエンガルフ", category: "C",
    fn(cs, i) {
      if (i < 3) return false;
      const prev = cs[i - 1], curr = cs[i];
      const bearEngulf = curr.open > prev.close && curr.close < prev.open;
      const prevWasUp  = prev.close > prev.open;
      return bearEngulf && prevWasUp;
    },
  },
  {
    id: "C15", label: "分配フェーズ", category: "C",
    fn(cs, i) {
      if (i < 21) return false;
      let upDays = 0, downDays = 0;
      for (let k = i - 6; k <= i; k++) {
        if (cs[k].close > cs[k].open) upDays++; else downDays++;
      }
      const highVol = avgVol(cs, i - 7, 7);
      const baseVol = avgVol(cs, i - 21, 14);
      return downDays >= 4 && upDays >= 2 && baseVol > 0 && highVol / baseVol > 1.5;
    },
  },
  {
    id: "C16", label: "EMAデスクロス", category: "C",
    fn(cs, i) {
      if (i < 26) return false;
      const closes = cs.slice(0, i + 1).map(c => c.close);
      const ema7   = calcEMA(closes, 7);
      const ema21  = calcEMA(closes, 21);
      return ema7[i] < ema21[i] && ema7[i - 2] >= ema21[i - 2];
    },
  },
  {
    id: "C17", label: "価格圧縮ブレイクダウン", category: "C",
    fn(cs, i) {
      if (i < 10) return false;
      const slice    = cs.slice(i - 7, i);
      const rangeHi  = Math.max(...slice.map(c => c.high));
      const rangeLo  = Math.min(...slice.map(c => c.low));
      const compress = rangeLo > 0 && (rangeHi - rangeLo) / rangeLo < 0.08;
      return compress && cs[i].close < rangeLo * 0.98;
    },
  },

  // ── D: RSI/モメンタム ──────────────────────────────────────────────────────
  {
    id: "D18", label: "RSIオーバーボート反転", category: "D",
    fn(cs, i) {
      if (i < 15) return false;
      const rsi = calcRSI(cs.slice(0, i + 1).map(c => c.close));
      return rsi[i - 1] >= 70 && rsi[i] < 70 && cs[i].close < cs[i - 1].close;
    },
  },
  {
    id: "D19", label: "RSI弱気ダイバージェンス", category: "D",
    fn(cs, i) {
      if (i < 20) return false;
      const rsi = calcRSI(cs.slice(0, i + 1).map(c => c.close));
      if (isNaN(rsi[i]) || isNaN(rsi[i - 10])) return false;
      const priceHigher = cs[i].close > cs[i - 10].close;
      const rsiLower    = rsi[i] < rsi[i - 10];
      return priceHigher && rsiLower && rsi[i] > 50;
    },
  },
  {
    id: "D20", label: "モメンタム枯渇", category: "D",
    fn(cs, i) {
      if (i < 10) return false;
      const rsi = calcRSI(cs.slice(0, i + 1).map(c => c.close));
      if (isNaN(rsi[i]) || isNaN(rsi[i - 3])) return false;
      const rsiDrop  = rsi[i] < rsi[i - 3] - 10;
      const volDrop  = cs[i - 3].volume > 0 && cs[i].volume < cs[i - 3].volume * 0.6;
      return rsiDrop && volDrop;
    },
  },
  {
    id: "D21", label: "RSI中線拒否", category: "D",
    fn(cs, i) {
      if (i < 20) return false;
      const rsi = calcRSI(cs.slice(0, i + 1).map(c => c.close));
      if (isNaN(rsi[i]) || isNaN(rsi[i - 1])) return false;
      const nearMid = rsi[i - 1] >= 48 && rsi[i - 1] <= 55;
      return nearMid && rsi[i] < 48 && cs[i].close < cs[i - 1].close;
    },
  },

  // ── E: BTC相関 ─────────────────────────────────────────────────────────────
  {
    id: "E22", label: "BTC非相関独立下落", category: "E",
    fn(cs, i) {
      if (i < 14) return false;
      const ref = cs[i - 7].close;
      if (ref <= 0) return false;
      return (cs[i].close - ref) / ref <= -0.10;
    },
  },
  {
    id: "E23", label: "BTC下落増幅", category: "E",
    fn(cs, i) {
      if (i < 7) return false;
      const ref = cs[i - 7].close;
      if (ref <= 0) return false;
      return (cs[i].close - ref) / ref <= -0.20;
    },
  },

  // ── F: コンボ ──────────────────────────────────────────────────────────────
  {
    id: "F24", label: "出来高枯渇+RSI過熱", category: "F",
    fn(cs, i) {
      if (i < 14) return false;
      const rsi  = calcRSI(cs.slice(0, i + 1).map(c => c.close));
      const base = avgVol(cs, i - 14, 14);
      return base > 0 && cs[i].volume / base < 0.25 && !isNaN(rsi[i]) && rsi[i] >= 65;
    },
  },
  {
    id: "F25", label: "上場後崩壊+デスクロス", category: "F",
    fn(cs, i, listed) {
      if (i < 26) return false;
      const age = listed - (cs.length - 1 - i);
      if (age < 20 || age > 90) return false;
      if (athDrop(cs, i) > -0.30) return false;
      const closes = cs.slice(0, i + 1).map(c => c.close);
      const ema7   = calcEMA(closes, 7);
      const ema21  = calcEMA(closes, 21);
      return ema7[i] < ema21[i] && ema7[i - 3] >= ema21[i - 3];
    },
  },
];

// ─── BTC index lookup ─────────────────────────────────────────────────────────
function findClosestIdx(candles: Candle[], targetTime: number): number {
  if (candles.length === 0) return -1;
  let best = 0;
  let bestDiff = Math.abs(candles[0].time - targetTime);
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
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { symbols, btcCandles } = body;
  if (!Array.isArray(symbols) || !Array.isArray(btcCandles)) {
    return NextResponse.json({ error: "symbols and btcCandles are required arrays" }, { status: 400 });
  }

  const patternTrades = new Map<string, TradeResult[]>(PATTERNS.map(p => [p.id, []]));
  const cooldown      = new Map<string, number>(); // key → last trigger time (seconds)
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

        // Simulate short trade
        const entryPrice = candles[i].close;
        if (entryPrice <= 0) continue;
        const slPrice = entryPrice * (1 + SL_PCT);
        const tpPrice = entryPrice * (1 - TP_PCT);

        let outcome: "win" | "loss" | "neutral" = "neutral";
        let exitPrice = candles[Math.min(i + HORIZON, candles.length - 1)].close;

        for (let j = i + 1; j <= Math.min(i + HORIZON, candles.length - 1); j++) {
          if (candles[j].high >= slPrice) {          // SL checked first
            outcome   = "loss";
            exitPrice = slPrice;
            break;
          }
          if (candles[j].low <= tpPrice) {
            outcome   = "win";
            exitPrice = tpPrice;
            break;
          }
        }

        const pnlPct =
          outcome === "win"  ?  TP_PCT * 100 :
          outcome === "loss" ? -SL_PCT * 100 :
          ((entryPrice - exitPrice) / entryPrice) * 100;

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

        tradeList.push({ outcome, btcTrend, pnlPct });
        totalTrades++;
      }
    }
  }

  // ── Compute stats ──────────────────────────────────────────────────────────
  const results: PatternStats[] = [];

  for (const pattern of PATTERNS) {
    const trades = patternTrades.get(pattern.id)!;
    if (trades.length < MIN_SAMPLES) continue;

    const wins    = trades.filter(t => t.outcome === "win").length;
    const winRate = wins / trades.length;
    const avgPnl  = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
    const score   = winRate * Math.log(Math.max(trades.length, 1));

    const byTrend = (trend: "up" | "flat" | "down"): number | null => {
      const sub = trades.filter(t => t.btcTrend === trend);
      if (sub.length < 3) return null;
      return sub.filter(t => t.outcome === "win").length / sub.length;
    };

    results.push({
      patternId: pattern.id,
      label: pattern.label,
      category: pattern.category,
      sampleSize: trades.length,
      winRate,
      avgPnlPct: avgPnl,
      score,
      winRateByBtcTrend: { up: byTrend("up"), flat: byTrend("flat"), down: byTrend("down") },
    });
  }

  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    patterns: results,
    summary: {
      top8: results.slice(0, 8).map(p => p.patternId),
      totalTrades,
      symbolsProcessed,
      processingTimeMs: Date.now() - startMs,
    },
  });
}
