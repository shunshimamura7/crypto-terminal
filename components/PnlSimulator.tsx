"use client";

import React, { useState, useMemo, useEffect } from "react";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import { simulateBacktest } from "@/app/lib/backtestSimulator";
import type { SimulationConfig } from "@/app/lib/backtestSimulator";

interface ScanCandidate {
  symbol: string;
  score?: number;
  displayScore?: number;
  scoreMax?: number;
  recommendation?: string;
}

interface PnlSimulatorProps {
  records: BacktestRecord[];
  lang: "ja" | "en";
  currentScanResults?: ScanCandidate[];
}

const STORAGE_KEY = "bell:portfolio:settings";

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

function loadSavedCapital(lang: "ja" | "en"): number {
  const saved = loadSetting<number | null>("capital", null);
  return saved ?? (lang === "ja" ? 100_000 : 1_000);
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

const POS_SIZE_OPTIONS = [3, 5, 10, 15, 20];

export default function PnlSimulator({ records, lang, currentScanResults }: PnlSimulatorProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [capital,         setCapital]         = useState(() => loadSavedCapital(lang));
  const [riskPct,         setRiskPct]         = useState(() => loadSetting("riskPct",  2));
  const [leverage,        setLeverage]        = useState(() => loadSetting("leverage", 3));
  const [calcMode,        setCalcMode]        = useState<"risk" | "position">(() => loadSetting("calcMode", "risk"));
  const [posSizePct,      setPosSizePct]      = useState<number>(() => loadSetting("posSizePct", 5));
  const [dataSource,      setDataSource]      = useState<"all" | "custom">("all");
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [manualSymbol,    setManualSymbol]    = useState("");
  const [simPeriod,       setSimPeriod]       = useState<"all" | "7d" | "14d" | "30d" | "60d" | "90d" | "custom">("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate,   setCustomEndDate]   = useState("");
  const [advancedOpen,    setAdvancedOpen]    = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ capital, riskPct, leverage, calcMode, posSizePct }));
    } catch { /* ignore */ }
  }, [capital, riskPct, leverage, calcMode, posSizePct]);

  const ja = lang === "ja";
  const presets = ja ? JA_PRESETS : EN_PRESETS;

  function fmtCurrency(value: number): string {
    const rounded = Math.round(Math.abs(value));
    return ja ? `¥${rounded.toLocaleString("ja-JP")}` : `$${rounded.toLocaleString("en-US")}`;
  }

  function fmtAxisTick(value: number): string {
    if (ja) {
      if (value >= 10_000) return `¥${Math.round(value / 10_000)}万`;
      return `¥${value.toLocaleString("ja-JP")}`;
    }
    if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
    return `$${value}`;
  }

  // ── Period filter ─────────────────────────────────────────────────────────
  const filterByPeriod = React.useCallback((recs: BacktestRecord[]): BacktestRecord[] => {
    const now = Date.now();
    const DAY = 86_400_000;
    switch (simPeriod) {
      case "all":  return recs;
      case "7d":   return recs.filter(r => r.recordedAt >= now - 7  * DAY);
      case "14d":  return recs.filter(r => r.recordedAt >= now - 14 * DAY);
      case "30d":  return recs.filter(r => r.recordedAt >= now - 30 * DAY);
      case "60d":  return recs.filter(r => r.recordedAt >= now - 60 * DAY);
      case "90d":  return recs.filter(r => r.recordedAt >= now - 90 * DAY);
      case "custom": {
        const start = customStartDate ? new Date(customStartDate).getTime() : 0;
        const end   = customEndDate   ? new Date(customEndDate).getTime() + DAY : Infinity;
        return recs.filter(r => r.recordedAt >= start && r.recordedAt <= end);
      }
      default: return recs;
    }
  }, [simPeriod, customStartDate, customEndDate]);

  const periodFilteredCount = useMemo(() => {
    const resolved = records.filter(r =>
      ["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit"].includes(r.status)
    );
    return filterByPeriod(resolved).length;
  }, [records, filterByPeriod]);

  // ── Auto-computed simulation ──────────────────────────────────────────────
  const currentConfig = useMemo<SimulationConfig>(() => ({
    initialCapital:  capital,
    riskPerTrade:    riskPct,
    positionSizePct: posSizePct,
    leverage,
    usdJpy:          145,
    mode:            calcMode,
  }), [capital, riskPct, posSizePct, leverage, calcMode]);

  const targetRecords = useMemo(() => {
    const periodFiltered = filterByPeriod(records);
    return dataSource === "all"
      ? periodFiltered
      : periodFiltered.filter(r => selectedSymbols.has(r.symbol));
  }, [records, filterByPeriod, dataSource, selectedSymbols]);

  const result = useMemo(() => simulateBacktest(targetRecords, currentConfig), [targetRecords, currentConfig]);

  // ── Sharpe ratio ─────────────────────────────────────────────────────────
  const sharpe = useMemo(() => {
    const cfg = currentConfig;
    const resolved = [...targetRecords]
      .filter(r =>
        r.resolvedAt != null &&
        r.resolvedPrice != null &&
        (r.status === "tp1_hit" || r.status === "tp2_hit" || r.status === "tp3_hit" || r.status === "sl_hit"),
      )
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    if (resolved.length < 3) return null;
    let eq = cfg.initialCapital;
    const rets: number[] = [];
    for (const r of resolved) {
      const exitPrice = r.status === "tp1_hit" ? r.tp1
                      : r.status === "tp2_hit" ? r.tp2
                      : r.status === "tp3_hit" ? r.tp3
                      : r.status === "sl_hit"  ? r.sl
                      : (r.resolvedPrice ?? r.entryPrice);
      const profit = r.entryPrice - exitPrice;
      const risk   = r.sl - r.entryPrice;
      if (risk <= 0) continue;
      const realR = profit / risk;
      let pnl: number;
      if (cfg.mode === "position") {
        pnl = (eq * cfg.positionSizePct / 100) * (profit / r.entryPrice) * cfg.leverage;
      } else {
        pnl = realR * (eq * cfg.riskPerTrade / 100);
      }
      const ret = eq > 0 ? pnl / eq : 0;
      eq = Math.max(0, eq + pnl);
      if (eq <= 0) break;
      rets.push(ret);
    }
    if (rets.length < 2) return null;
    const mean     = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    return variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(rets.length) : 0;
  }, [currentConfig, targetRecords]);

  // ── Avg win/loss ──────────────────────────────────────────────────────────
  const { avgWinJpy, avgLossJpy } = useMemo(() => {
    if (result.totalTrades === 0) return { avgWinJpy: 0, avgLossJpy: 0 };
    const diffs = result.equityCurve.slice(1).map(
      (pt, i) => pt.equity - result.equityCurve[i].equity,
    );
    const wins   = diffs.filter(d => d > 0);
    const losses = diffs.filter(d => d < 0);
    return {
      avgWinJpy:  wins.length   > 0 ? wins.reduce((a, b) => a + b, 0)  / wins.length  : 0,
      avgLossJpy: losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0)) / losses.length : 0,
    };
  }, [result]);

  // ── Derived values ────────────────────────────────────────────────────────
  const pnlJpy      = result.finalEquity - capital;
  const maxDDJpy    = result.maxDDJpy ?? result.maxDrawdown / 100 * capital;
  const highLevRisk = posSizePct * 0.08 * leverage;

  // ── Period label ──────────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (targetRecords.length === 0) return "—";
    const resolved = targetRecords.filter(r => r.resolvedAt);
    if (resolved.length === 0) return "—";
    const first = new Date(Math.min(...resolved.map(r => r.recordedAt)));
    const last  = new Date(Math.max(...resolved.map(r => r.resolvedAt ?? r.recordedAt)));
    const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    return `${fmt(first)} 〜 ${fmt(last)}`;
  }, [targetRecords]);

  // ── Symbol pool ───────────────────────────────────────────────────────────
  const symbolPool = useMemo(() => {
    const pool = new Map<string, { displayScore?: number; scoreMax?: number; hasRecord: boolean }>();
    for (const c of (currentScanResults ?? [])) {
      pool.set(c.symbol, {
        displayScore: c.displayScore ?? c.score,
        scoreMax:     c.scoreMax,
        hasRecord:    records.some(r => r.symbol === c.symbol),
      });
    }
    for (const r of records) {
      if (!pool.has(r.symbol)) pool.set(r.symbol, { hasRecord: true });
    }
    return [...pool.entries()].sort((a, b) => (b[1].displayScore ?? 0) - (a[1].displayScore ?? 0));
  }, [records, currentScanResults]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  function addManualSymbol() {
    const raw = manualSymbol.trim().toUpperCase();
    if (!raw) return;
    const sym = raw.endsWith("_USDT") ? raw : raw.replace(/\/USDT$/i, "") + "_USDT";
    setSelectedSymbols(prev => new Set([...prev, sym]));
    setManualSymbol("");
  }

  function toggleSymbol(sym: string, checked: boolean) {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      if (checked) next.add(sym);
      else next.delete(sym);
      return next;
    });
  }

  function removeSymbol(sym: string) {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      next.delete(sym);
      return next;
    });
  }

  // ── Translations ─────────────────────────────────────────────────────────
  const T = {
    title:            ja ? "💹 損益シミュレーション"            : "💹 PnL Simulation",
    subtitle:         ja ? "過去のスキャン結果で運用していたら？" : "What if you traded past scan results?",
    advSettings:      ja ? "詳細設定"              : "Settings",
    calcMode:         ja ? "計算方式"              : "Calc Mode",
    riskMode:         ja ? "リスク%固定"           : "Fixed Risk%",
    posMode:          ja ? "ポジション固定"         : "Fixed Position",
    riskModeDesc:     ja ? "SL損失を口座の一定%に固定（プロ向け）" : "Fix loss as % of account (Pro)",
    posModeDesc:      ja ? "投入額を口座の一定%に固定（レバ有効）" : "Fix position size; leverage amplifies P&L",
    allHistory:       ja ? "全履歴シミュレーション"  : "All History",
    customSelect:     ja ? "銘柄を選んでシミュレーション" : "Custom Selection",
    capital:          ja ? "軍資金"               : "Capital",
    risk:             ja ? "1トレードリスク"       : "Risk per Trade",
    posSize:          ja ? "ポジション比率"        : "Position Size %",
    leverage:         ja ? "レバレッジ"            : "Leverage",
    levDisabled:      ja ? "リスク%固定では不要（損益に影響しません）" : "Not needed in Fixed Risk% mode",
    initial:          ja ? "初期資金"              : "Initial",
    final:            ja ? "最終資金"              : "Final",
    pnl:              ja ? "損益"                 : "PnL",
    maxDD:            ja ? "最大DD"               : "Max DD",
    totalTrades:      ja ? "総トレード"            : "Trades",
    winRate:          ja ? "勝率"                 : "Win Rate",
    avgWin:           ja ? "平均利益"              : "Avg Win",
    avgLoss:          ja ? "平均損失"              : "Avg Loss",
    profitFactor:     ja ? "PF"                  : "PF",
    sharpe:           ja ? "シャープ"              : "Sharpe",
    lev1:             ja ? "1x（現物相当）"          : "1x (Spot equivalent)",
    lev2:             ja ? "2x（低リスク）"          : "2x (Low risk)",
    lev3:             ja ? "3x（推奨）"              : "3x (Recommended)",
    lev5:             ja ? "5x（中〜大型のみ推奨）"  : "5x (Mid-Large caps)",
    lev10:            ja ? "10x（ハイリスク）"       : "10x (High risk)",
    selectSymbols:    ja ? "シミュレーション銘柄を選択" : "Select Symbols to Simulate",
    addSymbol:        ja ? "追加"                 : "Add",
    noSymbolSelected: ja ? "銘柄を選択してください"  : "Select symbols above",
    selectedCount:    ja ? "選択中"               : "Selected",
    perSymbolPnl:     ja ? "銘柄別サマリ"          : "Per Symbol Summary",
    noData:           ja
      ? "まだバックテストデータがありません。スキャンを実行するとデータが蓄積されます。"
      : "No backtest data yet. Run a scan to start accumulating data.",
    noDataCustom:     ja ? "選択した銘柄のバックテストデータがありません。" : "No backtest data for selected symbols.",
    bankrupt:         ja ? "🚨 破産（資金ゼロ）"    : "🚨 Bankrupt (equity zero)",
    disclaimer:       ja
      ? "※ シミュレーション結果です。実際の取引ではスリッページ・FR・手数料が発生します。過去の成績は将来の結果を保証しません。"
      : "※ Simulation only. Actual trading involves slippage, funding rates, and fees. Past performance does not guarantee future results.",
    dashed:           ja ? "点線: 初期資金" : "Dashed: Initial capital",
    equity:           ja ? "資産"   : "Equity",
    trades:           ja ? "件"     : "",
    wins:             ja ? "勝"     : "W",
    active:           ja ? "件進行中" : " active",
    noRecord:         ja ? "データなし" : "No data",
    scanFirst:        ja ? "スキャンを実行すると銘柄が表示されます" : "Run a scan to see symbols",
    highLevWarn:      ja
      ? `⚠️ レバ${leverage}x × ポジション${posSizePct}%: SL hit時に資金の約${highLevRisk.toFixed(1)}%を失う可能性`
      : `⚠️ Lev ${leverage}x × pos ${posSizePct}%: ~${highLevRisk.toFixed(1)}% of capital at risk per SL hit`,
    highLevDanger:    ja
      ? "🚨 レバ10xはアルトコインでは清算リスクが非常に高いです。3x以下を推奨します。"
      : "🚨 10x leverage on altcoins carries extreme liquidation risk. 3x or below recommended.",
  };

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      {/* ヘッダー + ⚙️ toggle */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{T.title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{T.subtitle}</p>
        </div>
        <button
          onClick={() => setAdvancedOpen(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            advancedOpen
              ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-600"
              : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          ⚙️ {T.advSettings}
        </button>
      </div>

      <div className="px-5 py-4 space-y-5">

        {/* ━━━ 軍資金プリセット (常時表示) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div>
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
            💰 {T.capital}
          </label>
          {advancedOpen && (
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
          )}
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

        {/* ━━━ 詳細設定（advancedOpen時のみ） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {advancedOpen && (
          <div className="space-y-5">

            {/* 計算方式トグル */}
            <div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                {T.calcMode}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
                  <button
                    onClick={() => setCalcMode("risk")}
                    className={`px-4 py-2 text-sm font-medium transition ${
                      calcMode === "risk"
                        ? "bg-emerald-500 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    🛡️ {T.riskMode}
                  </button>
                  <button
                    onClick={() => setCalcMode("position")}
                    className={`px-4 py-2 text-sm font-medium transition border-l border-gray-300 dark:border-gray-600 ${
                      calcMode === "position"
                        ? "bg-emerald-500 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    📊 {T.posMode}
                  </button>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {calcMode === "risk" ? T.riskModeDesc : T.posModeDesc}
                </span>
              </div>
            </div>

            {/* データソースタブ */}
            <div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                {ja ? "シミュレーション対象" : "Data Source"}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setDataSource("all")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                    dataSource === "all"
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  📊 {T.allHistory}
                </button>
                <button
                  onClick={() => setDataSource("custom")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                    dataSource === "custom"
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  🎯 {T.customSelect}
                </button>
              </div>
            </div>

            {/* リスク/ポジション + レバレッジ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                {calcMode === "risk" ? (
                  <>
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                      🎯 {T.risk}
                    </label>
                    <select
                      value={riskPct}
                      onChange={e => setRiskPct(Number(e.target.value))}
                      className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    >
                      {([1, 2, 3, 5] as const).map(v => (
                        <option key={v} value={v}>
                          {v}% — {ja ? `損切り${fmtCurrency(capital * v / 100)}まで` : `SL loss up to ${fmtCurrency(capital * v / 100)}`}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-2">
                      📐 {T.posSize}
                    </label>
                    <select
                      value={posSizePct}
                      onChange={e => setPosSizePct(Number(e.target.value))}
                      className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    >
                      {POS_SIZE_OPTIONS.map(v => (
                        <option key={v} value={v}>
                          {v}% — {ja ? `投入${fmtCurrency(capital * v / 100)}` : `invest ${fmtCurrency(capital * v / 100)}`}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              <div>
                <label className={`text-sm font-semibold block mb-2 ${
                  calcMode === "risk"
                    ? "text-gray-400 dark:text-gray-500"
                    : "text-gray-700 dark:text-gray-300"
                }`}>
                  ⚡ {T.leverage}
                </label>
                <select
                  value={leverage}
                  onChange={e => setLeverage(Number(e.target.value))}
                  disabled={calcMode === "risk"}
                  className={`w-full border-2 rounded-lg px-3 py-2 text-base transition ${
                    calcMode === "risk"
                      ? "border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  }`}
                >
                  <option value={1}>{T.lev1}</option>
                  <option value={2}>{T.lev2}</option>
                  <option value={3}>{T.lev3}</option>
                  <option value={5}>{T.lev5}</option>
                  <option value={10}>{T.lev10}</option>
                </select>
                <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  {calcMode === "risk" ? T.levDisabled : ""}
                </div>
              </div>
            </div>

            {/* 高レバ警告 */}
            {calcMode === "position" && leverage >= 5 && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400">
                {T.highLevWarn}
                {leverage >= 10 && (
                  <span className="font-bold block mt-1">{T.highLevDanger}</span>
                )}
              </div>
            )}

            {/* カスタム銘柄選択UI */}
            {dataSource === "custom" && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-blue-800 dark:text-blue-300">
                    🎯 {T.selectSymbols}
                  </h4>
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    {T.selectedCount}: {selectedSymbols.size}{T.trades}
                  </span>
                </div>

                {symbolPool.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-52 overflow-y-auto mb-3">
                    {symbolPool.map(([sym, info]) => {
                      const base = sym.replace("_USDT", "");
                      const isSelected = selectedSymbols.has(sym);
                      return (
                        <label
                          key={sym}
                          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition text-xs ${
                            isSelected
                              ? "bg-emerald-100 dark:bg-emerald-900/50 border-2 border-emerald-400 dark:border-emerald-600"
                              : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={e => toggleSymbol(sym, e.target.checked)}
                            className="rounded text-emerald-500 shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-mono font-bold text-xs truncate text-gray-800 dark:text-gray-100">
                              {base}
                            </div>
                            {info.displayScore != null ? (
                              <div className="text-[9px] text-gray-500 dark:text-gray-400">
                                {ja ? "スコア" : "Score"} {info.displayScore}{info.scoreMax ? `/${info.scoreMax}` : ""}
                              </div>
                            ) : (
                              <div className="text-[9px] text-gray-400 dark:text-gray-500">
                                {ja ? "BT記録のみ" : "BT record only"}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{T.scanFirst}</p>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualSymbol}
                    onChange={e => setManualSymbol(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === "Enter") addManualSymbol(); }}
                    className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-blue-400"
                    placeholder={ja ? "銘柄名を入力（例: BTC）" : "Enter symbol (e.g. BTC)"}
                  />
                  <button
                    onClick={addManualSymbol}
                    className="px-4 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors shrink-0"
                  >
                    + {T.addSymbol}
                  </button>
                </div>

                {selectedSymbols.size > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[...selectedSymbols].map(sym => (
                      <span
                        key={sym}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 rounded-full text-xs"
                      >
                        {sym.replace("_USDT", "")}
                        <button
                          onClick={() => removeSymbol(sym)}
                          className="text-emerald-500 hover:text-red-500 font-bold leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-center text-sm text-gray-400 dark:text-gray-500 py-2">
                    {T.noSymbolSelected}
                  </div>
                )}
              </div>
            )}

            {/* 銘柄別サマリ（カスタム選択時） */}
            {dataSource === "custom" && selectedSymbols.size > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  {T.perSymbolPnl}
                </h4>
                <div className="space-y-1">
                  {[...selectedSymbols].map(sym => {
                    const symRecords = records.filter(r => r.symbol === sym);
                    const base = sym.replace("_USDT", "");
                    if (symRecords.length === 0) return (
                      <div key={sym} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">
                        <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{base}</span>
                        <span className="text-gray-400">{T.noRecord}</span>
                      </div>
                    );
                    const resolved = symRecords.filter(r =>
                      ["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit"].includes(r.status)
                    );
                    const wins   = resolved.filter(r => r.status !== "sl_hit").length;
                    const active = symRecords.filter(r => r.status === "active").length;
                    return (
                      <div key={sym} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">
                        <span className="font-mono font-bold text-gray-700 dark:text-gray-300">{base}</span>
                        <div className="flex gap-3 text-gray-600 dark:text-gray-400">
                          {resolved.length > 0 ? (
                            <>
                              <span className={wins > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                                {wins}/{resolved.length} {T.wins}
                              </span>
                              {active > 0 && <span>{active}{T.active}</span>}
                            </>
                          ) : (
                            <span className="text-blue-500">{active}{T.active}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* シミュレーション期間 */}
            <div>
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                📅 {ja ? "シミュレーション期間" : "Simulation Period"}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "7d", "14d", "30d", "60d", "90d", "custom"] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => setSimPeriod(key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                      simPeriod === key
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {key === "all"    ? (ja ? "全期間" : "All") :
                     key === "custom" ? (ja ? "カスタム" : "Custom") :
                     key}
                  </button>
                ))}
              </div>

              {simPeriod === "custom" && (
                <div className="flex gap-3 mt-2 items-center flex-wrap">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    className="border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-gray-400 dark:text-gray-500">〜</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="border-2 border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              )}

              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {ja ? `対象レコード: ${periodFilteredCount}件` : `Target records: ${periodFilteredCount}`}
              </div>
            </div>

          </div>
        )}

        {/* ━━━ 結果エリア（常時自動表示） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {result.totalTrades === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/30">
            {dataSource === "custom" ? T.noDataCustom : T.noData}
          </div>
        ) : (
          <>
            {/* 期間サマリ */}
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-1">
              {ja ? "期間" : "Period"}: {periodLabel}
              {" / "}
              {ja ? "対象" : "Trades"}: {result.totalTrades}{T.trades}
            </div>

            {/* 破産警告 */}
            {result.bankrupt && (
              <div className="p-3 bg-red-100 dark:bg-red-950/50 border border-red-400 rounded-lg text-sm font-bold text-red-700 dark:text-red-400 text-center">
                {T.bankrupt}
              </div>
            )}

            {/* ━━━ 結果 4カード ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-center">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{T.initial}</div>
                <div className="font-bold text-lg text-gray-700 dark:text-gray-200">{fmtCurrency(capital)}</div>
              </div>
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
              <div className={`p-4 rounded-xl border text-center ${
                result.totalReturn >= 0
                  ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                  : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
              }`}>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{T.pnl}</div>
                <div className={`font-bold text-lg ${result.totalReturn >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                  {result.totalReturn >= 0 ? "+" : ""}{result.totalReturn.toFixed(1)}%
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  ({pnlJpy >= 0 ? "+" : ""}{fmtCurrency(pnlJpy)})
                </div>
              </div>
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

            {/* ━━━ 詳細統計 6カード ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
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
                    : sharpe >= 1 ? "text-green-700 dark:text-green-400"
                    : sharpe >= 0 ? "text-yellow-600 dark:text-yellow-400"
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

            {/* ━━━ 資金推移チャート ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
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
                      <AreaChart data={result.equityCurve} margin={{ top: 8, right: 8, bottom: 40, left: 0 }}>
                        <defs>
                          <linearGradient id="pnlSimGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={60} interval={Math.max(0, Math.floor(result.equityCurve.length / 15) - 1)} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtAxisTick(v as number)} width={70} />
                        <ReferenceLine y={capital} stroke="#9ca3af" strokeDasharray="3 3" label={{ value: T.initial, fontSize: 10, fill: "#9ca3af", position: "insideTopRight" }} />
                        <Tooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(v: any) => [fmtCurrency(v as number), T.equity]}
                          labelStyle={{ fontSize: 10 }}
                          contentStyle={{ fontSize: 11, borderRadius: 8 }}
                        />
                        <Area type="monotone" dataKey="equity" stroke={strokeColor} strokeWidth={2} fill="url(#pnlSimGradient)" dot={false} activeDot={{ r: 4 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 text-right mt-1">{T.dashed}</p>
                </div>
              );
            })()}

            {/* 免責 */}
            <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">{T.disclaimer}</p>
          </>
        )}
      </div>
    </div>
  );
}
