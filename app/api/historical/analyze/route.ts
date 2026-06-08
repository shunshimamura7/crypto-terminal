import { NextRequest, NextResponse } from "next/server";
import { type Candle, PATTERNS } from "@/app/lib/patterns";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUDGET_MS   = 45_000;
const SL_PCT      = 0.08;
const TP_PCT      = 0.10;
const HORIZON     = 14;
const COOLDOWN    = 7;
const MIN_SAMPLES = 5;

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
  maxDrop: number;
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
    if (cs[j].high >= slPrice) {
      outcome   = "loss";
      exitPrice = slPrice;
      break;
    }
    if (cs[j].low < minLow) minLow = cs[j].low;
    if (cs[j].low <= tp5)  hit5pct  = true;
    if (cs[j].low <= tp10) hit10pct = true;
    if (cs[j].low <= tp15) hit15pct = true;
    if (cs[j].low <= tp20) hit20pct = true;
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
