"use client";

import React, { useState, useMemo } from "react";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import type { BacktestStats } from "@/app/lib/backtestStats";
import { calculateStats } from "@/app/lib/backtestStats";
import { analyzeBacktestRecords } from "@/app/lib/backtestAnalysis";
import type { BacktestAnalysis } from "@/app/lib/backtestAnalysis";
import { getDangerSymbols, removeFromDangerList } from "@/app/lib/symbolHealth";
import { checkDataIntegrity } from "@/app/lib/dataIntegrity";

// ── Translations ──────────────────────────────────────────────────────────────

const BT_JA = {
  btTitle: "📊 バックテスト実績",
  btTotal: "記録数", btWinRate: "勝率", btPeriod: "期間",
  btResolved: "決着", btActive: "進行中", btExpired: "期限切れ",
  btExpectancy: "期待値", btBest: "ベスト", btWorst: "ワースト",
  btAvgRR: "平均R:R",
  btByScore: "スコア帯別勝率", btScoreRange: "スコア帯", btWins: "勝", btLosses: "負",
  btEquityCurve: "📈 エクイティカーブ", btEquityR: "累積R",
  btAllRecords: "全記録",
  btEntryCol: "エントリー", btSlCol: "SL", btTp1Col: "TP1", btCurCol: "現在",
  btStatusCol: "状態", btPnlCol: "損益", btDaysCol: "日数",
  btCsvExport: "📋 CSVエクスポート", btReset: "🗑️ データリセット",
  btResetConfirm: "バックテストデータを全削除しますか？",
  btNoData: "まだデータがありません。スキャン実行でスコア8以上の銘柄が自動記録されます。",
  btTp1: "✅TP1", btTp2: "✅TP2", btTp3: "✅TP3", btSl: "❌SL",
  btActiveStatus: "⏳進行中", btExpiredStatus: "⏰期限切れ",
  tpAnalysisTitle: "📊 TP/SL 到達分析",
  tpPlacement: "TP配置（中央値）",
  tpVirtualStrategy: "💡 仮想戦略: 全TP1利確の場合",
  tpOrderInvertedLabel: "TP順序異常",
  tpExpectancyPerTrade: "期待値 / トレード",
};
const BT_EN: typeof BT_JA = {
  btTitle: "📊 Backtest Results",
  btTotal: "Records", btWinRate: "Win Rate", btPeriod: "Period",
  btResolved: "Resolved", btActive: "Active", btExpired: "Expired",
  btExpectancy: "Expectancy", btBest: "Best", btWorst: "Worst",
  btAvgRR: "Avg R:R",
  btByScore: "Win Rate by Score", btScoreRange: "Score Range", btWins: "Wins", btLosses: "Losses",
  btEquityCurve: "📈 Equity Curve", btEquityR: "Cumulative R",
  btAllRecords: "All Records",
  btEntryCol: "Entry", btSlCol: "SL", btTp1Col: "TP1", btCurCol: "Current",
  btStatusCol: "Status", btPnlCol: "PnL", btDaysCol: "Days",
  btCsvExport: "📋 Export CSV", btReset: "🗑️ Reset Data",
  btResetConfirm: "Delete all backtest data?",
  btNoData: "No data yet. Run a scan to auto-record candidates with score ≥8.",
  btTp1: "✅TP1", btTp2: "✅TP2", btTp3: "✅TP3", btSl: "❌SL",
  btActiveStatus: "⏳Active", btExpiredStatus: "⏰Expired",
  tpAnalysisTitle: "📊 TP/SL Hit Analysis",
  tpPlacement: "TP Placement (median)",
  tpVirtualStrategy: "💡 Virtual: TP1-only Strategy",
  tpOrderInvertedLabel: "TP Order Inverted",
  tpExpectancyPerTrade: "Expectancy / Trade",
};

// ── Local helpers ─────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
}

function fmtPrice(n: number): string {
  if (!n) return "—";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01)   return `$${n.toFixed(6)}`;
  if (n < 1)      return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function statusLabel(status: BacktestRecord["status"], t: typeof BT_JA): { label: string; cls: string; tip?: string } {
  switch (status) {
    case "tp3_hit":    return { label: t.btTp3,          cls: "text-green-700 bg-green-50 border-green-300" };
    case "tp2_hit":    return { label: t.btTp2,          cls: "text-green-700 bg-green-50 border-green-300" };
    case "tp1_hit":    return { label: t.btTp1,          cls: "text-green-700 bg-green-50 border-green-200" };
    case "sl_hit":     return { label: t.btSl,           cls: "text-red-700 bg-red-50 border-red-300" };
    case "expired":    return { label: t.btExpiredStatus, cls: "text-gray-500 bg-gray-100 border-gray-300" };
    case "pending_tp1":
    case "pending_tp2":
    case "pending_tp3":
    case "pending_sl": return { label: "⏳確認中（判定待ち）", tip: "価格がTP/SL付近に到達。次回スキャン後に確定予定", cls: "text-blue-600 bg-blue-50 border-blue-300" };
    default:           return { label: t.btActiveStatus,  cls: "text-yellow-700 bg-yellow-50 border-yellow-300" };
  }
}

function exportBtCSV(records: BacktestRecord[]): void {
  const hdr = [
    "Symbol","Score","ScoreMax","Version","RecordedAt","EntryPrice","SL","TP1","TP2","TP3","R:R","Trend","Status","ResolvedAt","ResolvedPrice","PnL%","MaxProfit%","MaxDrawdown%","Days","SLReason",
    "dropScore","volumeDryScore","frScore","freshnessScore","oiScore","oiChangeScore","trendScore","pumpScore","btcCorrScore","patternScore","rsiScore","exclusivityScore","frBonus","futuresHeatScore","snsHeatScore","mcFdvScore",
    "btcPrice","ethPrice","fearGreed","marketPhase","btcChange24h","categories",
    "unlockDays","unlockPercent","positiveNews","negativeNews","maxSafePosition","spread",
  ].join(",");
  const rows = records.map(r => {
    const days = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
    const pnl  = r.resolvedPrice != null ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice * 100).toFixed(2) : "";
    const bd   = r.scoreBreakdown ?? {};
    const mc   = r.marketContext;
    return [
      r.symbol.replace("_USDT",""), r.score, r.scoreMax, r.version ?? "",
      new Date(r.recordedAt).toISOString(),
      r.entryPrice, r.sl, r.tp1, r.tp2, r.tp3,
      r.rrRatio.toFixed(2), r.trendDirection, r.status,
      r.resolvedAt    ? new Date(r.resolvedAt).toISOString() : "",
      r.resolvedPrice ?? "", pnl,
      r.maxProfit?.toFixed(2) ?? "", r.maxDrawdown?.toFixed(2) ?? "", days,
      r.slReason ?? "",
      bd.dropScore ?? "", bd.volumeDryScore ?? "", bd.frScore ?? "", bd.freshnessScore ?? "",
      bd.oiScore ?? "", bd.oiChangeScore ?? "", bd.trendScore ?? "", bd.pumpScore ?? "",
      bd.btcCorrScore ?? "", bd.patternScore ?? "", bd.rsiScore ?? "",
      bd.exclusivityScore ?? "", bd.frBonus ?? "", bd.futuresHeatScore ?? "",
      bd.snsHeatScore ?? "", bd.mcFdvScore ?? "",
      mc?.btcPrice ?? "", mc?.ethPrice ?? "", mc?.fearGreed ?? "",
      mc?.marketPhase ?? "", mc?.btcChange24h?.toFixed(2) ?? "",
      (r.categories ?? []).join(";"),
      r.unlockData?.daysUntil ?? "", r.unlockData?.percent ?? "",
      r.newsContext?.positiveCount ?? "", r.newsContext?.negativeCount ?? "",
      r.liquidityInfo?.maxSafePosition?.toFixed(0) ?? "", r.liquidityInfo?.spread?.toFixed(4) ?? "",
    ].join(",");
  });
  const blob = new Blob(["﻿" + [hdr, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `mexc-backtest-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── LossAnalysisPanel ─────────────────────────────────────────────────────────

function LossAnalysisPanel({ analysis, records }: { analysis: BacktestAnalysis; records: BacktestRecord[] }) {
  const { verifiedStats, topCombos, phaseLossPatterns, timezoneWinRates } = analysis;

  const dangerList = getDangerSymbols().filter(d =>
    records.some(r => r.symbol === d.symbol)
  );

  return (
    <div className="space-y-4 text-xs">
      {/* API検証済みのみの統計 */}
      <div>
        <p className="font-semibold text-gray-600 mb-1.5">🔍 API検証済みのみの統計 ({verifiedStats.count}件)</p>
        {verifiedStats.count < 3 ? (
          <p className="text-gray-400">API検証済みレコードが3件未満のためデータ不足</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "勝率",          val: `${verifiedStats.winRate.toFixed(1)}%`,   cls: verifiedStats.winRate >= 50 ? "text-green-700" : "text-red-600" },
              { label: "Profit Factor", val: verifiedStats.profitFactor === Infinity ? "∞" : verifiedStats.profitFactor.toFixed(2), cls: verifiedStats.profitFactor >= 1 ? "text-green-700" : "text-red-600" },
              { label: "平均R:R",       val: verifiedStats.avgRR.toFixed(2),            cls: verifiedStats.avgRR >= 0 ? "text-indigo-700" : "text-red-600" },
            ].map(s => (
              <div key={s.label} className="bg-blue-50 rounded-lg p-2 border border-blue-100 text-center">
                <div className={`text-sm font-black ${s.cls}`}>{s.val}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 市場フェーズ別負けパターン */}
      <div>
        <p className="font-semibold text-gray-600 mb-1.5">📊 市場フェーズ別負けパターン</p>
        <div className="grid grid-cols-3 gap-2">
          {phaseLossPatterns.map(p => (
            <div key={p.phase} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
              <div className={`text-sm font-black ${p.wins > p.losses ? "text-green-700" : p.losses > 0 ? "text-red-600" : "text-gray-400"}`}>
                {p.wins + p.losses > 0 ? `${p.winRate.toFixed(0)}%` : "—"}
              </div>
              <div className="text-[10px] text-gray-500">{p.label}</div>
              <div className="text-[10px] text-gray-400">{p.wins}勝 {p.losses}負</div>
              {p.losses > 0 && (
                <div className="text-[10px] text-red-500">平均損失 +{p.avgLossPct.toFixed(1)}%</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 時間帯別勝率 */}
      <div>
        <p className="font-semibold text-gray-600 mb-1.5">🕐 時間帯別勝率 (エントリー時刻)</p>
        <div className="grid grid-cols-3 gap-2">
          {timezoneWinRates.map(z => (
            <div key={z.zone} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
              <div className={`text-sm font-black ${z.wins > z.losses ? "text-green-700" : z.wins + z.losses > 0 ? "text-red-600" : "text-gray-400"}`}>
                {z.wins + z.losses > 0 ? `${z.winRate.toFixed(0)}%` : "—"}
              </div>
              <div className="text-[10px] text-gray-500">{z.label}</div>
              <div className="text-[9px] text-gray-400">{z.hours}</div>
              <div className="text-[10px] text-gray-400">{z.wins}勝 {z.losses}負</div>
            </div>
          ))}
        </div>
      </div>

      {/* スコア×指標マトリクス */}
      {topCombos.length > 0 && (
        <div>
          <p className="font-semibold text-gray-600 mb-1.5">🎯 指標組み合わせ別勝率</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs min-w-[360px]">
              <thead>
                <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <th className="px-2 py-1.5 text-left">組み合わせ</th>
                  <th className="px-2 py-1.5 text-center">勝</th>
                  <th className="px-2 py-1.5 text-center">負</th>
                  <th className="px-2 py-1.5 text-right">勝率</th>
                </tr>
              </thead>
              <tbody>
                {topCombos.map(c => (
                  <tr key={c.label} className="border-b border-gray-100 last:border-0">
                    <td className="px-2 py-1.5 text-gray-700 font-mono text-[10px]">{c.label}</td>
                    <td className="px-2 py-1.5 text-center text-green-600 font-bold">{c.wins}</td>
                    <td className="px-2 py-1.5 text-center text-red-500">{c.total - c.wins}</td>
                    <td className="px-2 py-1.5 text-right font-bold">
                      <span className={c.winRate >= 50 ? "text-green-700" : "text-red-600"}>
                        {c.winRate.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 危険銘柄リスト */}
      {dangerList.length > 0 && (
        <div>
          <p className="font-semibold text-gray-600 mb-1.5">☠️ 危険銘柄リスト (SL3回以上)</p>
          <div className="overflow-x-auto rounded-lg border border-red-200">
            <table className="w-full text-xs min-w-[300px]">
              <thead>
                <tr className="bg-red-50 text-red-700 border-b border-red-200">
                  <th className="px-2 py-1.5 text-left">銘柄</th>
                  <th className="px-2 py-1.5 text-center">SL回数</th>
                  <th className="px-2 py-1.5 text-left">理由</th>
                  <th className="px-2 py-1.5 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {dangerList.map(d => (
                  <tr key={d.symbol} className="border-b border-red-100 last:border-0">
                    <td className="px-2 py-1.5 font-mono font-bold text-red-800">{d.symbol.replace("_USDT","")}</td>
                    <td className="px-2 py-1.5 text-center text-red-600 font-bold">{d.slCount}回</td>
                    <td className="px-2 py-1.5 text-gray-600 text-[10px]">{d.reason}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => removeFromDangerList(d.symbol)}
                        className="text-[9px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                        title="リストから除外"
                      >
                        解除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DataIntegritySection ──────────────────────────────────────────────────────

function DataIntegritySection({ records, lang }: { records: BacktestRecord[]; lang: "ja" | "en" }) {
  const report = useMemo(() => checkDataIntegrity(records), [records]);
  const tpOrderV1Count = report.issues.filter(i => i.category === "TP順序異常" && i.level === "warning").length;

  return (
    <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-bold flex items-center gap-2">
          🩺 データ健全性
          <span className={`text-xs px-2 py-0.5 rounded font-bold ${
            report.healthScore >= 90 ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" :
            report.healthScore >= 70 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400" :
                                       "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
          }`}>
            {report.healthScore}/100
          </span>
        </h3>
        <span className="text-xs text-gray-500">
          Storage: {(report.storageUsage.used / 1024 / 1024).toFixed(2)}MB / 5MB
          <span className={`ml-1 font-semibold ${report.storageUsage.pct > 80 ? "text-red-600" : report.storageUsage.pct > 60 ? "text-orange-500" : "text-gray-400"}`}>
            ({report.storageUsage.pct.toFixed(1)}%)
          </span>
        </span>
      </div>

      {tpOrderV1Count > 0 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">
          {lang === "ja"
            ? `※ v1.0の既知TP順序バグ ${tpOrderV1Count}件を warning 扱いにしています`
            : `※ ${tpOrderV1Count} known TP order bugs from v1.0 treated as warnings`}
        </div>
      )}
      {report.issues.length === 0 ? (
        <div className="text-xs text-green-600 font-semibold">✅ 異常なし（{report.totalChecked}件チェック済）</div>
      ) : (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-600">
            {report.issues.filter(i => i.level === "critical").length > 0 && (
              <span className="text-red-600 mr-2">🔴 critical: {report.issues.filter(i => i.level === "critical").length}件</span>
            )}
            {report.issues.filter(i => i.level === "warning").length > 0 && (
              <span className="text-yellow-600 mr-2">🟡 warning: {report.issues.filter(i => i.level === "warning").length}件</span>
            )}
            {report.issues.filter(i => i.level === "info").length > 0 && (
              <span className="text-blue-500">ℹ️ info: {report.issues.filter(i => i.level === "info").length}件</span>
            )}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-blue-600 hover:underline select-none">詳細を表示</summary>
            <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
              {report.issues.slice(0, 50).map((issue, i) => (
                <div key={i} className={`p-2 rounded text-[11px] ${
                  issue.level === "critical" ? "bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-800" :
                  issue.level === "warning"  ? "bg-yellow-50 border border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800" :
                                              "bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800"
                }`}>
                  <div className="font-semibold text-gray-700 dark:text-gray-300">[{issue.category}] {issue.symbol.replace("_USDT","")}</div>
                  <div className="text-gray-500">{issue.description}</div>
                </div>
              ))}
              {report.issues.length > 50 && (
                <div className="text-gray-500 text-center py-1">…他 {report.issues.length - 50}件</div>
              )}
            </div>
          </details>
        </div>
      )}

      {report.storageUsage.pct > 80 && (
        <div className="mt-2 text-xs text-red-600 font-bold">
          🚨 ストレージ使用量80%超 — 古いデータのリセット推奨
        </div>
      )}
    </div>
  );
}

// ── BacktestPanel (main export) ───────────────────────────────────────────────

interface BacktestPanelProps {
  records: BacktestRecord[];
  stats: BacktestStats;
  lang: "ja" | "en";
  onReset: () => void;
}

export default function BacktestPanel({ records, stats, lang, onReset }: BacktestPanelProps) {
  const t = lang === "en" ? BT_EN : BT_JA;

  function handleReset() {
    const msg1 = lang === "ja"
      ? `⚠️ バックテストデータ${records.length}件を全て削除します。\n\nこの操作は取り消せません。\n\n本当に削除しますか？`
      : `⚠️ Delete all ${records.length} backtest records.\n\nThis cannot be undone.\n\nAre you sure?`;
    if (!window.confirm(msg1)) return;
    const msg2 = lang === "ja"
      ? "最終確認: 本当に全データを削除しますか？"
      : "Final confirmation: Delete all data?";
    if (!window.confirm(msg2)) return;
    onReset();
  }

  const [open,          setOpen]          = useState(true);
  const [showRecords,   setShowRecords]   = useState(false);
  const [showActivePos, setShowActivePos] = useState(false);
  const [btPresetTab,   setBtPresetTab]   = useState<"all" | "low_lev" | "new_listing" | "v2_only">("all");
  const [btMainTab,     setBtMainTab]     = useState<"stats" | "loss">("stats");

  const analysis = useMemo(() => analyzeBacktestRecords(records), [records]);

  const v1Count    = records.filter(r => r.version !== "v2.0").length;
  const v2Count    = records.filter(r => r.version === "v2.0").length;
  const v2Resolved = records.filter(r =>
    r.version === "v2.0" && ["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit"].includes(r.status)
  ).length;

  const tabRecords = btPresetTab === "all"      ? records
    : btPresetTab === "v2_only" ? records.filter(r => r.version === "v2.0")
    : records.filter(r => r.preset === btPresetTab);

  const tabStats = useMemo(
    () => btPresetTab === "v2_only"
      ? calculateStats(records.filter(r => r.version === "v2.0"), "all")
      : calculateStats(records, btPresetTab === "all" ? "all" : btPresetTab),
    [records, btPresetTab],
  );
  const displayStats = btPresetTab === "all" ? stats : tabStats;

  const periodStr = (() => {
    if (!displayStats.periodStart) return "—";
    const s = fmtDate(displayStats.periodStart);
    const e = fmtDate(displayStats.periodEnd ?? Date.now());
    return `${s} 〜 ${e}`;
  })();

  const sorted = [...tabRecords].sort((a, b) => b.recordedAt - a.recordedAt);

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-indigo-50 transition-colors">
        <span>
          {t.btTitle}
          {records.length > 0 && (
            <span className="ml-2 text-xs font-normal text-indigo-500">
              {t.btTotal}: {records.length} / {t.btWinRate}: {stats.winRate.toFixed(0)}%
              {stats.active > 0 && <span className="ml-2 text-yellow-600">⏳{stats.active}件</span>}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* Preset tabs */}
          {records.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex gap-1">
                {([ { key: "stats", label: "📊 統計" }, { key: "loss", label: "🔍 負け分析" } ] as const).map(tab => (
                  <button key={tab.key} onClick={() => setBtMainTab(tab.key)}
                    className={`text-[10px] px-3 py-1 rounded border font-semibold transition-colors ${
                      btMainTab === tab.key
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white dark:bg-gray-800 text-gray-500 border-gray-300 hover:bg-indigo-50"
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {([
                  { key: "all",         label: "全体",        count: records.length },
                  { key: "low_lev",     label: "🐢低レバ",    count: records.filter(r => r.preset === "low_lev").length },
                  { key: "new_listing", label: "🆕新規上場",  count: records.filter(r => r.preset === "new_listing").length },
                ] as const).map(tab => (
                  <button key={tab.key} onClick={() => setBtPresetTab(tab.key)}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                      btPresetTab === tab.key
                        ? "bg-indigo-500 text-white border-indigo-500"
                        : "bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-600 hover:bg-indigo-50"
                    }`}>
                    {tab.label}
                    <span className="ml-1 opacity-60">({tab.count})</span>
                  </button>
                ))}
                <button onClick={() => setBtPresetTab("v2_only")}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    btPresetTab === "v2_only"
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-600 hover:bg-emerald-50"
                  }`}>
                  🆕 v2.0のみ
                  <span className="ml-1 opacity-60">({v2Count})</span>
                </button>
              </div>
            </div>
          )}

          {records.length === 0 ? (
            <p className="text-xs text-gray-400 py-3">{t.btNoData}</p>
          ) : tabRecords.length === 0 ? (
            <p className="text-xs text-gray-400 py-3">このプリセットの記録はまだありません</p>
          ) : btMainTab === "loss" ? (
            <LossAnalysisPanel analysis={analysis} records={tabRecords} />
          ) : (
            <>
              {/* 精度警告バナー */}
              {v1Count > 0 && v2Count < 200 && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                  <div className="text-xs font-bold text-yellow-800 dark:text-yellow-300 mb-1">
                    ⚠️ {lang === "ja" ? "精度に関する注意" : "About accuracy"}
                  </div>
                  <div className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
                    <div>
                      {lang === "ja"
                        ? `統計データにはv1.0（${v1Count}件）とv2.0（${v2Count}件）が混在しています。`
                        : `Stats include v1.0 (${v1Count} records) and v2.0 (${v2Count} records).`}
                    </div>
                    <div>
                      {lang === "ja"
                        ? `v2.0の決着済みサンプルは ${v2Resolved}件と少なく、勝率の信頼性は低めです。`
                        : `v2.0 has only ${v2Resolved} resolved samples — accuracy is uncertain.`}
                    </div>
                    <div className="font-semibold mt-1">
                      {lang === "ja"
                        ? "✅ v2.0データが200件蓄積されるまで、統計は参考値として扱ってください。"
                        : "✅ Treat stats as reference until 200+ v2.0 records are collected."}
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-500">{t.btPeriod}: <span className="font-semibold text-gray-700">{periodStr}</span></p>

              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: t.btTotal,    val: tabRecords.length,     cls: "text-gray-700" },
                  { label: t.btResolved, val: displayStats.resolved,  cls: "text-gray-700" },
                  { label: t.btActive,   val: displayStats.active,    cls: "text-yellow-600 font-bold" },
                  { label: t.btExpired,  val: displayStats.expired,   cls: "text-gray-400" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 text-center">
                    <div className={`text-base font-bold ${s.cls}`}>{s.val}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* TP/SL breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: "TP1+",      val: `${displayStats.tp1Hits + displayStats.tp2Hits + displayStats.tp3Hits}件`, cls: "text-green-700" },
                  { label: "SL",        val: `${displayStats.slHits}件`,                                                cls: "text-red-600" },
                  { label: t.btWinRate, val: `${displayStats.winRate.toFixed(1)}%`,                                     cls: displayStats.winRate >= 50 ? "text-green-700 font-bold" : "text-red-600 font-bold" },
                  { label: t.btAvgRR,   val: displayStats.avgRR.toFixed(2),                                             cls: displayStats.avgRR >= 0 ? "text-indigo-700 font-bold" : "text-red-600 font-bold" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 text-center">
                    <div className={`text-base font-bold ${s.cls}`}>{s.val}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Expectancy + Best/Worst */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                  <span className="text-gray-500">{t.btExpectancy}: </span>
                  <span className={`font-bold ${displayStats.expectancy >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {displayStats.expectancy >= 0 ? "+" : ""}{displayStats.expectancy.toFixed(2)}R
                  </span>
                </div>
                {displayStats.bestTrade && (
                  <div className="bg-green-50 rounded-lg p-2 border border-green-100">
                    <span className="text-gray-500">{t.btBest}: </span>
                    <span className="font-mono font-bold text-green-700">{displayStats.bestTrade.symbol.replace("_USDT","")}</span>
                    <span className="text-green-600 ml-1">-{displayStats.bestTrade.profit.toFixed(1)}%</span>
                  </div>
                )}
                {displayStats.worstTrade && (
                  <div className="bg-red-50 rounded-lg p-2 border border-red-100">
                    <span className="text-gray-500">{t.btWorst}: </span>
                    <span className="font-mono font-bold text-red-700">{displayStats.worstTrade.symbol.replace("_USDT","")}</span>
                    <span className="text-red-600 ml-1">+{displayStats.worstTrade.loss.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* 検証精度 */}
              {displayStats.resolved > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-xs px-1 py-1 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="text-gray-500 font-semibold">🔍 検証精度:</span>
                  <span className="text-green-700 font-semibold">✅ API検証済み <span className="font-bold">{displayStats.apiVerifiedCount}</span>件</span>
                  <span className="text-orange-600 font-semibold">⚠️ スキャンのみ <span className="font-bold">{displayStats.scanOnlyCount}</span>件</span>
                  {displayStats.pending > 0 && (
                    <span className="text-blue-600 font-semibold">⏳ 確認中 <span className="font-bold">{displayStats.pending}</span>件</span>
                  )}
                </div>
              )}

              {/* 高度パフォーマンス指標 */}
              {displayStats.resolved >= 3 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[
                    {
                      label: "Profit Factor",
                      val: displayStats.profitFactor === Infinity ? "∞" : displayStats.profitFactor.toFixed(2),
                      cls: displayStats.profitFactor >= 1.5 ? "text-green-700" : displayStats.profitFactor >= 1 ? "text-yellow-600" : "text-red-600",
                    },
                    {
                      label: "Recovery Factor",
                      val: displayStats.recoveryFactor === Infinity ? "∞" : displayStats.recoveryFactor.toFixed(2),
                      cls: displayStats.recoveryFactor >= 2 ? "text-green-700" : displayStats.recoveryFactor >= 1 ? "text-yellow-600" : "text-red-600",
                    },
                    {
                      label: "Calmar Ratio",
                      val: displayStats.calmarRatio.toFixed(2),
                      cls: displayStats.calmarRatio >= 2 ? "text-green-700" : displayStats.calmarRatio >= 1 ? "text-yellow-600" : "text-red-600",
                    },
                    { label: "平均決着日数", val: `${displayStats.avgDaysToResolve.toFixed(1)}d`, cls: "text-gray-700" },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 text-center">
                      <div className={`text-sm font-black ${s.cls}`}>{s.val}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Score range table */}
              {displayStats.resolved > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">{t.btByScore}</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                          <th className="px-3 py-1.5 text-left">{t.btScoreRange}</th>
                          <th className="px-3 py-1.5 text-center">{t.btWins}</th>
                          <th className="px-3 py-1.5 text-center">{t.btLosses}</th>
                          <th className="px-3 py-1.5 text-right">{t.btWinRate}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(displayStats.byScore).reverse().map(([range, s]) => (
                          <tr key={range} className="border-b border-gray-100 last:border-0">
                            <td className="px-3 py-1.5 font-mono text-gray-700">{range}</td>
                            <td className="px-3 py-1.5 text-center text-green-600 font-bold">{s.wins}</td>
                            <td className="px-3 py-1.5 text-center text-red-500">{s.losses}</td>
                            <td className="px-3 py-1.5 text-right font-bold">
                              <span className={s.winRate >= 50 ? "text-green-700" : s.wins + s.losses > 0 ? "text-red-600" : "text-gray-400"}>
                                {s.wins + s.losses > 0 ? `${s.winRate.toFixed(0)}%` : "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TP/SL 到達分析 */}
              {displayStats.resolved >= 3 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h3 className="text-xs font-bold text-blue-800 dark:text-blue-300 mb-2">{t.tpAnalysisTitle}</h3>
                  <div className="grid grid-cols-4 gap-1.5 text-xs mb-3">
                    {([
                      { label: "TP1", rate: displayStats.tp1HitRate, avgR: displayStats.tp1AvgR, cls: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400" },
                      { label: "TP2", rate: displayStats.tp2HitRate, avgR: displayStats.tp2AvgR, cls: "bg-green-200 dark:bg-green-800/40 text-green-700 dark:text-green-400" },
                      { label: "TP3", rate: displayStats.tp3HitRate, avgR: displayStats.tp3AvgR, cls: "bg-green-300 dark:bg-green-700/40 text-green-800 dark:text-green-300" },
                      { label: "SL",  rate: displayStats.slHitRate,  avgR: displayStats.slAvgR,  cls: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400" },
                    ]).map(({ label, rate, avgR, cls }) => (
                      <div key={label} className={`p-2 rounded text-center ${cls}`}>
                        <div className="font-black text-sm">{rate.toFixed(1)}%</div>
                        <div className="font-bold leading-tight">{label}</div>
                        <div className="text-[10px] opacity-70 mt-0.5">
                          {avgR != null ? `avg ${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R` : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-gray-600 dark:text-gray-400 border-t border-blue-200 dark:border-blue-700 pt-2 mb-2">
                    <span className="font-semibold">📍 {t.tpPlacement}: </span>
                    <span className="font-mono">
                      SL {displayStats.slMedianPct >= 0 ? "+" : ""}{displayStats.slMedianPct.toFixed(1)}% / TP1 {displayStats.tp1MedianPct.toFixed(1)}% / TP2 {displayStats.tp2MedianPct.toFixed(1)}% / TP3 {displayStats.tp3MedianPct.toFixed(1)}%
                    </span>
                  </div>
                  {displayStats.tpOrderInverted > 0 && (
                    <div className="text-[11px] text-red-600 font-bold mb-2">
                      ⚠️ {t.tpOrderInvertedLabel}: {displayStats.tpOrderInverted}件（TP1 &lt; TP2 — 旧ロジックの逆転バグ記録）
                    </div>
                  )}
                  <div className="border-t border-blue-200 dark:border-blue-700 pt-2 text-[11px] text-gray-700 dark:text-gray-300">
                    <span className="font-bold">{t.tpVirtualStrategy}: </span>
                    <span>勝率 {displayStats.tp1OnlyStrategy.winRate.toFixed(1)}% × avg +{displayStats.tp1OnlyStrategy.avgR.toFixed(2)}R =</span>
                    <span className={`font-black ml-1 ${displayStats.tp1OnlyStrategy.expectancy >= 0 ? "text-blue-700 dark:text-blue-400" : "text-red-600"}`}>
                      {t.tpExpectancyPerTrade} {displayStats.tp1OnlyStrategy.expectancy >= 0 ? "+" : ""}{displayStats.tp1OnlyStrategy.expectancy.toFixed(2)}R
                    </span>
                  </div>
                </div>
              )}

              {/* Equity Curve */}
              {displayStats.resolved >= 2 && (() => {
                const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require("recharts") as typeof import("recharts");
                const resolved = [...tabRecords]
                  .filter(r => r.status !== "active" && r.resolvedAt !== null && r.resolvedPrice !== null)
                  .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
                let cumR = 0;
                const equityData = resolved.map(r => {
                  const profit = r.entryPrice - (r.resolvedPrice ?? r.entryPrice);
                  const risk   = r.sl - r.entryPrice;
                  const realR  = risk > 0 ? profit / risk : 0;
                  cumR += realR;
                  return { name: r.symbol.replace("_USDT",""), r: parseFloat(cumR.toFixed(2)) };
                });
                return (
                  <div className="mt-1">
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">{t.btEquityCurve}</p>
                    <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={equityData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 9 }} unit="R" />
                          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                          <Tooltip formatter={(v) => [`${v}R`, t.btEquityR]} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="r" stroke={cumR >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <p className="text-[10px] text-gray-400 text-right mt-0.5">
                        {t.btEquityR}: <span className={`font-bold ${cumR >= 0 ? "text-green-600" : "text-red-600"}`}>{cumR >= 0 ? "+" : ""}{cumR.toFixed(2)}R</span>
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* 進行中ポジション */}
              {(() => {
                const activePos = records.filter(r => r.status === "active").sort((a, b) => a.recordedAt - b.recordedAt);
                if (activePos.length === 0) return null;
                const presetBadge: Record<string, string> = { low_lev: "🐢", new_listing: "🆕", high_lev: "🔥", unknown: "—" };
                return (
                  <div className="mt-2">
                    <button onClick={() => setShowActivePos(v => !v)}
                      className="flex items-center gap-1 text-xs text-yellow-700 hover:text-yellow-900 font-semibold">
                      <span>📍 進行中ポジション ({activePos.length})</span>
                      <span className="text-gray-400 ml-1">{showActivePos ? "▲" : "▼"}</span>
                    </button>
                    {showActivePos && (
                      <div className="mt-2 overflow-x-auto rounded-lg border border-yellow-200">
                        <table className="w-full text-xs min-w-[580px]">
                          <thead>
                            <tr className="bg-yellow-50 text-yellow-800 border-b border-yellow-200 font-semibold">
                              <th className="px-2 py-1.5 text-left">銘柄</th>
                              <th className="px-2 py-1.5 text-center">Score</th>
                              <th className="px-2 py-1.5 text-center">種別</th>
                              <th className="px-2 py-1.5 text-right">日数</th>
                              <th className="px-2 py-1.5 text-right">Entry</th>
                              <th className="px-2 py-1.5 text-right">SL%</th>
                              <th className="px-2 py-1.5 text-right">TP1%</th>
                              <th className="px-2 py-1.5 text-right">現在PnL</th>
                              <th className="px-2 py-1.5 text-right">MaxP</th>
                              <th className="px-2 py-1.5 text-right">MaxDD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activePos.map(r => {
                              const days   = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
                              const pnlPct = r.currentPrice != null ? ((r.entryPrice - r.currentPrice) / r.entryPrice * 100) : null;
                              const slDist = ((r.sl - r.entryPrice) / r.entryPrice * 100);
                              const tp1Dist = ((r.entryPrice - r.tp1) / r.entryPrice * 100);
                              return (
                                <tr key={r.id} className="border-b border-yellow-100 last:border-0 hover:bg-yellow-50">
                                  <td className="px-2 py-1.5 font-mono font-bold text-gray-800">{r.symbol.replace("_USDT","")}</td>
                                  <td className="px-2 py-1.5 text-center text-gray-600">{r.score}/{r.scoreMax}</td>
                                  <td className="px-2 py-1.5 text-center">{presetBadge[r.preset] ?? "—"}</td>
                                  <td className="px-2 py-1.5 text-right text-gray-500">{days}d</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-gray-700">{fmtPrice(r.entryPrice)}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-red-500">+{slDist.toFixed(1)}%</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-green-600">-{tp1Dist.toFixed(1)}%</td>
                                  <td className={`px-2 py-1.5 text-right font-mono font-bold ${pnlPct == null ? "text-gray-400" : pnlPct >= 0 ? "text-green-600" : "text-red-500"}`}>
                                    {pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-emerald-600">
                                    {r.maxProfit != null ? `+${r.maxProfit.toFixed(1)}%` : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono text-red-400">
                                    {r.maxDrawdown != null ? `${r.maxDrawdown.toFixed(1)}%` : "—"}
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
              })()}

              {/* Full records */}
              <div>
                <button onClick={() => setShowRecords(v => !v)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                  {t.btAllRecords} ({records.length}) {showRecords ? "▲" : "▼"}
                </button>
                {showRecords && (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 font-semibold">
                          <th className="px-2 py-1.5 text-left">銘柄</th>
                          <th className="px-2 py-1.5 text-center">Score</th>
                          <th className="px-2 py-1.5 text-right">日付</th>
                          <th className="px-2 py-1.5 text-right">{t.btEntryCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btSlCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btTp1Col}</th>
                          <th className="px-2 py-1.5 text-right">{t.btCurCol}</th>
                          <th className="px-2 py-1.5 text-center">{t.btStatusCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btPnlCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btDaysCol}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(r => {
                          const { label, cls, tip } = statusLabel(r.status, t);
                          const resolvedPnl = r.resolvedPrice != null
                            ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice * 100) : null;
                          const currentPnl = r.currentPrice != null
                            ? ((r.entryPrice - r.currentPrice) / r.entryPrice * 100) : null;
                          const pnl = resolvedPnl ?? currentPnl;
                          const days = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
                          return (
                            <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-2 py-1.5 font-mono font-bold text-gray-800">{r.symbol.replace("_USDT","")}</td>
                              <td className="px-2 py-1.5 text-center text-gray-600">{r.score}/{r.scoreMax}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{fmtDate(r.recordedAt)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-gray-700">{fmtPrice(r.entryPrice)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-red-500">{fmtPrice(r.sl)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-green-600">{fmtPrice(r.tp1)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-gray-600">
                                {r.currentPrice != null ? fmtPrice(r.currentPrice) : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <span title={tip} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${cls}${tip ? " cursor-help" : ""}`}>{label}</span>
                              </td>
                              <td className={`px-2 py-1.5 text-right font-mono font-bold ${pnl == null ? "text-gray-400" : pnl >= 0 ? "text-green-600" : "text-red-500"}`}>
                                {pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{days}d</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 市場フェーズ別勝率 */}
              {tabRecords.filter(r => r.marketContext).length >= 5 && (() => {
                const withCtx = tabRecords.filter(r => r.marketContext && r.status !== "active" && !r.status.startsWith("pending_") && r.status !== "expired");
                const isWin = (r: BacktestRecord) => r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit";
                const phases: Array<{ key: "risk_on" | "neutral" | "risk_off"; label: string; cls: string }> = [
                  { key: "risk_on",  label: "📈 RISK ON",  cls: "text-green-700" },
                  { key: "neutral",  label: "⚪ NEUTRAL",  cls: "text-gray-600" },
                  { key: "risk_off", label: "📉 RISK OFF", cls: "text-red-600" },
                ];
                return (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">📊 市場フェーズ別勝率</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {phases.map(({ key, label, cls }) => {
                        const recs  = withCtx.filter(r => r.marketContext?.marketPhase === key);
                        const wins  = recs.filter(isWin).length;
                        const total = recs.length;
                        return (
                          <div key={key} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
                            <div className={`font-bold text-sm ${cls}`}>{total > 0 ? `${((wins / total) * 100).toFixed(0)}%` : "—"}</div>
                            <div className="text-gray-500 text-[10px] mt-0.5">{label}</div>
                            <div className="text-gray-400 text-[10px]">{wins}勝 / {total - wins}負 / {total}件</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 勝ち vs 負けのスコア比較 */}
              {tabRecords.filter(r => r.scoreBreakdown).length >= 5 && (() => {
                const resolved = tabRecords.filter(r => r.scoreBreakdown && r.status !== "active" && !r.status.startsWith("pending_"));
                const wins   = resolved.filter(r => r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit");
                const losses = resolved.filter(r => r.status === "sl_hit");
                if (wins.length === 0 && losses.length === 0) return null;
                type BdKey = "dropScore" | "volumeDryScore" | "frScore" | "oiScore" | "mcFdvScore";
                const metrics: Array<{ key: BdKey; label: string }> = [
                  { key: "dropScore",      label: "ATH下落" },
                  { key: "volumeDryScore", label: "出来高枯渇" },
                  { key: "frScore",        label: "FR" },
                  { key: "oiScore",        label: "OI" },
                  { key: "mcFdvScore",     label: "MC/FDV" },
                ];
                const avg = (recs: BacktestRecord[], key: BdKey) => {
                  const vals = recs.map(r => (r.scoreBreakdown?.[key] ?? 0) as number);
                  return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : "—";
                };
                return (
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">⚖️ 勝ち vs 負け スコア比較</p>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                            <th className="px-2 py-1.5 text-left">指標</th>
                            <th className="px-2 py-1.5 text-center text-green-700">勝ち ({wins.length}件)</th>
                            <th className="px-2 py-1.5 text-center text-red-600">負け ({losses.length}件)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.map(({ key, label }) => {
                            const wAvg = avg(wins, key);
                            const lAvg = avg(losses, key);
                            const wNum = parseFloat(wAvg);
                            const lNum = parseFloat(lAvg);
                            const winHigher = !isNaN(wNum) && !isNaN(lNum) && wNum > lNum;
                            return (
                              <tr key={key} className="border-b border-gray-100 last:border-0">
                                <td className="px-2 py-1.5 text-gray-600">{label}</td>
                                <td className={`px-2 py-1.5 text-center font-bold ${winHigher ? "text-green-700" : "text-gray-700"}`}>{wAvg}</td>
                                <td className={`px-2 py-1.5 text-center font-bold ${!winHigher && wAvg !== "—" && lAvg !== "—" ? "text-red-600" : "text-gray-700"}`}>{lAvg}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* バージョン別件数 */}
              {tabRecords.length >= 10 && (() => {
                const v2     = tabRecords.filter(r => r.version === "v2.0").length;
                const v1     = tabRecords.filter(r => r.version === "v1.0").length;
                const legacy = tabRecords.filter(r => !r.version).length;
                return (
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="text-gray-400 font-semibold">📦 バージョン:</span>
                    {v2 > 0 && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-200">v2.0: {v2}件</span>}
                    {v1 > 0 && <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">v1.0: {v1}件</span>}
                    {legacy > 0 && <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-400 border border-gray-100">旧: {legacy}件</span>}
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button onClick={() => exportBtCSV(records)}
                  className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                  {t.btCsvExport}
                </button>
                <button onClick={handleReset}
                  className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  {t.btReset}
                </button>
              </div>

              {/* データ健全性 */}
              <DataIntegritySection records={records} lang={lang} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
