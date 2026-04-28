"use client";
import React, { useState, useEffect } from "react";

interface FngData { value: number; valueText: string }
interface MarketData {
  btcPrice: number; btcChange24h: number;
  ethPrice: number; ethChange24h: number;
  fng: FngData | null;
  btcDominance: number | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
}

function calcShortEnv(fng: number | null, btcChange: number) {
  if (btcChange <= -5) return { label: "危険",  icon: "🔴", cls: "text-red-600",    detail: "BTC急落中。全体リスクオフ" };
  if (btcChange >= 5)  return { label: "注意",  icon: "🟠", cls: "text-orange-500", detail: "BTC急騰中。アルト連動上昇でショート逆風" };
  if (fng !== null) {
    if (fng <= 24) return { label: "危険",  icon: "🔴", cls: "text-red-600",    detail: "Extreme Fear。パニック相場、ボラ大きすぎ" };
    if (fng <= 49) return { label: "注意",  icon: "🟠", cls: "text-orange-500", detail: "Fear相場。スクイーズリスクあり" };
    if (fng >= 75) return { label: "良好",  icon: "🟢", cls: "text-green-600",  detail: "Greed過熱 × BTC安定。アルトショートに有利" };
    return           { label: "普通",  icon: "🟡", cls: "text-yellow-600",  detail: "普通の相場環境" };
  }
  return               { label: "普通",  icon: "🟡", cls: "text-yellow-600",  detail: "データ不足" };
}

const FNG_COLOR: Record<string, string> = {
  "Extreme Fear": "text-red-600", "Fear": "text-orange-500",
  "Neutral": "text-yellow-600", "Greed": "text-green-600", "Extreme Greed": "text-emerald-600",
};

export default function MarketEnvironmentPanel({ cgApiKey }: { cgApiKey?: string }) {
  const [open, setOpen] = useState(true);
  const [md, setMd]     = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([
      // サーバーサイドプロキシ経由（CORS回避）
      fetch("/api/market-env").then(r => r.json()).catch(() => null),
      // CoinGecko global（APIキーがあれば）
      cgApiKey
        ? fetch(`https://api.coingecko.com/api/v3/global?x_cg_demo_api_key=${cgApiKey}`)
            .then(r => r.json()).catch(() => null)
        : Promise.resolve(null),
    ]).then(([envRes, cgRes]) => {
      if (cancelled) return;

      const env = envRes.status === "fulfilled" ? envRes.value : null;
      let btcDominance: number | null = null;
      if (cgRes?.status === "fulfilled" && cgRes.value?.data?.market_cap_percentage?.btc != null) {
        btcDominance = cgRes.value.data.market_cap_percentage.btc;
      }

      if (env) {
        setMd({
          btcPrice: env.btcPrice ?? 0,
          btcChange24h: env.btcChange24h ?? 0,
          ethPrice: env.ethPrice ?? 0,
          ethChange24h: env.ethChange24h ?? 0,
          fng: env.fng ?? null,
          btcDominance,
          sentimentScore: env.sentimentScore ?? null,
          sentimentLabel: env.sentimentLabel ?? null,
        });
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [cgApiKey]);

  const env = md ? calcShortEnv(md.fng?.value ?? null, md.btcChange24h) : null;
  const fmtP = (n: number) => n ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
  const fmtC = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>📊 市場環境</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1">
          {loading && !md && (
            <div className="flex items-center gap-2 py-3 text-xs text-gray-400">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-indigo-400 rounded-full animate-spin" />
              市場データ取得中...
            </div>
          )}

          {md && env && (
            <div className={`grid gap-3 text-xs ${md.sentimentScore != null ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4"}`}>
              {/* BTC */}
              <div className="bg-orange-50 rounded-lg p-3 border border-orange-100">
                <div className="text-gray-500 font-semibold mb-0.5">₿ BTC</div>
                <div className="font-mono font-bold text-gray-800 text-sm md:text-base">{fmtP(md.btcPrice)}</div>
                <div className={`font-semibold text-xs mt-0.5 ${md.btcChange24h >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {fmtC(md.btcChange24h)} 24h
                </div>
              </div>

              {/* ETH */}
              <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
                <div className="text-gray-500 font-semibold mb-0.5">Ξ ETH</div>
                <div className="font-mono font-bold text-gray-800 text-sm md:text-base">{fmtP(md.ethPrice)}</div>
                <div className={`font-semibold text-xs mt-0.5 ${md.ethChange24h >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {fmtC(md.ethChange24h)} 24h
                </div>
              </div>

              {/* F&G */}
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                <div className="text-gray-500 font-semibold mb-0.5">Fear &amp; Greed</div>
                {md.fng ? (
                  <>
                    <div className={`font-bold text-sm md:text-base ${FNG_COLOR[md.fng.valueText] ?? "text-gray-800"}`}>
                      {md.fng.value}{" "}
                      <span className="text-xs font-semibold">{md.fng.valueText}</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${md.fng.value}%`,
                        background: md.fng.value >= 75 ? "#16a34a" : md.fng.value >= 50 ? "#ca8a04" : md.fng.value >= 25 ? "#ea580c" : "#dc2626",
                      }} />
                    </div>
                  </>
                ) : <div className="text-gray-400 text-xs">取得中...</div>}
              </div>

              {/* News Sentiment */}
              {md.sentimentScore != null && (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="text-gray-500 font-semibold mb-0.5">📰 センチメント</div>
                  <div className={`font-bold text-sm ${
                    md.sentimentScore >= 70 ? "text-green-600" :
                    md.sentimentScore >= 40 ? "text-yellow-600" : "text-red-600"
                  }`}>
                    {md.sentimentScore}%
                    <span className="text-xs font-semibold ml-1">{md.sentimentLabel}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${md.sentimentScore}%`,
                      background: md.sentimentScore >= 70 ? "#16a34a" : md.sentimentScore >= 40 ? "#ca8a04" : "#dc2626",
                    }} />
                  </div>
                </div>
              )}

              {/* 環境判定 */}
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                {md.btcDominance != null && (
                  <div className="text-gray-500 text-xs mb-1">
                    BTCドミ: <span className="font-bold text-gray-700">{md.btcDominance.toFixed(1)}%</span>
                  </div>
                )}
                <div className="text-gray-500 text-xs mb-0.5">ショート環境</div>
                <div className={`font-bold text-sm md:text-base ${env.cls}`}>
                  {env.icon} {env.label}
                </div>
                <div className="text-gray-500 mt-0.5 text-[10px] leading-tight">{env.detail}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
