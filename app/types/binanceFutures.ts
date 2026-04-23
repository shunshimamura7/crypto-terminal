export type FrSignal = "short_favorable" | "neutral" | "danger_squeeze" | "extreme_long";
export type OiTrend = "increasing" | "decreasing" | "stable";
export type LiquidationRisk = "high" | "medium" | "low";

export interface BinanceFuturesData {
  symbol: string;
  fundingRate: number;
  markPrice: number;
  indexPrice: number;
  openInterestUsdt: number;
  openInterestCoin: number;
  oiChange24h: number | null;
  oiChange7d: number | null;
  frSignal: FrSignal;
  oiTrend: OiTrend;
  liquidationRisk: LiquidationRisk;
  mexcFrEstMin: number;
  mexcFrEstMax: number;
}
