"use client";
import { useState, useEffect } from "react";

interface TrendCoin {
  id: string; name: string; symbol: string;
  market_cap_rank: number | null; thumb: string;
}

export default function TrendingCoins({ onAnalyze }: { onAnalyze: (q: string) => void }) {
  const [coins, setCoins] = useState<TrendCoin[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/search/trending");
      if (!res.ok) return;
      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCoins((data.coins ?? []).slice(0, 7).map((c: any) => c.item as TrendCoin));
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  if (coins.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
        <span>🔥</span>
        <h3 className="font-bold text-orange-800 text-sm">今日のトレンド</h3>
        {loading && <span className="ml-1 text-orange-400 text-xs">更新中...</span>}
        <span className="ml-auto text-[10px] text-gray-400">CoinGecko</span>
      </div>
      <div className="divide-y divide-gray-100">
        {coins.map((coin, i) => (
          <div key={coin.id} className="px-4 py-2 flex items-center gap-3 hover:bg-orange-50 transition-colors">
            <span className="text-xs text-gray-400 w-4 font-mono shrink-0">{i + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coin.thumb} alt={coin.symbol} width={20} height={20} className="rounded-full shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-gray-800 truncate block">{coin.name}</span>
              <span className="text-[10px] text-gray-400">#{coin.market_cap_rank ?? "?"}</span>
            </div>
            <button
              onClick={() => onAnalyze(coin.symbol)}
              className="text-[10px] bg-orange-100 hover:bg-orange-200 text-orange-700 rounded px-2 py-0.5 shrink-0 transition-colors font-medium"
            >
              分析
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
