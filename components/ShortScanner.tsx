"use client";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { ShortCandidate, ShortScoreBreakdown } from "@/app/lib/shortScorer";
import { calcExclusivityScore } from "@/app/lib/shortScorer";
import { saveSnapshot, getSnapshots, getConsecutivePositiveFR } from "@/app/lib/snapshotStorage";
import type { ScanSnapshot } from "@/app/lib/snapshotStorage";
import { detectAlerts, getDiffSummary } from "@/app/lib/snapshotDiff";
import type { DiffAlert } from "@/app/lib/snapshotDiff";
import { fetchCoinGeckoData, calcFuturesHeatScore, calcSnsHeatScore } from "@/app/lib/coinGeckoClient";
import type { CgMarketData } from "@/app/lib/coinGeckoClient";
import MarketEnvironmentPanel from "@/components/MarketEnvironmentPanel";
import { checkAndUpdateRecords, recordNewCandidates } from "@/app/lib/backtestChecker";
import { getRecords, clearRecords } from "@/app/lib/backtestStorage";
import type { BacktestRecord } from "@/app/lib/backtestStorage";
import { calculateStats } from "@/app/lib/backtestStats";
import type { BacktestStats } from "@/app/lib/backtestStats";

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
    presetSave: "+ 保存",
    presetNamePrompt: "プリセット名を入力",
    presetDelConfirm: "このプリセットを削除しますか？",
    // 施策10: トースト
    toastScanDone: "件検出",
    toastUrlCopy: "🔗 URLをコピーしました",
    toastCsvDone: "📄 CSVをダウンロードしました",
    toastBtRecord: "件の銘柄を自動記録しました",
    toastScanError: "スキャンに失敗しました",
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
    presetSave: "+ Save",
    presetNamePrompt: "Enter preset name",
    presetDelConfirm: "Delete this preset?",
    toastScanDone: "found",
    toastUrlCopy: "🔗 URL copied!",
    toastCsvDone: "📄 CSV downloaded",
    toastBtRecord: "symbols auto-recorded",
    toastScanError: "Scan failed",
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
  displayScore: number;
}

interface ScanResponse {
  success: boolean; scanTime: string; candidates: ShortCandidate[];
  meta: { totalTickerPairs?: number; totalScanned?: number; filtered: number; stage1Passed?: number; stage2Fetched?: number; stage2Failed?: number };
  error?: string; mode?: string;
}

const CG_API_KEY = process.env.NEXT_PUBLIC_COINGECKO_API_KEY ?? "";
const HAS_CG = CG_API_KEY.length > 0;
const DISPLAY_MAX = HAS_CG ? 25 : 22; // v5施策1+2+4: BTC非連動+1, MTF 2→3, パターン+1

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
function fmtPct(n: number): string { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }

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
  { key: "trendScore",     label: "TF一致度",   max: 3, color: "#10b981" },
  { key: "pumpScore",      label: "7d急騰",     max: 2, color: "#f43f5e" },
  { key: "btcCorrScore",   label: "BTC非連動",  max: 1, color: "#8b5cf6" },
  { key: "patternScore",   label: "パターン",   max: 1, color: "#0ea5e9" },
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
function ScoreDetail({ c, snapshots, alerts, t }: { c: ExtendedCandidate; snapshots: ScanSnapshot[]; alerts: DiffAlert[]; t: Translations }) {
  const diff = getDiffSummary(c.symbol, c, snapshots);
  const symAlerts = alerts.filter(a => a.symbol === c.symbol);
  const colSpan = HAS_CG ? 15 : 12;

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 md:px-4 py-3 bg-gray-50 border-b border-gray-100">
        {symAlerts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {symAlerts.map((a, i) => (
              <span key={i} className={`text-xs px-2 py-0.5 rounded border ${SEV_CLS[a.severity]}`}>
                🔔 {a.message}
              </span>
            ))}
          </div>
        )}

        {/* Score bars */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 mb-3">
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
        </div>

        {/* Client scores */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { label: "取引所独占度", val: c.exclusivityScore, max: 2, cls: "bg-green-500" },
            { label: "FR連続ボーナス", val: c.frBonus, max: 1, cls: "bg-violet-500" },
          ].map(({ label, val, max, cls }) => (
            <div key={label}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{label}</span><span className="font-bold">{val}/{max}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${cls}`} style={{ width: `${(val / max) * 100}%` }} />
              </div>
            </div>
          ))}
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

        {/* CoinGecko (施策7) */}
        {HAS_CG && c.cgData && (() => {
          const cg = c.cgData!;
          const snsTotal = (cg.twitterFollowers ?? 0) + (cg.telegramMembers ?? 0);
          const futuresRatio = cg.spotVolume ? (c.volume24h / cg.spotVolume) * 100 : null;
          return (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="text-xs font-semibold text-violet-700 mb-2">{t.cgSection}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                <div>MC: <span className="font-mono font-semibold text-gray-800">{cg.marketCap ? fmtVol(cg.marketCap) : "N/A"}</span></div>
                <div>現物Vol: <span className="font-mono font-semibold text-gray-800">{cg.spotVolume ? fmtVol(cg.spotVolume) : "N/A"}</span></div>
                <div>先物/現物: <span className={`font-mono font-semibold ${futuresRatio && futuresRatio > 500 ? "text-red-600" : futuresRatio && futuresRatio > 200 ? "text-orange-500" : "text-gray-800"}`}>{futuresRatio != null ? `${futuresRatio.toFixed(0)}%` : "N/A"}</span></div>
                {cg.mexcSharePct != null && <div>MEXC集中: <span className={`font-mono font-semibold ${cg.mexcSharePct >= 90 ? "text-red-600" : "text-gray-800"}`}>{cg.mexcSharePct.toFixed(1)}%</span></div>}
                <div>Twitter: <span className="font-mono text-gray-800">{cg.twitterFollowers != null ? cg.twitterFollowers.toLocaleString() : "N/A"}</span></div>
                <div>SNS合計: <span className="font-mono text-gray-800">{snsTotal > 0 ? snsTotal.toLocaleString() : "N/A"}</span></div>
              </div>
            </div>
          );
        })()}

        {/* 前回比 (施策3) */}
        {diff && (
          <div className="mt-2 pt-2 border-t border-gray-200 grid grid-cols-3 gap-2 text-xs text-gray-500">
            <div>{t.prevScore}: <span className={`font-semibold ${diff.scoreDiff > 0 ? "text-red-600" : diff.scoreDiff < 0 ? "text-green-600" : "text-gray-600"}`}>{diff.scoreDiff > 0 ? "+" : ""}{diff.scoreDiff}</span></div>
            {diff.oiDiff !== null && <div>{t.oiChange}: <span className={`font-semibold ${diff.oiDiff > 0 ? "text-orange-600" : "text-gray-600"}`}>{diff.oiDiff > 0 ? "+" : ""}{diff.oiDiff.toFixed(0)}%</span></div>}
            {diff.frDiff !== null && <div>{t.frChange}: <span className={`font-semibold ${diff.frDiff > 0 ? "text-purple-600" : "text-gray-600"}`}>{diff.frDiff > 0 ? "+" : ""}{diff.frDiff.toFixed(4)}%</span></div>}
          </div>
        )}

        {/* Share this candidate (E) */}
        <div className="mt-2 flex gap-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`🎯 ${c.symbol.replace("_USDT","")}/USDT ショートスコア ${c.displayScore}/${DISPLAY_MAX}点\nATH比 ${c.athDropPct.toFixed(1)}% | FR ${c.fundingRate != null ? (c.fundingRate*100).toFixed(4) : "—"}%\n#MEXC #CryptoShort #暗号通貨\nhttps://bell-crypto-terminal.vercel.app/short-scan`)}`}
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
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.color}
                fillOpacity={0.75}
                stroke={entry.hasPattern ? "#0ea5e9" : entry.allTfDown ? "#16a34a" : "transparent"}
                strokeWidth={entry.hasPattern || entry.allTfDown ? 2 : 0}
              />
            ))}
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
function SummaryBar({ candidates, t, onFilter, isLongBias }: {
  candidates: ExtendedCandidate[];
  t: Translations;
  onFilter: (key: "strong" | "long" | "pattern" | "allTf" | "spike") => void;
  isLongBias: (c: ExtendedCandidate) => boolean;
}) {
  const counts = useMemo(() => ({
    strong: candidates.filter(c => c.displayScore >= 10).length,
    long:   candidates.filter(c => isLongBias(c)).length,
    pattern: candidates.filter(c => !!c.chartPattern).length,
    allTf:  candidates.filter(c => c.trendMultiTF?.alignment === 3).length,
    spike:  candidates.filter(c => c.volumeSpike && c.volumeSpike.direction !== "neutral").length,
  }), [candidates, isLongBias]);

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
      {items.map(({ key, label, count, cls }) => (
        <button key={key} onClick={() => onFilter(key)}
          className={`px-2 py-0.5 rounded-full border font-semibold transition-colors hover:opacity-80 ${cls}`}>
          {label} <span className="font-bold">{count}</span>
        </button>
      ))}
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
    <th className={`px-2 md:px-3 py-2.5 ${cls} cursor-pointer select-none hover:text-indigo-600 transition-colors text-xs`}
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
    <div className="rounded-xl border border-indigo-200 bg-white overflow-hidden shadow-sm">
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
                  <div key={s.label} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
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
                  <div key={s.label} className="bg-gray-50 rounded-lg p-2 border border-gray-100 text-center">
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

              {/* Score range table */}
              {stats.resolved > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">{t.btByScore}</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
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
                  <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-semibold">
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
  name: string; icon: string;
  minDrop: number; maxVolRatio: number; minVol24k: number; maxDays: number; minOiK: number;
}
const DEFAULT_PRESETS: FilterPreset[] = [
  { name: "presetStandard",    icon: "📊", minDrop: 30,  maxVolRatio: 70,  minVol24k: 100, maxDays: 365, minOiK: 0  },
  { name: "presetStrict",      icon: "🎯", minDrop: 50,  maxVolRatio: 40,  minVol24k: 200, maxDays: 365, minOiK: 50 },
  { name: "presetNewListing",  icon: "🆕", minDrop: 10,  maxVolRatio: 150, minVol24k: 10,  maxDays: 30,  minOiK: 0  },
];
const CUSTOM_PRESETS_KEY = "shortScanPresets";
function loadCustomPresets(): FilterPreset[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) ?? "[]"); } catch { return []; }
}
function saveCustomPresets(presets: FilterPreset[]) {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets.slice(0, 5)));
}

function FilterPresets({ t, customPresets, onApply, onSaveCurrent, onDeleteCustom }: {
  t: Translations;
  customPresets: FilterPreset[];
  onApply: (p: FilterPreset) => void;
  onSaveCurrent: () => void;
  onDeleteCustom: (idx: number) => void;
}) {
  const presetName = (p: FilterPreset) => {
    if (p.name === "presetStandard")   return `${p.icon} ${t.presetStandard}`;
    if (p.name === "presetStrict")     return `${p.icon} ${t.presetStrict}`;
    if (p.name === "presetNewListing") return `${p.icon} ${t.presetNewListing}`;
    return `${p.icon} ${p.name}`;
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-gray-500 font-semibold shrink-0">{t.presetsLabel}:</span>
      {DEFAULT_PRESETS.map((p, i) => (
        <button key={i} onClick={() => onApply(p)}
          className="px-2.5 py-1 rounded-lg border border-gray-300 bg-white hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 transition-colors">
          {presetName(p)}
        </button>
      ))}
      {customPresets.map((p, i) => (
        <div key={`c${i}`} className="flex items-center">
          <button onClick={() => onApply(p)}
            className="px-2.5 py-1 rounded-l-lg border border-gray-300 bg-white hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-gray-600 transition-colors">
            {presetName(p)}
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
      <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-xs mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800 text-sm">{t.kbTitle}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          {rows.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="px-2 py-0.5 rounded bg-gray-100 border border-gray-300 text-xs font-mono font-bold text-gray-700 min-w-[40px] text-center">{key}</kbd>
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
  const [minDrop,     setMinDrop]     = useState(30);
  const [maxVolRatio, setMaxVolRatio] = useState(70);
  const [maxDays,     setMaxDays]     = useState(365);
  const [minVol24k,   setMinVol24k]   = useState(100);
  const [minOiK,      setMinOiK]      = useState(0);

  // Sort & view
  const [sortBy, setSortBy] = useState<SortKey>("displayScore");
  const [viewMode, setViewMode] = useState<"table" | "heat">("table");
  const [summaryFilter, setSummaryFilter] = useState<"strong"|"long"|"pattern"|"allTf"|"spike"|null>(null);

  // Keyboard shortcuts (施策3)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // Filter presets (施策6)
  const [customPresets, setCustomPresets] = useState<FilterPreset[]>(() => typeof window !== "undefined" ? loadCustomPresets() : []);
  function applyPreset(p: FilterPreset) {
    setMinDrop(p.minDrop); setMaxVolRatio(p.maxVolRatio); setMinVol24k(p.minVol24k); setMaxDays(p.maxDays); setMinOiK(p.minOiK);
  }
  function saveCurrentPreset() {
    const name = window.prompt(t.presetNamePrompt);
    if (!name?.trim()) return;
    const p: FilterPreset = { name: name.trim(), icon: "⭐", minDrop, maxVolRatio, minVol24k, maxDays, minOiK };
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
    fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")
      .then(r => r.json()).then((d: { symbols?: Array<{ baseAsset: string }> }) => {
        setBinanceSyms(new Set((d.symbols ?? []).map(s => s.baseAsset.toUpperCase())));
      }).catch(() => {});
    fetch("https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000")
      .then(r => r.json()).then((d: { result?: { list?: Array<{ baseCoin: string }> } }) => {
        setBybitSyms(new Set((d.result?.list ?? []).map(s => s.baseCoin.toUpperCase())));
      }).catch(() => {});
  }, []);

  const scan = useCallback(async (mode?: "new30") => {
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

    if (mode === "new30") { setMinDrop(10); setMaxVolRatio(150); setMinVol24k(10); setMaxDays(30); setMinOiK(0); }

    try {
      const url = mode === "new30" ? "/api/short-scan?mode=new30" : "/api/short-scan";
      const res = await fetch(url);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error || `HTTP ${res.status}`); }
      const json: ScanResponse = await res.json();
      if (!json.success) throw new Error(json.error || "スキャン失敗");
      setData(json);

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
  }, []);

  // Extended candidates
  const extended = useMemo((): ExtendedCandidate[] => {
    if (!data?.candidates) return [];
    const filtered = data.candidates.filter(c =>
      Math.abs(c.athDropPct) >= minDrop &&
      c.volumeChangeRatio * 100 <= maxVolRatio &&
      c.listedDaysAgo <= maxDays &&
      c.volume24h >= minVol24k * 1_000 &&
      c.openInterest >= minOiK * 1_000
    );
    const mapped: ExtendedCandidate[] = filtered.map(c => {
      const base = c.symbol.replace(/_USDT$/, "");
      const listedOnBinance  = binanceSyms.has(base);
      const listedOnBybit    = bybitSyms.has(base);
      const exclusivityScore = calcExclusivityScore(listedOnBinance, listedOnBybit);
      const consecutivePositive = getConsecutivePositiveFR(c.symbol, snapshots);
      const frBonus = (c.fundingRate !== null && c.fundingRate > 0 && consecutivePositive >= 3) ? 1 : 0;
      const cgData = cgMap.get(c.symbol) ?? null;
      const futuresHeatScore = cgData ? calcFuturesHeatScore(c.volume24h, cgData.spotVolume) : 0;
      const snsHeatScore = cgData ? calcSnsHeatScore(cgData.twitterFollowers, cgData.telegramMembers, c.priceChange7d) : 0;
      const displayScore = c.shortScore + exclusivityScore + frBonus + futuresHeatScore + snsHeatScore;
      return { ...c, listedOnBinance, listedOnBybit, exclusivityScore, frBonus, cgData, futuresHeatScore, snsHeatScore, displayScore };
    });
    const sorted = mapped.sort((a, b) => {
      switch (sortBy) {
        case "athDropPct":     return a.athDropPct - b.athDropPct;
        case "priceChange24h": return b.priceChange24h - a.priceChange24h;
        case "priceChange7d":  return b.priceChange7d - a.priceChange7d;
        case "openInterest":   return b.openInterest - a.openInterest;
        default:               return b.displayScore - a.displayScore;
      }
    });

    if (!summaryFilter) return sorted;
    switch (summaryFilter) {
      case "strong":  return sorted.filter(c => c.displayScore >= 10);
      case "long":    return sorted.filter(c => isLongBias(c));
      case "pattern": return sorted.filter(c => !!c.chartPattern);
      case "allTf":   return sorted.filter(c => c.trendMultiTF?.alignment === 3);
      case "spike":   return sorted.filter(c => c.volumeSpike && c.volumeSpike.direction !== "neutral");
      default:        return sorted;
    }
  }, [data, minDrop, maxVolRatio, maxDays, minVol24k, minOiK, binanceSyms, bybitSyms, snapshots, sortBy, cgMap, summaryFilter]);

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
            const next = Math.min(i + 1, extended.length - 1);
            if (extended[next]) setTimeout(() => document.getElementById(`row-${extended[next].symbol}`)?.scrollIntoView({ block: "nearest" }), 0);
            return next;
          });
          break;
        case "arrowup":
          e.preventDefault();
          setSelectedIdx(i => {
            const next = Math.max(i - 1, 0);
            if (extended[next]) setTimeout(() => document.getElementById(`row-${extended[next].symbol}`)?.scrollIntoView({ block: "nearest" }), 0);
            return next;
          });
          break;
        case "enter":
          e.preventDefault();
          if (selectedIdx >= 0 && extended[selectedIdx]) toggleRow(extended[selectedIdx].symbol);
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
  }, [loading, extended, selectedIdx]);

  // Share results (E)
  function shareResults() {
    if (!extended.length) return;
    const top3 = extended.slice(0, 3).map(c => `${c.symbol.replace("_USDT","")} ${c.displayScore}pt`).join(" / ");
    const text = `🎯 MEXC Short Scanner スキャン結果\nTOP3: ${top3}\n#MEXC #CryptoShort #暗号通貨\nhttps://bell-crypto-terminal.vercel.app/short-scan`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

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

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-base md:text-lg font-bold text-gray-800">{t.title}</h2>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{t.subtitle}</p>
        </div>
        {/* Language toggle (G) */}
        <button onClick={() => setLang(l => l === "ja" ? "en" : "ja")}
          className="px-2 py-1 text-xs border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors shrink-0">
          {lang === "ja" ? "🇺🇸 EN" : "🇯🇵 JA"}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button onClick={exportCSV} disabled={extended.length === 0}
          className="px-2 md:px-3 py-1.5 text-xs bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed border border-gray-300 rounded-lg text-gray-600 transition-colors">
          {t.csvBtn}
        </button>
        <button onClick={handleAutoRefresh}
          className={`px-2 md:px-3 py-1.5 text-xs border rounded-lg transition-colors ${autoRefresh ? "bg-indigo-50 text-indigo-700 border-indigo-300" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
          {t.autoRefresh} {autoRefresh ? "ON" : "OFF"}
        </button>
        {/* Sound toggle (施策2) */}
        <button onClick={toggleSound}
          className={`px-2 md:px-3 py-1.5 text-xs border rounded-lg transition-colors ${soundEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}
          title={soundEnabled ? "サウンドをOFFにする" : "サウンドをONにする"}>
          {soundEnabled ? t.soundOn : t.soundOff}
        </button>
        {/* Notification (D) */}
        {notifState !== "granted" ? (
          <button onClick={requestNotif}
            className="px-2 md:px-3 py-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors">
            {t.notifEnable}
          </button>
        ) : (
          <span className="px-2 md:px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg">{t.notifOn}</span>
        )}
        {/* Share (E) */}
        <button onClick={shareResults} disabled={extended.length === 0}
          className="px-2 md:px-3 py-1.5 text-xs bg-sky-50 text-sky-700 border border-sky-300 rounded-lg hover:bg-sky-100 disabled:opacity-40 transition-colors">
          {t.shareBtn}
        </button>
        {/* MEXC referral (C) */}
        <a href={MEXC_REG_URL} target="_blank" rel="noopener noreferrer"
          className="px-2 md:px-3 py-1.5 text-xs bg-orange-50 text-orange-700 border border-orange-300 rounded-lg hover:bg-orange-100 transition-colors">
          {t.mexcReg}
        </a>
        <div className="flex gap-2 ml-auto">
          {/* Keyboard shortcut help (施策3) */}
          <button onClick={() => setShowShortcutHelp(true)}
            className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-400 hover:bg-gray-50 transition-colors"
            title="キーボードショートカット (?)">
            ⌨️
          </button>
          <button onClick={() => scan()} disabled={loading}
            className="px-3 md:px-4 py-1.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white rounded-lg transition-colors">
            {loading ? "⏳ ..." : t.scanBtn}
          </button>
          <button onClick={() => scan("new30")} disabled={loading}
            className="px-3 md:px-4 py-1.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white rounded-lg transition-colors whitespace-nowrap">
            {loading ? "⏳ ..." : t.new30Btn}
          </button>
        </div>
      </div>

      {/* Filter Presets (施策6) */}
      <FilterPresets t={t} customPresets={customPresets} onApply={applyPreset} onSaveCurrent={saveCurrentPreset} onDeleteCustom={deleteCustomPreset} />

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-3 bg-gray-50 border border-gray-200 rounded-xl p-3 md:p-4">
        {[
          { label: `${t.athDrop} ≥`, val: `${minDrop}%`, color: "text-red-600", accent: "accent-red-500", min:10, max:80, step:5, v:minDrop, set:setMinDrop },
          { label: `${t.volRatio} ≤`, val: (maxVolRatio/100).toFixed(2), color: "text-orange-600", accent: "accent-orange-500", min:10, max:150, step:5, v:maxVolRatio, set:setMaxVolRatio },
          { label: `${t.listDays} ≤`, val: `${maxDays}日`, color: "text-blue-600", accent: "accent-blue-500", min:1, max:365, step:1, v:maxDays, set:setMaxDays },
          { label: `${t.minVol} ≥`, val: `$${minVol24k}K`, color: "text-green-600", accent: "accent-green-500", min:1, max:1000, step:1, v:minVol24k, set:setMinVol24k },
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
          <span>{t.showing}: <strong className="text-gray-700">{extended.length}</strong></span>
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
          />
          {summaryFilter && (
            <button onClick={() => setSummaryFilter(null)}
              className="text-xs text-gray-400 hover:text-indigo-600 underline">
              ✕ フィルター解除
            </button>
          )}
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
            onClick={() => { setMinDrop(30); setMaxVolRatio(70); setMaxDays(365); setMinVol24k(100); setMinOiK(0); setSummaryFilter(null); }}
            className="mt-3 px-4 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors">
            {t.filterReset}
          </button>
        </div>
      )}

      {/* Results table / heatmap */}
      {!loading && extended.length > 0 && (
        <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Legend + view toggle */}
          <div className="flex flex-wrap items-center gap-3 px-3 md:px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
            <span className="font-semibold text-gray-600">{t.scoreLabel} (/{DISPLAY_MAX}):</span>
            <span style={{ color:"#b91c1c", fontWeight:700 }}>■ {t.scoreHigh}</span>
            <span style={{ color:"#c2410c", fontWeight:700 }} className="hidden sm:inline">■ {t.scoreMid}</span>
            <span style={{ color:"#6b7280" }} className="hidden sm:inline">■ {t.scoreLow}</span>
            <span className="ml-auto text-gray-400 sm:hidden">{t.scrollHint}</span>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden ml-auto">
              <button onClick={() => setViewMode("table")}
                className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${viewMode==="table"?"bg-indigo-600 text-white":"bg-white text-gray-600 hover:bg-gray-50"}`}>
                {t.viewTable}
              </button>
              <button onClick={() => setViewMode("heat")}
                className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${viewMode==="heat"?"bg-indigo-600 text-white":"bg-white text-gray-600 hover:bg-gray-50"}`}>
                {t.viewHeat}
              </button>
            </div>
          </div>

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
          {viewMode === "table" && <div className="overflow-x-auto"><table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-white border-b border-gray-200 text-xs font-semibold text-gray-600">
                  <th className="px-2 md:px-3 py-2.5 text-left sticky left-0 bg-white z-10">{t.colSymbol}</th>
                  <SortTh label={t.colScore}  sortKey="displayScore"   current={sortBy} onSort={setSortBy} cls="text-center" />
                  <th className="px-2 md:px-3 py-2.5 text-right hidden md:table-cell">{t.colPrice}</th>
                  <SortTh label={t.colAth}    sortKey="athDropPct"     current={sortBy} onSort={setSortBy} />
                  <th className="px-2 md:px-3 py-2.5 text-right hidden sm:table-cell">{t.colVolR}</th>
                  <SortTh label={t.col24h}    sortKey="priceChange24h" current={sortBy} onSort={setSortBy} />
                  <SortTh label={t.col7d}     sortKey="priceChange7d"  current={sortBy} onSort={setSortBy} cls="text-right hidden sm:table-cell" />
                  <th className="px-2 md:px-3 py-2.5 text-right">{t.colFr}</th>
                  <SortTh label={t.colOi}     sortKey="openInterest"   current={sortBy} onSort={setSortBy} cls="text-right hidden md:table-cell" />
                  <th className="px-2 md:px-3 py-2.5 text-right hidden lg:table-cell">{t.colVol}</th>
                  {HAS_CG && <th className="px-2 md:px-3 py-2.5 text-right hidden xl:table-cell">{t.colSpot}</th>}
                  {HAS_CG && <th className="px-2 md:px-3 py-2.5 text-right hidden xl:table-cell">{t.colFsRatio}</th>}
                  <th className="px-2 md:px-3 py-2.5 text-right hidden md:table-cell">{t.colDays}</th>
                  <th className="px-2 md:px-3 py-2.5 text-right hidden md:table-cell" title="BTCとの価格連動度。低いほどショートに有利">{t.colBtcCorr}</th>
                  <th className="px-2 md:px-3 py-2.5 text-center hidden sm:table-cell">{t.colExch}</th>
                </tr>
              </thead>
              <tbody>
                {extended.map((c, idx) => {
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
                        <td className="px-2 md:px-3 py-2 sticky left-0 bg-white hover:bg-gray-50">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-mono font-bold text-gray-800 text-xs md:text-sm">{base}</span>
                              <span className="text-gray-400 text-[10px]">/USDT</span>
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
                            {c.chartPattern && (
                              <span className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-sky-50 text-sky-700 border-sky-300">
                                {c.chartPattern.type === "bear_flag" ? t.patBearFlag : c.chartPattern.type === "dead_cat" ? t.patDeadCat : t.patDescWedge}
                              </span>
                            )}
                            {isLongBias(c) && (
                              <span title={t.longBiasNote}
                                className="text-[9px] px-1 py-0.5 rounded border font-bold whitespace-nowrap bg-green-50 text-green-700 border-green-300 cursor-help">
                                {t.longBiasBadge}
                              </span>
                            )}
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
                        <td className="px-2 md:px-3 py-2 text-center">
                          <span style={scoreBadgeStyle(c.displayScore)}>{c.displayScore}/{DISPLAY_MAX}</span>
                        </td>

                        {/* 価格 */}
                        <td className="px-2 md:px-3 py-2 text-right font-mono text-gray-700 text-xs hidden md:table-cell">
                          {fmtPrice(c.currentPrice)}
                        </td>

                        {/* ATH比 */}
                        <td className="px-2 md:px-3 py-2 text-right font-bold text-red-600 text-xs">
                          {c.athDropPct.toFixed(1)}%
                        </td>

                        {/* 出来高比 + 施策3スパイクバッジ */}
                        <td className="px-2 md:px-3 py-2 text-right text-orange-600 text-xs hidden sm:table-cell">
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
                        <td className={`px-2 md:px-3 py-2 text-right text-xs font-mono font-bold ${p24>=50?"text-red-600":p24>=20?"text-orange-500":p24<=-30?"text-green-600":"text-gray-500"}`}>
                          {fmtPct(p24)}
                        </td>

                        {/* 7d */}
                        <td className={`px-2 md:px-3 py-2 text-right text-xs font-mono font-bold hidden sm:table-cell ${p7>=100?"text-red-700":p7>=50?"text-red-500":p7<=-30?"text-green-600":"text-gray-500"}`}>
                          {fmtPct(p7)}{p7>=100&&<span className="ml-0.5">🚀</span>}
                        </td>

                        {/* FR — 修正4: 負値強調 */}
                        <td className={`px-2 md:px-3 py-2 text-right text-xs font-mono ${frPct==null?"text-gray-400":frPct<0?"bg-red-50 text-red-600 font-bold":frPct>0.01?"text-purple-600 font-bold":frPct>0?"text-purple-500":"text-gray-400"}`}
                          title={frPct != null && frPct < 0 ? t.frNegativeWarn : undefined}>
                          {frPct!=null?`${frPct>=0?"+":""}${frPct.toFixed(4)}%`:"—"}
                          {c.frBonus>0&&<span className="ml-0.5 text-violet-500">★</span>}
                          {frPct!=null&&frPct<0&&<span className="ml-0.5">⚡</span>}
                        </td>

                        {/* OI */}
                        <td className={`px-2 md:px-3 py-2 text-right text-xs font-mono hidden md:table-cell ${c.openInterest<10_000?"text-red-600 font-bold":c.openInterest<50_000?"text-yellow-600":c.oiRatio>3?"text-red-600 font-bold":c.oiRatio>1.5?"text-orange-500":"text-gray-600"}`}>
                          {fmtVol(c.openInterest)}<span className="text-gray-400 ml-0.5">{c.oiRatio.toFixed(1)}×</span>
                        </td>

                        {/* 出来高 */}
                        <td className="px-2 md:px-3 py-2 text-right text-gray-600 text-xs hidden lg:table-cell">
                          {fmtVol(c.volume24h)}
                        </td>

                        {/* CG spot vol */}
                        {HAS_CG && <td className="px-2 md:px-3 py-2 text-right text-xs text-gray-600 hidden xl:table-cell">
                          {c.cgData?.spotVolume ? fmtVol(c.cgData.spotVolume) : <span className="text-gray-300">—</span>}
                        </td>}

                        {/* CG F/S ratio */}
                        {HAS_CG && (() => {
                          const sp = c.cgData?.spotVolume;
                          const ratio = sp ? (c.volume24h / sp) * 100 : null;
                          return <td className={`px-2 md:px-3 py-2 text-right text-xs font-mono hidden xl:table-cell ${ratio && ratio>500?"text-red-600 font-bold":ratio && ratio>200?"text-orange-500":"text-gray-500"}`}>
                            {ratio ? `${ratio.toFixed(0)}%` : <span className="text-gray-300">—</span>}
                          </td>;
                        })()}

                        {/* 上場 */}
                        <td className="px-2 md:px-3 py-2 text-right text-gray-500 text-xs hidden md:table-cell">
                          {c.listedDaysAgo}d
                        </td>

                        {/* BTC相関 */}
                        <td className="px-2 md:px-3 py-2 text-right text-xs font-mono hidden md:table-cell"
                          title="BTCとの価格連動度。低いほどショートに有利">
                          {(() => {
                            const corr = c.btcCorrelation;
                            const cls = corr >= 0.7 ? "text-red-600 font-bold" : corr >= 0.3 ? "text-orange-500" : "text-green-600 font-bold";
                            const icon = corr >= 0.7 ? "⚠️" : corr < 0.3 ? "✅" : "";
                            return <span className={cls}>{icon}{corr.toFixed(2)}</span>;
                          })()}
                        </td>

                        {/* 取引所 */}
                        <td className="px-2 md:px-3 py-2 text-center hidden sm:table-cell">
                          <div className="flex flex-col items-center gap-0.5">
                            <ExchangeBadges c={c} t={t} />
                            <a href={mexcUrl(base)} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-xs text-blue-500 hover:text-blue-700 underline">
                              {t.openLink}
                            </a>
                          </div>
                        </td>
                      </tr>
                      {isOpen && <ScoreDetail c={c} snapshots={snapshots} alerts={alerts} t={t} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table></div>}
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

      {/* Toast (施策10) */}
      <ToastContainer toasts={toasts} />

      {/* Keyboard shortcut help (施策3) */}
      {showShortcutHelp && <ShortcutHelpModal t={t} onClose={() => setShowShortcutHelp(false)} />}
    </div>
  );
}
