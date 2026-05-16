"use client";

import React, { useState, useMemo } from "react";
import type { HunterRecord as OldHunterRecord, HunterPattern } from "@/app/lib/types/hunter";
import { HUNTER_PATTERN_META } from "@/app/lib/types/hunter";
import type { HunterRecord } from "@/app/lib/listingHunterRecords";
import {
  getHunterStats,
  getPatternStats,
  getHourBucketStats,
  deleteHunterRecord,
  exportHunterCSV,
} from "@/app/lib/hunterStorage";

interface HunterPanelProps {
  records: HunterRecord[];
  onRecordsChange: () => void;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function statusBadge(status: HunterRecord["status"]) {
  const map: Record<string, string> = {
    open:    "bg-yellow-100 text-yellow-800",
    win:     "bg-emerald-100 text-emerald-700",
    loss:    "bg-red-100 text-red-700",
    timeout: "bg-gray-100 text-gray-500",
  };
  const label: Record<string, string> = {
    open: "OPEN", win: "WIN", loss: "LOSS", timeout: "TIMEOUT",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-500"}`}>
      {label[status] ?? status}
    </span>
  );
}

export default function HunterPanel({ records, onRecordsChange }: HunterPanelProps) {
  const [open, setOpen] = useState(true);

  const stats       = useMemo(() => getHunterStats(records), [records]);
  const patternStats = useMemo(() => getPatternStats(records), [records]);
  const hourStats   = useMemo(() => getHourBucketStats(records), [records]);
  const recent50    = useMemo(() => [...records].reverse().slice(0, 50), [records]);

  function handleDelete(id: string) {
    if (!window.confirm("このレコードを削除しますか？")) return;
    deleteHunterRecord(id);
    onRecordsChange();
  }

  function handleExport() {
    const csv = exportHunterCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `hunter_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
      >
        <span>
          🎯 22hハンター
          {records.length > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-600">
              {records.length}件 / 勝率 {stats.winRate.toFixed(0)}%
              {records.filter(r => r.status === "open").length > 0 && (
                <span className="ml-2 text-yellow-600">
                  ⏳{records.filter(r => r.status === "open").length}件
                </span>
              )}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 space-y-4">

          {/* ① 統計サマリー */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: "総記録数",  value: stats.total },
              { label: "決着数",   value: stats.resolved },
              { label: "勝率",     value: `${stats.winRate.toFixed(1)}%` },
              { label: "期待値(%)", value: stats.expectedValue.toFixed(2) },
              { label: "PF",       value: isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞" },
            ].map(item => (
              <div key={item.label} className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-center">
                <div className="text-lg font-bold text-amber-700 dark:text-amber-300">{item.value}</div>
                <div className="text-xs text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>

          {/* ② パターン別勝率テーブル */}
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">パターン別勝率</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[400px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-1 pr-2">パターン</th>
                    <th className="py-1 pr-2 text-right">件数</th>
                    <th className="py-1 pr-2 text-right">勝</th>
                    <th className="py-1 pr-2 text-right">負</th>
                    <th className="py-1 pr-2 text-right">勝率</th>
                    <th className="py-1 text-right">平均PnL%</th>
                  </tr>
                </thead>
                <tbody>
                  {patternStats.map(ps => (
                    <tr key={ps.pattern} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="py-1 pr-2 font-medium text-amber-600">
                        {ps.name}
                      </td>
                      <td className="py-1 pr-2 text-right">{ps.total}</td>
                      <td className="py-1 pr-2 text-right text-green-600">{ps.wins}</td>
                      <td className="py-1 pr-2 text-right text-red-500">{ps.losses}</td>
                      <td className="py-1 pr-2 text-right">
                        {ps.total > 0 ? `${ps.winRate.toFixed(0)}%` : "—"}
                      </td>
                      <td className="py-1 text-right">
                        {ps.total > 0 ? ps.avgRR.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ③ 経過時間別勝率 */}
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">先物上場後経過時間別勝率</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[300px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-1 pr-2">経過時間</th>
                    <th className="py-1 pr-2 text-right">件数</th>
                    <th className="py-1 text-right">勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {hourStats.map(hs => (
                    <tr key={hs.label} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="py-1 pr-2 font-medium">{hs.label}</td>
                      <td className="py-1 pr-2 text-right">{hs.total}</td>
                      <td className="py-1 text-right">
                        {hs.total > 0 ? (
                          <span className={hs.winRate >= 60 ? "text-green-600 font-medium" : hs.winRate >= 40 ? "text-yellow-600" : "text-red-500"}>
                            {hs.winRate.toFixed(0)}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ④ 記録一覧 */}
          {records.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                  記録一覧（直近{Math.min(50, records.length)}件）
                </div>
                <button
                  onClick={handleExport}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  CSVエクスポート
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-1 pr-2">銘柄</th>
                      <th className="py-1 pr-2">決着理由</th>
                      <th className="py-1 pr-2 text-right">上場後h</th>
                      <th className="py-1 pr-2">ステータス</th>
                      <th className="py-1 pr-2">決着日時</th>
                      <th className="py-1 pr-2 text-right">PnL%</th>
                      <th className="py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent50.map(r => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="py-1 pr-2 font-medium">
                          {r.symbol.replace("_USDT", "")}
                        </td>
                        <td className="py-1 pr-2 text-amber-600 font-medium">
                          {r.closeReason === "tp_hit" ? "TP到達"
                            : r.closeReason === "sl_hit" ? "SL到達"
                            : r.closeReason === "timeout" ? "タイムアウト"
                            : "—"}
                        </td>
                        <td className="py-1 pr-2 text-right">{r.hoursSinceListing.toFixed(1)}</td>
                        <td className="py-1 pr-2">{statusBadge(r.status)}</td>
                        <td className="py-1 pr-2 text-gray-400">
                          {r.closedAt ? fmtDate(r.closedAt) : "—"}
                        </td>
                        <td className="py-1 pr-2 text-right">
                          {r.finalPnlPct !== undefined ? `${r.finalPnlPct >= 0 ? "+" : ""}${r.finalPnlPct.toFixed(2)}%` : "—"}
                        </td>
                        <td className="py-1">
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {records.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm">
              まだ記録がありません。スキャン結果の🎯ボタンから記録してください。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ハンター記録モーダル ──────────────────────────────────────────────────────

interface HunterModalProps {
  symbol: string;
  matchedPatterns: HunterPattern[];
  primaryPattern: HunterPattern | null;
  currentPrice: number;
  athPrice: number;
  athDropPct: number;
  volumeRatio: number;
  frAtEntry: number;
  priceChange24h: number;
  sl: number;
  tp1: number;
  tp2: number;
  rrRatio: number;
  futuresListedAt: string;
  hoursFromFutures: number;
  onSave: (record: Omit<OldHunterRecord, "id" | "recordedAt" | "spotListedAt" | "hoursFromSpot" | "status" | "marketContext">) => void;
  onClose: () => void;
}

export function HunterModal({
  symbol, matchedPatterns, primaryPattern, currentPrice, athPrice, athDropPct,
  volumeRatio, frAtEntry, priceChange24h, sl, tp1, tp2, rrRatio,
  futuresListedAt, hoursFromFutures, onSave, onClose,
}: HunterModalProps) {
  const [selectedPattern, setSelectedPattern] = useState<HunterPattern>(
    primaryPattern ?? matchedPatterns[0] ?? "P1"
  );
  const [entryPrice, setEntryPrice] = useState(currentPrice);
  const [slPrice,    setSlPrice]    = useState(sl);
  const [tp1Price,   setTp1Price]   = useState(tp1);
  const [tp2Price,   setTp2Price]   = useState(tp2);

  const computedRR = slPrice !== entryPrice
    ? Math.abs((tp2Price - entryPrice) / (slPrice - entryPrice))
    : rrRatio;

  function handleSave() {
    onSave({
      symbol,
      futuresListedAt,
      hoursFromFutures,
      matchedPatterns,
      patternTriggered: selectedPattern,
      entryPrice,
      athPrice,
      athDropPct,
      volumeRatio,
      frAtEntry,
      priceChange24h,
      sl: slPrice,
      tp1: tp1Price,
      tp2: tp2Price,
      rrRatio: computedRR,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-white">
            🎯 {symbol.replace("_USDT", "")} ハンター記録
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        <div className="text-xs text-gray-500 space-y-0.5">
          <div>ATH比: <span className="text-red-500 font-medium">{athDropPct.toFixed(1)}%</span></div>
          <div>先物上場後: <span className="font-medium">{hoursFromFutures.toFixed(1)}h</span></div>
          <div>FR: <span className={frAtEntry > 0 ? "text-orange-500" : "text-blue-500"}>{(frAtEntry * 100).toFixed(4)}%</span></div>
        </div>

        {/* パターン選択 */}
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">マッチしたパターン</div>
          {matchedPatterns.length === 0 ? (
            <div className="text-xs text-gray-400">パターン未検出（手動記録）</div>
          ) : (
            <div className="space-y-1">
              {matchedPatterns.map(p => (
                <label key={p} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="pattern"
                    value={p}
                    checked={selectedPattern === p}
                    onChange={() => setSelectedPattern(p)}
                    className="accent-amber-500"
                  />
                  <span className="text-xs">
                    <span className="font-medium text-amber-600">{p}</span>
                    <span className="ml-1 text-gray-600">{HUNTER_PATTERN_META[p].name}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 価格入力 */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "エントリー価格", value: entryPrice, set: setEntryPrice },
            { label: "SL価格",        value: slPrice,    set: setSlPrice    },
            { label: "TP1価格",       value: tp1Price,   set: setTp1Price   },
            { label: "TP2価格",       value: tp2Price,   set: setTp2Price   },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="text-xs text-gray-500">{label}</label>
              <input
                type="number"
                step="any"
                value={value}
                onChange={e => set(parseFloat(e.target.value) || 0)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 mt-0.5 dark:bg-gray-800 dark:border-gray-700"
              />
            </div>
          ))}
        </div>

        <div className="text-xs text-gray-500">
          計算R:R <span className="font-medium text-gray-800 dark:text-white">{computedRR.toFixed(2)}</span>
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
        >
          記録する
        </button>
      </div>
    </div>
  );
}
