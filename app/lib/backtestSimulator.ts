import type { BacktestRecord } from "./backtestStorage";

export interface SimulationConfig {
  initialCapital: number;  // JPY
  riskPerTrade: number;    // %, e.g. 2 = 2%
  leverage: number;
  usdJpy: number;
}

export interface SimulationResult {
  finalEquity: number;
  totalReturn: number;    // %
  maxDrawdown: number;    // %
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;        // %
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  equityCurve: { label: string; equity: number }[];
}

export function simulateBacktest(
  records: BacktestRecord[],
  config: SimulationConfig,
): SimulationResult {
  const { initialCapital, riskPerTrade } = config;

  const resolved = [...records]
    .filter(r => r.resolvedAt != null && r.resolvedPrice != null && r.status !== "active")
    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let winCount = 0;
  let lossCount = 0;
  let totalWinR = 0;
  let totalLossR = 0;

  const equityCurve: { label: string; equity: number }[] = [
    { label: "開始", equity: initialCapital },
  ];

  for (const r of resolved) {
    const profit = r.entryPrice - (r.resolvedPrice ?? r.entryPrice);
    const risk = r.sl - r.entryPrice;
    if (risk <= 0) continue;

    const realR = profit / risk;
    const riskAmount = equity * riskPerTrade / 100;
    const tradePnl = realR * riskAmount;

    equity += tradePnl;
    equity = Math.max(equity, 0);

    if (realR > 0) {
      winCount++;
      totalWinR += realR;
    } else if (realR < 0) {
      lossCount++;
      totalLossR += Math.abs(realR);
    }

    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    equityCurve.push({
      label: r.symbol.replace("_USDT", ""),
      equity: Math.round(equity),
    });
  }

  const totalTrades = winCount + lossCount;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const avgWinR = winCount > 0 ? totalWinR / winCount : 0;
  const avgLossR = lossCount > 0 ? totalLossR / lossCount : 0;
  const profitFactor = totalLossR > 0 ? totalWinR / totalLossR : totalWinR > 0 ? Infinity : 0;
  const totalReturn = ((equity - initialCapital) / initialCapital) * 100;

  return {
    finalEquity: equity,
    totalReturn,
    maxDrawdown,
    totalTrades,
    winCount,
    lossCount,
    winRate,
    avgWinR,
    avgLossR,
    profitFactor,
    equityCurve,
  };
}
