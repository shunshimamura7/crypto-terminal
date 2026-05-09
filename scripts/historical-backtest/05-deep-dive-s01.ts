/**
 * Phase 0 / Step 5: S01 戦略の深掘り分析
 *
 * 入力: data/historical/results/strategies-detail.json
 * 出力: data/historical/results/S01-DEEP-DIVE.md
 *      data/historical/results/S01-trades.json
 *
 * 実行: npx tsx scripts/historical-backtest/05-deep-dive-s01.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SimResult } from "./lib/types";

const TARGET_STRATEGY = "S01";
const TARGET_TP = -15;
const TARGET_SL = 15;

const RESULTS_DIR = path.resolve("data/historical/results");
const DETAIL_FILE = path.join(RESULTS_DIR, "strategies-detail.json");
const OUTPUT_MD = path.join(RESULTS_DIR, "S01-DEEP-DIVE.md");
const OUTPUT_TRADES = path.join(RESULTS_DIR, "S01-trades.json");

function fmtPct(n: number, d = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

function ymKey(iso: string): string {
  return iso.slice(0, 7);
}

async function main(): Promise<void> {
  console.log("━".repeat(72));
  console.log(`Phase 0 / Step 5: S01 戦略の深掘り分析`);
  console.log("━".repeat(72));

  if (!fs.existsSync(DETAIL_FILE)) {
    console.error("[ERROR] Step 3 を先に実行してください");
    process.exit(1);
  }

  console.log("Loading details...");
  const details = JSON.parse(fs.readFileSync(DETAIL_FILE, "utf8")) as SimResult[];

  const trades = details.filter(
    (d) => d.strategyId === TARGET_STRATEGY && d.tpPct === TARGET_TP && d.slPct === TARGET_SL,
  );

  console.log(`S01 (TP${TARGET_TP}% / SL+${TARGET_SL}%) trades: ${trades.length}`);

  const lines: string[] = [];
  lines.push(`# S01 深掘り分析: listing+24h (TP-15% / SL+15%)`);
  lines.push("");
  lines.push(`生成日時: ${new Date().toISOString()}`);
  lines.push(`対象トレード数: ${trades.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // ─── 1. 決着タイプ ─────────────────────────────────────
  lines.push(`## 1. 決着タイプ別の内訳`);
  lines.push("");
  const wins = trades.filter((t) => t.exitReason === "tp_hit");
  const losses = trades.filter((t) => t.exitReason === "sl_hit");
  const timeouts = trades.filter((t) => t.exitReason === "timeout");

  const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
  const avgPnl = trades.length > 0 ? totalPnl / trades.length : 0;

  lines.push(`| 結果 | 件数 | 比率 | 平均PnL |`);
  lines.push(`|------|------|------|----------|`);
  lines.push(`| 🟢 TP hit | ${wins.length} | ${(wins.length / trades.length * 100).toFixed(1)}% | ${fmtPct(wins.reduce((s, t) => s + t.pnlPct, 0) / Math.max(1, wins.length))} |`);
  lines.push(`| 🔴 SL hit | ${losses.length} | ${(losses.length / trades.length * 100).toFixed(1)}% | ${fmtPct(losses.reduce((s, t) => s + t.pnlPct, 0) / Math.max(1, losses.length))} |`);
  lines.push(`| ⏰ Timeout | ${timeouts.length} | ${(timeouts.length / trades.length * 100).toFixed(1)}% | ${fmtPct(timeouts.reduce((s, t) => s + t.pnlPct, 0) / Math.max(1, timeouts.length))} |`);
  lines.push("");

  const resolvedRate = ((wins.length + losses.length) / trades.length * 100).toFixed(1);
  const realWinRate = wins.length + losses.length > 0
    ? (wins.length / (wins.length + losses.length) * 100).toFixed(1)
    : "0.0";
  lines.push(`**実質勝率（タイムアウト除外）: ${realWinRate}%**`);
  lines.push(`**決着率: ${resolvedRate}%**`);
  lines.push(`**全トレード平均PnL: ${fmtPct(avgPnl)}**`);
  lines.push("");

  // ─── 2. 負けトレードTOP10 ──────────────────────────────
  lines.push(`## 2. 負けトレードTOP10（PnL悪い順）`);
  lines.push("");
  const worst = [...trades].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 10);
  lines.push(`| Rank | Symbol | Entry | Exit | PnL | 決着 | 経過時間 |`);
  lines.push(`|------|--------|-------|------|-----|------|----------|`);
  worst.forEach((t, i) => {
    const entry = t.entryPrice != null ? t.entryPrice.toExponential(3) : "-";
    const exit = t.exitPrice != null ? t.exitPrice.toExponential(3) : "-";
    const holding = t.holdingHours != null ? `${t.holdingHours.toFixed(1)}h` : "-";
    lines.push(`| ${i + 1} | ${t.baseCoin} | ${entry} | ${exit} | ${fmtPct(t.pnlPct)} | ${t.exitReason} | ${holding} |`);
  });
  lines.push("");

  // ─── 3. 勝ちトレードTOP10 ──────────────────────────────
  lines.push(`## 3. 勝ちトレードTOP10（PnL良い順）`);
  lines.push("");
  const best = [...trades].sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 10);
  lines.push(`| Rank | Symbol | Entry | Exit | PnL | 決着 | 経過時間 |`);
  lines.push(`|------|--------|-------|------|-----|------|----------|`);
  best.forEach((t, i) => {
    const entry = t.entryPrice != null ? t.entryPrice.toExponential(3) : "-";
    const exit = t.exitPrice != null ? t.exitPrice.toExponential(3) : "-";
    const holding = t.holdingHours != null ? `${t.holdingHours.toFixed(1)}h` : "-";
    lines.push(`| ${i + 1} | ${t.baseCoin} | ${entry} | ${exit} | ${fmtPct(t.pnlPct)} | ${t.exitReason} | ${holding} |`);
  });
  lines.push("");

  // ─── 4. 月別勝率推移 ──────────────────────────────────
  lines.push(`## 4. 月別勝率推移`);
  lines.push("");
  const byMonth = new Map<string, { trades: SimResult[]; wins: number; losses: number }>();
  for (const t of trades) {
    if (!t.entryTimeISO) continue;
    const ym = ymKey(t.entryTimeISO);
    if (!byMonth.has(ym)) byMonth.set(ym, { trades: [], wins: 0, losses: 0 });
    const m = byMonth.get(ym)!;
    m.trades.push(t);
    if (t.exitReason === "tp_hit") m.wins++;
    else if (t.exitReason === "sl_hit") m.losses++;
  }

  lines.push(`| 月 | Trades | Wins | Losses | Timeout | 実質勝率 | 平均PnL |`);
  lines.push(`|-----|--------|------|--------|---------|----------|----------|`);
  for (const ym of [...byMonth.keys()].sort()) {
    const m = byMonth.get(ym)!;
    const resolved = m.wins + m.losses;
    const wr = resolved > 0 ? `${(m.wins / resolved * 100).toFixed(1)}%` : "-";
    const tot = m.trades.reduce((s, t) => s + t.pnlPct, 0);
    const avg = m.trades.length > 0 ? tot / m.trades.length : 0;
    const tos = m.trades.length - resolved;
    lines.push(`| ${ym} | ${m.trades.length} | ${m.wins} | ${m.losses} | ${tos} | ${wr} | ${fmtPct(avg)} |`);
  }
  lines.push("");

  // ─── 5. 銘柄別パフォーマンス分布 ──────────────────────
  lines.push(`## 5. 銘柄別パフォーマンス分布`);
  lines.push("");
  const sortedByPnl = [...trades].sort((a, b) => b.pnlPct - a.pnlPct);
  const top10Pnl = sortedByPnl.slice(0, 10).reduce((s, t) => s + t.pnlPct, 0);
  const top20Pnl = sortedByPnl.slice(0, 20).reduce((s, t) => s + t.pnlPct, 0);
  const totalAllPnl = sortedByPnl.reduce((s, t) => s + t.pnlPct, 0);
  const top10Pct = totalAllPnl !== 0 ? (top10Pnl / totalAllPnl * 100).toFixed(1) : "0";
  const top20Pct = totalAllPnl !== 0 ? (top20Pnl / totalAllPnl * 100).toFixed(1) : "0";

  lines.push(`- 総PnL: ${fmtPct(totalAllPnl)}`);
  lines.push(`- TOP10銘柄が貢献: ${fmtPct(top10Pnl)} (${top10Pct}%)`);
  lines.push(`- TOP20銘柄が貢献: ${fmtPct(top20Pnl)} (${top20Pct}%)`);
  lines.push("");
  lines.push(`→ TOP10だけで総PnLの${top10Pct}%を占める場合、依存度が高く危険`);
  lines.push("");

  // ─── 6. エントリー時の上場経過時間別勝率 ──────────────
  lines.push(`## 6. エントリー時の上場経過時間別勝率`);
  lines.push("");
  const timeBuckets = [
    { name: "20-25h", min: 20, max: 25 },
    { name: "25-30h", min: 25, max: 30 },
    { name: "30-48h", min: 30, max: 48 },
    { name: "48h+",   min: 48, max: Infinity },
  ];
  lines.push(`| Bucket | Trades | Wins | Losses | 実質勝率 | 平均PnL |`);
  lines.push(`|--------|--------|------|--------|----------|----------|`);
  for (const b of timeBuckets) {
    const inBucket = trades.filter((t) => {
      const h = t.hoursAfterListing ?? 0;
      return h >= b.min && h < b.max;
    });
    const w = inBucket.filter(t => t.exitReason === "tp_hit").length;
    const l = inBucket.filter(t => t.exitReason === "sl_hit").length;
    const resolved = w + l;
    const wr = resolved > 0 ? `${(w / resolved * 100).toFixed(1)}%` : "-";
    const avg = inBucket.length > 0 ? inBucket.reduce((s, t) => s + t.pnlPct, 0) / inBucket.length : 0;
    lines.push(`| ${b.name} | ${inBucket.length} | ${w} | ${l} | ${wr} | ${fmtPct(avg)} |`);
  }
  lines.push("");

  // ─── 7. ホールド時間分布 ─────────────────────────────
  lines.push(`## 7. ホールド時間分布`);
  lines.push("");
  const holdBuckets = [
    { name: "<6h",   min: 0,   max: 6 },
    { name: "6-24h", min: 6,   max: 24 },
    { name: "1-3d",  min: 24,  max: 72 },
    { name: "3-7d",  min: 72,  max: 168 },
    { name: "7-14d", min: 168, max: 336 },
  ];
  lines.push(`| ホールド | Trades | TP | SL | TO | 平均PnL |`);
  lines.push(`|---------|--------|-----|-----|-----|----------|`);
  for (const b of holdBuckets) {
    const inBucket = trades.filter(t => {
      const h = t.holdingHours ?? 0;
      return h >= b.min && h < b.max;
    });
    const tp = inBucket.filter(t => t.exitReason === "tp_hit").length;
    const sl = inBucket.filter(t => t.exitReason === "sl_hit").length;
    const to = inBucket.filter(t => t.exitReason === "timeout").length;
    const avg = inBucket.length > 0 ? inBucket.reduce((s, t) => s + t.pnlPct, 0) / inBucket.length : 0;
    lines.push(`| ${b.name} | ${inBucket.length} | ${tp} | ${sl} | ${to} | ${fmtPct(avg)} |`);
  }
  lines.push("");

  // ─── 8. 実運用に向けた評価 ────────────────────────────
  lines.push(`## 8. 実運用に向けた評価`);
  lines.push("");
  lines.push(`### ✅ ポジティブ`);
  lines.push("");
  if (parseFloat(realWinRate) >= 55) {
    lines.push(`- 実質勝率 ${realWinRate}% は実運用に十分（目安55%+）`);
  }
  if (parseFloat(top10Pct) < 50) {
    lines.push(`- TOP10依存度 ${top10Pct}% < 50% で分散性高い`);
  }
  lines.push("");
  lines.push(`### ⚠️ 注意点`);
  lines.push("");
  if (parseFloat(resolvedRate) < 70) {
    lines.push(`- 決着率 ${resolvedRate}% < 70%、タイムアウト多発（資金拘束時間長い）`);
  }
  if (parseFloat(top10Pct) >= 50) {
    lines.push(`- TOP10銘柄依存度 ${top10Pct}% で偏り大、再現性に疑問`);
  }
  lines.push("");

  // ─── 出力 ───────────────────────────────────────────
  fs.writeFileSync(OUTPUT_MD, lines.join("\n"));

  const tradeRecords = trades.map(t => ({
    symbol: t.symbol,
    baseCoin: t.baseCoin,
    entryTimeISO: t.entryTimeISO,
    entryPrice: t.entryPrice,
    exitTimeISO: t.exitTimeISO,
    exitPrice: t.exitPrice,
    exitReason: t.exitReason,
    pnlPct: t.pnlPct,
    pnlR: t.pnlR,
    holdingHours: t.holdingHours,
    hoursAfterListing: t.hoursAfterListing,
    maxFavorablePct: t.maxFavorablePct,
    maxAdversePct: t.maxAdversePct,
  }));

  fs.writeFileSync(OUTPUT_TRADES, JSON.stringify({
    strategy: TARGET_STRATEGY,
    tpPct: TARGET_TP,
    slPct: TARGET_SL,
    generatedAt: new Date().toISOString(),
    totalTrades: tradeRecords.length,
    summary: {
      tpHits: wins.length,
      slHits: losses.length,
      timeouts: timeouts.length,
      realWinRate: parseFloat(realWinRate),
      resolvedRate: parseFloat(resolvedRate),
      avgPnl: avgPnl,
    },
    trades: tradeRecords,
  }, null, 2));

  console.log(`\n✅ Deep-dive report: ${OUTPUT_MD}`);
  console.log(`   ${(fs.statSync(OUTPUT_MD).size / 1024).toFixed(1)} KB`);
  console.log(`✅ Trades JSON:      ${OUTPUT_TRADES}`);
  console.log(`   ${(fs.statSync(OUTPUT_TRADES).size / 1024).toFixed(1)} KB`);

  console.log("");
  console.log("━".repeat(72));
  console.log(`【S01 深掘り結果サマリー】`);
  console.log("━".repeat(72));
  console.log(`総トレード:    ${trades.length}`);
  console.log(`TP hit:        ${wins.length} (${(wins.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`SL hit:        ${losses.length} (${(losses.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`Timeout:       ${timeouts.length} (${(timeouts.length / trades.length * 100).toFixed(1)}%)`);
  console.log(`実質勝率:      ${realWinRate}%`);
  console.log(`決着率:        ${resolvedRate}%`);
  console.log(`平均PnL:       ${fmtPct(avgPnl)}`);
  console.log(`TOP10依存度:   ${top10Pct}%`);
  console.log("");
  console.log("詳細: data/historical/results/S01-DEEP-DIVE.md");
}

main().catch(e => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
