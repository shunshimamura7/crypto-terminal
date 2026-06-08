"use client";

import { useEffect, useState } from "react";
import { judgeMarketRegime, MarketRegimeResult } from "@/app/lib/marketRegime";

export default function MarketRegimeBanner() {
  const [result, setResult] = useState<MarketRegimeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market-env", { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        const btcChange24h: number = data.btcChange24h ?? 0;
        const fearGreed: number | null = data.fng?.value ?? null;
        if (fearGreed === null) return;
        const bondYield10y: number | undefined =
          typeof data.us10y === "number" ? data.us10y : undefined;
        setResult(judgeMarketRegime({ btcChange24h, fearGreed, bondYield10y }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
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
        </div>
      </div>
    </div>
  );
}
