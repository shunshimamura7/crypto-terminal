"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { TradeLog, TradeAction, TradeDirection } from "@/app/types/trade";

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (!n) return "—";
  if (n < 0.0001) return `$${n.toFixed(8)}`;
  if (n < 0.01)   return `$${n.toFixed(6)}`;
  if (n < 1)      return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

// ── Action badge ──────────────────────────────────────────────────────────────
const ACTION_META: Record<TradeAction, { label: string; cls: string }> = {
  entry:       { label: "エントリー", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  exit_tp:     { label: "✅ TP",      cls: "bg-green-100 text-green-700 border-green-200" },
  exit_sl:     { label: "❌ SL",      cls: "bg-red-100 text-red-700 border-red-200" },
  exit_manual: { label: "📌 手動決済", cls: "bg-gray-100 text-gray-600 border-gray-300" },
};

const DIR_META: Record<TradeDirection, { label: string; cls: string }> = {
  long:  { label: "🟢 Long",  cls: "text-green-600" },
  short: { label: "🔴 Short", cls: "text-red-600" },
};

// ── Default form state ────────────────────────────────────────────────────────
interface FormState {
  action: TradeAction;
  ticker: string;
  direction: TradeDirection;
  price: string;
  size_pct: string;
  bell_rank_at_entry: string;
  bell_alpha_at_entry: string;
  bell_risk_at_entry: string;
  notes: string;
  linked_entry_id: string;
}
const EMPTY_FORM: FormState = {
  action: "entry", ticker: "", direction: "short",
  price: "", size_pct: "5",
  bell_rank_at_entry: "", bell_alpha_at_entry: "", bell_risk_at_entry: "",
  notes: "", linked_entry_id: "",
};

// ── Stats panel ───────────────────────────────────────────────────────────────
function StatsPanel({ logs }: { logs: TradeLog[] }) {
  const entries   = logs.filter(l => l.action === "entry");
  const tpHits    = logs.filter(l => l.action === "exit_tp").length;
  const slHits    = logs.filter(l => l.action === "exit_sl").length;
  const decided   = tpHits + slHits;
  const winRate   = decided > 0 ? Math.round((tpHits / decided) * 100) : null;

  const rankMap: Record<string, { entries: number }> = {};
  for (const l of entries) {
    const r = l.bell_rank_at_entry ?? "N/A";
    if (!rankMap[r]) rankMap[r] = { entries: 0 };
    rankMap[r].entries++;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: "ログ件数",  value: logs.length.toString(),          sub: "全アクション" },
        { label: "エントリー", value: entries.length.toString(),       sub: "記録数" },
        { label: "TP / SL",   value: `${tpHits} / ${slHits}`,         sub: "決済内訳" },
        { label: "勝率",       value: winRate !== null ? `${winRate}%` : "—", sub: decided > 0 ? `${decided}件決済済` : "決済なし" },
      ].map(s => (
        <div key={s.label} className="bg-gray-800 rounded-xl p-3 border border-gray-700">
          <p className="text-[10px] text-gray-400 mb-0.5">{s.label}</p>
          <p className="text-xl font-black text-white">{s.value}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Add form ──────────────────────────────────────────────────────────────────
function AddForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(k: keyof FormState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setErr(null);
    try {
      const body = {
        action:              form.action,
        ticker:              form.ticker.trim().toUpperCase(),
        direction:           form.direction,
        price:               parseFloat(form.price),
        size_pct:            parseFloat(form.size_pct) || 0,
        ...(form.bell_rank_at_entry  && { bell_rank_at_entry:  form.bell_rank_at_entry }),
        ...(form.bell_alpha_at_entry && { bell_alpha_at_entry: parseFloat(form.bell_alpha_at_entry) }),
        ...(form.bell_risk_at_entry  && { bell_risk_at_entry:  parseFloat(form.bell_risk_at_entry)  }),
        ...(form.notes               && { notes: form.notes }),
        ...(form.linked_entry_id     && { linked_entry_id: form.linked_entry_id }),
      };
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "保存失敗");
      setForm(EMPTY_FORM);
      setOpen(false);
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "エラー");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {open ? "▲ フォームを閉じる" : "＋ トレードを記録"}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-300 mb-2">📝 新規トレードログ</p>

          {/* Row 1 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">アクション</label>
              <select
                value={form.action}
                onChange={e => set("action", e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5"
                required
              >
                <option value="entry">エントリー</option>
                <option value="exit_tp">TP決済</option>
                <option value="exit_sl">SL決済</option>
                <option value="exit_manual">手動決済</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">銘柄 *</label>
              <input
                value={form.ticker}
                onChange={e => set("ticker", e.target.value.toUpperCase())}
                placeholder="BTC"
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 font-mono uppercase"
                required
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">方向</label>
              <select
                value={form.direction}
                onChange={e => set("direction", e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5"
              >
                <option value="short">Short 🔴</option>
                <option value="long">Long 🟢</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">価格 (USD) *</label>
              <input
                type="number" step="any" min="0"
                value={form.price}
                onChange={e => set("price", e.target.value)}
                placeholder="0.0000"
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 font-mono"
                required
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">サイズ (%)</label>
              <input
                type="number" step="0.1" min="0" max="100"
                value={form.size_pct}
                onChange={e => set("size_pct", e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">ベルランク</label>
              <input
                value={form.bell_rank_at_entry}
                onChange={e => set("bell_rank_at_entry", e.target.value.toUpperCase())}
                placeholder="A"
                maxLength={2}
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">Alphaスコア</label>
              <input
                type="number" step="1" min="0" max="100"
                value={form.bell_alpha_at_entry}
                onChange={e => set("bell_alpha_at_entry", e.target.value)}
                placeholder="75"
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">Riskスコア</label>
              <input
                type="number" step="1" min="0" max="100"
                value={form.bell_risk_at_entry}
                onChange={e => set("bell_risk_at_entry", e.target.value)}
                placeholder="30"
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 font-mono"
              />
            </div>
          </div>

          {/* Row 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">メモ</label>
              <input
                value={form.notes}
                onChange={e => set("notes", e.target.value)}
                placeholder="任意メモ"
                maxLength={200}
                className="w-full bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">紐付けエントリーID (exit時)</label>
              <input
                value={form.linked_entry_id}
                onChange={e => set("linked_entry_id", e.target.value)}
                placeholder="entry log の id"
                className="w-full bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded-lg px-2 py-1.5 font-mono"
              />
            </div>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {submitting ? "保存中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(null); }}
              className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors"
            >
              キャンセル
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TradesPage() {
  const [logs, setLogs]             = useState<TradeLog[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [filter, setFilter]         = useState<"all" | "long" | "short">("all");
  const [tickerSearch, setTickerSearch] = useState("");
  const [deleting, setDeleting]     = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/trades?limit=100");
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? "取得失敗");
        setLogs([]);
      } else {
        setLogs(data.logs ?? []);
      }
    } catch {
      setError("ネットワークエラー");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function handleDelete(log: TradeLog) {
    if (!confirm(`${log.ticker} (${log.action}) を削除しますか？`)) return;
    setDeleting(log.id);
    try {
      const params = new URLSearchParams({ ts: log.timestamp, ticker: log.ticker });
      const res = await fetch(`/api/trades?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setLogs(prev => prev.filter(l => l.id !== log.id));
      } else {
        alert(data.error ?? "削除失敗");
      }
    } finally {
      setDeleting(null);
    }
  }

  // Filter
  const filtered = logs.filter(l => {
    if (filter === "long"  && l.direction !== "long")  return false;
    if (filter === "short" && l.direction !== "short") return false;
    if (tickerSearch && !l.ticker.includes(tickerSearch.toUpperCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-black tracking-tight">📊 トレード履歴</h1>
            <span className="text-[10px] text-gray-500 bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full">
              ベルDB
            </span>
          </div>
          <nav className="flex items-center gap-2 text-xs">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-800">
              💬 分析
            </Link>
            <Link href="/short-scan" className="text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-800">
              🎯 Scanner
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">

        {/* Add form */}
        <AddForm onAdded={fetchLogs} />

        {/* Stats */}
        {!loading && logs.length > 0 && <StatsPanel logs={logs} />}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex gap-1">
            {(["all", "long", "short"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors border ${
                  filter === f
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                {f === "all" ? "全件" : f === "long" ? "🟢 Long" : "🔴 Short"}
              </button>
            ))}
          </div>
          <input
            value={tickerSearch}
            onChange={e => setTickerSearch(e.target.value.toUpperCase())}
            placeholder="銘柄で絞り込み…"
            className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 font-mono w-36 placeholder-gray-500"
          />
          <button
            onClick={fetchLogs}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 bg-gray-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            🔄 更新
          </button>
        </div>

        {/* Table / States */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
            <span className="animate-spin mr-2">⏳</span> 読み込み中...
          </div>
        )}

        {!loading && error && (
          <div className="bg-orange-950 border border-orange-800 rounded-xl p-4 text-sm text-orange-300">
            <p className="font-semibold mb-1">⚠️ KV未接続</p>
            <p className="text-xs">{error}</p>
            <p className="text-xs text-orange-400 mt-2">
              Vercelダッシュボード → Storage → KV Database を作成し、<code className="bg-orange-900 px-1 rounded">KV_REST_API_URL</code> / <code className="bg-orange-900 px-1 rounded">KV_REST_API_TOKEN</code> を環境変数に設定してください。
            </p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <span className="text-4xl mb-4">📭</span>
            <p className="text-sm font-medium">まだトレード履歴がありません</p>
            <p className="text-xs mt-1 text-gray-600">「＋ トレードを記録」ボタンから追加できます</p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-700">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-800 text-gray-400 text-[10px] uppercase tracking-wider">
                <tr>
                  {["日時", "アクション", "銘柄", "方向", "価格", "サイズ", "ランク", "Alpha", "Risk", "メモ", ""].map(h => (
                    <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(log => {
                  const am = ACTION_META[log.action];
                  const dm = DIR_META[log.direction];
                  return (
                    <tr key={log.id} className="bg-gray-900 hover:bg-gray-800 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-400 font-mono">{fmtDate(log.timestamp)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${am.cls}`}>{am.label}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold text-white">{log.ticker}</td>
                      <td className={`px-3 py-2.5 font-semibold whitespace-nowrap ${dm.cls}`}>{dm.label}</td>
                      <td className="px-3 py-2.5 font-mono text-white">{fmtPrice(log.price)}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-300">{log.size_pct > 0 ? `${log.size_pct}%` : "—"}</td>
                      <td className="px-3 py-2.5">
                        {log.bell_rank_at_entry
                          ? <span className="font-bold text-indigo-400">{log.bell_rank_at_entry}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-gray-300">{log.bell_alpha_at_entry ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-300">{log.bell_risk_at_entry  ?? "—"}</td>
                      <td className="px-3 py-2.5 text-gray-400 max-w-[160px] truncate" title={log.notes}>{log.notes || "—"}</td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => handleDelete(log)}
                          disabled={deleting === log.id}
                          className="text-gray-600 hover:text-red-400 disabled:opacity-30 transition-colors text-xs"
                          title="削除"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <p className="text-[10px] text-gray-600 mt-2 text-right">{filtered.length} / {logs.length} 件表示</p>
        )}
      </main>
    </div>
  );
}
