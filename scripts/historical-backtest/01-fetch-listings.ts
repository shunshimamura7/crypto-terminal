/**
 * Phase 0 / Step 1: 過去1年のMEXC新規上場銘柄リスト取得
 *
 * 実行: npx tsx scripts/historical-backtest/01-fetch-listings.ts
 * 出力: data/historical/listings.json（git管理対象）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { mexcFetch } from "./lib/mexc";
import type { MexcContractDetail, ListingRecord, ListingsFile } from "./lib/types";

const LOOKBACK_DAYS = 365;
const OUTPUT_DIR = path.resolve("data/historical");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "listings.json");

interface ContractDetailResponse {
  success: boolean;
  code: number;
  data: MexcContractDetail[];
}

async function main(): Promise<void> {
  console.log("━".repeat(60));
  console.log("Phase 0 / Step 1: MEXC 新規上場リスト取得");
  console.log("━".repeat(60));
  console.log(`Lookback: ${LOOKBACK_DAYS} days`);
  console.log(`Output:   ${OUTPUT_FILE}`);
  console.log();

  console.log("[1/3] Fetching /api/v1/contract/detail ...");
  const json = await mexcFetch<ContractDetailResponse>("/api/v1/contract/detail");

  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(`Unexpected response: success=${json.success}, code=${json.code}`);
  }

  const all = json.data;
  console.log(`  → Total contracts: ${all.length}`);

  const usdtPairs = all.filter(
    (c) => typeof c.symbol === "string" && c.symbol.endsWith("_USDT") && typeof c.createTime === "number",
  );
  console.log(`  → USDT pairs (with createTime): ${usdtPairs.length}`);

  const now = Date.now();
  const cutoff = now - LOOKBACK_DAYS * 86_400_000;

  console.log("\n[2/3] Filtering recent listings ...");
  const recent: ListingRecord[] = usdtPairs
    .filter((c) => c.createTime! >= cutoff)
    .map((c) => ({
      symbol: c.symbol,
      baseCoin: c.baseCoin ?? c.symbol.replace(/_USDT$/, ""),
      createTime: c.createTime!,
      createTimeISO: new Date(c.createTime!).toISOString(),
      listedDaysAgo: Math.floor((now - c.createTime!) / 86_400_000),
      state: c.state,
      isNew: c.isNew,
      isHot: c.isHot,
    }))
    .sort((a, b) => b.createTime - a.createTime);

  console.log(`  → Recent listings (≤${LOOKBACK_DAYS}d): ${recent.length}`);

  const byMonth: Record<string, number> = {};
  for (const r of recent) {
    const ym = r.createTimeISO.slice(0, 7);
    byMonth[ym] = (byMonth[ym] ?? 0) + 1;
  }
  console.log("\n[Monthly distribution]");
  for (const ym of Object.keys(byMonth).sort()) {
    const bar = "█".repeat(Math.min(50, byMonth[ym]));
    console.log(`  ${ym}: ${String(byMonth[ym]).padStart(3)} ${bar}`);
  }

  const byState: Record<string, number> = {};
  for (const r of recent) {
    const k = r.state?.toString() ?? "null";
    byState[k] = (byState[k] ?? 0) + 1;
  }
  console.log("\n[State distribution]");
  console.log("  (0=normal, 1=maintenance, 2=delisted, 3=pending, 4=paused)");
  for (const k of Object.keys(byState).sort()) {
    console.log(`  state=${k}: ${byState[k]}`);
  }

  console.log("\n[3/3] Writing output ...");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const output: ListingsFile = {
    fetchedAt: new Date(now).toISOString(),
    fetchedAtUnix: now,
    lookbackDays: LOOKBACK_DAYS,
    totalContracts: all.length,
    totalUsdtPairs: usdtPairs.length,
    totalRecent: recent.length,
    listings: recent,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  const sizeKb = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`  ✅ Saved: ${OUTPUT_FILE} (${sizeKb} KB)`);

  console.log("\n[Sample: 10 most recent listings]");
  for (const r of recent.slice(0, 10)) {
    const flag = r.isNew ? "🆕" : r.isHot ? "🔥" : "  ";
    console.log(
      `  ${flag} ${r.symbol.padEnd(20)} | ${r.createTimeISO} | ${String(r.listedDaysAgo).padStart(3)}d ago`,
    );
  }

  console.log("\n━".repeat(60));
  console.log(`✅ Step 1 complete. ${recent.length} listings saved.`);
  console.log("Next: npx tsx scripts/historical-backtest/02-fetch-klines.ts");
  console.log("━".repeat(60));
}

main().catch((e) => {
  console.error("\n[FATAL]", e);
  process.exit(1);
});
