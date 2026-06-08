"use client";

import { useEffect, useState } from "react";
import { judgeMarketRegime, MarketRegime, MarketRegimeResult } from "@/app/lib/marketRegime";

interface EtfFlowData {
  last3dSum: number | null;
  latestDate: string | null;
  trend: "outflow" | "inflow" | "mixed" | null;
}

interface DominanceData {
  dominance: number | null;
  dominanceDelta7d: number | null;
}

interface Props {
  onRegimeChange?: (regime: MarketRegime) => void;
  onMarketEnvChange?: (data: { fearGreed: number; bondYield10y?: number; etfFlow3dSum?: number }) => void;
}

export default function MarketRegimeBanner({ onRegimeChange, onMarketEnvChange }: Props = {}) {
  const [result, setResult] = useState<MarketRegimeResult | null>(null);
  const [etfFlow, setEtfFlow] = useState<EtfFlowData | null | undefined>(undefined);
  const [dominance, setDominance] = useState<DominanceData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/market-env", { signal: AbortSignal.timeout(5000) })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/etf-flow", { signal: AbortSignal.timeout(12000) })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/btc-dominance", { signal: AbortSignal.timeout(12000) })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([marketEnv, etfData, domData]) => {
      if (cancelled) return;
      if (!marketEnv) return;
      const btcChange24h: number = marketEnv.btcChange24h ?? 0;
      const fearGreed: number | null = marketEnv.fng?.value ?? null;
      if (fearGreed === null) return;
      const bondYield10y: number | undefined =
        typeof marketEnv.us10y === "number" ? marketEnv.us10y : undefined;

      const etfFlow3dSum: number | undefined =
        etfData?.last3dSum != null ? etfData.last3dSum : undefined;

      const btcDominanceDelta: number | undefined =
        domData?.dominanceDelta7d != null ? domData.dominanceDelta7d : undefined;

      setEtfFlow(etfData?.last3dSum != null
        ? { last3dSum: etfData.last3dSum, latestDate: etfData.latestDate ?? null, trend: etfData.trend ?? null }
        : null
      );

      setDominance(domData?.dominance != null || domData?.dominanceDelta7d != null
        ? { dominance: domData.dominance ?? null, dominanceDelta7d: domData.dominanceDelta7d ?? null }
        : null
      );

      const r = judgeMarketRegime({ btcChange24h, fearGreed, bondYield10y, etfFlow3dSum, btcDominanceDelta });
      setResult(r);
      onRegimeChange?.(r.regime);
      onMarketEnvChange?.({ fearGreed, bondYield10y, etfFlow3dSum });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return null;

  const styles = {
    shortFavorable: {
      bar: "border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-700",
      icon: "🟢",
      label: "ショート好機",
      textColor: "text-green-800 dark:text-green-300",
      subColor: "text-green-700 dark:text-green-400",
    },
    neutral: {
      bar: "border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-700",
      icon: "🟡",
      label: "中立",
      textColor: "text-blue-800 dark:text-blue-300",
      subColor: "text-blue-700 dark:text-blue-400",
    },
    shortDangerous: {
      bar: "border-red-400 bg-red-50 dark:bg-red-950/30 dark:border-red-700",
      icon: "🚨",
      label: "ショート警戒",
      textColor: "text-red-800 dark:text-red-300",
      subColor: "text-red-700 dark:text-red-400",
    },
  } as const;

  const s = styles[result.regime];

  return (
    <div className={`border-l-4 ${s.bar} px-4 py-3 rounded-r-lg`}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none mt-0.5">{s.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${s.textColor}`}>
            市況: {s.label} — {result.recommendedAction}
          </div>
          <div className={`text-[11px] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 ${s.subColor}`}>
            {result.reasons.map((r, i) => (
              <span key={i}>• {r}</span>
            ))}
          </div>
          {/* ETFフロー表示 */}
          <div className="text-[11px] mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>
              {etfFlow === undefined && (
                <span className="text-gray-400 dark:text-gray-500">ETF: 取得中...</span>
              )}
              {etfFlow === null && (
                <span className="text-gray-400 dark:text-gray-500 opacity-60">ETF: 取得失敗</span>
              )}
              {etfFlow != null && etfFlow.last3dSum !== null && (
                <span className={
                  etfFlow.trend === "outflow"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : etfFlow.trend === "inflow"
                      ? "text-rose-700 dark:text-rose-400"
                      : "text-gray-600 dark:text-gray-400"
                }>
                  ₿ETF 3日計: {etfFlow.last3dSum >= 0 ? "+" : ""}{etfFlow.last3dSum.toFixed(0)}M$
                  {etfFlow.trend === "outflow" && " (流出 ショート追い風)"}
                  {etfFlow.trend === "inflow" && " (流入 ショート警戒)"}
                  {etfFlow.trend === "mixed" && " (混合)"}
                  {etfFlow.latestDate && <span className="opacity-60 ml-1">({etfFlow.latestDate}時点)</span>}
                </span>
              )}
            </span>
            {/* BTC.D 表示 */}
            <span>
              {dominance === undefined && (
                <span className="text-gray-400 dark:text-gray-500">BTC.D: 取得中...</span>
              )}
              {dominance === null && (
                <span className="text-gray-400 dark:text-gray-500 opacity-60">BTC.D: 取得失敗</span>
              )}
              {dominance != null && (
                <span className={
                  dominance.dominanceDelta7d != null && dominance.dominanceDelta7d >= 1.5
                    ? "text-emerald-700 dark:text-emerald-400"
                    : dominance.dominanceDelta7d != null && dominance.dominanceDelta7d <= -1.5
                      ? "text-rose-700 dark:text-rose-400"
                      : "text-gray-600 dark:text-gray-400"
                }>
                  BTC.D: {dominance.dominance != null ? `${dominance.dominance.toFixed(1)}%` : "—"}
                  {dominance.dominanceDelta7d != null && (
                    <span className="ml-1">
                      (7日 {dominance.dominanceDelta7d >= 0 ? "+" : ""}{dominance.dominanceDelta7d.toFixed(1)}pt
                      {dominance.dominanceDelta7d >= 1.5 && " ショート追い風"}
                      {dominance.dominanceDelta7d <= -1.5 && " ショート危険"})
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
