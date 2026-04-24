export type AnalysisType = "sector" | "individual" | "technical";

export interface AnalysisRecord {
  id: string;
  type: AnalysisType;
  title: string;
  summary: string;
  fullText: string;
  savedAt: number;
}

const KEY = (type: AnalysisType) => `analysisHistory:${type}`;
const MAX = 20;

export function saveAnalysis(record: Omit<AnalysisRecord, "id" | "savedAt">): void {
  if (typeof window === "undefined") return;
  const key = KEY(record.type);
  const existing: AnalysisRecord[] = JSON.parse(localStorage.getItem(key) ?? "[]");
  const newRecord: AnalysisRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
  };
  localStorage.setItem(key, JSON.stringify([newRecord, ...existing].slice(0, MAX)));
}

export function getAnalysisByType(type: AnalysisType): AnalysisRecord[] {
  if (typeof window === "undefined") return [];
  return JSON.parse(localStorage.getItem(KEY(type)) ?? "[]");
}

export function deleteAnalysis(type: AnalysisType, id: string): void {
  if (typeof window === "undefined") return;
  const key = KEY(type);
  const existing: AnalysisRecord[] = JSON.parse(localStorage.getItem(key) ?? "[]");
  localStorage.setItem(key, JSON.stringify(existing.filter(r => r.id !== id)));
}

export function clearAnalysisByType(type: AnalysisType): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY(type));
}
