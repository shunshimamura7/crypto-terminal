"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { getRecords, clearRecords } from "@/app/lib/backtestStorage";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import { calculateStats } from "@/app/lib/backtestStats";
import type { StrategyTag } from "@/app/lib/strategies/types";

// -- Helpers ------------------------------------------------------------------

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtPrice(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n >= 1)    return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(8)}`;
}

// -- Equity Curve (SVG) -------------------------------------------------------

function EquityCurve({ records }: { records: BacktestRecord[] }) {
  const resolved = useMemo(
    () =>
      records
        .filter((r) => r.status !== "active" && r.resolvedAt !== null)
        .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0)),
    [records],
  );

  if (resolved.length < 2) {
    return (
      <div className="flex items-center justify-center h-28 text-gray-400 text-sm">
        決着済みトレードが 2 件以上になるとエクイティカーブが表示されます
      </div>
    );
  }

  const points: { equity: number; status: string }[] = [{ equity: 100, status: "start" }];
  let equity = 100;
  for (const r of resolved) {
    if (r.resolvedPrice && r.entryPrice) {
      const pnl = ((r.entryPrice - r.resolvedPrice) / r.entryPrice) * 100;
      equity = equity * (1 + pnl / 100);
    }
    points.push({ equity, status: r.status });
  }

  const equities = points.map((p) => p.equity);
  const minEq = Math.min(...equities);
  const maxEq = Math.max(...equities);
  const range = maxEq - minEq || 1;

  const W = 600, H = 120, PAD = 12;
  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - PAD * 2));
  const ys = points.map((p) => PAD + (1 - (p.equity - minEq) / range) * (H - PAD * 2));

  const pathD = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const bottom = (H - PAD).toFixed(1);
  const areaD = `${pathD} L ${xs[xs.length - 1].toFixed(1)} ${bottom} L ${xs[0].toFixed(1)} ${bottom} Z`;

  const finalEquity = equities[equities.length - 1];
  const isUp = finalEquity >= 100;
  const strokeColor = isUp ? "#16a34a" : "#dc2626";

  const baseY = PAD + (1 - (100 - minEq) / range) * (H - PAD * 2);

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>開始: 100</span>
        <span className={`font-semibold ${isUp ? "text-green-600" : "text-red-600"}`}>
          現在: {finalEquity.toFixed(1)} ({fmtPct(finalEquity - 100)})
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line
          x1={PAD}
          y1={baseY.toFixed(1)}
          x2={W - PAD}
          y2={baseY.toFixed(1)}
          stroke="#d1d5db"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <path d={areaD} fill="url(#eqGrad)" />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
        <circle cx={xs[xs.length - 1].toFixed(1)} cy={ys[ys.length - 1].toFixed(1)} r="3.5" fill={strokeColor} />
      </svg>
      <div className="text-xs text-gray-400 text-right mt-0.5">{resolved.length} トレード</div>
    </div>
  );
}

// -- Status Badge -------------------------------------------------------------

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active:  { label: "進行中", cls: "bg-blue-100 text-blue-700" },
  tp1_hit: { label: "TP1 ✓",  cls: "bg-green-100 text-green-700" },
  tp2_hit: { label: "TP2 ✓",  cls: "bg-emerald-100 text-emerald-700" },
  tp3_hit: { label: "TP3 ✓",  cls: "bg-teal-100 text-teal-700" },
  sl_hit:  { label: "SL ✗",   cls: "bg-red-100 text-red-700" },
  expired: { label: "期限切", cls: "bg-gray-100 text-gray-500" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_LABELS[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

// -- Strategy Badge -----------------------------------------------------------

const STRATEGY_META: Record<string, { icon: string; name: string; color: string }> = {
  A_PUMP_EXHAUSTION: { icon: "🔴", name: "A: ポンプ疲弊", color: "bg-red-50 text-red-700 border-red-200" },
  B_CASCADE_SETUP:   { icon: "🟠", name: "B: カスケード",  color: "bg-orange-50 text-orange-700 border-orange-200" },
  C_STALE_DRIFT:     { icon: "🔵", name: "C: ステイル",    color: "bg-blue-50 text-blue-700 border-blue-200" },
  NONE:              { icon: "⚪", name: "未分類",          color: "bg-gray-50 text-gray-500 border-gray-200" },
};

function StrategyBadge({ tag }: { tag?: StrategyTag }) {
  const meta = (tag && STRATEGY_META[tag]) ? STRATEGY_META[tag] : STRATEGY_META.NONE;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium ${meta.color}`}>
      {meta.icon} {meta.name}
    </span>
  );
}

// -- Export helpers -----------------------------------------------------------

function exportJson(records: BacktestRecord[]) {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bell-backtest-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(records: BacktestRecord[]) {
  const headers = [
    "id", "symbol", "score", "scoreMax", "recordedAt", "entryPrice",
    "sl", "tp1", "tp2", "tp3", "rrRatio", "trendDirection", "status",
    "resolvedAt", "resolvedPrice", "maxDrawdown", "maxProfit",
    "strategyTag", "confidence", "dangerLevel",
    "btcChange24hAtEntry", "fearGreedAtEntry", "avgFundingRateAtEntry",
    "snap_athDropPct", "snap_volumeChangeRatio", "snap_fundingRate", "snap_oiRatio",
    "snap_listedDaysAgo", "snap_priceChange7d", "snap_priceChange24h",
    "snap_btcCorrelation", "snap_chartPatternType", "snap_trendAlignment", "snap_exclusivityScore",
  ];
  const rows = records.map((r) => [
    r.id, r.symbol, r.score, r.scoreMax,
    r.recordedAt ? new Date(r.recordedAt).toISOString() : "",
    r.entryPrice, r.sl, r.tp1, r.tp2, r.tp3, r.rrRatio,
    r.trendDirection, r.status,
    r.resolvedAt ? new Date(r.resolvedAt).toISOString() : "",
    r.resolvedPrice ?? "", r.maxDrawdown ?? "", r.maxProfit ?? "",
    r.strategyTag ?? "", r.confidence ?? "", r.dangerLevel ?? "",
    r.btcChange24hAtEntry ?? "", r.fearGreedAtEntry ?? "", r.avgFundingRateAtEntry ?? "",
    r.candidateSnapshot?.athDropPct ?? "",
    r.candidateSnapshot?.volumeChangeRatio ?? "",
    r.candidateSnapshot?.fundingRate ?? "",
    r.candidateSnapshot?.oiRatio ?? "",
    r.candidateSnapshot?.listedDaysAgo ?? "",
    r.candidateSnapshot?.priceChange7d ?? "",
    r.candidateSnapshot?.priceChange24h ?? "",
    r.candidateSnapshot?.btcCorrelation ?? "",
    r.candidateSnapshot?.chartPatternType ?? "",
    r.candidateSnapshot?.trendAlignment ?? "",
    r.candidateSnapshot?.exclusivityScore ?? "",
  ]);
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bell-backtest-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// -- Main Page ----------------------------------------------------------------

type PeriodOption  = null | 7 | 14 | 30;
type StatusOption  = "all" | "active" | "resolved";
type ScoreOption   = "all" | "8-10" | "11-13" | "14+";

export default function LabPage() {
  const [records, setRecords]         = useState<BacktestRecord[]>([]);
  const [periodDays, setPeriodDays]   = useState<PeriodOption>(null);
  const [statusFilter, setStatusFilter] = useState<StatusOption>("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreOption>("all");
  const [showHistory, setShowHistory] = useState(false);
  const [resetStep, setResetStep]     = useState<0 | 1>(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadRecords = useCallback(() => {
    setRecords(getRecords());
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    loadRecords();
    const id = setInterval(loadRecords, 5000);
    return () => clearInterval(id);
  }, [loadRecords]);

  const periodFiltered = useMemo(() => {
    if (!periodDays) return records;
    const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    return records.filter((r) => r.recordedAt >= cutoff);
  }, [records, periodDays]);

  const filtered = useMemo(() => {
    let r = periodFiltered;
    if (statusFilter === "active")   r = r.filter((x) => x.status === "active");
    if (statusFilter === "resolved") r = r.filter((x) => x.status !== "active");
    if (scoreFilter === "8-10")  r = r.filter((x) => x.score >= 8  && x.score <= 10);
    if (scoreFilter === "11-13") r = r.filter((x) => x.score >= 11 && x.score <= 13);
    if (scoreFilter === "14+")   r = r.filter((x) => x.score >= 14);
    return r;
  }, [periodFiltered, statusFilter, scoreFilter]);

  const stats = useMemo(() => calculateStats(filtered), [filtered]);

  const activeRecords = useMemo(
    () =>
      filtered
        .filter((r) => r.status === "active")
        .sort((a, b) => {
          const pA = a.currentPrice && a.entryPrice ? ((a.entryPrice - a.currentPrice) / a.entryPrice) * 100 : 0;
          const pB = b.currentPrice && b.entryPrice ? ((b.entryPrice - b.currentPrice) / b.entryPrice) * 100 : 0;
          return pB - pA;
        }),
    [filtered],
  );

  const resolvedRecords = useMemo(
    () =>
      filtered
        .filter((r) => r.status !== "active")
        .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    [filtered],
  );

  const strategyBreakdown = useMemo(() => {
    const keys: Array<StrategyTag | "NONE"> = [
      "A_PUMP_EXHAUSTION", "B_CASCADE_SETUP", "C_STALE_DRIFT", "NONE",
    ];
    return keys.map((tag) => {
      const inTag   = filtered.filter((r) => (r.strategyTag ?? "NONE") === tag);
      const settled = inTag.filter((r) => r.status !== "active");
      const wins    = settled.filter((r) => ["tp1_hit", "tp2_hit", "tp3_hit"].includes(r.status));
      return {
        tag,
        total:   inTag.length,
        active:  inTag.filter((r) => r.status === "active").length,
        settled: settled.length,
        wins:    wins.length,
        winRate: settled.length > 0 ? (wins.length / settled.length) * 100 : null,
      };
    });
  }, [filtered]);

  const handleReset = () => {
    if (resetStep === 0) {
      setResetStep(1);
    } else {
      clearRecords();
      loadRecords();
      setResetStep(0);
    }
  };

  const winRateColor = (wr: number | null): string => {
    if (wr === null) return "#9ca3af";
    if (wr >= 60) return "#16a34a";
    if (wr >= 40) return "#d97706";
    return "#dc2626";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Nav */}
        <nav className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/" className="hover:text-gray-800 transition-colors">🏠 ホーム</Link>
          <span className="text-gray-300">/</span>
          <Link href="/short-scan" className="hover:text-gray-800 transition-colors">🎯 スキャナー</Link>
          <span className="text-gray-300">/</span>
          <span className="text-indigo-600 font-semibold">📊 Lab</span>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">BELL Lab</h1>
            <p className="text-sm text-gray-500 mt-0.5">ショートシグナル 自動バックテスト結果</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">
              {lastUpdated
                ? `更新: ${lastUpdated.toLocaleTimeString("ja-JP")}`
                : "読込中..."}
            </span>
            <button
              onClick={() => exportJson(filtered)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ⬇ JSON
            </button>
            <button
              onClick={() => exportCsv(filtered)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ⬇ CSV
            </button>
            <button
              onClick={handleReset}
              onBlur={() => setTimeout(() => setResetStep(0), 1500)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                resetStep === 1
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {resetStep === 1 ? "⚠️ 本当にリセット?" : "🗑 リセット"}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 shrink-0">期間:</span>
            {([null, 7, 14, 30] as PeriodOption[]).map((d) => (
              <button
                key={String(d)}
                onClick={() => setPeriodDays(d)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  periodDays === d
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {d === null ? "全期間" : `${d}日`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 shrink-0">状態:</span>
            {(["all", "active", "resolved"] as StatusOption[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s === "all" ? "全て" : s === "active" ? "進行中" : "決着済"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 shrink-0">スコア:</span>
            {(["all", "8-10", "11-13", "14+"] as ScoreOption[]).map((s) => (
              <button
                key={s}
                onClick={() => setScoreFilter(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  scoreFilter === s
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s === "all" ? "全て" : s}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-gray-400 shrink-0">{filtered.length} 件表示中</span>
        </div>

        {/* Summary cards — row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "総記録",
              value: stats.totalRecords.toString(),
              sub: `進行中: ${stats.active} 件`,
            },
            {
              label: "勝率",
              value: stats.resolved > 0 ? `${stats.winRate.toFixed(1)}%` : "—",
              sub: `${stats.resolved} 件決着`,
              valueColor: stats.resolved > 0 ? winRateColor(stats.winRate) : undefined,
            },
            {
              label: "平均 RR",
              value: stats.resolved > 0 ? stats.avgRR.toFixed(2) : "—",
              sub: `期待値: ${stats.resolved > 0 ? stats.expectancy.toFixed(2) : "—"} R`,
            },
            {
              label: "TP 内訳",
              value: `${stats.tp1Hits} / ${stats.tp2Hits} / ${stats.tp3Hits}`,
              sub: "TP1 / TP2 / TP3",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs text-gray-500">{card.label}</p>
              <p
                className="text-xl font-bold mt-1"
                style={{ color: card.valueColor ?? "#111827" }}
              >
                {card.value}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Summary cards — row 2 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "SL 被弾",
              value: stats.slHits.toString(),
              sub: `期限切: ${stats.expired} 件`,
            },
            {
              label: "ベストトレード",
              value: stats.bestTrade ? `+${stats.bestTrade.profit.toFixed(1)}%` : "—",
              sub: stats.bestTrade?.symbol ?? "",
              valueColor: "#16a34a",
            },
            {
              label: "最悪トレード",
              value: stats.worstTrade ? `-${stats.worstTrade.loss.toFixed(1)}%` : "—",
              sub: stats.worstTrade?.symbol ?? "",
              valueColor: "#dc2626",
            },
            {
              label: "記録期間",
              value: stats.periodStart
                ? `${Math.ceil((Date.now() - stats.periodStart) / 86400000)} 日`
                : "—",
              sub: stats.periodStart
                ? `${new Date(stats.periodStart).toLocaleDateString("ja-JP")}〜`
                : "",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs text-gray-500">{card.label}</p>
              <p
                className="text-xl font-bold mt-1"
                style={{ color: card.valueColor && (card.value !== "—") ? card.valueColor : "#111827" }}
              >
                {card.value}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* FR note */}
        <p className="text-xs text-gray-400 -mt-3">
          ※ FR目安は 0.02%/8h で概算。実際のFRは銘柄ごとに異なります
        </p>

        {/* Equity Curve */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">📈 エクイティカーブ</h2>
          <EquityCurve records={filtered} />
        </div>

        {/* Score Range Table */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">🎯 スコア帯別パフォーマンス</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left py-2 font-medium">スコア帯</th>
                <th className="text-right py-2 font-medium">決着数</th>
                <th className="text-right py-2 font-medium">勝ち</th>
                <th className="text-right py-2 font-medium">負け</th>
                <th className="text-right py-2 font-medium">勝率</th>
                <th className="py-2 pl-3 w-28">勝率バー</th>
              </tr>
            </thead>
            <tbody>
              {(["22-23", "20-21", "18-19", "16-17", "14-15", "12-13", "10-11", "8-9"] as const).map((range) => {
                const s     = stats.byScore[range] ?? { wins: 0, losses: 0, winRate: 0 };
                const total = s.wins + s.losses;
                const wr    = s.winRate;
                return (
                  <tr key={range} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 font-semibold text-gray-800">{range}</td>
                    <td className="py-2.5 text-right text-gray-600">{total}</td>
                    <td className="py-2.5 text-right text-green-600 font-medium">{s.wins}</td>
                    <td className="py-2.5 text-right text-red-600 font-medium">{s.losses}</td>
                    <td
                      className="py-2.5 text-right font-semibold"
                      style={{ color: total > 0 ? winRateColor(wr) : "#9ca3af" }}
                    >
                      {total > 0 ? `${wr.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2.5 pl-3">
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${wr}%`, backgroundColor: winRateColor(wr) }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Strategy Cards */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">🧠 戦略別パフォーマンス</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {strategyBreakdown.map(({ tag, total, active, settled, wins, winRate }) => {
              const meta = STRATEGY_META[tag] ?? STRATEGY_META.NONE;
              return (
                <div
                  key={tag}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-base leading-none">{meta.icon}</span>
                    <span className="text-xs font-semibold text-gray-700">{meta.name}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-gray-500">
                      <span>総記録</span>
                      <strong className="text-gray-800">{total}</strong>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>進行中</span>
                      <strong className="text-blue-600">{active}</strong>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>決着済 (勝)</span>
                      <strong className="text-gray-800">{settled} ({wins})</strong>
                    </div>
                    <div className="flex justify-between text-gray-500 border-t border-gray-100 pt-1.5 mt-1">
                      <span>勝率</span>
                      <strong style={{ color: winRateColor(winRate) }}>
                        {winRate !== null ? `${winRate.toFixed(1)}%` : "—"}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Positions */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            🔵 進行中のポジション
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-bold">
              {activeRecords.length}
            </span>
          </h2>
          {activeRecords.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">進行中のポジションはありません</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left py-2 font-medium pl-1">銘柄</th>
                    <th className="text-right py-2 font-medium">スコア</th>
                    <th className="text-right py-2 font-medium">エントリー</th>
                    <th className="text-right py-2 font-medium">現在値</th>
                    <th className="text-right py-2 font-medium">PnL%</th>
                    <th className="text-left py-2 font-medium pl-3">戦略</th>
                    <th className="text-right py-2 font-medium">記録日時</th>
                    <th className="text-right py-2 font-medium">FR目安</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRecords.map((r) => {
                    const pnl =
                      r.currentPrice && r.entryPrice
                        ? ((r.entryPrice - r.currentPrice) / r.entryPrice) * 100
                        : null;
                    const heldHours = (Date.now() - r.recordedAt) / (1000 * 60 * 60);
                    const frCount   = Math.floor(heldHours / 8);
                    const frCost    = frCount * 0.02;
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-2.5 font-semibold text-gray-800 pl-1">{r.symbol}</td>
                        <td className="py-2.5 text-right text-indigo-600 font-bold">{r.score}</td>
                        <td className="py-2.5 text-right text-gray-500 font-mono text-xs">
                          {fmtPrice(r.entryPrice)}
                        </td>
                        <td className="py-2.5 text-right text-gray-500 font-mono text-xs">
                          {r.currentPrice ? fmtPrice(r.currentPrice) : "—"}
                        </td>
                        <td
                          className="py-2.5 text-right font-semibold text-xs"
                          style={{
                            color:
                              pnl !== null
                                ? pnl > 0
                                  ? "#16a34a"
                                  : "#dc2626"
                                : "#9ca3af",
                          }}
                        >
                          {pnl !== null ? fmtPct(pnl) : "—"}
                        </td>
                        <td className="py-2.5 pl-3">
                          <StrategyBadge tag={r.strategyTag} />
                        </td>
                        <td className="py-2.5 text-right text-xs text-gray-400">
                          {fmtDate(r.recordedAt)}
                        </td>
                        <td className="py-2.5 text-right text-xs font-medium text-red-500">
                          {frCost > 0 ? `-${frCost.toFixed(2)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Resolved History (collapsed by default) */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <button
            onClick={() => setShowHistory((h) => !h)}
            className="flex items-center gap-2 w-full text-left"
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              📋 決着済み履歴
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-bold">
                {resolvedRecords.length}
              </span>
            </span>
            <span className="ml-auto text-gray-400 text-xs">{showHistory ? "▲ 閉じる" : "▼ 展開"}</span>
          </button>

          {showHistory && (
            <div className="mt-3 overflow-x-auto -mx-1">
              {resolvedRecords.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">決着済みの記録はありません</p>
              ) : (
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left py-2 font-medium pl-1">銘柄</th>
                      <th className="text-right py-2 font-medium">スコア</th>
                      <th className="text-center py-2 font-medium">結果</th>
                      <th className="text-right py-2 font-medium">エントリー</th>
                      <th className="text-right py-2 font-medium">決着値</th>
                      <th className="text-right py-2 font-medium">PnL%</th>
                      <th className="text-left py-2 font-medium pl-3">戦略</th>
                      <th className="text-right py-2 font-medium">決着日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedRecords.map((r) => {
                      const pnl =
                        r.resolvedPrice && r.entryPrice
                          ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice) * 100
                          : null;
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                        >
                          <td className="py-2 font-semibold text-gray-800 pl-1">{r.symbol}</td>
                          <td className="py-2 text-right text-indigo-600 font-bold">{r.score}</td>
                          <td className="py-2 text-center">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="py-2 text-right text-gray-500 font-mono text-xs">
                            {fmtPrice(r.entryPrice)}
                          </td>
                          <td className="py-2 text-right text-gray-500 font-mono text-xs">
                            {r.resolvedPrice ? fmtPrice(r.resolvedPrice) : "—"}
                          </td>
                          <td
                            className="py-2 text-right font-semibold text-xs"
                            style={{
                              color:
                                pnl !== null
                                  ? pnl > 0
                                    ? "#16a34a"
                                    : "#dc2626"
                                  : "#9ca3af",
                            }}
                          >
                            {pnl !== null ? fmtPct(pnl) : "—"}
                          </td>
                          <td className="py-2 pl-3">
                            <StrategyBadge tag={r.strategyTag} />
                          </td>
                          <td className="py-2 text-right text-xs text-gray-400">
                            {r.resolvedAt ? fmtDate(r.resolvedAt) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 pb-4">
          BELL Lab — データはブラウザのローカルストレージに保存されています
        </p>
      </div>
    </div>
  );
}
