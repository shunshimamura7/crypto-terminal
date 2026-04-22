"use client";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { ShortCandidate, ShortScoreBreakdown } from "@/app/lib/shortScorer";
import { calcExclusivityScore } from "@/app/lib/shortScorer";
import {
  saveSnapshot, getSnapshots,
  getConsecutivePositiveFR,
} from "@/app/lib/snapshotStorage";
import type { ScanSnapshot } from "@/app/lib/snapshotStorage";
import { detectAlerts, getDiffSummary } from "@/app/lib/snapshotDiff";
import type { DiffAlert } from "@/app/lib/snapshotDiff";
import { fetchCoinGeckoData, calcFuturesHeatScore, calcSnsHeatScore } from "@/app/lib/coinGeckoClient";
import type { CgMarketData } from "@/app/lib/coinGeckoClient";
import MarketEnvironmentPanel from "@/components/MarketEnvironmentPanel";

// ─── Extended candidate with client-side scores ───────────────────────────────
interface ExtendedCandidate extends ShortCandidate {
  listedOnBinance: boolean;
  listedOnBybit: boolean;
  exclusivityScore: number;   // 0-2 (施策2)
  frBonus: number;            // 0-1 (施策4)
  cgData: CgMarketData | null; // 施策7
  futuresHeatScore: number;   // 0-2 (施策7)
  snsHeatScore: number;       // 0-1 (施策7)
  displayScore: number;       // max 22 (with CG) or 19 (without)
}

interface ScanResponse {
  success: boolean;
  scanTime: string;
  candidates: ShortCandidate[];
  meta: { totalTickerPairs?: number; totalScanned?: number; filtered: number; stage1Passed?: number; stage2Fetched?: number; stage2Failed?: number };
  error?: string;
  mode?: string;
}

// ─── Score system ─────────────────────────────────────────────────────────────
// Server max: 16 (drop3+volDry3+fr2+fresh2+oi2+trend2+pump2)
// Client max: +2 exclusivity + 1 frBonus + 2 futuresHeat + 1 snsHeat = 22 total
const CG_API_KEY = process.env.NEXT_PUBLIC_COINGECKO_API_KEY ?? "";
const HAS_CG = CG_API_KEY.length > 0;
const DISPLAY_MAX = HAS_CG ? 22 : 19;

type SortKey = "displayScore" | "athDropPct" | "priceChange24h" | "priceChange7d" | "openInterest";

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (!n) return "—";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01)   return `$${n.toFixed(6)}`;
  if (n < 1)      return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtVol(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function scoreBadgeStyle(s: number): React.CSSProperties {
  const bg    = s >= 10 ? "#fef2f2" : s >= 6 ? "#fff7ed" : "#f9fafb";
  const color = s >= 10 ? "#b91c1c" : s >= 6 ? "#c2410c" : "#6b7280";
  const border = s >= 10 ? "#fca5a5" : s >= 6 ? "#fdba74" : "#d1d5db";
  return {
    background: bg, color, border: `1px solid ${border}`,
    borderRadius: "9999px", padding: "2px 10px", fontWeight: 900,
    fontSize: "12px", display: "inline-block", whiteSpace: "nowrap",
  };
}

const SCORE_BARS: Array<{
  key: keyof ShortScoreBreakdown;
  label: string;
  max: number;
  color: string;
}> = [
  { key: "dropScore",      label: "ATH下落",    max: 3, color: "#ef4444" },
  { key: "volumeDryScore", label: "出来高枯渇",  max: 3, color: "#f97316" },
  { key: "frScore",        label: "FR逆張り",   max: 2, color: "#a855f7" },
  { key: "freshnessScore", label: "上場新しさ",  max: 2, color: "#3b82f6" },
  { key: "oiScore",        label: "OI過剰",     max: 2, color: "#06b6d4" },
  { key: "trendScore",     label: "EMAトレンド", max: 2, color: "#10b981" },
  { key: "pumpScore",      label: "7d急騰",     max: 2, color: "#f43f5e" },
];

// ─── 流動性警告バッジ (施策5) ─────────────────────────────────────────────────
function LiquidityBadge({ oi }: { oi: number }) {
  if (oi < 10_000) {
    return (
      <span
        title="OIが極端に低く、エントリー/エグジットが困難"
        className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-bold whitespace-nowrap cursor-help"
      >
        🔴流動性危険
      </span>
    );
  }
  if (oi < 50_000) {
    return (
      <span
        title="OIが低く、流動性に注意が必要"
        className="text-[9px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 border border-yellow-300 font-bold whitespace-nowrap cursor-help"
      >
        🟡流動性注意
      </span>
    );
  }
  return null;
}

// ─── Exchange badge ───────────────────────────────────────────────────────────
function ExchangeBadges({ c }: { c: ExtendedCandidate }) {
  if (c.exclusivityScore === 2) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold whitespace-nowrap">
        MEXCのみ
      </span>
    );
  }
  return (
    <span className="text-[10px] text-gray-400 whitespace-nowrap">
      {c.listedOnBinance && <span className="mr-1 text-yellow-600">+BN</span>}
      {c.listedOnBybit   && <span className="text-blue-600">+BB</span>}
    </span>
  );
}

// ─── Alert badge ──────────────────────────────────────────────────────────────
const SEVERITY_COLOR: Record<string, string> = {
  high:   "bg-red-100 text-red-700 border-red-300",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-300",
  low:    "bg-gray-100 text-gray-600 border-gray-200",
};

// ─── Score Detail Panel ───────────────────────────────────────────────────────
function ScoreDetail({
  c,
  snapshots,
  alerts,
}: {
  c: ExtendedCandidate;
  snapshots: ScanSnapshot[];
  alerts: DiffAlert[];
}) {
  const diff = getDiffSummary(c.symbol, c, snapshots);
  const symAlerts = alerts.filter(a => a.symbol === c.symbol);

  return (
    <tr>
      <td colSpan={HAS_CG ? 15 : 12} className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        {/* Alert strip */}
        {symAlerts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {symAlerts.map((a, i) => (
              <span key={i} className={`text-xs px-2 py-0.5 rounded border ${SEVERITY_COLOR[a.severity]}`}>
                🔔 {a.message}
              </span>
            ))}
          </div>
        )}

        {/* Score bars (server-side) */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-3">
          {SCORE_BARS.map(bar => (
            <div key={bar.key}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{bar.label}</span>
                <span className="font-bold">{c.scoreBreakdown[bar.key]}/{bar.max}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${(c.scoreBreakdown[bar.key] / bar.max) * 100}%`,
                    background: bar.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Client-side score additions */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>取引所独占度</span>
              <span className="font-bold">{c.exclusivityScore}/2</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="h-2 rounded-full transition-all bg-green-500"
                style={{ width: `${(c.exclusivityScore / 2) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>FR連続ボーナス</span>
              <span className="font-bold">{c.frBonus}/1</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="h-2 rounded-full transition-all bg-violet-500"
                style={{ width: `${c.frBonus * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Data grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-600">
          <div>ATH(14日): <span className="font-mono font-semibold text-gray-800">{fmtPrice(c.ath14d)}</span></div>
          <div>7日平均出来高: <span className="font-mono font-semibold text-gray-800">{fmtVol(c.volumeAvg7d)}</span></div>
          <div>OI: <span className="font-mono font-semibold text-gray-800">{fmtVol(c.openInterest)}</span></div>
          <div>OI/Vol: <span className={`font-mono font-semibold ${c.oiRatio > 3 ? "text-red-600" : c.oiRatio > 1.5 ? "text-orange-600" : "text-gray-800"}`}>
            {c.oiRatio.toFixed(2)}×
          </span></div>
          <div>24h変動: <span className={`font-mono font-semibold ${c.priceChange24h >= 50 ? "text-red-600" : c.priceChange24h <= -30 ? "text-green-600" : "text-gray-700"}`}>
            {fmtPct(c.priceChange24h)}
          </span></div>
          <div>7d変動: <span className={`font-mono font-semibold ${c.priceChange7d >= 100 ? "text-red-700 font-bold" : c.priceChange7d >= 50 ? "text-red-500" : c.priceChange7d <= -30 ? "text-green-600" : "text-gray-700"}`}>
            {fmtPct(c.priceChange7d)}
          </span></div>
        </div>

        {/* CoinGecko データ (施策7) */}
        {HAS_CG && c.cgData && (() => {
          const cg = c.cgData;
          const snsTotal = (cg.twitterFollowers ?? 0) + (cg.telegramMembers ?? 0);
          const futuresRatio = cg.spotVolume ? ((c.volume24h / cg.spotVolume) * 100) : null;
          return (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs font-semibold text-violet-700 mb-2">📊 CoinGecko データ</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-600">
                <div>時価総額: <span className="font-mono font-semibold text-gray-800">{cg.marketCap ? fmtVol(cg.marketCap) : "N/A"}</span></div>
                <div>FDV: <span className="font-mono font-semibold text-gray-800">{cg.fdv ? fmtVol(cg.fdv) : "N/A"}</span></div>
                <div>現物出来高: <span className="font-mono font-semibold text-gray-800">{cg.spotVolume ? fmtVol(cg.spotVolume) : "N/A"}</span></div>
                <div>先物/現物:
                  <span className={`ml-1 font-mono font-semibold ${futuresRatio && futuresRatio > 500 ? "text-red-600" : futuresRatio && futuresRatio > 200 ? "text-orange-500" : "text-gray-800"}`}>
                    {futuresRatio != null ? `${futuresRatio.toFixed(0)}%` : "N/A"}
                  </span>
                </div>
                <div>Twitter: <span className="font-mono font-semibold text-gray-800">{cg.twitterFollowers != null ? cg.twitterFollowers.toLocaleString() : "N/A"}</span></div>
                <div>Telegram: <span className="font-mono font-semibold text-gray-800">{cg.telegramMembers != null ? cg.telegramMembers.toLocaleString() : "N/A"}</span></div>
                <div>SNS合計: <span className="font-mono font-semibold text-gray-800">{snsTotal > 0 ? snsTotal.toLocaleString() : "N/A"}</span></div>
                {cg.mexcSharePct != null && (
                  <div>MEXC集中: <span className={`font-mono font-semibold ${cg.mexcSharePct >= 90 ? "text-red-600" : "text-gray-800"}`}>
                    {cg.mexcSharePct.toFixed(1)}%{cg.mexcSharePct >= 90 ? " 🔴" : ""}
                  </span></div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>先物過熱度</span>
                    <span className="font-bold">{c.futuresHeatScore}/2</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="h-2 rounded-full bg-rose-500" style={{ width: `${(c.futuresHeatScore / 2) * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>SNS過熱ボーナス</span>
                    <span className="font-bold">{c.snsHeatScore}/1</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="h-2 rounded-full bg-pink-400" style={{ width: `${c.snsHeatScore * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Volume Profile (施策8) */}
        {c.volumeProfile && (() => {
          const vp = c.volumeProfile!;
          const maxVol = Math.max(...vp.buckets.map(b => b.vol));
          const pocIdx = vp.buckets.findIndex(b => Math.abs((b.low + b.high) / 2 - vp.poc) < (b.high - b.low) * 0.6);
          return (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <p className="text-xs font-semibold text-gray-700">📊 出来高プロファイル (VPCR)</p>
                <span className="text-xs text-gray-500">
                  POC: <span className="font-mono font-bold text-indigo-600">{fmtPrice(vp.poc)}</span>
                  <span className={`ml-2 font-semibold ${vp.pocVsPricePct > 0 ? "text-red-500" : "text-green-600"}`}>
                    ({vp.pocVsPricePct > 0 ? "+" : ""}{vp.pocVsPricePct.toFixed(1)}% 現在価格比)
                  </span>
                </span>
              </div>
              <div className="space-y-0.5">
                {[...vp.buckets].reverse().map((b, ri) => {
                  const fi = vp.buckets.length - 1 - ri;
                  const isPoc = fi === pocIdx;
                  const barPct = maxVol > 0 ? (b.vol / maxVol) * 100 : 0;
                  const isCurrentPrice = c.currentPrice >= b.low && c.currentPrice < b.high;
                  return (
                    <div key={ri} className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 text-right font-mono text-gray-500 shrink-0">
                        {fmtPrice((b.low + b.high) / 2)}
                      </span>
                      <div className="flex-1 h-3 bg-gray-100 rounded relative overflow-hidden">
                        <div
                          className={`h-full rounded ${isPoc ? "bg-indigo-500" : "bg-blue-300"}`}
                          style={{ width: `${barPct}%` }}
                        />
                        {isCurrentPrice && (
                          <div className="absolute inset-y-0 left-0 w-full flex items-center">
                            <div className="w-full border-t-2 border-dashed border-yellow-500 opacity-80" />
                          </div>
                        )}
                      </div>
                      {isPoc && <span className="text-indigo-600 font-bold shrink-0">POC</span>}
                      {isCurrentPrice && <span className="text-yellow-600 font-bold shrink-0">←現在</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 前回比 (施策3) */}
        {diff && (
          <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-3 gap-3 text-xs text-gray-500">
            <div>
              前回比スコア:{" "}
              <span className={`font-semibold ${diff.scoreDiff > 0 ? "text-red-600" : diff.scoreDiff < 0 ? "text-green-600" : "text-gray-600"}`}>
                {diff.scoreDiff > 0 ? "+" : ""}{diff.scoreDiff}
              </span>
            </div>
            {diff.oiDiff !== null && (
              <div>OI変化:{" "}
                <span className={`font-semibold ${diff.oiDiff > 0 ? "text-orange-600" : "text-gray-600"}`}>
                  {diff.oiDiff > 0 ? "+" : ""}{diff.oiDiff.toFixed(0)}%
                </span>
              </div>
            )}
            {diff.frDiff !== null && (
              <div>FR変化:{" "}
                <span className={`font-semibold ${diff.frDiff > 0 ? "text-purple-600" : "text-gray-600"}`}>
                  {diff.frDiff > 0 ? "+" : ""}{diff.frDiff.toFixed(4)}%
                </span>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Alert Panel ──────────────────────────────────────────────────────────────
function AlertPanel({ alerts }: { alerts: DiffAlert[] }) {
  const [open, setOpen] = useState(true);
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-yellow-800 hover:bg-yellow-100 transition-colors"
      >
        <span>🔔 アラート ({alerts.length}件)</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1.5">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs px-2.5 py-1.5 rounded border ${SEVERITY_COLOR[a.severity]}`}>
              <span className="font-mono font-bold shrink-0">{a.symbol.replace("_USDT", "")}</span>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sortable header cell ─────────────────────────────────────────────────────
function SortTh({
  label, sortKey, current, onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className="px-3 py-2.5 text-right cursor-pointer select-none hover:text-indigo-600 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      {label}{active ? " ▼" : ""}
    </th>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ShortScanner() {
  const [data, setData]       = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh]   = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 施策2: Binance / Bybit symbols
  const [binanceSyms, setBinanceSyms] = useState<Set<string>>(new Set());
  const [bybitSyms,   setBybitSyms]   = useState<Set<string>>(new Set());

  // 施策3: snapshots
  const [snapshots, setSnapshots] = useState<ScanSnapshot[]>([]);

  // Filter state
  const [minDrop,     setMinDrop]     = useState(30);
  const [maxVolRatio, setMaxVolRatio] = useState(70);
  const [maxDays,     setMaxDays]     = useState(365);
  const [minVol24k,   setMinVol24k]   = useState(100);
  const [minOiK,      setMinOiK]      = useState(0);   // 施策5: 最低OI ($K)

  // Sort state (施策6)
  const [sortBy, setSortBy] = useState<SortKey>("displayScore");

  // 施策7: CoinGecko data
  const [cgMap, setCgMap]       = useState<Map<string, CgMarketData>>(new Map());
  const [cgLoading, setCgLoading] = useState(false);
  const [cgProgress, setCgProgress] = useState(0);

  // Load snapshots on mount
  useEffect(() => { setSnapshots(getSnapshots()); }, []);

  // 施策2: Fetch exchange listings on mount
  useEffect(() => {
    fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")
      .then(r => r.json())
      .then((d: { symbols?: Array<{ baseAsset: string }> }) => {
        setBinanceSyms(new Set((d.symbols ?? []).map(s => s.baseAsset.toUpperCase())));
      })
      .catch(e => console.warn("[short-scan] Binance fetch failed:", e));

    fetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000")
      .then(r => r.json())
      .then((d: { result?: { list?: Array<{ baseCoin: string }> } }) => {
        setBybitSyms(new Set((d.result?.list ?? []).map(s => s.baseCoin.toUpperCase())));
      })
      .catch(e => console.warn("[short-scan] Bybit fetch failed:", e));
  }, []);

  const scan = useCallback(async (mode?: "new30") => {
    setLoading(true);
    setError("");
    setExpandedRows(new Set());
    if (mode === "new30") {
      setMinDrop(10);
      setMaxVolRatio(150);
      setMinVol24k(10);
      setMaxDays(30);
      setMinOiK(0);
    }
    try {
      const url = mode === "new30" ? "/api/short-scan?mode=new30" : "/api/short-scan";
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      const json: ScanResponse = await res.json();
      if (!json.success) throw new Error(json.error || "スキャン失敗");
      setData(json);

      // 施策3: スナップショット保存
      const snap: ScanSnapshot = {
        timestamp: Date.now(),
        data: Object.fromEntries(
          json.candidates.map(c => [c.symbol, {
            score: c.shortScore,
            athDrop: c.athDropPct,
            volRatio: c.volumeChangeRatio,
            fr: c.fundingRate,
            oi: c.openInterest,
            price: c.currentPrice,
          }])
        ),
      };
      saveSnapshot(snap);
      setSnapshots(getSnapshots());

      // 施策7: CoinGecko enrichment（APIキー設定時のみ、スコア上位20件）
      if (HAS_CG && json.candidates.length > 0) {
        const top20 = json.candidates.slice(0, 20).map(c => c.symbol);
        setCgLoading(true);
        setCgProgress(0);
        fetchCoinGeckoData(top20, CG_API_KEY, (done, total) => {
          setCgProgress(Math.round(done / total * 100));
        }).then(map => {
          setCgMap(map);
          console.log("[CoinGecko] enriched", map.size, "symbols");
        }).catch(e => {
          console.warn("[CoinGecko] fetch failed:", e);
        }).finally(() => {
          setCgLoading(false);
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  function handleAutoRefresh() {
    if (autoRefresh) {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
      setAutoRefresh(false);
    } else {
      setAutoRefresh(true);
      autoTimerRef.current = setInterval(() => scan(), 5 * 60 * 1000);
    }
  }

  useEffect(() => () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); }, []);

  // Client-side filter + extension
  const extended = useMemo((): ExtendedCandidate[] => {
    if (!data?.candidates) return [];

    const filtered = data.candidates.filter(c =>
      Math.abs(c.athDropPct) >= minDrop &&
      c.volumeChangeRatio * 100 <= maxVolRatio &&
      c.listedDaysAgo <= maxDays &&
      c.volume24h >= minVol24k * 1_000 &&
      c.openInterest >= minOiK * 1_000  // 施策5
    );

    const mapped: ExtendedCandidate[] = filtered.map(c => {
      const base = c.symbol.replace(/_USDT$/, "");
      const listedOnBinance  = binanceSyms.has(base);
      const listedOnBybit    = bybitSyms.has(base);
      const exclusivityScore = calcExclusivityScore(listedOnBinance, listedOnBybit);
      const consecutivePositive = getConsecutivePositiveFR(c.symbol, snapshots);
      const frBonus = (c.fundingRate !== null && c.fundingRate > 0 && consecutivePositive >= 3) ? 1 : 0;
      const cgData = cgMap.get(c.symbol) ?? null;
      const futuresHeatScore = cgData
        ? calcFuturesHeatScore(c.volume24h, cgData.spotVolume)
        : 0;
      const snsHeatScore = cgData
        ? calcSnsHeatScore(cgData.twitterFollowers, cgData.telegramMembers, c.priceChange7d)
        : 0;
      const displayScore = c.shortScore + exclusivityScore + frBonus + futuresHeatScore + snsHeatScore;
      return { ...c, listedOnBinance, listedOnBybit, exclusivityScore, frBonus, cgData, futuresHeatScore, snsHeatScore, displayScore };
    });

    // 施策6: ソート
    return mapped.sort((a, b) => {
      switch (sortBy) {
        case "athDropPct":     return a.athDropPct - b.athDropPct;         // 最も下落 = 先頭
        case "priceChange24h": return b.priceChange24h - a.priceChange24h; // 最も急騰 = 先頭
        case "priceChange7d":  return b.priceChange7d - a.priceChange7d;
        case "openInterest":   return b.openInterest - a.openInterest;
        default:               return b.displayScore - a.displayScore;
      }
    });
  }, [data, minDrop, maxVolRatio, maxDays, minVol24k, minOiK, binanceSyms, bybitSyms, snapshots, sortBy, cgMap]);

  // 施策3: アラート検知
  const alerts = useMemo(() => detectAlerts(data?.candidates ?? [], snapshots), [data, snapshots]);

  function toggleRow(symbol: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  function exportCSV() {
    if (!extended.length) return;
    const hdr = [
      "Symbol","DisplayScore","BaseScore","ATH Drop%","Vol Ratio",
      "24h%","7d%","FR","Vol24h","Avg7d Vol","List Days","OI","OI/Vol",
      "Exclusivity","FRBonus","OnBinance","OnBybit"
    ].join(",");
    const rows = extended.map(c => [
      c.symbol, c.displayScore, c.shortScore,
      c.athDropPct.toFixed(2), c.volumeChangeRatio.toFixed(3),
      c.priceChange24h.toFixed(2), c.priceChange7d.toFixed(2),
      c.fundingRate != null ? (c.fundingRate * 100).toFixed(4) : "",
      c.volume24h.toFixed(0), c.volumeAvg7d.toFixed(0), c.listedDaysAgo,
      c.openInterest.toFixed(0), c.oiRatio.toFixed(2),
      c.exclusivityScore, c.frBonus,
      c.listedOnBinance ? "yes" : "no", c.listedOnBybit ? "yes" : "no",
    ].join(","));
    const blob = new Blob(["﻿" + [hdr, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `mexc-short-scan-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  const totalScanned = data?.meta.totalTickerPairs ?? data?.meta.totalScanned ?? 0;

  return (
    <div className="space-y-4">

      {/* ── Market Environment Panel (施策9) ── */}
      <MarketEnvironmentPanel cgApiKey={HAS_CG ? CG_API_KEY : undefined} />

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800">🎯 MEXC Short Scanner</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            ATH急落 × 出来高枯渇 × FR × OI × 取引所独占度 × 急騰検知でショート候補を自動スキャン
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCSV} disabled={extended.length === 0}
            className="px-3 py-1.5 text-xs bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-300 rounded-lg text-gray-600 transition-colors">
            📥 CSV出力
          </button>
          <button onClick={handleAutoRefresh}
            className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
              autoRefresh ? "bg-indigo-50 text-indigo-700 border-indigo-300" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}>
            ⏱ 自動更新 {autoRefresh ? "ON" : "OFF"}
          </button>
          <button onClick={() => scan()} disabled={loading}
            className="px-4 py-1.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white rounded-lg transition-colors">
            {loading ? "⏳ スキャン中..." : "🔍 スキャン実行"}
          </button>
          <button onClick={() => scan("new30")} disabled={loading}
            className="px-4 py-1.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white rounded-lg transition-colors">
            {loading ? "⏳ スキャン中..." : "🆕 新規上場30日スキャン"}
          </button>
        </div>
      </div>

      {/* ── Filters (施策5: 5列) ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-5 gap-y-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            ATH下落率 ≥ <span className="text-red-600">{minDrop}%</span>
          </label>
          <input type="range" min={10} max={80} step={5} value={minDrop}
            onChange={e => setMinDrop(+e.target.value)} className="w-full accent-red-500" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            出来高比率 ≤ <span className="text-orange-600">{(maxVolRatio / 100).toFixed(2)}</span>
          </label>
          <input type="range" min={10} max={150} step={5} value={maxVolRatio}
            onChange={e => setMaxVolRatio(+e.target.value)} className="w-full accent-orange-500" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            上場日数 ≤ <span className="text-blue-600">{maxDays}日</span>
          </label>
          <input type="range" min={1} max={365} step={1} value={maxDays}
            onChange={e => setMaxDays(+e.target.value)} className="w-full accent-blue-500" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            最低出来高 ≥ <span className="text-green-600">${minVol24k}K</span>
          </label>
          <input type="range" min={1} max={1000} step={1} value={minVol24k}
            onChange={e => setMinVol24k(+e.target.value)} className="w-full accent-green-500" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            最低OI ≥ <span className="text-cyan-600">${minOiK}K</span>
          </label>
          <input type="range" min={0} max={1000} step={10} value={minOiK}
            onChange={e => setMinOiK(+e.target.value)} className="w-full accent-cyan-500" />
        </div>
      </div>

      {/* ── Alerts (施策3) ── */}
      <AlertPanel alerts={alerts} />

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          ❌ {error}
        </div>
      )}

      {/* ── Scan stats ── */}
      {data && !loading && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>スキャン対象: <strong className="text-gray-700">{totalScanned}銘柄</strong></span>
          <span>フィルター通過: <strong className="text-indigo-600">{data.meta.filtered}銘柄</strong></span>
          <span>表示中: <strong className="text-gray-700">{extended.length}銘柄</strong></span>
          {data.mode === "new30" && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">新規上場モード</span>}
          {snapshots.length > 0 && (
            <span>スナップショット: <strong className="text-teal-600">{snapshots.length}件</strong></span>
          )}
          {HAS_CG && cgLoading && (
            <span className="text-violet-600">CoinGecko取得中... {cgProgress}%</span>
          )}
          {HAS_CG && !cgLoading && cgMap.size > 0 && (
            <span className="text-violet-600">CG: <strong>{cgMap.size}件</strong></span>
          )}
          <span className="ml-auto">最終更新: {new Date(data.scanTime).toLocaleTimeString("ja-JP")}</span>
        </div>
      )}

      {/* ── Empty / loading ── */}
      {!loading && !data && !error && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3 text-gray-300">🎯</div>
          <p className="text-sm text-gray-500">「スキャン実行」でMEXC先物の銘柄を分析します</p>
          <p className="text-xs text-gray-400 mt-1">スコア上位TOP20を表示。スコア満点: {DISPLAY_MAX}点</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-16">
          <div className="animate-spin text-3xl mb-3">⚙️</div>
          <p className="text-sm text-gray-500">MEXCのデータを取得・分析中...</p>
          <p className="text-xs text-gray-400 mt-1">30秒ほどかかる場合があります</p>
        </div>
      )}

      {!loading && data && extended.length === 0 && (
        <div className="text-center py-12">
          <div className="text-3xl mb-2 text-gray-300">🔍</div>
          <p className="text-sm text-gray-500">フィルター条件に合う銘柄が見つかりません</p>
          <p className="text-xs text-gray-400 mt-1">スライダーを調整してみてください</p>
        </div>
      )}

      {/* ── Results table ── */}
      {!loading && extended.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
            <span className="font-semibold text-gray-600">スコア凡例 (/{DISPLAY_MAX}):</span>
            <span style={{ color: "#b91c1c", fontWeight: 700 }}>■ 10以上: 強いショート候補</span>
            <span style={{ color: "#c2410c", fontWeight: 700 }}>■ 6-9: 中程度</span>
            <span style={{ color: "#6b7280" }}>■ 5以下: 弱い</span>
            <span className="ml-auto text-gray-400">列ヘッダーをクリックでソート</span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white border-b border-gray-200 text-xs font-semibold text-gray-600">
                <th className="px-3 py-2.5 text-left">銘柄</th>
                <th className="px-3 py-2.5 text-center cursor-pointer hover:text-indigo-600"
                  onClick={() => setSortBy("displayScore")}>
                  スコア{sortBy === "displayScore" ? " ▼" : ""}
                </th>
                <th className="px-3 py-2.5 text-right">価格</th>
                <th className="px-3 py-2.5 text-right cursor-pointer hover:text-indigo-600"
                  onClick={() => setSortBy("athDropPct")}>
                  ATH比{sortBy === "athDropPct" ? " ▼" : ""}
                </th>
                <th className="px-3 py-2.5 text-right">出来高比</th>
                <SortTh label="24h変動" sortKey="priceChange24h" current={sortBy} onSort={setSortBy} />
                <SortTh label="7d変動"  sortKey="priceChange7d"  current={sortBy} onSort={setSortBy} />
                <th className="px-3 py-2.5 text-right">FR</th>
                <SortTh label="OI"      sortKey="openInterest"   current={sortBy} onSort={setSortBy} />
                <th className="px-3 py-2.5 text-right">24h出来高</th>
                {HAS_CG && <th className="px-3 py-2.5 text-right">現物Vol</th>}
                {HAS_CG && <th className="px-3 py-2.5 text-right">先/現</th>}
                {HAS_CG && <th className="px-3 py-2.5 text-right">SNS</th>}
                <th className="px-3 py-2.5 text-right">上場</th>
                <th className="px-3 py-2.5 text-center">取引所</th>
              </tr>
            </thead>
            <tbody>
              {extended.map(c => {
                const isOpen   = expandedRows.has(c.symbol);
                const base     = c.symbol.replace(/_USDT$/, "");
                const frPct    = c.fundingRate != null ? c.fundingRate * 100 : null;
                const hasAlert = alerts.some(a => a.symbol === c.symbol);
                const pct24    = c.priceChange24h;
                const pct7d    = c.priceChange7d;
                return (
                  <React.Fragment key={c.symbol}>
                    <tr
                      onClick={() => toggleRow(c.symbol)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      {/* 銘柄 */}
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <div>
                            <span className="font-mono font-bold text-gray-800">{base}</span>
                            <span className="text-gray-400 text-xs">/USDT</span>
                            {hasAlert && <span className="ml-1 text-xs">🔔</span>}
                            <span className="ml-1 text-xs text-gray-400">{isOpen ? "▲" : "▼"}</span>
                            <span className={`ml-1 text-[10px] font-bold ${
                              c.trendDirection === "DOWN" ? "text-red-500" :
                              c.trendDirection === "UP"   ? "text-green-600" : "text-gray-400"
                            }`}>
                              {c.trendDirection === "DOWN" ? "▼" : c.trendDirection === "UP" ? "▲" : "→"}
                            </span>
                          </div>
                          <LiquidityBadge oi={c.openInterest} />
                        </div>
                      </td>

                      {/* スコア */}
                      <td className="px-3 py-2.5 text-center">
                        <span style={scoreBadgeStyle(c.displayScore)}>
                          {c.displayScore}/{DISPLAY_MAX}
                        </span>
                      </td>

                      {/* 価格 */}
                      <td className="px-3 py-2.5 text-right font-mono text-gray-700">
                        {fmtPrice(c.currentPrice)}
                      </td>

                      {/* ATH比 */}
                      <td className="px-3 py-2.5 text-right font-bold text-red-600">
                        {c.athDropPct.toFixed(1)}%
                      </td>

                      {/* 出来高比 */}
                      <td className="px-3 py-2.5 text-right text-orange-600">
                        {c.volumeChangeRatio.toFixed(2)}×
                      </td>

                      {/* 24h変動 (施策6) */}
                      <td className={`px-3 py-2.5 text-right text-xs font-mono font-bold ${
                        pct24 >= 50  ? "text-red-600" :
                        pct24 >= 20  ? "text-orange-500" :
                        pct24 <= -30 ? "text-green-600" : "text-gray-500"
                      }`}>
                        {fmtPct(pct24)}
                      </td>

                      {/* 7d変動 (施策6) */}
                      <td className={`px-3 py-2.5 text-right text-xs font-mono font-bold ${
                        pct7d >= 100 ? "text-red-700" :
                        pct7d >= 50  ? "text-red-500" :
                        pct7d <= -30 ? "text-green-600" : "text-gray-500"
                      }`}>
                        {fmtPct(pct7d)}
                        {pct7d >= 100 && <span className="ml-0.5 text-[9px]">🚀</span>}
                      </td>

                      {/* FR */}
                      <td className={`px-3 py-2.5 text-right text-xs font-mono ${
                        frPct == null  ? "text-gray-400" :
                        frPct > 0.01  ? "text-purple-600 font-bold" :
                        frPct > 0     ? "text-purple-500" : "text-green-600"
                      }`}>
                        {frPct != null ? `${frPct >= 0 ? "+" : ""}${frPct.toFixed(4)}%` : "—"}
                        {c.frBonus > 0 && <span className="ml-0.5 text-violet-500">★</span>}
                      </td>

                      {/* OI */}
                      <td className={`px-3 py-2.5 text-right text-xs font-mono ${
                        c.openInterest < 10_000  ? "text-red-600 font-bold" :
                        c.openInterest < 50_000  ? "text-yellow-600" :
                        c.oiRatio > 3            ? "text-red-600 font-bold" :
                        c.oiRatio > 1.5          ? "text-orange-500" : "text-gray-600"
                      }`}>
                        {fmtVol(c.openInterest)}
                        <span className="text-gray-400 ml-0.5">{c.oiRatio.toFixed(1)}×</span>
                      </td>

                      {/* 24h出来高 */}
                      <td className="px-3 py-2.5 text-right text-gray-600">
                        {fmtVol(c.volume24h)}
                      </td>

                      {/* CoinGecko: 現物Vol (施策7) */}
                      {HAS_CG && (() => {
                        const cg = c.cgData;
                        if (!cg) return <td className="px-3 py-2.5 text-right text-gray-300 text-xs">—</td>;
                        return (
                          <td className="px-3 py-2.5 text-right text-xs text-gray-600">
                            {cg.spotVolume != null ? fmtVol(cg.spotVolume) : <span className="text-gray-300">N/A</span>}
                          </td>
                        );
                      })()}

                      {/* 先物/現物比 (施策7) */}
                      {HAS_CG && (() => {
                        const cg = c.cgData;
                        if (!cg?.spotVolume) return <td className="px-3 py-2.5 text-right text-gray-300 text-xs">—</td>;
                        const ratio = (c.volume24h / cg.spotVolume) * 100;
                        const cls = ratio > 500 ? "text-red-600 font-bold" : ratio > 200 ? "text-orange-500" : "text-gray-500";
                        return (
                          <td className={`px-3 py-2.5 text-right text-xs font-mono ${cls}`}>
                            {ratio.toFixed(0)}%
                            {ratio > 500 && <span className="ml-0.5">🔴</span>}
                          </td>
                        );
                      })()}

                      {/* SNS (施策7) */}
                      {HAS_CG && (() => {
                        const cg = c.cgData;
                        if (!cg) return <td className="px-3 py-2.5 text-right text-gray-300 text-xs">—</td>;
                        const total = (cg.twitterFollowers ?? 0) + (cg.telegramMembers ?? 0);
                        return (
                          <td className="px-3 py-2.5 text-right text-xs text-gray-600">
                            {total > 0 ? fmtVol(total).replace("$", "") : <span className="text-gray-300">N/A</span>}
                          </td>
                        );
                      })()}

                      {/* 上場日数 */}
                      <td className="px-3 py-2.5 text-right text-gray-500 text-xs">
                        {c.listedDaysAgo}日前
                      </td>

                      {/* 取引所 */}
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <ExchangeBadges c={c} />
                          <a
                            href={`https://www.mexc.com/futures/${base}_USDT`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-blue-500 hover:text-blue-700 underline"
                          >
                            開く ↗
                          </a>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <ScoreDetail c={c} snapshots={snapshots} alerts={alerts} />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
            行をクリックするとスコア内訳・前回比が表示されます
          </div>
        </div>
      )}
    </div>
  );
}
