"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import SectorAnalyzer from "./SectorAnalyzer";
import BatchAnalyzer from "./BatchAnalyzer";
import WatchList from "./WatchList";
import HistoryView from "./HistoryView";
import MarketTicker from "./MarketTicker";
import PriceTicker from "./PriceTicker";
import TrendingCoins from "./TrendingCoins";
import NewsPanel from "./NewsPanel";
import PortfolioCalc from "./PortfolioCalc";
import type { PortfolioResult } from "./PortfolioCalc";
import { saveScore, detectRankChange } from "@/app/lib/scoreHistory";
import type { RankChange } from "@/app/lib/scoreHistory";
import { addToWatchlist, isInWatchlist } from "@/app/lib/watchlist";
import RankAlert from "./RankAlert";
import ShortScanner from "./ShortScanner";
import BitgetShortFinder from "./BitgetShortFinder";
import HolderAnalysis from "./HolderAnalysis";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface CoinData {
  name: string; symbol: string; price: number; change24h: number;
  change7d: number | null; marketCap: number; volume24h: number;
  rank: number; ath: number; athChange: number;
  circulatingSupply: number; totalSupply: number | null;
}
interface CoinLinks {
  website?: string; twitter?: string; telegram?: string; reddit?: string;
  github?: string; coingecko?: string; dexscreener?: string; discord?: string;
}
interface DataSource {
  name: string; category: string; status: "available" | "unavailable";
  url: string; description: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScoreData = Record<string, any>;

interface ResultState {
  query: string; coin: CoinData | null; links: CoinLinks | null;
  aiAnalysis: string | null; dataSources: DataSource[] | null;
  aiLoading: boolean; error: string | null;
  scoreData: ScoreData | null;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const QUICK_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AVAX", "LINK", "BNB"];
const CATEGORY_ORDER = ["市場データ", "DEX", "オンチェーン", "スマートマネー", "アンロック", "ホルダー分析"];
const CATEGORY_CONFIG: Record<string, { accent: string; icon: string }> = {
  市場データ:   { accent: "#16a34a", icon: "📈" },
  DEX:          { accent: "#0891b2", icon: "💱" },
  オンチェーン: { accent: "#7c3aed", icon: "⛓️" },
  スマートマネー: { accent: "#b45309", icon: "🐋" },
  アンロック:   { accent: "#ea580c", icon: "🔓" },
  ホルダー分析: { accent: "#2563eb", icon: "👥" },
};

// ─────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (!n) return "$0";
  if (n < 0.001) return `$${n.toFixed(8)}`;
  if (n < 0.01)  return `$${n.toFixed(6)}`;
  if (n < 1)     return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtLarge(n: number): string {
  if (!n) return "$0";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function fmtSupply(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString("en-US");
}

// ─────────────────────────────────────────────
// JSON extraction — robust multi-line regex
// ─────────────────────────────────────────────
function extractJson(text: string): ScoreData | null {
  const m = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function stripJson(text: string): string {
  return text.replace(/```json\s*[\s\S]*?\s*```/g, "").trim();
}

function cleanThinking(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

// ─────────────────────────────────────────────
// Link Badges
// ─────────────────────────────────────────────
const LINK_BADGE_CONFIG: Array<{ key: keyof CoinLinks; label: string; icon: string; color: string }> = [
  { key: "website",     label: "公式サイト",  icon: "🌐", color: "bg-green-50 text-green-700 border-green-200 hover:border-green-400" },
  { key: "twitter",     label: "X",           icon: "🐦", color: "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400" },
  { key: "telegram",    label: "Telegram",    icon: "💬", color: "bg-sky-50 text-sky-600 border-sky-200 hover:border-sky-400" },
  { key: "discord",     label: "Discord",     icon: "👾", color: "bg-violet-50 text-violet-600 border-violet-200 hover:border-violet-400" },
  { key: "reddit",      label: "Reddit",      icon: "🤖", color: "bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400" },
  { key: "github",      label: "GitHub",      icon: "💻", color: "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400" },
  { key: "coingecko",   label: "CoinGecko",   icon: "📊", color: "bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400" },
  { key: "dexscreener", label: "DEXScreener", icon: "📈", color: "bg-sky-50 text-sky-600 border-sky-200 hover:border-sky-400" },
];

function LinkBadges({ links }: { links: CoinLinks }) {
  const visibleBadges = LINK_BADGE_CONFIG.filter(b => !!links[b.key]);
  if (visibleBadges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
      {visibleBadges.map(badge => (
        <a key={badge.key} href={links[badge.key]} target="_blank" rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors shrink-0 ${badge.color}`}>
          <span>{badge.icon}</span><span>{badge.label}</span><span className="text-[10px]">↗</span>
        </a>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Score value helpers
// ─────────────────────────────────────────────
function numVal(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}
// Non-zero numeric value (for stop-loss where 0 means "not set")
function numValNonZero(v: unknown): number | undefined {
  const n = numVal(v);
  return n === 0 ? undefined : n;
}

// ─────────────────────────────────────────────
// ScoreBar
// ─────────────────────────────────────────────
function ScoreBar({ label, value, colorClass, cardClass = "bg-white border-[#e2e8f0]" }: {
  label: string; value: number; colorClass: string; cardClass?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`rounded-lg p-3 border shadow-sm cursor-default ${cardClass}`}>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-xs text-[#475569]">{label}</span>
        <span className="text-3xl font-black text-[#0f172a] leading-none">
          {value}<span className="text-xs text-[#475569] font-normal">/100</span>
        </span>
      </div>
      <div className="h-3 bg-[#f1f5f9] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// InvestmentBanner
// ─────────────────────────────────────────────
const RANK_BADGE: Record<string, { bg: string; text: string }> = {
  S: { bg: "bg-yellow-400",  text: "text-black" },
  A: { bg: "bg-green-500",   text: "text-white" },
  B: { bg: "bg-blue-500",    text: "text-white" },
  C: { bg: "bg-gray-400",    text: "text-white" },
  D: { bg: "bg-slate-500",   text: "text-white" },
  E: { bg: "bg-orange-500",  text: "text-white" },
  F: { bg: "bg-red-600",     text: "text-white" },
};
const RANK_BANNER_CONFIG: Record<string, { bg: string; border: string; accent: string; icon: string; label: string }> = {
  S: { bg: "bg-emerald-50", border: "border-emerald-500", accent: "text-emerald-700", icon: "🚀", label: "即エントリー推奨" },
  A: { bg: "bg-green-50",   border: "border-green-500",   accent: "text-green-700",   icon: "✅", label: "優先検討" },
  B: { bg: "bg-blue-50",    border: "border-blue-500",    accent: "text-blue-700",    icon: "👀", label: "様子見・少額可" },
  C: { bg: "bg-gray-50",    border: "border-gray-400",    accent: "text-gray-600",    icon: "⏳", label: "保留・条件待ち" },
  D: { bg: "bg-slate-50",   border: "border-slate-400",   accent: "text-slate-600",   icon: "🚫", label: "静観" },
  E: { bg: "bg-orange-50",  border: "border-orange-500",  accent: "text-orange-700",  icon: "⚠️", label: "回避推奨" },
  F: { bg: "bg-red-50",     border: "border-red-600",     accent: "text-red-700",     icon: "💀", label: "即回避" },
};

function InvestmentBanner({ scoreData }: { scoreData: ScoreData }) {
  const rank: string = scoreData.rank ?? "";
  if (!rank || !RANK_BANNER_CONFIG[rank]) return null;
  const cfg       = RANK_BANNER_CONFIG[rank];
  const rankStyle = RANK_BADGE[rank] ?? RANK_BADGE.C;
  const decision: string = scoreData.investment_decision ?? "";
  const summaryParts = [
    scoreData.entry_guidance        ? `エントリー: ${scoreData.entry_guidance}`        : null,
    scoreData.profit_target_trigger ? `利確: ${scoreData.profit_target_trigger}`        : null,
    (scoreData.stop_loss_pct && scoreData.stop_loss_pct !== 0) ? `損切: ${scoreData.stop_loss_pct}%` : null,
    scoreData.recommended_position_size ? `推奨サイズ: ${scoreData.recommended_position_size}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={`rounded-xl border-2 p-4 shadow-sm ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{cfg.icon}</span>
        <span className={`font-black text-xl ${cfg.accent}`}>{cfg.label}</span>
        <div className={`ml-auto w-14 h-14 rounded-full flex items-center justify-center text-3xl font-black shadow-md ${rankStyle.bg} ${rankStyle.text}`}>
          {rank}
        </div>
      </div>
      {decision && (
        <div className="mt-2 text-sm font-semibold text-[#0f172a]">{decision}</div>
      )}
      {summaryParts.length > 0 && (
        <div className="text-xs text-[#475569] mt-2 leading-relaxed">
          {summaryParts.join(" ｜ ")}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ScoreGrid
// ─────────────────────────────────────────────
function ScoreGrid({ scoreData }: { scoreData: ScoreData }) {
  const risk      = numVal(scoreData.risk_score_100);
  const alpha     = numVal(scoreData.alpha_score_100);
  const manipRisk = numVal(scoreData.manipulation_risk_score_100);
  const smart     = numVal(scoreData.smart_money_score_100);
  const community = numVal(scoreData.community_score_100);
  const stopLoss  = numValNonZero(scoreData.stop_loss_pct);
  const stopPrice = numValNonZero(scoreData.stop_loss_price);

  const hasAny = [risk, alpha, manipRisk, smart, community].some(v => v !== undefined);
  if (!hasAny) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {risk      !== undefined && <ScoreBar label="🔴 総合リスク"     value={risk}      colorClass="bg-red-500"    cardClass="bg-red-50 border-red-200"     />}
      {alpha     !== undefined && <ScoreBar label="🟢 爆上げ期待値"   value={alpha}     colorClass="bg-green-500"  cardClass="bg-green-50 border-green-200"  />}
      {manipRisk !== undefined && <ScoreBar label="🟠 操作リスク"     value={manipRisk} colorClass="bg-orange-500" cardClass="bg-orange-50 border-orange-200" />}
      {smart     !== undefined && <ScoreBar label="🔵 スマートマネー" value={smart}     colorClass="bg-blue-500"   cardClass="bg-blue-50 border-blue-200"    />}
      {community !== undefined && <ScoreBar label="🟣 コミュニティ"   value={community} colorClass="bg-purple-500" cardClass="bg-purple-50 border-purple-200" />}
      {(stopLoss !== undefined || stopPrice !== undefined) && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-3 shadow-sm">
          <div className="text-xs text-red-600 mb-1.5 font-semibold">✂️ 損切りライン</div>
          {stopLoss  !== undefined && <div className="text-2xl font-black text-red-700">エントリーから {stopLoss}%</div>}
          {stopPrice !== undefined && <div className="text-sm font-bold text-red-600 mt-0.5">損切り価格: ${stopPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</div>}
          <div className="text-[10px] text-red-400 mt-1.5">⚠️ この価格を下回ったら即撤退</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ActionPlanCard
// ─────────────────────────────────────────────
function ActionPlanCard({ scoreData }: { scoreData: ScoreData }) {
  const items = [
    { icon: "📥", label: "エントリー", value: scoreData.entry_guidance as string | undefined },
    { icon: "🎯", label: "利確目標",   value: scoreData.profit_target_trigger as string | undefined },
    { icon: "✂️", label: "損切り",     value: scoreData.stop_loss_trigger as string | undefined },
    { icon: "📦", label: "推奨サイズ", value: scoreData.recommended_position_size as string | undefined },
  ].filter(item => !!item.value && item.value !== "");
  if (items.length === 0) return null;
  return (
    <div className="bg-sky-50 rounded-xl p-4 border border-sky-200 shadow-sm">
      <div className="text-xs font-bold text-[#0ea5e9] uppercase tracking-widest mb-3">💡 アクションプラン</div>
      <div className="space-y-2.5">
        {items.map(item => (
          <div key={item.label} className="flex gap-3 items-start">
            <span className="text-base shrink-0 w-6 mt-0.5">{item.icon}</span>
            <div>
              <span className="text-xs text-[#64748b]">{item.label}: </span>
              <span className="text-sm text-[#0f172a] font-medium">{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// renderMarkdown
// ─────────────────────────────────────────────
function renderMarkdown(raw: string): React.ReactElement {
  const text = raw
    .replace(/^>\s*/gm, "")
    .replace(/^[-•]\s+[\w・]+:\s*$/gm, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*[-*]\s+/gm, "§BULLET§")
    .replace(/\*\*(.*?)\*\*/g, "〖$1〗")
    .trim();

  const lines = text.split("\n");
  const elements: React.ReactElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      elements.push(<div key={i} className="h-2" />);
      i++; continue;
    }

    if (
      /^[🔴🟢🟠🔵🟣✂️💡⚠️🚀✅👀⏳🚫💀📊🔍💰🗣️🌐📉🏦🔬🛡️💱⛓️👥🔓📈📄🚩🤖🔗🐋💼]/.test(line) ||
      /^\d+[\.．]\s/.test(line)
    ) {
      elements.push(
        <div key={i} className="mt-4 mb-1 font-bold text-[#0ea5e9] text-sm border-l-2 border-[#0ea5e9] pl-2"
          dangerouslySetInnerHTML={{ __html: line.replace(/〖(.*?)〗/g, "<strong class='text-[#0f172a]'>$1</strong>") }}
        />
      );
      i++; continue;
    }

    if (line.startsWith("§BULLET§")) {
      const bullets: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("§BULLET§")) {
        bullets.push(lines[i].trim().replace("§BULLET§", "").trim());
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1 pl-2">
          {bullets.map((b, j) => (
            <li key={j} className="flex gap-2 text-sm text-[#334155]">
              <span className="text-[#0ea5e9] mt-0.5 shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: b.replace(/〖(.*?)〗/g, "<strong class='text-[#0f172a] font-semibold'>$1</strong>") }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    elements.push(
      <p key={i} className="text-sm text-[#334155] leading-relaxed my-0.5"
        dangerouslySetInnerHTML={{ __html: line.replace(/〖(.*?)〗/g, "<strong class='text-[#0f172a] font-semibold'>$1</strong>") }}
      />
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ─────────────────────────────────────────────
// AiAnalysisCard — receives raw streaming text + final scoreData
// ─────────────────────────────────────────────
function AiAnalysisCard({ analysis, scoreData }: { analysis: string; scoreData: ScoreData | null }) {
  // Strip thinking tags and JSON block from display text
  const displayText = useMemo(() => stripJson(cleanThinking(analysis)), [analysis]);

  return (
    <div className="space-y-4">
      {/* 1. 投資判断バナー */}
      {scoreData?.rank && <InvestmentBanner scoreData={scoreData} />}

      {/* 2. スコアカード */}
      {scoreData && <ScoreGrid scoreData={scoreData} />}

      {/* 3. アクションプラン */}
      {scoreData && <ActionPlanCard scoreData={scoreData} />}

      {/* 4. AI分析テキスト */}
      {displayText && (
        <details open className="bg-white border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm">
          <summary className="px-4 py-3 cursor-pointer text-[#475569] text-sm font-medium hover:bg-[#f8fafc] select-none list-none flex items-center gap-2 transition-colors">
            <span>📄</span><span>詳細分析</span>
            <span className="ml-auto text-[#94a3b8] text-xs">▼</span>
          </summary>
          <div className="px-4 py-4 border-t border-[#e2e8f0]">
            {renderMarkdown(displayText)}
          </div>
        </details>
      )}

      {/* 5. JSON raw (collapsed) */}
      {scoreData && (
        <details className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-[#64748b] text-xs font-mono hover:bg-white select-none list-none flex items-center gap-2 transition-colors">
            <span>{"{ }"}</span><span>JSONデータ</span>
            <span className="ml-auto text-[#94a3b8] text-xs">▶</span>
          </summary>
          <pre className="px-4 py-4 text-xs text-[#64748b] overflow-x-auto leading-relaxed border-t border-[#e2e8f0]">
            {JSON.stringify(scoreData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Data Sources Panel
// ─────────────────────────────────────────────
function DataSourcesPanel({ sources }: { sources: DataSource[] }) {
  const grouped: Record<string, DataSource[]> = {};
  for (const cat of CATEGORY_ORDER) grouped[cat] = [];
  for (const src of sources) {
    if (!grouped[src.category]) grouped[src.category] = [];
    grouped[src.category].push(src);
  }
  const availableCount = sources.filter(s => s.status === "available").length;
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-[#f8fafc] flex items-center gap-2 border-b border-[#e2e8f0]">
        <span className="text-base">🔗</span>
        <h3 className="font-semibold text-[#0f172a] text-sm">データソース</h3>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium border border-green-200">
            ✅ {availableCount}件取得済み
          </span>
          <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-medium border border-orange-200">
            🔗 {sources.length - availableCount}件参照可能
          </span>
        </div>
      </div>
      <div className="px-4 py-3 space-y-4">
        {CATEGORY_ORDER.map(cat => {
          const catSources = grouped[cat];
          if (!catSources || catSources.length === 0) return null;
          const cfg = CATEGORY_CONFIG[cat] ?? { accent: "#6b7280", icon: "📌" };
          return (
            <div key={cat}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs">{cfg.icon}</span>
                <span className="text-xs font-semibold text-[#64748b] uppercase tracking-wide">{cat}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {catSources.map(src =>
                  src.status === "available" ? (
                    <a key={src.name} href={src.url} target="_blank" rel="noopener noreferrer" title={src.description}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200 hover:border-green-400 transition-colors">
                      <span>✅</span><span>{src.name}</span><span className="text-green-500/70 text-[10px]">取得済み ↗</span>
                    </a>
                  ) : (
                    <a key={src.name} href={src.url} target="_blank" rel="noopener noreferrer" title={src.description}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-orange-50 text-orange-600 border border-orange-200 hover:border-orange-400 transition-colors">
                      <span>🔗</span><span>{src.name}</span><span className="text-orange-400/70 text-[10px]">詳細を見る ↗</span>
                    </a>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Coin Info Card
// ─────────────────────────────────────────────
function CoinCard({ coin, dexLink, scoreData }: { coin: CoinData; dexLink?: string; scoreData?: ScoreData | null }) {
  const up24 = coin.change24h >= 0;
  const up7d  = (coin.change7d ?? 0) >= 0;
  const rank: string | undefined = scoreData?.rank;
  const rankStyle = rank ? (RANK_BADGE[rank] ?? RANK_BADGE.C) : null;
  const stopPct   = scoreData ? numValNonZero(scoreData.stop_loss_pct)   : undefined;
  const stopPrice = scoreData ? numValNonZero(scoreData.stop_loss_price) : undefined;
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-[#e2e8f0] bg-[#f8fafc]">
        <span className="text-base">📊</span>
        <h3 className="font-semibold text-[#0f172a] text-sm">価格 &amp; マーケット情報</h3>
        <div className="ml-auto flex items-center gap-2">
          {dexLink && (
            <a href={dexLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-sky-50 text-sky-600 border border-sky-200 rounded hover:border-sky-400 transition-colors">
              📈 チャートを見る ↗
            </a>
          )}
          <span className="text-xs text-[#94a3b8]">出典: CoinGecko</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="flex items-start justify-between mb-4 gap-2">
          <div>
            <div className="text-2xl font-black text-[#0f172a]">{coin.name}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-[#475569] font-mono">{coin.symbol}</span>
              <span className="text-xs bg-sky-50 text-sky-600 px-2 py-0.5 rounded font-bold border border-sky-200">
                #{coin.rank}
              </span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "flex-end" }}>
              {rank && (
                <div style={{
                  width: "56px", height: "56px", borderRadius: "12px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "28px", fontWeight: "900", flexShrink: 0,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  backgroundColor:
                    rank === "S" ? "#facc15" : rank === "A" ? "#22c55e" :
                    rank === "B" ? "#3b82f6" : rank === "C" ? "#9ca3af" :
                    rank === "D" ? "#4b5563" : rank === "E" ? "#f97316" : "#dc2626",
                  color: rank === "S" ? "#000" : "#fff",
                }}>
                  {rank}
                </div>
              )}
              <div className="text-4xl font-black text-[#0f172a] leading-none">{fmtPrice(coin.price)}</div>
            </div>
            <div className="flex gap-2 mt-2 justify-end flex-wrap">
              <span className={`px-2.5 py-1 rounded text-sm font-bold ${up24 ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                {up24 ? "▲" : "▼"} 24h {Math.abs(coin.change24h).toFixed(2)}%
              </span>
              {coin.change7d !== null && (
                <span className={`px-2.5 py-1 rounded text-sm font-bold ${up7d ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                  {up7d ? "▲" : "▼"} 7d {Math.abs(coin.change7d).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: "時価総額",   value: fmtLarge(coin.marketCap) },
            { label: "24h取引量", value: fmtLarge(coin.volume24h) },
            { label: "ATH",        value: fmtPrice(coin.ath) },
            { label: "ATH比",      value: `${coin.athChange.toFixed(1)}%` },
            { label: "流通供給量", value: fmtSupply(coin.circulatingSupply) },
            { label: "総供給量",   value: coin.totalSupply ? fmtSupply(coin.totalSupply) : "∞" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#f8fafc] rounded-lg px-3 py-2 border border-[#e2e8f0]">
              <div className="text-xs text-[#64748b] mb-0.5">{label}</div>
              <div className="text-sm font-bold text-[#0f172a]">{value}</div>
            </div>
          ))}
        </div>
        {(stopPct !== undefined || stopPrice !== undefined) && (
          <div style={{
            marginTop: "12px", padding: "12px 16px",
            backgroundColor: "#fef2f2", borderLeft: "4px solid #ef4444",
            borderRadius: "0 8px 8px 0",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#b91c1c" }}>✂️ 損切りライン</div>
              <div style={{ fontSize: "11px", color: "#f87171" }}>この価格を下回ったら即撤退</div>
            </div>
            <div style={{ textAlign: "right" }}>
              {stopPct !== undefined && (
                <div style={{ fontSize: "24px", fontWeight: 900, color: "#dc2626" }}>{stopPct}%</div>
              )}
              {stopPrice !== undefined && (
                <div style={{ fontSize: "13px", color: "#ef4444" }}>${stopPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────
function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] shadow-sm overflow-hidden animate-pulse">
      <div className="px-4 py-2.5 bg-[#f8fafc] h-9 border-b border-[#e2e8f0]" />
      <div className="px-4 py-4 space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 bg-[#e2e8f0] rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
type Tab = "chat" | "sector" | "batch" | "watchlist" | "history" | "portfolio" | "shortscan" | "bitgetshort" | "holders";
interface TabEntry { id: string; label: string; href?: string }
const TAB_CONFIG: TabEntry[] = [
  { id: "chat",        label: "💬 個別分析" },
  { id: "sector",      label: "📊 セクター分析" },
  { id: "batch",       label: "📋 バッチ分析" },
  { id: "watchlist",   label: "⭐ ウォッチリスト" },
  { id: "history",     label: "📈 履歴" },
  { id: "portfolio",   label: "💼 ポートフォリオ" },
  { id: "shortscan",   label: "🎯 Short Scanner" },
  { id: "bitgetshort", label: "⚡ Bitget Short" },
  { id: "holders",     label: "👥 ホルダー分析" },
  { id: "trades",      label: "📊 トレード履歴", href: "/trades" },
];

// ─── Tab preference helpers ───────────────────
interface TabPrefs { order: string[]; hidden: string[] }

function defaultTabPrefs(): TabPrefs {
  return { order: TAB_CONFIG.map(t => t.id), hidden: [] };
}

function loadTabPrefs(): TabPrefs {
  try {
    const raw = localStorage.getItem("tabOrder");
    if (!raw) return defaultTabPrefs();
    const saved = JSON.parse(raw) as TabPrefs;
    const allIds = TAB_CONFIG.map(t => t.id);
    const savedSet = new Set(saved.order);
    const missing = allIds.filter(id => !savedSet.has(id));
    return {
      order: [...saved.order.filter(id => allIds.includes(id)), ...missing],
      hidden: saved.hidden.filter(id => allIds.includes(id)),
    };
  } catch {
    return defaultTabPrefs();
  }
}

export default function CryptoSearch() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [batchPrefill, setBatchPrefill] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [remainingCount, setRemainingCount] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number>(20);
  const [rankChange, setRankChange] = useState<RankChange | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [scoreData, setScoreData] = useState<any>(null);
  const [tabPrefs, setTabPrefs] = useState<TabPrefs>(() => defaultTabPrefs());
  const [showTabSettings, setShowTabSettings] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (result?.query) setWatchlisted(isInWatchlist(result.query));
  }, [result?.query]);

  useEffect(() => {
    const prefs = loadTabPrefs();
    setTabPrefs(prefs);
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    localStorage.setItem("tabOrder", JSON.stringify(tabPrefs));
  }, [tabPrefs, prefsLoaded]);

  useEffect(() => {
    if (!prefsLoaded) return;
    if (tabPrefs.hidden.includes(activeTab)) {
      const firstVisible = tabPrefs.order.find(id => !tabPrefs.hidden.includes(id));
      if (firstVisible) setActiveTab(firstVisible as Tab);
    }
  }, [tabPrefs, prefsLoaded, activeTab]);

  // Extract scoreData from streaming AI text as soon as JSON block is detected
  useEffect(() => {
    const text = result?.aiAnalysis;
    if (!text) return;
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        if (data.rank) setScoreData(data);
      } catch { /* ignore */ }
    }
  }, [result?.aiAnalysis]);

  const visibleTabs = useMemo(
    () => tabPrefs.order
      .map(id => TAB_CONFIG.find(t => t.id === id))
      .filter((t): t is TabEntry => !!t && !tabPrefs.hidden.includes(t.id)),
    [tabPrefs],
  );

  function moveTab(id: string, dir: -1 | 1) {
    setTabPrefs(prev => {
      const arr = [...prev.order];
      const idx = arr.indexOf(id);
      const next = idx + dir;
      if (next < 0 || next >= arr.length) return prev;
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return { ...prev, order: arr };
    });
  }

  function toggleHidden(id: string) {
    setTabPrefs(prev => ({
      ...prev,
      hidden: prev.hidden.includes(id)
        ? prev.hidden.filter(h => h !== id)
        : [...prev.hidden, id],
    }));
  }

  function handleBatchFromWatchlist(items: string[]) {
    setBatchPrefill(items.join("\n")); setActiveTab("batch");
  }
  function handleAnalyzeFromWidget(query: string) {
    setActiveTab("chat"); search(query);
  }

  const search = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setScoreData(null);
    setResult({ query: q, coin: null, links: null, aiAnalysis: null, dataSources: null, aiLoading: true, error: null, scoreData: null });
    setInput(q);
    setTimeout(() => window.scrollTo({ top: 200, behavior: "smooth" }), 100);

    const body = JSON.stringify({ query: q });
    const headers = { "Content-Type": "application/json" };

    // Fire info and chat fetches in parallel
    fetch("/api/info", { method: "POST", headers, body })
      .then(async (res) => {
        if (!res.ok) return;
        const info = await res.json();
        setResult(prev => prev ? {
          ...prev,
          coin: info.coin ?? prev.coin,
          links: info.links ?? prev.links,
        } : null);
      })
      .catch(() => {});

    try {
      const chatRes = await fetch("/api/chat", { method: "POST", headers, body });
      if (!chatRes.ok) {
        const text = await chatRes.text();
        throw new Error(text || `サーバーエラー (HTTP ${chatRes.status})`);
      }

      const reader = chatRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "", metaParsed = false, aiText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (!metaParsed) {
          buffer += chunk;
          const nlIdx = buffer.indexOf("\n");
          if (nlIdx !== -1) {
            try {
              const meta: { dataSources: DataSource[]; coin: CoinData | null; remainingCount?: number; dailyLimit?: number } = JSON.parse(buffer.slice(0, nlIdx));
              setResult(prev => prev ? { ...prev, coin: prev.coin ?? meta.coin, dataSources: prev.dataSources ?? meta.dataSources } : null);
              if (meta.remainingCount !== undefined) setRemainingCount(meta.remainingCount);
              if (meta.dailyLimit !== undefined) setDailyLimit(meta.dailyLimit);
            } catch { /* ignore bad meta */ }
            aiText = buffer.slice(nlIdx + 1);
            metaParsed = true;
            buffer = "";
          }
        } else {
          aiText += chunk;
        }

        if (metaParsed && aiText) {
          // Try to extract JSON as soon as the closing ``` arrives (during streaming)
          const liveScore = extractJson(cleanThinking(aiText));
          setResult(prev => prev ? { ...prev, aiAnalysis: aiText, scoreData: liveScore ?? prev.scoreData } : null);
        }
      }

      // Streaming complete — finalise score (use q as fallback ticker)
      const cleaned = cleanThinking(aiText);
      const scoreData = extractJson(cleaned);

      if (scoreData?.rank) {
        const ticker = scoreData.ticker_ca ? String(scoreData.ticker_ca) : q;
        const record = {
          ticker,
          date: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
          rank: String(scoreData.rank),
          alpha: Number(scoreData.alpha_score_100) || 0,
          risk: Number(scoreData.risk_score_100) || 0,
          savedAt: Date.now(),
        };
        saveScore(record);
        const change = detectRankChange(record);
        if (change) setRankChange(change);
      }

      setResult(prev => prev ? { ...prev, aiAnalysis: aiText, scoreData, aiLoading: false } : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "通信エラーが発生しました";
      setResult(prev => prev ? { ...prev, error: msg, aiLoading: false } : null);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); search(input); };

  return (
    <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "var(--font-noto-sans-jp), 'Noto Sans JP', sans-serif" }}>
      <RankAlert change={rankChange} />

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-[#e2e8f0] shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-[#0ea5e9] text-2xl font-black">₿</span>
          <div>
            <span className="font-black text-[#0f172a] text-base tracking-wide">Crypto Terminal</span>
            <span className="ml-2 text-xs text-[#0ea5e9] font-bold hidden sm:inline">Pro Edition</span>
          </div>
        </div>
      </header>

      <PriceTicker />

      {/* Tab bar */}
      <div className="overflow-x-auto bg-white border-b border-[#e2e8f0]">
        <div className="max-w-screen-2xl mx-auto px-4 flex min-w-max">
          {visibleTabs.map((tab, idx) => (
            <React.Fragment key={tab.id}>
              {idx > 0 && <div className="w-px bg-[#e2e8f0] my-2" />}
              {tab.href ? (
                <Link
                  href={tab.href}
                  className="px-4 py-3 text-xs sm:text-sm font-medium border-b-2 border-transparent text-[#64748b] hover:text-[#0f172a] transition-colors whitespace-nowrap"
                >
                  {tab.label}
                </Link>
              ) : (
                <button
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? "border-[#0ea5e9] text-[#0ea5e9]"
                      : "border-transparent text-[#64748b] hover:text-[#0f172a]"
                  }`}
                >
                  {tab.label}
                </button>
              )}
            </React.Fragment>
          ))}
          <div className="w-px bg-[#e2e8f0] my-2" />
          <button
            onClick={() => setShowTabSettings(true)}
            className="px-3 py-3 text-sm text-[#94a3b8] hover:text-[#0f172a] transition-colors whitespace-nowrap"
            title="タブをカスタマイズ"
          >
            ⚙️
          </button>
        </div>
      </div>

      <main className="max-w-screen-2xl mx-auto px-4 py-8">
        {activeTab === "sector"    && <SectorAnalyzer onAnalyze={(ticker) => { setActiveTab("chat"); search(ticker); }} />}
        {activeTab === "batch"     && <BatchAnalyzer prefillText={batchPrefill} />}
        {activeTab === "watchlist" && <WatchList onBatchAnalyze={handleBatchFromWatchlist} onAnalyze={handleAnalyzeFromWidget} />}
        {activeTab === "history"   && <HistoryView />}
        {activeTab === "portfolio" && <PortfolioTabContent onGoToBatch={() => setActiveTab("batch")} />}
        {activeTab === "shortscan"   && <ShortScanner />}
        {activeTab === "bitgetshort" && <BitgetShortFinder />}
        {activeTab === "holders"     && <HolderAnalysis />}

        {activeTab === "chat" && <>
          {/* Search */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-[#0f172a] mb-1">暗号通貨を検索</h1>
            <p className="text-sm text-[#475569] mb-6">銘柄名・ティッカー・日本語名・コントラクトアドレスで検索できます</p>
            <form onSubmit={handleSubmit} className="relative max-w-xl mx-auto">
              <input
                ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
                placeholder="例: BTC、ビットコイン、ethereum、0x..."
                className="w-full pl-4 pr-24 py-3 rounded-xl border-2 border-[#e2e8f0] focus:border-[#0ea5e9] focus:outline-none text-[#0f172a] text-sm transition-colors bg-white shadow-sm"
              />
              <button type="submit" disabled={loading || !input.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white"
                style={{ background: loading ? "#94a3b8" : "#0ea5e9" }}>
                {loading ? "検索中…" : "検索"}
              </button>
            </form>
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {QUICK_COINS.map(coin => (
                <button key={coin} onClick={() => search(coin)} disabled={loading}
                  className="px-3 py-1 text-xs font-mono font-bold border border-[#e2e8f0] rounded-full text-[#475569] bg-white hover:border-[#0ea5e9] hover:text-[#0ea5e9] hover:bg-sky-50 disabled:opacity-40 transition-colors shadow-sm">
                  {coin}
                </button>
              ))}
            </div>
          </div>

          {/* Rate limit banner */}
          {remainingCount !== null && (
            <div className={`mb-4 px-4 py-2.5 rounded-xl border text-sm font-medium flex items-center gap-2 ${
              remainingCount === 0 ? "bg-red-50 border-red-300 text-red-600"
              : remainingCount <= 5 ? "bg-orange-50 border-orange-300 text-orange-600"
              : "bg-slate-50 border-[#e2e8f0] text-[#475569]"
            }`}>
              <span>🔢</span>
              <span>本日の残り分析回数: <strong className="text-[#0f172a]">{remainingCount}</strong> / {dailyLimit}</span>
              {remainingCount === 0 && <span className="ml-auto">明日リセットされます</span>}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-[#64748b] flex-wrap">
                <span>検索:</span>
                <span className="font-bold text-[#0f172a]">{result.query}</span>
                <button
                  onClick={() => { if (!watchlisted) { addToWatchlist(result.query); setWatchlisted(true); } }}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    watchlisted ? "bg-yellow-50 text-yellow-600 border-yellow-300"
                    : "bg-white text-[#64748b] border-[#e2e8f0] hover:border-yellow-300 hover:text-yellow-600"
                  }`}>
                  {watchlisted ? "★ ウォッチ済み" : "☆ ウォッチ追加"}
                </button>
                {(loading || result.aiLoading) && (
                  <span className="ml-auto flex items-center gap-1.5 text-[#0ea5e9] text-xs">
                    <span className="w-3 h-3 border-2 border-[#0ea5e9] border-t-transparent rounded-full animate-spin inline-block" />
                    AI分析中…
                  </span>
                )}
              </div>

              {result.error && (
                <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 text-sm text-red-600">
                  ⚠️ {result.error}
                </div>
              )}
              {!result.coin && !result.aiLoading && !result.error && (
                <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-3 text-sm text-yellow-700">
                  ⚠️ 銘柄が見つかりませんでした。別の名前で試してください。
                </div>
              )}

              {result.links && Object.values(result.links).some(Boolean) && (
                <div className="bg-white rounded-xl border border-[#e2e8f0] px-4 py-3 shadow-sm">
                  <div className="text-xs text-[#64748b] mb-2 font-medium">公式リンク</div>
                  <LinkBadges links={result.links} />
                </div>
              )}

              {result.coin ? <CoinCard coin={result.coin} dexLink={result.links?.dexscreener} scoreData={scoreData} />
                : result.aiLoading && !result.error ? <SkeletonCard lines={5} /> : null}

              {result.aiLoading && !result.error ? (
                <><SkeletonCard lines={4} /><SkeletonCard lines={3} /><SkeletonCard lines={5} /></>
              ) : result.aiAnalysis ? (
                <AiAnalysisCard analysis={result.aiAnalysis} scoreData={result.scoreData} />
              ) : null}

              {!result.aiLoading && result.dataSources && result.dataSources.length > 0 && (
                <DataSourcesPanel sources={result.dataSources} />
              )}
            </div>
          )}

          <div className="mt-6">
            <MarketTicker />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div className="text-xs p-2 max-h-64 overflow-y-auto">
              <TrendingCoins onAnalyze={handleAnalyzeFromWidget} />
            </div>
            <NewsPanel highlightTicker={result?.query ?? ""} />
          </div>
        </>}
      </main>

      <footer className="border-t border-[#e2e8f0] mt-12 bg-white">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 text-center text-xs text-[#94a3b8]">
          データ提供: CoinGecko · DEXScreener · GeckoTerminal · AI分析: Anthropic Claude
        </div>
      </footer>

      {/* Tab settings modal */}
      {showTabSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTabSettings(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[340px] max-w-[90vw] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between">
              <h2 className="font-bold text-[#0f172a] text-base">⚙️ タブカスタマイズ</h2>
              <button onClick={() => setShowTabSettings(false)} className="text-[#94a3b8] hover:text-[#0f172a] text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-2">
              {tabPrefs.order.map((id, idx) => {
                const tab = TAB_CONFIG.find(t => t.id === id);
                if (!tab) return null;
                const isHidden = tabPrefs.hidden.includes(id);
                return (
                  <div key={id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isHidden ? "bg-[#f8fafc] border-[#e2e8f0] opacity-50" : "bg-white border-[#e2e8f0]"}`}>
                    <span className="flex-1 text-sm font-medium text-[#0f172a]">{tab.label}</span>
                    <button
                      onClick={() => moveTab(id, -1)}
                      disabled={idx === 0}
                      className="w-7 h-7 flex items-center justify-center text-xs rounded hover:bg-[#f1f5f9] disabled:opacity-20 text-[#64748b]"
                    >▲</button>
                    <button
                      onClick={() => moveTab(id, 1)}
                      disabled={idx === tabPrefs.order.length - 1}
                      className="w-7 h-7 flex items-center justify-center text-xs rounded hover:bg-[#f1f5f9] disabled:opacity-20 text-[#64748b]"
                    >▼</button>
                    <button
                      onClick={() => toggleHidden(id)}
                      className={`w-7 h-7 flex items-center justify-center text-sm rounded transition-colors ${isHidden ? "text-[#94a3b8] hover:bg-[#f1f5f9]" : "text-[#0ea5e9] hover:bg-sky-50"}`}
                      title={isHidden ? "表示する" : "非表示にする"}
                    >👁</button>
                  </div>
                );
              })}
            </div>
            <div className="px-5 py-4 border-t border-[#e2e8f0] flex items-center justify-between">
              <button
                onClick={() => setTabPrefs(defaultTabPrefs())}
                className="text-xs text-[#64748b] hover:text-[#0f172a] underline"
              >デフォルトに戻す</button>
              <button
                onClick={() => setShowTabSettings(false)}
                className="px-4 py-1.5 bg-[#0ea5e9] text-white rounded-lg text-sm font-bold hover:bg-[#0284c7] transition-colors"
              >閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Portfolio Tab
// ─────────────────────────────────────────────
function PortfolioTabContent({ onGoToBatch }: { onGoToBatch: () => void }) {
  const [results, setResults] = useState<PortfolioResult[]>([]);
  useEffect(() => {
    try { const saved = localStorage.getItem("lastBatchResults"); if (saved) setResults(JSON.parse(saved)); } catch { }
  }, []);

  if (results.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="text-5xl">💼</div>
        <p className="text-sm text-[#64748b]">バッチ分析を実行すると<br />ここにポートフォリオ配分が表示されます</p>
        <button onClick={onGoToBatch}
          className="px-4 py-2 bg-[#0ea5e9] hover:bg-[#0284c7] text-white rounded-lg text-sm font-bold transition-colors">
          📋 バッチ分析へ
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-bold text-[#0ea5e9]">💼 ポートフォリオ配分</h2>
      <p className="text-xs text-[#64748b]">最後のバッチ分析結果をもとに算出</p>
      <PortfolioCalc results={results} />
    </div>
  );
}
