/**
 * Phase 0 / Step 2: 各銘柄のMin15 Kline 全期間取得
 *
 * 実行方法:
 *   PoC モード（上場後30日分のみ、~1-2分）:
 *     npx tsx scripts/historical-backtest/02-fetch-klines.ts --poc
 *
 *   本番モード（上場時刻〜現在の全期間、~15-30分）:
 *     npx tsx scripts/historical-backtest/02-fetch-klines.ts
 *
 *   リトライモード（_failed.json に記録された失敗銘柄のみ再取得）:
 *     npx tsx scripts/historical-backtest/02-fetch-klines.ts --retry-failed
 *
 * 出力:
 *   data/historical/klines/{SYMBOL}_USDT.json （個別銘柄）
 *   data/historical/klines/_failed.json       （失敗ログ）
 *   data/historical/klines/_progress.json     （途中再開用、随時更新）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fetchKlineRange, sleep, type KlineBar } from "./lib/mexc";
import type { ListingRecord, ListingsFile, SymbolKlineFile, FetchFailureRecord } from "./lib/types";

// ─── 設定 ────────────────────────────────────────────────────────
const INTERVAL = "Min15" as const;
const BARS_PER_REQUEST = 2000;
const MIN15_SEC = 15 * 60;
const SEC_PER_REQUEST = BARS_PER_REQUEST * MIN15_SEC; // 約20.8日

const CONCURRENCY = 3;
const DELAY_BETWEEN_BATCHES_MS = 1000;
const DELAY_BETWEEN_REQUESTS_MS = 200;

const POC_DAYS = 30;

// ─── パス ────────────────────────────────────────────────────────
const ROOT = path.resolve("data/historical");
const LISTINGS_FILE = path.join(ROOT, "listings.json");
const KLINES_DIR = path.join(ROOT, "klines");
const FAILED_FILE = path.join(KLINES_DIR, "_failed.json");
const PROGRESS_FILE = path.join(KLINES_DIR, "_progress.json");

// ─── 引数パース ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const isPoC = args.includes("--poc");
const isRetryFailed = args.includes("--retry-failed");

// ─── 進捗管理 ────────────────────────────────────────────────────
interface ProgressState {
  startedAt: string;
  mode: "poc" | "full" | "retry";
  totalSymbols: number;
  completedSymbols: string[];
  failedSymbols: string[];
}

function loadProgress(): ProgressState | null {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")) as ProgressState;
  } catch {
    return null;
  }
}

function saveProgress(p: ProgressState): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function loadFailures(): FetchFailureRecord[] {
  if (!fs.existsSync(FAILED_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FAILED_FILE, "utf8")) as FetchFailureRecord[];
  } catch {
    return [];
  }
}

function saveFailures(failures: FetchFailureRecord[]): void {
  fs.writeFileSync(FAILED_FILE, JSON.stringify(failures, null, 2));
}

// ─── 1銘柄分の取得処理 ─────────────────────────────────────────────
async function fetchSymbolKlines(
  listing: ListingRecord,
  startSec: number,
  endSec: number,
): Promise<{ ok: true; bars: KlineBar[] } | { ok: false; error: string }> {
  const allBars: KlineBar[] = [];

  let cursor = startSec;
  let chunkIdx = 0;

  while (cursor < endSec) {
    const chunkEnd = Math.min(cursor + SEC_PER_REQUEST, endSec);

    try {
      const bars = await fetchKlineRange(listing.symbol, INTERVAL, cursor, chunkEnd);

      if (bars.length === 0) {
        if (chunkIdx === 0) {
          return { ok: false, error: "Empty response on first chunk" };
        }
        break;
      }

      allBars.push(...bars);

      const lastBarSec = bars[bars.length - 1][0];
      if (lastBarSec >= chunkEnd - MIN15_SEC * 2) {
        cursor = lastBarSec + MIN15_SEC;
      } else {
        break;
      }

      chunkIdx++;
      if (cursor < endSec) {
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const seen = new Set<number>();
  const dedup: KlineBar[] = [];
  for (const bar of allBars) {
    if (!seen.has(bar[0])) {
      seen.add(bar[0]);
      dedup.push(bar);
    }
  }
  dedup.sort((a, b) => a[0] - b[0]);

  return { ok: true, bars: dedup };
}

// ─── メイン処理 ───────────────────────────────────────────────────
async function main(): Promise<void> {
  const sep = "━".repeat(72);
  console.log(sep);
  console.log("Phase 0 / Step 2: ヒストリカルKline取得 (Min15)");
  console.log(sep);
  console.log(`Mode:        ${isRetryFailed ? "retry-failed" : isPoC ? "PoC (30 days)" : "FULL"}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Output:      ${KLINES_DIR}`);
  console.log();

  if (!fs.existsSync(LISTINGS_FILE)) {
    console.error(`[ERROR] ${LISTINGS_FILE} が見つかりません。`);
    console.error(`Step 1 を先に実行してください: npx tsx scripts/historical-backtest/01-fetch-listings.ts`);
    process.exit(1);
  }

  const listingsData = JSON.parse(fs.readFileSync(LISTINGS_FILE, "utf8")) as ListingsFile;
  let targets: ListingRecord[] = listingsData.listings;

  fs.mkdirSync(KLINES_DIR, { recursive: true });

  if (isRetryFailed) {
    const failures = loadFailures();
    const failedSymbols = new Set(failures.map(f => f.symbol));
    targets = targets.filter(t => failedSymbols.has(t.symbol));
    console.log(`[Retry mode] ${targets.length} symbols to retry`);
    if (targets.length === 0) {
      console.log("リトライ対象なし。終了。");
      return;
    }
  }

  const existingFiles = new Set(
    fs.readdirSync(KLINES_DIR).filter(f => f.endsWith(".json") && !f.startsWith("_")),
  );
  const initialCount = targets.length;
  targets = targets.filter(t => !existingFiles.has(`${t.symbol}.json`));
  const skippedCount = initialCount - targets.length;
  if (skippedCount > 0) {
    console.log(`[Skip] ${skippedCount} symbols already fetched (skipping)`);
  }

  if (targets.length === 0) {
    console.log("\n✅ 全銘柄取得済み。終了。");
    return;
  }

  console.log(`\n[Targets] ${targets.length} symbols to fetch\n`);

  const progress: ProgressState = loadProgress() ?? {
    startedAt: new Date().toISOString(),
    mode: isRetryFailed ? "retry" : isPoC ? "poc" : "full",
    totalSymbols: targets.length + skippedCount,
    completedSymbols: [...existingFiles].map(f => f.replace(".json", "")),
    failedSymbols: [],
  };

  const failures = loadFailures();
  const failedSet = new Set(failures.map(f => f.symbol));

  const startedAt = Date.now();
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchStart = Date.now();

    const results = await Promise.all(
      batch.map(async (listing) => {
        const startSec = Math.floor(listing.createTime / 1000);
        const endSec = isPoC
          ? Math.min(startSec + POC_DAYS * 86_400, Math.floor(Date.now() / 1000))
          : Math.floor(Date.now() / 1000);

        const result = await fetchSymbolKlines(listing, startSec, endSec);

        if (result.ok && result.bars.length > 0) {
          const file: SymbolKlineFile = {
            symbol: listing.symbol,
            baseCoin: listing.baseCoin,
            interval: INTERVAL,
            createTime: listing.createTime,
            createTimeISO: listing.createTimeISO,
            rangeStartSec: startSec,
            rangeEndSec: endSec,
            fetchedAt: new Date().toISOString(),
            fetchedAtUnix: Date.now(),
            totalBars: result.bars.length,
            durationDays: Math.round((endSec - startSec) / 86_400 * 10) / 10,
            bars: result.bars,
          };

          const outPath = path.join(KLINES_DIR, `${listing.symbol}.json`);
          fs.writeFileSync(outPath, JSON.stringify(file));

          return { listing, ok: true as const, bars: result.bars.length };
        } else {
          const errMsg = result.ok ? "Empty data" : result.error;
          return { listing, ok: false as const, error: errMsg };
        }
      }),
    );

    for (const r of results) {
      if (r.ok) {
        completed++;
        progress.completedSymbols.push(r.listing.symbol);

        const pct = ((completed + skippedCount) / progress.totalSymbols * 100).toFixed(1);
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(
          `  ✓ ${r.listing.symbol.padEnd(20)} ${String(r.bars).padStart(5)} bars  ` +
          `[${completed}/${targets.length}, ${pct}%, ${elapsed}s]`,
        );
      } else {
        failed++;
        if (!failedSet.has(r.listing.symbol)) {
          failures.push({
            symbol: r.listing.symbol,
            reason: "fetch_failed",
            attemptedAt: new Date().toISOString(),
            errorMessage: r.error,
          });
          failedSet.add(r.listing.symbol);
        }
        progress.failedSymbols.push(r.listing.symbol);
        console.log(`  ✗ ${r.listing.symbol.padEnd(20)} FAILED: ${r.error}`);
      }
    }

    saveProgress(progress);
    saveFailures(failures);

    if (i + CONCURRENCY < targets.length) {
      const batchElapsed = Date.now() - batchStart;
      const wait = Math.max(0, DELAY_BETWEEN_BATCHES_MS - batchElapsed);
      if (wait > 0) await sleep(wait);
    }
  }

  const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log();
  console.log(sep);
  console.log("Step 2 完了");
  console.log(sep);
  console.log(`成功:        ${completed} 銘柄`);
  console.log(`失敗:        ${failed} 銘柄`);
  console.log(`スキップ:    ${skippedCount} 銘柄（既取得）`);
  console.log(`所要時間:    ${totalElapsed} 秒`);

  if (failures.length > 0) {
    console.log(`\n失敗銘柄ログ: ${FAILED_FILE}`);
    console.log("リトライ: npx tsx scripts/historical-backtest/02-fetch-klines.ts --retry-failed");
  }

  if (completed > 0) {
    const allFiles = fs.readdirSync(KLINES_DIR).filter(f => f.endsWith(".json") && !f.startsWith("_"));
    let allSize = 0;
    let allBars = 0;
    const sampleFiles = allFiles.slice(0, 5);

    console.log("\nサンプルファイル:");
    for (const f of sampleFiles) {
      const fp = path.join(KLINES_DIR, f);
      const stat = fs.statSync(fp);
      const data = JSON.parse(fs.readFileSync(fp, "utf8")) as SymbolKlineFile;
      console.log(
        `  ${f.padEnd(25)} ${String(data.totalBars).padStart(6)} bars  ` +
        `${(stat.size / 1024).toFixed(1).padStart(7)} KB  ` +
        `${data.durationDays}d`,
      );
    }

    for (const f of allFiles) {
      const fp = path.join(KLINES_DIR, f);
      allSize += fs.statSync(fp).size;
      try {
        const d = JSON.parse(fs.readFileSync(fp, "utf8")) as SymbolKlineFile;
        allBars += d.totalBars;
      } catch { /* skip unreadable */ }
    }
    console.log(`\n全銘柄合計: ${allFiles.length} files, ${allBars.toLocaleString()} bars, ${(allSize / 1024 / 1024).toFixed(1)} MB`);
  }

  console.log("\nNext: npx tsx scripts/historical-backtest/03-simulate.ts");
  console.log(sep);
}

main().catch(e => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
