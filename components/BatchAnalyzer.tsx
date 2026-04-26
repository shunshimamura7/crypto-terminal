"use client";
import { useState, useMemo, useEffect } from "react";
import PortfolioCalc from "./PortfolioCalc";
import { addToWatchlist, isInWatchlist } from "@/app/lib/watchlist";
import FRWatchToggle from "@/components/FRWatchToggle";

type InputKind = "ticker" | "evm" | "solana" | "ton" | "sui" | "tron" | "invalid";

const SAMPLE_INPUTS = `BTC
ETH
SOL
0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN
AVAX
LINK
0xc944e90c64b2c07662a292be6244bdf05cda44a7
BNB
UNI`;

function classifyInput(line: string): InputKind {
  const t = line.trim();
  if (!t) return "invalid";
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return "sui";
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return "evm";
  if (/^T[0-9A-Za-z]{33}$/.test(t)) return "tron";
  if (/^[0-9A-Za-z_-]{48}$/.test(t)) return "ton";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) && !/^0x/.test(t)) return "solana";
  if (t.length <= 20) return "ticker";
  return "invalid";
}

const KIND_BADGE: Record<InputKind, { label: string; cls: string }> = {
  ticker:  { label: "銘柄名",         cls: "bg-blue-100 text-blue-800 border-blue-200"          },
  evm:     { label: "EVMアドレス",    cls: "bg-purple-100 text-purple-800 border-purple-200"    },
  solana:  { label: "Solanaアドレス", cls: "bg-green-100 text-green-800 border-green-200"       },
  ton:     { label: "TONアドレス",    cls: "bg-cyan-100 text-cyan-800 border-cyan-200"          },
  sui:     { label: "SUIアドレス",    cls: "bg-indigo-100 text-indigo-800 border-indigo-200"    },
  tron:    { label: "TRONアドレス",   cls: "bg-orange-100 text-orange-800 border-orange-200"    },
  invalid: { label: "無効",           cls: "bg-red-100 text-red-800 border-red-200"             },
};

const RANK_COLORS: Record<string, string> = {
  S: "bg-yellow-400 text-black",
  A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-gray-500 text-white",
  D: "bg-gray-700 text-white",
  E: "bg-orange-600 text-white",
  F: "bg-red-700 text-white",
};

function shortenCA(ca: string): string {
  if (ca.length <= 13) return ca;
  return `${ca.slice(0, 6)}...${ca.slice(-4)}`;
}

interface BatchResult {
  input: string;
  type: InputKind;
  chain: string;
  rank: string;
  alpha: number;
  risk: number;
  smart_money_score_100?: number;
  smart_money?: number;
  decision: string;
  one_line_reason: string;
  // New fields
  fundingRate?: number | null;
  openInterest?: number | null;
  longRatio?: number | null;
  xheatScore?: number | null;
  etfBtcDirection?: "in" | "out" | null;
  etfBtcFlow?: number | null;
  unlockDays?: number | null;
  unlockPercent?: number | null;
  arkhamEntity?: string | null;
  isInstitutional?: boolean;
}

function FrBadge({ fr }: { fr: number }) {
  const pct = fr * 100;
  const hot = pct > 0.1;
  const neg = pct < 0;
  const cls = hot
    ? "bg-red-100 text-red-700 border-red-300"
    : neg
    ? "bg-blue-100 text-blue-700 border-blue-300"
    : "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border font-mono ${cls}`}>
      FR:{pct >= 0 ? "+" : ""}{pct.toFixed(3)}%
    </span>
  );
}

function OiBadge({ oi }: { oi: number }) {
  const fmt = oi >= 1e9
    ? `$${(oi / 1e9).toFixed(1)}B`
    : `$${(oi / 1e6).toFixed(0)}M`;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-purple-50 text-purple-700 border-purple-200 font-mono">
      OI:{fmt}
    </span>
  );
}

function XHeatBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-red-500" :
    score >= 50 ? "bg-orange-400" :
    score >= 30 ? "bg-yellow-400" : "bg-gray-300";
  const label =
    score >= 80 ? "過熱" :
    score >= 60 ? "高温" :
    score >= 40 ? "普通" :
    score >= 20 ? "低温" : "冷却";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-gray-600 w-8 text-right">{score}</span>
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  );
}

export default function BatchAnalyzer({ prefillText = "" }: { prefillText?: string }) {
  const [text, setText]       = useState(prefillText);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [error, setError]     = useState("");
  const [selected, setSelected] = useState<BatchResult | null>(null);
  const [watchStates, setWatchStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (prefillText) setText(prefillText);
  }, [prefillText]);

  useEffect(() => {
    if (results.length === 0) return;
    const states: Record<string, boolean> = {};
    results.forEach(r => { states[r.input] = isInWatchlist(r.input); });
    setWatchStates(states);
  }, [results]);

  const parsed = useMemo(() =>
    text.split("\n")
      .map(l => l.trim())
      .filter(l => l)
      .slice(0, 20)
      .map(l => ({ input: l, kind: classifyInput(l) }))
  , [text]);

  const validCount = parsed.filter(p => p.kind !== "invalid").length;

  async function analyze() {
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: parsed.filter(p => p.kind !== "invalid").map(p => p.input) }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setResults(data.results || []);
        try { localStorage.setItem("lastBatchResults", JSON.stringify(data.results || [])); } catch { /* ignore */ }
      }
    } catch {
      setError("通信エラー");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-purple-600">🔎 バッチ分析モード</h2>

      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label className="text-sm font-medium text-gray-700">
            銘柄 / コントラクトアドレス
          </label>
          <button
            onClick={() => setText(SAMPLE_INPUTS)}
            className="text-xs text-purple-600 hover:text-purple-800 border border-purple-200 rounded px-2 py-0.5 transition-colors"
          >
            サンプルを入力
          </button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder={`銘柄名・CAを1行1つで入力（最大20個）\n例：\nBTC\nSOL\n0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9\nJUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN`}
          className="w-full rounded-lg border border-gray-200 p-3 text-sm font-mono focus:border-purple-400 focus:outline-none resize-none"
        />
      </div>

      {parsed.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <div className="text-xs font-semibold text-gray-700 mb-2">
            入力プレビュー（{parsed.length}件 / 有効: {validCount}件）
          </div>
          <div className="flex flex-wrap gap-2">
            {parsed.map((p, i) => {
              const cfg = KIND_BADGE[p.kind];
              const label = p.kind === "evm" || p.kind === "solana"
                ? shortenCA(p.input)
                : p.input.toUpperCase();
              return (
                <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg.cls}`}>
                  <span className="font-semibold">{label}</span>
                  <span className="text-gray-700">{cfg.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={analyze}
        disabled={loading || validCount === 0}
        className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-300 text-white rounded-lg font-bold transition-colors"
      >
        {loading
          ? `🔄 分析中（${validCount}件）...`
          : `${validCount}件を一括分析`}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm" style={{ minWidth: "700px" }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200" style={{ whiteSpace: "nowrap" }}>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">ランク</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">銘柄/CA</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">種別</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">チェーン</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Alpha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Risk</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">SM</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">指標</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">投資判断</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">W / FR</th>
              </tr>
            </thead>
            <tbody>
              {[...results]
                .sort((a, b) => "SABCDEF".indexOf(a.rank) - "SABCDEF".indexOf(b.rank))
                .map((r, i) => {
                  const rankCls    = RANK_COLORS[r.rank] ?? RANK_COLORS.C;
                  const kindCfg    = KIND_BADGE[r.type]  ?? KIND_BADGE.ticker;
                  const displayInput =
                    r.type === "evm" || r.type === "solana" || r.type === "ton" || r.type === "sui" || r.type === "tron"
                      ? shortenCA(r.input)
                      : r.input.toUpperCase();
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelected(r)}
                      className="border-b border-gray-100 hover:bg-purple-50 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${rankCls}`}>
                          {r.rank}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-medium text-gray-800">
                        {displayInput}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs border ${kindCfg.cls}`}>
                          {kindCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">{r.chain || "—"}</td>
                      <td className="px-3 py-2 text-right font-bold text-green-700">{r.alpha}</td>
                      <td className="px-3 py-2 text-right font-bold text-red-600">{r.risk}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{r.smart_money_score_100 ?? ((r.smart_money ?? 0) * 10)}/100</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.fundingRate != null && <FrBadge fr={r.fundingRate} />}
                          {r.openInterest != null && <OiBadge oi={r.openInterest} />}
                          {r.etfBtcDirection && (
                            <span className={`text-[10px] px-1 rounded border ${r.etfBtcDirection === "in" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                              ETF{r.etfBtcDirection === "in" ? "↑" : "↓"}
                            </span>
                          )}
                          {r.unlockDays != null && r.unlockDays <= 30 && (
                            <span className="text-[10px] px-1 rounded border bg-yellow-50 text-yellow-700 border-yellow-300">
                              ⚠️{r.unlockDays}d
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r.decision}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              const res = addToWatchlist(r.input);
                              if (res !== "full") setWatchStates(s => ({ ...s, [r.input]: true }));
                            }}
                            className={`text-[10px] rounded px-1.5 py-0.5 border transition-colors ${
                              watchStates[r.input]
                                ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                                : "bg-gray-100 text-gray-700 border-gray-200 hover:bg-yellow-50 hover:text-yellow-600"
                            }`}
                          >
                            {watchStates[r.input] ? "★" : "☆"}
                          </button>
                          {r.type === "ticker" && <FRWatchToggle symbol={r.input} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <div className="px-3 py-2 text-xs text-gray-700 bg-gray-50 border-t border-gray-100">
            行をクリックすると詳細 / ☆でウォッチリスト追加
          </div>
        </div>
      )}

      {results.length > 0 && <PortfolioCalc results={results} />}

      <div className="flex gap-2 flex-wrap items-center">
        {Object.entries(RANK_COLORS).map(([rank, cls]) => (
          <span key={rank} className={`px-2 py-0.5 rounded text-xs font-bold ${cls}`}>{rank}</span>
        ))}
        <span className="text-xs text-gray-700 ml-1">← ランク凡例</span>
      </div>

      {selected && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-lg shrink-0 ${RANK_COLORS[selected.rank] ?? RANK_COLORS.C}`}>
                {selected.rank}
              </span>
              <div>
                <div className="font-bold text-gray-800 font-mono text-sm">
                  {selected.type === "evm" || selected.type === "solana" || selected.type === "ton" || selected.type === "sui" || selected.type === "tron"
                    ? shortenCA(selected.input)
                    : selected.input.toUpperCase()}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-xs border rounded-full px-2 py-0.5 inline-block ${KIND_BADGE[selected.type]?.cls}`}>
                    {KIND_BADGE[selected.type]?.label}
                  </span>
                  {selected.chain && (
                    <span className="text-xs text-gray-700">チェーン: {selected.chain}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Score cards */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-green-50 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-700">Alpha</div>
                <div className="text-xl font-bold text-green-700">{selected.alpha}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-700">Risk</div>
                <div className="text-xl font-bold text-red-600">{selected.risk}</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <div className="text-xs text-gray-700">SM</div>
                <div className="text-xl font-bold text-blue-700">{selected.smart_money_score_100 ?? ((selected.smart_money ?? 0) * 10)}/100</div>
              </div>
            </div>

            {/* New data badges */}
            {(selected.fundingRate != null || selected.openInterest != null || selected.longRatio != null ||
              selected.etfBtcDirection || selected.unlockDays != null || selected.arkhamEntity) && (
              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <div className="text-xs font-semibold text-gray-700 mb-2">マーケットデータ</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.fundingRate != null && <FrBadge fr={selected.fundingRate} />}
                  {selected.openInterest != null && <OiBadge oi={selected.openInterest} />}
                  {selected.longRatio != null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200 font-mono">
                      L:{(selected.longRatio > 1 ? selected.longRatio : selected.longRatio * 100).toFixed(1)}%
                    </span>
                  )}
                  {selected.etfBtcDirection && selected.etfBtcFlow != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${selected.etfBtcDirection === "in" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                      BTC ETF {selected.etfBtcDirection === "in" ? "↑" : "↓"}
                      ${Math.abs(selected.etfBtcFlow).toFixed(0)}M
                    </span>
                  )}
                  {selected.isInstitutional && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
                      機関投資家✅
                    </span>
                  )}
                  {selected.arkhamEntity && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-100 text-gray-700 border-gray-200">
                      {selected.arkhamEntity}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Unlock warning */}
            {selected.unlockDays != null && (
              <div className={`rounded-lg p-3 mb-3 ${selected.unlockDays <= 7 ? "bg-red-50 border border-red-200" : selected.unlockDays <= 30 ? "bg-yellow-50 border border-yellow-200" : "bg-gray-50 border border-gray-200"}`}>
                <div className="text-xs font-semibold text-gray-700 mb-1">アンロックスケジュール</div>
                <div className="text-sm font-medium">
                  {selected.unlockDays <= 30 && "⚠️ "}
                  次回アンロック: {selected.unlockDays}日後
                  {selected.unlockPercent != null && ` (${selected.unlockPercent.toFixed(1)}% 放出)`}
                </div>
              </div>
            )}

            {/* XHeat Score */}
            {selected.xheatScore != null && (
              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <div className="text-xs font-semibold text-gray-700 mb-2">
                  XHeat Score (SNS過熱感)
                </div>
                <XHeatBar score={selected.xheatScore} />
              </div>
            )}

            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <div className="text-xs text-gray-700 mb-1">投資判断</div>
              <div className="text-sm font-semibold text-gray-800">{selected.decision}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <div className="text-xs text-gray-700 mb-1">根拠</div>
              <div className="text-sm text-gray-700 leading-relaxed">{selected.one_line_reason}</div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
