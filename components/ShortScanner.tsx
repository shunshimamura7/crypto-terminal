"use client";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { ShortCandidate, ShortScoreBreakdown } from "@/app/lib/shortScorer";
import { calcExclusivityScore, calcOIChangeScore } from "@/app/lib/shortScorer";
import { saveSnapshot, getSnapshots, getConsecutivePositiveFR } from "@/app/lib/snapshotStorage";
import type { ScanSnapshot } from "@/app/lib/snapshotStorage";
import { detectAlerts, getDiffSummary } from "@/app/lib/snapshotDiff";
import type { DiffAlert } from "@/app/lib/snapshotDiff";
import { fetchCoinGeckoData, calcFuturesHeatScore, calcSnsHeatScore, calcMcFdvScore } from "@/app/lib/coinGeckoClient";
import type { CgMarketData } from "@/app/lib/coinGeckoClient";
import MarketEnvironmentPanel from "@/components/MarketEnvironmentPanel";
import { checkAndUpdateRecords, recordNewCandidates, recordNewCandidatesWithStrategy } from "@/app/lib/backtestChecker";
import type { ExtendedCandidateLike } from "@/app/lib/backtestChecker";
import { getRecords, saveRecords, clearRecords } from "@/app/lib/backtestStorage";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import { findBestStrategy, evaluateDangerZone, ALL_STRATEGIES } from "@/app/lib/strategies";
import type { DangerZoneResult } from "@/app/lib/strategies";
import type { StrategyTag } from "@/app/lib/strategies/types";
import DangerBanner from "@/components/DangerBanner";
import { calculateStats } from "@/app/lib/backtestStats";
import type { BacktestStats } from "@/app/lib/backtestStats";
import type { BinanceFuturesData } from "@/app/types/binanceFutures";
import { evaluateShortSignal } from "@/app/lib/derivativesData";
import FRWatchToggle from "@/components/FRWatchToggle";
import { addToWatchlist, removeFromWatchlist, isInWatchlist } from "@/app/lib/watchlist";
import { detectPhase, phaseBadgeCls } from "@/app/lib/phaseDetector";
import type { PhaseResult, Phase } from "@/app/lib/phaseDetector";
import { calcPortfolioVaR } from "@/app/lib/portfolioRisk";

// ─── Referral (C) ─────────────────────────────────────────────────────────────
const MEXC_REF = process.env.NEXT_PUBLIC_MEXC_REFERRAL_CODE ?? "";
function mexcUrl(base: string) {
  const ref = MEXC_REF ? `?inviteCode=${MEXC_REF}` : "";
  return `https://www.mexc.com/futures/${base}_USDT${ref}`;
}
const MEXC_REG_URL = MEXC_REF
  ? `https://www.mexc.com/register?inviteCode=${MEXC_REF}`
  : "https://www.mexc.com/register";

// ─── i18n (G) ────────────────────────────────────────────────────────────────
type Lang = "ja" | "en";
const T = {
  ja: {
    title: "🎯 MEXC Short Scanner",
    subtitle: "ATH急落 × 出来高枯渇 × FR × OI × 取引所独占度 × 急騰検知でショート候補を自動スキャン",
    scanBtn: "🔍 スキャン実行",
    new30Btn: "🆕 新規上場30日スキャン",
    csvBtn: "📥 CSV出力",
    autoRefresh: "⏱ 自動更新",
    notifEnable: "🔔 通知ON",
    notifOn: "🔔 通知設定済",
    shareBtn: "🐦 結果をシェア",
    mexcReg: "📝 MEXCに登録",
    filterTitle: "フィルター",
    athDrop: "ATH下落率",
    volRatio: "出来高比率",
    listDays: "上場日数",
    minVol: "最低出来高",
    minOi: "最低OI",
    loading1: "銘柄リスト取得中...",
    loading2: "Klineデータ分析中...",
    loading3: "スコア集計中...",
    loadingNote: "通常30〜60秒かかります",
    emptyTitle: "スキャン実行でMEXC先物を分析",
    emptyNote: "スコア上位TOP20を表示",
    noResult: "フィルター条件に合う銘柄が見つかりません",
    noResultNote: "スライダーを調整してください",
    colSymbol: "銘柄",
    colScore: "スコア",
    colPrice: "価格",
    colAth: "ATH比",
    colVolR: "出来高比",
    col24h: "24h変動",
    col7d: "7d変動",
    colFr: "FR",
    colOi: "OI",
    colVol: "出来高",
    colDays: "上場",
    colExch: "取引所",
    colSpot: "現物Vol",
    colFsRatio: "先/現",
    colSns: "SNS",
    openLink: "開く ↗",
    scoreLabel: "スコア凡例",
    scoreHigh: "10以上: 強いショート候補",
    scoreMid: "6-9: 中程度",
    scoreLow: "5以下: 弱い",
    scrollHint: "← 横スクロールで全列表示",
    clickHint: "行をクリックするとスコア内訳が表示されます",
    scanTarget: "スキャン対象",
    passed: "フィルター通過",
    showing: "表示中",
    snapshots: "スナップショット",
    lastUpdate: "最終更新",
    newMode: "新規上場モード",
    cgFetching: "CoinGecko取得中...",
    tradeSetup: "⚔️ トレードセットアップ",
    sl: "損切り (SL)",
    tp1: "利確1 (TP1)",
    tp2: "利確2 (TP2)",
    tp3: "利確3 (TP3)",
    rrWarning: "⚠️ R:R不足",
    vpcr: "📊 出来高プロファイル (VPCR)",
    poc: "POC",
    current: "←現在",
    cgSection: "📊 CoinGecko データ",
    prevScore: "前回比スコア",
    oiChange: "OI変化",
    frChange: "FR変化",
    atl: "ATH(14日)",
    avgVol: "7日平均出来高",
    exchOnly: "MEXCのみ",
    colBtcCorr: "BTC相関",
    btcCorrHigh: "BTC連動",
    btcCorrLow: "BTC非連動",
    volSpikePump: "🔥 PUMP",
    volSpikeDump: "💀 DUMP",
    patBearFlag: "🚩 ベアフラッグ",
    patDeadCat: "🐱 デッドキャット",
    patDescWedge: "📐 下降ウェッジ",
    patBOS: "🔴 BOS",
    patFVG: "⚡ FVG",
    patSupplyZone: "🏔️ 供給ゾーン",
    btTitle: "📊 バックテスト実績",
    btPeriod: "期間",
    btSummary: "サマリー",
    btTotal: "記録数",
    btResolved: "決着",
    btActive: "進行中",
    btExpired: "期限切れ",
    btWinRate: "勝率",
    btAvgRR: "平均R:R",
    btExpectancy: "期待値",
    btBest: "ベスト",
    btWorst: "ワースト",
    btByScore: "スコア帯別勝率",
    btScoreRange: "スコア帯",
    btWins: "勝",
    btLosses: "負",
    btAllRecords: "全記録",
    btCsvExport: "📋 CSVエクスポート",
    btReset: "🗑️ データリセット",
    btResetConfirm: "バックテストデータを全削除しますか？",
    btNoData: "まだデータがありません。スキャン実行でスコア8以上の銘柄が自動記録されます。",
    btRecorded: "📊記録済",
    btTp1: "✅TP1",
    btTp2: "✅TP2",
    btTp3: "✅TP3",
    btSl: "❌SL",
    btActiveStatus: "⏳進行中",
    btExpiredStatus: "⏰期限切れ",
    btEntryCol: "エントリー",
    btSlCol: "SL",
    btTp1Col: "TP1",
    btCurCol: "現在",
    btStatusCol: "状態",
    btPnlCol: "損益",
    btDaysCol: "日数",
    caTitle: "🔔 カスタムアラート設定",
    caMinScore: "最低スコア",
    caMaxAth: "ATH下落率 以下",
    caReqPattern: "パターン検知",
    caReqAllTf: "全TFダウン",
    caReqBtcInd: "BTC非連動",
    caPreset: "プリセット",
    caPresetStrong: "強いショート",
    caPresetNewListing: "新規上場急落",
    caPresetMtf: "マルチTF一致",
    caSave: "保存",
    caReset: "リセット",
    caHits: "🔔 カスタムアラート",
    viewTable: "📋 テーブル",
    viewHeat: "🌡️ ヒートマップ",
    btEquityCurve: "📈 エクイティカーブ",
    btEquityR: "累積R",
    heatDesc: "X軸: スコア（右が高スコア）| Y軸: BTC相関（下が低相関）| 右下が狙い目ゾーン",
    heatTarget: "🎯 狙い目",
    heatLegShort: "ショート候補(10+)",
    heatLegMid: "中程度(6-9)",
    heatLegWeak: "弱い(≤5)",
    heatLegLong: "ロング優位",
    longBiasTitle: "🟢 ロング優位銘柄（ショート注意）",
    longBiasBadge: "🟢 ロング優位",
    longBiasNote: "以下の銘柄はロング方向に勢いがあります。ショートは不向きです。",
    longBiasReason: "理由",
    frNegativeWarn: "FRマイナス = スクイーズリスク",
    squeezeWarn: "⚡ スクイーズ警戒",
    summaryLabel: "📊 結果",
    summaryShort: "ショート候補",
    summaryLong: "ロング優位",
    summaryPattern: "パターン",
    summaryAllTf: "全TF↓",
    summarySpike: "スパイク",
    filterReset: "フィルターリセット",
    staleDataWarn: "⚠️ 古いデータ",
    earlyListingWarn: "⚠️ 上場3日以内",
    earlyListingNote: "意図的スクイーズに注意",
    btSimTitle: "💰 ポートフォリオシミュレーション",
    btSimCapital: "初期資金",
    btSimPos: "1ポジション",
    btSimCurAsset: "現在資産",
    btSimReturn: "トータルリターン",
    btSimMaxDD: "最大DD",
    btSimSharpe: "シャープレシオ",
    btSimInsuf: "決着済み5件以上でシミュレーション開始",
    // 施策2: サウンド
    soundOn: "🔊 サウンドON",
    soundOff: "🔇 サウンドOFF",
    // 施策3: キーボードショートカット
    kbTitle: "⌨️ キーボードショートカット",
    kbScan: "スキャン実行",
    kbNewScan: "新規上場スキャン",
    kbToggleView: "テーブル/ヒートマップ切替",
    kbFilter: "フィルターにフォーカス",
    kbNav: "銘柄選択",
    kbDetail: "詳細展開/折りたたみ",
    kbClose: "閉じる",
    kbHelp: "このヘルプを表示",
    // 施策4: URL共有
    shareUrl: "🔗 URLで共有",
    urlCopied: "🔗 URLをコピーしました",
    // 施策5: 自動更新間隔
    autoOff: "OFF",
    autoCountdown: "次回スキャン",
    // 施策6: プリセット
    presetsLabel: "プリセット",
    presetStandard: "通常スキャン",
    presetStrict: "厳選ショート",
    presetNewListing: "新規上場ハンター",
    presetEntryReady: "本日のおすすめ",
    presetSqueeze: "スクイーズ警戒",
    presetMexcOnly: "MEXC独占",
    presetSave: "+ 保存",
    presetNamePrompt: "プリセット名を入力",
    presetDelConfirm: "このプリセットを削除しますか？",
    // 施策10: トースト
    toastScanDone: "件検出",
    toastUrlCopy: "🔗 URLをコピーしました",
    toastCsvDone: "📄 CSVをダウンロードしました",
    toastBtRecord: "件の銘柄を自動記録しました",
    toastScanError: "スキャンに失敗しました",
    // Binance Futures 分析パネル
    analyzeBtn: "分析実行",
    reanalyzeBtn: "再分析",
    analyzingLabel: "分析中...",
    binanceFuturesSection: "📡 Binance Futures 分析",
    binanceNotListed: "Binance未上場 — MEXC独占銘柄の可能性",
    aiAnalysis: "🤖 AI分析:",
    // Phase判定
    entryJudgment: "📡 エントリー判定",
    filterSettledOnly: "安定期のみ",
    filterFsRatio5x: "先/現 5倍以上",
    colPhase: "Phase",
    sortPhase: "Phase順",
  },
  en: {
    title: "🎯 MEXC Short Scanner",
    subtitle: "Auto-scan short candidates: ATH drop × volume dry × FR × OI × exclusivity × pump detection",
    scanBtn: "🔍 Scan",
    new30Btn: "🆕 New Listings (30d)",
    csvBtn: "📥 CSV",
    autoRefresh: "⏱ Auto-refresh",
    notifEnable: "🔔 Enable Alerts",
    notifOn: "🔔 Alerts On",
    shareBtn: "🐦 Share Results",
    mexcReg: "📝 Register MEXC",
    filterTitle: "Filters",
    athDrop: "ATH Drop",
    volRatio: "Vol Ratio",
    listDays: "Listed Days",
    minVol: "Min Vol",
    minOi: "Min OI",
    loading1: "Fetching symbol list...",
    loading2: "Analyzing Kline data...",
    loading3: "Computing scores...",
    loadingNote: "Usually takes 30–60 seconds",
    emptyTitle: "Run Scan to analyze MEXC futures",
    emptyNote: "Displays top 20 by score",
    noResult: "No symbols match your filters",
    noResultNote: "Try adjusting the sliders",
    colSymbol: "Symbol",
    colScore: "Score",
    colPrice: "Price",
    colAth: "ATH%",
    colVolR: "Vol Ratio",
    col24h: "24h Chg",
    col7d: "7d Chg",
    colFr: "FR",
    colOi: "OI",
    colVol: "Volume",
    colDays: "Listed",
    colExch: "Exchange",
    colSpot: "Spot Vol",
    colFsRatio: "F/S",
    colSns: "SNS",
    openLink: "Open ↗",
    scoreLabel: "Score legend",
    scoreHigh: "10+: Strong short candidate",
    scoreMid: "6-9: Moderate",
    scoreLow: "≤5: Weak",
    scrollHint: "← Scroll for more columns",
    clickHint: "Click a row to see score breakdown",
    scanTarget: "Scanned",
    passed: "Passed filter",
    showing: "Showing",
    snapshots: "Snapshots",
    lastUpdate: "Last updated",
    newMode: "New Listing Mode",
    cgFetching: "Fetching CoinGecko...",
    tradeSetup: "⚔️ Trade Setup",
    sl: "Stop Loss",
    tp1: "Take Profit 1",
    tp2: "Take Profit 2",
    tp3: "Take Profit 3",
    rrWarning: "⚠️ R:R < 1.5",
    vpcr: "📊 Volume Profile (VPCR)",
    poc: "POC",
    current: "← current",
    cgSection: "📊 CoinGecko Data",
    prevScore: "Score Δ (prev)",
    oiChange: "OI Δ",
    frChange: "FR Δ",
    atl: "ATH (14d)",
    avgVol: "Avg Vol 7d",
    exchOnly: "MEXC Only",
    colBtcCorr: "BTC Corr",
    btcCorrHigh: "BTC Correlated",
    btcCorrLow: "BTC Independent",
    volSpikePump: "🔥 PUMP",
    volSpikeDump: "💀 DUMP",
    patBearFlag: "🚩 Bear Flag",
    patDeadCat: "🐱 Dead Cat",
    patDescWedge: "📐 Desc Wedge",
    patBOS: "🔴 BOS",
    patFVG: "⚡ FVG",
    patSupplyZone: "🏔️ Supply Zone",
    btTitle: "📊 Backtest Results",
    btPeriod: "Period",
    btSummary: "Summary",
    btTotal: "Total Records",
    btResolved: "Resolved",
    btActive: "Active",
    btExpired: "Expired",
    btWinRate: "Win Rate",
    btAvgRR: "Avg R:R",
    btExpectancy: "Expectancy",
    btBest: "Best",
    btWorst: "Worst",
    btByScore: "Win Rate by Score",
    btScoreRange: "Score Range",
    btWins: "W",
    btLosses: "L",
    btAllRecords: "All Records",
    btCsvExport: "📋 CSV Export",
    btReset: "🗑️ Reset Data",
    btResetConfirm: "Delete all backtest data?",
    btNoData: "No data yet. Run a scan to auto-record candidates with score 8+.",
    btRecorded: "📊Active",
    btTp1: "✅TP1",
    btTp2: "✅TP2",
    btTp3: "✅TP3",
    btSl: "❌SL",
    btActiveStatus: "⏳Active",
    btExpiredStatus: "⏰Expired",
    btEntryCol: "Entry",
    btSlCol: "SL",
    btTp1Col: "TP1",
    btCurCol: "Current",
    btStatusCol: "Status",
    btPnlCol: "PnL",
    btDaysCol: "Days",
    caTitle: "🔔 Custom Alert Settings",
    caMinScore: "Min Score",
    caMaxAth: "ATH Drop ≤",
    caReqPattern: "Require Pattern",
    caReqAllTf: "All TF Down",
    caReqBtcInd: "BTC Independent",
    caPreset: "Preset",
    caPresetStrong: "Strong Short",
    caPresetNewListing: "New Listing Drop",
    caPresetMtf: "Multi-TF Aligned",
    caSave: "Save",
    caReset: "Reset",
    caHits: "🔔 Custom Alerts",
    viewTable: "📋 Table",
    viewHeat: "🌡️ Heatmap",
    btEquityCurve: "📈 Equity Curve",
    btEquityR: "Cumulative R",
    heatDesc: "X: Score (right = higher) | Y: BTC Corr (bottom = independent) | Bottom-right = target zone",
    heatTarget: "🎯 Target",
    heatLegShort: "Short candidate (10+)",
    heatLegMid: "Moderate (6-9)",
    heatLegWeak: "Weak (≤5)",
    heatLegLong: "Long bias",
    longBiasTitle: "🟢 Long-Bias Symbols (Avoid Shorting)",
    longBiasBadge: "🟢 Long Bias",
    longBiasNote: "These symbols show strong bullish momentum. Avoid shorting.",
    longBiasReason: "Reason",
    frNegativeWarn: "Negative FR = Short squeeze risk",
    squeezeWarn: "⚡ Squeeze Risk",
    summaryLabel: "📊 Results",
    summaryShort: "Short candidates",
    summaryLong: "Long bias",
    summaryPattern: "Pattern",
    summaryAllTf: "All TF↓",
    summarySpike: "Spike",
    filterReset: "Reset Filters",
    staleDataWarn: "⚠️ Stale data",
    earlyListingWarn: "⚠️ Listed <3d",
    earlyListingNote: "Watch for squeeze",
    btSimTitle: "💰 Portfolio Simulation",
    btSimCapital: "Initial Capital",
    btSimPos: "Position Size",
    btSimCurAsset: "Current Value",
    btSimReturn: "Total Return",
    btSimMaxDD: "Max DD",
    btSimSharpe: "Sharpe",
    btSimInsuf: "Need 5+ resolved trades to simulate",
    soundOn: "🔊 Sound ON",
    soundOff: "🔇 Sound OFF",
    kbTitle: "⌨️ Keyboard Shortcuts",
    kbScan: "Run scan",
    kbNewScan: "New listing scan",
    kbToggleView: "Table/Heatmap toggle",
    kbFilter: "Focus filter",
    kbNav: "Select symbol",
    kbDetail: "Expand/collapse detail",
    kbClose: "Close",
    kbHelp: "Show this help",
    shareUrl: "🔗 Share URL",
    urlCopied: "🔗 URL copied!",
    autoOff: "OFF",
    autoCountdown: "Next scan",
    presetsLabel: "Presets",
    presetStandard: "Standard",
    presetStrict: "Strict Short",
    presetNewListing: "New Listing",
    presetEntryReady: "Today's Picks",
    presetSqueeze: "Squeeze Watch",
    presetMexcOnly: "MEXC Exclusive",
    presetSave: "+ Save",
    presetNamePrompt: "Enter preset name",
    presetDelConfirm: "Delete this preset?",
    toastScanDone: "found",
    toastUrlCopy: "🔗 URL copied!",
    toastCsvDone: "📄 CSV downloaded",
    toastBtRecord: "symbols auto-recorded",
    toastScanError: "Scan failed",
    // Binance Futures analysis panel
    analyzeBtn: "Run Analysis",
    reanalyzeBtn: "Re-analyze",
    analyzingLabel: "Analyzing...",
    binanceFuturesSection: "📡 Binance Futures Analysis",
    binanceNotListed: "Not on Binance — possibly MEXC exclusive",
    aiAnalysis: "🤖 AI Analysis:",
    // Phase
    entryJudgment: "📡 Entry Judgment",
    filterSettledOnly: "Settled only",
    filterFsRatio5x: "F/S ≥ 5×",
    colPhase: "Phase",
    sortPhase: "Phase",
  },
} as const;
type Translations = typeof T.ja | typeof T.en;

// ─── Extended candidate ───────────────────────────────────────────────────────
interface ExtendedCandidate extends ShortCandidate {
  listedOnBinance: boolean;
  listedOnBybit: boolean;
  exclusivityScore: number;
  frBonus: number;
  cgData: CgMarketData | null;
  futuresHeatScore: number;
  snsHeatScore: number;
  mcFdvScore: number;
  oiChangePct: number | null;
  oiChangeScore: number;
  displayScore: number;
  phase: PhaseResult;
}

interface ScanResponse {
  success: boolean; scanTime: string; candidates: ShortCandidate[];
  meta: { totalTickerPairs?: number; totalScanned?: number; filtered: number; stage1Passed?: number; stage2Fetched?: number; stage2Failed?: number };
  error?: string; mode?: string;
}

interface AnalyzeResult {
  symbol: string;
  binance: BinanceFuturesData | null;
  analysis: string;
  isBinanceListed: boolean;
}

const CG_API_KEY = process.env.NEXT_PUBLIC_COINGECKO_API_KEY ?? "";
const HAS_CG = CG_API_KEY.length > 0;
const DISPLAY_MAX = HAS_CG ? 34 : 23; // サーバー23+取引所独占2+FR連続1+先物ヒート2+SNSヒート1+MC/FDV乖離3+OI急増2=34

type SortKey = "displayScore" | "athDropPct" | "priceChange24h" | "priceChange7d" | "openInterest" | "phase";

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
function fmtPct(n: number): string { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }

// ─── Binance FR signal helpers ────────────────────────────────────────────────
function frSignalColor(sig: string): string {
  if (sig === "short_favorable") return "text-green-600";
  if (sig === "danger_squeeze")  return "text-red-600";
  if (sig === "extreme_long")    return "text-orange-600";
  return "text-gray-700";
}
function frSignalBadgeCls(sig: string): string {
  if (sig === "short_favorable") return "bg-green-100 text-green-700 border-green-300";
  if (sig === "danger_squeeze")  return "bg-red-100 text-red-700 border-red-300";
  if (sig === "extreme_long")    return "bg-orange-100 text-orange-700 border-orange-300";
  return "bg-gray-100 text-gray-600 border-gray-200";
}
function liqRiskBadgeCls(risk: string): string {
  if (risk === "high")   return "bg-red-100 text-red-700 border-red-300";
  if (risk === "medium") return "bg-orange-100 text-orange-700 border-orange-300";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

// ─── Toast ────────────────────────────────────────────────────────────────────
interface Toast { id: string; message: string; type: "success"|"info"|"warning"|"error"; leaving?: boolean; }

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  const colors: Record<string, string> = {
    success: "bg-green-500", info: "bg-blue-500", warning: "bg-orange-500", error: "bg-red-500",
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div key={toast.id}
          className={`px-4 py-2 rounded-lg shadow-lg text-white text-sm font-medium max-w-xs ${colors[toast.type] ?? "bg-gray-800"} ${toast.leaving ? "toast-leave" : "toast-enter"}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

const PHASE_ORDER: Record<Phase, number> = { SETTLED: 0, ACCUMULATING: 1, NEUTRAL: 2, CHAOTIC: 3, SQUEEZING: 4 };

function getEntryJudgment(
  phase: Phase,
  fr: number | null,
  fsRatio: number | null,
  exclusivity: number,
): { verdict: "RECOMMENDED" | "POSSIBLE" | "WAIT" | "FORBIDDEN"; label: string; emoji: string; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (phase === "SETTLED")      { score += 3; reasons.push("Phase安定期 ✓"); }
  else if (phase === "ACCUMULATING") { score += 1; reasons.push("Phase蓄積中 — 注意"); }
  else { reasons.push(`Phase: ${phase} — 待機`); }

  if (fr !== null) {
    if (fr > 0.0005)       { score += 2; reasons.push("FR +ショート有利 ✓"); }
    else if (fr > -0.0005) { score += 1; reasons.push("FR 中立 ✓"); }
    else                   { reasons.push("FR マイナス — スクイーズ注意"); }
  }

  if (fsRatio != null && fsRatio >= 5) { score += 1; reasons.push(`先/現 ${fsRatio.toFixed(1)}倍 — レバ相場 ✓`); }
  if (exclusivity === 2) { score += 1; reasons.push("MEXCのみ — 流動性薄 ✓"); }

  if (score >= 5) return { verdict: "RECOMMENDED", label: "ショート推奨",   emoji: "🟢", reasons };
  if (score >= 3) return { verdict: "POSSIBLE",    label: "ショート検討可", emoji: "🟡", reasons };
  if (phase === "SQUEEZING" || phase === "CHAOTIC") return { verdict: "FORBIDDEN", label: "エントリー禁止", emoji: "🔴", reasons };
  return { verdict: "WAIT", label: "待機", emoji: "⚪", reasons };
}

function scoreBadgeStyle(s: number): React.CSSProperties {
  const bg    = s >= 10 ? "#fef2f2" : s >= 6 ? "#fff7ed" : "#f9fafb";
  const color = s >= 10 ? "#b91c1c" : s >= 6 ? "#c2410c" : "#6b7280";
  const border = s >= 10 ? "#fca5a5" : s >= 6 ? "#fdba74" : "#d1d5db";
  return { background: bg, color, border: `1px solid ${border}`, borderRadius: "9999px", padding: "2px 8px", fontWeight: 900, fontSize: "12px", display: "inline-block", whiteSpace: "nowrap" };
}

const SCORE_BARS: Array<{ key: keyof ShortScoreBreakdown; label: string; max: number; color: string }> = [
  { key: "dropScore",      label: "ATH下落",    max: 3, color: "#ef4444" },
  { key: "volumeDryScore", label: "出来高枯渇",  max: 3, color: "#f97316" },
  { key: "frScore",        label: "FR逆張り",   max: 2, color: "#a855f7" },
  { key: "freshnessScore", label: "上場新しさ",  max: 2, color: "#3b82f6" },
  { key: "oiScore",        label: "OI過剰",     max: 2, color: "#06b6d4" },
  { key: "oiChangeScore",  label: "OI急増",     max: 2, color: "#7c3aed" },
  { key: "trendScore",     label: "TF一致度",   max: 3, color: "#10b981" },
  { key: "pumpScore",      label: "7d急騰",     max: 2, color: "#f43f5e" },
  { key: "btcCorrScore",   label: "BTC非連動",  max: 1, color: "#8b5cf6" },
  { key: "patternScore",   label: "SMCパターン", max: 3, color: "#0ea5e9" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function LiquidityBadge({ oi }: { oi: number }) {
  if (oi < 10_000) return (
    <span title="OIが極端に低く、エントリー/エグジットが困難"
      className="text-[9px] px-1 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-bold whitespace-nowrap cursor-help">
      🔴流動性危険
    </span>
  );
  if (oi < 50_000) return (
    <span title="OIが低く、流動性に注意"
      className="text-[9px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 border border-yellow-300 font-bold whitespace-nowrap cursor-help">
      🟡流動性注意
    </span>
  );
  return null;
}

function ExchangeBadges({ c, t }: { c: ExtendedCandidate; t: Translations }) {
  if (c.exclusivityScore === 2) return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold whitespace-nowrap">
      {t.exchOnly}
    </span>
  );
  return (
    <span className="text-[10px] text-gray-400 whitespace-nowrap">
      {c.listedOnBinance && <span className="mr-1 text-yellow-600">+BN</span>}
      {c.listedOnBybit   && <span className="text-blue-600">+BB</span>}
    </span>
  );
}

function ShortSignalBadge({ fr }: { fr: number | null }) {
  const signal = evaluateShortSignal(fr);
  const styles: Record<string, string> = {
    danger:    "bg-red-100 text-red-700 border-red-300",
    caution:   "bg-yellow-100 text-yellow-700 border-yellow-300",
    neutral:   "bg-gray-100 text-gray-600 border-gray-300",
    favorable: "bg-green-100 text-green-700 border-green-300",
    strong:    "bg-emerald-100 text-emerald-700 border-emerald-300",
  };
  const icons:  Record<string, string> = { danger: "🚨", caution: "⚠️", neutral: "✅", favorable: "✅", strong: "🔥" };
  const labels: Record<string, string> = { danger: "禁止", caution: "注意", neutral: "可", favorable: "有利", strong: "強推奨" };
  const cls   = styles[signal.level] ?? styles.neutral;
  return (
    <span title={signal.reason}
      className={`text-[9px] px-1.5 py-0.5 rounded border font-bold whitespace-nowrap cursor-help ${cls}`}>
      {icons[signal.level] ?? "✅"}{labels[signal.level] ?? "可"}
    </span>
  );
}

const SEV_CLS: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-300",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-300",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

// ─── Loading Progress (F) ─────────────────────────────────────────────────────
function LoadingProgress({ t, elapsed }: { t: Translations; elapsed: number }) {
  const step = elapsed < 6 ? 0 : elapsed < 35 ? 1 : 2;
  const steps = [t.loading1, t.loading2, t.loading3];
  const pct = Math.min(95, elapsed < 6 ? elapsed / 6 * 30 : elapsed < 35 ? 30 + (elapsed - 6) / 29 * 50 : 80 + (elapsed - 35) / 25 * 15);
  return (
    <div className="text-center py-12 px-4">
      <div className="max-w-sm mx-auto">
        <div className="text-3xl mb-4 animate-spin">⚙️</div>
        <div className="space-y-2 mb-4">
          {steps.map((s, i) => (
            <div key={i} className={`flex items-center gap-2 text-sm ${i === step ? "text-indigo-700 font-semibold" : i < step ? "text-green-600" : "text-gray-400"}`}>
              <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold border-2 ${
                i < step ? 'bg-green-100 border-green-500 text-green-600' :
                i === step ? 'bg-indigo-100 border-indigo-500 text-indigo-600 animate-pulse' :
                'bg-gray-100 border-gray-300 text-gray-400'}">
                {i < step ? "✓" : i + 1}
              </span>
              {s}
            </div>
          ))}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-3">{t.loadingNote}</p>
      </div>
    </div>
  );
}

// ─── Score Detail ─────────────────────────────────────────────────────────────
function ScoreDetail({ c, snapshots, alerts, t, watchlistSet, onWatchlistToggle }: { c: ExtendedCandidate; snapshots: ScanSnapshot[]; alerts: DiffAlert[]; t: Translations; watchlistSet: Set<string>; onWatchlistToggle: (sym: string) => void }) {
  const diff = getDiffSummary(c.symbol, c, snapshots);
  const symAlerts = alerts.filter(a => a.symbol === c.symbol);
  const colSpan = 15;

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisData, setAnalysisData]       = useState<AnalyzeResult | null>(null);
  const [analysisError, setAnalysisError]     = useState<string | null>(null);

  // Orderbook depth (fetched on-demand when panel opens)
  const [obData, setObData] = useState<{ bidTotal: number; askTotal: number; ratio: number; topAskWall: number | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orderbook?symbol=${c.symbol}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data?.asks || !data?.bids) return;
        let bidTotal = 0, askTotal = 0;
        let topAskWall: number | null = null, topAskSize = 0;
        for (const [p, q] of data.bids as [string, string][]) {
          bidTotal += parseFloat(p) * parseFloat(q);
        }
        for (const [p, q] of data.asks as [string, string][]) {
          const size = parseFloat(p) * parseFloat(q);
          askTotal += size;
          if (size > topAskSize) { topAskWall = parseFloat(p); topAskSize = size; }
        }
        setObData({ bidTotal, askTotal, ratio: bidTotal > 0 ? askTotal / bidTotal : 0, topAskWall });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.symbol]);

  async function runAnalysis() {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: c.symbol }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AnalyzeResult = await res.json();
      setAnalysisData(data);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "エラー");
    } finally {
      setAnalysisLoading(false);
    }
  }

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 md:px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
        {symAlerts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {symAlerts.map((a, i) => (
              <span key={i} className={`text-xs px-2 py-0.5 rounded border ${SEV_CLS[a.severity]}`}>
                🔔 {a.message}
              </span>
            ))}
          </div>
        )}

        {/* Score bars + Radar (施策7) */}
        <div className="flex flex-col md:flex-row gap-3 mb-3">
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SCORE_BARS.map(bar => (
              <div key={bar.key}>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span className="truncate">{bar.label}</span>
                  <span className="font-bold ml-1 shrink-0">{c.scoreBreakdown[bar.key]}/{bar.max}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${(c.scoreBreakdown[bar.key] / bar.max) * 100}%`, background: bar.color }} />
                </div>
              </div>
            ))}
            {/* Client scores */}
            {[
              { label: "取引所独占度", val: c.exclusivityScore, max: 2, color: "#22c55e" },
              { label: "FR連続ボーナス", val: c.frBonus, max: 1, color: "#8b5cf6" },
              { label: "RSI過熱", val: c.scoreBreakdown.rsiScore ?? 0, max: 2, color: "#f59e0b" },
            ].map(({ label, val, max, color }) => (
              <div key={label}>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span className="truncate">{label}</span><span className="font-bold">{val}/{max}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${(val / max) * 100}%`, background: color }} />
                </div>
              </div>
            ))}
            {/* OI変化率 + パターン一覧 */}
            {c.oiChangePct !== null && (
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span className="truncate">OI変化({c.oiChangePct >= 0 ? "+" : ""}{c.oiChangePct.toFixed(1)}%)</span>
                  <span className="font-bold">{c.oiChangeScore}/2</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full" style={{ width: `${(c.oiChangeScore / 2) * 100}%`, background: "#7c3aed" }} />
                </div>
              </div>
            )}
          </div>

          {/* Radar chart (施策7) */}
          {(() => {
            const { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } =
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              require("recharts") as typeof import("recharts");
            const radarData = [
              { s: "ATH",  v: (c.scoreBreakdown.dropScore / 3) * 100 },
              { s: "出来高", v: (c.scoreBreakdown.volumeDryScore / 3) * 100 },
              { s: "FR",   v: (c.scoreBreakdown.frScore / 2) * 100 },
              { s: "TF",   v: (c.scoreBreakdown.trendScore / 3) * 100 },
              { s: "OI",   v: (c.scoreBreakdown.oiScore / 2) * 100 },
              { s: "急騰",  v: (c.scoreBreakdown.pumpScore / 2) * 100 },
              { s: "独占",  v: (c.exclusivityScore / 2) * 100 },
              { s: "BTC",  v: (c.scoreBreakdown.btcCorrScore / 1) * 100 },
              { s: "RSI",  v: (c.scoreBreakdown.rsiScore / 2) * 100 },
            ];
            return (
              <div className="shrink-0 flex flex-col items-center">
                <ResponsiveContainer width={180} height={180}>
                  <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="s" tick={{ fontSize: 9, fill: "#6b7280" }} />
                    <Radar dataKey="v" stroke="#ef4444" fill="#ef4444" fillOpacity={0.25} strokeWidth={1.5} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </div>

        {/* Data grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-600 mb-2">
          <div>{t.atl}: <span className="font-mono font-semibold text-gray-800">{fmtPrice(c.ath14d)}</span></div>
          <div>{t.avgVol}: <span className="font-mono font-semibold text-gray-800">{fmtVol(c.volumeAvg7d)}</span></div>
          <div>OI: <span className="font-mono font-semibold text-gray-800">{fmtVol(c.openInterest)}</span></div>
          <div>OI/Vol: <span className={`font-mono font-semibold ${c.oiRatio > 3 ? "text-red-600" : c.oiRatio > 1.5 ? "text-orange-600" : "text-gray-800"}`}>{c.oiRatio.toFixed(2)}×</span></div>
          {c.initialPrice != null && (() => {
            const ratio = c.initialPrice > 0 ? (c.currentPrice / c.initialPrice) * 100 : null;
            return (
              <div>上場初値比: <span className={`font-mono font-semibold ${ratio == null ? "text-gray-400" : ratio < 70 ? "text-red-600 font-bold" : ratio < 90 ? "text-orange-500" : "text-gray-700"}`}>
                {ratio != null ? `${ratio.toFixed(0)}%` : "—"}
              </span></div>
            );
          })()}
          <div>24h: <span className={`font-mono font-semibold ${c.priceChange24h >= 50 ? "text-red-600" : c.priceChange24h <= -30 ? "text-green-600" : "text-gray-700"}`}>{fmtPct(c.priceChange24h)}</span></div>
          <div>7d: <span className={`font-mono font-semibold ${c.priceChange7d >= 100 ? "text-red-700" : c.priceChange7d >= 50 ? "text-red-500" : c.priceChange7d <= -30 ? "text-green-600" : "text-gray-700"}`}>{fmtPct(c.priceChange7d)}</span></div>
          <div title="BTCとの価格連動度">{t.colBtcCorr}: <span className={`font-mono font-semibold ${c.btcCorrelation >= 0.7 ? "text-red-600" : c.btcCorrelation >= 0.3 ? "text-orange-500" : "text-green-600"}`}>{c.btcCorrelation.toFixed(3)}{c.btcCorrelation < 0.3 ? " ✅" : c.btcCorrelation >= 0.7 ? " ⚠️" : ""}</span></div>
          {c.trendMultiTF && (
            <div>MTF:
              {(["h1","h4","d1"] as const).map(tf => {
                const d = c.trendMultiTF![tf];
                return <span key={tf} className={`ml-1 font-mono font-bold text-[10px] ${d==="DOWN"?"text-red-500":d==="UP"?"text-green-600":"text-gray-400"}`}>{tf.toUpperCase()}{d==="DOWN"?"↓":d==="UP"?"↑":"→"}</span>;
              })}
              {c.trendMultiTF.alignment === 3 && <span className="ml-1 text-green-600 font-bold text-xs">🎯全TF一致</span>}
            </div>
          )}
        </div>

        {/* SMCパターン一覧 (Phase2 Task3) */}
        {c.allPatterns && c.allPatterns.length > 0 && (
          <div className="mt-2 mb-1 flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500 font-medium">📐 検知パターン:</span>
            {c.allPatterns.map((p, i) => {
              const label =
                p.type === "bear_flag"          ? t.patBearFlag :
                p.type === "dead_cat"           ? t.patDeadCat :
                p.type === "descending_wedge"   ? t.patDescWedge :
                p.type === "break_of_structure" ? t.patBOS :
                p.type === "fair_value_gap"     ? t.patFVG :
                                                  t.patSupplyZone;
              return (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border font-bold bg-sky-50 text-sky-700 border-sky-300 whitespace-nowrap">
                  {label} <span className="text-sky-500">{(p.confidence * 100).toFixed(0)}%</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Short signal */}
        <div className="flex items-center gap-2 mt-2 mb-1">
          <span className="text-xs text-gray-500">ショート判定:</span>
          <ShortSignalBadge fr={c.fundingRate} />
          <span className="text-xs text-gray-500">{evaluateShortSignal(c.fundingRate).reason}</span>
        </div>

        {/* Entry Judgment */}
        {(() => {
          const sp = c.cgData?.spotVolume;
          const fsRatio = (sp && sp >= 1000) ? c.volume24h / sp : null;
          const { verdict, emoji, label, reasons } = getEntryJudgment(c.phase.phase, c.fundingRate, fsRatio, c.exclusivityScore);
          const borderCls = verdict === "RECOMMENDED" ? "border-green-300" : verdict === "FORBIDDEN" ? "border-red-300" : "border-gray-200";
          const bgCls     = verdict === "RECOMMENDED" ? "bg-green-50"     : verdict === "FORBIDDEN" ? "bg-red-50"     : "bg-white";
          return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold text-gray-700 mb-1.5">{t.entryJudgment}</p>
              <div className={`rounded-lg border ${borderCls} ${bgCls} p-2.5`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">{emoji}</span>
                  <span className="text-xs font-bold text-gray-800">{label}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded border ${phaseBadgeCls(c.phase.phase)}`}>
                    {c.phase.emoji}{c.phase.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {reasons.map((r, ri) => (
                    <span key={ri} className="text-[10px] text-gray-600">• {r}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Trade Setup (施策10) */}
        {c.tradeSetup && (() => {
          const ts = c.tradeSetup!;
          return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-gray-700">{t.tradeSetup}</p>
                {ts.rrWarning
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 border border-yellow-300 font-bold">{t.rrWarning} ({ts.rrRatio.toFixed(2)})</span>
                  : <span className="text-[10px] text-green-600 font-semibold">R:R {ts.rrRatio.toFixed(2)}</span>
                }
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[
                  { label: t.sl,  val: ts.sl,  cls: "bg-red-50 border-red-200",   txt: "text-red-700",   chg: ((ts.sl / c.currentPrice - 1) * 100), sign: "+" },
                  { label: t.tp1, val: ts.tp1, cls: "bg-green-50 border-green-200", txt: "text-green-700", chg: ((ts.tp1 / c.currentPrice - 1) * 100) },
                  { label: t.tp2, val: ts.tp2, cls: "bg-green-50 border-green-100", txt: "text-green-700", chg: ((ts.tp2 / c.currentPrice - 1) * 100) },
                  { label: t.tp3, val: ts.tp3, cls: "bg-gray-50 border-gray-200",  txt: "text-gray-700",  chg: ((ts.tp3 / c.currentPrice - 1) * 100) },
                ].map(({ label, val, cls, txt, chg }) => (
                  <div key={label} className={`rounded-lg p-2 border ${cls}`}>
                    <div className={`font-semibold mb-0.5 ${txt}`}>{label}</div>
                    <div className={`font-mono font-bold ${txt}`}>{fmtPrice(val)}</div>
                    <div className="text-gray-400 text-[10px]">{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</div>
                  </div>
                ))}
              </div>
              {c.atrData && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                  <span>ATR: <span className="font-mono font-semibold text-gray-700">{c.atrData.atrPct.toFixed(2)}%</span></span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                    c.atrData.regime === "high"     ? "bg-red-100 text-red-700 border-red-300"         :
                    c.atrData.regime === "medium"   ? "bg-orange-100 text-orange-700 border-orange-300" :
                    c.atrData.regime === "trending" ? "bg-blue-100 text-blue-700 border-blue-300"       :
                                                      "bg-gray-100 text-gray-600 border-gray-200"
                  }`}>
                    {c.atrData.regime === "high" ? "🔥 高ボラ" : c.atrData.regime === "medium" ? "📊 中ボラ" : c.atrData.regime === "trending" ? "📈 トレンド域" : "😴 低ボラ"}
                  </span>
                  {c.atrData.regime === "high" && <span className="text-orange-600 text-[10px] font-medium">SL拡張済</span>}
                </div>
              )}

              {/* TWAP Execution Simulator */}
              <div className="mt-3">
                <p className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5">💹 執行インパクト推定</p>
                {(() => {
                  const avgVol4h = c.volume24h / 6;
                  return (
                    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                      {([100, 500, 1000] as const).map(size => {
                        const volRatio = avgVol4h > 0 ? size / avgVol4h : 1;
                        const oiR = c.openInterest > 0 ? size / c.openInterest : 1;
                        let slip = volRatio <= 0.01 ? volRatio * 10 : volRatio <= 0.1 ? 0.1 + (volRatio - 0.01) * 10 : volRatio <= 0.5 ? 1 + (volRatio - 0.1) * 10 : 5 + (volRatio - 0.5) * 20;
                        if (oiR > 0.05) slip *= 1.5;
                        if (oiR > 0.1)  slip *= 2;
                        slip = Math.min(slip, 20);
                        const icon = slip >= 5 ? "🔴" : slip >= 2 ? "🟠" : slip >= 0.5 ? "🟡" : "🟢";
                        return (
                          <div key={size} className={`rounded p-1.5 text-center border ${
                            slip >= 2 ? "border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800" :
                            slip >= 0.5 ? "border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800" :
                            "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                          }`}>
                            <div className="font-semibold text-gray-700 dark:text-gray-300">${size}</div>
                            <div className="font-mono font-bold mt-0.5">{icon} {slip.toFixed(2)}%</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1">
                  ※ MEXC先物の流動性に基づく推定スリッページ（$100/$500/$1000注文時）
                </p>
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
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <p className="text-xs font-semibold text-gray-700">{t.vpcr}</p>
                <span className="text-xs text-gray-500">
                  {t.poc}: <span className="font-mono font-bold text-indigo-600">{fmtPrice(vp.poc)}</span>
                  <span className={`ml-2 font-semibold ${vp.pocVsPricePct > 0 ? "text-red-500" : "text-green-600"}`}>
                    ({vp.pocVsPricePct > 0 ? "+" : ""}{vp.pocVsPricePct.toFixed(1)}%)
                  </span>
                </span>
              </div>
              <div className="space-y-0.5">
                {[...vp.buckets].reverse().map((b, ri) => {
                  const fi = vp.buckets.length - 1 - ri;
                  const isPoc = fi === pocIdx;
                  const barPct = maxVol > 0 ? (b.vol / maxVol) * 100 : 0;
                  const isCurrent = c.currentPrice >= b.low && c.currentPrice < b.high;
                  return (
                    <div key={ri} className="flex items-center gap-2 text-[10px]">
                      <span className="w-14 text-right font-mono text-gray-500 shrink-0">{fmtPrice((b.low + b.high) / 2)}</span>
                      <div className="flex-1 h-2.5 bg-gray-100 rounded relative overflow-hidden">
                        <div className={`h-full rounded ${isPoc ? "bg-indigo-500" : "bg-blue-300"}`} style={{ width: `${barPct}%` }} />
                        {isCurrent && <div className="absolute inset-y-0 left-0 w-full border-t-2 border-dashed border-yellow-500 opacity-80 top-1/2" />}
                      </div>
                      {isPoc && <span className="text-indigo-600 font-bold shrink-0">{t.poc}</span>}
                      {isCurrent && <span className="text-yellow-600 font-bold shrink-0">{t.current}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 清算カスケードゾーン (施策5) */}
        {c.liquidationZone && (() => {
          const lz = c.liquidationZone!;
          const isLong = lz.direction === "long";
          const intCls = lz.intensity === "high" ? "bg-red-100 text-red-700 border-red-300" : lz.intensity === "medium" ? "bg-orange-50 text-orange-700 border-orange-200" : "bg-yellow-50 text-yellow-700 border-yellow-200";
          return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-700">⚡ 清算ゾーン推定</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${intCls}`}>
                  {lz.intensity === "high" ? "HIGH" : lz.intensity === "medium" ? "MED" : "LOW"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${isLong ? "bg-red-50 text-red-700 border-red-200" : "bg-purple-50 text-purple-700 border-purple-200"}`}>
                  {isLong ? "🔻 LONG清算帯" : "🔺 SHORT清算帯"}
                </span>
                <span className="font-mono text-xs font-bold text-gray-800">{fmtPrice(lz.priceLevel)}</span>
                <span className={`text-xs font-semibold ${lz.distancePct < 0 ? "text-red-500" : "text-green-600"}`}>
                  ({lz.distancePct > 0 ? "+" : ""}{lz.distancePct.toFixed(1)}%)
                </span>
              </div>
            </div>
          );
        })()}

        {/* DEX流動性 (GeckoTerminal) */}
        {(() => {
          if (!c.dex) return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <span className="text-xs text-gray-400">💧 DEXデータなし</span>
            </div>
          );
          const dex = c.dex;
          const lowLMC = dex.liquidityMcRatio !== null && dex.liquidityMcRatio < 5;
          return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-xs font-semibold text-cyan-700">💧 DEX流動性</span>
                {lowLMC && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border font-bold bg-red-100 text-red-700 border-red-300">⚠️ L/MC低い (+1pt)</span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                <div>DEX流動性: <span className={`font-mono font-semibold ${lowLMC ? "text-red-600" : "text-gray-800"}`}>{dex.liquidity ? fmtVol(dex.liquidity) : "N/A"}</span></div>
                <div>L/MC比率: <span className={`font-mono font-semibold ${lowLMC ? "text-red-600" : "text-gray-800"}`}>{dex.liquidityMcRatio !== null ? `${dex.liquidityMcRatio.toFixed(2)}%` : "N/A"}</span></div>
                <div>主要ペア: <span className="font-mono font-semibold text-gray-800 text-[10px]">{dex.topPair ?? "N/A"}</span></div>
                <div>DEX出来高: <span className="font-mono font-semibold text-gray-800">{dex.dexVolume24h ? fmtVol(dex.dexVolume24h) : "N/A"}</span></div>
              </div>
            </div>
          );
        })()}

        {/* CoinGecko (施策7) */}
        {HAS_CG && c.cgData && (() => {
          const cg = c.cgData!;
          const snsTotal = (cg.twitterFollowers ?? 0) + (cg.telegramMembers ?? 0);
          const futuresRatio = (cg.spotVolume && cg.spotVolume >= 1000) ? (c.volume24h / cg.spotVolume) * 100 : null;
          return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold text-violet-700 mb-2">{t.cgSection}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                <div>MC: <span className="font-mono font-semibold text-gray-800">{cg.marketCap ? fmtVol(cg.marketCap) : "N/A"}</span></div>
                <div>現物Vol <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className="font-mono font-semibold text-gray-800">{cg.spotVolume ? fmtVol(cg.spotVolume) : "N/A"}</span></div>
                <div>先物/現物 <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className={`font-mono font-semibold ${futuresRatio && futuresRatio > 500 ? "text-red-600" : futuresRatio && futuresRatio > 200 ? "text-orange-500" : "text-gray-800"}`}>{futuresRatio == null ? "—" : futuresRatio > 9999 ? ">9999%" : `${futuresRatio.toFixed(0)}%`}</span></div>
                {cg.mexcSharePct != null && (
                  <div>MEXC集中 <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className={`font-mono font-semibold ${cg.mexcSharePct >= 90 ? "text-red-600" : "text-gray-800 dark:text-gray-200"}`}>{cg.mexcSharePct.toFixed(1)}%</span>
                    {cg.exchangeFlowSignal && cg.exchangeFlowSignal !== "neutral" && (
                      <span className={`ml-1.5 text-[9px] font-bold ${cg.exchangeFlowSignal === "inflow" ? "text-red-600" : "text-green-600"}`}>
                        {cg.exchangeFlowSignal === "inflow" ? "🔴 MEXC集中（操作リスク）" : "🟢 取引所分散"}
                      </span>
                    )}
                  </div>
                )}
                {cg.mcFdvRatio != null && (
                  <div>MC/FDV: <span className={`font-mono font-semibold ${cg.mcFdvRatio < 0.1 ? "text-red-600 font-bold" : cg.mcFdvRatio < 0.2 ? "text-orange-500" : cg.mcFdvRatio < 0.5 ? "text-yellow-600" : "text-green-600"}`}>{(cg.mcFdvRatio * 100).toFixed(1)}%</span>{c.mcFdvScore > 0 && <span className="ml-1 text-red-500 font-bold">+{c.mcFdvScore}pt</span>}{cg.mcFdvRatio < 0.1 && <span className="ml-1 text-red-600">⚠️ 重度希薄化</span>}</div>
                )}
                <div>Twitter: <span className="font-mono text-gray-800">{cg.twitterFollowers != null ? cg.twitterFollowers.toLocaleString() : "N/A"}</span></div>
                <div>SNS合計 <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className="font-mono text-gray-800">{snsTotal > 0 ? snsTotal.toLocaleString() : "N/A"}</span></div>
              </div>
            </div>
          );
        })()}
        {!HAS_CG && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <p className="text-xs font-semibold text-violet-700 mb-2">{t.cgSection}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-gray-50 rounded p-2 text-gray-400">
              <div>現物Vol <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className="text-gray-300">🔒</span></div>
              <div>先物/現物 <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className="text-gray-300">🔒</span></div>
              <div>MEXC集中 <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className="text-gray-300">🔒</span></div>
              <div>SNS合計 <span className="px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>: <span className="text-gray-300">🔒</span></div>
            </div>
          </div>
        )}

        {/* 前回比 (施策3) */}
        {diff && (
          <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-3 gap-2 text-xs text-gray-500">
            <div>{t.prevScore}: <span className={`font-semibold ${diff.scoreDiff > 0 ? "text-red-600" : diff.scoreDiff < 0 ? "text-green-600" : "text-gray-600"}`}>{diff.scoreDiff > 0 ? "+" : ""}{diff.scoreDiff}</span></div>
            {diff.oiDiff !== null && <div>{t.oiChange}: <span className={`font-semibold ${diff.oiDiff > 0 ? "text-orange-600" : "text-gray-600"}`}>{diff.oiDiff > 0 ? "+" : ""}{diff.oiDiff.toFixed(0)}%</span></div>}
            {diff.frDiff !== null && <div>{t.frChange}: <span className={`font-semibold ${diff.frDiff > 0 ? "text-purple-600" : "text-gray-600"}`}>{diff.frDiff > 0 ? "+" : ""}{diff.frDiff.toFixed(4)}%</span></div>}
          </div>
        )}

        {/* Binance Futures 分析パネル */}
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-semibold text-blue-700">{t.binanceFuturesSection}</span>
            <button
              onClick={e => { e.stopPropagation(); runAnalysis(); }}
              disabled={analysisLoading}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 disabled:opacity-50 transition-colors"
            >
              {analysisLoading
                ? t.analyzingLabel
                : analysisData ? t.reanalyzeBtn : t.analyzeBtn}
            </button>
          </div>

          {analysisData && (
            <>
              {!analysisData.isBinanceListed ? (
                <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1.5 mb-2">
                  ⚠️ {t.binanceNotListed}
                </div>
              ) : analysisData.binance && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-600 mb-2">
                  <div>
                    FR:&nbsp;
                    <span className={`font-mono font-bold ${frSignalColor(analysisData.binance.frSignal)}`}>
                      {analysisData.binance.fundingRate >= 0 ? "+" : ""}{(analysisData.binance.fundingRate * 100).toFixed(4)}%
                    </span>
                    &nbsp;
                    <span className={`text-[9px] px-1 rounded border ${frSignalBadgeCls(analysisData.binance.frSignal)}`}>
                      {analysisData.binance.frSignal}
                    </span>
                  </div>
                  <div>
                    OI:&nbsp;
                    <span className="font-mono font-semibold text-gray-800">
                      {fmtVol(analysisData.binance.openInterestUsdt)}
                    </span>
                  </div>
                  <div>
                    OI&nbsp;24h:&nbsp;
                    <span className={`font-mono font-semibold ${(analysisData.binance.oiChange24h ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>
                      {analysisData.binance.oiChange24h !== null
                        ? `${analysisData.binance.oiChange24h >= 0 ? "+" : ""}${analysisData.binance.oiChange24h.toFixed(1)}%`
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    OI&nbsp;7d:&nbsp;
                    <span className={`font-mono font-semibold ${(analysisData.binance.oiChange7d ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>
                      {analysisData.binance.oiChange7d !== null
                        ? `${analysisData.binance.oiChange7d >= 0 ? "+" : ""}${analysisData.binance.oiChange7d.toFixed(1)}%`
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    清算リスク:&nbsp;
                    <span className={`text-[10px] px-1 rounded border font-bold ${liqRiskBadgeCls(analysisData.binance.liquidationRisk)}`}>
                      {analysisData.binance.liquidationRisk.toUpperCase()}
                    </span>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    MEXC推定FR:&nbsp;
                    <span className="font-mono text-gray-700">
                      {(analysisData.binance.mexcFrEstMin * 100).toFixed(4)}〜{(analysisData.binance.mexcFrEstMax * 100).toFixed(4)}%
                    </span>
                  </div>
                </div>
              )}
              {analysisData.analysis && (
                <div className="bg-indigo-50 border border-indigo-100 rounded p-2 text-xs text-gray-700 leading-relaxed">
                  <span className="font-semibold text-indigo-700 mr-1">{t.aiAnalysis}</span>
                  {analysisData.analysis}
                </div>
              )}
            </>
          )}

          {analysisError && (
            <div className="text-xs text-red-500 mt-1">{analysisError}</div>
          )}
        </div>

        {/* Orderbook depth */}
        {obData && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-1">📗 オーダーブック深度</p>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div><span className="text-green-600">Bid: ${(obData.bidTotal / 1000).toFixed(0)}K</span></div>
              <div><span className="text-red-600">Ask: ${(obData.askTotal / 1000).toFixed(0)}K</span></div>
              <div>
                <span className={`font-bold ${obData.ratio >= 2 ? "text-red-600" : obData.ratio >= 1.5 ? "text-orange-500" : "text-gray-600 dark:text-gray-400"}`}>
                  A/B: {obData.ratio.toFixed(2)}×
                  {obData.ratio >= 2 && " 🔴売り圧"}
                  {obData.ratio >= 1.5 && obData.ratio < 2 && " 🟡やや売り圧"}
                </span>
              </div>
            </div>
            {obData.topAskWall != null && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                最大売り板: ${obData.topAskWall < 1 ? obData.topAskWall.toFixed(6) : obData.topAskWall.toFixed(2)}
              </p>
            )}
          </div>
        )}

        {/* Price deviation (MEXC vs index) */}
        {c.priceDeviation != null && Math.abs(c.priceDeviation) >= 0.5 && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px]">
            <span className="font-semibold text-gray-700 dark:text-gray-300">📡 価格乖離 (vs Index): </span>
            <span className={`font-mono font-bold ${
              Math.abs(c.priceDeviation) >= 2 ? "text-red-600" :
              Math.abs(c.priceDeviation) >= 1 ? "text-orange-500" : "text-gray-600 dark:text-gray-400"
            }`}>
              {c.priceDeviation >= 0 ? "+" : ""}{c.priceDeviation.toFixed(2)}%
            </span>
            {Math.abs(c.priceDeviation) >= 2 && <span className="ml-1 text-red-500">⚠️ 操作リスク</span>}
          </div>
        )}

        {/* Watchlist + Share */}
        <div className="mt-2 pt-2 border-t border-gray-200 flex flex-wrap gap-2 items-center">
          {(() => {
            const base = c.symbol.replace(/_USDT$/, "");
            const inWl = watchlistSet.has(base);
            return (
              <button
                onClick={e => { e.stopPropagation(); onWatchlistToggle(base); }}
                className={`text-[11px] px-2.5 py-1 rounded border font-semibold transition-colors ${inWl ? "bg-yellow-50 text-yellow-700 border-yellow-300 hover:bg-yellow-100" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}
              >
                {inWl ? "⭐ 登録済" : "☆ ウォッチリスト追加"}
              </button>
            );
          })()}
        </div>

        {/* Share this candidate (E) */}
        <div className="mt-1.5 flex gap-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🎯 ${c.symbol.replace("_USDT","")}/USDT ショートスコア ${c.displayScore}/${DISPLAY_MAX}点\nATH比 ${c.athDropPct.toFixed(1)}% | FR ${c.fundingRate != null ? (c.fundingRate*100).toFixed(4) : "—"}%\n#MEXC #CryptoShort #暗号通貨\nhttps://bell-sig.vercel.app/short-scan`)}`}
            target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[10px] px-2 py-1 rounded bg-sky-100 text-sky-700 border border-sky-200 hover:bg-sky-200 transition-colors"
          >
            🐦 Tweet
          </a>
          <a
            href={mexcUrl(c.symbol.replace("_USDT",""))}
            target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[10px] px-2 py-1 rounded bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-200 transition-colors"
          >
            MEXC先物を開く ↗
          </a>
        </div>
      </td>
    </tr>
  );
}

// ─── Alert Panel ─────────────────────────────────────────────────────────────
function AlertPanel({ alerts }: { alerts: DiffAlert[] }) {
  const [open, setOpen] = useState(true);
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-yellow-800 hover:bg-yellow-100 transition-colors">
        <span>🔔 アラート ({alerts.length}件)</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1.5">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs px-2.5 py-1.5 rounded border ${SEV_CLS[a.severity]}`}>
              <span className="font-mono font-bold shrink-0">{a.symbol.replace("_USDT","")}</span>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Custom Alert (施策6) ──────────────────────────────────────────────────────
const CA_KEY = "bell:custom-alert-config";

interface CustomAlertConfig {
  enabled: boolean;
  minScore: number;
  maxAthDropPct: number; // e.g. -30 means drop ≥ 30%
  requirePattern: boolean;
  requireAllTfDown: boolean;
  requireBtcIndependent: boolean;
}

const CA_DEFAULTS: CustomAlertConfig = {
  enabled: false,
  minScore: 12,
  maxAthDropPct: -40,
  requirePattern: false,
  requireAllTfDown: false,
  requireBtcIndependent: false,
};

const CA_PRESETS = {
  strong:      { minScore: 14, maxAthDropPct: -50, requirePattern: false, requireAllTfDown: false, requireBtcIndependent: false },
  newListing:  { minScore: 10, maxAthDropPct: -20, requirePattern: false, requireAllTfDown: false, requireBtcIndependent: false },
  mtf:         { minScore: 12, maxAthDropPct: -30, requirePattern: false, requireAllTfDown: true,  requireBtcIndependent: false },
} as const;

function loadCAConfig(): CustomAlertConfig {
  try {
    const raw = localStorage.getItem(CA_KEY);
    if (raw) return { ...CA_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...CA_DEFAULTS };
}

function saveCAConfig(cfg: CustomAlertConfig): void {
  try { localStorage.setItem(CA_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function checkCustomAlerts(candidates: ExtendedCandidate[], cfg: CustomAlertConfig): ExtendedCandidate[] {
  if (!cfg.enabled) return [];
  return candidates.filter(c => {
    if (c.displayScore < cfg.minScore) return false;
    if (c.athDropPct > cfg.maxAthDropPct) return false;
    if (cfg.requirePattern && !c.chartPattern) return false;
    if (cfg.requireAllTfDown && (!c.trendMultiTF || c.trendMultiTF.alignment < 3)) return false;
    if (cfg.requireBtcIndependent && c.btcCorrelation >= 0.3) return false;
    return true;
  });
}

function CustomAlertPanel({ t, candidates }: { t: Translations; candidates: ExtendedCandidate[] }) {
  const [cfg, setCfg] = useState<CustomAlertConfig>(CA_DEFAULTS);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setCfg(loadCAConfig()); }, []);

  const hits = useMemo(() => checkCustomAlerts(candidates, cfg), [candidates, cfg]);

  function applyPreset(name: keyof typeof CA_PRESETS) {
    const p = CA_PRESETS[name];
    setCfg(c => ({ ...c, ...p }));
    setDirty(true);
  }

  function handleSave() {
    saveCAConfig(cfg);
    setDirty(false);
  }

  function handleReset() {
    setCfg({ ...CA_DEFAULTS });
    saveCAConfig({ ...CA_DEFAULTS });
    setDirty(false);
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 transition-colors">
        <span>{t.caTitle} {cfg.enabled && hits.length > 0 && <span className="ml-1 bg-red-500 text-white rounded-full text-[10px] px-1.5 py-0.5 font-bold">{hits.length}</span>}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Enable toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={cfg.enabled} onChange={e => { setCfg(c => ({ ...c, enabled: e.target.checked })); setDirty(true); }} className="rounded" />
            <span className="font-semibold text-indigo-700">{cfg.enabled ? "ON" : "OFF"}</span>
          </label>

          {/* Preset buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">{t.caPreset}:</span>
            {(["strong","newListing","mtf"] as const).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className="text-[10px] px-2 py-0.5 rounded-full border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100 font-semibold">
                {p === "strong" ? t.caPresetStrong : p === "newListing" ? t.caPresetNewListing : t.caPresetMtf}
              </button>
            ))}
          </div>

          {/* Conditions */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-600">{t.caMinScore}</span>
              <input type="number" min={0} max={25} value={cfg.minScore}
                onChange={e => { setCfg(c => ({ ...c, minScore: Number(e.target.value) })); setDirty(true); }}
                className="w-full px-2 py-1 border border-indigo-200 rounded text-xs font-mono" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-600">{t.caMaxAth} (%)</span>
              <input type="number" max={0} value={cfg.maxAthDropPct}
                onChange={e => { setCfg(c => ({ ...c, maxAthDropPct: Number(e.target.value) })); setDirty(true); }}
                className="w-full px-2 py-1 border border-indigo-200 rounded text-xs font-mono" />
            </label>
            {([
              ["requirePattern",       "caReqPattern"],
              ["requireAllTfDown",     "caReqAllTf"],
              ["requireBtcIndependent","caReqBtcInd"],
            ] as const).map(([field, tk]) => (
              <label key={field} className="flex items-center gap-1.5 cursor-pointer col-span-1">
                <input type="checkbox" checked={cfg[field] as boolean}
                  onChange={e => { setCfg(c => ({ ...c, [field]: e.target.checked })); setDirty(true); }}
                  className="rounded" />
                <span className="text-gray-600">{t[tk]}</span>
              </label>
            ))}
          </div>

          {/* Save/Reset */}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={!dirty}
              className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40 hover:bg-indigo-700">
              {t.caSave}
            </button>
            <button onClick={handleReset}
              className="px-3 py-1 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-gray-100">
              {t.caReset}
            </button>
          </div>

          {/* Hits */}
          {cfg.enabled && hits.length > 0 && (
            <div className="mt-1 pt-2 border-t border-indigo-200">
              <p className="text-xs font-semibold text-red-700 mb-1.5">{t.caHits} ({hits.length})</p>
              <div className="space-y-1">
                {hits.map(c => (
                  <div key={c.symbol} className="flex items-center gap-2 text-xs bg-white border border-red-200 rounded px-2 py-1">
                    <span className="font-mono font-bold text-gray-800">{c.symbol.replace("_USDT","")}</span>
                    <span style={scoreBadgeStyle(c.displayScore)}>{c.displayScore}</span>
                    {c.chartPattern && <span className="text-sky-600">📐{c.chartPattern.type.replace("_"," ")}</span>}
                    {c.trendMultiTF?.alignment === 3 && <span className="text-green-600 font-bold">🎯MTF</span>}
                    {c.btcCorrelation < 0.3 && <span className="text-purple-600">₿✗</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {cfg.enabled && hits.length === 0 && (
            <p className="text-xs text-gray-400 italic">条件に合う銘柄なし</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Heatmap View (施策7 改善) ────────────────────────────────────────────────
function HeatmapView({ candidates, t, onClickSymbol, isLongBias }: {
  candidates: ExtendedCandidate[];
  t: Translations;
  onClickSymbol: (sym: string) => void;
  isLongBias: (c: ExtendedCandidate) => boolean;
}) {
  const { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell, ReferenceArea, ReferenceLine } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("recharts") as typeof import("recharts");

  function bubbleColor(c: ExtendedCandidate): string {
    if (isLongBias(c)) return "#3b82f6";          // blue
    if (c.displayScore >= 10) return "#ef4444";   // red
    if (c.displayScore >= 6)  return "#f97316";   // orange
    return "#9ca3af";                              // gray
  }

  const data = candidates.map(c => ({
    x: c.displayScore,
    y: parseFloat(c.btcCorrelation.toFixed(3)),
    z: Math.max(20, Math.min(800, c.volume24h / 50_000)),
    symbol: c.symbol,
    name: c.symbol.replace("_USDT",""),
    athDropPct: c.athDropPct,
    fundingRate: c.fundingRate,
    volume24h: c.volume24h,
    exclusivityScore: c.exclusivityScore,
    hasPattern: !!c.chartPattern,
    allTfDown: c.trendMultiTF?.alignment === 3,
    longBias: isLongBias(c),
    color: bubbleColor(c),
    phase: c.phase.phase,
  }));

  return (
    <div className="w-full rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500 mb-3">{t.heatDesc}</p>
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 10 }}>
          {/* 狙い目ゾーン: score≥10, corr<0.3 */}
          <ReferenceArea
            x1={10} x2={DISPLAY_MAX} y1={-0.5} y2={0.3}
            fill="#16a34a" fillOpacity={0.07}
            stroke="#16a34a" strokeOpacity={0.3} strokeDasharray="4 4"
          />
          <ReferenceLine x={10} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
          <ReferenceLine y={0.3} stroke="#a855f7" strokeDasharray="3 3" strokeOpacity={0.5} />
          <XAxis
            dataKey="x" type="number" name="Score"
            tick={{ fontSize: 10 }} domain={[0, DISPLAY_MAX]}
            label={{ value: "スコア →", position: "insideBottom", offset: -12, fontSize: 11 }}
          />
          <YAxis
            dataKey="y" type="number" name="BTC相関"
            tick={{ fontSize: 10 }} domain={[-0.5, 1.0]}
            label={{ value: "BTC相関 ↑", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <ZAxis dataKey="z" range={[20, 600]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              const frPct = d.fundingRate != null ? (d.fundingRate * 100).toFixed(4) : "—";
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-xl min-w-[160px]">
                  <p className="font-bold text-gray-800 mb-1">{d.name}/USDT</p>
                  <p>スコア: <span className="font-mono font-bold" style={{ color: d.color }}>{d.x}/{DISPLAY_MAX}</span></p>
                  <p>ATH比: <span className="font-mono text-red-600">{d.athDropPct.toFixed(1)}%</span></p>
                  <p>BTC相関: <span className={`font-mono ${d.y < 0.3 ? "text-green-600" : d.y >= 0.7 ? "text-red-600" : "text-orange-500"}`}>{d.y.toFixed(2)}</span></p>
                  <p>FR: <span className="font-mono">{frPct !== "—" ? `${Number(frPct) >= 0 ? "+" : ""}${frPct}%` : "—"}</span></p>
                  <p>出来高: <span className="font-mono">{fmtVol(d.volume24h)}</span></p>
                  {d.exclusivityScore === 2 && <p className="text-red-600 font-semibold">MEXCのみ</p>}
                  {d.hasPattern && <p className="text-sky-600">📐 パターン検知</p>}
                  {d.allTfDown && <p className="text-green-600">🎯 全TFダウン</p>}
                  {d.longBias && <p className="text-blue-600 font-semibold">🟢 ロング優位</p>}
                  <p className="text-gray-400 mt-1 text-[10px]">クリックで詳細</p>
                </div>
              );
            }}
          />
          <Scatter
            data={data}
            shape="circle"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(point: any) => {
              if (point && point.symbol) onClickSymbol(point.symbol as string);
            }}
            style={{ cursor: "pointer" }}
          >
            {data.map((entry, i) => {
              const phaseBorder =
                entry.phase === "SETTLED"      ? { stroke: "#22c55e", w: 2 } :
                entry.phase === "ACCUMULATING" ? { stroke: "#f59e0b", w: 2 } :
                entry.phase === "CHAOTIC"      ? { stroke: "#f97316", w: 2 } :
                entry.phase === "SQUEEZING"    ? { stroke: "#ef4444", w: 2 } :
                entry.hasPattern ? { stroke: "#0ea5e9", w: 2 } :
                entry.allTfDown  ? { stroke: "#16a34a", w: 2 } :
                { stroke: "transparent", w: 0 };
              return (
                <Cell
                  key={i}
                  fill={entry.color}
                  fillOpacity={0.75}
                  stroke={phaseBorder.stroke}
                  strokeWidth={phaseBorder.w}
                />
              );
            })}
          </Scatter>
          {/* 狙い目ラベル */}
          <text x="75%" y="12" textAnchor="middle" fill="#16a34a" fontSize={10} fontWeight={700}>{t.heatTarget}</text>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500 flex-wrap">
        <span><span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-1" />{t.heatLegShort}</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-orange-400 mr-1" />{t.heatLegMid}</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-gray-400 mr-1" />{t.heatLegWeak}</span>
        <span><span className="inline-block w-3 h-3 rounded-full bg-blue-500 mr-1" />{t.heatLegLong}</span>
        <span className="ml-auto text-gray-400">🟢枠=パターン / 🔵枠=全TFダウン</span>
      </div>
    </div>
  );
}

// ─── Summary Bar (修正5) ─────────────────────────────────────────────────────
function SummaryBar({ candidates, t, onFilter, isLongBias, summaryFilter, strongThreshold = 10 }: {
  candidates: ExtendedCandidate[];
  t: Translations;
  onFilter: (key: "strong" | "long" | "pattern" | "allTf" | "spike") => void;
  isLongBias: (c: ExtendedCandidate) => boolean;
  summaryFilter: "strong" | "long" | "pattern" | "allTf" | "spike" | null;
  strongThreshold?: number;
}) {
  const counts = useMemo(() => ({
    strong:  candidates.filter(c => c.displayScore >= strongThreshold).length,
    long:    candidates.filter(c => isLongBias(c)).length,
    pattern: candidates.filter(c => !!c.chartPattern).length,
    allTf:   candidates.filter(c => c.trendMultiTF?.alignment === 3).length,
    spike:   candidates.filter(c => c.volumeSpike && c.volumeSpike.direction !== "neutral").length,
  }), [candidates, isLongBias, strongThreshold]);

  const items: Array<{ key: "strong"|"long"|"pattern"|"allTf"|"spike"; label: string; count: number; cls: string }> = [
    { key: "strong",  label: t.summaryShort,   count: counts.strong,  cls: "text-red-600 bg-red-50 border-red-200" },
    { key: "long",    label: t.summaryLong,     count: counts.long,    cls: "text-green-700 bg-green-50 border-green-200" },
    { key: "pattern", label: t.summaryPattern,  count: counts.pattern, cls: "text-sky-700 bg-sky-50 border-sky-200" },
    { key: "allTf",   label: t.summaryAllTf,    count: counts.allTf,   cls: "text-indigo-600 bg-indigo-50 border-indigo-200" },
    { key: "spike",   label: t.summarySpike,    count: counts.spike,   cls: "text-orange-600 bg-orange-50 border-orange-200" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs px-1">
      <span className="font-semibold text-gray-500">{t.summaryLabel}:</span>
      {items.map(({ key, label, count, cls }) => {
        const isActive = summaryFilter === key;
        return (
          <button key={key} onClick={() => onFilter(key)}
            className={`px-2 py-0.5 rounded-full border font-semibold transition-all ${cls} ${
              isActive
                ? "ring-2 ring-offset-1 ring-current scale-105 shadow-sm"
                : "opacity-60 hover:opacity-100"
            }`}>
            {label} <span className="font-bold">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Long Bias (修正3) ────────────────────────────────────────────────────────
interface LongBiasScore {
  trendUp: boolean;        // 2TF以上UP
  momentum: boolean;       // 7d > +20%
  frNegative: boolean;     // FR < 0
  volumeExpanding: boolean; // vol ratio > 1.5
  total: number;           // 0-4
}

function calcLongBias(c: ExtendedCandidate): LongBiasScore {
  const upCount = c.trendMultiTF
    ? [c.trendMultiTF.h1, c.trendMultiTF.h4, c.trendMultiTF.d1].filter(d => d === "UP").length
    : (c.trendDirection === "UP" ? 1 : 0);
  const trendUp        = upCount >= 2;
  const momentum       = c.priceChange7d > 20;
  const frNegative     = c.fundingRate !== null && c.fundingRate < 0;
  const volumeExpanding = c.volumeChangeRatio > 1.5;
  const total = [trendUp, momentum, frNegative, volumeExpanding].filter(Boolean).length;
  return { trendUp, momentum, frNegative, volumeExpanding, total };
}

function isLongBias(c: ExtendedCandidate): boolean {
  return calcLongBias(c).total >= 3;
}

function LongBiasPanel({ candidates, t }: { candidates: ExtendedCandidate[]; t: Translations }) {
  const [open, setOpen] = useState(true);
  const biased = useMemo(
    () => candidates.filter(isLongBias).slice(0, 5),
    [candidates]
  );
  if (biased.length === 0) return null;

  function reasonStr(c: ExtendedCandidate, t: Translations): string {
    const lb = calcLongBias(c);
    const parts: string[] = [];
    if (lb.momentum)        parts.push(`7d+${c.priceChange7d.toFixed(0)}%急騰`);
    if (lb.frNegative)      parts.push(`FR${(c.fundingRate! * 100).toFixed(4)}%（負）`);
    if (lb.volumeExpanding) parts.push(`出来高${c.volumeChangeRatio.toFixed(1)}x拡大`);
    if (lb.trendUp)         parts.push("TFアップトレンド");
    return parts.join(" + ");
  }

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-green-800 hover:bg-green-100 transition-colors">
        <span>{t.longBiasTitle} <span className="ml-1 text-xs font-normal text-green-600">({biased.length}件)</span></span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-2">
          <p className="text-xs text-green-700">{t.longBiasNote}</p>
          {biased.map(c => {
            const tf = c.trendMultiTF;
            const frPct = c.fundingRate != null ? (c.fundingRate * 100).toFixed(4) : "—";
            return (
              <div key={c.symbol} className="bg-white rounded-lg border border-green-200 p-2.5">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono font-bold text-gray-800 text-sm">{c.symbol.replace("_USDT","")}/USDT</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300 font-bold whitespace-nowrap">{t.longBiasBadge}</span>
                </div>
                <div className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>7d: <span className={`font-mono font-bold ${c.priceChange7d >= 50 ? "text-red-600" : c.priceChange7d >= 20 ? "text-orange-500" : "text-gray-700"}`}>{fmtPct(c.priceChange7d)}</span></span>
                  {tf && <span>TF: {(["h1","h4","d1"] as const).map(tf2 => {
                    const d = tf[tf2];
                    return <span key={tf2} className={`font-bold ${d==="UP"?"text-green-600":d==="DOWN"?"text-red-500":"text-gray-400"}`}>{d==="UP"?"↑":d==="DOWN"?"↓":"→"}</span>;
                  })}</span>}
                  <span>FR: <span className={`font-mono ${c.fundingRate != null && c.fundingRate < 0 ? "text-green-600 font-bold" : "text-gray-600"}`}>{frPct !== "—" ? `${Number(frPct) >= 0 ? "+" : ""}${frPct}%` : "—"}</span></span>
                </div>
                <p className="text-[10px] text-green-700 mt-1">{t.longBiasReason}: {reasonStr(c, t)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sortable TH ────────────────────────────────────────────────────────────
function SortTh({ label, sortKey, current, onSort, cls = "text-right" }: { label: string; sortKey: SortKey; current: SortKey; onSort: (k: SortKey) => void; cls?: string }) {
  return (
    <th className={`px-1 py-1 ${cls} cursor-pointer select-none hover:text-indigo-600 transition-colors text-xs`}
      onClick={() => onSort(sortKey)}>
      {label}{current === sortKey ? " ▼" : ""}
    </th>
  );
}

// ─── Backtest helpers ────────────────────────────────────────────────────────
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
}

function btStatusLabel(status: BacktestRecord["status"], t: Translations): { label: string; cls: string } {
  switch (status) {
    case "tp3_hit": return { label: t.btTp3, cls: "text-green-700 bg-green-50 border-green-300" };
    case "tp2_hit": return { label: t.btTp2, cls: "text-green-700 bg-green-50 border-green-300" };
    case "tp1_hit": return { label: t.btTp1, cls: "text-green-700 bg-green-50 border-green-200" };
    case "sl_hit":  return { label: t.btSl,  cls: "text-red-700 bg-red-50 border-red-300" };
    case "expired": return { label: t.btExpiredStatus, cls: "text-gray-500 bg-gray-100 border-gray-300" };
    default:        return { label: t.btActiveStatus,  cls: "text-yellow-700 bg-yellow-50 border-yellow-300" };
  }
}

function exportBtCSV(records: BacktestRecord[]): void {
  const hdr = ["Symbol","Score","ScoreMax","RecordedAt","EntryPrice","SL","TP1","TP2","TP3","R:R","Trend","Status","ResolvedAt","ResolvedPrice","PnL%","MaxProfit%","MaxDrawdown%","Days"].join(",");
  const rows = records.map(r => {
    const days = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
    const pnl  = r.resolvedPrice != null ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice * 100).toFixed(2) : "";
    return [
      r.symbol.replace("_USDT",""), r.score, r.scoreMax,
      new Date(r.recordedAt).toISOString(),
      r.entryPrice, r.sl, r.tp1, r.tp2, r.tp3,
      r.rrRatio.toFixed(2), r.trendDirection, r.status,
      r.resolvedAt   ? new Date(r.resolvedAt).toISOString()  : "",
      r.resolvedPrice ?? "", pnl,
      r.maxProfit?.toFixed(2) ?? "", r.maxDrawdown?.toFixed(2) ?? "", days,
    ].join(",");
  });
  const blob = new Blob(["﻿" + [hdr, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `mexc-backtest-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ─── Backtest Panel ───────────────────────────────────────────────────────────
function BacktestPanel({
  records, stats, t, onReset,
}: { records: BacktestRecord[]; stats: BacktestStats; t: Translations; onReset: () => void }) {
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
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-indigo-50 transition-colors">
        <span>
          {t.btTitle}
          {records.length > 0 && (
            <span className="ml-2 text-xs font-normal text-indigo-500">
              {t.btTotal}: {records.length} / {t.btWinRate}: {stats.winRate.toFixed(0)}%
              {stats.active > 0 && <span className="ml-2 text-yellow-600">⏳{stats.active}</span>}
            </span>
          )}
        </span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {records.length === 0 ? (
            <p className="text-xs text-gray-400 py-3">{t.btNoData}</p>
          ) : (
            <>
              {/* Period */}
              <p className="text-xs text-gray-500">{t.btPeriod}: <span className="font-semibold text-gray-700">{periodStr}</span></p>

              {/* Summary grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: t.btTotal,    val: records.length,              cls: "text-gray-700" },
                  { label: t.btResolved, val: stats.resolved,              cls: "text-gray-700" },
                  { label: t.btActive,   val: stats.active,                cls: "text-yellow-600 font-bold" },
                  { label: t.btExpired,  val: stats.expired,               cls: "text-gray-400" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 text-center">
                    <div className={`text-base font-bold ${s.cls}`}>{s.val}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* TP / SL breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: "TP1+",  val: `${stats.tp1Hits + stats.tp2Hits + stats.tp3Hits}件`, cls: "text-green-700" },
                  { label: "SL",    val: `${stats.slHits}件`,                                   cls: "text-red-600" },
                  { label: t.btWinRate, val: `${stats.winRate.toFixed(1)}%`,                   cls: stats.winRate >= 50 ? "text-green-700 font-bold" : "text-red-600 font-bold" },
                  { label: t.btAvgRR,   val: stats.avgRR.toFixed(2),                           cls: stats.avgRR >= 0 ? "text-indigo-700 font-bold" : "text-red-600 font-bold" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 text-center">
                    <div className={`text-base font-bold ${s.cls}`}>{s.val}</div>
                    <div className="text-gray-500 text-[10px] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Expectancy + Best/Worst */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                  <span className="text-gray-500">{t.btExpectancy}: </span>
                  <span className={`font-bold ${stats.expectancy >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {stats.expectancy >= 0 ? "+" : ""}{stats.expectancy.toFixed(2)}R
                  </span>
                </div>
                {stats.bestTrade && (
                  <div className="bg-green-50 rounded-lg p-2 border border-green-100">
                    <span className="text-gray-500">{t.btBest}: </span>
                    <span className="font-mono font-bold text-green-700">{stats.bestTrade.symbol.replace("_USDT","")}</span>
                    <span className="text-green-600 ml-1">-{stats.bestTrade.profit.toFixed(1)}%</span>
                  </div>
                )}
                {stats.worstTrade && (
                  <div className="bg-red-50 rounded-lg p-2 border border-red-100">
                    <span className="text-gray-500">{t.btWorst}: </span>
                    <span className="font-mono font-bold text-red-700">{stats.worstTrade.symbol.replace("_USDT","")}</span>
                    <span className="text-red-600 ml-1">+{stats.worstTrade.loss.toFixed(1)}%</span>
                  </div>
                )}
              </div>

              {/* Phase3 Task2: 高度パフォーマンス指標 */}
              {stats.resolved >= 3 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {[
                    {
                      label: "Profit Factor",
                      val: stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2),
                      cls: stats.profitFactor >= 1.5 ? "text-green-700" : stats.profitFactor >= 1 ? "text-yellow-600" : "text-red-600",
                    },
                    {
                      label: "Recovery Factor",
                      val: stats.recoveryFactor === Infinity ? "∞" : stats.recoveryFactor.toFixed(2),
                      cls: stats.recoveryFactor >= 2 ? "text-green-700" : stats.recoveryFactor >= 1 ? "text-yellow-600" : "text-red-600",
                    },
                    {
                      label: "Calmar Ratio",
                      val: stats.calmarRatio.toFixed(2),
                      cls: stats.calmarRatio >= 2 ? "text-green-700" : stats.calmarRatio >= 1 ? "text-yellow-600" : "text-red-600",
                    },
                    {
                      label: "平均決着日数",
                      val: `${stats.avgDaysToResolve.toFixed(1)}d`,
                      cls: "text-gray-700",
                    },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 text-center">
                      <div className={`text-sm font-black ${s.cls}`}>{s.val}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Score range table */}
              {stats.resolved > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">{t.btByScore}</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                          <th className="px-3 py-1.5 text-left">{t.btScoreRange}</th>
                          <th className="px-3 py-1.5 text-center">{t.btWins}</th>
                          <th className="px-3 py-1.5 text-center">{t.btLosses}</th>
                          <th className="px-3 py-1.5 text-right">{t.btWinRate}</th>
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

              {/* Equity Curve */}
              {stats.resolved >= 2 && (() => {
                const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } =
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require("recharts") as typeof import("recharts");

                const resolved = [...records]
                  .filter(r => r.status !== "active" && r.resolvedAt !== null && r.resolvedPrice !== null)
                  .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

                let cumR = 0;
                const equityData = resolved.map(r => {
                  const profit = r.entryPrice - (r.resolvedPrice ?? r.entryPrice);
                  const risk   = r.sl - r.entryPrice;
                  const realR  = risk > 0 ? profit / risk : 0;
                  cumR += realR;
                  return { name: r.symbol.replace("_USDT",""), r: parseFloat(cumR.toFixed(2)) };
                });

                return (
                  <div className="mt-1">
                    <p className="text-xs font-semibold text-gray-600 mb-1.5">{t.btEquityCurve}</p>
                    <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={equityData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                          <YAxis tick={{ fontSize: 9 }} unit="R" />
                          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                          <Tooltip formatter={(v) => [`${v}R`, t.btEquityR]} labelStyle={{ fontSize: 10 }} contentStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="r" stroke={cumR >= 0 ? "#16a34a" : "#dc2626"} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <p className="text-[10px] text-gray-400 text-right mt-0.5">
                        {t.btEquityR}: <span className={`font-bold ${cumR >= 0 ? "text-green-600" : "text-red-600"}`}>{cumR >= 0 ? "+" : ""}{cumR.toFixed(2)}R</span>
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Portfolio Simulation (修正6) */}
              <div className="mt-2 rounded-lg border border-emerald-200 overflow-hidden">
                <button onClick={() => setSimOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 transition-colors">
                  <span>{t.btSimTitle}</span>
                  <span className="text-gray-400">{simOpen ? "▲" : "▼"}</span>
                </button>
                {simOpen && (() => {
                  if (stats.resolved < 5) {
                    return (
                      <div className="px-3 py-3 text-xs text-gray-400 text-center">{t.btSimInsuf}</div>
                    );
                  }

                  const resolved = [...records]
                    .filter(r => r.status !== "active" && r.resolvedAt !== null && r.resolvedPrice !== null)
                    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

                  // Build equity curve in $ terms
                  let equity = simCapital;
                  let peak = simCapital;
                  let maxDD = 0;
                  const equityPoints: number[] = [simCapital];
                  const returns: number[] = [];

                  for (const r of resolved) {
                    const profit = r.entryPrice - (r.resolvedPrice ?? r.entryPrice);
                    const risk   = r.sl - r.entryPrice;
                    const realR  = risk > 0 ? profit / risk : 0;
                    const pnl    = realR * simPos;
                    equity += pnl;
                    returns.push(pnl / (equity - pnl || simCapital));
                    equityPoints.push(parseFloat(equity.toFixed(2)));
                    if (equity > peak) peak = equity;
                    const dd = (peak - equity) / peak * 100;
                    if (dd > maxDD) maxDD = dd;
                  }

                  const totalReturn = ((equity - simCapital) / simCapital) * 100;

                  // Sharpe: mean return / std dev (simplified, no risk-free rate)
                  const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
                  const variance = returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / returns.length;
                  const sharpe = variance > 0 ? meanR / Math.sqrt(variance) * Math.sqrt(returns.length) : 0;

                  return (
                    <div className="px-3 py-3 space-y-3 bg-white">
                      {/* Sliders */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-1">
                            {t.btSimCapital}: <span className="text-emerald-700">${simCapital.toLocaleString()}</span>
                          </label>
                          <input type="range" min={100} max={10000} step={100} value={simCapital}
                            onChange={e => setSimCapital(Number(e.target.value))}
                            className="w-full accent-emerald-500 h-1.5" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 font-semibold block mb-1">
                            {t.btSimPos}: <span className="text-emerald-700">${simPos.toLocaleString()}</span>
                          </label>
                          <input type="range" min={10} max={Math.min(simCapital, 1000)} step={10} value={simPos}
                            onChange={e => setSimPos(Number(e.target.value))}
                            className="w-full accent-emerald-500 h-1.5" />
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: t.btSimCurAsset, val: `$${equity.toLocaleString("en-US",{maximumFractionDigits:0})}`, cls: equity >= simCapital ? "text-green-700" : "text-red-600" },
                          { label: t.btSimReturn,   val: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`, cls: totalReturn >= 0 ? "text-green-700" : "text-red-600" },
                          { label: t.btSimMaxDD,    val: `-${maxDD.toFixed(1)}%`, cls: maxDD > 20 ? "text-red-600 font-bold" : "text-orange-500" },
                          { label: t.btSimSharpe,   val: sharpe.toFixed(2), cls: sharpe >= 1 ? "text-green-700" : sharpe >= 0 ? "text-orange-500" : "text-red-600" },
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

              {/* Full records (expandable) */}
              <div>
                <button onClick={() => setShowRecords(v => !v)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                  {t.btAllRecords} ({records.length}) {showRecords ? "▲" : "▼"}
                </button>
                {showRecords && (
                  <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 font-semibold">
                          <th className="px-2 py-1.5 text-left">銘柄</th>
                          <th className="px-2 py-1.5 text-center">Score</th>
                          <th className="px-2 py-1.5 text-right">日付</th>
                          <th className="px-2 py-1.5 text-right">{t.btEntryCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btSlCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btTp1Col}</th>
                          <th className="px-2 py-1.5 text-right">{t.btCurCol}</th>
                          <th className="px-2 py-1.5 text-center">{t.btStatusCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btPnlCol}</th>
                          <th className="px-2 py-1.5 text-right">{t.btDaysCol}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(r => {
                          const { label, cls } = btStatusLabel(r.status, t);
                          const resolvedPnl = r.resolvedPrice != null
                            ? ((r.entryPrice - r.resolvedPrice) / r.entryPrice * 100)
                            : null;
                          const currentPnl = r.currentPrice != null
                            ? ((r.entryPrice - r.currentPrice) / r.entryPrice * 100)
                            : null;
                          const pnl = resolvedPnl ?? currentPnl;
                          const days = Math.floor((Date.now() - r.recordedAt) / 86_400_000);
                          return (
                            <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-2 py-1.5 font-mono font-bold text-gray-800">{r.symbol.replace("_USDT","")}</td>
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

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button onClick={() => exportBtCSV(records)}
                  className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
                  {t.btCsvExport}
                </button>
                <button onClick={() => { if (window.confirm(t.btResetConfirm)) onReset(); }}
                  className="px-3 py-1.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  {t.btReset}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter Presets (施策6) ───────────────────────────────────────────────────
interface FilterPreset {
  name: string;
  icon: string;
  description?: string;
  minDrop: number;
  maxVolRatio: number;
  minVol24k: number;
  maxDays: number;
  minOiK: number;
  filterSettledOnly?: boolean;
  filterFsRatio5x?: boolean;
  sortBy?: SortKey;
  summaryFilter?: "strong" | "long" | "pattern" | "allTf" | "spike" | null;
}
const DEFAULT_PRESETS: FilterPreset[] = [
  {
    name: "本日のおすすめ",
    icon: "🔥",
    description: "スコア10+の強いショート候補のみ表示。迷ったらこれ",
    minDrop: 20, maxVolRatio: 150, minVol24k: 50, maxDays: 9999, minOiK: 0,
    sortBy: "displayScore",
    summaryFilter: "strong",
  },
  {
    name: "スキャルプ(即日〜3日)",
    icon: "⚡",
    description: "新規上場直後のポンプ崩壊狙い。上場7日以内",
    minDrop: 5, maxVolRatio: 500, minVol24k: 10, maxDays: 7, minOiK: 0,
    sortBy: "priceChange24h",
    summaryFilter: null,
  },
  {
    name: "スイング(1-2週間)",
    icon: "📉",
    description: "FR過熱+出来高枯渇の安定ショート。上場30日+",
    minDrop: 30, maxVolRatio: 70, minVol24k: 100, maxDays: 9999, minOiK: 30,
    sortBy: "displayScore",
    summaryFilter: null,
  },
  {
    name: "新規上場ハンター",
    icon: "🆕",
    description: "上場30日以内。出来高閾値緩め",
    minDrop: 10, maxVolRatio: 150, minVol24k: 10, maxDays: 30, minOiK: 0,
    sortBy: "displayScore",
    summaryFilter: null,
  },
  {
    name: "MEXC独占",
    icon: "🎪",
    description: "Binance/Bybitに未上場。流動性の薄さが武器",
    minDrop: 20, maxVolRatio: 100, minVol24k: 50, maxDays: 9999, minOiK: 0,
    sortBy: "displayScore",
    summaryFilter: null,
  },
  {
    name: "デッドキャット",
    icon: "🐱",
    description: "パターン検知+全TF下降のみ表示",
    minDrop: 40, maxVolRatio: 100, minVol24k: 50, maxDays: 9999, minOiK: 0,
    sortBy: "athDropPct",
    summaryFilter: "pattern",
  },
  {
    name: "FR収穫",
    icon: "💰",
    description: "FR高止まり銘柄。デルタニュートラル or 純ショート",
    minDrop: 10, maxVolRatio: 200, minVol24k: 100, maxDays: 9999, minOiK: 50,
    sortBy: "displayScore",
    summaryFilter: null,
  },
];
const CUSTOM_PRESETS_KEY = "shortScanPresets";
function loadCustomPresets(): FilterPreset[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) ?? "[]"); } catch { return []; }
}
function saveCustomPresets(presets: FilterPreset[]) {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets.slice(0, 5)));
}

const EN_NAMES: Record<string, string> = {
  "本日のおすすめ": "Today's Picks",
  "スキャルプ(即日〜3日)": "Scalp (1-3d)",
  "スイング(1-2週間)": "Swing (1-2w)",
  "新規上場ハンター": "New Listing",
  "MEXC独占": "MEXC Only",
  "デッドキャット": "Dead Cat",
  "FR収穫": "FR Harvest",
};

function FilterPresets({ t, lang, customPresets, onApply, onSaveCurrent, onDeleteCustom }: {
  t: Translations;
  lang: Lang;
  customPresets: FilterPreset[];
  onApply: (p: FilterPreset) => void;
  onSaveCurrent: () => void;
  onDeleteCustom: (idx: number) => void;
}) {
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const handleApply = (p: FilterPreset) => {
    onApply(p);
    setActivePreset(p.name);
  };

  const presetLabel = (p: FilterPreset) => {
    const displayName = lang === "en" ? (EN_NAMES[p.name] ?? p.name) : p.name;
    return `${p.icon} ${displayName}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-gray-500 font-semibold shrink-0">{t.presetsLabel}:</span>
      {DEFAULT_PRESETS.map((p, i) => (
        <button
          key={i}
          onClick={() => handleApply(p)}
          title={p.description ?? ""}
          className={`px-2.5 py-1 rounded-lg border transition-colors ${
            activePreset === p.name
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-gray-600 border-gray-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700"
          }`}
        >
          {presetLabel(p)}
        </button>
      ))}
      {customPresets.map((p, i) => (
        <div key={`c${i}`} className="flex items-center">
          <button
            onClick={() => handleApply(p)}
            title={p.description ?? "カスタムプリセット"}
            className={`px-2.5 py-1 rounded-l-lg border transition-colors ${
              activePreset === p.name
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700"
            }`}
          >
            {presetLabel(p)}
          </button>
          <button onClick={() => onDeleteCustom(i)}
            className="px-1.5 py-1 rounded-r-lg border border-l-0 border-gray-300 bg-white hover:bg-red-50 hover:text-red-500 text-gray-400 transition-colors">
            ✕
          </button>
        </div>
      ))}
      <button onClick={onSaveCurrent}
        className="px-2.5 py-1 rounded-lg border border-dashed border-gray-300 bg-white hover:bg-gray-50 text-gray-500 transition-colors">
        {t.presetSave}
      </button>
    </div>
  );
}

// ─── Shortcut Help Modal (施策3) ──────────────────────────────────────────────
function ShortcutHelpModal({ t, onClose }: { t: Translations; onClose: () => void }) {
  const rows = [
    ["S", t.kbScan], ["N", t.kbNewScan], ["H", t.kbToggleView],
    ["F", t.kbFilter], ["↑/↓", t.kbNav], ["Enter", t.kbDetail],
    ["Esc", t.kbClose], ["?", t.kbHelp],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-5 w-full max-w-xs mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t.kbTitle}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          {rows.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-xs font-mono font-bold text-gray-700 dark:text-gray-200 min-w-[40px] text-center">{key}</kbd>
              <span className="text-xs text-gray-600">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ShortScanner() {
  const [data,         setData]         = useState<ScanResponse | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [loadStart,    setLoadStart]    = useState(0);
  const [elapsed,      setElapsed]      = useState(0);
  const [error,        setError]        = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [autoRefresh,  setAutoRefresh]  = useState(false);
  const autoTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const playSoundRef  = useRef<((type: "alert"|"complete"|"warning") => void) | null>(null);

  // Sound (施策2)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("shortScanSound") === "on";
  });
  const toggleSound = () => setSoundEnabled(v => {
    const next = !v;
    localStorage.setItem("shortScanSound", next ? "on" : "off");
    return next;
  });
  useEffect(() => {
    playSoundRef.current = (type: "alert"|"complete"|"warning") => {
      if (!soundEnabled) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        const play = (freq: number, vol: number, start: number, dur: number) => {
          const osc = ctx.createOscillator();
          osc.connect(gain);
          osc.frequency.value = freq;
          gain.gain.value = vol;
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + dur);
        };
        if (type === "alert") {
          play(880, 0.3, 0, 0.15);
          play(1100, 0.3, 0.22, 0.15);
        } else if (type === "complete") {
          play(660, 0.2, 0, 0.1);
        } else {
          play(440, 0.3, 0, 0.3);
        }
      } catch { /* AudioContext blocked */ }
    };
  }, [soundEnabled]);

  // Language (G)
  const [lang, setLang] = useState<Lang>("ja");
  const t = T[lang];

  // Notifications (D)
  const [notifState, setNotifState] = useState<"default"|"granted"|"denied">("default");
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifState(Notification.permission as "default"|"granted"|"denied");
  }, []);
  async function requestNotif() {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifState(perm as "default"|"granted"|"denied");
  }
  function sendNotif(title: string, body: string) {
    if (notifState !== "granted") return;
    try { new Notification(title, { body, icon: "/favicon.ico" }); } catch { /* ignore */ }
  }

  // Exchange symbols (施策2)
  const [binanceSyms, setBinanceSyms] = useState<Set<string>>(new Set());
  const [bybitSyms,   setBybitSyms]   = useState<Set<string>>(new Set());

  // Snapshots (施策3)
  const [snapshots, setSnapshots] = useState<ScanSnapshot[]>([]);

  // Filters
  const [minDrop,          setMinDrop]          = useState(30);
  const [maxVolRatio,      setMaxVolRatio]       = useState(70);
  const [maxDays,          setMaxDays]           = useState(9999);
  const [minVol24k,        setMinVol24k]         = useState(100);
  const [minOiK,           setMinOiK]            = useState(50);
  const [filterSettledOnly, setFilterSettledOnly] = useState(false);
  const [filterFsRatio5x,   setFilterFsRatio5x]   = useState(false);

  // Sort & view
  const [sortBy, setSortBy] = useState<SortKey>("displayScore");
  const [viewMode, setViewMode] = useState<"table" | "heat">("table");
  const [summaryFilter, setSummaryFilter] = useState<"strong"|"long"|"pattern"|"allTf"|"spike"|null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 15;

  // Auto-refresh interval (施策5)
  const [autoIntervalMin, setAutoIntervalMin] = useState<0|5|10|30|60>(() => {
    if (typeof window === "undefined") return 0;
    return (Number(localStorage.getItem("shortScanInterval") ?? "0") as 0|5|10|30|60);
  });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showAutoMenu, setShowAutoMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  // Watchlist state (reactive)
  const [watchlistSet, setWatchlistSet] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return new Set(JSON.parse(localStorage.getItem("watchlist") ?? "[]") as string[]);
  });
  function toggleWatchlist(sym: string) {
    if (watchlistSet.has(sym)) {
      removeFromWatchlist(sym);
    } else {
      addToWatchlist(sym);
    }
    setWatchlistSet(new Set(JSON.parse(localStorage.getItem("watchlist") ?? "[]") as string[]));
  }
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keyboard shortcuts (施策3)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const filterInputRef   = useRef<HTMLInputElement | null>(null);
  const tableScrollRef   = useRef<HTMLDivElement | null>(null);
  const topScrollRef     = useRef<HTMLDivElement | null>(null);
  const topScrollInnerRef = useRef<HTMLDivElement | null>(null);

  // Filter presets (施策6)
  const [customPresets, setCustomPresets] = useState<FilterPreset[]>(() => typeof window !== "undefined" ? loadCustomPresets() : []);
  function applyPreset(p: FilterPreset) {
    setMinDrop(p.minDrop);
    setMaxVolRatio(p.maxVolRatio);
    setMinVol24k(p.minVol24k);
    setMaxDays(p.maxDays);
    setMinOiK(p.minOiK);
    setFilterSettledOnly(p.filterSettledOnly ?? false);
    setFilterFsRatio5x(p.filterFsRatio5x ?? false);
    if (p.sortBy) setSortBy(p.sortBy);
    if (p.summaryFilter !== undefined) setSummaryFilter(p.summaryFilter);
  }
  function applyPresetAndScan(p: FilterPreset) {
    applyPreset(p);
    if (!loading) scan(undefined, { minDrop: p.minDrop, maxVolRatio: p.maxVolRatio, minVol24k: p.minVol24k, maxDays: p.maxDays, minOiK: p.minOiK });
  }
  function saveCurrentPreset() {
    const name = window.prompt(t.presetNamePrompt);
    if (!name?.trim()) return;
    const p: FilterPreset = { name: name.trim(), icon: "⭐", minDrop, maxVolRatio, minVol24k, maxDays, minOiK, filterSettledOnly, filterFsRatio5x, sortBy, summaryFilter };
    const next = [...customPresets, p].slice(0, 5);
    setCustomPresets(next);
    saveCustomPresets(next);
  }
  function deleteCustomPreset(idx: number) {
    if (!window.confirm(t.presetDelConfirm)) return;
    const next = customPresets.filter((_, i) => i !== idx);
    setCustomPresets(next);
    saveCustomPresets(next);
  }

  // CoinGecko (施策7)
  const [cgMap,      setCgMap]      = useState<Map<string, CgMarketData>>(new Map());
  const [cgLoading,  setCgLoading]  = useState(false);
  const [cgProgress, setCgProgress] = useState(0);

  // Backtest
  const [btRecords, setBtRecords] = useState<BacktestRecord[]>([]);
  const btStats = useMemo(() => calculateStats(btRecords), [btRecords]);

  // Market context for DangerZone + Phase3 Regime
  const [marketBtcChange, setMarketBtcChange] = useState<number>(0);
  const [marketFearGreed, setMarketFearGreed] = useState<number | null>(null);
  const [regimeFilterOn,  setRegimeFilterOn]  = useState(false);

  // Toast (施策10)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((message: string, type: Toast["type"] = "info", duration = 3000) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 280);
    }, duration);
  }, []);

  useEffect(() => { setSnapshots(getSnapshots()); }, []);
  useEffect(() => { setBtRecords(getRecords()); }, []);

  useEffect(() => {
    fetch("/api/market-env")
      .then(r => r.json())
      .then((d: { btcChange24h?: number; fng?: { value: number } | null }) => {
        if (d?.btcChange24h != null) setMarketBtcChange(d.btcChange24h);
        if (d?.fng?.value != null)   setMarketFearGreed(d.fng.value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")
      .then(r => r.json()).then((d: { symbols?: Array<{ baseAsset: string }> }) => {
        setBinanceSyms(new Set((d.symbols ?? []).map(s => s.baseAsset.toUpperCase())));
      }).catch(() => {});
    fetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000")
      .then(r => r.json()).then((d: { result?: { list?: Array<{ baseCoin: string }> } }) => {
        setBybitSyms(new Set((d.result?.list ?? []).map(s => s.baseCoin.toUpperCase())));
      }).catch(() => {});
  }, []);

  const scan = useCallback(async (mode?: "new30", filterOverrides?: { minDrop: number; maxVolRatio: number; minVol24k: number; maxDays: number; minOiK: number }) => {
    setLoading(true);
    setError("");
    setExpandedRows(new Set());
    const start = Date.now();
    setLoadStart(start);
    setElapsed(0);

    // Loading elapsed timer (F)
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    elapsedRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    try {
      // new30: server uses passesFilterNew30 (fixed thresholds); sliders not changed to avoid contamination
      // normal: pass current slider values as filter params to server
      let url: string;
      if (mode === "new30") {
        url = "/api/short-scan?mode=new30";
      } else {
        const params = new URLSearchParams({
          minDrop: String(filterOverrides?.minDrop ?? minDrop),
          maxVolRatio: String(filterOverrides?.maxVolRatio ?? maxVolRatio),
          minVol24k: String(filterOverrides?.minVol24k ?? minVol24k),
          maxDays: String(filterOverrides?.maxDays ?? maxDays),
          minOiK: String(filterOverrides?.minOiK ?? minOiK),
        });
        url = `/api/short-scan?${params}`;
      }
      const res = await fetch(url);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error || `HTTP ${res.status}`); }
      const json: ScanResponse = await res.json();
      if (!json.success) throw new Error(json.error || "スキャン失敗");
      setData(json);
      setCurrentPage(1);

      // Snapshot (施策3)
      const snap: ScanSnapshot = {
        timestamp: Date.now(),
        data: Object.fromEntries(json.candidates.map(c => [c.symbol, { score: c.shortScore, athDrop: c.athDropPct, volRatio: c.volumeChangeRatio, fr: c.fundingRate, oi: c.openInterest, price: c.currentPrice }])),
      };
      saveSnapshot(snap);
      setSnapshots(getSnapshots());

      // Backtest: check先 → record後 (順序重要)
      try {
        checkAndUpdateRecords(json.candidates);
        const beforeCount = getRecords().length;
        recordNewCandidates(json.candidates);
        const newRecords = getRecords();
        const recorded = newRecords.length - beforeCount;
        setBtRecords(newRecords);
        if (recorded > 0) addToast(`📊 ${recorded}${t.toastBtRecord}`, "info");
      } catch (e) {
        console.error("[backtest]", e);
      }

      // Toast: scan complete (施策10)
      addToast(`✅ スキャン完了 ${json.candidates.length}${t.toastScanDone}`, "success");

      // Sound: scan complete + high score (施策2 - via ref)
      playSoundRef.current?.("complete");
      const highScore = json.candidates.filter(c => c.shortScore >= 10);
      if (highScore.length > 0) {
        playSoundRef.current?.("alert");
        sendNotif(`🎯 ショート候補 ${highScore.length}件`, `${highScore[0].symbol.replace("_USDT","")} スコア${highScore[0].shortScore}/${DISPLAY_MAX}`);
      }

      // CoinGecko (施策7)
      if (HAS_CG && json.candidates.length > 0) {
        const top20 = json.candidates.slice(0, 20).map(c => c.symbol);
        setCgLoading(true); setCgProgress(0);
        fetchCoinGeckoData(top20, CG_API_KEY, (done, total) => setCgProgress(Math.round(done / total * 100)))
          .then(map => setCgMap(map)).catch(() => {}).finally(() => setCgLoading(false));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addToast(`❌ ${t.toastScanError}`, "error");
    } finally {
      setLoading(false);
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifState]);

  function handleAutoRefresh() {
    if (autoRefresh) { if (autoTimerRef.current) clearInterval(autoTimerRef.current); autoTimerRef.current = null; setAutoRefresh(false); }
    else { setAutoRefresh(true); autoTimerRef.current = setInterval(() => scan(), 5 * 60 * 1000); }
  }
  useEffect(() => () => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    if (elapsedRef.current)   clearInterval(elapsedRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  // Auto-interval logic (施策5)
  useEffect(() => {
    if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(null);
    setAutoRefresh(autoIntervalMin > 0);
    if (autoIntervalMin > 0) {
      const ms = autoIntervalMin * 60 * 1000;
      let remaining = ms / 1000;
      setCountdown(remaining);
      countdownRef.current = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          remaining = ms / 1000;
          setCountdown(remaining);
          scan();
        }
      }, 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoIntervalMin]);

  function setAutoInterval(min: 0|5|10|30|60) {
    localStorage.setItem("shortScanInterval", String(min));
    setAutoIntervalMin(min);
    setShowAutoMenu(false);
  }


  // Phase3 Task1: 市場レジーム (既存の market-env データから導出)
  const marketRegime = useMemo(() => {
    if (marketBtcChange === 0 && marketFearGreed === null) return null;
    let regime: "RISK_ON" | "NEUTRAL" | "RISK_OFF" = "NEUTRAL";
    let scoreAdjust = 0;
    if (marketFearGreed !== null && marketFearGreed >= 65 && marketBtcChange >= 2) {
      regime = "RISK_ON"; scoreAdjust = 2;
    } else if ((marketFearGreed !== null && marketFearGreed <= 35) || marketBtcChange <= -3) {
      regime = "RISK_OFF"; scoreAdjust = -2;
    }
    return { fng: marketFearGreed, btcChange24h: marketBtcChange, regime, scoreAdjust };
  }, [marketBtcChange, marketFearGreed]);

  const strongThreshold = regimeFilterOn && marketRegime ? 10 + marketRegime.scoreAdjust : 10;

  // Extended candidates — server already applied filter params; no client-side re-filter
  const extended = useMemo((): ExtendedCandidate[] => {
    if (!data?.candidates) return [];
    const mapped: ExtendedCandidate[] = data.candidates.map(c => {
      const base = c.symbol.replace(/_USDT$/, "");
      const listedOnBinance  = binanceSyms.has(base);
      const listedOnBybit    = bybitSyms.has(base);
      const exclusivityScore = calcExclusivityScore(listedOnBinance, listedOnBybit);
      const consecutivePositive = getConsecutivePositiveFR(c.symbol, snapshots);
      const frBonus = (c.fundingRate !== null && c.fundingRate > 0 && consecutivePositive >= 3) ? 1 : 0;
      const cgData = cgMap.get(c.symbol) ?? null;
      const futuresHeatScore = cgData ? calcFuturesHeatScore(c.volume24h, cgData.spotVolume) : 0;
      const snsHeatScore = cgData ? calcSnsHeatScore(cgData.twitterFollowers, cgData.telegramMembers, c.priceChange7d) : 0;
      const mcFdvScore = cgData ? calcMcFdvScore(cgData.mcFdvRatio) : 0;
      // Phase2 Task1: OI変化率をスナップショットから計算
      let oiChangePct: number | null = null;
      for (let i = snapshots.length - 1; i >= 0; i--) {
        const entry = snapshots[i].data[c.symbol];
        if (entry && entry.oi > 0 && c.openInterest !== entry.oi) {
          oiChangePct = ((c.openInterest - entry.oi) / entry.oi) * 100;
          break;
        }
      }
      const oiChangeScore = calcOIChangeScore(oiChangePct);
      const displayScore = c.shortScore + exclusivityScore + frBonus + futuresHeatScore + snsHeatScore + mcFdvScore + oiChangeScore;
      const phase = detectPhase(c.fundingRate, null, null, c.priceChange24h);
      return {
        ...c,
        scoreBreakdown: { ...c.scoreBreakdown, oiChangeScore },
        listedOnBinance, listedOnBybit, exclusivityScore, frBonus, cgData, futuresHeatScore, snsHeatScore, mcFdvScore,
        oiChangePct, oiChangeScore,
        displayScore, phase,
      };
    });
    const sorted = mapped.sort((a, b) => {
      switch (sortBy) {
        case "athDropPct":     return a.athDropPct - b.athDropPct;
        case "priceChange24h": return b.priceChange24h - a.priceChange24h;
        case "priceChange7d":  return b.priceChange7d - a.priceChange7d;
        case "openInterest":   return b.openInterest - a.openInterest;
        case "phase":          return (PHASE_ORDER[a.phase.phase] ?? 5) - (PHASE_ORDER[b.phase.phase] ?? 5);
        default:               return b.displayScore - a.displayScore;
      }
    });

    let result = sorted;
    if (summaryFilter) {
      switch (summaryFilter) {
        case "strong":  result = sorted.filter(c => c.displayScore >= strongThreshold); break;
        case "long":    result = sorted.filter(c => isLongBias(c)); break;
        case "pattern": result = sorted.filter(c => !!c.chartPattern); break;
        case "allTf":   result = sorted.filter(c => c.trendMultiTF?.alignment === 3); break;
        case "spike":   result = sorted.filter(c => c.volumeSpike && c.volumeSpike.direction !== "neutral"); break;
      }
    }
    if (filterSettledOnly) result = result.filter(c => c.phase.phase === "SETTLED");
    if (filterFsRatio5x) {
      result = result.filter(c => {
        const sp = c.cgData?.spotVolume;
        return sp && sp >= 1000 && c.volume24h / sp >= 5;
      });
    }
    return result;
  }, [data, binanceSyms, bybitSyms, snapshots, sortBy, cgMap, summaryFilter, filterSettledOnly, filterFsRatio5x, strongThreshold]);

  const totalPages = Math.ceil(extended.length / ITEMS_PER_PAGE);
  const paginatedItems = extended.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const alerts = useMemo(() => detectAlerts(data?.candidates ?? [], snapshots), [data, snapshots]);

  // バックテスト: シンボルごとの最新レコード (badge表示用)
  const btRecordMap = useMemo(() => {
    const m = new Map<string, BacktestRecord["status"]>();
    for (const r of btRecords) {
      const prev = m.get(r.symbol);
      // active > tp/sl > expired の優先順位
      if (!prev || r.status === "active" || prev === "expired") m.set(r.symbol, r.status);
    }
    return m;
  }, [btRecords]);

  // v6: 戦略マッチングマップ
  const strategyMatches = useMemo(() => {
    const m = new Map<string, { tag: StrategyTag; confidence: number; reasons: string[]; warnings: string[] }>();
    for (const c of extended) {
      const best = findBestStrategy({
        athDropPct:        c.athDropPct,
        volumeChangeRatio: c.volumeChangeRatio,
        fundingRate:       c.fundingRate,
        oiRatio:           c.oiRatio,
        listedDaysAgo:     c.listedDaysAgo,
        priceChange7d:     c.priceChange7d,
        priceChange24h:    c.priceChange24h,
        btcCorrelation:    c.btcCorrelation,
        displayScore:      c.displayScore,
        shortScore:        c.shortScore,
        chartPattern:      c.chartPattern,
        trendMultiTF:      c.trendMultiTF,
        exclusivityScore:  c.exclusivityScore,
        frBonus:           c.frBonus,
        volumeSpike:       c.volumeSpike,
      });
      if (best) m.set(c.symbol, best);
    }
    return m;
  }, [extended]);

  // v6: DangerZone判定
  const dangerZone = useMemo((): DangerZoneResult => {
    const longCount      = extended.filter(c => isLongBias(c)).length;
    const longBiasRatio  = extended.length > 0 ? longCount / extended.length : 0;
    const frs            = extended.map(c => c.fundingRate).filter((fr): fr is number => fr !== null);
    const avgFundingRate = frs.length > 0 ? frs.reduce((a, b) => a + b, 0) / frs.length : null;
    return evaluateDangerZone({
      btcChange24h:   marketBtcChange,
      fearGreed:      marketFearGreed,
      longBiasRatio,
      avgFundingRate,
      candidateCount: extended.length,
    });
  }, [extended, marketBtcChange, marketFearGreed]);


  // v6: 新規recordにstrategyタグを後付けパッチ
  useEffect(() => {
    if (!extended.length || !strategyMatches.size) return;
    const patched = recordNewCandidatesWithStrategy(
      extended as unknown as ExtendedCandidateLike[],
      dangerZone,
      { btcChange24h: marketBtcChange, fearGreed: marketFearGreed, avgFundingRate: dangerZone.inputs.avgFundingRate },
    );
    if (patched.length > 0) setBtRecords(getRecords());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extended, strategyMatches, dangerZone]);

  useEffect(() => { setCurrentPage(1); }, [sortBy, minDrop, maxVolRatio, minVol24k, maxDays, minOiK]);

  function toggleRow(sym: string) {
    setExpandedRows(prev => { const n = new Set(prev); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  }

  // Keyboard shortcuts (施策3) — declared after extended so it can reference it
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key.toLowerCase()) {
        case "s": e.preventDefault(); if (!loading) scan(); break;
        case "n": e.preventDefault(); if (!loading) scan("new30"); break;
        case "h": e.preventDefault(); setViewMode(v => v === "table" ? "heat" : "table"); break;
        case "f": e.preventDefault(); filterInputRef.current?.focus(); break;
        case "arrowdown":
          e.preventDefault();
          setSelectedIdx(i => {
            const next = Math.min(i + 1, paginatedItems.length - 1);
            if (paginatedItems[next]) setTimeout(() => document.getElementById(`row-${paginatedItems[next].symbol}`)?.scrollIntoView({ block: "nearest" }), 0);
            return next;
          });
          break;
        case "arrowup":
          e.preventDefault();
          setSelectedIdx(i => {
            const next = Math.max(i - 1, 0);
            if (paginatedItems[next]) setTimeout(() => document.getElementById(`row-${paginatedItems[next].symbol}`)?.scrollIntoView({ block: "nearest" }), 0);
            return next;
          });
          break;
        case "enter":
          e.preventDefault();
          if (selectedIdx >= 0 && paginatedItems[selectedIdx]) toggleRow(paginatedItems[selectedIdx].symbol);
          break;
        case "escape":
          e.preventDefault();
          setExpandedRows(new Set());
          setShowShortcutHelp(false);
          break;
        case "?":
          e.preventDefault();
          setShowShortcutHelp(v => !v);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, extended, selectedIdx, currentPage]);

  // Share results (E)
  function shareResults() {
    if (!extended.length) return;
    const top3 = extended.slice(0, 3).map(c => `${c.symbol.replace("_USDT","")} ${c.displayScore}pt`).join(" / ");
    const text = `🎯 MEXC Short Scanner スキャン結果\nTOP3: ${top3}\n#MEXC #CryptoShort #暗号通貨\nhttps://bell-sig.vercel.app/short-scan`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  // URL share (施策4)
  function shareFilterURL() {
    const params = new URLSearchParams();
    if (minDrop !== 30)     params.set("min_drop",    String(minDrop));
    if (maxVolRatio !== 70) params.set("max_vol",     String(maxVolRatio));
    if (minVol24k !== 100)  params.set("min_vol24h",  String(minVol24k));
    if (maxDays !== 9999)   params.set("max_days",    String(maxDays));
    if (minOiK !== 0)       params.set("min_oi",      String(minOiK));
    if (sortBy !== "displayScore") params.set("sort", sortBy);
    const qs = params.toString();
    const url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
    navigator.clipboard.writeText(url).then(() => addToast(t.urlCopied, "success")).catch(() => addToast(t.urlCopied, "success"));
  }

  // Restore filters from URL on mount (施策4)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("min_drop"))   setMinDrop(Number(p.get("min_drop")));
    if (p.has("max_vol"))    setMaxVolRatio(Number(p.get("max_vol")));
    if (p.has("min_vol24h")) setMinVol24k(Number(p.get("min_vol24h")));
    if (p.has("max_days"))   setMaxDays(Number(p.get("max_days")));
    if (p.has("min_oi"))     setMinOiK(Number(p.get("min_oi")));
    if (p.has("sort"))       setSortBy(p.get("sort") as SortKey);
    if (p.toString()) scan();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dual scrollbar sync: top mirror bar ↔ table container
  useEffect(() => {
    const tableEl = tableScrollRef.current;
    const innerEl = topScrollInnerRef.current;
    if (!tableEl || !innerEl) return;
    const update = () => { innerEl.style.width = tableEl.scrollWidth + "px"; };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(tableEl);
    return () => ro.disconnect();
  }, [viewMode, extended]);

  const onTableScroll = useCallback(() => {
    if (topScrollRef.current && tableScrollRef.current)
      topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
  }, []);

  const onTopScroll = useCallback(() => {
    if (tableScrollRef.current && topScrollRef.current)
      tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  }, []);

  function exportCSV() {
    if (!extended.length) return;
    const hdr = ["Symbol","DisplayScore","BaseScore","ATH Drop%","Vol Ratio","24h%","7d%","FR","Vol24h","Avg7d Vol","List Days","OI","OI/Vol","Exclusivity","FRBonus","OnBinance","OnBybit"].join(",");
    const rows = extended.map(c => [c.symbol, c.displayScore, c.shortScore, c.athDropPct.toFixed(2), c.volumeChangeRatio.toFixed(3), c.priceChange24h.toFixed(2), c.priceChange7d.toFixed(2), c.fundingRate != null ? (c.fundingRate*100).toFixed(4) : "", c.volume24h.toFixed(0), c.volumeAvg7d.toFixed(0), c.listedDaysAgo, c.openInterest.toFixed(0), c.oiRatio.toFixed(2), c.exclusivityScore, c.frBonus, c.listedOnBinance?"yes":"no", c.listedOnBybit?"yes":"no"].join(","));
    const blob = new Blob(["﻿"+ [hdr,...rows].join("\n")], { type:"text/csv;charset=utf-8;" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `mexc-short-scan-${new Date().toISOString().slice(0,10)}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    addToast(t.toastCsvDone, "success");
  }

  const totalScanned = data?.meta.totalTickerPairs ?? data?.meta.totalScanned ?? 0;

  return (
    <div className="space-y-3 md:space-y-4">

      {/* Market Panel (施策9) */}
      <MarketEnvironmentPanel cgApiKey={HAS_CG ? CG_API_KEY : undefined} />

      {/* v6 DangerZone banner */}
      <DangerBanner result={dangerZone} />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-base md:text-lg font-bold text-gray-800 dark:text-gray-100">{t.title}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{t.subtitle}</p>
        </div>
        {/* Language toggle (G) */}
        <button onClick={() => setLang(l => l === "ja" ? "en" : "ja")}
          className="px-2 py-1 text-xs border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors shrink-0">
          {lang === "ja" ? "🇺🇸 EN" : "🇯🇵 JA"}
        </button>
      </div>

      {/* Action buttons — Row 1 */}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => scan()} disabled={loading}
          className="px-4 py-1.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white rounded-lg transition-colors">
          {loading ? "⏳ ..." : t.scanBtn}
        </button>
        <button onClick={exportCSV} disabled={extended.length === 0}
          className="px-3 py-1.5 text-xs bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-300 rounded-lg text-gray-600 transition-colors">
          {t.csvBtn}
        </button>
        {/* Auto-refresh interval dropdown (施策5) */}
        <div className="relative">
          <button onClick={() => setShowAutoMenu(v => !v)}
            className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${autoIntervalMin > 0 ? "bg-indigo-50 text-indigo-700 border-indigo-300" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
            {t.autoRefresh} {autoIntervalMin > 0 ? `${autoIntervalMin}m` : t.autoOff} ▾
            {autoIntervalMin > 0 && countdown != null && (
              <span className="ml-1 text-indigo-400">{Math.floor(countdown / 60)}:{String(Math.floor(countdown % 60)).padStart(2,"0")}</span>
            )}
          </button>
          {showAutoMenu && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[120px]">
              {([0,5,10,30,60] as const).map(m => (
                <button key={m} onClick={() => setAutoInterval(m)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-colors ${autoIntervalMin === m ? "text-indigo-600 font-bold" : "text-gray-600 dark:text-gray-300"}`}>
                  {m === 0 ? t.autoOff : `${m}分ごと`}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Settings menu */}
        <div className="relative ml-auto">
          <button onClick={() => setShowSettingsMenu(v => !v)}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
            title="設定">
            ⚙️
          </button>
          {showSettingsMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[170px]">
              <button onClick={toggleSound}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300">
                {soundEnabled ? t.soundOn : t.soundOff}
              </button>
              {notifState !== "granted" ? (
                <button onClick={requestNotif}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-amber-700">
                  {t.notifEnable}
                </button>
              ) : (
                <div className="px-3 py-1.5 text-xs text-green-700">{t.notifOn}</div>
              )}
              <button onClick={shareResults} disabled={extended.length === 0}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors text-gray-600 dark:text-gray-300">
                {t.shareBtn}
              </button>
              <button onClick={shareFilterURL}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300">
                {t.shareUrl}
              </button>
              <a href={MEXC_REG_URL} target="_blank" rel="noopener noreferrer"
                className="block px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-orange-700">
                {t.mexcReg}
              </a>
              <button onClick={() => { setShowShortcutHelp(true); setShowSettingsMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400">
                ⌨️ ショートカット
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter Presets (施策6) — Row 2 */}
      <FilterPresets t={t} lang={lang} customPresets={customPresets} onApply={applyPresetAndScan} onSaveCurrent={saveCurrentPreset} onDeleteCustom={deleteCustomPreset} />

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-4">
        {[
          { label: `${t.athDrop} ≥`, val: `${minDrop}%`, color: "text-red-600", accent: "accent-red-500", min:0, max:100, step:5, v:minDrop, set:setMinDrop },
          { label: `${t.volRatio} ≤`, val: (maxVolRatio/100).toFixed(1), color: "text-orange-600", accent: "accent-orange-500", min:10, max:1000, step:10, v:maxVolRatio, set:setMaxVolRatio },
          { label: `${t.listDays} ≤`, val: maxDays >= 9999 ? "∞" : `${maxDays}日`, color: "text-blue-600", accent: "accent-blue-500", min:30, max:9999, step:30, v:maxDays, set:setMaxDays },
          { label: `${t.minVol} ≥`, val: `$${minVol24k}K`, color: "text-green-600", accent: "accent-green-500", min:0, max:1000, step:1, v:minVol24k, set:setMinVol24k },
          { label: `${t.minOi} ≥`, val: `$${minOiK}K`, color: "text-cyan-600", accent: "accent-cyan-500", min:0, max:1000, step:10, v:minOiK, set:setMinOiK },
        ].map(({ label, val, color, accent, min, max, step, v, set }) => (
          <div key={label}>
            <label className="text-xs font-semibold text-gray-600 block mb-1">
              {label} <span className={color}>{val}</span>
            </label>
            <input type="range" min={min} max={max} step={step} value={v}
              onChange={e => set(+e.target.value)} className={`w-full ${accent}`} />
          </div>
        ))}
        {/* Phase / F/S フィルター */}
        <div className="col-span-2 md:col-span-5 flex flex-wrap items-center gap-4 pt-1 border-t border-gray-200">
          <label
            className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
            title="FRがほぼゼロの「安定期」銘柄のみ表示。ONにすると候補が大幅に減ります。OFF推奨。"
          >
            <input type="checkbox" checked={filterSettledOnly} onChange={e => setFilterSettledOnly(e.target.checked)} className="accent-green-500 w-3.5 h-3.5" />
            <span className="text-gray-700">{t.filterSettledOnly} <span className="text-green-600">✅</span></span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={filterFsRatio5x} onChange={e => setFilterFsRatio5x(e.target.checked)} className="accent-blue-500 w-3.5 h-3.5" />
            <span className="text-gray-700">{t.filterFsRatio5x}</span>
          </label>
          <button
            onClick={() => setSortBy(s => s === "phase" ? "displayScore" : "phase")}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${sortBy === "phase" ? "bg-green-100 text-green-700 border-green-300 font-bold" : "bg-gray-100 text-gray-600 border-gray-200 hover:border-green-300"}`}
          >
            {t.sortPhase}
          </button>
          {/* Phase3 Task1: 市場環境連動トグル */}
          {marketRegime && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setRegimeFilterOn(v => !v)}
                className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold transition-colors ${
                  regimeFilterOn
                    ? "bg-indigo-500 text-white border-indigo-500"
                    : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-indigo-50"
                }`}
              >
                🌡️ 環境連動 {regimeFilterOn ? "ON" : "OFF"}
              </button>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                marketRegime.regime === "RISK_ON"  ? "bg-green-100 text-green-700" :
                marketRegime.regime === "RISK_OFF" ? "bg-red-100 text-red-700"     :
                                                     "bg-gray-100 text-gray-600"
              }`}>
                {marketRegime.regime === "RISK_ON"  ? "🟢 Risk-On" :
                 marketRegime.regime === "RISK_OFF" ? "🔴 Risk-Off" : "🟡 Neutral"}
                {marketRegime.fng !== null && ` F&G:${marketRegime.fng}`}
                {` BTC:${marketRegime.btcChange24h >= 0 ? "+" : ""}${marketRegime.btcChange24h.toFixed(1)}%`}
              </span>
              {regimeFilterOn && marketRegime.scoreAdjust !== 0 && (
                <span className="text-[10px] text-gray-400">
                  閾値{marketRegime.scoreAdjust > 0 ? "+" : ""}{marketRegime.scoreAdjust}pt
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Alerts */}
      <AlertPanel alerts={alerts} />

      {/* Custom Alerts (施策6) */}
      <CustomAlertPanel t={t} candidates={extended} />

      {/* Long Bias Panel (修正3) */}
      <LongBiasPanel candidates={extended} t={t} />

      {/* Error */}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">❌ {error}</div>}

      {/* Scan stats + stale warning (修正7) */}
      {data && !loading && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span>{t.scanTarget}: <strong className="text-gray-700">{totalScanned}</strong></span>
          <span>{t.passed}: <strong className="text-indigo-600">{data.meta.filtered}</strong></span>
          <span title="安定期・summaryフィルターなどクライアント側絞り込み後の件数">最終候補: <strong className="text-purple-600">{extended.length}</strong>件</span>
          <span>{t.showing}: <strong className="text-gray-700">{paginatedItems.length}</strong>（全{extended.length}件中）</span>
          {data.mode === "new30" && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">{t.newMode}</span>}
          {snapshots.length > 0 && <span>{t.snapshots}: <strong className="text-teal-600">{snapshots.length}</strong></span>}
          {HAS_CG && cgLoading && <span className="text-violet-600">{t.cgFetching} {cgProgress}%</span>}
          <span className="ml-auto flex items-center gap-2">
            {(() => {
              const ageMin = Math.floor((Date.now() - new Date(data.scanTime).getTime()) / 60_000);
              return ageMin >= 5 ? (
                <span className="text-orange-600 font-semibold">{t.staleDataWarn} ({ageMin}分前)</span>
              ) : null;
            })()}
            <span>{t.lastUpdate}: {new Date(data.scanTime).toLocaleTimeString("ja-JP")}</span>
          </span>
        </div>
      )}

      {/* Summary bar (修正5) */}
      {data && !loading && extended.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <SummaryBar
            candidates={extended}
            t={t}
            isLongBias={isLongBias}
            onFilter={(key) => setSummaryFilter(f => f === key ? null : key)}
            summaryFilter={summaryFilter}
            strongThreshold={strongThreshold}
          />
          {summaryFilter && (
            <button onClick={() => setSummaryFilter(null)}
              className="ml-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-300 text-xs font-bold hover:bg-orange-200 transition-colors flex items-center gap-1">
              ✕ フィルター解除（{
                summaryFilter === "strong"  ? "ショート候補のみ" :
                summaryFilter === "long"    ? "ロング優位のみ" :
                summaryFilter === "pattern" ? "パターンのみ" :
                summaryFilter === "allTf"   ? "全TF↓のみ" : "スパイクのみ"
              }）
            </button>
          )}
        </div>
      )}

      {/* v6: 戦略マッチサマリー */}
      {data && !loading && strategyMatches.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs px-1">
          <span className="font-semibold text-gray-500">戦略マッチ:</span>
          {ALL_STRATEGIES.map(s => {
            const count = [...strategyMatches.values()].filter(m => m.tag === s.tag).length;
            if (!count) return null;
            return (
              <span key={s.tag} className="px-2 py-0.5 rounded-full border font-semibold bg-purple-50 text-purple-700 border-purple-200">
                {s.icon}{s.shortName} <span className="font-bold">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Loading (F) */}
      {!loading && !data && !error && (
        <div className="text-center py-12 px-4">
          <div className="text-5xl mb-4">🎯</div>
          <p className="text-sm font-semibold text-gray-600 mb-1">{t.emptyTitle}</p>
          <p className="text-xs text-gray-400">{t.emptyNote}。{t.scoreLabel}: {DISPLAY_MAX}点満点</p>
        </div>
      )}
      {loading && <LoadingProgress t={t} elapsed={elapsed} />}
      {!loading && data && extended.length === 0 && (
        <div className="text-center py-10">
          <div className="text-3xl mb-2 text-gray-300">🔍</div>
          <p className="text-sm text-gray-500">{t.noResult}</p>
          <p className="text-xs text-gray-400 mt-1">{t.noResultNote}</p>
          <button
            onClick={() => { setMinDrop(30); setMaxVolRatio(70); setMaxDays(9999); setMinVol24k(100); setMinOiK(0); setSummaryFilter(null); }}
            className="mt-3 px-4 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
            {t.filterReset}
          </button>
        </div>
      )}

      {/* Results table / heatmap */}
      {!loading && extended.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          {/* Legend + view toggle */}
          <div className="flex flex-wrap items-center gap-3 px-3 md:px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-600 dark:text-gray-300">{t.scoreLabel} (/{DISPLAY_MAX}):</span>
            <span style={{ color:"#b91c1c", fontWeight:700 }}>■ {t.scoreHigh}</span>
            <span style={{ color:"#c2410c", fontWeight:700 }} className="hidden sm:inline">■ {t.scoreMid}</span>
            <span style={{ color:"#6b7280" }} className="hidden sm:inline">■ {t.scoreLow}</span>
            <span className="ml-auto text-gray-400 sm:hidden">{t.scrollHint}</span>
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden ml-auto">
              <button onClick={() => setViewMode("table")}
                className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${viewMode==="table"?"bg-indigo-600 text-white":"bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                {t.viewTable}
              </button>
              <button onClick={() => setViewMode("heat")}
                className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${viewMode==="heat"?"bg-indigo-600 text-white":"bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"}`}>
                {t.viewHeat}
              </button>
            </div>
          </div>
          {!HAS_CG && (
            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 mx-3 mb-1">
              💎 <span className="font-semibold">PRO列</span>はCoinGecko APIキー設定で解放されます
            </div>
          )}

          {/* Heatmap view (施策7 改善) */}
          {viewMode === "heat" && (
            <div className="p-4">
              <HeatmapView
                candidates={extended}
                t={t}
                isLongBias={isLongBias}
                onClickSymbol={(sym) => {
                  setViewMode("table");
                  setExpandedRows(new Set([sym]));
                  setTimeout(() => {
                    const el = document.getElementById(`row-${sym}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 100);
                }}
              />
            </div>
          )}

          {/* Table view */}
          {viewMode === "table" && <div ref={topScrollRef} onScroll={onTopScroll} className="overflow-x-auto overflow-y-hidden border-b border-gray-100 short-scan-scrollbar" style={{height:16}}><div ref={topScrollInnerRef} style={{height:1}} /></div>}
          {viewMode === "table" && <div ref={tableScrollRef} onScroll={onTableScroll} className="overflow-x-auto short-scan-table short-scan-scrollbar" style={{ overflowX: "auto" }}><table className="table-auto text-xs" style={{ minWidth: "1100px", width: "100%" }}>
              <thead style={{ whiteSpace: "nowrap" }}>
                <tr className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <th className="px-1 py-1 text-left sticky left-0 bg-white dark:bg-gray-900 z-10 min-w-[80px]">{t.colSymbol}</th>
                  <SortTh label={t.colScore}  sortKey="displayScore"   current={sortBy} onSort={setSortBy} cls="text-center min-w-[55px]" />
                  <th className="px-1 py-1 text-right hidden md:table-cell min-w-[65px]">{t.colPrice}</th>
                  <SortTh label={t.colAth}    sortKey="athDropPct"     current={sortBy} onSort={setSortBy} cls="text-right min-w-[55px]" />
                  <th className="px-1 py-1 text-right hidden sm:table-cell min-w-[50px]">{t.colVolR}</th>
                  <SortTh label={t.col24h}    sortKey="priceChange24h" current={sortBy} onSort={setSortBy} cls="text-right min-w-[55px]" />
                  <SortTh label={t.col7d}     sortKey="priceChange7d"  current={sortBy} onSort={setSortBy} cls="text-right hidden sm:table-cell min-w-[55px]" />
                  <th className="px-1 py-1 text-right min-w-[60px]">{t.colFr}</th>
                  <SortTh label={t.colOi}     sortKey="openInterest"   current={sortBy} onSort={setSortBy} cls="text-right hidden md:table-cell min-w-[60px]" />
                  <th className="px-1 py-1 text-right hidden lg:table-cell min-w-[60px]">{t.colVol}</th>
                  <th className={`px-1 py-1 text-right hidden xl:table-cell min-w-[60px]${!HAS_CG ? " bg-gray-50 text-gray-400" : ""}`}>
                    {!HAS_CG && <span className="mr-0.5">🔒</span>}{t.colSpot}
                    <span className="ml-1 px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>
                  </th>
                  <th className={`px-1 py-1 text-right hidden xl:table-cell min-w-[55px]${!HAS_CG ? " bg-gray-50 text-gray-400" : ""}`}>
                    {!HAS_CG && <span className="mr-0.5">🔒</span>}{t.colFsRatio}
                    <span className="ml-1 px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-300 rounded">💎PRO</span>
                  </th>
                  <th className="px-1 py-1 text-right hidden md:table-cell min-w-[45px]">{t.colDays}</th>
                  <th className="px-1 py-1 text-right hidden md:table-cell min-w-[55px]" title="BTCとの価格連動度。低いほどショートに有利">{t.colBtcCorr}</th>
                  <th className="px-1 py-1 text-center hidden sm:table-cell min-w-[60px]">{t.colExch}</th>
                </tr>
              </thead>
              <tbody style={{ whiteSpace: "nowrap" }}>
                {paginatedItems.map((c, idx) => {
                  const isOpen   = expandedRows.has(c.symbol);
                  const base     = c.symbol.replace(/_USDT$/, "");
                  const frPct    = c.fundingRate != null ? c.fundingRate * 100 : null;
                  const hasAlert = alerts.some(a => a.symbol === c.symbol);
                  const p24 = c.priceChange24h, p7 = c.priceChange7d;
                  const isSelected = idx === selectedIdx;
                  return (
                    <React.Fragment key={c.symbol}>
                      <tr id={`row-${c.symbol}`}
                        onClick={() => { setSelectedIdx(idx); toggleRow(c.symbol); }}
                        className={`border-b border-gray-100 cursor-pointer transition-colors ${isSelected ? "bg-blue-50 hover:bg-blue-50" : "hover:bg-gray-50"}`}>

                        {/* 銘柄 — sticky on mobile */}
                        <td className="px-1 py-1 sticky left-0 bg-white hover:bg-gray-50">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-mono font-bold text-gray-800 text-xs md:text-sm">{base}</span>
                              <span className="text-gray-400 text-[10px]">/USDT</span>
                              <button
                                onClick={e => { e.stopPropagation(); toggleWatchlist(base); }}
                                className="text-[13px] leading-none hover:scale-110 transition-transform"
                                title={watchlistSet.has(base) ? "ウォッチリストから削除" : "ウォッチリストに追加"}
                              >
                                {watchlistSet.has(base) ? "⭐" : "☆"}
                              </button>
                              {hasAlert && <span className="text-xs">🔔</span>}
                              {c.trendMultiTF ? (
                                <span className="flex items-center gap-0.5 text-[9px] font-bold">
                                  {(["h1","h4","d1"] as const).map(tf => {
                                    const d = c.trendMultiTF![tf];
                                    return <span key={tf} className={d==="DOWN"?"text-red-500":d==="UP"?"text-green-600":"text-gray-400"}>{tf.toUpperCase()}{d==="DOWN"?"↓":d==="UP"?"↑":"→"}</span>;
                                  })}
                                  {c.trendMultiTF.alignment === 3 && <span className="text-green-600 font-black">🎯</span>}
                                </span>
                              ) : (
                                <span className={`text-[10px] font-bold ${c.trendDirection==="DOWN"?"text-red-500":c.trendDirection==="UP"?"text-green-600":"text-gray-400"}`}>
                                  {c.trendDirection==="DOWN"?"▼":c.trendDirection==="UP"?"▲":"→"}
                                </span>
                              )}
                              <span className="text-gray-400 text-[10px]">{isOpen?"▲":"▼"}</span>
                            </div>
                            <LiquidityBadge oi={c.openInterest} />
                            {(() => {
                              const bts = btRecordMap.get(c.symbol);
                              if (!bts) return null;
                              const { label, cls } = btStatusLabel(bts, t);
                              return <span className={`text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap ${cls}`}>{label}</span>;
                            })()}
                            {c.allPatterns && c.allPatterns.length > 0 && (
                              <span className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-sky-50 text-sky-700 border-sky-300">
                                📐 {c.allPatterns.length}パターン
                              </span>
                            )}
                            {isLongBias(c) && (
                              <span title={t.longBiasNote}
                                className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-green-50 text-green-700 border-green-300 cursor-help">
                                {t.longBiasBadge}
                              </span>
                            )}
                            <FRWatchToggle symbol={base} />
                            {/* Phase badge */}
                            <span className={`text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap ${phaseBadgeCls(c.phase.phase)}`}>
                              {c.phase.emoji}{c.phase.label}
                            </span>
                            {/* v6: strategy badge */}
                            {(() => {
                              const m = strategyMatches.get(c.symbol);
                              if (!m) return null;
                              const strategy = ALL_STRATEGIES.find(s => s.tag === m.tag);
                              if (!strategy) return null;
                              return (
                                <span title={m.reasons.join("\n")}
                                  className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-purple-50 text-purple-700 border-purple-300 cursor-help">
                                  {strategy.icon}{strategy.shortName} {m.confidence}%
                                </span>
                              );
                            })()}
                            {(() => {
                              const fr = c.fundingRate;
                              const squeezeCount = [
                                fr !== null && fr < 0,
                                c.oiRatio > 3.0,
                                c.trendDirection === "UP" || (c.trendMultiTF && c.trendMultiTF.alignment === 0),
                                c.btcCorrelation > 0.7,
                              ].filter(Boolean).length;
                              if (squeezeCount >= 2) return (
                                <span title="FRマイナス×高OI×上昇トレンドなどが重なっています"
                                  className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-yellow-50 text-yellow-700 border-yellow-300 cursor-help">
                                  {t.squeezeWarn}
                                </span>
                              );
                              return null;
                            })()}
                            {data?.mode === "new30" && c.listedDaysAgo <= 3 && (
                              <span title={t.earlyListingNote}
                                className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-orange-50 text-orange-700 border-orange-300 cursor-help">
                                {t.earlyListingWarn}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* スコア */}
                        <td className="px-1 py-1 text-center">
                          <span style={scoreBadgeStyle(c.displayScore)}>{c.displayScore}/{DISPLAY_MAX}</span>
                        </td>

                        {/* 価格 */}
                        <td className="px-1 py-1 text-right font-mono text-gray-700 text-xs hidden md:table-cell">
                          {fmtPrice(c.currentPrice)}
                        </td>

                        {/* ATH比 */}
                        <td className="px-1 py-1 text-right font-bold text-red-600 text-xs">
                          {c.athDropPct.toFixed(1)}%
                        </td>

                        {/* 出来高比 + 施策3スパイクバッジ */}
                        <td className="px-1 py-1 text-right text-orange-600 text-xs hidden sm:table-cell">
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{c.volumeChangeRatio.toFixed(2)}×</span>
                            {c.volumeSpike && c.volumeSpike.direction === "pump" && (
                              <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1 rounded whitespace-nowrap">
                                {t.volSpikePump} {c.volumeSpike.ratio.toFixed(1)}x
                              </span>
                            )}
                            {c.volumeSpike && c.volumeSpike.direction === "dump" && (
                              <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1 rounded whitespace-nowrap">
                                {t.volSpikeDump} {c.volumeSpike.ratio.toFixed(1)}x
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 24h */}
                        <td className={`px-1 py-1 text-right text-xs font-mono font-bold ${p24>=50?"text-red-600":p24>=20?"text-orange-500":p24<=-30?"text-green-600":"text-gray-500"}`}>
                          {fmtPct(p24)}
                        </td>

                        {/* 7d */}
                        <td className={`px-1 py-1 text-right text-xs font-mono font-bold hidden sm:table-cell ${p7>=100?"text-red-700":p7>=50?"text-red-500":p7<=-30?"text-green-600":"text-gray-500"}`}>
                          {fmtPct(p7)}{p7>=100&&<span className="ml-0.5">🚀</span>}
                        </td>

                        {/* FR — 負値強調 + ShortSignalBadge */}
                        <td className={`px-1 py-1 text-right text-xs font-mono ${frPct==null?"text-gray-400":frPct<0?"bg-red-50 text-red-600 font-bold":frPct>0.01?"text-purple-600 font-bold":frPct>0?"text-purple-500":"text-gray-400"}`}
                          title={frPct != null && frPct < 0 ? t.frNegativeWarn : undefined}>
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <span>
                              {frPct!=null?`${frPct>=0?"+":""}${frPct.toFixed(4)}%`:"—"}
                              {c.frBonus>0&&<span className="ml-0.5 text-violet-500">★</span>}
                              {frPct!=null&&frPct<0&&<span className="ml-0.5">⚡</span>}
                            </span>
                            <span className="hidden sm:inline"><ShortSignalBadge fr={c.fundingRate} /></span>
                          </div>
                        </td>

                        {/* OI */}
                        <td className={`px-1 py-1 text-right text-xs font-mono hidden md:table-cell ${c.openInterest<10_000?"text-red-600 font-bold":c.openInterest<50_000?"text-yellow-600":c.oiRatio>3?"text-red-600 font-bold":c.oiRatio>1.5?"text-orange-500":"text-gray-600"}`}>
                          {fmtVol(c.openInterest)}<span className="text-gray-400 ml-0.5">{c.oiRatio.toFixed(1)}×</span>
                        </td>

                        {/* 出来高 */}
                        <td className="px-1 py-1 text-right text-gray-600 text-xs hidden lg:table-cell">
                          {fmtVol(c.volume24h)}
                        </td>

                        {/* CG spot vol */}
                        <td className={`px-1 py-1 text-right text-xs hidden xl:table-cell${!HAS_CG ? " bg-gray-50 text-gray-300" : " text-gray-600"}`}>
                          {HAS_CG
                            ? (c.cgData?.spotVolume ? fmtVol(c.cgData.spotVolume) : <span className="text-gray-300">—</span>)
                            : <span className="text-gray-300">🔒</span>}
                        </td>

                        {/* CG F/S ratio */}
                        {(() => {
                          if (!HAS_CG) return (
                            <td className="px-1 py-1 text-right text-xs font-mono hidden xl:table-cell bg-gray-50 text-gray-300"><span className="text-gray-300">🔒</span></td>
                          );
                          const sp = c.cgData?.spotVolume;
                          const ratio = (sp && sp >= 1000) ? (c.volume24h / sp) * 100 : null;
                          return <td className={`px-1 py-1 text-right text-xs font-mono hidden xl:table-cell ${ratio && ratio>500?"text-red-600 font-bold":ratio && ratio>200?"text-orange-500":"text-gray-500"}`}>
                            {ratio == null
                              ? <span className="text-gray-300">—</span>
                              : ratio > 9999
                                ? <span className="text-red-600 font-bold">&gt;9999%</span>
                                : `${ratio.toFixed(0)}%`}
                          </td>;
                        })()}

                        {/* 上場 */}
                        <td className="px-1 py-1 text-right text-gray-500 text-xs hidden md:table-cell">
                          {c.listedDaysAgo}d
                        </td>

                        {/* BTC相関 */}
                        <td className="px-1 py-1 text-right text-xs font-mono hidden md:table-cell"
                          title="BTCとの価格連動度。低いほどショートに有利">
                          {(() => {
                            const corr = c.btcCorrelation;
                            const cls = corr >= 0.7 ? "text-red-600 font-bold" : corr >= 0.3 ? "text-orange-500" : "text-green-600 font-bold";
                            const icon = corr >= 0.7 ? "⚠️" : corr < 0.3 ? "✅" : "";
                            return <span className={cls}>{icon}{corr.toFixed(2)}</span>;
                          })()}
                        </td>

                        {/* 取引所 */}
                        <td className="px-1 py-1 text-center hidden sm:table-cell">
                          <div className="flex flex-col items-center gap-0.5">
                            <ExchangeBadges c={c} t={t} />
                            <a href={mexcUrl(base)} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-xs text-blue-500 hover:text-blue-700 underline">
                              {t.openLink}
                            </a>
                            <a href={`https://www.coinglass.com/ja/currencies/${base}`} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] text-purple-500 hover:text-purple-700 underline">
                              📊CG
                            </a>
                          </div>
                        </td>
                      </tr>
                      {isOpen && <ScoreDetail c={c} snapshots={snapshots} alerts={alerts} t={t} watchlistSet={watchlistSet} onWatchlistToggle={toggleWatchlist} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table></div>}
          {viewMode === "table" && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-100">
              <button
                onClick={() => { setCurrentPage(1); }}
                disabled={currentPage === 1}
                className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50 transition-colors"
              >
                «
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50 transition-colors"
              >
                ← 前へ
              </button>
              <span className="text-sm text-gray-600 font-medium">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50 transition-colors"
              >
                次へ →
              </button>
              <button
                onClick={() => { setCurrentPage(totalPages); }}
                disabled={currentPage === totalPages}
                className="px-2 py-1 text-xs rounded border border-gray-300 disabled:opacity-30 hover:bg-gray-50 transition-colors"
              >
                »
              </button>
            </div>
          )}
          {viewMode === "table" && <div className="px-3 md:px-4 py-2 text-xs text-gray-400 bg-gray-50 border-t border-gray-100">
            {t.clickHint}
          </div>}
        </div>
      )}

      {/* Backtest Panel */}
      <BacktestPanel
        records={btRecords}
        stats={btStats}
        t={t}
        onReset={() => { clearRecords(); setBtRecords([]); }}
      />

      {/* Portfolio VaR — スナップショット5件以上 + アクティブ2銘柄以上で表示 */}
      {snapshots.length >= 5 && btRecords.filter(r => r.status === "active").length >= 2 && (() => {
        const activeSymbols = btRecords.filter(r => r.status === "active").map(r => r.symbol);
        const priceHistories = activeSymbols.map(sym => {
          const closes = snapshots
            .map(s => (s.data as Record<string, { price?: number }>)[sym]?.price ?? null)
            .filter((p): p is number => p !== null && p > 0);
          return { symbol: sym, closes };
        }).filter(h => h.closes.length >= 3);

        if (priceHistories.length < 2) return null;

        const varResult = calcPortfolioVaR(priceHistories);
        if (!varResult) return null;

        return (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">⚠️ ポートフォリオリスク ({priceHistories.length}銘柄)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div className="text-center">
                <div className={`font-bold text-sm ${varResult.var95 > 0.1 ? "text-red-600" : "text-amber-700"}`}>
                  {(varResult.var95 * 100).toFixed(1)}%
                </div>
                <div className="text-gray-500 dark:text-gray-400">VaR 95%</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-sm ${varResult.var99 > 0.15 ? "text-red-600" : "text-amber-700"}`}>
                  {(varResult.var99 * 100).toFixed(1)}%
                </div>
                <div className="text-gray-500 dark:text-gray-400">VaR 99%</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-sm ${varResult.maxCorrelation >= 0.7 ? "text-red-600" : "text-amber-700"}`}>
                  {varResult.maxCorrelation.toFixed(2)}
                </div>
                <div className="text-gray-500 dark:text-gray-400">最大相関</div>
              </div>
              <div className="text-center">
                <div className={`font-bold text-sm ${varResult.diversificationRatio > 0.8 ? "text-red-600" : "text-green-600"}`}>
                  {(varResult.diversificationRatio * 100).toFixed(0)}%
                </div>
                <div className="text-gray-500 dark:text-gray-400">相関集中度</div>
              </div>
            </div>
            {varResult.highCorrPairs.length > 0 && (
              <div className="mt-2 text-[10px] text-red-600 dark:text-red-400">
                ⚠️ 高相関ペア: {varResult.highCorrPairs.map(p =>
                  `${p.symbolA.replace("_USDT","")}×${p.symbolB.replace("_USDT","")}(${p.correlation.toFixed(2)})`
                ).join(", ")}
              </div>
            )}
          </div>
        );
      })()}

      {/* Toast (施策10) */}
      <ToastContainer toasts={toasts} />

      {/* Keyboard shortcut help (施策3) */}
      {showShortcutHelp && <ShortcutHelpModal t={t} onClose={() => setShowShortcutHelp(false)} />}
    </div>
  );
}
