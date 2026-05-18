"use client";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { BitgetLongCandidate, BitgetLongScoreBreakdown, TrendDir } from "@/app/lib/bitgetLongScorer";
import { checkAndUpdateRecords, recordNewCandidates } from "@/app/lib/bitgetBacktestChecker";
import { getRecords, clearRecords } from "@/app/lib/bitgetBacktestStorage";
import type { BitgetBacktestRecord } from "@/app/lib/bitgetBacktestStorage";
import { calculateStats } from "@/app/lib/bitgetBacktestStats";
import type { BitgetBacktestStats } from "@/app/lib/bitgetBacktestStats";

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
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
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

// ─── Backtest Panel ───────────────────────────────────────────────────────────
function btStatusLabel(status: BitgetBacktestRecord["status"]): { label: string; cls: string } {
  switch (status) {
    case "tp3_hit": return { label: "TP3達成", cls: "text-green-700 bg-green-50 border-green-300" };
    case "tp2_hit": return { label: "TP2達成", cls: "text-green-700 bg-green-50 border-green-300" };
    case "tp1_hit": return { label: "TP1達成", cls: "text-green-700 bg-green-50 border-green-200" };
    case "sl_hit":  return { label: "SL損切",  cls: "text-red-700 bg-red-50 border-red-300" };
    case "expired": return { label: "期限切",  cls: "text-gray-500 bg-gray-100 border-gray-300" };
    default:        return { label: "監視中",  cls: "text-yellow-700 bg-yellow-50 border-yellow-300" };
  }
}

function exportBtCSV(records: BitgetBacktestRecord[]): void {
  const hdr = ["Symbol","Score","ScoreMax","RecordedAt","EntryPrice","SL","TP1","TP2","TP3","R:R","Trend","Status","ResolvedAt","ResolvedPrice","PnL%","MaxProfit%","MaxDrawdown%","Days","FR","AthDrop%","RecLev"].join(",");
  const rows = records.map(r => {
    const days = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
    const pnl  = r.resolvedPrice != null ? ((r.resolvedPrice - r.entryPrice) / r.entryPrice * 100).toFixed(2) : "";
    return [
      r.symbol.replace("USDT", ""), r.score, r.scoreMax,
      new Date(r.recordedAt).toISOString(),
      r.entryPrice, r.sl, r.tp1, r.tp2, r.tp3,
      r.rrRatio.toFixed(2), r.trendDirection, r.status,
      r.resolvedAt    ? new Date(r.resolvedAt).toISOString()  : "",
      r.resolvedPrice ?? "", pnl,
      r.maxProfit?.toFixed(2) ?? "", r.maxDrawdown?.toFixed(2) ?? "", days,
      r.fundingRate?.toFixed(6) ?? "", r.athDropPct.toFixed(1), r.recommendedLev,
    ].join(",");
  });
  const blob = new Blob(["﻿" + [hdr, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `bitget-long-backtest-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function BitgetBacktestPanel({
  records, stats, onReset,
}: { records: BitgetBacktestRecord[]; stats: BitgetBacktestStats; onReset: () => void }) {
  const [open,        setOpen]        = useState(true);
  const [showRecords, setShowRecords] = useState(false);
  const [simOpen,     setSimOpen]     = useState(false);
  const [simCapital,  setSimCapital]  = useState(1000);
  const [simPos,      setSimPos]      = useState(100);

  const periodStr = (() => {
    if (!stats.periodStart) return "—";
    const s = fmtDate(stats.periodStart);
    const e = fmtDate(stats.periodEnd ?? Date.now());
    return `${s} 〜 ${e}`;
  })();

  const sorted = [...records].sort((a, b) => b.recordedAt - a.recordedAt);

  return (
    <div className="rounded-xl border border-green-200 bg-white overflow-hidden shadow-sm">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-50 transition-colors">
        <span>
          📊 バックテスト結果（Bitget Long）
          {records.length > 0 && (
            <span className="ml-2 text-xs font-normal text-green-500">
              総数: {records.length} / 勝率: {stats.winRate.toFixed(0)}%
              {stats.active > 0 && <span className="ml-2 text-yellow-600">⏳{stats.active}</span>}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {records.length === 0 ? (
            <p className="text-xs text-gray-400 py-3">スキャン実行でスコア10以上の銘柄が自動記録されます</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">期間: <span className="font-semibold text-gray-700">{periodStr}</span></p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: "総記録",   val: records.length, cls: "text-gray-700" },
                  { label: "決着済",   val: stats.resolved, cls: "text-gray-700" },
                  { label: "監視中",   val: stats.active,   cls: "text-yellow-600 font-bold" },
                  { label: "期限切",   val: stats.expired,  cls: "text-gray-400" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
                    <div className={`text-base font-bold ${s.cls}`}>{s.val}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: "TP達成",  val: `${stats.tp1Hits + stats.tp2Hits + stats.tp3Hits}件`, cls: "text-green-700" },
                  { label: "SL損切",  val: `${stats.slHits}件`,                                  cls: "text-red-600" },
                  { label: "勝率",    val: `${stats.winRate.toFixed(1)}%`,                        cls: stats.winRate >= 50 ? "text-green-700 font-bold" : "text-red-600 font-bold" },
                  { label: "平均R:R", val: stats.avgRR.toFixed(2),                               cls: stats.avgRR >= 0 ? "text-green-700 font-bold" : "text-red-600 font-bold" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
                    <div className={`text-base font-bold ${s.cls}`}>{s.val}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                  <span className="text-gray-500">期待値: </span>
                  <span className={`font-bold ${stats.expectancy >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {stats.expectancy >= 0 ? "+" : ""}{stats.expectancy.toFixed(2)}R
                  </span>
                </div>
                {stats.bestTrade && (
                  <div className="bg-green-50 rounded-lg p-2 border border-green-100">
                    <span className="text-gray-500">最高: </span>
                    <span className="font-mono font-bold text-green-700">{stats.bestTrade.symbol.replace("USDT","")}</span>
                    <span className="text-green-600 ml-1">+{stats.bestTrade.profit.toFixed(1)}%</span>
                  </div>
                )}
                {stats.worstTrade && (
                  <div className="bg-red-50 rounded-lg p-2 border border-red-100">
                    <span className="text-gray-500">最悪: </span>
                    <span className="font-mono font-bold text-red-700">{stats.worstTrade.symbol.replace("USDT","")}</span>
                    <span className="text-red-600 ml-1">-{stats.worstTrade.loss.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {stats.resolved > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">スコア帯別勝率</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                          <th className="px-3 py-1.5 text-left">スコア帯</th>
                          <th className="px-3 py-1.5 text-center">勝ち</th>
                          <th className="px-3 py-1.5 text-center">負け</th>
                          <th className="px-3 py-1.5 text-right">勝率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(stats.byScore).reverse().map(([range, s]) => (
                          <tr key={range} className="border-b border-gray-100 last:border-0">
                            <td className="px-3 py-1.5 font-mono text-gray-700">{range}</td>
                            <td className="px-3 py-1.5 text-center text-green-600 font-bold">{s.wins}</td>
                            <td className="px-3 py-1.5 text-center text-red-500">{s.losses}</td>
                            <td className="px-3 py-1.5 text-right font-bold">
                              <span className={s.winRate >= 50 ? "text-green-700" : s.wins + s.losses > 0 ? "text-red-600" : "text-gray-400"}>
                                {s.wins + s.losses > 0 ? `${s.winRate.toFixed(0)}%` : "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {stats.resolved >= 2 && (() => {
                const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require("recharts") as typeof import("recharts");

                const resolvedRecs = [...records]
                  .filter(r => r.status !== "active" && r.resolvedAt !== null && r.resolvedPrice !== null)
                  .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

                let cumR = 0;
                const equityData = resolvedRecs.map(r => {
                  const exitPrice = r.status === "tp1_hit" ? r.tp1
                                  : r.status === "tp2_hit" ? r.tp2
                                  : r.status === "tp3_hit" ? r.tp3
                                  : r.status === "sl_hit"  ? r.sl
                                  : (r.resolvedPrice ?? r.entryPrice);
                  const risk   = r.entryPrice - r.sl;
                  const realR  = risk > 0 ? (exitPrice - r.entryPrice) / risk : 0;
                  cumR += realR;
                  return { name: r.symbol.replace("USDT",""), r: parseFloat(cumR.toFixed(2)) };
                });

                return (
                  <div className="mt-1">
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">エクイティカーブ</p>
                    <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={equityData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 9 }} unit="R" />
                          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                          <Tooltip formatter={(v) => [`${v}R`, "累積R"]} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="r" stroke={cumR >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <p className="text-[10px] text-gray-400 text-right mt-0.5">
                        累積R: <span className={`font-bold ${cumR >= 0 ? "text-green-600" : "text-red-600"}`}>{cumR >= 0 ? "+" : ""}{cumR.toFixed(2)}R</span>
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-2 rounded-lg border border-emerald-200 overflow-hidden">
                <button onClick={() => setSimOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 transition-colors">
                  <span>💼 ポートフォリオシミュレーション</span>
                  <span className="text-gray-400">{simOpen ? "▲" : "▼"}</span>
                </button>
                {simOpen && (() => {
                  if (stats.resolved < 5) {
                    return <div className="px-3 py-3 text-xs text-gray-400 text-center">決着済み5件以上で表示されます</div>;
                  }

                  const resolvedRecs = [...records]
                    .filter(r => r.status !== "active" && r.resolvedAt !== null && r.resolvedPrice !== null)
                    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

                  let equity = simCapital;
                  let peak = simCapital;
                  let maxDD = 0;
                  const returns: number[] = [];

                  for (const r of resolvedRecs) {
                    const exitPrice = r.status === "tp1_hit" ? r.tp1
                                    : r.status === "tp2_hit" ? r.tp2
                                    : r.status === "tp3_hit" ? r.tp3
                                    : r.status === "sl_hit"  ? r.sl
                                    : (r.resolvedPrice ?? r.entryPrice);
                    const profit = exitPrice - r.entryPrice;
                    const risk   = r.entryPrice - r.sl;
                    const realR  = risk > 0 ? profit / risk : 0;
                    const pnl    = realR * simPos;
                    equity += pnl;
                    returns.push(pnl / (equity - pnl || simCapital));
                    if (equity > peak) peak = equity;
                    const dd = (peak - equity) / peak * 100;
                    if (dd > maxDD) maxDD = dd;
                  }

                  const totalReturn = ((equity - simCapital) / simCapital) * 100;
                  const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
                  const variance = returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / returns.length;
                  const sharpe = variance > 0 ? meanR / Math.sqrt(variance) * Math.sqrt(returns.length) : 0;

                  return (
                    <div className="px-3 py-3 space-y-3 bg-white">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-1">
                            初期資金: <span className="text-emerald-700">${simCapital.toLocaleString()}</span>
                          </label>
                          <input type="range" min={100} max={10000} step={100} value={simCapital}
                            onChange={e => setSimCapital(Number(e.target.value))}
                            className="w-full accent-emerald-500 h-1.5" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-1">
                            1回ポジ: <span className="text-emerald-700">${simPos.toLocaleString()}</span>
                          </label>
                          <input type="range" min={10} max={Math.min(simCapital, 1000)} step={10} value={simPos}
                            onChange={e => setSimPos(Number(e.target.value))}
                            className="w-full accent-emerald-500 h-1.5" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: "現在資産",   val: `$${equity.toLocaleString("en-US",{maximumFractionDigits:0})}`, cls: equity >= simCapital ? "text-green-700" : "text-red-600" },
                          { label: "総リターン", val: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`, cls: totalReturn >= 0 ? "text-green-700" : "text-red-600" },
                          { label: "最大DD",     val: `-${maxDD.toFixed(1)}%`, cls: maxDD > 20 ? "text-red-600 font-bold" : "text-orange-500" },
                          { label: "シャープ比", val: sharpe.toFixed(2), cls: sharpe >= 1 ? "text-green-700" : sharpe >= 0 ? "text-orange-500" : "text-red-600" },
                        ].map(({ label, val, cls }) => (
                          <div key={label} className="rounded-lg border border-gray-200 p-2 text-center bg-gray-50">
                            <div className={`text-sm font-black ${cls}`}>{val}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div>
                <button onClick={() => setShowRecords(v => !v)}
                  className="text-xs text-green-600 hover:text-green-800 font-semibold">
                  全レコード ({records.length}件) {showRecords ? "▲" : "▼"}
                </button>
                {showRecords && (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs min-w-[680px]">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-semibold">
                          <th className="px-2 py-1.5 text-left">銘柄</th>
                          <th className="px-2 py-1.5 text-center">Score</th>
                          <th className="px-2 py-1.5 text-right">日付</th>
                          <th className="px-2 py-1.5 text-right">エントリー</th>
                          <th className="px-2 py-1.5 text-right">SL</th>
                          <th className="px-2 py-1.5 text-right">TP1</th>
                          <th className="px-2 py-1.5 text-right">現在値</th>
                          <th className="px-2 py-1.5 text-center">状態</th>
                          <th className="px-2 py-1.5 text-right">損益</th>
                          <th className="px-2 py-1.5 text-right">日数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(r => {
                          const { label, cls } = btStatusLabel(r.status);
                          const resolvedPnl = r.resolvedPrice != null
                            ? ((r.resolvedPrice - r.entryPrice) / r.entryPrice * 100)
                            : null;
                          const currentPnl = r.currentPrice != null
                            ? ((r.currentPrice - r.entryPrice) / r.entryPrice * 100)
                            : null;
                          const pnl = resolvedPnl ?? currentPnl;
                          const days = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
                          return (
                            <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-2 py-1.5 font-mono font-bold text-gray-800">{r.symbol.replace("USDT","")}</td>
                              <td className="px-2 py-1.5 text-center text-gray-600">{r.score}/{r.scoreMax}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{fmtDate(r.recordedAt)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-gray-700">{fmtPrice(r.entryPrice)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-red-500">{fmtPrice(r.sl)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-green-600">{fmtPrice(r.tp1)}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-gray-600">
                                {r.currentPrice != null ? fmtPrice(r.currentPrice) : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>
                              </td>
                              <td className={`px-2 py-1.5 text-right font-mono font-bold ${pnl == null ? "text-gray-400" : pnl >= 0 ? "text-green-600" : "text-red-500"}`}>
                                {pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{days}d</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => exportBtCSV(records)}
                  className="px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                  CSVエクスポート
                </button>
                <button onClick={() => { if (window.confirm("バックテストデータをリセットしますか？")) onReset(); }}
                  className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  リセット
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
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

  // Backtest
  const [btRecords, setBtRecords] = useState<BitgetBacktestRecord[]>([]);
  const btStats = useMemo(() => calculateStats(btRecords), [btRecords]);

  // Dual scrollbar refs
  const tableScrollRef    = useRef<HTMLDivElement | null>(null);
  const topScrollRef      = useRef<HTMLDivElement | null>(null);
  const topScrollInnerRef = useRef<HTMLDivElement | null>(null);

  // Load backtest records on mount
  useEffect(() => { setBtRecords(getRecords()); }, []);

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
      const cands = json.candidates ?? [];
      setCandidates(cands);
      setScanMeta(json.meta ?? null);
      setScanTime(json.scanTime ?? null);

      // Backtest: check先 → record後
      checkAndUpdateRecords(cands);
      recordNewCandidates(cands);
      setBtRecords(getRecords());
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

      {/* Backtest Panel */}
      <BitgetBacktestPanel
        records={btRecords}
        stats={btStats}
        onReset={() => { clearRecords(); setBtRecords([]); }}
      />

      {/* Table */}
      {!scanning && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
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
            className="overflow-x-auto"
            style={{ overflowX: "auto" }}
            onScroll={e => {
              if (topScrollRef.current) topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }}
          >
            <table className="table-auto text-xs" style={{ minWidth: "1100px", width: "100%" }}>
              <thead style={{ whiteSpace: "nowrap" }}>
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
              <tbody style={{ whiteSpace: "nowrap" }}>
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
