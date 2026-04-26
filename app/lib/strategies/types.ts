export type StrategyTag = "A_PUMP_EXHAUSTION" | "B_CASCADE_SETUP" | "C_STALE_DRIFT";

export interface StrategyMatch {
  matched: boolean;
  confidence: number;          // 0-100
  reasons: string[];
  warnings: string[];
}

export interface CandidateInput {
  athDropPct: number;
  volumeChangeRatio: number;
  fundingRate: number | null;
  oiRatio: number;
  listedDaysAgo: number;
  priceChange7d: number;
  priceChange24h: number;
  btcCorrelation: number;
  displayScore: number;
  shortScore: number;
  chartPattern: { type: string } | null;
  trendMultiTF: { alignment: number } | null;
  exclusivityScore: number;
  frBonus: number;
  volumeSpike: { direction: string; spikeLevel: number } | null;
}

export interface StrategyDef {
  tag: StrategyTag;
  name: string;
  shortName: string;
  icon: string;
  thesis: string;
  fullThesis: string;
  evaluate: (c: CandidateInput) => StrategyMatch;
  recommendedSize: { min: number; max: number };
  recommendedLeverage: number;
  expectedHoldDays: { min: number; max: number };
  rrTargetMin: number;
}

export function emptyMatch(): StrategyMatch {
  return { matched: false, confidence: 0, reasons: [], warnings: [] };
}
