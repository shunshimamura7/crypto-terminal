"use client";
import React from "react";
import type { DangerZoneResult } from "@/app/lib/strategies";

export default function DangerBanner({ result }: { result: DangerZoneResult }) {
  if (result.level === "safe") return null;

  const isDanger  = result.level === "danger";
  const borderCls = isDanger ? "border-red-300 bg-red-50"     : "border-yellow-300 bg-yellow-50";
  const titleCls  = isDanger ? "text-red-700 font-bold"       : "text-yellow-800 font-bold";
  const textCls   = isDanger ? "text-red-600"                 : "text-yellow-700";
  const icon      = isDanger ? "🚨"                           : "⚠️";
  const heading   = isDanger ? "🚫 ショート停止推奨"          : "⚠️ 注意: ショート環境悪化";

  return (
    <div className={`rounded-xl border ${borderCls} px-4 py-3`}>
      <div className="flex items-start gap-2">
        <span className="text-lg shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${titleCls}`}>
            {heading}
            <span className="ml-2 font-normal text-gray-700">{result.primaryReason}</span>
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {result.details.map((d, i) => (
              <span key={i} className={`text-xs ${textCls}`}>• {d}</span>
            ))}
          </div>
          <p className={`text-xs font-semibold mt-1.5 ${titleCls}`}>{result.recommendedAction}</p>
        </div>
      </div>
    </div>
  );
}
