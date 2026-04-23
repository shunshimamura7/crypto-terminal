"use client";

import { useState } from "react";

interface HolderData {
  rank:         number;
  address:      string;
  label:        string | null;
  balance:      number;
  chainPercent: number;
  totalPercent: number;
  isCex:        boolean;
}

interface ChainData {
  chain:              string;
  contractAddress:    string;
  totalSupplyOnChain: number;
  holders:            HolderData[];
  error?:             string;
}

interface Warning {
  level:   "info" | "warning" | "danger";
  message: string;
}

interface AnalysisResult {
  chains:           ChainData[];
  grandTotalSupply: number;
  top2Percent:      number;
  warnings:         Warning[];
}

const CHAIN_OPTIONS = [
  { id: "ethereum", label: "Ethereum" },
  { id: "bsc",      label: "BSC"      },
  { id: "base",     label: "Base"     },
  { id: "arbitrum", label: "Arbitrum" },
  { id: "optimism", label: "Optimism" },
  { id: "polygon",  label: "Polygon"  },
];

const WARNING_STYLES: Record<string, string> = {
  info:    "bg-blue-950 border-blue-700 text-blue-200",
  warning: "bg-yellow-950 border-yellow-700 text-yellow-200",
  danger:  "bg-red-950 border-red-700 text-red-200",
};

const EXPLORERS: Record<string, string> = {
  ethereum: "https://etherscan.io/address",
  bsc:      "https://bscscan.com/address",
  base:     "https://basescan.org/address",
  arbitrum: "https://arbiscan.io/address",
  optimism: "https://optimistic.etherscan.io/address",
  polygon:  "https://polygonscan.com/address",
};

const CHAIN_ACCENT: Record<string, string> = {
  ethereum: "#627eea",
  bsc:      "#f3ba2f",
  base:     "#0052ff",
  arbitrum: "#28a0f0",
  optimism: "#ff0420",
  polygon:  "#8247e5",
};

function fmtNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function HolderAnalysis() {
  const [entries, setEntries] = useState([{ chain: "bsc", address: "" }]);
  const [result,  setResult]  = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  function addChain() {
    setEntries(prev => [...prev, { chain: "ethereum", address: "" }]);
  }
  function updateEntry(i: number, key: "chain" | "address", val: string) {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [key]: val } : e));
  }
  function removeEntry(i: number) {
    setEntries(prev => prev.filter((_, idx) => idx !== i));
  }

  async function analyze() {
    const valid = entries.filter(e => e.address.trim());
    if (valid.length === 0) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/holders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chains: valid.map(e => ({ chain: e.chain, address: e.address.trim() })) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header card */}
      <div className="rounded-xl bg-gray-900 text-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">🔍 ホルダー集中度分析</h2>
          <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">Moralis API</span>
        </div>
        <p className="text-xs text-gray-400">
          複数チェーンのTop 20 Holdersを取得し、チェーン上の%と総供給に対する本当の%を比較します。
          無料枠: 40,000 req/月 —{" "}
          <a href="https://moralis.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
            moralis.io
          </a>
          でAPIキーを取得してください。
        </p>

        {/* Inputs */}
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select
                value={entry.chain}
                onChange={e => updateEntry(i, "chain", e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-white shrink-0"
                style={{ width: "108px" }}
              >
                {CHAIN_OPTIONS.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={entry.address}
                onChange={e => updateEntry(i, "address", e.target.value)}
                onKeyDown={e => e.key === "Enter" && analyze()}
                placeholder="コントラクトアドレス 0x..."
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-xs font-mono text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              />
              {entries.length > 1 && (
                <button onClick={() => removeEntry(i)} className="text-gray-500 hover:text-red-400 text-sm transition-colors">✕</button>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={addChain}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            + チェーン追加
          </button>
          <button
            onClick={analyze}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg px-4 py-1.5 text-xs font-bold text-white transition-colors"
          >
            {loading ? "取得中..." : "分析する"}
          </button>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>

      {/* Warnings */}
      {result?.warnings.map((w, i) => (
        <div key={i} className={`border rounded-xl px-4 py-3 text-sm ${WARNING_STYLES[w.level]}`}>
          {w.message}
        </div>
      ))}

      {/* Summary */}
      {result && (
        <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between text-sm">
          <span className="text-gray-400">全チェーン合計総供給量</span>
          <span className="font-bold">{fmtNum(result.grandTotalSupply)} tokens</span>
        </div>
      )}

      {/* Chain tables */}
      {result?.chains.map(chainData => (
        <div key={chainData.chain} className="bg-gray-900 text-white rounded-xl overflow-hidden border border-gray-700">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHAIN_ACCENT[chainData.chain] ?? "#64748b" }} />
              <span className="font-bold text-sm capitalize">{chainData.chain}</span>
            </div>
            <span className="text-gray-400 text-xs">
              流通量: {fmtNum(chainData.totalSupplyOnChain)}
            </span>
          </div>

          {chainData.error ? (
            <div className="px-4 py-3 text-red-400 text-sm">{chainData.error}</div>
          ) : chainData.holders.length === 0 ? (
            <div className="px-4 py-3 text-gray-500 text-sm">データなし</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: "520px" }}>
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-700">
                    <th className="px-4 py-2 text-left w-8">#</th>
                    <th className="px-4 py-2 text-left">アドレス</th>
                    <th className="px-4 py-2 text-right">残高</th>
                    <th className="px-4 py-2 text-right">チェーン上%</th>
                    <th className="px-4 py-2 text-right" style={{ color: "#facc15" }}>総供給%</th>
                  </tr>
                </thead>
                <tbody>
                  {chainData.holders.map(h => (
                    <tr key={h.address} className="border-b border-gray-800 hover:bg-gray-800/60 transition-colors">
                      <td className="px-4 py-2 text-gray-500 text-xs">{h.rank}</td>
                      <td className="px-4 py-2">
                        {h.label ? (
                          <a
                            href={`${EXPLORERS[chainData.chain]}/${h.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-green-900 text-green-300 border border-green-700 hover:bg-green-800 transition-colors">
                              🏛️ {h.label}
                            </span>
                          </a>
                        ) : (
                          <a
                            href={`${EXPLORERS[chainData.chain]}/${h.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-gray-300 hover:text-blue-400 underline underline-offset-2 transition-colors"
                          >
                            {h.address.slice(0, 8)}…{h.address.slice(-6)}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">
                        {fmtNum(h.balance)}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-400">
                        {h.chainPercent.toFixed(2)}%
                      </td>
                      <td className={`px-4 py-2 text-right text-xs font-bold ${
                        h.totalPercent > 20 ? "text-red-400" :
                        h.totalPercent > 10 ? "text-yellow-400" :
                        "text-white"
                      }`}>
                        {h.totalPercent.toFixed(2)}%
                        {h.totalPercent > 20 && " 🚨"}
                        {h.totalPercent > 10 && h.totalPercent <= 20 && " ⚠️"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
