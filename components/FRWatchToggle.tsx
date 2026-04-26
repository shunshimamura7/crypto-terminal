"use client";
import { useState, useEffect } from "react";

// Module-level cache — shared across all instances to avoid N parallel fetches
let _cachedSet: Set<string> | null = null;
let _cacheExpiry = 0;
let _pending: Promise<Set<string>> | null = null;

async function fetchWatchlistSet(): Promise<Set<string>> {
  if (_cachedSet && Date.now() < _cacheExpiry) return _cachedSet;
  if (_pending) return _pending;
  _pending = fetch("/api/fr-watchlist")
    .then((r) => r.json())
    .then((d) => {
      const s = new Set<string>((d.watchlist ?? []).map((x: string) => x.toUpperCase()));
      _cachedSet = s;
      _cacheExpiry = Date.now() + 30_000;
      _pending = null;
      return s;
    })
    .catch(() => {
      _pending = null;
      return _cachedSet ?? new Set<string>();
    });
  return _pending;
}

function invalidateCache() {
  _cachedSet = null;
  _pending = null;
}

export default function FRWatchToggle({ symbol }: { symbol: string }) {
  const [watching, setWatching] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const upper = symbol.toUpperCase();
    fetchWatchlistSet().then((s) => setWatching(s.has(upper)));
  }, [symbol]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await fetch("/api/fr-watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: watching ? "remove" : "add", symbol }),
      });
      const data = await res.json();
      if (data.ok) {
        setWatching(!watching);
        invalidateCache();
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`text-xs px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
        watching
          ? "bg-amber-50 text-amber-700 border-amber-300"
          : "bg-gray-50 text-gray-400 border-gray-200 hover:border-amber-300"
      }`}
      title={watching ? "FR監視中 — クリックで解除" : "FR監視に追加"}
    >
      {loading ? "..." : watching ? "🔔 FR監視中" : "🔕 FR監視"}
    </button>
  );
}
