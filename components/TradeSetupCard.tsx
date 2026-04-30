"use client";

import React from "react";
import type { TradeSetup, ATRData } from "@/app/lib/shortScorer";

const TS_JA = {
  tradeSetup: "⚔️ トレードセットアップ",
  rrWarning:  "⚠️ R:R不足 (TP2)",
  sl:  "損切り (SL)",
  tp1: "利確1 (TP1)",
  tp2: "利確2 (TP2)",
  tp3: "利確3 (TP3)",
};
const TS_EN: typeof TS_JA = {
  tradeSetup: "⚔️ Trade Setup",
  rrWarning:  "⚠️ R:R < 1.5 (TP2)",
  sl:  "Stop Loss",
  tp1: "Take Profit 1",
  tp2: "Take Profit 2",
  tp3: "Take Profit 3",
};

function fmtPrice(n: number): string {
  if (!n) return "—";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01)   return `$${n.toFixed(6)}`;
  if (n < 1)      return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

interface TradeSetupCardProps {
  setup: TradeSetup;
  currentPrice: number;
  atrData?: ATRData | null;
  volume24h: number;
  openInterest: number;
  lang: "ja" | "en";
}

export default function TradeSetupCard({ setup: ts, currentPrice, atrData, volume24h, openInterest, lang }: TradeSetupCardProps) {
  const t = lang === "en" ? TS_EN : TS_JA;

  return (
    <div className="mt-2 pt-2 border-t border-gray-200">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-gray-700">{t.tradeSetup}</p>
        {ts.rrWarning
          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 border border-yellow-300 font-bold">{t.rrWarning} {ts.rrTp2.toFixed(2)}</span>
          : <span className="text-[10px] text-green-600 font-semibold">R:R TP2 {ts.rrTp2.toFixed(2)}</span>
        }
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {/* SL */}
        <div className="rounded-lg p-2 border bg-red-50 border-red-200">
          <div className="font-semibold mb-0.5 text-red-700">{t.sl}</div>
          <div className="font-mono font-bold text-red-700">{fmtPrice(ts.sl)}</div>
          <div className="text-gray-400 text-[10px]">+{((ts.sl / currentPrice - 1) * 100).toFixed(1)}%</div>
        </div>
        {/* TP1 */}
        <div className="rounded-lg p-2 border bg-green-50 border-green-200">
          <div className="font-semibold mb-0.5 text-green-700">{t.tp1}</div>
          <div className="font-mono font-bold text-green-700">{fmtPrice(ts.tp1)}</div>
          <div className="text-gray-400 text-[10px]">
            {((ts.tp1 / currentPrice - 1) * 100).toFixed(1)}% / R:R {ts.rrTp1.toFixed(2)}
          </div>
        </div>
        {/* TP2 — メイン評価 */}
        <div className="rounded-lg p-2 border bg-green-50 border-green-300 ring-1 ring-green-400">
          <div className="font-semibold mb-0.5 text-green-700 flex items-center gap-1">
            {t.tp2}
            <span className="text-[8px] bg-green-600 text-white px-1 rounded leading-tight">MAIN</span>
          </div>
          <div className="font-mono font-bold text-green-700">{fmtPrice(ts.tp2)}</div>
          <div className="text-gray-400 text-[10px]">
            {((ts.tp2 / currentPrice - 1) * 100).toFixed(1)}% / R:R {ts.rrTp2.toFixed(2)}
          </div>
        </div>
        {/* TP3 */}
        <div className="rounded-lg p-2 border bg-gray-50 border-gray-200">
          <div className="font-semibold mb-0.5 text-gray-700">{t.tp3}</div>
          <div className="font-mono font-bold text-gray-700">{fmtPrice(ts.tp3)}</div>
          <div className="text-gray-400 text-[10px]">
            {((ts.tp3 / currentPrice - 1) * 100).toFixed(1)}% / R:R {ts.rrTp3.toFixed(2)}
          </div>
        </div>
      </div>

      {atrData && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          <span>ATR: <span className="font-mono font-semibold text-gray-700">{atrData.atrPct.toFixed(2)}%</span></span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
            atrData.regime === "high"     ? "bg-red-100 text-red-700 border-red-300"         :
            atrData.regime === "medium"   ? "bg-orange-100 text-orange-700 border-orange-300" :
            atrData.regime === "trending" ? "bg-blue-100 text-blue-700 border-blue-300"       :
                                           "bg-gray-100 text-gray-600 border-gray-200"
          }`}>
            {atrData.regime === "high" ? "🔥 高ボラ" : atrData.regime === "medium" ? "📊 中ボラ" : atrData.regime === "trending" ? "📈 トレンド域" : "😴 低ボラ"}
          </span>
          {atrData.regime === "high" && <span className="text-orange-600 text-[10px] font-medium">SL拡張済</span>}
        </div>
      )}

      {/* TWAP Execution Simulator */}
      <div className="mt-3">
        <p className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">💹 執行インパクト推定</p>
        {(() => {
          const avgVol4h = volume24h / 6;
          return (
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              {([100, 500, 1000] as const).map(size => {
                const volRatio = avgVol4h > 0 ? size / avgVol4h : 1;
                const oiR = openInterest > 0 ? size / openInterest : 1;
                let slip = volRatio <= 0.01 ? volRatio * 10 : volRatio <= 0.1 ? 0.1 + (volRatio - 0.01) * 10 : volRatio <= 0.5 ? 1 + (volRatio - 0.1) * 10 : 5 + (volRatio - 0.5) * 20;
                if (oiR > 0.05) slip *= 1.5;
                if (oiR > 0.1)  slip *= 2;
                slip = Math.min(slip, 20);
                const icon = slip >= 5 ? "🔴" : slip >= 2 ? "🟠" : slip >= 0.5 ? "🟡" : "🟢";
                return (
                  <div key={size} className={`rounded p-1.5 text-center border ${
                    slip >= 2 ? "border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800" :
                    slip >= 0.5 ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800" :
                    "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                  }`}>
                    <div className="font-semibold text-gray-700 dark:text-gray-300">${size}</div>
                    <div className="font-mono font-bold mt-0.5">{icon} {slip.toFixed(2)}%</div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1">
          ※ MEXC先物の流動性に基づく推定スリッページ（$100/$500/$1000注文時）
        </p>
      </div>
    </div>
  );
}
