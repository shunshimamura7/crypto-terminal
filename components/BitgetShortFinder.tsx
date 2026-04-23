"use client";
import React, { useState, useCallback, useMemo } from "react";
import type { BitgetShortCandidate, BitgetShortScoreBreakdown, TrendDir } from "@/app/lib/bitgetScorer";
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

function scoreColor(score: number, max = 30): string {
  const pct = score / max;
  if (pct >= 0.75) return "#f87171"; // red — strong short signal
  if (pct >= 0.55) return "#fb923c"; // orange
  if (pct >= 0.35) return "#facc15"; // yellow
  return "#94a3b8";
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
    { label: "ATH下落", value: bd.dropScore,    max: 6 },
    { label: "FR",      value: bd.frScore,      max: 6 },
    { label: "L/S比率", value: bd.lsRatioScore, max: 6 },
    { label: "OI比率",  value: bd.oiScore,      max: 4 },
    { label: "トレンド", value: bd.trendScore,  max: 5 },
    { label: "急騰度",  value: bd.pumpScore,    max: 3 },
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
  const { tradeSetup, frWeeklyCost, recommendedLev } = c;
  if (!tradeSetup) return null;
  const { entry, sl, tp1, tp2, rrRatio, rrWarning } = tradeSetup;
  return (
    <div className="mt-3 p-3 rounded-lg border" style={{ borderColor: `${TEAL}40`, background: `${TEAL}08` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold" style={{ color: TEAL }}>📐 トレードセットアップ</span>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded font-bold" style={{ background: `${TEAL}20`, color: TEAL }}>
            推奨レバレッジ {recommendedLev}x
          </span>
          {rrWarning && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">R:R低⚠️</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="bg-white rounded p-1.5 text-center">
          <div className="text-gray-500">エントリー</div>
          <div className="font-bold text-gray-800">{fmtPrice(entry)}</div>
        </div>
        <div className="bg-red-50 rounded p-1.5 text-center">
          <div className="text-red-500">損切り SL</div>
          <div className="font-bold text-red-600">{fmtPrice(sl)}</div>
          <div className="text-red-400">{fmtPct((sl - entry) / entry * 100)}</div>
        </div>
        <div className="bg-green-50 rounded p-1.5 text-center">
          <div className="text-green-500">TP1</div>
          <div className="font-bold text-green-600">{fmtPrice(tp1)}</div>
          <div className="text-green-400">{fmtPct((tp1 - entry) / entry * 100)}</div>
        </div>
        <div className="bg-emerald-50 rounded p-1.5 text-center">
          <div className="text-emerald-500">TP2</div>
          <div className="font-bold text-emerald-600">{fmtPrice(tp2)}</div>
          <div className="text-emerald-400">{fmtPct((tp2 - entry) / entry * 100)}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-600">
        <span>R:R <span className={`font-bold ${rrRatio >= 1.5 ? "text-green-600" : "text-amber-600"}`}>{rrRatio.toFixed(2)}</span></span>
        <span>FR週次コスト
          <span className={`font-bold ml-1 ${frWeeklyCost <= 0 ? "text-green-600" : "text-red-500"}`}>
            {frWeeklyCost <= 0 ? "+" : ""}{(-frWeeklyCost).toFixed(3)}%
            {frWeeklyCost <= 0 ? " 受取" : " 支払"}
          </span>
        </span>
      </div>
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
          <div className="text-gray-500">L/S比率</div>
          <div className={`font-semibold ${c.lsRatio !== null && c.lsRatio > 1 ? "text-red-500" : "text-blue-500"}`}>
            {c.lsRatio !== null ? c.lsRatio.toFixed(2) : "—"}
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
  const col = scoreColor(c.shortScore, 30);

  return (
    <>
      <tr
        className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-3 py-2 text-xs text-gray-400 w-8">{rank}</td>
        <td className="px-3 py-2">
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
        <td className="px-3 py-2 text-right">
          <span className="text-sm font-bold" style={{ color: col }}>{c.shortScore}</span>
          <span className="text-xs text-gray-400">/30</span>
        </td>
        <td className="px-3 py-2 text-right text-sm">{fmtPrice(c.currentPrice)}</td>
        <td className="px-3 py-2 text-right text-sm text-red-500 font-semibold">{c.athDropPct.toFixed(1)}%</td>
        <td className="px-3 py-2 text-right text-xs" style={{ color: frColor(c.fundingRate) }}>
          {c.fundingRate !== null ? (c.fundingRate * 100).toFixed(4) + "%" : "—"}
        </td>
        <td className="px-3 py-2 text-right text-xs">
          <span className={`font-semibold ${c.lsRatio !== null && c.lsRatio > 1.2 ? "text-red-500" : "text-gray-600"}`}>
            {c.lsRatio !== null ? c.lsRatio.toFixed(2) : "—"}
          </span>
        </td>
        <td className="px-3 py-2 text-right text-xs">
          <div className="flex justify-end gap-0.5">
            {([c.trendH1, c.trendH4, c.trendD1] as TrendDir[]).map((t, i) => (
              <span key={i} className="text-xs">
                {t === "DOWN" ? "🔴" : t === "UP" ? "🟢" : "⚪"}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-center text-xs text-gray-400">{open ? "▲" : "▼"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="p-0">
            <ExpandedRow c={c} />
          </td>
        </tr>
      )}
    </>
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
      if (c.shortScore < minScore) return false;
      const d = Math.abs(c.athDropPct);
      if (d < minDrop || d > maxDrop) return false;
      if (c.fundingRate !== null && c.fundingRate * 100 < minFr) return false;
      if (trendFilter === "h4down"  && c.trendH4 !== "DOWN") return false;
      if (trendFilter === "alldown" && c.trendAlignment < 3) return false;
      return true;
    });
  }, [candidates, minScore, minDrop, maxDrop, minFr, trendFilter]);

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
              FR高騰 × L/S比率 × ATH下落 × マルチTFトレンドで低レバショート候補をスキャン
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
          <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
            {filtered.length} 件表示（行をクリックで詳細展開）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">銘柄</th>
                  <th className="px-3 py-2 text-right">スコア</th>
                  <th className="px-3 py-2 text-right">価格</th>
                  <th className="px-3 py-2 text-right">ATH比</th>
                  <th className="px-3 py-2 text-right">FR</th>
                  <th className="px-3 py-2 text-right">L/S</th>
                  <th className="px-3 py-2 text-center">TF</th>
                  <th className="px-3 py-2 w-6"></th>
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
