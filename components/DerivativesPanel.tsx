"use client";
import { useEffect, useState } from "react";

interface DerivativesData {
  symbol: string;
  fundingRate: {
    current: number;
    currentPct: string;
    exchange: string;
    mexcRate: number | null;
    status: "danger" | "caution" | "neutral" | "favorable" | "strong";
  } | null;
  openInterest: {
    value: number;
    valueFmt: string;
    change24h: number;
  } | null;
  longShortRatio: number | null;
  shortSignal: {
    isRecommended: boolean;
    reason: string;
    level: string;
  };
}

const STATUS_CONFIG = {
  danger:    { color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200",    badge: "🚨 禁止" },
  caution:   { color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200", badge: "⚠️ 注意" },
  neutral:   { color: "text-gray-600",   bg: "bg-gray-50",   border: "border-gray-200",   badge: "✅ 可" },
  favorable: { color: "text-green-600",  bg: "bg-green-50",  border: "border-green-200",  badge: "✅ 有利" },
  strong:    { color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", badge: "🔥 強推奨" },
} as const;

export default function DerivativesPanel({ symbol }: { symbol: string }) {
  const [data, setData]       = useState<DerivativesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setData(null);
    fetch(`/api/derivatives/${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="mt-3 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400 flex items-center gap-1.5">
        <span className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin inline-block" />
        デリバティブ取得中…
      </div>
    );
  }
  if (!data || (!data.fundingRate && !data.openInterest)) return null;

  const st  = (data.fundingRate?.status ?? "neutral") as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[st] ?? STATUS_CONFIG.neutral;

  return (
    <div className={`mt-3 p-3 rounded-lg border ${cfg.border} ${cfg.bg} text-xs`}>
      <div className="font-bold text-sm mb-2 flex items-center justify-between">
        <span>📊 デリバティブ概況 — {data.symbol}</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.color} border ${cfg.border}`}>
          {cfg.badge}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {data.fundingRate && (
          <>
            <span className="text-gray-500">FR ({data.fundingRate.exchange})</span>
            <span className={`font-mono font-semibold ${cfg.color}`}>{data.fundingRate.currentPct}</span>
            {data.fundingRate.mexcRate !== null && data.fundingRate.exchange !== "MEXC" && (
              <>
                <span className="text-gray-500">FR (MEXC)</span>
                <span className="font-mono">{(data.fundingRate.mexcRate * 100).toFixed(4)}%/8h</span>
              </>
            )}
          </>
        )}
        {data.openInterest && (
          <>
            <span className="text-gray-500">OI</span>
            <span className="font-mono">{data.openInterest.valueFmt}</span>
            <span className="text-gray-500">OI 24h変化</span>
            <span className={`font-mono ${data.openInterest.change24h >= 0 ? "text-green-600" : "text-red-600"}`}>
              {data.openInterest.change24h >= 0 ? "+" : ""}{data.openInterest.change24h.toFixed(1)}%
            </span>
          </>
        )}
        {data.longShortRatio !== null && (
          <>
            <span className="text-gray-500">ロング比率</span>
            <span className="font-mono">{(data.longShortRatio * 100).toFixed(1)}%</span>
          </>
        )}
      </div>

      <div className={`mt-2 pt-2 border-t ${cfg.border} ${cfg.color} font-semibold`}>
        ショート判定: {data.shortSignal.reason}
      </div>
    </div>
  );
}
