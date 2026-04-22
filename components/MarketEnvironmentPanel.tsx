"use client";
import React, { useState, useEffect } from "react";

interface FngData {
  value: number;
  valueText: string;
}

interface MarketData {
  btcPrice: number;
  btcChange24h: number;
  ethPrice: number;
  ethChange24h: number;
  fng: FngData | null;
  btcDominance: number | null;  // CoinGecko global
}

// 判定ロジック
function calcShortEnv(fng: number | null, btcChange: number): {
  label: string;
  icon: string;
  className: string;
  detail: string;
} {
  if (btcChange <= -5) return { label: "危険", icon: "🔴", className: "text-red-600", detail: "BTC急落中。全体リスクオフ、ショートも危険" };
  if (btcChange >= 5)  return { label: "注意", icon: "🟠", className: "text-orange-500", detail: "BTC急騰中。アルトも連動上昇しやすい、ショート逆風" };
  if (fng !== null) {
    if (fng <= 24) return { label: "危険", icon: "🔴", className: "text-red-600", detail: "Extreme Fear。パニック相場、ボラ大きすぎ" };
    if (fng <= 49) return { label: "注意", icon: "🟠", className: "text-orange-500", detail: "Fear相場。ショートスクイーズリスクあり" };
    if (fng >= 75) return { label: "良好", icon: "🟢", className: "text-green-600", detail: "Greed過熱 × BTC安定。アルト資金抜けやすくショートに有利" };
    return { label: "普通", icon: "🟡", className: "text-yellow-600", detail: "普通の相場環境" };
  }
  return { label: "普通", icon: "🟡", className: "text-yellow-600", detail: "データ不足" };
}

const FNG_COLOR: Record<string, string> = {
  "Extreme Fear": "text-red-600",
  "Fear":         "text-orange-500",
  "Neutral":      "text-yellow-600",
  "Greed":        "text-green-600",
  "Extreme Greed":"text-emerald-600",
};

export default function MarketEnvironmentPanel({ cgApiKey }: { cgApiKey?: string }) {
  const [open, setOpen] = useState(true);
  const [md, setMd]     = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([
      // BTC/ETH from MEXC ticker (複数 symbol を1回で取得)
      fetch("https://contract.mexc.com/api/v1/contract/ticker")
        .then(r => r.json())
        .catch(() => null),
      // Fear & Greed
      fetch("https://api.alternative.me/fng/")
        .then(r => r.json())
        .catch(() => null),
      // CoinGecko global (BTCドミナンス) — APIキーがあれば
      cgApiKey
        ? fetch(`https://api.coingecko.com/api/v3/global?x_cg_demo_api_key=${cgApiKey}`)
            .then(r => r.json())
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([tickerRes, fngRes, cgGlobalRes]) => {
      if (cancelled) return;

      // ticker parse
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tickers: any[] = tickerRes.status === "fulfilled" ? (tickerRes.value?.data ?? []) : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const btcTicker = tickers.find((t: any) => t.symbol === "BTC_USDT");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ethTicker = tickers.find((t: any) => t.symbol === "ETH_USDT");

      const btcPrice   = parseFloat(btcTicker?.lastPrice  || "0");
      const btcChange  = parseFloat(btcTicker?.riseFallRate || "0") * 100;
      const ethPrice   = parseFloat(ethTicker?.lastPrice  || "0");
      const ethChange  = parseFloat(ethTicker?.riseFallRate || "0") * 100;

      // F&G
      let fng: FngData | null = null;
      if (fngRes.status === "fulfilled" && fngRes.value?.data?.[0]) {
        const d = fngRes.value.data[0];
        fng = { value: parseInt(d.value, 10), valueText: d.value_classification };
      }

      // CoinGecko global
      let btcDominance: number | null = null;
      if (cgGlobalRes?.status === "fulfilled" && cgGlobalRes.value?.data?.market_cap_percentage?.btc != null) {
        btcDominance = cgGlobalRes.value.data.market_cap_percentage.btc;
      }

      setMd({ btcPrice, btcChange24h: btcChange, ethPrice, ethChange24h: ethChange, fng, btcDominance });
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [cgApiKey]);

  const env = md ? calcShortEnv(md.fng?.value ?? null, md.btcChange24h) : null;

  function fmtPrice(n: number) {
    if (!n) return "—";
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  function fmtPct(n: number) {
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span>📊 市場環境</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1">
          {loading && !md && (
            <p className="text-xs text-gray-400 py-2">データ取得中...</p>
          )}

          {md && env && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              {/* BTC */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500 mb-0.5">BTC</div>
                <div className="font-mono font-bold text-gray-800 text-base">{fmtPrice(md.btcPrice)}</div>
                <div className={`font-semibold ${md.btcChange24h >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {fmtPct(md.btcChange24h)} 24h
                </div>
              </div>

              {/* ETH */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500 mb-0.5">ETH</div>
                <div className="font-mono font-bold text-gray-800 text-base">{fmtPrice(md.ethPrice)}</div>
                <div className={`font-semibold ${md.ethChange24h >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {fmtPct(md.ethChange24h)} 24h
                </div>
              </div>

              {/* Fear & Greed */}
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500 mb-0.5">Fear &amp; Greed</div>
                {md.fng ? (
                  <>
                    <div className={`font-bold text-base ${FNG_COLOR[md.fng.valueText] ?? "text-gray-800"}`}>
                      {md.fng.value} <span className="text-sm font-semibold">{md.fng.valueText}</span>
                    </div>
                    {/* Mini gauge */}
                    <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${md.fng.value}%`,
                          background: md.fng.value >= 75 ? "#16a34a" : md.fng.value >= 50 ? "#ca8a04" : md.fng.value >= 25 ? "#ea580c" : "#dc2626",
                        }}
                      />
                    </div>
                  </>
                ) : <div className="text-gray-400">N/A</div>}
              </div>

              {/* BTCドミナンス + ショート環境 */}
              <div className="bg-gray-50 rounded-lg p-3">
                {md.btcDominance != null && (
                  <div className="mb-1">
                    <span className="text-gray-500">BTCドミナンス: </span>
                    <span className="font-bold text-gray-700">{md.btcDominance.toFixed(1)}%</span>
                  </div>
                )}
                <div className="text-gray-500 mb-0.5">ショート環境</div>
                <div className={`font-bold text-base ${env.className}`}>
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
