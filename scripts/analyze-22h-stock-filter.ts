/**
 * Phase 1: 22h/TP-10/SL+18 STOCK除外分析
 *
 * grid-search-s01.json はシンボル別トレード記録を持たないため、
 * klineファイルを直接読み込んで 22h/TP-10/SL+18 のトレードを再シミュレーション。
 * STOCK除外前後の統計を比較し、docs/phase1-22h-stock-filter.md に保存。
 *
 * 実行: npx tsx scripts/analyze-22h-stock-filter.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { makeListingHourDetector } from "./historical-backtest/lib/strategies";
import { simulateExit } from "./historical-backtest/lib/simulator";
import type { SymbolKlineFile } from "./historical-backtest/lib/types";

// ─── 対象パラメータ ───────────────────────────────────────────
const ENTRY_HOUR = 22;
const TP_PCT = -10;
const SL_PCT = 18;

// ─── パス ────────────────────────────────────────────────────
const ROOT = path.resolve("data/historical");
const KLINES_DIR = path.join(ROOT, "klines");
const DOCS_DIR = path.resolve("docs");
const OUTPUT_MD = path.join(DOCS_DIR, "phase1-22h-stock-filter.md");

// ─── 型 ─────────────────────────────────────────────────────
interface TradeRecord {
  symbol: string;
  isStock: boolean;
  exitReason: "tp_hit" | "sl_hit" | "timeout";
  pnlPct: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  entryTimeSec: number;
  entryTimeISO: string;
}

// ─── ユーティリティ ──────────────────────────────────────────
function fmtPct(n: number, d = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

function calcStats(trades: TradeRecord[]) {
  const total = trades.length;
  if (total === 0) return null;

  const wins     = trades.filter(t => t.exitReason === "tp_hit");
  const losses   = trades.filter(t => t.exitReason === "sl_hit");
  const timeouts = trades.filter(t => t.exitReason === "timeout");
  const resolved = wins.length + losses.length;

  const winRate = resolved > 0 ? (wins.length / resolved) * 100 : 0;
  const avgPnl  = trades.reduce((s, t) => s + t.pnlPct, 0) / total;
  const avgWin  = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const pf = (wins.length > 0 && losses.length > 0)
    ? (wins.reduce((s, t) => s + t.pnlPct, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0))
    : 0;
  const timeoutRate = (timeouts.length / total) * 100;
  const maxDD = Math.min(...trades.map(t => t.pnlPct));

  return {
    total, wins: wins.length, losses: losses.length, timeouts: timeouts.length,
    resolved, winRate, avgPnl, avgWin, avgLoss, pf, timeoutRate, maxDD,
  };
}

function printStats(label: string, trades: TradeRecord[]): string {
  const s = calcStats(trades);
  if (!s) return `${label}: トレードなし\n`;
  return [
    `サンプル数: ${s.total}`,
    `勝率: ${s.winRate.toFixed(1)}% (${s.wins}勝/${s.losses}敗/${s.timeouts}TO)`,
    `平均PnL: ${fmtPct(s.avgPnl)}`,
    `勝ちトレード平均: ${fmtPct(s.avgWin)}`,
    `負けトレード平均: ${fmtPct(s.avgLoss)}`,
    `Profit Factor: ${s.pf.toFixed(3)}`,
    `Timeout率: ${s.timeoutRate.toFixed(1)}%`,
    `最大損失(単一): ${fmtPct(s.maxDD)}`,
  ].join("\n");
}

function calcMonthly(trades: TradeRecord[]): Map<string, TradeRecord[]> {
  const map = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const month = t.entryTimeISO.slice(0, 7);
    if (!map.has(month)) map.set(month, []);
    map.get(month)!.push(t);
  }
  return map;
}

// ─── メイン ─────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("=== Phase 1: 22h/TP-10/SL+18 STOCK除外分析 ===\n");

  const klineFiles = fs.readdirSync(KLINES_DIR).filter(f => f.endsWith(".json") && !f.startsWith("_"));
  console.log(`Klineファイル数: ${klineFiles.length}`);

  const detector = makeListingHourDetector(ENTRY_HOUR);
  const allTrades: TradeRecord[] = [];
  let skipped = 0;

  for (const fname of klineFiles) {
    let kdata: SymbolKlineFile;
    try {
      kdata = JSON.parse(fs.readFileSync(path.join(KLINES_DIR, fname), "utf8")) as SymbolKlineFile;
    } catch {
      skipped++;
      continue;
    }
    if (!kdata.bars || kdata.bars.length < 100) { skipped++; continue; }

    const createTimeSec = Math.floor(kdata.createTime / 1000);
    const entry = detector(kdata.bars, createTimeSec);
    if (!entry) { skipped++; continue; }

    const outcome = simulateExit(kdata.bars, entry, TP_PCT, SL_PCT);

    allTrades.push({
      symbol: kdata.symbol,
      isStock: kdata.symbol.endsWith("STOCK_USDT"),
      exitReason: outcome.exitReason,
      pnlPct: outcome.pnlPct,
      maxFavorablePct: outcome.maxFavorablePct,
      maxAdversePct: outcome.maxAdversePct,
      entryTimeSec: entry.timeSec,
      entryTimeISO: new Date(entry.timeSec * 1000).toISOString(),
    });
  }

  console.log(`シミュレーション完了: ${allTrades.length}件 (スキップ: ${skipped}件)\n`);

  const stockTrades    = allTrades.filter(t => t.isStock);
  const nonStockTrades = allTrades.filter(t => !t.isStock);

  // ─── サマリー出力 ────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`=== Phase 1: 22h/TP-${Math.abs(TP_PCT)}/SL+${SL_PCT} STOCK除外分析 ===`);
  lines.push("");
  lines.push(`【全体（STOCK含む）】`);
  lines.push(printStats("全体", allTrades));
  lines.push("");
  lines.push(`【STOCK系（〜STOCK_USDT）】`);
  lines.push(`サンプル数: ${stockTrades.length}件`);
  if (stockTrades.length > 0) {
    const ss = calcStats(stockTrades)!;
    lines.push(`勝率: ${ss.winRate.toFixed(1)}%`);
    lines.push(`平均PnL: ${fmtPct(ss.avgPnl)}`);
    lines.push(`銘柄一覧: ${stockTrades.map(t => t.symbol).join(", ")}`);
  }
  lines.push("");
  lines.push(`【STOCK除外後】`);
  lines.push(printStats("STOCK除外後", nonStockTrades));

  // ─── 前半/後半（STOCK除外後）────────────────────────────
  const sorted = nonStockTrades.slice().sort((a, b) => a.entryTimeSec - b.entryTimeSec);
  const mid = Math.floor(sorted.length / 2);
  const firstHalf  = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);
  const fh = calcStats(firstHalf)!;
  const sh = calcStats(secondHalf)!;

  lines.push("");
  lines.push("【期間別（STOCK除外後）】");
  lines.push(`前半（最初の半分 ${firstHalf.length}件）: 勝率${fh.winRate.toFixed(1)}% / 平均PnL${fmtPct(fh.avgPnl)}`);
  lines.push(`  期間: ${firstHalf[0]?.entryTimeISO.slice(0,10)} 〜 ${firstHalf[firstHalf.length-1]?.entryTimeISO.slice(0,10)}`);
  lines.push(`後半（最後の半分 ${secondHalf.length}件）: 勝率${sh.winRate.toFixed(1)}% / 平均PnL${fmtPct(sh.avgPnl)}`);
  lines.push(`  期間: ${secondHalf[0]?.entryTimeISO.slice(0,10)} 〜 ${secondHalf[secondHalf.length-1]?.entryTimeISO.slice(0,10)}`);

  // ─── 月別（STOCK除外後）──────────────────────────────────
  lines.push("");
  lines.push("【月別勝率（STOCK除外後）】");
  const monthly = calcMonthly(nonStockTrades);
  const sortedMonths = [...monthly.keys()].sort();
  const monthlyStats: Array<{ month: string; winRate: number; count: number; avgPnl: number }> = [];
  for (const month of sortedMonths) {
    const mt = monthly.get(month)!;
    const ms = calcStats(mt)!;
    monthlyStats.push({ month, winRate: ms.winRate, count: mt.length, avgPnl: ms.avgPnl });
    lines.push(`${month}: 勝率${ms.winRate.toFixed(1)}% (${mt.length}件) / 平均PnL${fmtPct(ms.avgPnl)}`);
  }

  // ─── 期待値妥当性チェック ─────────────────────────────────
  const ns = calcStats(nonStockTrades)!;
  const theoreticalEV =
    (ns.winRate / 100) * Math.abs(TP_PCT) -
    ((100 - ns.winRate) / 100) * SL_PCT;
  // タイムアウトを除いた場合の理論値（resolved のみ）
  const resolvedRate = ns.resolved / ns.total;
  const theoreticalResolved =
    (ns.winRate / 100) * Math.abs(TP_PCT) -
    ((100 - ns.winRate) / 100) * SL_PCT;

  lines.push("");
  lines.push("【期待値の算出妥当性チェック（STOCK除外後）】");
  lines.push(`理論期待値（TP${fmtPct(TP_PCT)}/SL+${SL_PCT}%固定、timeout込み）:`);
  lines.push(`  勝率${ns.winRate.toFixed(1)}% × ${Math.abs(TP_PCT)}% - 敗率${(100-ns.winRate).toFixed(1)}% × ${SL_PCT}% = ${fmtPct(theoreticalResolved)}`);
  lines.push(`  ※ ただしtimeoutはTP/SL固定でなく現在価格で決着するため、実測値との差が生じる`);
  lines.push(`実測期待値（全トレード平均PnL）: ${fmtPct(ns.avgPnl)}`);
  lines.push(`差分: ${fmtPct(ns.avgPnl - theoreticalResolved)}`);
  lines.push(`Timeout件数: ${ns.timeouts}件 (${ns.timeoutRate.toFixed(1)}%) → timeoutのPnL変動が乖離の主因`);

  // ─── 月別レンジ ────────────────────────────────────────
  if (monthlyStats.length > 0) {
    const maxWR = Math.max(...monthlyStats.map(m => m.winRate));
    const minWR = Math.min(...monthlyStats.map(m => m.winRate));
    const bestM = monthlyStats.find(m => m.winRate === maxWR)!;
    const worstM = monthlyStats.find(m => m.winRate === minWR)!;
    lines.push("");
    lines.push("【月別勝率レンジ（STOCK除外後）】");
    lines.push(`最高: ${bestM.month} ${maxWR.toFixed(1)}% (${bestM.count}件)`);
    lines.push(`最低: ${worstM.month} ${minWR.toFixed(1)}% (${worstM.count}件)`);
    lines.push(`レンジ幅: ${(maxWR - minWR).toFixed(1)}pt`);
  }

  const output = lines.join("\n");
  console.log("\n" + output + "\n");

  // ─── ドキュメント保存 ────────────────────────────────────
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

  const mdContent = [
    `# Phase 1: 22h/TP-10/SL+18 STOCK除外分析`,
    ``,
    `- 作成日: ${new Date().toISOString().slice(0, 10)}`,
    `- 対象データ: data/historical/klines/ (${klineFiles.length}ファイル)`,
    `- 戦略: entry=${ENTRY_HOUR}h / TP=${TP_PCT}% / SL=+${SL_PCT}%`,
    ``,
    "```",
    output,
    "```",
  ].join("\n");

  fs.writeFileSync(OUTPUT_MD, mdContent, "utf8");
  console.log(`\n✅ 保存: ${OUTPUT_MD}`);

  // ─── UI更新用サマリー ─────────────────────────────────────
  console.log("\n=== ListingHunter.tsx ヘッダー更新値（STOCK除外後）===");
  console.log(`バックテスト勝率: ${ns.winRate.toFixed(1)}%`);
  console.log(`期待値: ${fmtPct(ns.avgPnl)}/トレード`);
  console.log(`対象銘柄: ${nonStockTrades.length}銘柄（STOCK ${stockTrades.length}件除外後）`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
