"use client";
import { useState } from "react";
import ShortScanner from "@/components/ShortScanner";
import WatchList from "@/components/WatchList";

type Tab = "scanner" | "watchlist";

export default function ShortHunterPage() {
  const [tab, setTab] = useState<Tab>("scanner");
  const [analyzeQuery, setAnalyzeQuery] = useState<string | null>(null);

  function handleAnalyze(query: string) {
    setAnalyzeQuery(query);
  }

  function handleBatchAnalyze(items: string[]) {
    // No-op on this lightweight page
    void items;
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-black text-gray-900 tracking-tight leading-tight">
              🎯 BELL Short Hunter
            </h1>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">MEXC先物ショート特化</p>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            LIVE
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 flex gap-0 border-t border-gray-100">
          {(["scanner", "watchlist"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-semibold border-b-2 transition-colors ${
                tab === t
                  ? "border-red-500 text-red-600"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t === "scanner" ? "🎯 Scanner" : "⭐ ウォッチリスト"}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {tab === "scanner" ? (
          <ShortScanner />
        ) : (
          <WatchList onAnalyze={handleAnalyze} onBatchAnalyze={handleBatchAnalyze} />
        )}
      </div>

      {/* Analyze overlay hint */}
      {analyzeQuery && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2">
          <span>🔍 {analyzeQuery} を分析中…</span>
          <button onClick={() => setAnalyzeQuery(null)} className="text-gray-400 hover:text-white ml-1">✕</button>
        </div>
      )}
    </main>
  );
}
