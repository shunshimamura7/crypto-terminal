/**
 * Phase 0 / Step 4: 集計レポート生成
 *
 * 入力: data/historical/results/strategies-aggregate.json
 *      data/historical/results/strategies-summary.json
 *      data/historical/results/strategies-detail.json
 * 出力: data/historical/results/REPORT.md
 *
 * 実行: npx tsx scripts/historical-backtest/04-aggregate.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { STRATEGIES } from "./lib/strategies";
import type { SimResult, StrategyAggregate, StrategySummaryLite } from "./lib/types";

const RESULTS_DIR = path.resolve("data/historical/results");
const AGG_FILE = path.join(RESULTS_DIR, "strategies-aggregate.json");
const SUM_FILE = path.join(RESULTS_DIR, "strategies-summary.json");
const DETAIL_FILE = path.join(RESULTS_DIR, "strategies-detail.json");
const OUTPUT_FILE = path.join(RESULTS_DIR, "REPORT.md");

interface SummaryFile {
  generatedAt: string;
  totalSymbols: number;
  totalSimulations: number;
  strategies: StrategySummaryLite[];
}

function fmtPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n: number, digits = 2): string {
  return n.toFixed(digits);
}

async function main(): Promise<void> {
  const sep = "━".repeat(72);
  console.log(sep);
  console.log("Phase 0 / Step 4: 集計レポート生成");
  console.log(sep);

  if (!fs.existsSync(AGG_FILE) || !fs.existsSync(SUM_FILE)) {
    console.error("[ERROR] Step 3 を先に実行してください");
    process.exit(1);
  }

  const aggregates = JSON.parse(fs.readFileSync(AGG_FILE, "utf8")) as StrategyAggregate[];
  const summary = JSON.parse(fs.readFileSync(SUM_FILE, "utf8")) as SummaryFile;
  const details = JSON.parse(fs.readFileSync(DETAIL_FILE, "utf8")) as SimResult[];
  void details;

  const lines: string[] = [];
  lines.push(`# Historical Backtest Report`);
  lines.push("");
  lines.push(`生成日時: ${summary.generatedAt}`);
  lines.push(`対象銘柄: ${summary.totalSymbols}`);
  lines.push(`総シミュレーション: ${summary.totalSimulations.toLocaleString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ─── 戦略別ベスト ───────────────────────────────────────
  lines.push(`## 🏆 戦略別ベストパラメータ（期待値順）`);
  lines.push("");
  lines.push("| Rank | Strategy | TP | SL | Trades | WinRate | Expectancy | PF |");
  lines.push("|------|----------|-----|-----|--------|---------|------------|-----|");

  const ranked = [...summary.strategies].sort((a, b) => b.expectancy - a.expectancy);
  ranked.forEach((s, i) => {
    const stratName = STRATEGIES.find(st => st.id === s.strategyId)?.name ?? s.strategyId;
    lines.push(
      `| ${i + 1} | ${s.strategyId} ${stratName} | ${s.bestParams.tpPct}% | +${s.bestParams.slPct}% | ${s.trades} | ${s.winRate.toFixed(1)}% | ${fmtPct(s.expectancy)} | ${fmtNum(s.profitFactor)} |`,
    );
  });
  lines.push("");

  // ─── 各戦略の全パラメータ詳細 ──────────────────────────
  lines.push(`## 📊 戦略別詳細（全パラメータ）`);
  lines.push("");

  for (const strat of STRATEGIES) {
    const sAggs = aggregates
      .filter(a => a.strategyId === strat.id && a.trades >= 5)
      .sort((a, b) => b.expectancy - a.expectancy);

    if (sAggs.length === 0) continue;

    lines.push(`### ${strat.id}: ${strat.name}`);
    lines.push("");
    lines.push(`> ${strat.description}`);
    lines.push("");
    lines.push(`エントリー率: ${sAggs[0].entryRate.toFixed(1)}%`);
    lines.push("");

    lines.push("| TP | SL | Trades | WinRate | Resolved | Expectancy | AvgPnL | PF | AvgWin | AvgLoss |");
    lines.push("|-----|-----|--------|---------|----------|------------|--------|------|---------|----------|");

    for (const a of sAggs.slice(0, 10)) {
      const pf = Number.isFinite(a.profitFactor) ? fmtNum(a.profitFactor) : "∞";
      lines.push(
        `| ${a.tpPct}% | +${a.slPct}% | ${a.trades} | ${a.winRate.toFixed(1)}% | ${a.resolvedRate.toFixed(0)}% | ${fmtPct(a.expectancy)} | ${fmtPct(a.avgPnl)} | ${pf} | ${fmtPct(a.avgWinPnl)} | ${fmtPct(a.avgLossPnl)} |`,
      );
    }
    lines.push("");

    const best = sAggs[0];
    lines.push(`**ベスト (TP${best.tpPct}% / SL+${best.slPct}%) の上場経過日数別パフォーマンス:**`);
    lines.push("");
    lines.push("| 期間 | Trades | Wins | WinRate | AvgPnL |");
    lines.push("|------|--------|------|---------|---------|");
    for (const k of ["0-3d", "3-7d", "7-14d", "14-30d", "30d+"] as const) {
      const b = best.byListingAge[k];
      lines.push(`| ${k} | ${b.trades} | ${b.wins} | ${b.winRate.toFixed(1)}% | ${fmtPct(b.avgPnl)} |`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ─── 総合判定 ───────────────────────────────────────────
  lines.push(`## 💡 総合判定`);
  lines.push("");

  const winners = ranked.filter(s => s.expectancy > 0 && s.trades >= 50);
  const losers = ranked.filter(s => s.expectancy < 0);

  lines.push(`### ✅ 期待値プラス・サンプル50件以上`);
  lines.push("");
  if (winners.length === 0) {
    lines.push("該当戦略なし");
  } else {
    for (const w of winners) {
      const stratName = STRATEGIES.find(st => st.id === w.strategyId)?.name ?? w.strategyId;
      lines.push(`- **${w.strategyId} ${stratName}** (TP${w.bestParams.tpPct}/SL+${w.bestParams.slPct}): 勝率${w.winRate.toFixed(1)}% / 期待値${fmtPct(w.expectancy)} / Trades ${w.trades}`);
    }
  }
  lines.push("");

  lines.push(`### ❌ 期待値マイナス`);
  lines.push("");
  for (const l of losers) {
    const stratName = STRATEGIES.find(st => st.id === l.strategyId)?.name ?? l.strategyId;
    lines.push(`- ${l.strategyId} ${stratName}: 期待値 ${fmtPct(l.expectancy)} / 勝率 ${l.winRate.toFixed(1)}%`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`生成: scripts/historical-backtest/04-aggregate.ts`);

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"));

  console.log(`\n✅ Report saved: ${OUTPUT_FILE}`);
  console.log(`   ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
  console.log("\nNext: npx tsx scripts/historical-backtest/05-deep-dive-s01.ts");
}

main().catch(e => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
