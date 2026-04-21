"use client";
import { useState, useEffect } from "react";

const COINS = [
  { id: "bitcoin",      symbol: "BTC" },
  { id: "ethereum",     symbol: "ETH" },
  { id: "solana",       symbol: "SOL" },
  { id: "binancecoin",  symbol: "BNB" },
  { id: "ripple",       symbol: "XRP" },
];

interface PriceData { symbol: string; price: number; change24h: number; }

function fmtP(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 1)    return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export default function PriceTicker() {
  const [prices, setPrices] = useState<PriceData[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");

  async function load() {
    try {
      const ids = COINS.map(c => c.id).join(",");
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
      );
      if (!res.ok) return;
      const data = await res.json();
      setPrices(COINS.map(c => ({
        symbol: c.symbol,
        price: data[c.id]?.usd ?? 0,
        change24h: data[c.id]?.usd_24h_change ?? 0,
      })).filter(p => p.price > 0));
      setUpdatedAt(new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  if (prices.length === 0) return null;

  return (
    <div className="border-b border-gray-100 bg-gray-50">
      <div className="max-w-[800px] mx-auto px-4 py-1.5 flex items-center gap-5 overflow-x-auto">
        {prices.map(p => {
          const up = p.change24h >= 0;
          return (
            <div key={p.symbol} className="flex items-center gap-1.5 shrink-0 text-xs">
              <span className="font-bold text-gray-600">{p.symbol}</span>
              <span className="font-mono text-gray-800">{fmtP(p.price)}</span>
              <span className={`font-medium ${up ? "text-green-600" : "text-red-500"}`}>
                {up ? "▲" : "▼"}{Math.abs(p.change24h).toFixed(2)}%
              </span>
            </div>
          );
        })}
        {updatedAt && <span className="text-gray-300 text-[10px] shrink-0 ml-auto">{updatedAt}</span>}
      </div>
    </div>
  );
}
