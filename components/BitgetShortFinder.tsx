"use client";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { BitgetShortCandidate, BitgetShortScoreBreakdown, TrendDir } from "@/app/lib/bitgetScorer";
import type { BitgetBtRecord, BitgetBtStats } from "@/app/lib/bitgetBacktest";
import { loadRecords, recordCandidates, settleRecords, resetRecords, exportCsv, calcStats } from "@/app/lib/bitgetBacktest";
import MarketEnvironmentPanel from "@/components/MarketEnvironmentPanel";

// ─── Bitget referral link ────────────────────────────────────────────────────
const BG_REF = process.env.NEXT_PUBLIC_BITGET_REFERRAL_CODE ?? "";
function bitgetUrl(sym: string) {
  const base = sym.replace(/USDT$/, "");
  const ref = BG_REF ? `?channelCode=${BG_REF}` : "";
  return `https://www.bitget.com/futures/usdt/${base}USDT${ref}`;
}

// ─── Colors ──────────────────────────────────────────────────────────────────
const TEAL = "#00c9a7";
const TEAL_DIM = "#00a98d";

function scoreColor(score: number): string {
  if (score >= 18) return "#059669"; // emerald — strong
  if (score >= 15) return "#d97706"; // amber — notable
  if (score >= 12) return "#374151"; // gray-700
  return "#9ca3af";                  // gray-400 — weak
}

function frColor(fr: number | null): string {
  if (fr === null) return "#64748b";
  if (fr >= 0.0005) return "#f87171";
  if (fr >= 0.0002) return "#fb923c";
  if (fr >= 0)      return "#4ade80";
  return "#60a5fa";
}

function trendBadge(t: TrendDir): React.ReactNode {
  if (t === "DOWN")    return <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "#fef2f2", color: "#dc2626" }}>↓DOWN</span>;
  if (t === "UP")      return <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: "#f0fdf4", color: "#16a34a" }}>↑UP</span>;
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

// ─── Breakdown row ────────────────────────────────────────────────────────────
function BreakdownGrid({ bd }: { bd: BitgetShortScoreBreakdown }) {
  const items = [
    { label: "ATH下落",    value: bd.dropScore,        max: 5 },
    { label: "FR偏り",     value: bd.frScore,           max: 5 },
    { label: "出来高枯渇", value: bd.volumeDryScore,    max: 4 },
    { label: "OI比率",     value: bd.oiScore,           max: 4 },
    { label: "トレンド",   value: bd.trendScore,        max: 6 },
    { label: "急騰度",     value: bd.pumpScore,         max: 4 },
    { label: "BTC非連動",  value: bd.btcNonCorrScore,   max: 2 },
    { label: "RSI過熱",    value: bd.rsiScore,          max: 2 },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
      {items.map(({ label, value, max }) => (
        <div key={label} className="bg-gray-50 rounded p-2">
          <div className="text-xs text-gray-500 mb-1">{label}</div>
          <ScoreBar value={value} max={max} color={TEAL} />
        </div>
      ))}
    </div>
  );
}

// ─── Trade setup card ─────────────────────────────────────────────────────────
function TradeSetupCard({ c }: { c: BitgetShortCandidate }) {
  const { tradeSetup, frWeeklyCost, recommendedLev, fundingRate } = c;
  if (!tradeSetup) return null;
  const { entry, entryZone, sl, tp1, tp2, rrRatio, rrWarning } = tradeSetup;
  const frPct8h      = fundingRate !== null ? fundingRate * 100 : null;
  const weeklyAmount = -frWeeklyCost; // positive = shorts receive, negative = pay
  const isReceiving  = weeklyAmount > 0;
  return (
    <div className="mt-3 p-3 rounded-lg border" style={{ borderColor: `${TEAL}40`, background: `${TEAL}08` }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold" style={{ color: TEAL }}>⚔️ トレードセットアップ</span>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded font-bold" style={{ background: `${TEAL}20`, color: TEAL }}>
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
        <div className="flex justify-between items-center bg-red-50 rounded px-2.5 py-1.5">
          <span className="text-red-500">損切り (SL)</span>
          <span className="font-bold text-red-600">
            {fmtPrice(sl)}<span className="text-red-400 font-normal ml-1">({fmtPct((sl - entry) / entry * 100)})</span>
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
        <div className="flex justify-between items-center bg-gray-50 rounded px-2.5 py-1.5">
          <span className="text-gray-500">R:R</span>
          <span className={`font-bold ${rrRatio >= 1.5 ? "text-green-600" : "text-amber-600"}`}>
            1 : {rrRatio.toFixed(2)}
          </span>
        </div>
      </div>

      {/* FR cost section */}
      <div className="border-t pt-2.5 mb-3" style={{ borderColor: `${TEAL}30` }}>
        <div className="text-xs font-bold mb-2" style={{ color: TEAL }}>💸 FRコスト試算（1週間保有）</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white rounded px-2.5 py-1.5">
            <div className="text-gray-400 mb-0.5">現在FR/8h</div>
            <div className={`font-semibold ${frPct8h !== null && frPct8h >= 0 ? "text-green-600" : "text-red-500"}`}>
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
        style={{ background: TEAL_DIM }}
      >
        Bitgetで取引 ↗
      </a>
    </div>
  );
}

// ─── Expanded row ─────────────────────────────────────────────────────────────
function ExpandedRow({ c }: { c: BitgetShortCandidate }) {
  return (
    <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
      <div className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
        <div>
          <div className="text-gray-500">出来高24h</div>
          <div className="font-semibold">{fmtM(c.volume24h)}</div>
        </div>
        <div>
          <div className="text-gray-500">出来高7d平均</div>
          <div className="font-semibold">{fmtM(c.volumeAvg7d)}</div>
        </div>
        <div>
          <div className="text-gray-500">OI (USDT)</div>
          <div className="font-semibold">{fmtM(c.openInterest)}</div>
        </div>
        <div>
          <div className="text-gray-500">OI/Vol比</div>
          <div className="font-semibold">{c.oiRatio.toFixed(2)}x</div>
        </div>
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
          <div className={`font-semibold ${c.longRatio !== null && c.longRatio >= 0.60 ? "text-red-500" : "text-blue-500"}`}>
            {c.longRatio !== null
              ? `${Math.round(c.longRatio * 100)}/${Math.round((1 - c.longRatio) * 100)}`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-gray-500">ATH14d</div>
          <div className="font-semibold">{fmtPrice(c.ath14d)}</div>
        </div>
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
function CandidateRow({ c, rank }: { c: BitgetShortCandidate; rank: number }) {
  const [open, setOpen] = useState(false);
  const col = scoreColor(c.shortScore);
  const weeklyAmount = -c.frWeeklyCost; // positive = receive

  const rowBg = c.shortScore >= 18
    ? "bg-emerald-50"
    : c.shortScore >= 15
    ? "bg-yellow-50"
    : "";
  const rowStyle = c.shortScore >= 18
    ? { borderLeft: "4px solid #10b981" }
    : c.shortScore >= 15
    ? { borderLeft: "4px solid #f59e0b" }
    : undefined;
  const rowOpacity = c.shortScore <= 11 ? "opacity-60" : "";

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
            style={{ color: TEAL }}
            onClick={e => e.stopPropagation()}
          >
            {c.symbol.replace("USDT", "")}
          </a>
        </td>
        <td className="px-1 py-1 text-right whitespace-nowrap">
          <span
            className={`font-bold ${c.shortScore >= 18 ? "text-base font-black" : "text-sm"}`}
            style={{ color: col }}
          >{c.shortScore}</span>
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
            <span className={`font-semibold ${c.longRatio >= 0.65 ? "text-red-600" : "text-gray-600"}`}>
              {Math.round(c.longRatio * 100)}/{Math.round((1 - c.longRatio) * 100)}
            </span>
          ) : <span className="text-gray-400">—</span>}
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          <span className="px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: `${TEAL}20`, color: TEAL }}>
            {c.recommendedLev}x
          </span>
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          <div className="flex justify-end gap-0.5">
            {([c.trendH1, c.trendH4, c.trendD1] as TrendDir[]).map((t, i) => (
              <span key={i}>{t === "DOWN" ? "🔴" : t === "UP" ? "🟢" : "⚪"}</span>
            ))}
          </div>
        </td>
        <td className="px-1 py-1 text-right text-xs whitespace-nowrap">
          {c.rsi !== null && c.rsi !== undefined ? (
            <span className={`font-mono font-semibold ${c.rsi >= 70 ? "text-red-600" : c.rsi >= 60 ? "text-orange-500" : "text-gray-400"}`}>
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

// ─── Backtest panel ───────────────────────────────────────────────────────────
function BacktestPanel({
  records, stats, onReset, onCsv,
}: {
  records: BitgetBtRecord[];
  stats:   BitgetBtStats;
  onReset: () => void;
  onCsv:   () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm text-gray-800">📊 バックテスト成績</h3>
        <div className="flex gap-2">
          <button onClick={onCsv} disabled={records.length === 0}
            className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            📋 CSV
          </button>
          <button onClick={onReset} disabled={records.length === 0}
            className="text-xs px-2.5 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors">
            🗑️ リセット
          </button>
        </div>
      </div>

      {records.length < 5 ? (
        <p className="text-xs text-gray-400 text-center py-4">
          スキャンを繰り返すとバックテストデータが蓄積されます（現在 {records.length} 件）
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="text-center bg-gray-50 rounded-lg py-2">
              <div className="text-xs text-gray-500">記録 / アクティブ</div>
              <div className="text-lg font-bold text-gray-800">{stats.total}</div>
              <div className="text-xs text-gray-400">アクティブ {stats.active} 件</div>
            </div>
            <div className="text-center bg-gray-50 rounded-lg py-2">
              <div className="text-xs text-gray-500">勝率</div>
              <div className={`text-lg font-bold ${stats.winRate >= 50 ? "text-green-600" : "text-red-500"}`}>
                {stats.winRate.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-400">{stats.wins}勝 {stats.losses}敗</div>
            </div>
            <div className="text-center bg-gray-50 rounded-lg py-2">
              <div className="text-xs text-gray-500">平均 PnL</div>
              <div className={`text-lg font-bold ${stats.avgPnl >= 0 ? "text-green-600" : "text-red-500"}`}>
                {stats.avgPnl >= 0 ? "+" : ""}{stats.avgPnl.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-400">解決済 {stats.resolved} 件</div>
            </div>
            <div className="text-center bg-gray-50 rounded-lg py-2">
              <div className="text-xs text-gray-500">最高 / 最低</div>
              <div className="text-sm font-bold text-green-600">+{stats.bestPnl.toFixed(1)}%</div>
              <div className="text-sm font-bold text-red-500">{stats.worstPnl.toFixed(1)}%</div>
            </div>
          </div>

          {stats.byScore.some(b => b.wins + b.losses > 0) && (
            <div>
              <div className="text-xs text-gray-500 mb-2">スコア別勝率</div>
              <div className="space-y-1.5">
                {stats.byScore.filter(b => b.wins + b.losses > 0).map(b => (
                  <div key={b.range} className="flex items-center gap-2 text-xs">
                    <span className="w-14 text-gray-600 font-mono shrink-0">{b.range}pt</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${b.winRate}%`,
                          background: b.winRate >= 60 ? TEAL : b.winRate >= 40 ? "#fb923c" : "#f87171",
                        }}
                      />
                    </div>
                    <span className={`w-10 text-right font-bold shrink-0 ${b.winRate >= 50 ? "text-green-600" : "text-red-500"}`}>
                      {b.winRate.toFixed(0)}%
                    </span>
                    <span className="text-gray-400 w-16 shrink-0">{b.wins}勝 {b.losses}敗</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Scan meta info ───────────────────────────────────────────────────────────
interface ScanMeta {
  totalPairs: number; stage1Passed: number; fetched: number; failed: number; filtered: number;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BitgetShortFinder() {
  const [scanning,    setScanning]    = useState(false);
  const [candidates,  setCandidates]  = useState<BitgetShortCandidate[]>([]);
  const [scanMeta,    setScanMeta]    = useState<ScanMeta | null>(null);
  const [scanTime,    setScanTime]    = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [btRecords,   setBtRecords]   = useState<BitgetBtRecord[]>([]);

  // Scroll refs for top/bottom dual scrollbar
  const tableScrollRef    = useRef<HTMLDivElement | null>(null);
  const topScrollRef      = useRef<HTMLDivElement | null>(null);
  const topScrollInnerRef = useRef<HTMLDivElement | null>(null);

  // Load backtest records on mount
  useEffect(() => { setBtRecords(loadRecords()); }, []);

  const btStats = useMemo(() => calcStats(btRecords), [btRecords]);

  // Filters
  const [minScore,    setMinScore]    = useState(0);
  const [minDrop,     setMinDrop]     = useState(0);
  const [maxDrop,     setMaxDrop]     = useState(100);
  const [minFr,       setMinFr]       = useState(-0.1);
  const [trendFilter, setTrendFilter] = useState<"all" | "h4down" | "alldown">("all");

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/bitget-scan");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "スキャン失敗");
      const list: BitgetShortCandidate[] = json.candidates ?? [];
      setCandidates(list);
      setScanMeta(json.meta ?? null);
      setScanTime(json.scanTime ?? null);
      // Backtest: settle existing → record new candidates
      const priceMap = new Map<string, number>(list.map(c => [c.symbol, c.currentPrice]));
      settleRecords(priceMap);
      const updated = recordCandidates(list);
      setBtRecords(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setScanning(false);
    }
  }, []);

  function handleBtReset() {
    if (!window.confirm("バックテストデータをすべてリセットしますか？")) return;
    resetRecords();
    setBtRecords([]);
  }

  function handleBtCsv() {
    exportCsv(btRecords);
  }

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (c.shortScore < minScore) return false;
      const d = Math.abs(c.athDropPct);
      if (d < minDrop || d > maxDrop) return false;
      if (c.fundingRate !== null && c.fundingRate * 100 < minFr) return false;
      if (trendFilter === "h4down"  && c.trendH4 !== "DOWN") return false;
      if (trendFilter === "alldown" && c.trendAlignment < 3) return false;
      return true;
    });
  }, [candidates, minScore, minDrop, maxDrop, minFr, trendFilter]);

  useEffect(() => {
    if (tableScrollRef.current && topScrollInnerRef.current) {
      topScrollInnerRef.current.style.width = tableScrollRef.current.scrollWidth + "px";
    }
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Market environment */}
      <MarketEnvironmentPanel />

      {/* Header */}
      <div className="rounded-xl p-4 text-white" style={{ background: `linear-gradient(135deg, #0d3d35 0%, #0f766e 100%)` }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-black" style={{ color: TEAL }}>⚡ Bitget Low-Lev Short Finder</h2>
            <p className="text-xs mt-0.5" style={{ color: "#a7f3d0" }}>
              FR × ATH下落 × 出来高枯渇 × マルチTFトレンドで低レバショート候補をスキャン
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-5 py-2 rounded-lg font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white"
            style={{ background: scanning ? "#475569" : TEAL_DIM }}
          >
            {scanning ? "スキャン中..." : "🔍 スキャン実行"}
          </button>
        </div>

        {scanMeta && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "#6ee7b7" }}>
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
                className="w-full mt-1" style={{ accentColor: TEAL }} />
            </div>
            <div>
              <label className="text-xs text-gray-500">ATH下落 最低 ({minDrop}%)</label>
              <input type="range" min={0} max={90} value={minDrop} onChange={e => setMinDrop(+e.target.value)}
                className="w-full mt-1" style={{ accentColor: TEAL }} />
            </div>
            <div>
              <label className="text-xs text-gray-500">最低FR ({minFr.toFixed(2)}%)</label>
              <input type="range" min={-0.1} max={0.1} step={0.005} value={minFr} onChange={e => setMinFr(+e.target.value)}
                className="w-full mt-1" style={{ accentColor: TEAL }} />
            </div>
            <div>
              <label className="text-xs text-gray-500">トレンド</label>
              <select value={trendFilter} onChange={e => setTrendFilter(e.target.value as typeof trendFilter)}
                className="w-full mt-1 text-xs rounded border border-gray-200 px-2 py-1.5">
                <option value="all">すべて</option>
                <option value="h4down">4H DOWN以上</option>
                <option value="alldown">3TF すべてDOWN</option>
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
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: `${TEAL}40`, borderTopColor: TEAL }} />
          <p className="text-sm text-gray-500">Bitget先物を分析中... (30〜60秒)</p>
        </div>
      )}

      {/* Empty state */}
      {!scanning && candidates.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <div className="text-4xl">⚡</div>
          <p className="text-gray-500 text-sm">スキャンを実行してBitget先物のショート候補を表示</p>
          <p className="text-gray-400 text-xs">FR × L/S比率 × 推奨レバレッジ付きで上位50件を表示</p>
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

      {/* Backtest stats */}
      <BacktestPanel
        records={btRecords}
        stats={btStats}
        onReset={handleBtReset}
        onCsv={handleBtCsv}
      />
    </div>
  );
}
