"use client";
import { useState, useEffect } from "react";

interface FngEntry { value: string; value_classification: string; }

function getEmoji(v: number) {
  if (v <= 25) return "😱";
  if (v <= 45) return "😨";
  if (v <= 55) return "😐";
  if (v <= 75) return "😊";
  return "🤑";
}
function getColor(v: number) {
  if (v <= 25) return "text-red-600 bg-red-50 border-red-200";
  if (v <= 45) return "text-orange-600 bg-orange-50 border-orange-200";
  if (v <= 55) return "text-yellow-600 bg-yellow-50 border-yellow-200";
  if (v <= 75) return "text-green-600 bg-green-50 border-green-200";
  return "text-yellow-500 bg-yellow-50 border-yellow-200";
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 48, H = 16;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FearGreedGauge() {
  const [data, setData] = useState<FngEntry[]>([]);

  useEffect(() => {
    fetch("https://api.alternative.me/fng/?limit=7")
      .then(r => r.json())
      .then(j => { if (Array.isArray(j.data)) setData(j.data); })
      .catch(() => {});
  }, []);

  if (data.length === 0) return null;

  const val = parseInt(data[0].value);
  const colorCls = getColor(val);
  const sparkValues = [...data].reverse().map(d => parseInt(d.value));

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${colorCls}`}
      title={`Fear & Greed Index: ${val} - ${data[0].value_classification}`}
    >
      <span>{getEmoji(val)}</span>
      <span className="font-bold">{val}</span>
      <span className="hidden sm:inline">{data[0].value_classification}</span>
      <span className="hidden sm:inline">
        <Sparkline values={sparkValues} />
      </span>
    </div>
  );
}
