"use client";
import { useState, useCallback, useEffect, useRef } from "react";

export interface PortfolioResult {
  input: string;
  rank: string;
  alpha: number;
  risk: number;
  decision: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const RANK_ALLOC: Record<string, number> = { S: 15, A: 10, B: 5, C: 2, D: 0, E: 0, F: 0 };
const RANK_COLORS: Record<string, string> = {
  S: "bg-yellow-400 text-black", A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",   C: "bg-gray-400 text-white",
  D: "bg-gray-700 text-white",   E: "bg-orange-500 text-white", F: "bg-red-700 text-white",
};
const RANK_ALLOC_MID: Record<string, number> = { S: 12.5, A: 8.5, B: 4, C: 1.5 };
const RANK_RANGES: Record<string, string> = { S: "10-15%", A: "7-10%", B: "3-5%", C: "1-2%" };

const CUSTOM_KEY  = "portfolio_custom";
const HISTORY_KEY = "portfolio_history";
const MAX_HISTORY = 10;

// ─── Types ────────────────────────────────────────────────────────────────────
interface CustomItem { label: string; rank: string; }
interface HistorySnapshot { savedAt: number; items: CustomItem[]; }

interface CalcItem extends CustomItem { rawPct: number; pct: number; amount: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shortLabel(s: string): string {
  return s.length > 20 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

function loadCustom(): CustomItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as CustomItem[]) : null;
  } catch { return null; }
}
function saveCustom(items: CustomItem[] | null): void {
  if (typeof window === "undefined") return;
  try {
    if (items === null) localStorage.removeItem(CUSTOM_KEY);
    else localStorage.setItem(CUSTOM_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}
function loadHistory(): HistorySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistorySnapshot[]) : [];
  } catch { return []; }
}
function pushHistoryEntry(items: CustomItem[]): HistorySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const prev = loadHistory();
    const snap: HistorySnapshot = { savedAt: Date.now(), items: [...items] };
    const next = [snap, ...prev].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    return next;
  } catch { return []; }
}

function calcAllocItems(items: CustomItem[], totalUsd: number): CalcItem[] {
  const active = items.filter(i => (RANK_ALLOC[i.rank] ?? 0) > 0);
  const rankCount: Record<string, number> = {};
  active.forEach(i => { rankCount[i.rank] = (rankCount[i.rank] || 0) + 1; });

  const raw = active.map(i => ({
    ...i,
    rawPct: RANK_ALLOC[i.rank] / rankCount[i.rank],
  }));

  const rawTotal = raw.reduce((s, i) => s + i.rawPct, 0);
  const factor   = rawTotal > 100 ? 100 / rawTotal : 1;

  return raw.map(r => ({
    ...r,
    pct:    r.rawPct * factor,
    amount: totalUsd * (r.rawPct * factor) / 100,
  }));
}

function calcTotalAllocPct(items: CustomItem[]): number {
  const ci = calcAllocItems(items, 100);
  return ci.reduce((s, i) => s + i.pct, 0);
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderInline(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>');
}

function MarkdownText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {paragraphs.map((para, i) => {
        if (para.startsWith("### ")) return <h4 key={i} className="font-bold text-gray-900 text-sm mt-2">{para.slice(4)}</h4>;
        if (para.startsWith("## "))  return <h3 key={i} className="font-bold text-gray-900 mt-2">{para.slice(3)}</h3>;
        if (para.startsWith("# "))   return <h2 key={i} className="font-bold text-gray-900 text-base mt-2">{para.slice(2)}</h2>;
        const lines = para.split("\n");
        const hasListItem = lines.some(l => /^[-*]\s/.test(l) || /^\d+\.\s/.test(l));
        if (hasListItem) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-0.5 text-sm text-gray-700">
              {lines.filter(l => l.trim()).map((line, j) => {
                const content = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
                return <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(content) }} />;
              })}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm text-gray-700 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInline(para.replace(/\n/g, " ")) }} />
        );
      })}
    </div>
  );
}

// ─── AI Portfolio Diagnosis ───────────────────────────────────────────────────
function PortfolioDiagnosis({ results }: { results: PortfolioResult[] }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const diagnose = useCallback(async () => {
    setLoading(true);
    setText("");
    setError(null);

    const summary = results
      .map(r => `${r.input}(ランク${r.rank}/α${r.alpha.toFixed(1)}/R${r.risk.toFixed(1)}/${r.decision})`)
      .join(", ");
    const query = `ポートフォリオ診断依頼。保有銘柄: ${summary}。リスク分散・集中リスク・改善提案を日本語で詳しく診断してください。`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("レスポンスが空です");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", metaParsed = false, aiText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (!metaParsed) {
          buf += chunk;
          const nl = buf.indexOf("\n");
          if (nl !== -1) { aiText = buf.slice(nl + 1); metaParsed = true; buf = ""; }
        } else {
          aiText += chunk;
        }
        if (metaParsed && aiText) setText(aiText);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [results]);

  return (
    <div className="mt-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-sky-50 border-b border-sky-100 flex items-center gap-2">
        <span>🤖</span>
        <h3 className="font-bold text-sky-800 text-sm">AI ポートフォリオ診断</h3>
        <button onClick={diagnose} disabled={loading}
          className="ml-auto px-3 py-1 text-xs bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded font-bold transition-colors">
          {loading ? "診断中..." : "🔍 診断する"}
        </button>
      </div>
      <div className="p-4 min-h-[60px]">
        {loading && !text && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            <span>診断中...</span>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {text && <MarkdownText text={text} />}
        {!loading && !text && !error && (
          <p className="text-xs text-gray-400">ボタンを押すとAIがポートフォリオを診断します（1回の分析カウントを消費します）</p>
        )}
      </div>
    </div>
  );
}

// ─── Manual Allocation Calculator ─────────────────────────────────────────────
interface ManualHolding { symbol: string; rank: string; }

function ManualPortfolioCalc() {
  const [totalUsd, setTotalUsd]     = useState("10000");
  const [holdings, setHoldings]     = useState<ManualHolding[]>([]);
  const [newSymbol, setNewSymbol]   = useState("");
  const [newRank, setNewRank]       = useState("B");
  const [showResult, setShowResult] = useState(false);

  function add() {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setHoldings(prev => [...prev, { symbol: sym, rank: newRank }]);
    setNewSymbol("");
    setShowResult(false);
  }

  const total = parseFloat(totalUsd) || 0;
  const calcItems = holdings.map(h => {
    const pct = RANK_ALLOC_MID[h.rank] ?? 0;
    return { ...h, pct, amount: total * pct / 100 };
  });
  const allocPct = calcItems.reduce((s, i) => s + i.pct, 0);
  const allocAmt = calcItems.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="mt-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
        <span>📊</span>
        <h3 className="font-bold text-emerald-800 text-sm">適正配分の提案</h3>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.entries(RANK_RANGES) as [string, string][]).map(([rank, range]) => (
            <div key={rank} className="flex items-center gap-1.5 bg-gray-50 rounded px-2.5 py-1.5 border border-gray-100">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-black shrink-0 ${RANK_COLORS[rank]}`}>{rank}</span>
              <span className="text-xs text-gray-600">{range}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 shrink-0">総資産 (USD):</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <input type="number" min="0" value={totalUsd}
              onChange={e => { setTotalUsd(e.target.value); setShowResult(false); }}
              className="pl-6 pr-3 py-1.5 border border-gray-200 rounded text-sm w-32 focus:outline-none focus:border-emerald-400" />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <input value={newSymbol} onChange={e => setNewSymbol(e.target.value)}
            onKeyDown={e => e.key === "Enter" && add()}
            placeholder="銘柄名 (例: BTC)"
            className="flex-1 min-w-[120px] border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-400" />
          <select value={newRank} onChange={e => setNewRank(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-emerald-400">
            <option value="S">S</option><option value="A">A</option>
            <option value="B">B</option><option value="C">C</option>
          </select>
          <button onClick={add} disabled={!newSymbol.trim()}
            className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded text-sm font-bold transition-colors">
            追加
          </button>
        </div>

        {holdings.length > 0 ? (
          <ul className="space-y-1.5">
            {holdings.map((h, i) => (
              <li key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <span className="flex-1 font-mono text-sm text-gray-800 truncate">{h.symbol}</span>
                <select value={h.rank}
                  onChange={e => { setHoldings(prev => prev.map((x, j) => j === i ? { ...x, rank: e.target.value } : x)); setShowResult(false); }}
                  className="border border-gray-200 rounded px-2 py-0.5 text-xs bg-white focus:outline-none focus:border-emerald-400">
                  <option value="S">S</option><option value="A">A</option>
                  <option value="B">B</option><option value="C">C</option>
                </select>
                <button onClick={() => { setHoldings(prev => prev.filter((_, j) => j !== i)); setShowResult(false); }}
                  className="text-gray-400 hover:text-red-500 text-xs transition-colors px-1">✕</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400 text-center py-1">銘柄を追加してランクを設定してください</p>
        )}

        {holdings.length > 0 && (
          <button onClick={() => setShowResult(true)}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold transition-colors">
            配分計算
          </button>
        )}

        {showResult && calcItems.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm" style={{ minWidth: "420px" }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">ランク</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">銘柄</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">推奨範囲</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">配分%</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">金額</th>
                </tr>
              </thead>
              <tbody>
                {calcItems.map((item, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black ${RANK_COLORS[item.rank] ?? "bg-gray-200 text-gray-700"}`}>{item.rank}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-800">{item.symbol}</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">{RANK_RANGES[item.rank] ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-700">{item.pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-bold text-gray-800">
                      ${item.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-xs text-gray-600" colSpan={3}>合計</td>
                  <td className="px-3 py-2 text-right text-sm text-gray-700">{allocPct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-sm text-gray-800">
                    ${allocAmt.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-500" colSpan={3}>ステーブル/現金</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">{(100 - allocPct).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">
                    ${(total - allocAmt).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-gray-400">※ 推奨範囲の中間値を使用 (S=12.5%, A=8.5%, B=4%, C=1.5%)</p>
      </div>
    </div>
  );
}

// ─── Portfolio History ─────────────────────────────────────────────────────────
function PortfolioHistory({
  history,
  onRestore,
}: {
  history: HistorySnapshot[];
  onRestore: (snap: HistorySnapshot) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (history.length === 0) return null;

  return (
    <div className="mt-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
        <span>📋 配分履歴 <span className="text-xs font-normal text-gray-400">({history.length}件)</span></span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {history.map((snap, i) => {
            const totalPct = calcTotalAllocPct(snap.items);
            const isExp    = expanded === i;
            const dt       = new Date(snap.savedAt).toLocaleString("ja-JP", {
              month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
            });
            return (
              <div key={i}>
                <button
                  onClick={() => setExpanded(isExp ? null : i)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                >
                  <span className="text-xs text-gray-400 w-24 shrink-0">{dt}</span>
                  <span className="text-xs text-gray-700">{snap.items.length}銘柄</span>
                  <span className="text-xs text-indigo-600 font-medium">{totalPct.toFixed(1)}%配分</span>
                  <span className="ml-auto text-gray-400 text-xs">{isExp ? "▲" : "▼"}</span>
                </button>

                {isExp && (
                  <div className="px-4 pb-3 pt-1 bg-gray-50 space-y-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {snap.items.map((item, j) => (
                        <span key={j} className="flex items-center gap-1 bg-white rounded px-2 py-0.5 border border-gray-200 text-xs">
                          <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-black ${RANK_COLORS[item.rank] ?? "bg-gray-200 text-gray-700"}`}>{item.rank}</span>
                          <span className="text-gray-700">{item.label}</span>
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => { onRestore(snap); setOpen(false); }}
                      className="px-3 py-1.5 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded font-semibold transition-colors"
                    >
                      この配分を復元
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function PortfolioCalc({ results }: { results: PortfolioResult[] }) {
  const [totalUsd, setTotalUsd]       = useState("10000");
  const [customItems, setCustomItems] = useState<CustomItem[] | null>(null);
  const [history, setHistory]         = useState<HistorySnapshot[]>([]);
  const [newLabel, setNewLabel]       = useState("");
  const [newRank, setNewRank]         = useState("B");
  const [flash, setFlash]             = useState("");

  // SSR-safe mount load
  useEffect(() => {
    setCustomItems(loadCustom());
    setHistory(loadHistory());
  }, []);

  // Auto-push batch results to history when they first arrive
  const prevResultsKey = useRef("");
  useEffect(() => {
    const key = results.map(r => `${r.input}:${r.rank}`).join("|");
    if (!key || key === prevResultsKey.current) return;
    prevResultsKey.current = key;

    const batchItems = results
      .filter(r => (RANK_ALLOC[r.rank] ?? 0) > 0)
      .map(r => ({ label: shortLabel(r.input), rank: r.rank }));
    if (batchItems.length === 0) return;

    // Skip if identical to most recent history entry
    const cur  = loadHistory();
    const last = cur[0];
    const same = last &&
      last.items.length === batchItems.length &&
      last.items.every((item, i) => item.label === batchItems[i]?.label && item.rank === batchItems[i]?.rank);
    if (!same) setHistory(pushHistoryEntry(batchItems));
  }, [results]);

  // Derive items to display
  const batchItems: CustomItem[] = results
    .filter(r => (RANK_ALLOC[r.rank] ?? 0) > 0)
    .map(r => ({ label: shortLabel(r.input), rank: r.rank }));

  const isCustomized   = customItems !== null;
  const displayItems   = isCustomized ? customItems : batchItems;
  const total          = parseFloat(totalUsd) || 0;
  const allocItems     = calcAllocItems(displayItems, total);
  const allocPct       = allocItems.reduce((s, i) => s + i.pct, 0);
  const allocAmt       = allocItems.reduce((s, i) => s + i.amount, 0);

  // ── Mutations ────────────────────────────────────────────────────────────
  function mutate(next: CustomItem[]) {
    setCustomItems(next);
    saveCustom(next);
  }

  function deleteItem(i: number)              { mutate(displayItems.filter((_, j) => j !== i)); }
  function updateRank(i: number, rank: string){ mutate(displayItems.map((x, j) => j === i ? { ...x, rank } : x)); }

  function addItem() {
    const label = newLabel.trim();
    if (!label) return;
    mutate([...displayItems, { label, rank: newRank }]);
    setNewLabel("");
  }

  function resetToBatch() {
    setCustomItems(null);
    saveCustom(null);
  }

  function saveToHistory() {
    if (displayItems.length === 0) return;
    setHistory(pushHistoryEntry(displayItems));
    setFlash("保存しました ✓");
    setTimeout(() => setFlash(""), 2000);
  }

  function restoreSnapshot(snap: HistorySnapshot) {
    mutate(snap.items);
    setFlash("復元しました ✓");
    setTimeout(() => setFlash(""), 2000);
  }

  function downloadCsv() {
    const rows = [
      "ランク,銘柄,配分%,金額(USD)",
      ...allocItems.map(i => `${i.rank},${i.label},${i.pct.toFixed(1)},${i.amount.toFixed(2)}`),
      `,,合計 ${allocPct.toFixed(1)}%,${allocAmt.toFixed(2)}`,
      `,,未配分 ${(100 - allocPct).toFixed(1)}%,${(total - allocAmt).toFixed(2)}`,
    ].join("\n");
    const blob = new Blob(["﻿" + rows], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "portfolio.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* ── ① 推奨ポートフォリオ配分（編集可能） ────────────────────────── */}
      <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2 flex-wrap">
          <span>💼</span>
          <h3 className="font-bold text-indigo-800 text-sm">推奨ポートフォリオ配分</h3>
          {isCustomized && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">カスタム編集中</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {isCustomized && (
              <button onClick={resetToBatch}
                className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 hover:bg-gray-100 transition-colors">
                バッチ結果に戻す
              </button>
            )}
            <button onClick={downloadCsv}
              className="text-xs border border-indigo-200 rounded px-2 py-1 text-indigo-600 hover:bg-indigo-100 transition-colors">
              📥 CSV
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Total input */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 shrink-0">総投資額 (USD):</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-700 text-sm">$</span>
              <input type="number" min="0" value={totalUsd}
                onChange={e => setTotalUsd(e.target.value)}
                className="pl-6 pr-3 py-1.5 border border-gray-200 rounded text-sm w-32 focus:outline-none focus:border-indigo-400" />
            </div>
          </div>

          {/* Allocation table */}
          {displayItems.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-3">
              {results.length === 0
                ? "💼 バッチ分析を実行するか、下のフォームから銘柄を追加してください"
                : "💼 ランクS/A/B/C の銘柄がないため配分計算できません"}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm" style={{ minWidth: "380px" }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">ランク</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">銘柄</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">配分%</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">金額</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {allocItems.map((item, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <select value={item.rank}
                          onChange={e => updateRank(displayItems.indexOf(item), e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-indigo-400 cursor-pointer">
                          <option value="S">S</option><option value="A">A</option>
                          <option value="B">B</option><option value="C">C</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-800">{item.label}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-700">{item.pct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-800">
                        ${item.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => deleteItem(displayItems.indexOf(item))}
                          className="text-gray-400 hover:text-red-500 text-xs transition-colors" title="削除">
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-xs text-gray-600" colSpan={2}>合計</td>
                    <td className="px-3 py-2 text-right text-sm text-gray-700">{allocPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-sm text-gray-800">
                      ${allocAmt.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </td>
                    <td />
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-700" colSpan={2}>未配分（現金・安全資産）</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-700">{(100 - allocPct).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-xs text-gray-700">
                      ${(total - allocAmt).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* + 銘柄を追加 */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">＋ 銘柄を追加</p>
            <div className="flex gap-2 flex-wrap">
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addItem()}
                placeholder="銘柄名 (例: BTC)"
                className="flex-1 min-w-[120px] border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400" />
              <select value={newRank} onChange={e => setNewRank(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-indigo-400">
                <option value="S">S</option><option value="A">A</option>
                <option value="B">B</option><option value="C">C</option>
              </select>
              <button onClick={addItem} disabled={!newLabel.trim()}
                className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded text-sm font-bold transition-colors">
                追加
              </button>
            </div>
          </div>

          {/* Save + flash */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={saveToHistory} disabled={displayItems.length === 0}
              className="px-3 py-1.5 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              💾 現在の配分を保存
            </button>
            {flash && <span className="text-xs text-green-600 font-semibold animate-pulse">{flash}</span>}
          </div>

          <p className="text-[10px] text-gray-500">
            ※S複数は15%を均等分割 / 合計100%超過時は比率を正規化 / D・E・Fは0%配分
          </p>
        </div>
      </div>

      {/* ── ② 履歴 ──────────────────────────────────────────────────────── */}
      <PortfolioHistory history={history} onRestore={restoreSnapshot} />

      {/* ── AI ポートフォリオ診断 ────────────────────────────────────────── */}
      {results.length > 0 && <PortfolioDiagnosis results={results} />}

      {/* ── 適正配分の提案（手動入力） ──────────────────────────────────── */}
      <ManualPortfolioCalc />
    </div>
  );
}
