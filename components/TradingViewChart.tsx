"use client";

import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
}

export default function TradingViewChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previous widget
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Asia/Tokyo",
      theme: "light",
      style: "1",
      locale: "ja",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      container_id: "tv_chart_inner",
    });
    container.appendChild(script);

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
      style={{ borderLeft: "4px solid #0891b2" }}
    >
      <div className="px-4 py-2.5 bg-cyan-50 flex items-center gap-2">
        <span className="text-base">📈</span>
        <h3 className="font-semibold text-gray-800 text-sm">チャート</h3>
        <span className="ml-auto text-xs text-gray-400">{symbol} · 日足 · TradingView</span>
      </div>
      <div id="tv_chart_inner" ref={containerRef} style={{ height: "420px" }} />
    </div>
  );
}
