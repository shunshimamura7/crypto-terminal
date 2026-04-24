"use client";
import { useEffect, useState } from "react";

// ─── F&G helpers ─────────────────────────────────────────────────────────────

function getFgColor(v: number): string {
  if (v <= 25) return "text-red-600";
  if (v <= 45) return "text-orange-500";
  if (v <= 55) return "text-yellow-600";
  if (v <= 75) return "text-green-600";
  return "text-yellow-500";
}
function getFgEmoji(v: number): string {
  if (v <= 25) return "😱";
  if (v <= 45) return "😨";
  if (v <= 55) return "😐";
  if (v <= 75) return "😊";
  return "🤑";
}

// ─── BTCマクロスコア（100点満点） ───────────────────────────────────────────

function calcMacroScore(d: MarketEnvData | null): number {
  const DEF = 10; // データなし時の中立点

  // 1. US100 24h変動率
  let s1 = DEF;
  if (d?.us100Change != null) {
    const c = d.us100Change;
    s1 = c >= 1 ? 20 : c >= 0 ? 10 : c >= -1 ? 5 : 0;
  }

  // 2. DXY 24h変動率（下落 = BTC有利）
  let s2 = DEF;
  if (d?.dxyChange != null) {
    const c = d.dxyChange;
    s2 = c <= -0.5 ? 20 : c <= 0 ? 10 : c <= 0.5 ? 5 : 0;
  }

  // 3. 米10年債（絶対値）
  let s3 = DEF;
  if (d?.us10y != null) {
    const v = d.us10y;
    s3 = v <= 4 ? 20 : v <= 4.5 ? 15 : v <= 5 ? 5 : 0;
  }

  // 4. Gold 24h変動率（上昇 = リスクオフ = BTC不利）
  let s4 = DEF;
  if (d?.goldChange != null) {
    const c = d.goldChange;
    s4 = c >= 1 ? 0 : c >= 0 ? 5 : c >= -1 ? 15 : 20;
  }

  // 5. F&G（中立40〜60が最適）
  let s5 = DEF;
  if (d?.fng?.value != null) {
    const v = d.fng.value;
    s5 = v >= 75 ? 5 : v >= 60 ? 15 : v >= 40 ? 20 : v >= 25 ? 10 : 0;
  }

  return s1 + s2 + s3 + s4 + s5;
}

function macroScoreInfo(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "🟢 強気", color: "text-green-600" };
  if (score >= 60) return { label: "🟡 中立", color: "text-yellow-500" };
  if (score >= 40) return { label: "🟠 注意", color: "text-orange-500" };
  return { label: "🔴 弱気", color: "text-red-600" };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarketEnvData {
  btcPrice:     number;
  ethPrice:     number;
  fng:          { value: number; valueText: string } | null;
  btcDominance: number | null;
  us100:        number | null;
  us100Change:  number | null;
  dxy:          number | null;
  dxyChange:    number | null;
  gold:         number | null;
  goldChange:   number | null;
  us10y:        number | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MarketTicker() {
  const [d, setD] = useState<MarketEnvData | null>(null);

  useEffect(() => {
    fetch("/api/market-env")
      .then(r => r.json())
      .then((j: MarketEnvData) => setD(j))
      .catch(() => {});
  }, []);

  const fgVal   = d?.fng?.value ?? null;
  const fgLabel = d?.fng?.valueText ?? null;

  const grid = [
    {
      label: "BTC",
      value: d?.btcPrice    ? `$${Math.round(d.btcPrice).toLocaleString()}`    : "—",
      color: "text-orange-500",
    },
    {
      label: "ETH",
      value: d?.ethPrice    ? `$${Math.round(d.ethPrice).toLocaleString()}`    : "—",
      color: "text-blue-500",
    },
    {
      label: "BTC.D",
      value: d?.btcDominance != null ? `${d.btcDominance.toFixed(1)}%`         : "—",
      color: "text-yellow-600",
    },
    {
      label: "US100",
      value: d?.us100  != null ? Math.round(d.us100).toLocaleString()          : "—",
      color: "text-indigo-500",
    },
    {
      label: "DXY",
      value: d?.dxy    != null ? d.dxy.toFixed(2)                              : "—",
      color: "text-gray-600",
    },
    {
      label: "Gold",
      value: d?.gold   != null ? `$${Math.round(d.gold).toLocaleString()}`     : "—",
      color: "text-yellow-500",
    },
    {
      label: "米10年債",
      value: d?.us10y  != null ? `${d.us10y.toFixed(2)}%`                      : "—",
      color: "text-rose-500",
    },
    {
      label: "F&G",
      value: fgVal != null ? `${getFgEmoji(fgVal)} ${fgVal}`                   : "—",
      sub:   fgLabel ?? undefined,
      color: fgVal != null ? getFgColor(fgVal) : "text-gray-400",
    },
  ];

  const macroScore = calcMacroScore(d);
  const { label: macroLabel, color: macroColor } = macroScoreInfo(macroScore);

  return (
    <div className="w-full rounded-xl border border-gray-200 shadow-sm overflow-hidden bg-white">
      <div className="flex">
        {/* 8-column data grid */}
        <div className="flex-1 grid grid-cols-8 divide-x divide-gray-100">
          {grid.map(({ label, value, sub, color }) => (
            <div key={label} className="flex flex-col items-center justify-center py-4 px-2">
              <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-0.5">
                {label}
              </span>
              <span className={`text-xl font-bold leading-tight ${color}`}>{value}</span>
              {sub && (
                <span className="text-[10px] text-gray-400 truncate max-w-full leading-tight mt-0.5">{sub}</span>
              )}
            </div>
          ))}
        </div>

        {/* BTCマクロスコア */}
        <div className="shrink-0 border-l border-gray-200 flex flex-col items-center justify-center px-6 py-4 bg-gray-50 min-w-[130px]">
          <span className="text-xs text-gray-500 font-semibold mb-1">BTCマクロスコア</span>
          <span className={`text-3xl font-black leading-none ${macroColor}`}>{macroScore}</span>
          <span className="text-[10px] text-gray-400 mb-1">/ 100</span>
          <span className={`text-sm font-bold ${macroColor}`}>{macroLabel}</span>
        </div>
      </div>
    </div>
  );
}
