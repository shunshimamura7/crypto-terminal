"use client";
import { useState, useEffect } from "react";
import type { NewsItem } from "@/app/api/news/route";

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-green-100 text-green-700",
  negative: "bg-red-100 text-red-600",
  neutral:  "bg-gray-100 text-gray-500",
};
const SENTIMENT_LABEL: Record<string, string> = {
  positive: "↑", negative: "↓", neutral: "→",
};

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(diff)) return "";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

export default function NewsPanel({ highlightTicker = "" }: { highlightTicker?: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function load() {
    setLoading(true); setFailed(false);
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items || []);
    } catch { setFailed(true); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (failed && items.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
        <span>📰</span>
        <h3 className="font-bold text-blue-800 text-sm">最新ニュース</h3>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto text-xs border border-blue-200 rounded px-2 py-0.5 text-blue-600 hover:bg-blue-100 disabled:opacity-50"
        >
          {loading ? "⏳" : "🔄"} 更新
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: `${75 + (i % 3) * 8}%` }} />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {items.map(item => {
            const hi = highlightTicker &&
              item.title.toUpperCase().includes(highlightTicker.toUpperCase());
            return (
              <li key={item.id} className={`px-4 py-2.5 ${hi ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  <div className="flex items-start gap-1.5 mb-0.5">
                    {hi && (
                      <span className="inline-block shrink-0 text-[10px] bg-yellow-200 text-yellow-800 rounded px-1 mt-0.5">関連</span>
                    )}
                    <span className={`inline-block shrink-0 text-[10px] rounded px-1 mt-0.5 ${SENTIMENT_BADGE[item.sentiment]}`}>
                      {SENTIMENT_LABEL[item.sentiment]}
                    </span>
                    <span className="text-xs text-gray-800 leading-snug hover:text-blue-600 transition-colors line-clamp-2">
                      {item.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">{item.source}</span>
                    <span className="text-[10px] text-gray-300">{timeAgo(item.publishedAt)}</span>
                  </div>
                </a>
              </li>
            );
          })}
          {items.length === 0 && !loading && (
            <li className="px-4 py-6 text-center text-xs text-gray-400">ニュースを取得できませんでした</li>
          )}
        </ul>
      )}
    </div>
  );
}
