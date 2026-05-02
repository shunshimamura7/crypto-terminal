import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── KV ──
const KV_WATCHLIST = "bell:fr-watchlist";

function createRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL   ?? process.env.KV_REST_API_URL   ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function getWatchlistFromKV(): Promise<string[]> {
  const redis = createRedis();
  if (!redis) return [];
  try {
    const result = await redis.get<string[]>(KV_WATCHLIST);
    if (!result || !Array.isArray(result)) return [];
    return result;
  } catch { return []; }
}

// ── Per-symbol KV state (OI/出来高比較用) ──
interface SymbolKvState {
  fr: number;
  oi: number;
  vol: number;
  ts: number;
  peakVol: number;
}

function kvStateKey(symbol: string) { return `bell:fr-state:${symbol}`; }

async function getKvState(redis: Redis, symbol: string): Promise<SymbolKvState | null> {
  try { return await redis.get<SymbolKvState>(kvStateKey(symbol)); } catch { return null; }
}

async function setKvState(redis: Redis, symbol: string, state: SymbolKvState): Promise<void> {
  try { await redis.set(kvStateKey(symbol), state, { ex: 90_000 }); } catch { /* ignore */ }
}

// ── 閾値定数 ──
const THRESHOLDS = {
  SHORT_DANGER: -0.001,
  SHORT_CAUTION: -0.0005,
  SHORT_FAVORABLE: 0.0005,
  SHORT_VERY_FAVORABLE: 0.001,
  LONG_DANGER: 0.001,
};

type AlertType =
  | "SHORT_DANGER"
  | "SHORT_CAUTION"
  | "SHORT_VERY_FAVORABLE"
  | "SHORT_FAVORABLE"
  | "LONG_DANGER"
  | "NEUTRAL";

interface SymbolInMemState {
  lastFr: number;
  lastAlertType: AlertType;
  lastAlertTime: number;
}

// In-memory state — resets on cold start (acceptable)
const symbolStateMap = new Map<string, SymbolInMemState>();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

function classifyFr(fr: number): AlertType {
  if (fr <= THRESHOLDS.SHORT_DANGER)       return "SHORT_DANGER";
  if (fr <= THRESHOLDS.SHORT_CAUTION)      return "SHORT_CAUTION";
  if (fr >= THRESHOLDS.LONG_DANGER)        return "LONG_DANGER";
  if (fr >= THRESHOLDS.SHORT_VERY_FAVORABLE) return "SHORT_VERY_FAVORABLE";
  if (fr >= THRESHOLDS.SHORT_FAVORABLE)    return "SHORT_FAVORABLE";
  return "NEUTRAL";
}

function frStr(fr: number): string {
  return (fr >= 0 ? "+" : "") + (fr * 100).toFixed(2) + "%";
}

function frStatusLabel(type: AlertType): string {
  switch (type) {
    case "SHORT_DANGER":         return "⛔禁止";
    case "SHORT_CAUTION":        return "⚠️注意";
    case "LONG_DANGER":          return "🔻優勢 ⚠️ロング危険";
    case "SHORT_VERY_FAVORABLE": return "🔻優勢";
    case "SHORT_FAVORABLE":      return "🔻有利";
    default:                     return "⚪中立";
  }
}

function formatTimeUntil(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "まもなく";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m後` : `${m}m後`;
}

function fmtK(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// ── MEXC ticker (FR + OI + vol) ──
interface TickerData {
  fr: number;
  oi: number;       // holdVol (USD相当)
  vol: number;      // volume24 (USD相当)
  nextSettleTime: number;
}

// ── MEXC fetch helpers (short-scanと同じ方式) ──
const MEXC = "https://api.mexc.com";

async function fetchWithTimeout(url: string, ms = 10_000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mexcGet(path: string, ms = 10_000): Promise<any> {
  const res = await fetchWithTimeout(`${MEXC}${path}`, ms);
  if (!res?.ok) return null;
  try { return await res.json(); } catch { return null; }
}

async function fetchTicker(symbol: string): Promise<TickerData | null> {
  const pair = `${symbol}_USDT`;
  console.log(`[fr-alert] fetching ticker+fr for ${pair}`);
  try {
    const [trJson, frJson] = await Promise.all([
      mexcGet(`/api/v1/contract/ticker/${pair}`),
      mexcGet(`/api/v1/contract/funding_rate/${pair}`),
    ]);

    // FR必須 — 取得失敗でERROR
    if (!frJson?.success) {
      console.log(`[fr-alert] ${symbol} FR failed: ${JSON.stringify(frJson).slice(0, 200)}`);
      return null;
    }

    // ticker はオプショナル — 失敗してもFR値だけで続行
    const tickerOk = !!(trJson?.success);
    if (!tickerOk) {
      console.log(`[fr-alert] ${symbol} ticker failed, using FR only`);
    }

    const f = frJson.data;
    const t = tickerOk ? trJson.data : null;
    console.log(`[fr-alert] ${symbol} ok fr=${f.fundingRate} ticker=${tickerOk}`);
    return {
      fr: Number(f.fundingRate),
      oi: Number(t?.holdVol ?? 0),
      vol: Number(t?.volume24 ?? 0),
      nextSettleTime: Number(f.nextSettleTime),
    };
  } catch (e) {
    console.log(`[fr-alert] ${symbol} exception: ${e}`);
    return null;
  }
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.FR_ALERT_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.FR_ALERT_CHAT_ID;
  if (!token || !chatId) {
    return Response.json({ error: "TELEGRAM_BOT_TOKEN or FR_ALERT_CHAT_ID not set" }, { status: 500 });
  }

  const redis = createRedis();

  const kvList  = await getWatchlistFromKV();
  const envList = (process.env.FR_WATCHLIST || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const symbols = kvList.length > 0 ? kvList : envList.length > 0 ? envList : ["APE", "KAT", "ZKJ"];

  const fetched = await Promise.allSettled(symbols.map(fetchTicker));

  const now = Date.now();
  const nowDate = new Date(now);
  const isHourly = nowDate.getUTCMinutes() < 5;

  interface ResultItem { symbol: string; fr: number | null; status: AlertType | "ERROR"; }
  const resultItems: ResultItem[] = [];

  const dangerAlerts:    { symbol: string; fr: number; type: AlertType }[] = [];
  const recoveryAlerts:  { symbol: string; fr: number; prevFr: number; prevType: AlertType }[] = [];
  const entrySignals:    { symbol: string; fr: number; prevOi: number; curOi: number; curVol: number; peakVol: number }[] = [];
  const favorableAlerts: { symbol: string; fr: number; type: AlertType }[] = [];

  let earliestNextSettle: number | undefined;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const result = fetched[i];

    if (result.status === "rejected" || result.value === null) {
      resultItems.push({ symbol, fr: null, status: "ERROR" });
      continue;
    }

    const { fr, oi, vol, nextSettleTime } = result.value;
    const alertType = classifyFr(fr);
    resultItems.push({ symbol, fr, status: alertType });
    if (!earliestNextSettle || nextSettleTime < earliestNextSettle) earliestNextSettle = nextSettleTime;

    // KV状態取得 + 更新
    const prevKv = redis ? await getKvState(redis, symbol) : null;
    const peakVol = Math.max(vol, prevKv?.peakVol ?? 0);
    const newKvState: SymbolKvState = { fr, oi, vol, ts: now, peakVol };
    if (redis) await setKvState(redis, symbol, newKvState);

    // In-memory FR状態
    const prev = symbolStateMap.get(symbol);
    const prevType: AlertType = prev?.lastAlertType ?? "NEUTRAL";
    const lastAlertTime = prev?.lastAlertTime ?? 0;
    const cooldownOk = now - lastAlertTime > ALERT_COOLDOWN_MS;
    const newInMem: SymbolInMemState = { lastFr: fr, lastAlertType: alertType, lastAlertTime };

    const wasWarning = prevType === "SHORT_DANGER" || prevType === "SHORT_CAUTION";
    const isRecovered = alertType !== "SHORT_DANGER" && alertType !== "SHORT_CAUTION";

    if (wasWarning && isRecovered && prev) {
      // OI減少 + 出来高ピーク比50%以下 → エントリーシグナル
      const oiDecreasing = prevKv ? oi < prevKv.oi : false;
      const volCooled    = peakVol > 0 && vol < peakVol * 0.5;
      if (oiDecreasing && volCooled) {
        entrySignals.push({ symbol, fr, prevOi: prevKv!.oi, curOi: oi, curVol: vol, peakVol });
      } else {
        recoveryAlerts.push({ symbol, fr, prevFr: prev.lastFr, prevType });
      }
      newInMem.lastAlertTime = now;
      symbolStateMap.set(symbol, newInMem);
      continue;
    }

    const shouldAlert = cooldownOk || prevType !== alertType;

    if (alertType === "SHORT_DANGER" || alertType === "SHORT_CAUTION") {
      if (shouldAlert) { dangerAlerts.push({ symbol, fr, type: alertType }); newInMem.lastAlertTime = now; }
    } else if (alertType === "SHORT_VERY_FAVORABLE" || alertType === "SHORT_FAVORABLE" || alertType === "LONG_DANGER") {
      if (shouldAlert) { favorableAlerts.push({ symbol, fr, type: alertType }); newInMem.lastAlertTime = now; }
    }

    symbolStateMap.set(symbol, newInMem);
  }

  const settleStr = earliestNextSettle ? formatTimeUntil(earliestNextSettle) : "不明";
  let alertCount = 0;

  // 危険アラート
  if (dangerAlerts.length > 0) {
    const lines = dangerAlerts.map(a => {
      const icon  = a.type === "SHORT_DANGER" ? "⛔" : "⚠️";
      const label = a.type === "SHORT_DANGER" ? "ショート禁止" : "ショート注意";
      return `${icon} ${a.symbol} | FR: ${frStr(a.fr)}/8h | ${label}`;
    });
    await sendTelegram(token, chatId, ["🚨 FR危険アラート", "━━━━━━━━━━━━━━", ...lines, "━━━━━━━━━━━━━━", `次回精算: ${settleStr}`].join("\n"));
    alertCount++;
  }

  // ショートエントリーシグナル（OI/出来高条件付き回復）
  if (entrySignals.length > 0) {
    const lines = entrySignals.map(a => {
      const oiChg = a.prevOi > 0 ? ((a.curOi - a.prevOi) / a.prevOi * 100).toFixed(0) : "?";
      const volPct = a.peakVol > 0 ? (a.curVol / a.peakVol * 100).toFixed(0) : "?";
      return [
        `${a.symbol} | Phase: 安定期`,
        `FR: ${frStr(a.fr)}/8h（中立圏 ✓）`,
        `OI: ${fmtK(a.prevOi)} → ${fmtK(a.curOi)}（${oiChg}% ✓）`,
        `出来高: ピーク比 ${volPct}%（消化済 ✓）`,
      ].join("\n");
    });
    await sendTelegram(token, chatId, ["✅ ショートエントリーシグナル", "━━━━━━━━━━━━━━", ...lines, "━━━━━━━━━━━━━━", "→ ショートエントリー検討可"].join("\n"));
    alertCount++;
  }

  // 通常回復アラート
  if (recoveryAlerts.length > 0) {
    const lines = recoveryAlerts.map(a => {
      const prevLabel = a.prevType === "SHORT_DANGER" ? "禁止域" : "注意域";
      return `${a.symbol} | FR: ${frStr(a.fr)}/8h | ショート検討可\n前回: ${frStr(a.prevFr)}/8h（${prevLabel}）→ 回復`;
    });
    await sendTelegram(token, chatId, ["✅ FR回復アラート", "━━━━━━━━━━━━━━", ...lines, "━━━━━━━━━━━━━━"].join("\n"));
    alertCount++;
  }

  // 有利アラート
  if (favorableAlerts.length > 0) {
    const lines = favorableAlerts.map(a => {
      const label = a.type === "LONG_DANGER" || a.type === "SHORT_VERY_FAVORABLE" ? "ショート優勢" : "ショート有利";
      return `${a.symbol} | FR: ${frStr(a.fr)}/8h | ${label}`;
    });
    await sendTelegram(token, chatId, ["🔻 ショート有利アラート", "━━━━━━━━━━━━━━", ...lines, "━━━━━━━━━━━━━━"].join("\n"));
    alertCount++;
  }

  // 定時サマリー
  if (isHourly) {
    const jstHour = (nowDate.getUTCHours() + 9) % 24;
    const validItems = resultItems.filter(i => i.fr !== null);
    const maxLen = Math.max(...validItems.map(i => i.symbol.length), 4);
    const lines = validItems.map(item => {
      const padded = item.symbol.padEnd(maxLen);
      return `${padded} | ${frStr(item.fr as number)}/8h | ${frStatusLabel(item.status as AlertType)}`;
    });
    await sendTelegram(token, chatId, [
      `📊 FR定時サマリー [${String(jstHour).padStart(2, "0")}:00 JST]`,
      "━━━━━━━━━━━━━━",
      ...lines,
      "━━━━━━━━━━━━━━",
      `次回精算: ${settleStr}`,
    ].join("\n"));
    alertCount++;
  }

  return Response.json({ ok: true, checked: symbols.length, alerts: alertCount, results: resultItems });
}
