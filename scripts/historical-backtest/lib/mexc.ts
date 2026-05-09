export const MEXC_BASE = "https://api.mexc.com";

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "bell-crypto-terminal/historical-backtest";

export class MexcApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
  ) {
    super(`MEXC API ${status} ${statusText} at ${url}`);
    this.name = "MexcApiError";
  }
}

export async function mexcFetch<T = unknown>(
  path: string,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2 } = options;
  const url = `${MEXC_BASE}${path}`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timer);
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const wait = 1000 * (attempt + 1);
          console.warn(`  [retry ${attempt + 1}/${retries}] ${res.status} → wait ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw new MexcApiError(res.status, res.statusText, url);
      }
      return (await res.json()) as T;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        const wait = 1000 * (attempt + 1);
        console.warn(`  [retry ${attempt + 1}/${retries}] ${(e as Error).message} → wait ${wait}ms`);
        await sleep(wait);
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`MEXC fetch failed: ${url}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export interface MexcKlineRaw {
  success: boolean;
  code: number;
  data: {
    time: number[];
    open: string[];
    close: string[];
    high: string[];
    low: string[];
    vol: string[];
    amount: string[];
  };
}

export type KlineBar = readonly [
  number,  // openTimeSec (Unix sec)
  number,  // open
  number,  // high
  number,  // low
  number,  // close
  number,  // volume (base coin)
  number,  // amount (USDT)
];

export type MexcInterval =
  | "Min1" | "Min5" | "Min15" | "Min30" | "Min60"
  | "Hour4" | "Hour8" | "Day1" | "Week1" | "Month1";

export async function fetchKlineRange(
  symbol: string,
  interval: MexcInterval,
  startSec: number,
  endSec: number,
): Promise<KlineBar[]> {
  const path = `/api/v1/contract/kline/${symbol}?interval=${interval}&start=${startSec}&end=${endSec}`;
  const res = await mexcFetch<MexcKlineRaw>(path, { timeoutMs: 12_000, retries: 2 });

  if (!res.success || !res.data) {
    return [];
  }

  const { time, open, high, low, close, vol, amount } = res.data;
  const len = time?.length ?? 0;
  if (len === 0) return [];

  const bars: KlineBar[] = [];
  for (let i = 0; i < len; i++) {
    const t = time[i];
    const o = parseFloat(open[i] ?? "0");
    const h = parseFloat(high[i] ?? "0");
    const l = parseFloat(low[i] ?? "0");
    const c = parseFloat(close[i] ?? "0");
    const v = parseFloat(vol?.[i] ?? "0");
    const a = parseFloat(amount?.[i] ?? "0");
    if (t > 0 && o > 0 && c > 0) {
      bars.push([t, o, h, l, c, v, a]);
    }
  }
  return bars;
}
