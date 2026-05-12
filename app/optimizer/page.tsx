"use client";

import { useState, useRef, useCallback } from "react";
import type { CsvRow, CollectResponse } from "@/app/api/optimizer/collect/route";

type Status = "idle" | "collecting" | "done" | "error";

const GRID_PARAMS = {
  entryHours: { label: "エントリー時刻", range: "1h〜48h", count: 48 },
  tp:         { label: "TP",            range: "-3%〜-20%", count: 18 },
  sl:         { label: "SL",            range: "+5%〜+25%", count: 21 },
  hold:       { label: "ホールド",       range: "1〜14日",   count: 14 },
};
const TOTAL_PATTERNS = 48 * 18 * 21 * 14; // 254,016

export default function OptimizerPage() {
  const [status, setStatus]             = useState<Status>("idle");
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [totalSymbols, setTotalSymbols] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [rowCount, setRowCount]         = useState(0);
  const [errorMsg, setErrorMsg]         = useState("");

  const allRowsRef = useRef<CsvRow[]>([]);
  const abortRef   = useRef(false);

  const startCollect = useCallback(async () => {
    allRowsRef.current = [];
    abortRef.current   = false;
    setStatus("collecting");
    setCurrentBatch(0);
    setTotalBatches(0);
    setTotalSymbols(0);
    setProcessedCount(0);
    setRowCount(0);
    setErrorMsg("");

    let batch = 0;
    let knownTotalBatches = Infinity;

    while (batch < knownTotalBatches && !abortRef.current) {
      try {
        const res = await fetch(`/api/optimizer/collect?batch=${batch}`);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setErrorMsg(`バッチ ${batch}: HTTP ${res.status} — ${text.slice(0, 200)}`);
          setStatus("error");
          return;
        }

        const data: CollectResponse = await res.json();

        if (data.error) {
          setErrorMsg(data.error);
          setStatus("error");
          return;
        }

        allRowsRef.current = allRowsRef.current.concat(data.rows);
        knownTotalBatches  = data.totalBatches;

        setTotalBatches(data.totalBatches);
        setTotalSymbols(data.totalSymbols);
        setCurrentBatch(batch + 1);
        setProcessedCount(prev => prev + data.processedSymbols);
        setRowCount(allRowsRef.current.length);

        if (data.done || batch + 1 >= data.totalBatches) break;
        batch++;
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "通信エラー");
        setStatus("error");
        return;
      }
    }

    setStatus("done");
  }, []);

  const stopCollect = useCallback(() => {
    abortRef.current = true;
    setStatus("idle");
  }, []);

  const downloadCsv = useCallback(() => {
    const header = "symbol,listingTime,candleTime,open,high,low,close,volume";
    const lines   = allRowsRef.current.map(r =>
      `${r.symbol},${r.listingTime},${r.candleTime},${r.open},${r.high},${r.low},${r.close},${r.volume}`,
    );
    const csv  = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "listing-data.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const progress = totalBatches > 0 ? Math.min(100, Math.round((currentBatch / totalBatches) * 100)) : 0;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <h1 className="text-base font-black text-gray-900 tracking-tight">
            📊 新規上場ショート — グリッドサーチ データ収集
          </h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            MEXC先物 過去180日新規上場 × 上場後72h 15分足
          </p>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Grid search summary */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">グリッドサーチ計画</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-gray-600">
            {Object.values(GRID_PARAMS).map(p => (
              <div key={p.label} className="flex justify-between">
                <span className="text-gray-500">{p.label}</span>
                <span>{p.range} <span className="text-gray-400">({p.count}通り)</span></span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs">
            <span className="text-gray-500">合計パターン数</span>
            <span className="font-bold text-gray-800">{TOTAL_PATTERNS.toLocaleString()} パターン</span>
          </div>
        </div>

        {/* Collect panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {status !== "collecting" ? (
              <button
                onClick={startCollect}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                {status === "done" ? "再収集" : status === "error" ? "リトライ" : "収集開始"}
              </button>
            ) : (
              <button
                onClick={stopCollect}
                className="px-5 py-2.5 bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-300 transition-colors"
              >
                停止
              </button>
            )}

            {status === "done" && rowCount > 0 && (
              <button
                onClick={downloadCsv}
                className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
              >
                CSV ダウンロード ({rowCount.toLocaleString()} 行)
              </button>
            )}
          </div>

          {/* Progress */}
          {status !== "idle" && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  {status === "collecting" && (
                    totalBatches > 0
                      ? `バッチ ${currentBatch}/${totalBatches} — ${processedCount}/${totalSymbols} 銘柄処理済み`
                      : "初期化中..."
                  )}
                  {status === "done" && `完了 — ${totalSymbols} 銘柄 / ${rowCount.toLocaleString()} ローソク足`}
                  {status === "error" && "収集エラー"}
                </span>
                <span className="tabular-nums">
                  {status === "collecting" && `${progress}%`}
                  {status === "done" && "100%"}
                </span>
              </div>

              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    status === "done"  ? "bg-green-500" :
                    status === "error" ? "bg-red-400"   :
                    "bg-blue-500"
                  }`}
                  style={{ width: `${status === "done" ? 100 : progress}%` }}
                />
              </div>

              {status === "error" && (
                <p className="text-xs text-red-600 bg-red-50 rounded p-2">{errorMsg}</p>
              )}

              {status === "collecting" && rowCount > 0 && (
                <p className="text-xs text-gray-400">
                  取得済み: {rowCount.toLocaleString()} ローソク足
                </p>
              )}
            </div>
          )}
        </div>

        {/* Usage guide */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">パイプライン</p>
          <ol className="space-y-2 text-xs text-gray-500 list-none">
            {[
              ["Step 1", "「収集開始」→ MEXC APIから過去180日新規上場の上場後72h 15分足を収集"],
              ["Step 2", "「CSVダウンロード」でファイルを保存"],
              ["Step 3", "CSVをベルに投げてグリッドサーチ (254,016パターン) を実行"],
              ["Step 4", "期待値・勝率・最大DD・シャープレシオでTOP抽出"],
              ["Step 5", "市況別感度分析 (F&G別、BTC方向別)"],
              ["Step 6", "22hハンター設定にフィードバック"],
            ].map(([step, desc]) => (
              <li key={step} className="flex gap-3">
                <span className="shrink-0 w-14 text-right font-mono text-[10px] text-gray-400 pt-0.5">{step}</span>
                <span>{desc}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Data note */}
        <p className="text-[10px] text-gray-400 text-center pb-4">
          各バッチ最大20銘柄 / 1リクエスト。Vercel Hobby 60s制限に対応したバッチ分割方式。
        </p>
      </div>
    </main>
  );
}
