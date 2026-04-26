"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "@/app/lib/watchlist";
import FRWatchToggle from "@/components/FRWatchToggle";
import type { FrRateItem } from "@/app/api/fr-rates/route";
import { phaseBadgeCls } from "@/app/lib/phaseDetector";

interface Props {
  onBatchAnalyze: (items: string[]) => void;
  onAnalyze: (query: string) => void;
}

function isContractAddress(s: string): boolean {
  const t = s.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ||
    (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) && !t.startsWith("0x"));
}

function frColor(fr: number): string {
  if (fr <= -0.001)  return "text-red-600 font-bold";
  if (fr <= -0.0005) return "text-orange-500 font-bold";
  if (fr >= 0.0005)  return "text-green-600 font-bold";
  return "text-gray-400";
}

function frLabel(fr: number): string {
  const pct = fr * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(4) + "%";
}

export default function WatchList({ onBatchAnalyze, onAnalyze }: Props) {
  const [items, setItems]   = useState<string[]>([]);
  const [input, setInput]   = useState("");
  const [flash, setFlash]   = useState("");
  const [frData, setFrData] = useState<Record<string, FrRateItem | null>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setItems(getWatchlist()); }, []);

  const refresh = useCallback(() => setItems(getWatchlist()), []);

  const fetchFrRates = useCallback((symbols: string[]) => {
    const tickers = symbols.filter(s => !isContractAddress(s));
    if (tickers.length === 0) return;
    fetch(`/api/fr-rates?symbols=${tickers.join(",")}`)
      .then(r => r.json())
      .then((data: Record<string, FrRateItem | null>) => setFrData(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    fetchFrRates(items);
    timerRef.current = setInterval(() => fetchFrRates(items), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [items, fetchFrRates]);

  function add() {
    const t = input.trim();
    if (!t) return;
    const result = addToWatchlist(t);
    if (result === "exists") { setFlash("既に追加済みです"); setTimeout(() => setFlash(""), 2000); return; }
    if (result === "full")   { setFlash("上限(30件)に達しています"); setTimeout(() => setFlash(""), 2000); return; }
    refresh();
    setInput("");
  }

  function remove(item: string) {
    removeFromWatchlist(item);
    refresh();
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...items];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    localStorage.setItem("watchlist", JSON.stringify(next));
    refresh();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-yellow-600">⭐ ウォッチリスト</h2>

      {/* Add */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          placeholder="銘柄名またはコントラクトアドレスを追加"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-yellow-400 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-200 text-white rounded-lg text-sm font-bold transition-colors"
        >
          追加
        </button>
      </div>
      {flash && <p className="text-xs text-red-500">{flash}</p>}

      <div className="text-xs text-gray-700">{items.length} / 30 件登録済み</div>

      {items.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-2 text-gray-400">⭐</div>
          <p className="text-sm text-gray-700">ウォッチリストが空です<br />銘柄名やCAを追加してください</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}><ul className="space-y-2" style={{ minWidth: "280px" }}>
          {items.map((item, i) => {
            const isCa  = isContractAddress(item);
            const upper = item.toUpperCase();
            const entry = isCa ? undefined : frData[upper];
            const fr    = entry?.fr ?? null;
            const phase = entry?.phase ?? null;
            return (
              <li key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 flex-wrap">
                <button onClick={() => moveUp(i)} className="text-gray-600 hover:text-gray-500 text-xs" title="上へ">▲</button>
                <span className="font-mono text-sm text-gray-800 truncate" style={{ minWidth: 0, flex: "1 1 60px" }}>{item}</span>

                {/* Phase badge */}
                {!isCa && phase && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${phaseBadgeCls(phase.phase)}`}>
                    {phase.emoji}{phase.label}
                  </span>
                )}

                {/* FR値 */}
                {!isCa && (
                  <span className={`text-xs font-mono shrink-0 ${fr != null ? frColor(fr) : "text-gray-300"}`}>
                    {fr == null
                      ? (upper in frData ? "—" : "…")
                      : `${fr <= -0.001 ? "⛔" : ""}${frLabel(fr)}`}
                  </span>
                )}

                <button
                  onClick={() => onAnalyze(item)}
                  className="text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded px-2 py-0.5 transition-colors shrink-0"
                >
                  分析
                </button>

                {!isCa && (
                  <a
                    href={`https://www.coinglass.com/ja/currencies/${upper}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors shrink-0"
                    title={`${upper} のFR・OI・清算マップを確認`}
                  >
                    📊 FR
                  </a>
                )}

                {item.length <= 15 && !item.startsWith("0x") && (
                  <FRWatchToggle symbol={item} />
                )}

                <button
                  onClick={() => remove(item)}
                  className="text-gray-700 hover:text-red-500 transition-colors text-xs px-1 shrink-0"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul></div>
      )}

      {items.length > 0 && (
        <button
          onClick={() => onBatchAnalyze(items)}
          className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm transition-colors"
        >
          📋 ウォッチリストを一括分析（{items.length}件）
        </button>
      )}
    </div>
  );
}
