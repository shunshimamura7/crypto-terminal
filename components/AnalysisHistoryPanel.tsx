"use client";
import { useState, useEffect } from "react";
import { getAnalysisByType, deleteAnalysis, clearAnalysisByType } from "@/app/lib/analysisHistory";
import type { AnalysisType, AnalysisRecord } from "@/app/lib/analysisHistory";

interface Props {
  type: AnalysisType;
  label: string;
  refreshKey?: number;
}

export default function AnalysisHistoryPanel({ type, label, refreshKey }: Props) {
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setRecords(getAnalysisByType(type));
  }, [type, refreshKey]);

  if (records.length === 0) return null;

  const displayed = records.slice(0, 5);

  const handleDelete = (id: string) => {
    deleteAnalysis(type, id);
    setRecords(getAnalysisByType(type));
  };

  const handleClear = () => {
    clearAnalysisByType(type);
    setRecords([]);
    setOpen(false);
  };

  return (
    <div className="mt-4 border border-gray-200 rounded-xl bg-white shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors"
      >
        <span>🕘 {label}の履歴（{records.length}件）</span>
        <span className="text-gray-400 text-xs">{open ? "▲ 閉じる" : "▼ 展開"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-200 p-3 space-y-2">
          {displayed.map(rec => (
            <div key={rec.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold text-sm text-gray-800">{rec.title}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {new Date(rec.savedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                    className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-blue-500 hover:border-blue-300 transition-colors"
                  >
                    {expandedId === rec.id ? "閉じる" : "展開"}
                  </button>
                  <button
                    onClick={() => handleDelete(rec.id)}
                    className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-300 transition-colors"
                  >
                    削除
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{rec.summary}</p>
              {expandedId === rec.id && (
                <div className="mt-2 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto bg-white border border-gray-100 rounded p-2">
                  {rec.fullText}
                </div>
              )}
            </div>
          ))}
          {records.length > 5 && (
            <p className="text-xs text-gray-400 text-center">最新5件を表示（全{records.length}件）</p>
          )}
          <button
            onClick={handleClear}
            className="w-full text-xs py-1.5 border border-red-200 text-red-500 hover:bg-red-50 rounded transition-colors"
          >
            履歴をすべて削除
          </button>
        </div>
      )}
    </div>
  );
}
