"use client";
import { useState } from "react";

export interface PortfolioResult {
  input: string;
  rank: string;
  alpha: number;
  risk: number;
  decision: string;
}

const RANK_ALLOC: Record<string, number> = { S: 15, A: 10, B: 5, C: 2, D: 0, E: 0, F: 0 };
const RANK_COLORS: Record<string, string> = {
  S: "bg-yellow-400 text-black", A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",  C: "bg-gray-400 text-white",
  D: "bg-gray-700 text-white",  E: "bg-orange-500 text-white", F: "bg-red-700 text-white",
};

function shortLabel(s: string): string {
  return s.length > 20 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

export default function PortfolioCalc({ results }: { results: PortfolioResult[] }) {
  const [totalUsd, setTotalUsd] = useState("10000");

  const active = results.filter(r => (RANK_ALLOC[r.rank] ?? 0) > 0);
  if (active.length === 0) return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-700 text-center">
      💼 ランクS/A/B/C の銘柄がないため配分計算できません
    </div>
  );

  // Split 15% evenly among S-rank items, etc.
  const rankCount: Record<string, number> = {};
  active.forEach(r => { rankCount[r.rank] = (rankCount[r.rank] || 0) + 1; });

  const raw = active.map(r => ({
    rank: r.rank,
    label: shortLabel(r.input),
    rawPct: RANK_ALLOC[r.rank] / rankCount[r.rank],
  }));

  const rawTotal = raw.reduce((s, i) => s + i.rawPct, 0);
  const factor = rawTotal > 100 ? 100 / rawTotal : 1;
  const total = parseFloat(totalUsd) || 0;

  const items = raw.map(r => ({
    ...r,
    pct: r.rawPct * factor,
    amount: total * (r.rawPct * factor) / 100,
  }));

  const allocPct = items.reduce((s, i) => s + i.pct, 0);
  const allocAmt = items.reduce((s, i) => s + i.amount, 0);

  function downloadCsv() {
    const rows = [
      "ランク,銘柄,配分%,金額(USD)",
      ...items.map(i => `${i.rank},${i.label},${i.pct.toFixed(1)},${i.amount.toFixed(2)}`),
      `,,合計 ${allocPct.toFixed(1)}%,${allocAmt.toFixed(2)}`,
      `,,未配分 ${(100 - allocPct).toFixed(1)}%,${(total - allocAmt).toFixed(2)}`,
    ].join("\n");
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "portfolio.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
        <span>💼</span>
        <h3 className="font-bold text-indigo-800 text-sm">推奨ポートフォリオ配分</h3>
        <button onClick={downloadCsv} className="ml-auto text-xs border border-indigo-200 rounded px-2 py-1 text-indigo-600 hover:bg-indigo-100">
          📥 CSV
        </button>
      </div>
      <div className="p-4">
        {/* Total input */}
        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm text-gray-600 shrink-0">総投資額 (USD):</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-700 text-sm">$</span>
            <input
              type="number" min="0"
              value={totalUsd}
              onChange={e => setTotalUsd(e.target.value)}
              className="pl-6 pr-3 py-1.5 border border-gray-200 rounded text-sm w-32 focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">ランク</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">銘柄</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">配分%</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">金額</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black ${RANK_COLORS[item.rank]}`}>
                      {item.rank}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-800">{item.label}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-700">{item.pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-800">
                    ${item.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-xs text-gray-600" colSpan={2}>合計</td>
                <td className="px-3 py-2 text-right text-sm text-gray-700">{allocPct.toFixed(1)}%</td>
                <td className="px-3 py-2 text-right text-sm text-gray-800">
                  ${allocAmt.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
              </tr>
              <tr className="bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-700" colSpan={2}>未配分（現金・安全資産）</td>
                <td className="px-3 py-2 text-right text-xs text-gray-700">{(100 - allocPct).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right text-xs text-gray-700">
                  ${(total - allocAmt).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-700 mt-2">
          ※S複数は15%を均等分割 / 合計100%超過時は比率を正規化 / D・E・Fは0%配分
        </p>
      </div>
    </div>
  );
}
