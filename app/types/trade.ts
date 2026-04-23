export type TradeAction = "entry" | "exit_tp" | "exit_sl" | "exit_manual";
export type TradeDirection = "long" | "short";

export interface TradeLog {
  id: string;
  action: TradeAction;
  ticker: string;
  direction: TradeDirection;
  price: number;
  size_pct: number;
  timestamp: string; // ISO8601
  bell_rank_at_entry?: string;
  bell_alpha_at_entry?: number;
  bell_risk_at_entry?: number;
  notes?: string;
  linked_entry_id?: string; // exit時にentry IDを紐付け
}

export interface TradeStats {
  total: number;
  entries: number;
  exits: number;
  tpHits: number;
  slHits: number;
  manualExits: number;
  winRate: number | null; // % (null if no exits yet)
  byRank: Record<string, { entries: number; tpHits: number; slHits: number; winRate: number | null }>;
}
