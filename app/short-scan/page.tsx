"use client";
import { useState, useEffect } from "react";
import ShortScanner from "@/components/ShortScanner";

const SCORING_ITEMS = [
  { label: "ATH下落",      pts: "3pt", color: "#ef4444" },
  { label: "出来高枯渇",    pts: "3pt", color: "#f97316" },
  { label: "FR逆張り",     pts: "2pt", color: "#a855f7" },
  { label: "上場新しさ",    pts: "2pt", color: "#3b82f6" },
  { label: "TF一致度",     pts: "3pt", color: "#10b981" },
  { label: "OI過剰",       pts: "2pt", color: "#06b6d4" },
  { label: "OI急増",       pts: "2pt", color: "#7c3aed" },
  { label: "取引所独占",    pts: "2pt", color: "#22c55e" },
  { label: "FR連続",       pts: "1pt", color: "#8b5cf6" },
  { label: "7d急騰",       pts: "2pt", color: "#f43f5e" },
  { label: "BTC非連動",    pts: "1pt", color: "#8b5cf6" },
  { label: "パターン(SMC)", pts: "3pt", color: "#0ea5e9" },
  { label: "RSI過熱",      pts: "2pt", color: "#f59e0b" },
  { label: "MC/FDV乖離",   pts: "3pt", color: "#dc2626" },
  { label: "アンロック",    pts: "3pt", color: "#fbbf24" },
];

function ScoringBar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1"
      >
        📊 スコアリング方法を見る {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <div className="flex flex-wrap gap-x-1 gap-y-0.5 items-center">
            {SCORING_ITEMS.map((s, i) => (
              <span key={s.label} className="whitespace-nowrap">
                <span style={{ color: s.color }} className="font-bold">{s.label}({s.pts})</span>
                {i < SCORING_ITEMS.length - 1 && <span className="text-gray-300 dark:text-gray-600 mx-0.5">+</span>}
              </span>
            ))}
            <span className="text-gray-400 dark:text-gray-500 ml-1">= 最大 27pt</span>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">※取引所独占・FR連続・OI急増・MC/FDV乖離はクライアントサイド加算。CoinGecko連携時は最大37pt。</p>
        </div>
      )}
    </div>
  );
}

export default function ShortScanPage() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("bell:darkMode") === "true";
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("bell:darkMode", String(darkMode));
  }, [darkMode]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
      {/* Landing hero */}
      <section className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-6 md:py-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-3">
                <div className="inline-flex items-center gap-2 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 text-xs font-semibold px-3 py-1 rounded-full border border-red-200 dark:border-red-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  MEXC Futures ショートスキャナー
                </div>
                <button
                  onClick={() => setDarkMode(v => !v)}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {darkMode ? "☀️ Light" : "🌙 Dark"}
                </button>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight mb-2">
                ATH急落 × 出来高枯渇を<br className="hidden sm:inline" />リアルタイムで自動検出
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4 max-w-xl">
                MEXC先物の全銘柄を自動スキャンし、複数シグナルを総合スコアリング。
                ショートエントリー候補をTOP20で表示します。
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: "📉", label: "ATH比下落率" },
                  { icon: "📊", label: "VPCR" },
                  { icon: "💸", label: "ファンディングレート" },
                  { icon: "🔗", label: "OI/出来高比" },
                  { icon: "📐", label: "パターン認識" },
                  { icon: "⚔️", label: "SL/TP自動計算" },
                  { icon: "₿", label: "BTC非連動" },
                  { icon: "🌡️", label: "ヒートマップ" },
                ].map(f => (
                  <span key={f.label} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded-full font-medium">
                    <span>{f.icon}</span>{f.label}
                  </span>
                ))}
              </div>
              <ScoringBar />
            </div>

          </div>
        </div>
      </section>

      {/* Scanner */}
      <section className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        <ShortScanner />
      </section>

      {/* Disclaimer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">⚠️ 免責事項 / Disclaimer</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
            本ツールは情報提供のみを目的としており、投資助言・売買推奨ではありません。
            暗号資産取引には元本損失リスクを含む重大なリスクが伴います。
            スコアやトレードセットアップはアルゴリズムによる参考値であり、実際の取引判断はご自身の責任で行ってください。
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed mt-0.5">
            This tool is for informational purposes only and does not constitute investment advice.
            Cryptocurrency trading involves substantial risk of loss. Always conduct your own due diligence before trading.
          </p>
        </div>
      </footer>
    </main>
  );
}
