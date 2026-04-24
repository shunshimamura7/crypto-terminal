"use client";
import React, { useState } from "react";
import { saveAnalysis } from "@/app/lib/analysisHistory";
import AnalysisHistoryPanel from "./AnalysisHistoryPanel";

const SECTORS = ["AI","RWA","DeFi","GameFi","DePIN","L1","L2","Meme","Privacy"];

const RANK_COLORS: Record<string, string> = {
  S: "bg-yellow-400 text-black",
  A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-gray-500 text-white",
  D: "bg-gray-700 text-white",
  E: "bg-orange-600 text-white",
  F: "bg-red-700 text-white",
};

const TABLE_RANK_COLORS: Record<string, string> = {
  S: "bg-yellow-500 text-black",
  A: "bg-green-600 text-white",
  B: "bg-blue-600 text-white",
  C: "bg-gray-600 text-white",
  D: "bg-gray-700 text-white",
  E: "bg-orange-600 text-white",
  F: "bg-red-700 text-white",
};

const PHASE_CONFIG: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  "蓄積期":   { bg: "bg-blue-50",   text: "text-blue-800",   icon: "🔵", desc: "Accumulation Phase" },
  "上昇初期":  { bg: "bg-green-50",  text: "text-green-800",  icon: "🟢", desc: "Early Bull Phase" },
  "過熱":     { bg: "bg-red-50",    text: "text-red-800",    icon: "🔴", desc: "Overheated Phase" },
  "分配期":   { bg: "bg-orange-50", text: "text-orange-800", icon: "🟠", desc: "Distribution Phase" },
  "底値圏":   { bg: "bg-gray-100",  text: "text-gray-700",   icon: "📉", desc: "Capitulation Phase" },
};

function getPhaseConfig(phase: string) {
  for (const key of Object.keys(PHASE_CONFIG)) {
    if (phase.includes(key)) return { ...PHASE_CONFIG[key], key };
  }
  return { bg: "bg-gray-700", text: "text-gray-100", icon: "📊", desc: "Phase Unknown", key: phase };
}

interface SectorGem {
  rank: number;
  ticker: string;
  alpha: number;
  risk: number;
  grade: string;
  reason: string;
}

interface SectorWarning {
  ticker: string;
  risk_reason: string;
}

interface SectorData {
  sector: string;
  phase: string;
  fear_greed_value?: number;
  fear_greed_label?: string;
  action_plan?: string;
  gems: SectorGem[];
  warnings: SectorWarning[];
}

// ─── JSON パース（複数パターン対応）
function parseSectorData(text: string): SectorData | null {
  // ```json ... ``` ブロック（改行の有無も許容）
  const codeBlock = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlock) {
    try {
      const data = JSON.parse(codeBlock[1].trim());
      if (data.phase || data.gems) return data as SectorData;
    } catch { /* fall through */ }
  }
  // 末尾の生JSONオブジェクト（gems を含む）
  const raw = text.match(/(\{[^{}]*"gems"[\s\S]*\})\s*$/);
  if (raw) {
    try {
      const data = JSON.parse(raw[1]);
      if (data.phase || data.gems) return data as SectorData;
    } catch { /* fall through */ }
  }
  return null;
}

function extractFearGreed(text: string): { value: number; label: string } | null {
  const m = text.match(/Fear\s*[&＆]\s*Greed[^:：]*[：:]\s*(\d+)\/100\s*\(([^)]+)\)/i);
  if (!m) return null;
  return { value: parseInt(m[1]), label: m[2] };
}

function fgEmoji(value: number) {
  if (value >= 75) return "🤑";
  if (value >= 55) return "😊";
  if (value >= 45) return "😐";
  if (value >= 25) return "😨";
  return "😱";
}

// ─── インラインマークダウン（**bold**）
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\*\*([^*\n]+)\*\*$/);
        return m ? <strong key={i} className="font-semibold text-gray-900">{m[1]}</strong> : (p || null);
      })}
    </>
  );
}

// ─── マークダウンテーブル
function MarkdownTable({ tableLines }: { tableLines: string[] }) {
  const parseRow = (line: string) =>
    line.split("|").map(c => c.trim()).filter(Boolean);

  const headers = parseRow(tableLines[0] ?? "");
  const dataRows = tableLines
    .slice(1)
    .filter(l => !/^\|[\s|:-]+\|$/.test(l.trim()))
    .map(parseRow)
    .filter(r => r.length > 0);

  if (headers.length === 0 || dataRows.length === 0) return null;

  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-[#f8fafc]">
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-2 text-left text-[#0ea5e9] border border-[#e2e8f0] font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-[#f8fafc]"}>
              {row.map((cell, ci) => {
                const isRank = /^[SABCDEF][+-]?$/.test(cell.trim());
                const base = cell.trim()[0];
                return (
                  <td key={ci} className="px-2 py-1.5 border border-[#e2e8f0] text-[#334155]">
                    {isRank ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded font-bold text-xs ${TABLE_RANK_COLORS[base] ?? "bg-gray-400 text-white"}`}>
                        {cell}
                      </span>
                    ) : (
                      <span>{renderInline(cell)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── セクターテキストレンダラー（見出し・テーブル・リスト・bold対応）
function SectorTextRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={elements.length} tableLines={tableLines} />);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      elements.push(
        <div key={elements.length} className="text-[#0ea5e9] font-bold text-base border-b border-[#e2e8f0] pb-1 mb-2 mt-5 first:mt-0">
          {renderInline(trimmed.slice(3))}
        </div>
      );
    } else if (trimmed.startsWith("### ")) {
      elements.push(
        <div key={elements.length} className="text-[#334155] font-semibold text-sm mb-1 mt-3">
          {renderInline(trimmed.slice(4))}
        </div>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      elements.push(
        <div key={elements.length} className="flex gap-2 text-[#334155] text-sm leading-relaxed py-0.5">
          <span className="text-[#0ea5e9] shrink-0 mt-0.5">•</span>
          <span>{renderInline(trimmed.slice(2))}</span>
        </div>
      );
    } else if (trimmed === "") {
      elements.push(<div key={elements.length} className="mb-2" />);
    } else {
      elements.push(
        <div key={elements.length} className="text-[#334155] text-sm leading-relaxed whitespace-pre-wrap">
          {renderInline(line)}
        </div>
      );
    }
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ─── 構造化UI コンポーネント群
function PhaseBanner({ sector, data, fearGreed }: {
  sector: string;
  data: SectorData;
  fearGreed: { value: number; label: string } | null;
}) {
  const cfg = getPhaseConfig(data.phase || "");
  const fgVal = data.fear_greed_value ?? fearGreed?.value;
  const fgLabel = data.fear_greed_label || fearGreed?.label;

  return (
    <div className={`rounded-lg p-4 mb-4 border ${cfg.bg}`} style={{ borderColor: "var(--border)" }}>
      <div className={`text-lg font-bold ${cfg.text} mb-0.5`}>
        {data.sector || sector} セクター
      </div>
      <div className={`flex items-center gap-2 ${cfg.text}`}>
        <span>{cfg.icon}</span>
        <span className="font-semibold">{data.phase}</span>
        <span className="text-sm">({cfg.desc})</span>
      </div>
      {fgVal != null && fgVal !== 0 && (
        <div className={`text-xs mt-1.5 ${cfg.text}`}>
          Fear &amp; Greed: {fgVal}/100 {fgEmoji(fgVal)}
          {fgLabel ? ` (${fgLabel})` : ""}
        </div>
      )}
    </div>
  );
}

function GemsTable({ gems, onAnalyze }: { gems: SectorGem[]; onAnalyze?: (ticker: string) => void }) {
  const MEDALS = ["🥇", "🥈", "🥉"];
  return (
    <div className="mb-4">
      <h3 className="text-sm font-bold text-cyan-400 mb-2">💎 Gems Top{gems.length}</h3>
      <div className="overflow-x-auto rounded-lg border border-[#e2e8f0] shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0] text-[#475569]">
              <th className="px-2 py-2 text-left font-medium w-7">#</th>
              <th className="px-2 py-2 text-left font-medium">銘柄</th>
              <th className="px-2 py-2 text-right font-medium">Alpha</th>
              <th className="px-2 py-2 text-right font-medium">Risk</th>
              <th className="px-2 py-2 text-center font-medium">Grade</th>
              <th className="px-2 py-2 text-left font-medium">根拠</th>
            </tr>
          </thead>
          <tbody>
            {gems.map((gem, i) => {
              const base = gem.grade?.charAt(0)?.toUpperCase() ?? "C";
              const cls = RANK_COLORS[base] ?? RANK_COLORS.C;
              const accentStyle: React.CSSProperties = gem.alpha >= 7
                ? { borderLeft: "3px solid #00d4ff" }
                : gem.risk >= 7
                ? { borderLeft: "3px solid #ff4466" }
                : {};
              return (
                <tr
                  key={i}
                  className="border-b border-[#e2e8f0] hover:bg-[#f0f9ff] cursor-pointer transition-colors"
                  style={accentStyle}
                  onClick={() => onAnalyze?.(gem.ticker)}
                >
                  <td className="px-2 py-2 text-center font-bold text-gray-900">
                    {i < 3 ? <span>{MEDALS[i]}</span> : <span>{gem.rank}</span>}
                  </td>
                  <td className="px-2 py-2 font-mono font-bold text-gray-900 whitespace-nowrap">{gem.ticker}</td>
                  <td className="px-2 py-2 text-right font-bold text-green-700">{gem.alpha}</td>
                  <td className="px-2 py-2 text-right font-bold text-red-600">{gem.risk}</td>
                  <td className="px-2 py-2 text-center font-bold text-gray-900">{gem.grade}</td>
                  <td className="px-2 py-2 text-gray-800 text-[11px] leading-snug">{gem.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WarningsTable({ warnings }: { warnings: SectorWarning[] }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-bold text-red-600 mb-2">⚠️ Warning Top{warnings.length}</h3>
      <div className="overflow-x-auto rounded-lg border border-[#e2e8f0] shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0] text-[#475569]">
              <th className="px-2 py-2 text-left font-medium whitespace-nowrap">銘柄</th>
              <th className="px-2 py-2 text-left font-medium">リスク理由</th>
            </tr>
          </thead>
          <tbody>
            {warnings.map((w, i) => (
              <tr key={i} className="border-b border-[#e2e8f0] hover:bg-orange-50">
                <td className="px-2 py-2 font-mono font-semibold text-orange-600 whitespace-nowrap">⚠️ {w.ticker}</td>
                <td className="px-2 py-2 text-[#475569] text-[11px] leading-snug">{w.risk_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionPlanCard({ plan }: { plan: string }) {
  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 mb-4">
      <h3 className="text-sm font-bold text-yellow-700 mb-1.5">💡 アクションプラン</h3>
      <p className="text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">{plan}</p>
    </div>
  );
}

// ─── JSON成功時: 構造化表示 + 全文トグル
function StructuredResult({ sector, data, fearGreed, rawText, onAnalyze }: {
  sector: string;
  data: SectorData;
  fearGreed: { value: number; label: string } | null;
  rawText: string;
  onAnalyze?: (ticker: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div>
      <PhaseBanner sector={sector} data={data} fearGreed={fearGreed} />
      {data.gems   && data.gems.length   > 0 && <GemsTable gems={data.gems} onAnalyze={onAnalyze} />}
      {data.warnings && data.warnings.length > 0 && <WarningsTable warnings={data.warnings} />}
      {data.action_plan && <ActionPlanCard plan={data.action_plan} />}
      <button
        onClick={() => setShowRaw(v => !v)}
        className="text-xs text-[#64748b] hover:text-[#0f172a] border border-[#e2e8f0] rounded px-2 py-1 transition-colors mb-2"
      >
        {showRaw ? "▲ 全文を隠す" : "▼ AIレスポンス全文を見る"}
      </button>
      {showRaw && (
        <div className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded max-h-[500px] overflow-y-auto">
          <SectorTextRenderer text={rawText} />
        </div>
      )}
    </div>
  );
}

// ─── JSON失敗時: リッチテキスト表示
function FallbackResult({ text }: { text: string }) {
  return (
    <div className="p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded max-h-[700px] overflow-y-auto">
      <SectorTextRenderer text={text} />
    </div>
  );
}

// ─── メインコンポーネント
export default function SectorAnalyzer({ onAnalyze }: { onAnalyze?: (ticker: string) => void }) {
  const [sector, setSector] = useState("AI");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [historyKey, setHistoryKey] = useState(0);

  async function analyze() {
    setLoading(true);
    setResult("");
    try {
      const res = await fetch("/api/sector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(`エラー: ${data.detail || data.error || `HTTP ${res.status}`}`);
      } else {
        const text = data.result || data.error || "エラー";
        setResult(text);
        saveAnalysis({ type: "sector", title: sector, summary: text.slice(0, 150), fullText: text });
        setHistoryKey(k => k + 1);
      }
    } catch (e) {
      setResult(`通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const sectorData = result ? parseSectorData(result) : null;
  const fearGreed = result
    ? (sectorData?.fear_greed_value
        ? { value: sectorData.fear_greed_value, label: sectorData.fear_greed_label ?? "" }
        : extractFearGreed(result))
    : null;

  return (
    <div className="p-4 border border-[#e2e8f0] rounded-lg bg-white shadow-sm">
      <h2 className="text-lg font-bold mb-3 text-[#0ea5e9]">🔍 セクター分析モード</h2>
      <div className="flex gap-2 mb-4 flex-wrap">
        {SECTORS.map(s => (
          <button key={s} onClick={() => setSector(s)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors border ${
              sector === s ? "bg-[#0ea5e9] text-white border-[#0ea5e9]" : "bg-[#f8fafc] text-[#475569] border-[#e2e8f0] hover:bg-sky-50 hover:text-[#0ea5e9]"
            }`}>
            {s}
          </button>
        ))}
      </div>
      <button onClick={analyze} disabled={loading}
        className="w-full py-2 bg-[#0ea5e9] hover:bg-[#0284c7] disabled:bg-[#e2e8f0] disabled:text-[#94a3b8] text-white rounded font-bold transition-colors">
        {loading ? "🔄 分析中（30〜60秒）..." : `${sector}セクターを分析`}
      </button>

      {result && (
        <div className="mt-4">
          {sectorData ? (
            <StructuredResult sector={sector} data={sectorData} fearGreed={fearGreed} rawText={result} onAnalyze={onAnalyze} />
          ) : (
            <FallbackResult text={result} />
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2 flex-wrap items-center">
        {Object.entries(RANK_COLORS).map(([rank, cls]) => (
          <span key={rank} className={`px-2 py-0.5 rounded text-xs font-bold ${cls}`}>{rank}</span>
        ))}
        <span className="text-xs text-gray-700 ml-1">← ランク凡例</span>
      </div>

      <AnalysisHistoryPanel type="sector" label="セクター分析" refreshKey={historyKey} />
    </div>
  );
}
