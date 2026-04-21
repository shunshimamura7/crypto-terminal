"use client";

import React, { useState, useRef, useCallback, lazy, Suspense, useEffect, useMemo } from "react";
import SectorAnalyzer from "./SectorAnalyzer";
import BatchAnalyzer from "./BatchAnalyzer";
import WatchList from "./WatchList";
import HistoryView from "./HistoryView";
import FearGreedGauge from "./FearGreedGauge";
import PriceTicker from "./PriceTicker";
import TrendingCoins from "./TrendingCoins";
import NewsPanel from "./NewsPanel";
import PortfolioCalc from "./PortfolioCalc";
import type { PortfolioResult } from "./PortfolioCalc";
import { saveScore, detectRankChange } from "@/app/lib/scoreHistory";
import type { RankChange } from "@/app/lib/scoreHistory";
import { addToWatchlist, isInWatchlist } from "@/app/lib/watchlist";
import RankAlert from "./RankAlert";

const TradingViewChart = lazy(() => import("./TradingViewChart"));

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface CoinData {
  name: string;
  symbol: string;
  price: number;
  change24h: number;
  change7d: number | null;
  marketCap: number;
  volume24h: number;
  rank: number;
  ath: number;
  athChange: number;
  circulatingSupply: number;
  totalSupply: number | null;
}

interface CoinLinks {
  website?: string;
  twitter?: string;
  telegram?: string;
  reddit?: string;
  github?: string;
  coingecko?: string;
  dexscreener?: string;
  discord?: string;
}

interface DataSource {
  name: string;
  category: string;
  status: "available" | "unavailable";
  url: string;
  description: string;
}

interface ResultState {
  query: string;
  coin: CoinData | null;
  links: CoinLinks | null;
  tradingViewSymbol: string | null;
  aiAnalysis: string | null;
  dataSources: DataSource[] | null;
  aiLoading: boolean;
  error: string | null;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const QUICK_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AVAX", "LINK", "BNB"];

const CATEGORY_ORDER = [
  "市場データ",
  "DEX",
  "オンチェーン",
  "スマートマネー",
  "アンロック",
  "ホルダー分析",
];

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
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtLarge(n: number): string {
  if (!n) return "$0";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSupply(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString("en-US");
}

// ─────────────────────────────────────────────
// Link Badges
// ─────────────────────────────────────────────
const LINK_BADGE_CONFIG: Array<{
  key: keyof CoinLinks;
  label: string;
  icon: string;
  color: string;
}> = [
  { key: "website",    label: "公式サイト",    icon: "🌐", color: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" },
  { key: "twitter",    label: "X",             icon: "🐦", color: "bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100" },
  { key: "telegram",   label: "Telegram",      icon: "💬", color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
  { key: "discord",    label: "Discord",       icon: "👾", color: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100" },
  { key: "reddit",     label: "Reddit",        icon: "🤖", color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
  { key: "github",     label: "GitHub",        icon: "💻", color: "bg-gray-50 text-gray-800 border-gray-300 hover:bg-gray-100" },
  { key: "coingecko",  label: "CoinGecko",     icon: "📊", color: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  { key: "dexscreener",label: "DEXScreener",   icon: "📈", color: "bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100" },
];

function LinkBadges({ links }: { links: CoinLinks }) {
  const visibleBadges = LINK_BADGE_CONFIG.filter(b => !!links[b.key]);
  if (visibleBadges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
      {visibleBadges.map(badge => (
        <a
          key={badge.key}
          href={links[badge.key]}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors shrink-0 ${badge.color}`}
        >
          <span>{badge.icon}</span>
          <span>{badge.label}</span>
          <span className="opacity-50 text-[10px]">↗</span>
        </a>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// processResponse & splitSections
// ─────────────────────────────────────────────
function processResponse(raw: string): { text: string; jsonData: Record<string, unknown> | null } {
  let text = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
  const jsonMatch = text.match(/```json[\s\S]*?\n([\s\S]*?)\n```/);
  let jsonData: Record<string, unknown> | null = null;
  if (jsonMatch) {
    try { jsonData = JSON.parse(jsonMatch[1]); } catch { /* ignore */ }
    text = text.replace(/```json[\s\S]*?```/g, "").trim();
  }
  return { text, jsonData };
}

function splitSections(text: string): { detail: string; diag: string } {
  const diagIdx = text.indexOf("最終統合診断");
  if (diagIdx < 0) return { detail: text, diag: "" };
  return {
    detail: text.substring(0, diagIdx).trim(),
    diag:   text.substring(diagIdx).trim(),
  };
}

// ─────────────────────────────────────────────
// スコア抽出 & ビジュアライズ
// ─────────────────────────────────────────────
interface ParsedScores {
  risk?: number;
  alpha?: number;
  manipRisk?: number;
  smartMoney?: number;
  community?: number;
  communityDetail?: string;
  stopLossPct?: number;
  stopLossPrice?: number;
  stopLossText?: string;
  rank?: string;
  decision?: string;
  entryGuidance?: string;
  profitTarget?: string;
  positionSize?: string;
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractScores(jsonData: Record<string, any> | null, content: string): ParsedScores | null {
  const riskM      = content.match(/【総合リスクスコア[：:]\s*(\d+)/);
  const alphaM     = content.match(/【爆上げ期待値[：:]\s*(\d+)/);
  const manipM     = content.match(/【操作リスクスコア[：:]\s*(\d+)/);
  const smartM     = content.match(/【スマートマネースコア[：:]\s*(\d+)/);
  const communityM = content.match(/【コミュニティスコア[：:]\s*(\d+)/);
  const rankM      = content.match(/【ランク[：:]\s*([SABCDEF])/);
  const decisionM  = content.match(/【投資判断[：:]\s*([^】\n]+)/);

  const risk       = riskM  ? parseInt(riskM[1])  : num(jsonData?.risk_score_100);
  const alpha      = alphaM ? parseInt(alphaM[1]) : num(jsonData?.alpha_score_100);

  // Backward compat: old JSON used _10 fields (0-10 scale); new JSON uses _100 (0-100 scale)
  const manipRisk = manipM ? parseInt(manipM[1])
    : jsonData?.manipulation_risk_score_100 != null
        ? num(jsonData.manipulation_risk_score_100)
        : jsonData?.manipulation_risk_score_10 != null
            ? Math.round((num(jsonData.manipulation_risk_score_10) ?? 0) * 10)
            : undefined;
  const smartMoney = smartM ? parseInt(smartM[1])
    : jsonData?.smart_money_score_100 != null
        ? num(jsonData.smart_money_score_100)
        : jsonData?.smart_money_score_10 != null
            ? Math.round((num(jsonData.smart_money_score_10) ?? 0) * 10)
            : undefined;
  const community  = communityM ? parseInt(communityM[1]) : num(jsonData?.community_score_100);
  const rank       = rankM      ? rankM[1].trim()         : (jsonData?.rank as string | undefined);
  const decision   = decisionM  ? decisionM[1].trim()     : (jsonData?.investment_decision as string | undefined);

  if (risk == null && alpha == null && rank == null) return null;

  let stopLossPct   = num(jsonData?.stop_loss_pct);
  let stopLossPrice = num(jsonData?.stop_loss_price);

  // 0 は「未設定」なのでクリア
  if (!stopLossPct  || stopLossPct  === 0) stopLossPct  = undefined;
  if (!stopLossPrice || stopLossPrice === 0) stopLossPrice = undefined;

  // stop_loss_trigger テキストからフォールバック抽出
  if (stopLossPct == null && jsonData?.stop_loss_trigger) {
    const t = String(jsonData.stop_loss_trigger);
    const pctM = t.match(/(-\d+(?:\.\d+)?)%/) ?? t.match(/(\d+(?:\.\d+)?)%.*下落/);
    if (pctM) stopLossPct = -Math.abs(parseFloat(pctM[1]));
  }
  if (stopLossPrice == null && jsonData?.stop_loss_trigger) {
    const t = String(jsonData.stop_loss_trigger);
    const priceM = t.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:以下|割れ|below)/i);
    if (priceM) stopLossPrice = parseFloat(priceM[1].replace(/,/g, ""));
  }

  return {
    risk, alpha, manipRisk, smartMoney, community,
    communityDetail: jsonData?.community_detail as string | undefined,
    stopLossPct,
    stopLossPrice,
    stopLossText: jsonData?.stop_loss_trigger as string | undefined,
    rank, decision,
    entryGuidance: jsonData?.entry_guidance         as string | undefined,
    profitTarget:  jsonData?.profit_target_trigger  as string | undefined,
    positionSize:  jsonData?.recommended_position_size as string | undefined,
  };
}

function ScoreBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  const pct = Math.min(100, value);
  return (
    <div className="bg-white rounded-lg p-3 border border-gray-100">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-sm font-bold text-gray-800">
          {value}<span className="text-xs text-gray-400 font-normal">/100</span>
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StopLossCard({ pct, price }: { pct?: number; price?: number }) {
  if (!pct && !price) return null;
  return (
    <div className="bg-red-950 border border-red-700 rounded-lg p-3">
      <div className="text-xs text-red-400 mb-1.5 font-semibold">✂️ 損切りライン</div>
      {pct !== undefined && (
        <div className="text-lg font-black text-red-300">
          エントリーから {pct}%
        </div>
      )}
      {price !== undefined && (
        <div className="text-sm font-bold text-red-200 mt-0.5">
          損切り価格: ${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}
        </div>
      )}
      <div className="text-[10px] text-red-500 mt-1.5 leading-relaxed">
        ⚠️ この価格を下回ったら即撤退
      </div>
    </div>
  );
}

const RANK_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  S: { bg: "bg-yellow-400", text: "text-black",  label: "即時エントリー候補" },
  A: { bg: "bg-green-500",  text: "text-white",  label: "優先検討" },
  B: { bg: "bg-blue-500",   text: "text-white",  label: "様子見" },
  C: { bg: "bg-gray-400",   text: "text-white",  label: "シグナル弱" },
  D: { bg: "bg-gray-700",   text: "text-white",  label: "静観" },
  E: { bg: "bg-orange-500", text: "text-white",  label: "回避推奨" },
  F: { bg: "bg-red-700",    text: "text-white",  label: "即回避" },
};

const RANK_BANNER_CONFIG: Record<string, {
  bg: string; border: string; text: string; subText: string; icon: string; label: string;
}> = {
  S: { bg: "bg-emerald-50",  border: "border-emerald-400", text: "text-emerald-900", subText: "text-emerald-700", icon: "🚀", label: "即エントリー推奨" },
  A: { bg: "bg-green-50",    border: "border-green-400",   text: "text-green-900",  subText: "text-green-700",  icon: "✅", label: "優先検討" },
  B: { bg: "bg-blue-50",     border: "border-blue-400",    text: "text-blue-900",   subText: "text-blue-700",   icon: "👀", label: "様子見・少額可" },
  C: { bg: "bg-gray-50",     border: "border-gray-400",    text: "text-gray-800",   subText: "text-gray-600",   icon: "⏳", label: "保留・条件待ち" },
  D: { bg: "bg-gray-100",    border: "border-gray-500",    text: "text-gray-700",   subText: "text-gray-500",   icon: "🚫", label: "静観" },
  E: { bg: "bg-orange-50",   border: "border-orange-400",  text: "text-orange-900", subText: "text-orange-700", icon: "⚠️", label: "回避推奨" },
  F: { bg: "bg-red-50",      border: "border-red-500",     text: "text-red-900",    subText: "text-red-700",    icon: "💀", label: "即回避" },
};

function getDecisionColor(decision: string): string {
  if (decision.includes("推奨") || decision.includes("Gem"))    return "bg-green-100 text-green-800 border-green-200";
  if (decision.includes("投機") || decision.includes("Degen"))  return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (decision.includes("要注意"))                              return "bg-orange-100 text-orange-800 border-orange-200";
  if (decision.includes("回避"))                               return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function InvestmentBanner({ scores }: { scores: ParsedScores }) {
  if (!scores.rank) return null;
  const cfg = RANK_BANNER_CONFIG[scores.rank] ?? RANK_BANNER_CONFIG.C;
  const rankStyle = RANK_BADGE[scores.rank] ?? RANK_BADGE.C;

  const summaryParts = [
    scores.entryGuidance ? `エントリー: ${scores.entryGuidance}` : null,
    scores.profitTarget  ? `利確: ${scores.profitTarget}` : null,
    scores.stopLossPct   ? `損切: ${scores.stopLossPct}%` : null,
    scores.positionSize  ? `推奨サイズ: ${scores.positionSize}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={`rounded-lg border-2 p-3 mb-3 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{cfg.icon}</span>
        <span className={`font-black text-base ${cfg.text}`}>{cfg.label}</span>
        <div className={`ml-auto w-10 h-10 rounded-full flex items-center justify-center text-xl font-black shadow ${rankStyle.bg} ${rankStyle.text}`}>
          {scores.rank}
        </div>
      </div>
      {scores.decision && (
        <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getDecisionColor(scores.decision)}`}>
          {scores.decision}
        </span>
      )}
      {summaryParts.length > 0 && (
        <div className={`text-xs ${cfg.subText} mt-1.5 leading-relaxed`}>
          {summaryParts.join(" ｜ ")}
        </div>
      )}
    </div>
  );
}

function ScoreGrid({ scores }: { scores: ParsedScores }) {
  const hasAny = [scores.risk, scores.alpha, scores.manipRisk, scores.smartMoney, scores.community]
    .some(v => v !== undefined);
  if (!hasAny && !scores.stopLossPct && !scores.stopLossPrice) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {scores.risk       !== undefined && <ScoreBar label="🔴 総合リスク"     value={scores.risk}       colorClass="bg-red-500"    />}
      {scores.alpha      !== undefined && <ScoreBar label="🟢 爆上げ期待値"   value={scores.alpha}      colorClass="bg-green-500"  />}
      {scores.manipRisk  !== undefined && <ScoreBar label="🟠 操作リスク"     value={scores.manipRisk}  colorClass="bg-orange-500" />}
      {scores.smartMoney !== undefined && <ScoreBar label="🔵 スマートマネー" value={scores.smartMoney} colorClass="bg-blue-500"   />}
      {scores.community  !== undefined && <ScoreBar label="🟣 コミュニティ"   value={scores.community}  colorClass="bg-purple-500" />}
      <StopLossCard pct={scores.stopLossPct} price={scores.stopLossPrice} />
    </div>
  );
}

// ─────────────────────────────────────────────
// ActionPlanCard
// ─────────────────────────────────────────────
function ActionPlanCard({ scores }: { scores: ParsedScores }) {
  const items = [
    { icon: "📥", label: "エントリー", value: scores.entryGuidance },
    { icon: "🎯", label: "利確目標",   value: scores.profitTarget },
    { icon: "✂️", label: "損切り",     value: scores.stopLossText || (scores.stopLossPct ? `エントリーから ${scores.stopLossPct}%` : undefined) },
    { icon: "📦", label: "推奨サイズ", value: scores.positionSize },
  ].filter(item => !!item.value);

  if (items.length === 0) return null;

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">💡 アクションプラン</div>
      <div className="space-y-2.5">
        {items.map(item => (
          <div key={item.label} className="flex gap-3 items-start">
            <span className="text-base shrink-0 w-6 mt-0.5">{item.icon}</span>
            <div>
              <span className="text-xs text-gray-500">{item.label}: </span>
              <span className="text-sm text-gray-200 font-medium">{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// renderMarkdown: 統合マークダウンレンダラー
// ─────────────────────────────────────────────
function renderMarkdown(raw: string): React.ReactElement {
  // Step 1: 前処理（thinking 除去 → HTML エスケープ → 記号整形）
  const text = raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
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

    // 空行
    if (!line) {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // 絵文字・番号で始まる行 → セクション見出し風
    if (
      /^[🔴🟢🟠🔵🟣✂️💡⚠️🚀✅👀⏳🚫💀📊🔍💰🗣️🌐📉🏦🔬🛡️💱⛓️👥🔓📈📄🚩🤖🔗]/.test(line) ||
      /^\d+[\.．]\s/.test(line)
    ) {
      elements.push(
        <div key={i} className="mt-4 mb-1 font-bold text-cyan-300 text-sm border-l-2 border-cyan-500 pl-2"
          dangerouslySetInnerHTML={{ __html: line.replace(/〖(.*?)〗/g, "<strong class='text-white'>$1</strong>") }}
        />
      );
      i++;
      continue;
    }

    // 箇条書き（連続する §BULLET§ をまとめて ul に）
    if (line.startsWith("§BULLET§")) {
      const bullets: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("§BULLET§")) {
        bullets.push(lines[i].trim().replace("§BULLET§", "").trim());
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1 pl-2">
          {bullets.map((b, j) => (
            <li key={j} className="flex gap-2 text-sm text-gray-300">
              <span className="text-cyan-500 mt-0.5 shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: b.replace(/〖(.*?)〗/g, "<strong class='text-white'>$1</strong>") }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // スコア行（"XX/100" または "XX/10" を含む）
    const scoreMatch = /(\d+)\/(100|10)/.exec(line);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1]);
      const max   = parseInt(scoreMatch[2]);
      const pct   = max === 10 ? score * 10 : score;
      const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
      const labelHtml = line.split(/\d+\/(?:100|10)/)[0]
        .replace(/〖(.*?)〗/g, "<strong class='text-white'>$1</strong>");
      elements.push(
        <div key={i} className="my-2 p-2 bg-gray-800 rounded">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-300" dangerouslySetInnerHTML={{ __html: labelHtml }} />
            <span className="font-bold text-white">{score}/{max}</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
            <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
      i++;
      continue;
    }

    // 通常テキスト
    elements.push(
      <p key={i} className="text-sm text-gray-700 leading-relaxed my-0.5"
        dangerouslySetInnerHTML={{ __html: line.replace(/〖(.*?)〗/g, "<strong class='text-white font-semibold'>$1</strong>") }}
      />
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ─────────────────────────────────────────────
// JSON 折りたたみ
// ─────────────────────────────────────────────
function CollapsibleJson({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md px-2.5 py-1 transition-colors hover:bg-gray-50"
      >
        <span>{open ? "▼" : "▶"}</span>
        <span>JSONデータを{open ? "閉じる" : "見る"}</span>
      </button>
      {open && (
        <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-700 overflow-x-auto leading-relaxed">
          {json}
        </pre>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// AiAnalysisCard（新設計）
// ─────────────────────────────────────────────
function AiAnalysisCard({ analysis }: { analysis: string }) {
  const { text, jsonData } = useMemo(() => processResponse(analysis), [analysis]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scores = useMemo(() => extractScores(jsonData as Record<string, any> | null, text), [jsonData, text]);
  const sections = useMemo(() => splitSections(text), [text]);

  const detailText = [sections.detail, sections.diag].filter(Boolean).join("\n\n").trim();

  return (
    <div className="space-y-4">
      {/* ① 投資判断バナー */}
      {scores && <InvestmentBanner scores={scores} />}

      {/* ② スコアカード6枚 */}
      {scores && <ScoreGrid scores={scores} />}

      {/* ③ アクションプラン（常時表示） */}
      {scores && <ActionPlanCard scores={scores} />}

      {/* ④ 詳細分析（折りたたみ・デフォルト閉） */}
      {detailText && (
        <details className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-gray-600 text-sm font-medium hover:bg-gray-100 select-none list-none flex items-center gap-2">
            <span>📄</span><span>詳細分析を見る</span><span className="ml-auto text-gray-400 text-xs">▶</span>
          </summary>
          <div className="px-4 py-4 border-t border-gray-200">
            {renderMarkdown(detailText)}
          </div>
        </details>
      )}

      {/* ⑤ JSONデータ（折りたたみ・デフォルト閉） */}
      {jsonData && (
        <details className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-gray-500 text-xs font-mono hover:bg-gray-800 select-none list-none flex items-center gap-2">
            <span>{"{ }"}</span><span>JSONデータ</span><span className="ml-auto text-gray-600 text-xs">▶</span>
          </summary>
          <pre className="px-4 py-4 text-xs text-gray-400 overflow-x-auto leading-relaxed border-t border-gray-700">
            {JSON.stringify(jsonData, null, 2)}
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
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
      style={{ borderLeft: "4px solid #6b7280" }}>
      <div className="px-4 py-2.5 bg-gray-50 flex items-center gap-2">
        <span className="text-base">🔗</span>
        <h3 className="font-semibold text-gray-800 text-sm">データソース</h3>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            ✅ {availableCount}件取得済み
          </span>
          <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-medium">
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
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{cat}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {catSources.map(src => (
                  src.status === "available" ? (
                    <a key={src.name} href={src.url} target="_blank" rel="noopener noreferrer" title={src.description}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">
                      <span>✅</span><span>{src.name}</span><span className="text-green-500 text-[10px]">取得済み ↗</span>
                    </a>
                  ) : (
                    <a key={src.name} href={src.url} target="_blank" rel="noopener noreferrer" title={src.description}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors">
                      <span>🔗</span><span>{src.name}</span><span className="text-orange-400 text-[10px]">詳細を見る ↗</span>
                    </a>
                  )
                ))}
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
function CoinCard({ coin }: { coin: CoinData }) {
  const up24 = coin.change24h >= 0;
  const up7d  = (coin.change7d ?? 0) >= 0;
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
      style={{ borderLeft: "4px solid #16a34a" }}>
      <div className="px-4 py-2.5 bg-green-50 flex items-center gap-2">
        <span className="text-base">📊</span>
        <h3 className="font-semibold text-gray-800 text-sm">価格 &amp; マーケット情報</h3>
        <span className="ml-auto text-xs text-gray-400">出典: CoinGecko</span>
      </div>
      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <span className="text-xl font-bold text-gray-900">{coin.name}</span>
            <span className="ml-2 text-sm text-gray-500 font-mono">{coin.symbol}</span>
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
              #{coin.rank}
            </span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{fmtPrice(coin.price)}</div>
        </div>
        <div className="flex gap-2 mb-4">
          <span className={`px-2.5 py-1 rounded text-sm font-medium ${up24 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {up24 ? "▲" : "▼"} 24h {Math.abs(coin.change24h).toFixed(2)}%
          </span>
          {coin.change7d !== null && (
            <span className={`px-2.5 py-1 rounded text-sm font-medium ${up7d ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {up7d ? "▲" : "▼"} 7d {Math.abs(coin.change7d).toFixed(2)}%
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "時価総額",    value: fmtLarge(coin.marketCap) },
            { label: "24h取引量",  value: fmtLarge(coin.volume24h) },
            { label: "ATH",         value: fmtPrice(coin.ath) },
            { label: "ATH比",       value: `${coin.athChange.toFixed(1)}%` },
            { label: "流通供給量",  value: fmtSupply(coin.circulatingSupply) },
            { label: "総供給量",    value: coin.totalSupply ? fmtSupply(coin.totalSupply) : "∞" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-md px-3 py-2">
              <div className="text-xs text-gray-500 mb-0.5">{label}</div>
              <div className="text-sm font-semibold text-gray-800">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Skeleton loader
// ─────────────────────────────────────────────
function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden animate-pulse">
      <div className="px-4 py-2.5 bg-gray-100 h-9" />
      <div className="px-4 py-4 space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 bg-gray-100 rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
type Tab = "chat" | "sector" | "batch" | "watchlist" | "history" | "portfolio";

const TAB_CONFIG: { id: Tab; label: string }[] = [
  { id: "chat",      label: "💬 個別分析" },
  { id: "sector",    label: "📊 セクター分析" },
  { id: "batch",     label: "📋 バッチ分析" },
  { id: "watchlist", label: "⭐ ウォッチリスト" },
  { id: "history",   label: "📈 履歴" },
  { id: "portfolio", label: "💼 ポートフォリオ" },
];

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (result?.query) setWatchlisted(isInWatchlist(result.query));
  }, [result?.query]);

  function handleBatchFromWatchlist(items: string[]) {
    setBatchPrefill(items.join("\n"));
    setActiveTab("batch");
  }
  function handleAnalyzeFromWidget(query: string) {
    setActiveTab("chat");
    search(query);
  }

  const search = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setResult({
      query: q,
      coin: null,
      links: null,
      tradingViewSymbol: null,
      aiAnalysis: null,
      dataSources: null,
      aiLoading: true,
      error: null,
    });
    setInput(q);
    setTimeout(() => window.scrollTo({ top: 200, behavior: "smooth" }), 100);

    const body = JSON.stringify({ query: q });
    const headers = { "Content-Type": "application/json" };

    // Fire both fetches simultaneously
    const infoFetch = fetch("/api/info", { method: "POST", headers, body });
    const chatFetch = fetch("/api/chat", { method: "POST", headers, body });

    // /api/info resolves fast (~3s) — update coin/links/chart immediately
    infoFetch
      .then(async (res) => {
        if (!res.ok) return;
        const info = await res.json();
        setResult(prev =>
          prev
            ? {
                ...prev,
                coin: info.coin ?? prev.coin,
                links: info.links ?? prev.links,
                tradingViewSymbol: info.tradingViewSymbol ?? prev.tradingViewSymbol,
              }
            : null
        );
      })
      .catch(() => {/* ignore info errors — chat stream is the fallback */});

    // /api/chat streams AI analysis
    try {
      const chatRes = await chatFetch;
      if (!chatRes.ok) {
        const text = await chatRes.text();
        throw new Error(text || `サーバーエラー (HTTP ${chatRes.status})`);
      }

      const reader = chatRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let metaParsed = false;
      let aiText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (!metaParsed) {
          buffer += chunk;
          const nlIdx = buffer.indexOf("\n");
          if (nlIdx !== -1) {
            try {
              const meta: { dataSources: DataSource[]; coin: CoinData | null; remainingCount?: number; dailyLimit?: number } =
                JSON.parse(buffer.slice(0, nlIdx));
              // Use chat metadata as fallback if /api/info hasn't resolved yet
              setResult(prev =>
                prev
                  ? {
                      ...prev,
                      coin: prev.coin ?? meta.coin,
                      dataSources: prev.dataSources ?? meta.dataSources,
                    }
                  : null
              );
              if (meta.remainingCount !== undefined) setRemainingCount(meta.remainingCount);
              if (meta.dailyLimit !== undefined) setDailyLimit(meta.dailyLimit);
            } catch { /* ignore */ }
            aiText = buffer.slice(nlIdx + 1);
            metaParsed = true;
            buffer = "";
          }
        } else {
          aiText += chunk;
        }

        if (metaParsed && aiText) {
          setResult(prev => prev ? { ...prev, aiAnalysis: aiText } : null);
        }
      }

      // JSON解析してスコア保存・ランク変化検出
      const jsonMatch = aiText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          if (data.rank && data.ticker_ca) {
            const record = {
              ticker: data.ticker_ca,
              date: new Date().toISOString().split("T")[0],
              rank: data.rank,
              alpha: data.alpha_score_100 || 0,
              risk: data.risk_score_100 || 0,
              savedAt: Date.now(),
            };
            saveScore(record);
            const change = detectRankChange(record);
            if (change) setRankChange(change);
          }
        } catch { }
      }

      setResult(prev => prev ? { ...prev, aiLoading: false } : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "通信エラーが発生しました";
      console.error("[ChatApp] fetch error:", err);
      setResult(prev => prev ? { ...prev, error: msg, aiLoading: false } : null);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); search(input); };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "var(--font-noto-sans-jp), 'Noto Sans JP', sans-serif" }}>
      <RankAlert change={rankChange} />
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-[800px] mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-green-600 text-xl font-bold">₿</span>
          <span className="font-bold text-gray-800 text-base">Crypto Terminal</span>
          <span className="text-xs text-gray-400 hidden sm:inline">リアルタイム暗号通貨情報</span>
          <div className="ml-auto">
            <FearGreedGauge />
          </div>
        </div>
      </header>

      {/* Price ticker */}
      <PriceTicker />

      {/* Tab bar */}
      <div className="border-b border-gray-200 bg-white overflow-x-auto">
        <div className="max-w-[800px] mx-auto px-4 flex gap-0.5 min-w-max">
          {TAB_CONFIG.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-green-500 text-green-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-[800px] mx-auto px-4 py-8">
        {activeTab === "sector"    && <SectorAnalyzer />}
        {activeTab === "batch"     && <BatchAnalyzer prefillText={batchPrefill} />}
        {activeTab === "watchlist" && <WatchList onBatchAnalyze={handleBatchFromWatchlist} onAnalyze={handleAnalyzeFromWidget} />}
        {activeTab === "history"   && <HistoryView />}
        {activeTab === "portfolio" && <PortfolioTabContent onGoToBatch={() => setActiveTab("batch")} />}
        {activeTab === "chat" && <>
        {/* Search */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">暗号通貨を検索</h1>
          <p className="text-sm text-gray-500 mb-6">
            銘柄名・ティッカー・日本語名・コントラクトアドレスで検索できます
          </p>

          <form onSubmit={handleSubmit} className="relative max-w-xl mx-auto">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="例: BTC、ビットコイン、ethereum、0x..."
              className="w-full pl-4 pr-24 py-3 rounded-lg border-2 border-gray-200 focus:border-green-500 focus:outline-none text-gray-800 text-sm transition-colors shadow-sm"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "検索中…" : "検索"}
            </button>
          </form>

          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {QUICK_COINS.map(coin => (
              <button key={coin} onClick={() => search(coin)} disabled={loading}
                className="px-3 py-1 text-xs font-mono font-semibold border border-gray-200 rounded-full text-gray-600 hover:border-green-500 hover:text-green-700 hover:bg-green-50 disabled:opacity-40 transition-colors">
                {coin}
              </button>
            ))}
          </div>
        </div>

        {/* Rate limit banner */}
        {remainingCount !== null && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg border text-sm font-medium flex items-center gap-2 ${
            remainingCount === 0
              ? "bg-red-50 border-red-200 text-red-600"
              : remainingCount <= 5
              ? "bg-orange-50 border-orange-200 text-orange-600"
              : "bg-gray-50 border-gray-200 text-gray-500"
          }`}>
            <span>🔢</span>
            <span>本日の残り分析回数: <strong>{remainingCount}</strong> / {dailyLimit}</span>
            {remainingCount === 0 && <span className="ml-auto">明日リセットされます</span>}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Status bar */}
            <div className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
              <span>検索:</span>
              <span className="font-semibold text-gray-800">{result.query}</span>
              <button
                onClick={() => {
                  if (watchlisted) {
                    // toggle off not implemented to keep it simple; just show state
                  } else {
                    addToWatchlist(result.query);
                    setWatchlisted(true);
                  }
                }}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  watchlisted
                    ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                    : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-yellow-50 hover:text-yellow-600"
                }`}
              >
                {watchlisted ? "★ ウォッチ済み" : "☆ ウォッチ追加"}
              </button>
              {(loading || result.aiLoading) && (
                <span className="ml-auto flex items-center gap-1.5 text-green-600 text-xs">
                  <span className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin inline-block" />
                  AI分析中…
                </span>
              )}
            </div>

            {result.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                ⚠️ {result.error}
              </div>
            )}

            {!result.coin && !result.aiLoading && !result.error && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-700">
                ⚠️ 銘柄が見つかりませんでした。別の名前で試してください。
              </div>
            )}

            {/* Link badges — shown as soon as /api/info responds */}
            {result.links && Object.values(result.links).some(Boolean) && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-3">
                <div className="text-xs text-gray-400 mb-2 font-medium">公式リンク</div>
                <LinkBadges links={result.links} />
              </div>
            )}

            {/* Coin card */}
            {result.coin ? (
              <CoinCard coin={result.coin} />
            ) : result.aiLoading && !result.error ? (
              <SkeletonCard lines={5} />
            ) : null}

            {/* TradingView chart — shown when symbol is available */}
            {result.tradingViewSymbol && (
              <Suspense fallback={<SkeletonCard lines={3} />}>
                <TradingViewChart symbol={result.tradingViewSymbol} />
              </Suspense>
            )}

            {/* AI analysis */}
            {result.aiLoading && !result.error ? (
              <>
                <SkeletonCard lines={4} />
                <SkeletonCard lines={3} />
                <SkeletonCard lines={5} />
              </>
            ) : result.aiAnalysis ? (
              <AiAnalysisCard analysis={result.aiAnalysis} />
            ) : null}

            {/* Data sources panel */}
            {!result.aiLoading && result.dataSources && result.dataSources.length > 0 && (
              <DataSourcesPanel sources={result.dataSources} />
            )}
          </div>
        )}

        {!result && (
          <div className="text-center py-12 text-gray-300">
            <div className="text-6xl mb-4">🔍</div>
            <p className="text-sm text-gray-400">銘柄名を入力して検索してください</p>
          </div>
        )}

        {/* Trending + News */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <TrendingCoins onAnalyze={handleAnalyzeFromWidget} />
          <NewsPanel highlightTicker={result?.query ?? ""} />
        </div>
        </>}
      </main>

      <footer className="border-t border-gray-100 mt-12">
        <div className="max-w-[800px] mx-auto px-4 py-4 text-center text-xs text-gray-400">
          データ提供: CoinGecko · DEXScreener · GeckoTerminal · AI分析: Anthropic Claude
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────
// Portfolio Tab (reads last batch results from localStorage)
// ─────────────────────────────────────────────
function PortfolioTabContent({ onGoToBatch }: { onGoToBatch: () => void }) {
  const [results, setResults] = useState<PortfolioResult[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lastBatchResults");
      if (saved) setResults(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  if (results.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="text-5xl text-gray-200">💼</div>
        <p className="text-sm text-gray-400">
          バッチ分析を実行すると<br />ここにポートフォリオ配分が表示されます
        </p>
        <button
          onClick={onGoToBatch}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-bold transition-colors"
        >
          📋 バッチ分析へ
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-bold text-indigo-600">💼 ポートフォリオ配分</h2>
      <p className="text-xs text-gray-400">最後のバッチ分析結果をもとに算出</p>
      <PortfolioCalc results={results} />
    </div>
  );
}
