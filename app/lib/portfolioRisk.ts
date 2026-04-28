"use client";

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number;
}

export interface PortfolioVaR {
  var95: number;
  var99: number;
  maxCorrelation: number;
  highCorrPairs: CorrelationPair[];
  diversificationRatio: number;
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  const xs = x.slice(0, n), ys = y.slice(0, n);
  const sumX  = xs.reduce((a, b) => a + b, 0);
  const sumY  = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, xi, i) => acc + xi * ys[i], 0);
  const sumX2 = xs.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = ys.reduce((acc, yi) => acc + yi * yi, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  return den === 0 ? 0 : Math.max(-1, Math.min(1, num / den));
}

function toReturns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => prices[i] > 0 ? (p - prices[i]) / prices[i] : 0);
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

const Z_95 = 1.645;
const Z_99 = 2.326;

export function calcPortfolioVaR(
  priceHistories: { symbol: string; closes: number[] }[],
): PortfolioVaR | null {
  if (priceHistories.length < 2) return null;

  const returnSeries = priceHistories.map(h => ({
    symbol: h.symbol,
    returns: toReturns(h.closes),
    vol: stdDev(toReturns(h.closes)),
  }));

  const pairs: CorrelationPair[] = [];
  let maxCorr = 0;

  for (let i = 0; i < returnSeries.length; i++) {
    for (let j = i + 1; j < returnSeries.length; j++) {
      const corr = pearson(returnSeries[i].returns, returnSeries[j].returns);
      pairs.push({ symbolA: returnSeries[i].symbol, symbolB: returnSeries[j].symbol, correlation: corr });
      if (Math.abs(corr) > maxCorr) maxCorr = Math.abs(corr);
    }
  }

  const highCorrPairs = pairs.filter(p => Math.abs(p.correlation) >= 0.7);
  const n = returnSeries.length;
  const weight = 1 / n;

  const individualVarSum = returnSeries.reduce((sum, r) => sum + r.vol * weight, 0);

  let portfolioVariance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const corr = i === j ? 1 : (pairs.find(
        p => (p.symbolA === returnSeries[i].symbol && p.symbolB === returnSeries[j].symbol) ||
             (p.symbolB === returnSeries[i].symbol && p.symbolA === returnSeries[j].symbol)
      )?.correlation ?? 0);
      portfolioVariance += weight * weight * returnSeries[i].vol * returnSeries[j].vol * corr;
    }
  }

  const portfolioVol = Math.sqrt(Math.max(0, portfolioVariance));
  const diversificationRatio = individualVarSum > 0 ? portfolioVol / individualVarSum : 1;

  return {
    var95: portfolioVol * Z_95,
    var99: portfolioVol * Z_99,
    maxCorrelation: maxCorr,
    highCorrPairs,
    diversificationRatio,
  };
}
