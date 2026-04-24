"use client";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { BitgetLongCandidate, BitgetLongScoreBreakdown, TrendDir } from "@/app/lib/bitgetLongScorer";
import MarketEnvironmentPanel from "@/components/MarketEnvironmentPanel";

// ─── Bitget referral link ────────────────────────────────────────────────────
const BG_REF = process.env.NEXT_PUBLIC_BITGET_REFERRAL_CODE ?? "";
function bitgetUrl(sym: string) {
  const base = sym.replace(/USDT$/, "");
  const ref  = BG_REF ? `?channelCode=${BG_REF}` : "";
  return `https://www.bitget.com/futures/usdt/${base}USDT${ref}`;
}

// ─── Colors ──────────────────────────────────────────────────────────────────
const GREEN     = "#16a34a";
const GREEN_DIM = "#15803d";

function scoreColor(score: number): string {
  if (score >= 18) return "#16a34a"; // green-600
  if (score >= 15) return "#d97706"; // amber
  if (score >= 12) return "#374151"; // gray-700
  return "#9ca3af";
}

function frColor(fr: number | null): string {
  if (fr === null) return "#64748b";
  if (fr <= -0.0005) return "#4ade80";  // negative FR = great for longs
  if (fr <= 0)       return "#86efac";  // slightly negative = good
  if (fr <= 0.0002)  return "#fbbf24";  // slightly positive = caution
  return "#f87171";                      // positive = bad for longs
}

function trendBadge(t: TrendDir): React.ReactNode {
  if (t === "UP")   return <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "#f0fdf4", color: "#16a34a" }}>↑UP</span>;
  if (t === "DOWN") return <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "#fef2f2", color: "#dc2626" }}>↓DOWN</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-gray-100 text-gray-500">— NEU</span>;
}

function fmtPrice(n: number): string {
  if (!n) return "$0";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01)   return `$${n.toFixed(6)}`;
  if (n < 1)      return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtM(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ─── Score bar ───────────────────────────────────────────────────────────────
function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value / max * 100)}%`, background: color }} />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{value}/{max}</span>
    </div>
  );
}

// ─── Breakdown grid ───────────────────────────────────────────────────────────
function BreakdownGrid({ bd }: { bd: BitgetLongScoreBreakdown }) {
  const items = [
    { label: "ATH下落",     value: bd.athDropScore, max: 5 },
    { label: "FR偏り",      value: bd.frScore,      max: 4 },
    { label: "出来高回復",  value: bd.volRecScore,  max: 3 },
    { label: "トレンド",    value: bd.trendScore,   max: 6 },
    { label: "RSI売られ過", value: bd.rsiScore,     max: 4 },
    { label: "BTC連動",     value: bd.btcCorrScore, max: 2 },
    { label: "7d押し目",    value: bd.dip7dScore,   max: 3 },
    { label: "OI低水準",    value: bd.oiScore,      max: 3 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
      {items.map(({ label, value, max }) => (
        <div key={label} className="bg-gray-50 rounded p-2">
          <div className="text-xs text-gray-500 mb-1">{label}</div>
          <ScoreBar value={value} max={max} color={GREEN} />
        </div>
      ))}
    </div>
  );
}

// ─── Trade setup card ─────────────────────────────────────────────────────────
function TradeSetupCard({ c }: { c: BitgetLongCandidate }) {
  const { tradeSetup, frWeeklyCost, recommendedLev, fundingRate } = c;
  if (!tradeSetup) return null;
  const { entry, entryZone, sl, tp1, tp2, rrRatio, rrWarning } = tradeSetup;
  const frPct8h     = fundingRate !== null ? fundingRate * 100 : null;
  // weeklyAmount: positive = longs receive (negative FR), negative = longs pay
  const weeklyAmount = -frWeeklyCost;
  const isReceiving  = weeklyAmount > 0;
  return (
    <div className="mt-3 p-3 rounded-lg border" style={{ borderColor: `${GREEN}40`, background: `${GREEN}08` }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold" style={{ color: GREEN }}>📈 トレードセットアップ（ロング）</span>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded font-bold" style={{ background: `${GREEN}20`, color: GREEN }}>
            推奨レバ {recommendedLev}x
          </span>
          {rrWarning && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">R:R低⚠️</span>}
        </div>
      </div>

      {/* Price levels */}
      <div className="space-y-1.5 text-xs mb-3">
        <div className="flex justify-between items-center bg-white rounded px-2.5 py-1.5">
          <span className="text-gray-500">エントリー</span>
          <span className="font-bold text-gray-800">
            {fmtPrice(entryZone?.low ?? entry)} 〜 {fmtPrice(entryZone?.high ?? entry)}
          </span>
        </div>
        <div className="flex justify-between items-center bg-green-50 rounded px-2.5 py-1.5">
          <span className="text-green-600">TP1</span>
          <span className="font-bold text-green-700">
            {fmtPrice(tp1)}<span className="text-green-500 font-normal ml-1">({fmtPct((tp1 - entry) / entry * 100)})</span>
          </span>
        </div>
        <div className="flex justify-between items-center bg-emerald-50 rounded px-2.5 py-1.5">
          <span className="text-emerald-600">TP2</span>
          <span className="font-bold text-emerald-700">
            {fmtPrice(tp2)}<span className="text-emerald-500 font-normal ml-1">({fmtPct((tp2 - entry) / entry * 100)})</span>
          </span>
        </div>
        <div className="flex justify-between items-center bg-red-50 rounded px-2.5 py-1.5">
          <span className="text-red-500">損切り (SL)</span>
          <span className="font-bold text-red-600">
            {fmtPrice(sl)}<span className="text-red-400 font-normal ml-1">({fmtPct((sl - entry) / entry * 100)})</span>
          </span>
        </div>
        <div className="flex justify-between items-center bg-gray-50 rounded px-2.5 py-1.5">
          <span className="text-gray-500">R:R</span>
          <span className={`font-bold ${rrRatio >= 1.5 ? "text-green-600" : "text-amber-600"}`}>
            1 : {rrRatio.toFixed(2)}
          </span>
        </div>
      </div>

      {/* FR cost section */}
      <div className="border-t pt-2.5 mb-3" style={{ borderColor: `${GREEN}30` }}>
        <div className="text-xs font-bold mb-2" style={{ color: GREEN }}>💸 FRコスト試算（1週間保有）</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white rounded px-2.5 py-1.5">
            <div className="text-gray-400 mb-0.5">現在FR/8h</div>
            <div className={`font-semibold ${frPct8h !== null && frPct8h <= 0 ? "text-green-600" : "text-red-500"}`}>
              {frPct8h !== null ? `${frPct8h >= 0 ? "+" : ""}${frPct8h.toFixed(4)}%` : "—"}
            </div>
          </div>
          <div className="bg-white rounded px-2.5 py-1.5">
            <div className="text-gray-400 mb-0.5">週間累積</div>
            <div className={`font-semibold ${isReceiving ? "text-green-600" : "text-red-500"}`}>
              {weeklyAmount >= 0 ? "+" : ""}{weeklyAmount.toFixed(3)}%
              <span className="ml-1">{isReceiving ? "受取 🟢" : "支払 🔴"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bitget link */}
      <a
        href={bitgetUrl(c.symbol)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-90"
        style={{ background: GREEN_DIM }}
      >
        Bitgetで取引 ↗
      </a>
    </div>
  );
}

// ─── Expanded row ─────────────────────────────────────────────────────────────
function ExpandedRow({ c }: { c: BitgetLongCandidate }) {
  return (
    <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
      <div className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
        <div><div className="text-gray-500">出来高24h</div><div className="font-semibold">{fmtM(c.volume24h)}</div></div>
        <div><div className="text-gray-500">出来高7d平均</div><div className="font-semibold">{fmtM(c.volumeAvg7d)}</div></div>
        <div><div className="text-gray-500">OI (USDT)</div><div className="font-semibold">{fmtM(c.openInterest)}</div></div>
        <div><div className="text-gray-500">OI/Vol比</div><div className="font-semibold">{c.oiRatio.toFixed(2)}x</div></div>
        <div>
          <div className="text-gray-500">7d変動</div>
          <div className={`font-semibold ${c.priceChange7d >= 0 ? "text-green-600" : "text-red-500"}`}>{fmtPct(c.priceChange7d)}</div>
        </div>
        <div>
          <div className="text-gray-500">24h変動</div>
          <div className={`font-semibold ${c.priceChange24h >= 0 ? "text-green-600" : "text-red-500"}`}>{fmtPct(c.priceChange24h)}</div>
        </div>
        <div>
          <div className="text-gray-500">ロング/ショート</div>
          <div className={`font-semibold ${c.longRatio !== null && c.longRatio <= 0.40 ? "text-green-600" : "text-gray-600"}`}>
            {c.longRatio !== null
              ? `${Math.round(c.longRatio * 100)}/${Math.round((1 - c.longRatio) * 100)}`
              : "—"}
          </div>
        </div>
        <div><div className="text-gray-500">ATH14d</div><div className="font-semibold">{fmtPrice(c.ath14d)}</div></div>
      </div>
      <div className="mb-2">
        <div className="text-xs text-gray-500 mb-1">マルチTFトレンド</div>
        <div className="flex gap-2">
          <span className="text-xs text-gray-500">1H:</span>{trendBadge(c.trendH1)}
          <span className="text-xs text-gray-500 ml-1">4H:</span>{trendBadge(c.trendH4)}
          <span className="text-xs text-gray-500 ml-1">1D:</span>{trendBadge(c.trendD1)}
        </div>
      </div>
      <div className="text-xs text-gray-500 mb-1">スコア内訳</div>
      <BreakdownGrid bd={c.breakdown} />
      <TradeSetupCard c={c} />
    </div>
  );
}

// ─── Candidate row ────────────────────────────────────────────────────────────
function CandidateRow({ c, rank }: { c: BitgetLongCandidate; rank: number }) {
  const [open, setOpen] = useState(false);
  const col = scoreColor(c.longScore);
  const weeklyAmount = -c.frWeeklyCost;

  const rowBg = c.longScore >= 18 ? "bg-green-50" : c.longScore >= 15 ? "bg-yellow-50" : "";
  const rowStyle = c.longScore >= 18
    ? { borderLeft: "4px solid #16a34a" }
    : c.longScore >= 15
    ? { borderLeft: "4px solid #f59e0b" }
    : undefined;
  const rowOpacity = c.longScore <= 11 ? "opacity-60" : "";

  return (
    <>
      <tr
        className={`border-b border-gray-100 cursor-pointer transition-colors hover:brightness-95 ${rowBg} ${rowOpacity}`}
        style={rowStyle}
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-1 py-1 text-xs text-gray-400 w-7 shrink-0">{rank}</td>
        <td className="px-1 py-1 whitespace-nowrap">
          <a
            href={bitgetUrl(c.symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-sm hover:underline"
            style={{ color: GREEN }}
            onClick={e => e.stopPropagation()}
          >
            {c.symbol.replace("USDT", "")}
          </a>
        </td>
        <td className="px-1 py-1 text-right whitespace-nowrap">
          <span
            className={`font-bold ${c.longScore >= 18 ? "text-base font-black" : "text-sm"}`}
            style={{ color: col }}
          >{c.longScore}</span>
          <span className="text-xs text-gray-400">/30</span>
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">{fmtPrice(c.currentPrice)}</td>
        <td className={`px-1 py-1 text-right text-xs whitespace-nowrap font-semibold ${c.priceChange24h >= 0 ? "text-green-600" : "text-red-500"}`}>
          {fmtPct(c.priceChange24h)}
        </td>
        <td className={`px-1 py-1 text-right text-xs whitespace-nowrap font-semibold ${c.priceChange7d >= 0 ? "text-green-600" : "text-red-500"}`}>
          {fmtPct(c.priceChange7d)}
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap text-red-500 font-semibold">
          {c.athDropPct.toFixed(1)}%
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap" style={{ color: frColor(c.fundingRate) }}>
          {c.fundingRate !== null ? (c.fundingRate * 100).toFixed(4) + "%" : "—"}
        </td>
        <td className={`px-1 py-1 text-right text-xs whitespace-nowrap font-semibold ${weeklyAmount >= 0 ? "text-green-600" : "text-red-500"}`}>
          {weeklyAmount >= 0 ? "+" : ""}{weeklyAmount.toFixed(2)}%
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap text-gray-500">
          {c.oiRatio.toFixed(1)}x
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          {c.longRatio !== null ? (
            <span className={`font-semibold ${c.longRatio <= 0.40 ? "text-green-600" : "text-gray-600"}`}>
              {Math.round(c.longRatio * 100)}/{Math.round((1 - c.longRatio) * 100)}
            </span>
          ) : <span className="text-gray-400">—</span>}
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          <span className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: `${GREEN}20`, color: GREEN }}>
            {c.recommendedLev}x
          </span>
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          <div className="flex justify-end gap-0.5">
            {([c.trendH1, c.trendH4, c.trendD1] as TrendDir[]).map((t, i) => (
              <span key={i}>{t === "UP" ? "🟢" : t === "DOWN" ? "🔴" : "⚪"}</span>
            ))}
          </div>
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          {c.rsi !== null && c.rsi !== undefined ? (
            <span className={`font-mono font-semibold ${c.rsi <= 30 ? "text-blue-600 font-bold" : c.rsi <= 40 ? "text-green-600" : "text-gray-400"}`}>
              {c.rsi.toFixed(1)}
            </span>
          ) : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-1 py-1 text-center text-xs text-gray-400">{open ? "▲" : "▼"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={15} className="p-0">
            <ExpandedRow c={c} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Scan meta ────────────────────────────────────────────────────────────────
interface ScanMeta {
  totalPairs: number; stage1Passed: number; fetched: number; failed: number; filtered: number;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BitgetLongFinder() {
  const [scanning,   setScanning]   = useState(false);
  const [candidates, setCandidates] = useState<BitgetLongCandidate[]>([]);
  const [scanMeta,   setScanMeta]   = useState<ScanMeta | null>(null);
  const [scanTime,   setScanTime]   = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  // Dual scrollbar refs
  const tableScrollRef    = useRef<HTMLDivElement | null>(null);
  const topScrollRef      = useRef<HTMLDivElement | null>(null);
  const topScrollInnerRef = useRef<HTMLDivElement | null>(null);

  // Filters
  const [minScore,    setMinScore]    = useState(0);
  const [minDrop,     setMinDrop]     = useState(0);
  const [maxFr,       setMaxFr]       = useState(0.1);
  const [trendFilter, setTrendFilter] = useState<"all" | "h4up" | "allup">("all");

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res  = await fetch("/api/bitget-long-scan");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "スキャン失敗");
      setCandidates(json.candidates ?? []);
      setScanMeta(json.meta ?? null);
      setScanTime(json.scanTime ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setScanning(false);
    }
  }, []);

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (c.longScore < minScore) return false;
      const d = Math.abs(c.athDropPct);
      if (d < minDrop) return false;
      if (c.fundingRate !== null && c.fundingRate * 100 > maxFr) return false;
      if (trendFilter === "h4up"  && c.trendH4 !== "UP") return false;
      if (trendFilter === "allup" && c.trendAlignment < 3) return false;
      return true;
    });
  }, [candidates, minScore, minDrop, maxFr, trendFilter]);

  useEffect(() => {
    if (tableScrollRef.current && topScrollInnerRef.current) {
      topScrollInnerRef.current.style.width = tableScrollRef.current.scrollWidth + "px";
    }
  }, [filtered]);

  return (
    <div className="space-y-4">
      <MarketEnvironmentPanel />

      {/* Header */}
      <div className="rounded-xl p-4 text-white" style={{ background: "linear-gradient(135deg, #052e16 0%, #166534 100%)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-black" style={{ color: "#4ade80" }}>⚡ Bitget Long Finder</h2>
            <p className="text-xs mt-0.5" style={{ color: "#bbf7d0" }}>
              FR × ATH下落 × 出来高回復 × マルチTFトレンドで低レバロング候補をスキャン
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-5 py-2 rounded-lg font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white"
            style={{ background: scanning ? "#475569" : GREEN_DIM }}
          >
            {scanning ? "スキャン中..." : "🔍 スキャン実行"}
          </button>
        </div>

        {scanMeta && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "#86efac" }}>
            <span>取引ペア: {scanMeta.totalPairs}</span>
            <span>vol通過: {scanMeta.stage1Passed}</span>
            <span>分析済: {scanMeta.fetched}</span>
            <span>候補: {scanMeta.filtered}</span>
            {scanTime && <span>更新: {new Date(scanTime).toLocaleTimeString("ja-JP")}</span>}
          </div>
        )}
      </div>

      {/* Filters */}
      {candidates.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="font-semibold text-sm mb-3 text-gray-700">フィルター</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-500">最低スコア ({minScore})</label>
              <input type="range" min={0} max={30} value={minScore} onChange={e => setMinScore(+e.target.value)}
                className="w-full mt-1" style={{ accentColor: GREEN }} />
            </div>
            <div>
              <label className="text-xs text-gray-500">ATH下落 最低 ({minDrop}%)</label>
              <input type="range" min={0} max={90} value={minDrop} onChange={e => setMinDrop(+e.target.value)}
                className="w-full mt-1" style={{ accentColor: GREEN }} />
            </div>
            <div>
              <label className="text-xs text-gray-500">最高FR ({maxFr.toFixed(2)}%)</label>
              <input type="range" min={-0.1} max={0.1} step={0.005} value={maxFr} onChange={e => setMaxFr(+e.target.value)}
                className="w-full mt-1" style={{ accentColor: GREEN }} />
            </div>
            <div>
              <label className="text-xs text-gray-500">トレンド</label>
              <select value={trendFilter} onChange={e => setTrendFilter(e.target.value as typeof trendFilter)}
                className="w-full mt-1 text-xs rounded border border-gray-200 px-2 py-1.5">
                <option value="all">すべて</option>
                <option value="h4up">4H UP以上</option>
                <option value="allup">3TF すべてUP</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Loading */}
      {scanning && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "#16a34a40", borderTopColor: GREEN }} />
          <p className="text-sm text-gray-500">Bitget先物を分析中... (30〜60秒)</p>
        </div>
      )}

      {/* Empty state */}
      {!scanning && candidates.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <div className="text-4xl">📈</div>
          <p className="text-gray-500 text-sm">スキャンを実行してBitget先物のロング候補を表示</p>
          <p className="text-gray-400 text-xs">FR × 出来高回復 × BTC連動度 × 推奨レバレッジ付きで上位50件を表示</p>
        </div>
      )}

      {/* No results after filter */}
      {!scanning && candidates.length > 0 && filtered.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-500">フィルター条件に合う銘柄がありません。スライダーを調整してください。</div>
      )}

      {/* Table */}
      {!scanning && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
            <span className="text-xs text-gray-500">{filtered.length} 件表示（行をクリックで詳細展開）</span>
            <span className="text-xs text-gray-400">← 横スクロールで全列表示</span>
          </div>
          <div
            ref={topScrollRef}
            className="overflow-x-auto overflow-y-hidden border-b border-gray-100"
            style={{ height: 12 }}
            onScroll={e => {
              if (tableScrollRef.current) tableScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }}
          >
            <div ref={topScrollInnerRef} style={{ height: 1 }} />
          </div>
          <div
            ref={tableScrollRef}
            className=""
            onScroll={e => {
              if (topScrollRef.current) topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }}
          >
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                  <th className="px-1 py-1 text-left w-5">#</th>
                  <th className="px-1 py-1 text-left min-w-[80px]">銘柄</th>
                  <th className="px-1 py-1 text-right min-w-[55px]">スコア</th>
                  <th className="px-1 py-1 text-right min-w-[65px]">価格</th>
                  <th className="px-1 py-1 text-right min-w-[55px]">24h</th>
                  <th className="px-1 py-1 text-right min-w-[55px]">7d</th>
                  <th className="px-1 py-1 text-right min-w-[55px]">ATH比</th>
                  <th className="px-1 py-1 text-right min-w-[60px]">FR</th>
                  <th className="px-1 py-1 text-right min-w-[55px]">FR/週</th>
                  <th className="px-1 py-1 text-right min-w-[50px]">OI</th>
                  <th className="px-1 py-1 text-right min-w-[50px]">L/S</th>
                  <th className="px-1 py-1 text-right min-w-[42px]">レバ</th>
                  <th className="px-1 py-1 text-center min-w-[50px]">TF</th>
                  <th className="px-1 py-1 text-right min-w-[42px]">RSI</th>
                  <th className="px-1 py-1 w-5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <CandidateRow key={c.symbol} c={c} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
