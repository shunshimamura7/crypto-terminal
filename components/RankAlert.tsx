"use client";
import { useEffect, useState } from "react";
import type { RankChange } from "@/app/lib/scoreHistory";

export default function RankAlert({ change }: { change: RankChange | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (change) {
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 6000);
      return () => clearTimeout(t);
    }
  }, [change]);

  if (!visible || !change) return null;

  const isUp = change.direction === "up";
  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white font-bold text-sm ${
      isUp ? "bg-green-600" : "bg-red-600"
    }`}>
      {isUp ? "🚀" : "⚠️"} {change.ticker}: {change.from} → {change.to}
      {change.alphaDelta !== 0 && (
        <span className="ml-2 text-xs">
          Alpha {change.alphaDelta > 0 ? "+" : ""}{change.alphaDelta}
        </span>
      )}
      <button onClick={() => setVisible(false)} className="ml-3 hover:opacity-70">×</button>
    </div>
  );
}
