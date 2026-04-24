"use client";
import { useEffect, useRef, useState } from "react";
import { saveAnalysis } from "@/app/lib/analysisHistory";
import AnalysisHistoryPanel from "./AnalysisHistoryPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Indicators {
  price:         number;
  priceChange24h: number;
  athDrop:       number;
  ma20:          number | null;
  ma50:          number | null;
  ma200:         number | null;
  rsi14:         number | null;
  macd:          { macdLine: number; signal: number; histogram: number } | null;
  bb:            { upper: number; middle: number; lower: number } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(v: number | null): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100)   return v.toFixed(2);
  if (abs >= 1)     return v.toFixed(4);
  if (abs >= 0.01)  return v.toFixed(6);
  return v.toFixed(8);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ─── TradingView chart with studies ──────────────────────────────────────────

function TvTechChart({ symbol, isFullscreen, isDark }: { symbol: string; isFullscreen?: boolean; isDark?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize:          true,
      symbol:            `BINANCE:${symbol}USDT`,
      interval:          "240",
      timezone:          "Asia/Tokyo",
      theme:             isDark ? "dark" : "light",
      style:             "1",
      locale:            "ja",
      enable_publishing: false,
      save_image:        false,
      hide_top_toolbar:  false,
      studies: [
        "MASimple@tv-basicstudies",
        "RSI@tv-basicstudies",
        "MACD@tv-basicstudies",
        "BB@tv-basicstudies",
      ],
      container_id: "tv_tech_chart_inner",
    });
    el.appendChild(script);

    return () => { el.innerHTML = ""; };
  }, [symbol]);

  return (
    <div
      id="tv_tech_chart_inner"
      ref={containerRef}
      style={{ height: isFullscreen ? "calc(100vh - 44px)" : 500 }}
    />
  );
}

// ─── Indicator panel ──────────────────────────────────────────────────────────

function IndicatorPanel({ ind }: { ind: Indicators }) {
  const maColor = (ma: number | null) =>
    ma == null ? "text-gray-400 dark:text-slate-500"
    : ind.price > ma ? "text-green-600" : "text-red-500";

  const rsiColor = ind.rsi14 == null ? "text-gray-400 dark:text-slate-500"
    : ind.rsi14 >= 70 ? "text-red-500"
    : ind.rsi14 <= 30 ? "text-blue-500"
    : "text-gray-700 dark:text-slate-300";

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-4 text-xs">
      <h3 className="text-sm font-bold text-gray-700 dark:text-slate-300 mb-3">📊 インジケーター</h3>

      <div className="space-y-1.5">
        {/* Price */}
        <Row label="価格" value={`$${fmtNum(ind.price)}`} valueClass="font-bold text-gray-800 dark:text-slate-200" />
        <Row
          label="24h"
          value={fmtPct(ind.priceChange24h)}
          valueClass={`font-semibold ${ind.priceChange24h >= 0 ? "text-green-500" : "text-red-500"}`}
        />
        <Row
          label="ATH比"
          value={fmtPct(ind.athDrop)}
          valueClass="font-semibold text-red-500"
        />

        <Divider />

        {/* MA */}
        <SectionLabel>移動平均（日足）</SectionLabel>
        <Row label="MA20"  value={fmtNum(ind.ma20)}  valueClass={`font-semibold ${maColor(ind.ma20)}`} />
        <Row label="MA50"  value={fmtNum(ind.ma50)}  valueClass={`font-semibold ${maColor(ind.ma50)}`} />
        <Row label="MA200" value={fmtNum(ind.ma200)} valueClass={`font-semibold ${maColor(ind.ma200)}`} />

        <Divider />

        {/* RSI */}
        <SectionLabel>RSI 14（4h）</SectionLabel>
        <Row
          label="RSI"
          value={ind.rsi14 != null ? ind.rsi14.toFixed(2) : "—"}
          valueClass={`font-bold ${rsiColor}`}
          badge={ind.rsi14 != null ? (ind.rsi14 >= 70 ? "買われすぎ" : ind.rsi14 <= 30 ? "売られすぎ" : undefined) : undefined}
          badgeClass={ind.rsi14 != null && (ind.rsi14 >= 70 || ind.rsi14 <= 30) ? "bg-amber-100 text-amber-700" : undefined}
        />

        <Divider />

        {/* MACD */}
        <SectionLabel>MACD 12,26,9（4h）</SectionLabel>
        {ind.macd ? (
          <>
            <Row label="MACD"    value={fmtNum(ind.macd.macdLine)} valueClass="font-semibold text-gray-700 dark:text-slate-300" />
            <Row label="シグナル" value={fmtNum(ind.macd.signal)}   valueClass="font-semibold text-gray-700 dark:text-slate-300" />
            <Row
              label="ヒスト"
              value={fmtNum(ind.macd.histogram)}
              valueClass={`font-bold ${ind.macd.histogram >= 0 ? "text-green-600" : "text-red-500"}`}
            />
          </>
        ) : <span className="text-gray-400 dark:text-slate-500">データ不足</span>}

        <Divider />

        {/* BB */}
        <SectionLabel>ボリンジャー 20,2（4h）</SectionLabel>
        {ind.bb ? (
          <>
            <Row label="上限" value={fmtNum(ind.bb.upper)}  valueClass="font-semibold text-gray-700 dark:text-slate-300" />
            <Row label="中央" value={fmtNum(ind.bb.middle)} valueClass="font-semibold text-gray-700 dark:text-slate-300" />
            <Row label="下限" value={fmtNum(ind.bb.lower)}  valueClass="font-semibold text-gray-700 dark:text-slate-300" />
            <Row
              label="位置"
              value={ind.price > ind.bb.upper ? "上限突破" : ind.price < ind.bb.lower ? "下限割れ" : "バンド内"}
              valueClass={`font-semibold ${ind.price > ind.bb.upper || ind.price < ind.bb.lower ? "text-amber-600" : "text-green-600"}`}
            />
          </>
        ) : <span className="text-gray-400 dark:text-slate-500">データ不足</span>}
      </div>
    </div>
  );
}

function Row({ label, value, valueClass, badge, badgeClass }: {
  label: string; value: string; valueClass?: string; badge?: string; badgeClass?: string;
}) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-gray-500 dark:text-slate-400 shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        {badge && <span className={`text-[10px] px-1 py-0.5 rounded ${badgeClass}`}>{badge}</span>}
        <span className={valueClass}>{value}</span>
      </div>
    </div>
  );
}

function Divider() { return <hr className="border-gray-100 my-1" />; }
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mt-1">{children}</p>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TechnicalAnalysis() {
  const [input,        setInput]        = useState("");
  const [symbol,       setSymbol]       = useState("");
  const [loading,      setLoading]      = useState(false);
  const [indicators,   setIndicators]   = useState<Indicators | null>(null);
  const [analysis,     setAnalysis]     = useState("");
  const [historyKey,   setHistoryKey]   = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDark,       setIsDark]       = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const analyze = async () => {
    const sym = input.trim().toUpperCase().replace(/USDT$/i, "");
    if (!sym) return;
    setSymbol(sym);
    setLoading(true);
    setIndicators(null);
    setAnalysis("");

    try {
      const res = await fetch("/api/technical", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ symbol: sym }),
      });
      if (!res.ok || !res.body) throw new Error("API error");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let firstLine = true, lineBuf = "", aiText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (firstLine) {
          lineBuf += chunk;
          const nl = lineBuf.indexOf("\n");
          if (nl !== -1) {
            try {
              const parsed = JSON.parse(lineBuf.slice(0, nl));
              if (parsed.indicators) setIndicators(parsed.indicators);
            } catch { /* ignore parse errors */ }
            aiText = lineBuf.slice(nl + 1);
            setAnalysis(aiText);
            firstLine = false;
          }
        } else {
          aiText += chunk;
          setAnalysis(aiText);
        }
      }
      if (aiText) {
        saveAnalysis({ type: "technical", title: sym, summary: aiText.slice(0, 150), fullText: aiText });
        setHistoryKey(k => k + 1);
      }
    } catch {
      setAnalysis("データ取得エラーが発生しました。銘柄名を確認して再試行してください。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 py-6 max-w-screen-2xl mx-auto">
      {/* Input row */}
      <div className="flex gap-2 mb-5">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !loading && analyze()}
          placeholder="銘柄を入力（例: BTC, ETH, SOL）"
          className="border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-100"
        />
        <button
          onClick={analyze}
          disabled={loading || !input.trim()}
          className="bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm px-5 py-2 rounded-lg font-semibold transition-colors"
        >
          {loading ? "分析中…" : "📐 分析"}
        </button>
      </div>

      {symbol ? (
        <>
          {/* Chart */}
          <div className={`relative ${
            isFullscreen
              ? "fixed inset-0 z-50 bg-white dark:bg-slate-900"
              : "rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden mb-4"
          }`}>
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2">
              <span className="text-sm font-bold text-gray-700 dark:text-slate-300">{symbol}/USDT</span>
              <span className="text-xs text-gray-400 dark:text-slate-500">4時間足 · TradingView</span>
              <span className="ml-auto text-xs text-gray-400 dark:text-slate-500">MA / RSI / MACD / BB</span>
            </div>
            <button
              onClick={() => setIsFullscreen(v => !v)}
              className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-gray-800 text-white rounded hover:bg-gray-700"
            >
              {isFullscreen ? "✕ 閉じる" : "⛶ 全画面"}
            </button>
            <TvTechChart symbol={symbol} isFullscreen={isFullscreen} isDark={isDark} />
          </div>

          {/* Indicators + AI analysis */}
          {(indicators || analysis) && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {indicators && (
                <div className="lg:col-span-1">
                  <IndicatorPanel ind={indicators} />
                </div>
              )}

              <div className={indicators ? "lg:col-span-3" : "lg:col-span-4"}>
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-4 h-full">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-slate-300 mb-3">🤖 AIテクニカル解説</h3>

                  {loading && !analysis && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-slate-500 py-4">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      AIが分析中…
                    </div>
                  )}

                  <div className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none">
                    {analysis.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                      /^\*\*[^*]+\*\*$/.test(part)
                        ? <strong key={i}>{part.slice(2, -2)}</strong>
                        : <span key={i}>{part}</span>
                    )}
                    {loading && analysis && <span className="animate-pulse ml-0.5">▋</span>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 text-gray-400 dark:text-slate-500">
          <div className="text-6xl mb-4">📐</div>
          <p className="text-sm">銘柄を入力して分析を開始してください</p>
          <p className="text-xs mt-1 text-gray-300">例: BTC, ETH, SOL, PEPE</p>
        </div>
      )}

      <AnalysisHistoryPanel type="technical" label="テクニカル分析" refreshKey={historyKey} />
    </div>
  );
}
