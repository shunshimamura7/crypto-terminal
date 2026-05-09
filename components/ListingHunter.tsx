"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { ListingHunterCandidate, ListingHunterResponse } from "@/app/api/listing-hunter/route";
import {
  getOpenRecords,
  saveHunterRecord,
  isAutoRecordEnabled,
  setAutoRecordEnabled,
  type HunterRecord,
} from "@/app/lib/listingHunterRecords";

const MEXC_REF = process.env.NEXT_PUBLIC_MEXC_REFERRAL_CODE ?? "";

function mexcUrl(symbol: string): string {
  const base = symbol.replace(/_USDT$/, "");
  const ref = MEXC_REF ? `?inviteCode=${MEXC_REF}` : "";
  return `https://www.mexc.com/futures/${base}_USDT${ref}`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPrice(n: number): string {
  if (n < 0.001) return n.toExponential(3);
  if (n < 1) return n.toFixed(5);
  if (n < 100) return n.toFixed(3);
  return n.toFixed(2);
}

function fmtFr(fr: number): string {
  return `${(fr * 100).toFixed(4)}%`;
}

function CategoryBadge({ category }: { category: ListingHunterCandidate["category"] }) {
  const styles: Record<ListingHunterCandidate["category"], string> = {
    "entry-window": "bg-emerald-100 text-emerald-700 border-emerald-300",
    "sub-window":   "bg-sky-100 text-sky-700 border-sky-300",
    "approaching":  "bg-amber-100 text-amber-700 border-amber-300",
    "expired":      "bg-gray-100 text-gray-500 border-gray-300",
  };
  const labels: Record<ListingHunterCandidate["category"], string> = {
    "entry-window": "✅ エントリー推奨",
    "sub-window":   "🎯 サブ枠",
    "approaching":  "⏳ もうすぐ",
    "expired":      "⏰ 期限切れ",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-bold ${styles[category]}`}>
      {labels[category]}
    </span>
  );
}

function CandidateCard({
  c,
  isRecorded,
  onRecord,
}: {
  c: ListingHunterCandidate;
  isRecorded?: boolean;
  onRecord?: (c: ListingHunterCandidate) => void;
}) {
  const isMain = c.category === "entry-window";

  const warningIcons: string[] = [];
  if (c.warnings.lowVolume) warningIcons.push("💧 流動性低");
  if (c.warnings.lowOI) warningIcons.push("📉 OI不足");
  if (c.warnings.negativeFR) warningIcons.push("🔻 逆FR");
  if (c.warnings.extremePump) warningIcons.push("🚀 急騰中");

  return (
    <div
      className={`
        rounded-xl border-2 p-4 transition-all
        ${isMain
          ? "border-emerald-400 bg-emerald-50/30 dark:border-emerald-600 dark:bg-emerald-950/20 shadow-md"
          : c.category === "sub-window"
            ? "border-sky-300 bg-sky-50/20 dark:border-sky-700 dark:bg-sky-950/10"
            : c.category === "approaching"
              ? "border-amber-300 bg-amber-50/20 dark:border-amber-700 dark:bg-amber-950/10"
              : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/30 opacity-60"}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a
              href={mexcUrl(c.symbol)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-black text-gray-900 dark:text-gray-50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              {c.baseCoin}
            </a>
            <CategoryBadge category={c.category} />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            上場 {c.hoursSinceListing}h 経過
            {c.hoursUntilEntry !== null && c.hoursUntilEntry > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 font-semibold">
                · あと {c.hoursUntilEntry.toFixed(1)}h でエントリー
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRecord && (
            <button
              onClick={() => onRecord(c)}
              disabled={isRecorded}
              className={`text-xs px-2 py-1 rounded-lg border font-semibold transition-colors ${
                isRecorded
                  ? "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                  : "bg-white dark:bg-gray-800 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950"
              }`}
            >
              {isRecorded ? "✓ 記録済み" : "📝 記録"}
            </button>
          )}
          <a
            href={mexcUrl(c.symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
          >
            MEXC ↗
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
        <div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">現在価格</div>
          <div className="font-bold text-gray-900 dark:text-gray-100">${fmtPrice(c.currentPrice)}</div>
          <div className={`text-[11px] ${c.priceChange24h >= 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {c.priceChange24h >= 0 ? "+" : ""}{c.priceChange24h.toFixed(1)}% (24h)
          </div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">TP -10%</div>
          <div className="font-bold text-emerald-600 dark:text-emerald-400">${fmtPrice(c.tradeSetup.tpPrice)}</div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500">利確目標</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">SL +18%</div>
          <div className="font-bold text-rose-600 dark:text-rose-400">${fmtPrice(c.tradeSetup.slPrice)}</div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500">損切り</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs border-t border-gray-200 dark:border-gray-700 pt-3">
        <div>
          <div className="text-gray-500 dark:text-gray-400">24h Vol</div>
          <div className="font-semibold text-gray-700 dark:text-gray-300">{fmtUsd(c.vol24hUsd)}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400">OI</div>
          <div className="font-semibold text-gray-700 dark:text-gray-300">{fmtUsd(c.openInterestUsd)}</div>
        </div>
        <div>
          <div className="text-gray-500 dark:text-gray-400">FR (8h)</div>
          <div className={`font-semibold ${c.fundingRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {fmtFr(c.fundingRate)}
          </div>
        </div>
      </div>

      {warningIcons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {warningIcons.map((w, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 text-[11px] font-semibold border border-orange-200 dark:border-orange-800">
              {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ListingHunter() {
  const [data, setData] = useState<ListingHunterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState<number>(0);

  // 記録機構の状態
  const [recordedSymbols, setRecordedSymbols] = useState<Set<string>>(new Set());
  const [autoRecord, setAutoRecord] = useState(false);
  const [toast, setToast] = useState("");

  // マウント時に既存のopenレコードを読み込む
  useEffect(() => {
    const openRecords = getOpenRecords();
    setRecordedSymbols(new Set(openRecords.map(r => r.symbol)));
    setAutoRecord(isAutoRecordEnabled());
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/listing-hunter", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ListingHunterResponse = await res.json();
      if (!json.success) throw new Error(json.error ?? "Unknown error");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (autoRefresh <= 0) return;
    const id = setInterval(() => fetchData(), autoRefresh * 60 * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData]);

  // 全件自動記録: entry-window / sub-window の新規検出銘柄を自動保存
  useEffect(() => {
    if (!data || !autoRecord) return;
    const openSymbols = new Set(getOpenRecords().map(r => r.symbol));
    const newCandidates = data.candidates.filter(
      c =>
        (c.category === "entry-window" || c.category === "sub-window") &&
        !openSymbols.has(c.symbol),
    );
    if (newCandidates.length === 0) return;

    const now = new Date();
    for (const c of newCandidates) {
      const entryAt = now.toISOString();
      const deadline = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const record: HunterRecord = {
        id: `${c.symbol}-${entryAt}`,
        symbol: c.symbol,
        entryAt,
        entryPrice: c.currentPrice,
        listingAt: c.listedAt,
        hoursSinceListing: c.hoursSinceListing,
        tpPrice: c.tradeSetup.tpPrice,
        slPrice: c.tradeSetup.slPrice,
        deadline,
        status: "open",
        priceHistory: [],
        recordedManually: false,
        version: "hunter22h-v1",
      };
      saveHunterRecord(record);
    }
    setRecordedSymbols(new Set(getOpenRecords().map(r => r.symbol)));
  }, [data, autoRecord]);

  const handleRecord = useCallback((c: ListingHunterCandidate) => {
    const now = new Date();
    const entryAt = now.toISOString();
    const deadline = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const record: HunterRecord = {
      id: `${c.symbol}-${entryAt}`,
      symbol: c.symbol,
      entryAt,
      entryPrice: c.currentPrice,
      listingAt: c.listedAt,
      hoursSinceListing: c.hoursSinceListing,
      tpPrice: c.tradeSetup.tpPrice,
      slPrice: c.tradeSetup.slPrice,
      deadline,
      status: "open",
      priceHistory: [],
      recordedManually: true,
      version: "hunter22h-v1",
    };
    saveHunterRecord(record);
    setRecordedSymbols(prev => new Set([...prev, c.symbol]));
    setToast(`記録しました: ${c.baseCoin}`);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const handleAutoRecordToggle = useCallback(() => {
    const next = !autoRecord;
    setAutoRecord(next);
    setAutoRecordEnabled(next);
  }, [autoRecord]);

  const entryWindow = data?.candidates.filter(c => c.category === "entry-window") ?? [];
  const subWindow   = data?.candidates.filter(c => c.category === "sub-window")   ?? [];
  const approaching = data?.candidates.filter(c => c.category === "approaching")  ?? [];
  const expired     = data?.candidates.filter(c => c.category === "expired")      ?? [];

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 animate-in fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-50 mb-1">🎯 22hハンター</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              MEXC新規上場 22h時点ショート戦略 (S01-listing+22h)
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              バックテスト勝率{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">68.1%</strong> ·
              期待値{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">+1.06%</strong>/トレード ·
              対象 214銘柄（STOCK除外）
            </p>
          </div>

          <div className="flex flex-col gap-2 items-end text-xs">
            {/* 全件自動記録トグル */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">⚙️ 全件自動記録:</span>
              <button
                onClick={handleAutoRecordToggle}
                className={`px-2.5 py-1 rounded-lg border font-bold transition-colors ${
                  autoRecord
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                }`}
              >
                {autoRecord ? "ON" : "OFF"}
              </button>
            </div>

            {/* 自動更新 + 更新ボタン */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">自動更新:</span>
              {([0, 1, 5] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setAutoRefresh(m)}
                  className={`px-2.5 py-1 rounded-lg border transition-colors ${
                    autoRefresh === m
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {m === 0 ? "OFF" : `${m}分`}
                </button>
              ))}
              <button
                onClick={fetchData}
                disabled={loading}
                className="ml-2 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50 transition-colors"
              >
                {loading ? "⏳" : "🔄 更新"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            { label: "エントリー", value: "上場後 22h ±2h", color: "text-gray-900 dark:text-gray-100" },
            { label: "TP",         value: "-10%",            color: "text-emerald-600 dark:text-emerald-400" },
            { label: "SL",         value: "+18%",            color: "text-rose-600 dark:text-rose-400" },
            { label: "最大ホールド", value: "14日",           color: "text-gray-900 dark:text-gray-100" },
          ].map(item => (
            <div key={item.label} className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
              <div className="text-gray-500 dark:text-gray-400">{item.label}</div>
              <div className={`font-bold ${item.color}`}>{item.value}</div>
            </div>
          ))}
        </div>

        {data && (
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            最終更新: {new Date(data.scanTime).toLocaleString("ja-JP")} ·
            検出: 推奨{data.meta.inEntryWindow} / サブ{data.meta.inSubWindow} / 監視中{data.meta.approaching} / 期限切れ{data.meta.expired}
            {data.meta.excludedStocks > 0 && (
              <span className="ml-2 text-gray-400">
                · 株先物除外: {data.meta.excludedStocks}件
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          ❌ {error}
        </div>
      )}

      {/* Entry window */}
      <section>
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <span className="text-emerald-600">✅</span>
          エントリー推奨（20-24h、{entryWindow.length}件）
          <span className="text-xs font-normal text-gray-400 dark:text-gray-500">最も期待値が高いゾーン</span>
        </h3>
        {entryWindow.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4 text-center">
            該当する銘柄なし。「もうすぐ」セクションをチェック。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {entryWindow.map(c => (
              <CandidateCard
                key={c.symbol}
                c={c}
                isRecorded={recordedSymbols.has(c.symbol)}
                onRecord={handleRecord}
              />
            ))}
          </div>
        )}
      </section>

      {/* Sub window */}
      {subWindow.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <span className="text-sky-600">🎯</span>
            サブ枠（26-30h、{subWindow.length}件）
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">勝率65.8%、まだ有効</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {subWindow.map(c => (
              <CandidateCard
                key={c.symbol}
                c={c}
                isRecorded={recordedSymbols.has(c.symbol)}
                onRecord={handleRecord}
              />
            ))}
          </div>
        </section>
      )}

      {/* Approaching */}
      {approaching.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <span className="text-amber-600">⏳</span>
            もうすぐエントリー（{approaching.length}件）
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {approaching.map(c => (
              <CandidateCard
                key={c.symbol}
                c={c}
                isRecorded={recordedSymbols.has(c.symbol)}
                onRecord={handleRecord}
              />
            ))}
          </div>
        </section>
      )}

      {/* Expired */}
      {expired.length > 0 && (
        <section>
          <details>
            <summary className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
              ⏰ 期限切れ ({expired.length}件) — 32h超え、見送り推奨
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {expired.map(c => (
                <CandidateCard
                  key={c.symbol}
                  c={c}
                  isRecorded={recordedSymbols.has(c.symbol)}
                  onRecord={handleRecord}
                />
              ))}
            </div>
          </details>
        </section>
      )}

      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 text-xs text-amber-800 dark:text-amber-300">
        <strong>⚠️ 重要:</strong> バックテスト結果は過去365日（BTC強気相場期間中心）に基づく。
        実運用ではスリッページ・FRコストで-2〜-3%の差し引きを想定。
        連敗3〜5回は普通に起こり得るためポジションサイズは保守的に。
      </div>
    </div>
  );
}
