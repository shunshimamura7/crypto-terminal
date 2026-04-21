"use client";
import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { getAllHistory } from "@/app/lib/scoreHistory";
import type { ScoreRecord } from "@/app/lib/scoreHistory";

const RANK_ORDER = ["S", "A", "B", "C", "D", "E", "F"];
const RANK_COLORS: Record<string, string> = {
  S: "bg-yellow-400 text-black", A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",  C: "bg-gray-400 text-white",
  D: "bg-gray-700 text-white",  E: "bg-orange-500 text-white", F: "bg-red-700 text-white",
};

interface Row { ticker: string; latest: ScoreRecord; prev: ScoreRecord | null; records: ScoreRecord[]; }

function diff(curr: string, prev: string | null): "up" | "down" | "same" | null {
  if (!prev) return null;
  const ci = RANK_ORDER.indexOf(curr), pi = RANK_ORDER.indexOf(prev);
  return ci < pi ? "up" : ci > pi ? "down" : "same";
}

export default function HistoryView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const h = getAllHistory();
    const r: Row[] = h
      .filter(x => x.records.length > 0)
      .map(x => ({ ticker: x.ticker, latest: x.records[0], prev: x.records[1] ?? null, records: x.records }))
      .sort((a, b) => RANK_ORDER.indexOf(a.latest.rank) - RANK_ORDER.indexOf(b.latest.rank));
    setRows(r);
  }, []);

  function clearAll() {
    if (!confirm("分析履歴をすべて削除しますか？")) return;
    Object.keys(localStorage).filter(k => k.startsWith("score_")).forEach(k => localStorage.removeItem(k));
    setRows([]); setSelected(null);
  }

  const chartData = selected
    ? [...selected.records].reverse().map(r => ({ date: r.date.slice(5), Alpha: r.alpha, Risk: r.risk }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-indigo-600">📈 分析履歴</h2>
        {rows.length > 0 && (
          <button onClick={clearAll} className="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1">
            履歴を全削除
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl text-gray-200 mb-2">📈</div>
          <p className="text-sm text-gray-400">まだ分析履歴がありません<br />個別分析を実行すると自動保存されます</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">銘柄</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">ランク</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Alpha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Risk</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">前回比</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">最終分析日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const d = diff(row.latest.rank, row.prev?.rank ?? null);
                const rowBg = d === "up" ? "bg-green-50" : d === "down" ? "bg-red-50" : "";
                const isSelected = selected?.ticker === row.ticker;
                return (
                  <tr
                    key={i}
                    onClick={() => setSelected(isSelected ? null : row)}
                    className={`border-b border-gray-100 cursor-pointer transition-colors ${rowBg} ${isSelected ? "ring-2 ring-inset ring-indigo-300" : "hover:bg-indigo-50"}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs font-medium text-gray-800 max-w-[110px] truncate">
                      {row.ticker}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${RANK_COLORS[row.latest.rank] ?? ""}`}>
                        {row.latest.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-green-700">{row.latest.alpha}</td>
                    <td className="px-3 py-2 text-right font-bold text-red-600">{row.latest.risk}</td>
                    <td className="px-3 py-2 text-xs">
                      {d === "up"   && <span className="text-green-600 font-bold">▲{row.prev?.rank}→{row.latest.rank}</span>}
                      {d === "down" && <span className="text-red-500 font-bold">▼{row.prev?.rank}→{row.latest.rank}</span>}
                      {d === "same" && <span className="text-gray-400">変化なし</span>}
                      {!d          && <span className="text-gray-300">初回</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">{row.latest.date}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
            行をクリックするとスコア推移グラフが表示されます
          </div>
        </div>
      )}

      {/* Chart */}
      {selected && mounted && chartData.length > 1 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">
            {selected.ticker} のスコア推移（{selected.records.length}件）
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip contentStyle={{ fontSize: "12px" }} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Line type="monotone" dataKey="Alpha" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Risk" stroke="#dc2626" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
