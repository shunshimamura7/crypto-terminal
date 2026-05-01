"use client";

import React, { useState, useMemo, useEffect } from "react";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import { simulateBacktest } from "@/app/lib/backtestSimulator";
import type { SimulationConfig } from "@/app/lib/backtestSimulator";

interface PnlSimulatorProps {
  records: BacktestRecord[];
  lang: "ja" | "en";
}

const STORAGE_KEY = "bell:portfolio:settings";

function loadSavedCapital(lang: "ja" | "en"): number {
  if (typeof window === "undefined") return lang === "ja" ? 100_000 : 1_000;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return lang === "ja" ? 100_000 : 1_000;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.capital === "number" ? obj.capital : (lang === "ja" ? 100_000 : 1_000);
  } catch {
    return lang === "ja" ? 100_000 : 1_000;
  }
}

function loadSetting<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return (obj[key] as T) ?? fallback;
  } catch {
    return fallback;
  }
}

const JA_PRESETS = [
  { label: "5万",   value: 50_000 },
  { label: "10万",  value: 100_000 },
  { label: "30万",  value: 300_000 },
  { label: "50万",  value: 500_000 },
  { label: "100万", value: 1_000_000 },
];
const EN_PRESETS = [
  { label: "$500", value: 500 },
  { label: "$1K",  value: 1_000 },
  { label: "$3K",  value: 3_000 },
  { label: "$5K",  value: 5_000 },
  { label: "$10K", value: 10_000 },
];

export default function PnlSimulator({ records, lang }: PnlSimulatorProps) {
  const [capital,  setCapital]  = useState(() => loadSavedCapital(lang));
  const [riskPct,  setRiskPct]  = useState(() => loadSetting("riskPct",  2));
  const [leverage, setLeverage] = useState(() => loadSetting("leverage", 3));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ capital, riskPct, leverage }));
    } catch { /* ignore */ }
  }, [capital, riskPct, leverage]);

  const ja = lang === "ja";
  const presets = ja ? JA_PRESETS : EN_PRESETS;

  // 通貨フォーマット（コンポーネント内クロージャ）
  function fmtCurrency(value: number): string {
    const rounded = Math.round(Math.abs(value));
    const formatted = rounded.toLocaleString(ja ? "ja-JP" : "en-US");
    return ja ? `¥${formatted}` : `$${formatted}`;
  }

  function fmtAxisTick(value: number): string {
    if (ja) {
      if (value >= 10_000) return `¥${Math.round(value / 10_000)}万`;
      return `¥${value.toLocaleString("ja-JP")}`;
    }
    if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
    return `$${value}`;
  }

  const config: SimulationConfig = { initialCapital: capital, riskPerTrade: riskPct, leverage, usdJpy: 145 };
  const result = useMemo(() => simulateBacktest(records, config), [records, capital, riskPct, leverage]);

  // シャープレシオをコンポーネント内で計算
  const sharpe = useMemo(() => {
    const resolved = [...records]
      .filter(r => r.resolvedAt != null && r.resolvedPrice != null && r.status !== "active")
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    if (resolved.length < 3) return null;
    let eq = capital;
    const rets: number[] = [];
    for (const r of resolved) {
      const profit = r.entryPrice - (r.resolvedPrice ?? r.entryPrice);
      const risk   = r.sl - r.entryPrice;
      if (risk <= 0) continue;
      const realR   = profit / risk;
      const riskAmt = eq * riskPct / 100;
      const pnl     = realR * riskAmt;
      const ret     = eq > 0 ? pnl / eq : 0;
      eq = Math.max(0, eq + pnl);
      rets.push(ret);
    }
    if (rets.length < 2) return null;
    const mean     = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(rets.length) : 0;
  }, [records, capital, riskPct]);

  // 金額換算（近似値）
  const riskAmountApprox = capital * riskPct / 100;
  const pnlJpy     = result.finalEquity - capital;
  const maxDDJpy   = result.maxDrawdown / 100 * capital;
  const avgWinJpy  = result.avgWinR  * riskAmountApprox;
  const avgLossJpy = result.avgLossR * riskAmountApprox;

  const T = {
    title:        ja ? "💹 損益シミュレーション"           : "💹 PnL Simulation",
    subtitle:     ja ? "過去のスキャン結果で運用していたら？" : "What if you traded past scan results?",
    capital:      ja ? "軍資金"          : "Capital",
    risk:         ja ? "1トレードリスク"  : "Risk per Trade",
    leverage:     ja ? "レバレッジ"       : "Leverage",
    maxLoss:      ja ? "1トレード最大損失" : "Max loss / trade",
    initial:      ja ? "初期資金"         : "Initial",
    final:        ja ? "最終資金"         : "Final",
    pnl:          ja ? "損益"             : "PnL",
    maxDD:        ja ? "最大DD"           : "Max DD",
    totalTrades:  ja ? "総トレード"       : "Trades",
    winRate:      ja ? "勝率"             : "Win Rate",
    avgWin:       ja ? "平均利益"         : "Avg Win",
    avgLoss:      ja ? "平均損失"         : "Avg Loss",
    profitFactor: ja ? "PF"              : "PF",
    sharpe:       ja ? "シャープ"         : "Sharpe",
    conservative: ja ? "保守的"  : "Conservative",
    standard:     ja ? "標準"    : "Standard",
    aggressive:   ja ? "積極的"  : "Aggressive",
    highRisk:     ja ? "ハイリスク" : "High Risk",
    lev1:         ja ? "1x（現物相当）"    : "1x (Spot equivalent)",
    lev3:         ja ? "3x（推奨）"        : "3x (Recommended)",
    lev10:        ja ? "10x（BTC/ETHのみ）" : "10x (BTC/ETH only)",
    noData:       ja
      ? "まだバックテストデータがありません。スキャンを実行するとデータが蓄積されます。"
      : "No backtest data yet. Run a scan to start accumulating data.",
    disclaimer:   ja
      ? "※ シミュレーション結果です。実際の取引ではスリッページ・FR・手数料が発生します。過去の成績は将来の結果を保証しません。"
      : "※ Simulation only. Actual trading involves slippage, funding rates, and fees. Past performance does not guarantee future results.",
    dashed:       ja ? "点線: 初期資金" : "Dashed: Initial capital",
    equity:       ja ? "資産" : "Equity",
    trades:       ja ? "件"   : "",
  };

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      {/* ヘッダー */}
      <div className="px-5 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{T.title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{T.subtitle}</p>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* ─── 入力フォーム 3カラム ─────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* 軍資金 */}
          <div>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
              💰 {T.capital}
            </label>
            <div className="flex items-center gap-1 mb-2">
              <span className="text-sm font-bold text-gray-500 dark:text-gray-400 shrink-0">
                {ja ? "¥" : "$"}
              </span>
              <input
                type="number"
                value={capital}
                onChange={e => setCapital(Math.max(1, Number(e.target.value)))}
                className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base font-mono bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                placeholder={ja ? "100000" : "1000"}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <button
                  key={p.value}
                  onClick={() => setCapital(p.value)}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                    capital === p.value
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-900/50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1トレードリスク */}
          <div>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
              🎯 {T.risk}
            </label>
            <select
              value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))}
              className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            >
              <option value={1}>1%（{T.conservative}）</option>
              <option value={2}>2%（{T.standard}）</option>
              <option value={3}>3%（{T.aggressive}）</option>
              <option value={5}>5%（{T.highRisk}）</option>
            </select>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {T.maxLoss}:{" "}
              <span className="font-bold text-red-600">
                {fmtCurrency(riskAmountApprox)}
              </span>
            </div>
          </div>

          {/* レバレッジ */}
          <div>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
              ⚡ {T.leverage}
            </label>
            <select
              value={leverage}
              onChange={e => setLeverage(Number(e.target.value))}
              className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            >
              <option value={1}>{T.lev1}</option>
              <option value={2}>2x</option>
              <option value={3}>{T.lev3}</option>
              <option value={5}>5x</option>
              <option value={10}>{T.lev10}</option>
            </select>
          </div>
        </div>

        {/* ─── データなし ──────────────────────────────────────── */}
        {result.totalTrades === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/30">
            {T.noData}
          </div>
        ) : (
          <>
            {/* ─── 結果 4カード ──────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* 初期資金 */}
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{T.initial}</div>
                <div className="font-bold text-lg text-gray-700 dark:text-gray-200">
                  {fmtCurrency(capital)}
                </div>
              </div>

              {/* 最終資金 */}
              <div className={`p-4 rounded-xl border text-center ${
                result.finalEquity >= capital
                  ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                  : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
              }`}>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{T.final}</div>
                <div className={`font-bold text-lg ${
                  result.finalEquity >= capital
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-700 dark:text-red-400"
                }`}>
                  {fmtCurrency(result.finalEquity)}
                </div>
              </div>

              {/* 損益 */}
              <div className={`p-4 rounded-xl border text-center ${
                result.totalReturn >= 0
                  ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                  : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
              }`}>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{T.pnl}</div>
                <div className={`font-bold text-lg ${
                  result.totalReturn >= 0
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-700 dark:text-red-400"
                }`}>
                  {result.totalReturn >= 0 ? "+" : ""}{result.totalReturn.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  ({pnlJpy >= 0 ? "+" : ""}{fmtCurrency(pnlJpy)})
                </div>
              </div>

              {/* 最大DD */}
              <div className="bg-orange-50 dark:bg-orange-950/30 p-4 rounded-xl border border-orange-200 dark:border-orange-800 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{T.maxDD}</div>
                <div className={`font-bold text-lg ${
                  result.maxDrawdown > 30 ? "text-red-600 dark:text-red-400"
                  : result.maxDrawdown > 15 ? "text-orange-600 dark:text-orange-400"
                  : "text-orange-500"
                }`}>
                  -{result.maxDrawdown.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  (-{fmtCurrency(maxDDJpy)})
                </div>
              </div>
            </div>

            {/* ─── 詳細統計 5+1カード ────────────────────────────── */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-sm">
              {[
                {
                  label: T.totalTrades,
                  val: `${result.totalTrades}${T.trades}`,
                  cls: "text-gray-700 dark:text-gray-200",
                },
                {
                  label: T.winRate,
                  val: `${result.winRate.toFixed(1)}%`,
                  cls: result.winRate >= 50
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-600 dark:text-red-400",
                },
                {
                  label: T.avgWin,
                  val: `+${fmtCurrency(avgWinJpy)}`,
                  cls: "text-green-600 dark:text-green-400",
                },
                {
                  label: T.avgLoss,
                  val: `-${fmtCurrency(avgLossJpy)}`,
                  cls: "text-red-600 dark:text-red-400",
                },
                {
                  label: T.profitFactor,
                  val: result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2),
                  cls: result.profitFactor >= 1.5
                    ? "text-green-700 dark:text-green-400"
                    : result.profitFactor >= 1
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400",
                },
                {
                  label: T.sharpe,
                  val: sharpe == null ? "—" : sharpe.toFixed(2),
                  cls: sharpe == null ? "text-gray-400"
                    : sharpe >= 1  ? "text-green-700 dark:text-green-400"
                    : sharpe >= 0  ? "text-yellow-600 dark:text-yellow-400"
                    : "text-red-600 dark:text-red-400",
                },
              ].map(s => (
                <div
                  key={s.label}
                  className="text-center p-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{s.label}</div>
                  <div className={`font-bold ${s.cls}`}>{s.val}</div>
                </div>
              ))}
            </div>

            {/* ─── 資金推移チャート ──────────────────────────────── */}
            {result.equityCurve.length >= 3 && (() => {
              const {
                AreaChart, Area, XAxis, YAxis, Tooltip,
                ResponsiveContainer, ReferenceLine, CartesianGrid,
                // eslint-disable-next-line @typescript-eslint/no-require-imports
              } = require("recharts") as typeof import("recharts");

              const isProfit    = result.finalEquity >= capital;
              const strokeColor = isProfit ? "#10b981" : "#ef4444";

              return (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
                  <div style={{ height: 224 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={result.equityCurve}
                        margin={{ top: 8, right: 8, bottom: 40, left: 0 }}
                      >
                        <defs>
                          <linearGradient id="pnlSimGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 9 }}
                          angle={-45}
                          textAnchor="end"
                          height={60}
                          interval="preserveStartEnd"
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={v => fmtAxisTick(v as number)}
                          width={70}
                        />
                        <ReferenceLine
                          y={capital}
                          stroke="#9ca3af"
                          strokeDasharray="3 3"
                          label={{ value: T.initial, fontSize: 10, fill: "#9ca3af", position: "insideTopRight" }}
                        />
                        <Tooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(v: any) => [fmtCurrency(v as number), T.equity]}
                          labelStyle={{ fontSize: 10 }}
                          contentStyle={{ fontSize: 11, borderRadius: 8 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="equity"
                          stroke={strokeColor}
                          strokeWidth={2}
                          fill="url(#pnlSimGradient)"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 text-right mt-1">
                    {T.dashed}
                  </p>
                </div>
              );
            })()}

            {/* 免責 */}
            <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
              {T.disclaimer}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
