"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { getRecords, saveRecords } from "@/app/lib/backtestStorage";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import type { PrecursorSignal } from "@/app/lib/precursorScanner";
import type { PrecursorScanResponse } from "@/app/api/precursor-scan/route";

export default function PrecursorScanner() {
  const [signals, setSignals] = useState<PrecursorSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<Set<string>>(new Set());

  // Auto-refresh
  const [autoIntervalMin, setAutoIntervalMin] = useState<0 | 1 | 5>(() => {
    if (typeof window === "undefined") return 0;
    return (Number(localStorage.getItem("precursorScanInterval") ?? "0") as 0 | 1 | 5);
  });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showAutoMenu, setShowAutoMenu] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-record
  const [autoRecord, setAutoRecord] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("precursorAutoRecord") === "on";
  });
  const autoRecordRef = useRef(autoRecord);
  useEffect(() => { autoRecordRef.current = autoRecord; }, [autoRecord]);

  const scanPrecursors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/precursor-scan", {
        signal: AbortSignal.timeout(65_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PrecursorScanResponse = await res.json();
      setSignals(data.results);
      setFetchedAt(data.fetchedAt);

      if (autoRecordRef.current && data.results.length > 0) {
        const existing = getRecords();
        const existingKeys = new Set(existing.map(r => `${r.symbol}:${r.strategy}`));
        const newRecords: BacktestRecord[] = data.results
          .filter(s => !existingKeys.has(`${s.symbol}:PRECURSOR`))
          .map(s => {
            const id = `precursor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const rr = (s.currentPrice - s.suggestedTP) / (s.suggestedSL - s.currentPrice);
            return {
              id,
              symbol: s.symbol,
              score: s.precursorScore,
              scoreMax: 7,
              recordedAt: s.detectedAt,
              entryPrice: s.currentPrice,
              sl: s.suggestedSL,
              tp1: s.suggestedTP,
              tp2: s.currentPrice * 0.92,
              tp3: s.currentPrice * 0.88,
              rrRatio: rr > 0 ? rr : 0,
              trendDirection: "short" as const,
              status: "active" as const,
              resolvedAt: null,
              resolvedPrice: null,
              maxDrawdown: null,
              maxProfit: null,
              currentPrice: null,
              lastCheckedAt: null,
              preset: "production",
              strategy: "PRECURSOR",
              version: "v2.0",
            };
          });
        if (newRecords.length > 0) {
          saveRecords([...existing, ...newRecords]);
          setRecorded(prev => new Set([...prev, ...newRecords.map(r => r.symbol)]));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-interval countdown logic (mirrors ShortScanner pattern)
  useEffect(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(null);
    if (autoIntervalMin > 0) {
      const ms = autoIntervalMin * 60 * 1000;
      let remaining = ms / 1000;
      setCountdown(remaining);
      countdownRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          remaining = ms / 1000;
          setCountdown(remaining);
          scanPrecursors();
        }
      }, 1000);
    }
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoIntervalMin]);

  function setAutoIntervalAndSave(min: 0 | 1 | 5) {
    localStorage.setItem("precursorScanInterval", String(min));
    setAutoIntervalMin(min);
    setShowAutoMenu(false);
  }

  function toggleAutoRecord() {
    setAutoRecord(prev => {
      const next = !prev;
      localStorage.setItem("precursorAutoRecord", next ? "on" : "off");
      return next;
    });
  }

  function handleRecord(signal: PrecursorSignal) {
    const id = `precursor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const rr = (signal.currentPrice - signal.suggestedTP) / (signal.suggestedSL - signal.currentPrice);
    const record: BacktestRecord = {
      id,
      symbol: signal.symbol,
      score: signal.precursorScore,
      scoreMax: 7,
      recordedAt: signal.detectedAt,
      entryPrice: signal.currentPrice,
      sl: signal.suggestedSL,
      tp1: signal.suggestedTP,
      tp2: signal.currentPrice * 0.92,
      tp3: signal.currentPrice * 0.88,
      rrRatio: rr > 0 ? rr : 0,
      trendDirection: "short",
      status: "active",
      resolvedAt: null,
      resolvedPrice: null,
      maxDrawdown: null,
      maxProfit: null,
      currentPrice: null,
      lastCheckedAt: null,
      preset: "production",
      strategy: "PRECURSOR",
      version: "v2.0",
    };
    saveRecords([...getRecords(), record]);
    setRecorded(prev => new Set([...prev, signal.symbol]));
  }

  return (
    <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
      {/* ヘッダー */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-purple-50 dark:bg-purple-900/20">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-black text-gray-900 dark:text-gray-50">
              🔮 前兆スキャン
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              出来高・高値切り下がり・FRトラップを検出。スコア≥4の銘柄を表示。
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {fetchedAt && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                取得: {new Date(fetchedAt).toLocaleTimeString("ja-JP")}
                {signals.length > 0 && ` / ${signals.length}件`}
              </span>
            )}
            {/* Auto-refresh dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowAutoMenu(v => !v)}
                className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                  autoIntervalMin > 0
                    ? "bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                ⏱ 自動更新: {autoIntervalMin > 0 ? `${autoIntervalMin}分` : "OFF"} ▾
                {autoIntervalMin > 0 && countdown != null && (
                  <span className="ml-1 text-indigo-400">
                    🔄 {Math.floor(countdown / 60)}:{String(Math.floor(countdown % 60)).padStart(2, "0")}
                  </span>
                )}
              </button>
              {showAutoMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[120px]">
                  {([0, 1, 5] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setAutoIntervalAndSave(m)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-colors ${
                        autoIntervalMin === m ? "text-indigo-600 font-bold" : "text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {m === 0 ? "OFF" : `${m}分ごと`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Auto-record toggle */}
            <button
              onClick={toggleAutoRecord}
              className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                autoRecord
                  ? "bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              全件自動記録: {autoRecord ? "ON" : "OFF"}
            </button>
            <button
              onClick={scanPrecursors}
              disabled={loading}
              className="text-xs px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold disabled:opacity-50 transition-colors"
            >
              {loading ? "⏳ スキャン中（最大60秒）…" : "🔍 スキャン実行"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-5 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800">
          ❌ {error}
        </div>
      )}

      {/* 初期状態 */}
      {!loading && signals.length === 0 && !fetchedAt && (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            「スキャン実行」ボタンで出来高上位50銘柄を分析します。
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            所要時間: 約20〜40秒 / キャッシュ: 10分
          </p>
        </div>
      )}

      {!loading && signals.length === 0 && fetchedAt && (
        <div className="px-5 py-8 text-center text-sm text-gray-400">
          前兆シグナル（スコア≥4）が見つかりませんでした
        </div>
      )}

      {/* スコア凡例 */}
      {signals.length > 0 && (
        <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">出来高↓4h +2</span>
          <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded">高値↓4h +2</span>
          <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded">出来高枯渇 +1</span>
          <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded">高値↓日足 +1</span>
          <span className="px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded">FRトラップ +1</span>
          <span className="text-gray-400">/ 最大7pt・TP=-5%・SL=+8%</span>
        </div>
      )}

      {/* 結果テーブル */}
      {signals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
                <th className="px-4 py-2 text-left font-semibold">銘柄</th>
                <th className="px-3 py-2 text-center font-semibold">スコア</th>
                <th className="px-3 py-2 text-left font-semibold">シグナル</th>
                <th className="px-3 py-2 text-right font-semibold">FR</th>
                <th className="px-3 py-2 text-right font-semibold">現在値</th>
                <th className="px-3 py-2 text-right font-semibold">TP(-5%)</th>
                <th className="px-3 py-2 text-right font-semibold">SL(+8%)</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {signals.map(s => {
                const base = s.symbol.replace(/_USDT$/, "");
                const isRecorded = recorded.has(s.symbol);
                return (
                  <tr key={s.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-2 font-bold text-gray-900 dark:text-gray-100">{base}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded font-bold ${
                        s.precursorScore >= 6 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                        : s.precursorScore >= 5 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                      }`}>
                        {s.precursorScore}/7
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-0.5">
                        {s.signals.volDecline4h    && <span className="px-1 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-[10px]">出来高↓4h</span>}
                        {s.signals.lowerHighs4h    && <span className="px-1 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-[10px]">高値↓4h</span>}
                        {s.signals.volDryDaily     && <span className="px-1 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded text-[10px]">出来高枯渇</span>}
                        {s.signals.lowerHighsDaily && <span className="px-1 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded text-[10px]">高値↓日足</span>}
                        {s.signals.frLongTrap      && <span className="px-1 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-[10px]">FRトラップ</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={s.fr > 0 ? "text-orange-600" : "text-blue-500"}>
                        {(s.fr * 100).toFixed(4)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-300">
                      ${s.currentPrice.toPrecision(5)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      ${s.suggestedTP.toPrecision(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-500">
                      ${s.suggestedSL.toPrecision(4)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleRecord(s)}
                        disabled={isRecorded}
                        className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-colors whitespace-nowrap ${
                          isRecorded
                            ? "bg-gray-100 text-gray-400 cursor-default"
                            : "bg-purple-600 hover:bg-purple-700 text-white"
                        }`}
                      >
                        {isRecorded ? "✓ 記録済" : "BT記録"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
