"use client";

import React, { useState } from "react";
import type { Strategy36hCandidate, Strategy36hResponse } from "@/app/api/strategy/scan-36h/route";

type StrategyKey = "A1" | "A2" | "A3";

const STRATEGY_STATS: Record<StrategyKey, { winRate: number; ev: number; sharpe: number }> = {
  A1: { winRate: 89.7, ev: 1.86, sharpe: 0.542 },
  A2: { winRate: 86.8, ev: 2.78, sharpe: 0.476 },
  A3: { winRate: 79.4, ev: 3.12, sharpe: 0.403 },
};

function fmtPrice(n: number): string {
  if (n < 0.001) return n.toExponential(3);
  if (n < 1) return n.toFixed(5);
  if (n < 100) return n.toFixed(3);
  return n.toFixed(2);
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(1)}K`;
}

function fmtFr(fr: number): string {
  const pct = (fr * 100).toFixed(4);
  return fr >= 0 ? `+${pct}%` : `${pct}%`;
}

function PriorityBadge({ priority }: { priority: "high" | "caution" }) {
  if (priority === "high") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 text-xs font-bold whitespace-nowrap">
        🎯 HIGH
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-700 text-xs font-bold whitespace-nowrap">
      ⚠️ CAUTION
    </span>
  );
}

function CandidateRow({ c }: { c: Strategy36hCandidate }) {
  const frPositive = c.fundingRate >= 0;
  return (
    <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors last:border-b-0">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Symbol + hours */}
        <div className="min-w-[72px]">
          <div className="font-bold text-sm text-gray-900 dark:text-gray-100">{c.baseCoin}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500">{c.hoursSinceListing}h</div>
        </div>

        {/* Price */}
        <div className="min-w-[72px]">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase">現在価格</div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">${fmtPrice(c.currentPrice)}</div>
        </div>

        {/* FR */}
        <div className="min-w-[72px]">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase">FR</div>
          <div className={`text-sm font-semibold ${frPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
            {fmtFr(c.fundingRate)}
          </div>
        </div>

        {/* OI */}
        <div className="min-w-[72px]">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase">OI</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{fmtK(c.openInterestUsd)}</div>
        </div>

        {/* Vol */}
        <div className="min-w-[80px]">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase">24h出来高</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{fmtK(c.vol24hUsd)}</div>
        </div>

        {/* TP / SL */}
        <div className="min-w-[120px]">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 uppercase">TP / SL</div>
          <div className="text-sm font-semibold">
            <span className="text-emerald-600 dark:text-emerald-400">${fmtPrice(c.tpPrice)}</span>
            <span className="text-gray-300 dark:text-gray-600 mx-1">/</span>
            <span className="text-rose-500 dark:text-rose-400">${fmtPrice(c.slPrice)}</span>
          </div>
        </div>

        {/* Priority */}
        <div className="ml-auto">
          <PriorityBadge priority={c.priority} />
        </div>
      </div>

      {/* Warnings */}
      {c.warnings.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
          {c.warnings.map((w, i) => (
            <span key={i} className="text-[11px] text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 px-1.5 py-0.5 rounded border border-orange-200 dark:border-orange-800">
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Strategy36hScanner() {
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyKey>("A1");
  const [data, setData] = useState<Strategy36hResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasScanned, setHasScanned] = useState(false);

  async function scan() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/strategy/scan-36h?strategy=${selectedStrategy}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Strategy36hResponse = await res.json();
      if (!json.success) throw new Error(json.error ?? "Unknown error");
      setData(json);
      setHasScanned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHasScanned(true);
    } finally {
      setLoading(false);
    }
  }

  function selectStrategy(key: StrategyKey) {
    setSelectedStrategy(key);
    setData(null);
    setHasScanned(false);
    setError("");
  }

  return (
    <div className="space-y-4">
      {/* 注意書き */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
        📊 統計は過去180日・70銘柄のバックテスト結果です。エントリー前にFR・OI・出来高を必ず確認してください。
      </div>

      {/* 戦略タブ + スキャンボタン */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex divide-x divide-gray-200 dark:divide-gray-700">
          {(["A1", "A2", "A3"] as StrategyKey[]).map(key => {
            const s = STRATEGY_STATS[key];
            const active = selectedStrategy === key;
            return (
              <button
                key={key}
                onClick={() => selectStrategy(key)}
                className={`flex-1 px-3 py-3 text-center transition-colors border-b-2 ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                    : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/40"
                }`}
              >
                <div className={`text-sm font-bold mb-1 ${active ? "text-indigo-700 dark:text-indigo-400" : "text-gray-600 dark:text-gray-400"}`}>
                  {key}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                  勝率 <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{s.winRate}%</span>
                  {" / "}
                  期待値 <span className="font-semibold text-gray-700 dark:text-gray-300">+{s.ev}%</span>
                  {" / "}
                  シャープ <span className="font-semibold text-gray-700 dark:text-gray-300">{s.sharpe}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            対象: 上場後 33–39h の銘柄
          </p>
          <button
            onClick={scan}
            disabled={loading}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                スキャン中…
              </>
            ) : "🔍 スキャン実行"}
          </button>
        </div>
      </div>

      {/* エラー */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-red-700 dark:text-red-400">❌ {error}</span>
          <button
            onClick={scan}
            className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors whitespace-nowrap"
          >
            リトライ
          </button>
        </div>
      )}

      {/* 候補リスト */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <span className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin inline-block" />
          </div>
        ) : !hasScanned ? (
          <p className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            スキャンを実行してください
          </p>
        ) : data?.candidates.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
            現在33-39h時点の候補銘柄はありません。次回スキャンは数時間後に。
          </p>
        ) : (
          <>
            <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
              {data!.candidates.length}件 ·{" "}
              スキャン {new Date(data!.scanTime).toLocaleTimeString("ja-JP")} ·{" "}
              対象 {data!.totalScanned}銘柄
            </div>
            {data!.candidates.map(c => (
              <CandidateRow key={c.symbol} c={c} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
