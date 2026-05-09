/**
 * Phase 0 / Step 3: 戦略シミュレーション
 *
 * 入力: data/historical/listings.json + data/historical/klines/*.json
 * 出力:
 *   data/historical/results/strategies-detail.json
 *   data/historical/results/strategies-aggregate.json
 *   data/historical/results/strategies-summary.json
 *
 * 実行: npx tsx scripts/historical-backtest/03-simulate.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { STRATEGIES } from "./lib/strategies";
import { simulateExit } from "./lib/simulator";
import type {
  SimResult,
  StrategyAggregate,
  StrategySummaryLite,
  ListingsFile,
  SymbolKlineFile,
} from "./lib/types";

const TP_PARAMS = [-10, -15, -20, -25, -30, -35, -40];
const SL_PARAMS = [5, 8, 10, 12, 15];

const ROOT = path.resolve("data/historical");
const KLINES_DIR = path.join(ROOT, "klines");
const RESULTS_DIR = path.join(ROOT, "results");
const LISTINGS_FILE = path.join(ROOT, "listings.json");

function getListingAgeBucket(daysAgo: number): keyof StrategyAggregate["byListingAge"] {
  if (daysAgo < 3) return "0-3d";
  if (daysAgo < 7) return "3-7d";
  if (daysAgo < 14) return "7-14d";
  if (daysAgo < 30) return "14-30d";
  return "30d+";
}

function emptyAgeStats() {
  return { trades: 0, wins: 0, winRate: 0, avgPnl: 0 };
}

async function main(): Promise<void> {
  const sep = "━".repeat(72);
  console.log(sep);
  console.log("Phase 0 / Step 3: 戦略シミュレーション");
  console.log(sep);

  if (!fs.existsSync(LISTINGS_FILE)) {
    console.error(`[ERROR] ${LISTINGS_FILE} not found.`);
    process.exit(1);
  }
  const listings = JSON.parse(fs.readFileSync(LISTINGS_FILE, "utf8")) as ListingsFile;
  void listings;

  const klineFiles = fs
    .readdirSync(KLINES_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  console.log(`Kline files:   ${klineFiles.length}`);
  console.log(`Strategies:    ${STRATEGIES.length}`);
  console.log(`TP params:     ${TP_PARAMS.length} (${TP_PARAMS.join(", ")})`);
  console.log(`SL params:     ${SL_PARAMS.length} (${SL_PARAMS.join(", ")})`);
  console.log(`Total sims:    ${(klineFiles.length * STRATEGIES.length * TP_PARAMS.length * SL_PARAMS.length).toLocaleString()}`);
  console.log();

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const allResults: SimResult[] = [];

  const aggBuckets = new Map<string, StrategyAggregate>();
  for (const strat of STRATEGIES) {
    for (const tp of TP_PARAMS) {
      for (const sl of SL_PARAMS) {
        const key = `${strat.id}|${tp}|${sl}`;
        aggBuckets.set(key, {
          strategyId: strat.id,
          tpPct: tp,
          slPct: sl,
          totalSymbols: 0,
          entriesTriggered: 0,
          entryRate: 0,
          trades: 0,
          wins: 0,
          losses: 0,
          timeouts: 0,
          winRate: 0,
          resolvedRate: 0,
          avgPnl: 0,
          totalPnl: 0,
          avgWinPnl: 0,
          avgLossPnl: 0,
          avgHoldingHours: 0,
          expectancy: 0,
          profitFactor: 0,
          realizedR: 0,
          byListingAge: {
            "0-3d":   emptyAgeStats(),
            "3-7d":   emptyAgeStats(),
            "7-14d":  emptyAgeStats(),
            "14-30d": emptyAgeStats(),
            "30d+":   emptyAgeStats(),
          },
        });
      }
    }
  }

  let processedSymbols = 0;
  const startedAt = Date.now();

  for (const fname of klineFiles) {
    const fpath = path.join(KLINES_DIR, fname);
    let kdata: SymbolKlineFile;
    try {
      kdata = JSON.parse(fs.readFileSync(fpath, "utf8")) as SymbolKlineFile;
    } catch {
      console.warn(`  [skip] ${fname}: parse error`);
      continue;
    }
    if (!kdata.bars || kdata.bars.length < 100) {
      continue;
    }

    const createTimeSec = Math.floor(kdata.createTime / 1000);
    const listingDaysAgo = Math.floor((Date.now() - kdata.createTime) / 86_400_000);

    for (const strat of STRATEGIES) {
      const entry = strat.detector(kdata.bars, createTimeSec);

      if (!entry) {
        for (const tp of TP_PARAMS) {
          for (const sl of SL_PARAMS) {
            const key = `${strat.id}|${tp}|${sl}`;
            aggBuckets.get(key)!.totalSymbols += 1;
          }
        }
        continue;
      }

      const hoursAfterListing = (entry.timeSec - createTimeSec) / 3600;

      for (const tp of TP_PARAMS) {
        for (const sl of SL_PARAMS) {
          const key = `${strat.id}|${tp}|${sl}`;
          const agg = aggBuckets.get(key)!;
          agg.totalSymbols += 1;
          agg.entriesTriggered += 1;

          const outcome = simulateExit(kdata.bars, entry, tp, sl);

          const result: SimResult = {
            symbol: kdata.symbol,
            baseCoin: kdata.baseCoin,
            strategyId: strat.id,
            tpPct: tp,
            slPct: sl,
            entryTriggered: true,
            entryTimeSec: entry.timeSec,
            entryTimeISO: new Date(entry.timeSec * 1000).toISOString(),
            entryPrice: entry.price,
            hoursAfterListing,
            exitReason: outcome.exitReason,
            exitTimeSec: outcome.exitTimeSec,
            exitTimeISO: new Date(outcome.exitTimeSec * 1000).toISOString(),
            exitPrice: outcome.exitPrice,
            holdingHours: outcome.holdingHours,
            pnlPct: outcome.pnlPct,
            pnlR: outcome.pnlR,
            maxFavorablePct: outcome.maxFavorablePct,
            maxAdversePct: outcome.maxAdversePct,
          };
          allResults.push(result);

          agg.trades += 1;
          agg.totalPnl += outcome.pnlPct;
          agg.avgHoldingHours += outcome.holdingHours;
          agg.realizedR += outcome.pnlR;

          if (outcome.exitReason === "tp_hit") {
            agg.wins += 1;
            agg.avgWinPnl += outcome.pnlPct;
          } else if (outcome.exitReason === "sl_hit") {
            agg.losses += 1;
            agg.avgLossPnl += outcome.pnlPct;
          } else {
            agg.timeouts += 1;
          }

          const entryDaysAfterListing = hoursAfterListing / 24;
          const ageBucket = getListingAgeBucket(entryDaysAfterListing);
          agg.byListingAge[ageBucket].trades += 1;
          if (outcome.exitReason === "tp_hit") {
            agg.byListingAge[ageBucket].wins += 1;
          }
          agg.byListingAge[ageBucket].avgPnl += outcome.pnlPct;
        }
      }
    }

    processedSymbols += 1;
    if (processedSymbols % 30 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      const pct = ((processedSymbols / klineFiles.length) * 100).toFixed(1);
      console.log(`  [${pct}%] ${processedSymbols}/${klineFiles.length} symbols processed (${elapsed}s)`);
    }
  }

  console.log("\n[Aggregating ...]");
  const aggregates: StrategyAggregate[] = [];
  for (const agg of aggBuckets.values()) {
    const resolved = agg.wins + agg.losses;
    agg.winRate = resolved > 0 ? (agg.wins / resolved) * 100 : 0;
    agg.resolvedRate = agg.trades > 0 ? (resolved / agg.trades) * 100 : 0;
    agg.entryRate = agg.totalSymbols > 0 ? (agg.entriesTriggered / agg.totalSymbols) * 100 : 0;
    agg.avgPnl = agg.trades > 0 ? agg.totalPnl / agg.trades : 0;
    agg.avgHoldingHours = agg.trades > 0 ? agg.avgHoldingHours / agg.trades : 0;
    agg.avgWinPnl = agg.wins > 0 ? agg.avgWinPnl / agg.wins : 0;
    agg.avgLossPnl = agg.losses > 0 ? agg.avgLossPnl / agg.losses : 0;

    const wp = agg.winRate / 100;
    agg.expectancy = wp * agg.avgWinPnl + (1 - wp) * agg.avgLossPnl;

    const totalGain = agg.wins * Math.abs(agg.avgWinPnl);
    const totalLoss = agg.losses * Math.abs(agg.avgLossPnl);
    agg.profitFactor = totalLoss > 0 ? totalGain / totalLoss : (totalGain > 0 ? Infinity : 0);

    for (const k of Object.keys(agg.byListingAge) as Array<keyof typeof agg.byListingAge>) {
      const b = agg.byListingAge[k];
      b.winRate = b.trades > 0 ? (b.wins / b.trades) * 100 : 0;
      b.avgPnl = b.trades > 0 ? b.avgPnl / b.trades : 0;
    }

    aggregates.push(agg);
  }

  const summaryLite: StrategySummaryLite[] = [];
  for (const strat of STRATEGIES) {
    const sAggs = aggregates.filter(a => a.strategyId === strat.id && a.trades >= 10);
    if (sAggs.length === 0) continue;
    const best = sAggs.reduce((a, b) => (a.expectancy > b.expectancy ? a : b));
    summaryLite.push({
      strategyId: strat.id,
      bestParams: { tpPct: best.tpPct, slPct: best.slPct },
      trades: best.trades,
      winRate: best.winRate,
      expectancy: best.expectancy,
      profitFactor: best.profitFactor,
      totalPnl: best.totalPnl,
    });
  }

  const detailPath = path.join(RESULTS_DIR, "strategies-detail.json");
  const aggPath = path.join(RESULTS_DIR, "strategies-aggregate.json");
  const sumPath = path.join(RESULTS_DIR, "strategies-summary.json");

  fs.writeFileSync(detailPath, JSON.stringify(allResults));
  fs.writeFileSync(aggPath, JSON.stringify(aggregates, null, 2));
  fs.writeFileSync(sumPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalSymbols: klineFiles.length,
    totalSimulations: allResults.length,
    strategies: summaryLite,
  }, null, 2));

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log();
  console.log(sep);
  console.log("Step 3 完了");
  console.log(sep);
  console.log(`処理銘柄:           ${processedSymbols}`);
  console.log(`総シミュレーション: ${allResults.length.toLocaleString()}`);
  console.log(`所要時間:           ${elapsed} 秒`);
  console.log();
  console.log(`detail.json:    ${(fs.statSync(detailPath).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`aggregate.json: ${(fs.statSync(aggPath).size / 1024).toFixed(1)} KB`);
  console.log(`summary.json:   ${(fs.statSync(sumPath).size / 1024).toFixed(1)} KB`);
  console.log();

  console.log("【戦略ベストパラメータ別ランキング（期待値順）】");
  const ranked = [...summaryLite].sort((a, b) => b.expectancy - a.expectancy);
  console.log("Rank | Strategy                  | TP    | SL  | Trades | WinRate | Expectancy | ProfitFactor");
  console.log("-----|---------------------------|-------|-----|--------|---------|------------|-------------");
  ranked.forEach((s, i) => {
    const stratName = STRATEGIES.find(st => st.id === s.strategyId)?.name ?? s.strategyId;
    console.log(
      `${String(i + 1).padStart(4)} | ` +
      `${(s.strategyId + " " + stratName).padEnd(25)} | ` +
      `${String(s.bestParams.tpPct).padStart(5)}% | ` +
      `+${String(s.bestParams.slPct).padStart(2)}% | ` +
      `${String(s.trades).padStart(6)} | ` +
      `${s.winRate.toFixed(1).padStart(6)}% | ` +
      `${s.expectancy.toFixed(2).padStart(9)}% | ` +
      `${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}`,
    );
  });

  console.log();
  console.log("Next: npx tsx scripts/historical-backtest/04-aggregate.ts");

  // 上場経過日別の勝率も出力（S01ベストパラメータ）
  const s01Best = aggregates.find(a =>
    a.strategyId === "S01" &&
    a.tpPct === (summaryLite.find(s => s.strategyId === "S01")?.bestParams.tpPct ?? -25) &&
    a.slPct === (summaryLite.find(s => s.strategyId === "S01")?.bestParams.slPct ?? 10),
  );
  if (s01Best) {
    console.log("\n【S01 ベストパラメータ: 上場経過日別勝率】");
    console.log("Bucket  | Trades | WinRate | AvgPnL");
    console.log("--------|--------|---------|-------");
    for (const k of Object.keys(s01Best.byListingAge) as Array<keyof typeof s01Best.byListingAge>) {
      const b = s01Best.byListingAge[k];
      console.log(
        `${k.padEnd(7)} | ${String(b.trades).padStart(6)} | ${b.winRate.toFixed(1).padStart(6)}% | ${b.avgPnl.toFixed(2)}%`,
      );
    }
  }
}

main().catch(e => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
