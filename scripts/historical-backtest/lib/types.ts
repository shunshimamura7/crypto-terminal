import type { KlineBar, MexcInterval } from "./mexc";

export interface MexcContractDetail {
  symbol: string;
  displayName?: string;
  displayNameEn?: string;
  positionOpenType?: number;
  baseCoin?: string;
  quoteCoin?: string;
  settleCoin?: string;
  contractSize?: number;
  minLeverage?: number;
  maxLeverage?: number;
  priceScale?: number;
  volScale?: number;
  amountScale?: number;
  priceUnit?: number;
  volUnit?: number;
  minVol?: number;
  maxVol?: number;
  bidLimitPriceRate?: number;
  askLimitPriceRate?: number;
  takerFeeRate?: number;
  makerFeeRate?: number;
  maintenanceMarginRate?: number;
  initialMarginRate?: number;
  riskBaseVol?: number;
  riskIncrVol?: number;
  riskIncrMmr?: number;
  riskIncrImr?: number;
  riskLevelLimit?: number;
  priceCoefficientVariation?: number;
  indexOrigin?: string[];
  state?: number;
  isNew?: boolean;
  isHot?: boolean;
  isHidden?: boolean;
  conceptPlate?: string[];
  riskLimitType?: string;
  createTime?: number;
}

export interface ListingRecord {
  symbol: string;
  baseCoin: string;
  createTime: number;
  createTimeISO: string;
  listedDaysAgo: number;
  state?: number;
  isNew?: boolean;
  isHot?: boolean;
}

export interface ListingsFile {
  fetchedAt: string;
  fetchedAtUnix: number;
  lookbackDays: number;
  totalContracts: number;
  totalUsdtPairs: number;
  totalRecent: number;
  listings: ListingRecord[];
}

export interface SymbolKlineFile {
  symbol: string;
  baseCoin: string;
  interval: MexcInterval;
  createTime: number;
  createTimeISO: string;
  rangeStartSec: number;
  rangeEndSec: number;
  fetchedAt: string;
  fetchedAtUnix: number;
  totalBars: number;
  durationDays: number;
  bars: KlineBar[];
}

export interface FetchFailureRecord {
  symbol: string;
  reason: string;
  attemptedAt: string;
  errorMessage?: string;
}

export interface SimResult {
  symbol: string;
  baseCoin: string;
  strategyId: string;
  tpPct: number;
  slPct: number;

  entryTriggered: boolean;
  entryTimeSec: number | null;
  entryTimeISO: string | null;
  entryPrice: number | null;
  hoursAfterListing: number | null;

  exitReason: "tp_hit" | "sl_hit" | "timeout" | "no_data" | "no_entry";
  exitTimeSec: number | null;
  exitTimeISO: string | null;
  exitPrice: number | null;
  holdingHours: number | null;

  pnlPct: number;
  pnlR: number;
  maxFavorablePct: number;
  maxAdversePct: number;
}

export interface StrategyAggregate {
  strategyId: string;
  tpPct: number;
  slPct: number;

  totalSymbols: number;
  entriesTriggered: number;
  entryRate: number;

  trades: number;
  wins: number;
  losses: number;
  timeouts: number;

  winRate: number;
  resolvedRate: number;

  avgPnl: number;
  totalPnl: number;
  avgWinPnl: number;
  avgLossPnl: number;
  avgHoldingHours: number;

  expectancy: number;
  profitFactor: number;
  realizedR: number;

  byListingAge: {
    "0-3d":   { trades: number; wins: number; winRate: number; avgPnl: number };
    "3-7d":   { trades: number; wins: number; winRate: number; avgPnl: number };
    "7-14d":  { trades: number; wins: number; winRate: number; avgPnl: number };
    "14-30d": { trades: number; wins: number; winRate: number; avgPnl: number };
    "30d+":   { trades: number; wins: number; winRate: number; avgPnl: number };
  };
}

export interface StrategySummaryLite {
  strategyId: string;
  bestParams: { tpPct: number; slPct: number };
  trades: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
  totalPnl: number;
}

export interface GridParams {
  entryHour: number;
  tpPct: number;
  slPct: number;
}

export interface GridResult {
  params: GridParams;

  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  resolvedRate: number;
  avgPnl: number;
  totalPnl: number;
  expectancy: number;
  profitFactor: number;
  realizedR: number;

  firstHalf: {
    trades: number;
    winRate: number;
    avgPnl: number;
    expectancy: number;
  };
  secondHalf: {
    trades: number;
    winRate: number;
    avgPnl: number;
    expectancy: number;
  };

  robustness?: {
    neighborAvgExpectancy: number;
    diffFromNeighbors: number;
    isRobust: boolean;
  };
}

export interface GridSearchOutput {
  generatedAt: string;
  totalSimulations: number;
  totalSymbols: number;
  splitDate: string;
  params: {
    entryHours: number[];
    tpPcts: number[];
    slPcts: number[];
  };
  results: GridResult[];
  topRanked: GridResult[];
  robustWinners: GridResult[];
}
