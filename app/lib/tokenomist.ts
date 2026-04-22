const API_KEY = process.env.TOKENOMIST_API_KEY ?? "";
const BASE = "https://api.tokenomist.ai/v1";

export interface UnlockData {
  nextUnlockDate: string | null;
  nextUnlockDays: number | null;
  nextUnlockPercent: number | null;
  nextUnlockAmount: number | null;
}

const _cache = new Map<string, { data: UnlockData; ts: number }>();
const TTL = 5 * 60_000;

async function apiFetch(path: string): Promise<unknown> {
  if (!API_KEY) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-api-key": API_KEY },
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(tid);
    return null;
  }
}

export async function fetchUnlockData(symbol: string): Promise<UnlockData> {
  const sym = symbol.toUpperCase();
  const hit = _cache.get(sym);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const empty: UnlockData = {
    nextUnlockDate: null,
    nextUnlockDays: null,
    nextUnlockPercent: null,
    nextUnlockAmount: null,
  };
  if (!API_KEY) return empty;

  const raw = await apiFetch(`/unlock/upcoming?symbol=${sym}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = raw as any;

  const unlock = d?.data?.[0] ?? d?.data ?? null;
  if (!unlock) {
    _cache.set(sym, { data: empty, ts: Date.now() });
    return empty;
  }

  const unlockDate =
    unlock.unlockDate ?? unlock.date ?? unlock.timestamp ?? unlock.cliffDate ?? null;
  let daysUntil: number | null = null;
  if (unlockDate) {
    const ms = new Date(unlockDate).getTime() - Date.now();
    daysUntil = Math.max(0, Math.round(ms / 86_400_000));
  }

  const result: UnlockData = {
    nextUnlockDate: unlockDate ?? null,
    nextUnlockDays: daysUntil,
    nextUnlockPercent:
      unlock.percent ?? unlock.supplyPercent ?? unlock.percentage ?? unlock.unlockPercent ?? null,
    nextUnlockAmount:
      unlock.amount ?? unlock.tokenAmount ?? unlock.tokens ?? unlock.unlockAmount ?? null,
  };

  _cache.set(sym, { data: result, ts: Date.now() });
  return result;
}

export function formatUnlock(d: UnlockData): string {
  if (!API_KEY || d.nextUnlockDays === null) return "";
  const parts: string[] = [`次回アンロック:${d.nextUnlockDays}日後`];
  if (d.nextUnlockPercent !== null) parts.push(`${d.nextUnlockPercent.toFixed(1)}%放出`);
  if (d.nextUnlockDate) {
    const dateStr = new Date(d.nextUnlockDate).toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
    });
    parts.push(dateStr);
  }
  return `Tokenomist[${parts.join(", ")}]`;
}

export function unlockRiskScore(d: UnlockData): number {
  if (d.nextUnlockDays === null) return 0;
  const pct = d.nextUnlockPercent ?? 0;
  if (d.nextUnlockDays <= 7) return pct >= 5 ? 20 : 15;
  if (d.nextUnlockDays <= 30) return pct >= 5 ? 15 : 10;
  return 0;
}
