import type { BacktestRecord } from "./backtestStorage";

export interface SimulationConfig {
  initialCapital: number;
  leverage: number;
  usdJpy: number;
  mode: "risk" | "position";
  riskPerTrade: number;     // mode="risk" 用（%）
  positionSizePct: number;  // mode="position" 用（%）
}

export interface SimulationResult {
  finalEquity: number;
  totalReturn: number;    // %
  maxDrawdown: number;    // %
  maxDDJpy: number;       // peak基準の最大DD金額
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;        // %
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  equityCurve: { label: string; equity: number }[];
  bankrupt: boolean;
}

export function simulateBacktest(
  records: BacktestRecord[],
  config: SimulationConfig,
): SimulationResult {
  const { initialCapital } = config;

  const resolved = [...records]
    .filter(r =>
      r.resolvedAt != null &&
      r.resolvedPrice != null &&
      (r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit" || r.status === "sl_hit"),
    )
    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDDPeak = initialCapital;
  let winCount = 0;
  let lossCount = 0;
  let totalWinR = 0;
  let totalLossR = 0;
  let totalWinJpy = 0;
  let totalLossJpy = 0;
  let bankrupt = false;

  const equityCurve: { label: string; equity: number }[] = [
    { label: "開始", equity: initialCapital },
  ];

  for (const r of resolved) {
    const exitPrice = r.status === "tp1_hit" ? r.tp1
                    : r.status === "tp2_hit" ? r.tp2
                    : r.status === "tp3_hit" ? r.tp3
                    : r.status === "sl_hit"  ? r.sl
                    : (r.resolvedPrice ?? r.entryPrice);
    const profit = r.entryPrice - exitPrice;
    const risk   = r.sl - r.entryPrice;
    if (risk <= 0) continue;

    // R倍率（統計用・モード共通）
    const realR = profit / risk;

    let tradePnl: number;
    if (config.mode === "position") {
      const pricePnlPct = profit / r.entryPrice;
      const positionJpy = equity * config.positionSizePct / 100;
      tradePnl = positionJpy * pricePnlPct * config.leverage;
    } else {
      // risk mode（デフォルト）
      const riskAmount = equity * config.riskPerTrade / 100;
      tradePnl = realR * riskAmount;
    }

    equity += tradePnl;

    // 破産処理
    if (equity <= 0) {
      equity = 0;
      bankrupt = true;
      equityCurve.push({ label: r.symbol.replace("_USDT", ""), equity: 0 });
      break;
    }

    if (realR > 0) {
      winCount++;
      totalWinR  += realR;
      totalWinJpy += tradePnl;
    } else if (realR < 0) {
      lossCount++;
      totalLossR  += Math.abs(realR);
      totalLossJpy += Math.abs(tradePnl);
    }

    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDDPeak   = peak;
    }

    equityCurve.push({
      label: r.symbol.replace("_USDT", ""),
      equity: Math.round(equity),
    });
  }

  const totalTrades   = winCount + lossCount;
  const winRate       = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const avgWinR       = winCount  > 0 ? totalWinR  / winCount  : 0;
  const avgLossR      = lossCount > 0 ? totalLossR / lossCount : 0;
  const profitFactor  = totalLossJpy > 0 ? totalWinJpy / totalLossJpy : totalWinJpy > 0 ? Infinity : 0;
  const totalReturn   = ((equity - initialCapital) / initialCapital) * 100;
  const maxDDJpy      = maxDDPeak * (maxDrawdown / 100);

  return {
    finalEquity: equity,
    totalReturn,
    maxDrawdown,
    maxDDJpy,
    totalTrades,
    winCount,
    lossCount,
    winRate,
    avgWinR,
    avgLossR,
    profitFactor,
    equityCurve,
    bankrupt,
  };
}
