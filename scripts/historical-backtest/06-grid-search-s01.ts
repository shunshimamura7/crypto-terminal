/**
 * Phase 1: S01 戦略の細密グリッドサーチ
 *
 * エントリー時間 × TP × SL の3次元グリッドで最適パラメータを探索。
 * 過学習を避けるため Walk-forward 分析とロバスト性スコアを併用。
 *
 * 入力: data/historical/listings.json + klines/*.json
 * 出力: data/historical/results/grid-search-s01.json
 *      data/historical/results/GRID-SEARCH-REPORT.md
 *
 * 実行: npx tsx scripts/historical-backtest/06-grid-search-s01.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { makeListingHourDetector } from "./lib/strategies";
import { simulateExit } from "./lib/simulator";
import type {
  GridParams,
  GridResult,
  GridSearchOutput,
  ListingsFile,
  SymbolKlineFile,
} from "./lib/types";

// ─── パラメータグリッド ──────────────────────────────────
const ENTRY_HOURS = [20, 22, 24, 26, 28, 30, 32, 36, 48];
const TP_PCTS = [-10, -12, -15, -18, -20, -25];
const SL_PCTS = [5, 8, 10, 12, 15, 18];

// ─── Walk-forward 分割点 ─────────────────────────────────
const SPLIT_DAYS_AGO = 180;

// ─── パス ────────────────────────────────────────────────
const ROOT = path.resolve("data/historical");
const LISTINGS_FILE = path.join(ROOT, "listings.json");
const KLINES_DIR = path.join(ROOT, "klines");
const RESULTS_DIR = path.join(ROOT, "results");
const OUTPUT_JSON = path.join(RESULTS_DIR, "grid-search-s01.json");
const OUTPUT_MD = path.join(RESULTS_DIR, "GRID-SEARCH-REPORT.md");

const MIN_TRADES_FILTER = 20;
const TOP_N_RESULTS = 30;

function fmtPct(n: number, d = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

interface TradeOutcome {
  pnlPct: number;
  pnlR: number;
  exitReason: "tp_hit" | "sl_hit" | "timeout";
  entryTimeSec: number;
}

async function main(): Promise<void> {
  const sep = "━".repeat(72);
  console.log(sep);
  console.log("Phase 1: S01 グリッドサーチ");
  console.log(sep);
  console.log(`Entry hours: ${ENTRY_HOURS.length} (${ENTRY_HOURS.join(", ")})`);
  console.log(`TP params:   ${TP_PCTS.length}`);
  console.log(`SL params:   ${SL_PCTS.length}`);
  console.log(`Total params: ${ENTRY_HOURS.length * TP_PCTS.length * SL_PCTS.length}`);
  console.log();

  const listings = JSON.parse(fs.readFileSync(LISTINGS_FILE, "utf8")) as ListingsFile;
  void listings;

  const klineFiles = fs
    .readdirSync(KLINES_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  console.log(`Kline files: ${klineFiles.length}`);
  console.log();

  const splitTimeSec = Math.floor(Date.now() / 1000) - SPLIT_DAYS_AGO * 86_400;
  const splitDate = new Date(splitTimeSec * 1000).toISOString().slice(0, 10);
  console.log(`Walk-forward split: ${splitDate}`);
  console.log();

  // バケット初期化
  const bucketMap = new Map<string, {
    params: GridParams;
    all: TradeOutcome[];
    firstHalf: TradeOutcome[];
    secondHalf: TradeOutcome[];
  }>();

  for (const eh of ENTRY_HOURS) {
    for (const tp of TP_PCTS) {
      for (const sl of SL_PCTS) {
        bucketMap.set(`${eh}|${tp}|${sl}`, {
          params: { entryHour: eh, tpPct: tp, slPct: sl },
          all: [],
          firstHalf: [],
          secondHalf: [],
        });
      }
    }
  }

  // 銘柄ループ
  let processed = 0;
  const startedAt = Date.now();

  for (const fname of klineFiles) {
    let kdata: SymbolKlineFile;
    try {
      kdata = JSON.parse(fs.readFileSync(path.join(KLINES_DIR, fname), "utf8")) as SymbolKlineFile;
    } catch {
      continue;
    }
    if (!kdata.bars || kdata.bars.length < 100) continue;

    const createTimeSec = Math.floor(kdata.createTime / 1000);

    for (const eh of ENTRY_HOURS) {
      const detector = makeListingHourDetector(eh);
      const entry = detector(kdata.bars, createTimeSec);
      if (!entry) continue;

      const isFirstHalf = entry.timeSec < splitTimeSec;

      for (const tp of TP_PCTS) {
        for (const sl of SL_PCTS) {
          const outcome = simulateExit(kdata.bars, entry, tp, sl);
          const trade: TradeOutcome = {
            pnlPct: outcome.pnlPct,
            pnlR: outcome.pnlR,
            exitReason: outcome.exitReason,
            entryTimeSec: entry.timeSec,
          };

          const bucket = bucketMap.get(`${eh}|${tp}|${sl}`)!;
          bucket.all.push(trade);
          if (isFirstHalf) bucket.firstHalf.push(trade);
          else bucket.secondHalf.push(trade);
        }
      }
    }

    processed++;
    if (processed % 30 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      const pct = ((processed / klineFiles.length) * 100).toFixed(0);
      console.log(`  [${pct}%] ${processed}/${klineFiles.length} (${elapsed}s)`);
    }
  }

  // 集計
  console.log("\n[Aggregating ...]");

  function calcHalfStats(trades: TradeOutcome[]): { trades: number; winRate: number; avgPnl: number; expectancy: number } {
    if (trades.length === 0) return { trades: 0, winRate: 0, avgPnl: 0, expectancy: 0 };
    const wins = trades.filter(t => t.exitReason === "tp_hit");
    const losses = trades.filter(t => t.exitReason === "sl_hit");
    const resolved = wins.length + losses.length;
    const wr = resolved > 0 ? (wins.length / resolved) * 100 : 0;
    const avgPnl = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
    const avgW = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgL = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
    const wp = wr / 100;
    const exp = wp * avgW + (1 - wp) * avgL;
    return { trades: trades.length, winRate: wr, avgPnl, expectancy: exp };
  }

  const results: GridResult[] = [];

  for (const bucket of bucketMap.values()) {
    const all = bucket.all;
    if (all.length === 0) continue;

    const wins = all.filter(t => t.exitReason === "tp_hit");
    const losses = all.filter(t => t.exitReason === "sl_hit");
    const timeouts = all.filter(t => t.exitReason === "timeout");
    const resolved = wins.length + losses.length;
    const winRate = resolved > 0 ? (wins.length / resolved) * 100 : 0;
    const totalPnl = all.reduce((s, t) => s + t.pnlPct, 0);
    const avgPnl = totalPnl / all.length;
    const realizedR = all.reduce((s, t) => s + t.pnlR, 0);
    const avgWinPnl = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLossPnl = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
    const wp = winRate / 100;
    const expectancy = wp * avgWinPnl + (1 - wp) * avgLossPnl;
    const totalGain = wins.length * Math.abs(avgWinPnl);
    const totalLoss = losses.length * Math.abs(avgLossPnl);
    const profitFactor = totalLoss > 0 ? totalGain / totalLoss : (totalGain > 0 ? Infinity : 0);

    results.push({
      params: bucket.params,
      trades: all.length,
      wins: wins.length,
      losses: losses.length,
      timeouts: timeouts.length,
      winRate,
      resolvedRate: all.length > 0 ? (resolved / all.length) * 100 : 0,
      avgPnl,
      totalPnl,
      expectancy,
      profitFactor,
      realizedR,
      firstHalf: calcHalfStats(bucket.firstHalf),
      secondHalf: calcHalfStats(bucket.secondHalf),
    });
  }

  // ロバスト性スコア計算
  for (const r of results) {
    const neighbors = results.filter(other => {
      if (other === r) return false;
      const dEh = Math.abs(other.params.entryHour - r.params.entryHour);
      const dTp = Math.abs(other.params.tpPct - r.params.tpPct);
      const dSl = Math.abs(other.params.slPct - r.params.slPct);
      const closeAxes = [dEh <= 2, dTp <= 3, dSl <= 2].filter(Boolean).length;
      return closeAxes >= 2;
    });

    if (neighbors.length === 0) continue;

    const neighborAvg = neighbors.reduce((s, n) => s + n.expectancy, 0) / neighbors.length;
    const diff = r.expectancy - neighborAvg;
    r.robustness = {
      neighborAvgExpectancy: neighborAvg,
      diffFromNeighbors: diff,
      isRobust: Math.abs(diff) < 1.0 && r.expectancy > 0,
    };
  }

  // ランキング
  const filtered = results.filter(r => r.trades >= MIN_TRADES_FILTER);
  const topRanked = [...filtered]
    .sort((a, b) => b.expectancy - a.expectancy)
    .slice(0, TOP_N_RESULTS);

  const robustWinners = filtered
    .filter(r =>
      r.robustness?.isRobust === true &&
      r.firstHalf.expectancy > 0 &&
      r.secondHalf.expectancy > 0,
    )
    .sort((a, b) => b.expectancy - a.expectancy)
    .slice(0, 15);

  // JSON出力
  const output: GridSearchOutput = {
    generatedAt: new Date().toISOString(),
    totalSimulations: results.reduce((s, r) => s + r.trades, 0),
    totalSymbols: klineFiles.length,
    splitDate,
    params: { entryHours: ENTRY_HOURS, tpPcts: TP_PCTS, slPcts: SL_PCTS },
    results: filtered,
    topRanked,
    robustWinners,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));

  // マークダウン出力
  const md: string[] = [];
  md.push(`# S01 グリッドサーチ結果`);
  md.push(``);
  md.push(`生成: ${output.generatedAt}`);
  md.push(`Walk-forward分割: ${splitDate}`);
  md.push(`総シミュレーション: ${output.totalSimulations.toLocaleString()}`);
  md.push(``);

  md.push(`## 🏆 期待値ランキングTOP30`);
  md.push(``);
  md.push(`| Rank | EntryH | TP | SL | Trades | WinRate | Expectancy | PF | 1H Exp | 2H Exp |`);
  md.push(`|------|--------|-----|-----|--------|---------|------------|-----|--------|--------|`);
  topRanked.forEach((r, i) => {
    const pf = Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞";
    md.push(
      `| ${i + 1} | ${r.params.entryHour}h | ${r.params.tpPct}% | +${r.params.slPct}% | ` +
      `${r.trades} | ${r.winRate.toFixed(1)}% | ${fmtPct(r.expectancy)} | ` +
      `${pf} | ${fmtPct(r.firstHalf.expectancy, 1)} | ${fmtPct(r.secondHalf.expectancy, 1)} |`,
    );
  });
  md.push(``);

  md.push(`## 💎 ロバストな最適パラメータ`);
  md.push(``);
  md.push(`過学習回避: 隣接パラメータの期待値差 ±1%以内 + 前後半の両方で期待値プラス`);
  md.push(``);
  if (robustWinners.length === 0) {
    md.push(`⚠️ ロバストな勝ち戦略が見つかりませんでした。`);
  } else {
    md.push(`| Rank | EntryH | TP | SL | Trades | WinRate | Expectancy | 1H Exp | 2H Exp | 隣接差 |`);
    md.push(`|------|--------|-----|-----|--------|---------|------------|--------|--------|--------|`);
    robustWinners.forEach((r, i) => {
      md.push(
        `| ${i + 1} | ${r.params.entryHour}h | ${r.params.tpPct}% | +${r.params.slPct}% | ` +
        `${r.trades} | ${r.winRate.toFixed(1)}% | ${fmtPct(r.expectancy)} | ` +
        `${fmtPct(r.firstHalf.expectancy, 1)} | ${fmtPct(r.secondHalf.expectancy, 1)} | ` +
        `${fmtPct(r.robustness?.diffFromNeighbors ?? 0, 2)} |`,
      );
    });
  }
  md.push(``);

  md.push(`## 🔥 エントリー時間別ベスト（TP/SL最適化済み）`);
  md.push(``);
  md.push(`| EntryHour | Best TP | Best SL | Trades | WinRate | Expectancy |`);
  md.push(`|-----------|---------|---------|--------|---------|------------|`);
  for (const eh of ENTRY_HOURS) {
    const ehBest = filtered
      .filter(r => r.params.entryHour === eh)
      .sort((a, b) => b.expectancy - a.expectancy)[0];
    if (!ehBest) continue;
    md.push(
      `| ${eh}h | ${ehBest.params.tpPct}% | +${ehBest.params.slPct}% | ` +
      `${ehBest.trades} | ${ehBest.winRate.toFixed(1)}% | ${fmtPct(ehBest.expectancy)} |`,
    );
  }
  md.push(``);

  md.push(`## 推奨実装パラメータ`);
  md.push(``);
  if (robustWinners.length > 0) {
    const top = robustWinners[0];
    md.push(`### 🥇 推奨: EntryHour=${top.params.entryHour}h / TP=${top.params.tpPct}% / SL=+${top.params.slPct}%`);
    md.push(``);
    md.push(`- 期待値: ${fmtPct(top.expectancy)} / トレード`);
    md.push(`- 勝率: ${top.winRate.toFixed(1)}% (Trades ${top.trades})`);
    md.push(`- Profit Factor: ${Number.isFinite(top.profitFactor) ? top.profitFactor.toFixed(2) : "∞"}`);
    md.push(`- 前半期待値: ${fmtPct(top.firstHalf.expectancy)} / 後半期待値: ${fmtPct(top.secondHalf.expectancy)}`);
    md.push(`- 隣接平均との差: ${fmtPct(top.robustness?.diffFromNeighbors ?? 0)}`);
    md.push(``);
    md.push(`**ロバストネス確認済み**: 過去半年・直近半年の両方で期待値プラス、隣接パラメータと整合的。`);
  } else {
    md.push(`⚠️ ロバストな勝ち戦略が見つかりませんでした。S01自体の信頼性を再検討すべき。`);
  }

  fs.writeFileSync(OUTPUT_MD, md.join("\n"));

  // ターミナル出力
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n${sep}`);
  console.log(`Phase 1 完了 (${elapsed}s)`);
  console.log(sep);
  console.log(`総シミュ:        ${output.totalSimulations.toLocaleString()}`);
  console.log(`フィルタ後:      ${filtered.length} パラメータ (>=${MIN_TRADES_FILTER}件)`);
  console.log(`TOP30:           ${topRanked.length}`);
  console.log(`ロバスト勝者:    ${robustWinners.length}`);
  console.log(``);

  console.log("【期待値TOP10】");
  console.log("Rank | EntryH | TP    | SL  | Trades | WinR  | Expect  | 1H/2H");
  console.log("-----|--------|-------|-----|--------|-------|---------|--------");
  topRanked.slice(0, 10).forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(4)} | ${String(r.params.entryHour).padStart(5)}h | ` +
      `${String(r.params.tpPct).padStart(5)}% | +${String(r.params.slPct).padStart(2)}% | ` +
      `${String(r.trades).padStart(6)} | ${r.winRate.toFixed(1).padStart(5)}% | ` +
      `${fmtPct(r.expectancy).padStart(7)} | ${fmtPct(r.firstHalf.expectancy, 1)}/${fmtPct(r.secondHalf.expectancy, 1)}`,
    );
  });

  console.log(`\n【ロバスト勝者TOP5】`);
  if (robustWinners.length === 0) {
    console.log("(該当なし)");
  } else {
    console.log("Rank | EntryH | TP    | SL  | Trades | WinR  | Expect  | 1H/2H        | 隣接差");
    console.log("-----|--------|-------|-----|--------|-------|---------|--------------|--------");
    robustWinners.slice(0, 5).forEach((r, i) => {
      console.log(
        `${String(i + 1).padStart(4)} | ${String(r.params.entryHour).padStart(5)}h | ` +
        `${String(r.params.tpPct).padStart(5)}% | +${String(r.params.slPct).padStart(2)}% | ` +
        `${String(r.trades).padStart(6)} | ${r.winRate.toFixed(1).padStart(5)}% | ` +
        `${fmtPct(r.expectancy).padStart(7)} | ` +
        `${fmtPct(r.firstHalf.expectancy, 1).padStart(6)}/${fmtPct(r.secondHalf.expectancy, 1).padStart(6)} | ` +
        `${fmtPct(r.robustness?.diffFromNeighbors ?? 0, 2).padStart(6)}`,
      );
    });
  }

  console.log(`\n詳細: ${OUTPUT_MD}`);
}

main().catch(e => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
