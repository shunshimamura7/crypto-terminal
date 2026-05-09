"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from "recharts";
import {
  getHunterRecords,
  getOpenRecords,
  updateHunterRecord,
  type HunterRecord,
  type HunterRecordStatus,
  MAX_PRICE_HISTORY,
} from "@/app/lib/listingHunterRecords";
import type { CheckResponse } from "@/app/api/listing-hunter/check-records/route";

const BACKTEST_WIN_RATE = 69.6;

function fmtPnl(pct: number | undefined): string {
  if (pct === undefined) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function fmtElapsed(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  const h = ms / 3_600_000;
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
}

function StatusBadge({ status }: { status: HunterRecordStatus }) {
  const styles: Record<HunterRecordStatus, string> = {
    open:    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    win:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    loss:    "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    timeout: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  const labels: Record<HunterRecordStatus, string> = {
    open:    "OPEN",
    win:     "WIN",
    loss:    "LOSS",
    timeout: "TIMEOUT",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function PnlCell({ pct, status }: { pct: number | undefined; status: HunterRecordStatus }) {
  const val = pct ?? 0;
  const color =
    status === "win" ? "text-emerald-600 dark:text-emerald-400" :
    status === "loss" ? "text-red-600 dark:text-red-400" :
    val >= 0 ? "text-emerald-600 dark:text-emerald-400" :
    "text-red-600 dark:text-red-400";
  return <span className={`font-bold text-sm ${color}`}>{fmtPnl(pct)}</span>;
}

function MiniChart({ history }: { history: HunterRecord["priceHistory"] }) {
  if (history.length < 2) {
    return (
      <div className="h-16 flex items-center justify-center text-xs text-gray-400">
        データ不足
      </div>
    );
  }
  return (
    <div className="h-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="pnlPct"
            dot={false}
            stroke="#6366f1"
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "PnL"]}
            labelFormatter={() => ""}
            contentStyle={{ fontSize: "11px" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecordRow({ record }: { record: HunterRecord }) {
  const [expanded, setExpanded] = useState(false);
  const baseCoin = record.symbol.replace(/_USDT$/, "");
  const currentPnl = record.status === "open" && record.priceHistory.length > 0
    ? record.priceHistory[record.priceHistory.length - 1].pnlPct
    : record.finalPnlPct;

  return (
    <>
      <tr
        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-3 py-2 text-sm font-bold text-gray-900 dark:text-gray-100">
          {baseCoin}
          <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">
            {new Date(record.entryAt).toLocaleDateString("ja-JP")}
          </div>
        </td>
        <td className="px-3 py-2">
          <StatusBadge status={record.status} />
        </td>
        <td className="px-3 py-2">
          <PnlCell pct={currentPnl} status={record.status} />
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          {fmtElapsed(record.entryAt)}
        </td>
        <td className="px-3 py-2 text-xs text-gray-400">
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-3 pb-3 bg-gray-50 dark:bg-gray-800/30">
            <div className="pt-2 space-y-2">
              {/* 極値 */}
              <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400">
                <span>
                  最大利益:{" "}
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {record.maxDrawdownPct !== undefined ? `+${record.maxDrawdownPct.toFixed(2)}%` : "—"}
                  </span>
                </span>
                <span>
                  最大不利:{" "}
                  <span className="text-red-600 dark:text-red-400 font-semibold">
                    {record.maxAdversePct !== undefined ? `${record.maxAdversePct.toFixed(2)}%` : "—"}
                  </span>
                </span>
                <span>
                  エントリー: ${record.entryPrice.toPrecision(5)}
                </span>
                {record.closeReason && (
                  <span>
                    決着:{" "}
                    {record.closeReason === "tp_hit" ? "TP到達" :
                     record.closeReason === "sl_hit" ? "SL到達" : "タイムアウト"}
                  </span>
                )}
              </div>
              {/* ミニチャート */}
              <MiniChart history={record.priceHistory} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function exportCsv(records: HunterRecord[]): void {
  const header = [
    "id", "symbol", "status", "entryAt", "entryPrice", "tpPrice", "slPrice",
    "deadline", "closedAt", "closeReason", "finalPnlPct",
    "maxDrawdownPct", "maxAdversePct", "hoursSinceListing", "recordedManually",
  ].join(",");
  const rows = records.map(r =>
    [
      r.id, r.symbol, r.status, r.entryAt, r.entryPrice, r.tpPrice, r.slPrice,
      r.deadline, r.closedAt ?? "", r.closeReason ?? "", r.finalPnlPct ?? "",
      r.maxDrawdownPct ?? "", r.maxAdversePct ?? "", r.hoursSinceListing, r.recordedManually,
    ].join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hunter22h-records-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HunterRecords() {
  const [records, setRecords] = useState<HunterRecord[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [lastChecked, setLastChecked] = useState("");

  const loadRecords = useCallback(() => {
    setRecords(getHunterRecords());
  }, []);

  const checkOpenRecords = useCallback(async () => {
    const open = getOpenRecords();
    if (open.length === 0) {
      loadRecords();
      return;
    }

    setChecking(true);
    setCheckError("");
    try {
      const res = await fetch("/api/listing-hunter/check-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: open }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CheckResponse = await res.json();

      const now = new Date().toISOString();
      for (const result of data.results) {
        const record = open.find(r => r.id === result.id);
        if (!record) continue;

        const newHistory = [
          ...record.priceHistory,
          { checkedAt: now, price: result.currentPrice, pnlPct: result.currentPnlPct },
        ].slice(-MAX_PRICE_HISTORY);

        const updates: Partial<HunterRecord> = {
          priceHistory: newHistory,
          maxDrawdownPct: result.maxFavorable.pnlPct,
          maxAdversePct: result.maxAdverse.pnlPct,
        };

        if (result.suggestedStatus !== "open") {
          updates.status = result.suggestedStatus;
          updates.finalPnlPct = result.suggestedFinalPnl;
          updates.closedAt = result.firstHitAt ?? now;
          updates.closeReason =
            result.firstHit === "tp" ? "tp_hit" :
            result.firstHit === "sl" ? "sl_hit" : "timeout";
        }

        updateHunterRecord(result.id, updates);
      }

      setLastChecked(now);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
      loadRecords();
    }
  }, [loadRecords]);

  // ページ訪問時に決着チェックを実行
  useEffect(() => {
    loadRecords();
    checkOpenRecords();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ListingHunterが記録を更新したときのstorage eventで再読み込み
  useEffect(() => {
    const handler = () => loadRecords();
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [loadRecords]);

  if (records.length === 0 && !checking) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/30 p-6 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">📋 22hハンター実運用記録</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          各銘柄カードの「📝 記録」ボタンを押してトレードを記録すると、決着まで自動追跡します。
        </p>
      </div>
    );
  }

  // サマリー計算
  const wins    = records.filter(r => r.status === "win").length;
  const losses  = records.filter(r => r.status === "loss").length;
  const timeouts = records.filter(r => r.status === "timeout").length;
  const open    = records.filter(r => r.status === "open").length;
  const closed  = wins + losses + timeouts;
  const winRate = closed > 0 ? (wins / closed * 100) : null;
  const closedPnls = records
    .filter(r => r.finalPnlPct !== undefined)
    .map(r => r.finalPnlPct!);
  const avgPnl = closedPnls.length > 0
    ? closedPnls.reduce((a, b) => a + b, 0) / closedPnls.length
    : null;
  const winRateDiff = winRate !== null ? winRate - BACKTEST_WIN_RATE : null;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 overflow-hidden">
      {/* ヘッダー */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base font-black text-gray-900 dark:text-gray-50">
            📋 22hハンター実運用記録
          </h3>
          <div className="flex items-center gap-2">
            {lastChecked && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                最終チェック: {new Date(lastChecked).toLocaleTimeString("ja-JP")}
              </span>
            )}
            <button
              onClick={checkOpenRecords}
              disabled={checking}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-50 transition-colors"
            >
              {checking ? "⏳ チェック中…" : "🔍 決着チェック更新"}
            </button>
            <button
              onClick={() => exportCsv(records)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              📥 CSV
            </button>
          </div>
        </div>

        {/* サマリー */}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
            <div className="text-gray-500 dark:text-gray-400">実勝率</div>
            <div className="font-bold text-lg text-gray-900 dark:text-gray-100">
              {winRate !== null ? `${winRate.toFixed(1)}%` : "—"}
            </div>
            <div className="text-gray-400 text-[10px]">{wins}勝/{losses}敗/{timeouts}TO ({open}open)</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
            <div className="text-gray-500 dark:text-gray-400">実期待値</div>
            <div className={`font-bold text-lg ${avgPnl !== null && avgPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {avgPnl !== null ? fmtPnl(avgPnl) : "—"}
            </div>
            <div className="text-gray-400 text-[10px]">/ トレード</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
            <div className="text-gray-500 dark:text-gray-400">バックテスト勝率</div>
            <div className="font-bold text-lg text-gray-700 dark:text-gray-300">{BACKTEST_WIN_RATE}%</div>
            <div className="text-gray-400 text-[10px]">S01-listing+22h</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
            <div className="text-gray-500 dark:text-gray-400">乖離</div>
            <div className={`font-bold text-lg ${
              winRateDiff === null ? "text-gray-400" :
              winRateDiff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}>
              {winRateDiff !== null ? `${winRateDiff >= 0 ? "+" : ""}${winRateDiff.toFixed(1)}%` : "—"}
            </div>
            <div className="text-gray-400 text-[10px]">実勝率 - バックテスト</div>
          </div>
        </div>
      </div>

      {checkError && (
        <div className="px-5 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800">
          ❌ チェックエラー: {checkError}
        </div>
      )}

      {/* テーブル */}
      {records.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <th className="px-3 py-2 font-semibold">銘柄</th>
                <th className="px-3 py-2 font-semibold">状態</th>
                <th className="px-3 py-2 font-semibold">PnL</th>
                <th className="px-3 py-2 font-semibold">経過</th>
                <th className="px-3 py-2 font-semibold">推移</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {records.slice().reverse().map(r => (
                <RecordRow key={r.id} record={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
