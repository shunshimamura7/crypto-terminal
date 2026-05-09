export type HunterRecordStatus = "open" | "win" | "loss" | "timeout";

export interface HunterRecord {
  // 識別子
  id: string;
  symbol: string;

  // エントリー
  entryAt: string;
  entryPrice: number;
  listingAt: string;
  hoursSinceListing: number;

  // 戦略パラメータ
  tpPrice: number;
  slPrice: number;
  deadline: string;

  // 決着情報
  status: HunterRecordStatus;
  closedAt?: string;
  closeReason?: "tp_hit" | "sl_hit" | "timeout";
  finalPnlPct?: number;

  // 価格履歴
  priceHistory: Array<{
    checkedAt: string;
    price: number;
    pnlPct: number;
  }>;
  maxDrawdownPct?: number; // 期間中の最大利益（価格最安値時のPnL%）
  maxAdversePct?: number;  // 期間中の最大不利（価格最高値時のPnL%）

  // メタ
  recordedManually: boolean;
  version: "hunter22h-v1";
}

export const HUNTER_RECORDS_KEY = "bell:hunter22h:records";
export const HUNTER_AUTO_RECORD_KEY = "bell:hunter22h:autoRecord";
export const MAX_PRICE_HISTORY = 100;

export function getHunterRecords(): HunterRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HUNTER_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveHunterRecord(record: HunterRecord): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords();
    const idx = records.findIndex(r => r.id === record.id);
    if (idx >= 0) records[idx] = record;
    else records.push(record);
    localStorage.setItem(HUNTER_RECORDS_KEY, JSON.stringify(records));
  } catch { /* quota */ }
}

export function updateHunterRecord(id: string, updates: Partial<HunterRecord>): void {
  if (typeof window === "undefined") return;
  try {
    const records = getHunterRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx >= 0) {
      records[idx] = { ...records[idx], ...updates };
      localStorage.setItem(HUNTER_RECORDS_KEY, JSON.stringify(records));
    }
  } catch { /* quota */ }
}

export function getOpenRecords(): HunterRecord[] {
  return getHunterRecords().filter(r => r.status === "open");
}

export function getClosedRecords(): HunterRecord[] {
  return getHunterRecords().filter(r => r.status !== "open");
}

export function isAutoRecordEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(HUNTER_AUTO_RECORD_KEY) === "true";
}

export function setAutoRecordEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(HUNTER_AUTO_RECORD_KEY, String(enabled));
}
