"use client";
import { useState, useEffect, useCallback } from "react";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "@/app/lib/watchlist";

interface Props {
  onBatchAnalyze: (items: string[]) => void;
  onAnalyze: (query: string) => void;
}

export default function WatchList({ onBatchAnalyze, onAnalyze }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => { setItems(getWatchlist()); }, []);

  const refresh = useCallback(() => setItems(getWatchlist()), []);

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

      <div className="text-xs text-gray-400">{items.length} / 30 件登録済み</div>

      {items.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-2 text-gray-200">⭐</div>
          <p className="text-sm text-gray-400">ウォッチリストが空です<br />銘柄名やCAを追加してください</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
              <button onClick={() => moveUp(i)} className="text-gray-300 hover:text-gray-500 text-xs" title="上へ">▲</button>
              <span className="flex-1 font-mono text-sm text-gray-800 truncate">{item}</span>
              <button
                onClick={() => onAnalyze(item)}
                className="text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded px-2 py-0.5 transition-colors shrink-0"
              >
                分析
              </button>
              <button
                onClick={() => remove(item)}
                className="text-gray-400 hover:text-red-500 transition-colors text-xs px-1"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
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
