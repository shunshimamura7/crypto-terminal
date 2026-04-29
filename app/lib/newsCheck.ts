import type { CoinNewsContext } from "@/app/lib/shortScorer";
export type { CoinNewsContext };

const CRYPTOPANIC_KEY = process.env.CRYPTOPANIC_API_KEY ?? "";
const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/free/v1";

const _cache = new Map<string, { data: CoinNewsContext; ts: number }>();
const TTL = 30 * 60_000;

const EMPTY: CoinNewsContext = {
  positiveCount: 0,
  negativeCount: 0,
  hasMajorListing: false,
  hasPartnership: false,
  hasSecurity: false,
  newsUrls: [],
};

function store(coin: string, data: CoinNewsContext): CoinNewsContext {
  _cache.set(coin, { data, ts: Date.now() });
  return data;
}

export async function fetchCoinNews(symbol: string): Promise<CoinNewsContext> {
  if (!CRYPTOPANIC_KEY) return { ...EMPTY };

  const coin = symbol.replace(/_USDT$/i, "").toUpperCase();
  const hit = _cache.get(coin);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  try {
    const url = `${CRYPTOPANIC_BASE}/posts/?auth_token=${CRYPTOPANIC_KEY}&currencies=${coin}&public=true&kind=news`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return store(coin, { ...EMPTY });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = json?.results ?? [];

    let positiveCount = 0, negativeCount = 0;
    let hasMajorListing = false, hasPartnership = false, hasSecurity = false;
    const newsUrls: string[] = [];

    for (const item of results.slice(0, 10)) {
      const votes = item.votes ?? {};
      positiveCount += (votes.positive ?? 0) + (votes.liked ?? 0);
      negativeCount += (votes.negative ?? 0) + (votes.disliked ?? 0);

      const text: string = ((item.title ?? "") + " " + (item.domain ?? "")).toLowerCase();
      if (/binance|coinbase|upbit|bithumb|kraken|listing|上場/.test(text)) hasMajorListing = true;
      if (/partnership|collaboration|integration|partner|提携/.test(text)) hasPartnership = true;
      if (/hack|exploit|security|breach|vulnerability|脆弱|攻撃/.test(text)) hasSecurity = true;
      if (item.url) newsUrls.push(item.url as string);
    }

    return store(coin, {
      positiveCount, negativeCount,
      hasMajorListing, hasPartnership, hasSecurity,
      newsUrls: newsUrls.slice(0, 3),
    });
  } catch {
    return store(coin, { ...EMPTY });
  }
}
