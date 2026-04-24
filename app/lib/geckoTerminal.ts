// GeckoTerminal free API (no key required) – 30 req/min rate limit

const GT_BASE = "https://api.geckoterminal.com/api/v2";
const CACHE_TTL_MS = 5 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _cache = new Map<string, { data: any; ts: number }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCached(key: string): any | null {
  const e = _cache.get(key);
  if (!e || Date.now() - e.ts > CACHE_TTL_MS) return null;
  return e.data;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCached(key: string, data: any): void {
  _cache.set(key, { data, ts: Date.now() });
}

export interface GtDexData {
  liquidity: number | null;
  liquidityMcRatio: number | null;
  topPair: string | null;
  dexVolume24h: number | null;
}

// "PEPE_USDT" → "PEPE"
function toBaseSymbol(mexcSymbol: string): string {
  return mexcSymbol.replace(/_USDT$/i, "").replace(/_.*$/, "");
}

export async function fetchGtDexData(mexcSymbol: string): Promise<GtDexData | null> {
  const query = toBaseSymbol(mexcSymbol);
  const cacheKey = `gt:${query}`;

  const hit = getCached(cacheKey);
  if (hit !== null) return hit as GtDexData;

  try {
    const res = await fetch(
      `${GT_BASE}/search/pools?query=${encodeURIComponent(query)}&include=base_token`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) { setCached(cacheKey, null); return null; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as { data?: any[] };
    if (!json.data?.length) { setCached(cacheKey, null); return null; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pools: any[] = json.data;
    const upper = query.toUpperCase();

    // Prefer pools where the base token name starts with our symbol
    const matching = pools.filter(p => {
      const name: string = (p.attributes?.name ?? "").toUpperCase();
      return name.startsWith(`${upper} /`) || name.startsWith(`${upper}/`);
    });
    const candidates = matching.length > 0 ? matching : pools;

    // Pick the pool with the highest reserve_in_usd
    const best = candidates
      .filter(p => parseFloat(p.attributes?.reserve_in_usd ?? "0") > 0)
      .sort((a, b) =>
        parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd),
      )[0];

    if (!best) { setCached(cacheKey, null); return null; }

    const attrs = best.attributes;
    const liquidity    = parseFloat(attrs.reserve_in_usd ?? "0") || null;
    const fdv          = parseFloat(attrs.fdv_usd ?? "0") || parseFloat(attrs.market_cap_usd ?? "0") || null;
    const liquidityMcRatio = liquidity && fdv ? (liquidity / fdv) * 100 : null;
    const topPair      = (attrs.name as string | undefined) ?? null;
    const dexVolume24h = parseFloat(attrs.volume_usd?.h24 ?? "0") || null;

    const result: GtDexData = { liquidity, liquidityMcRatio, topPair, dexVolume24h };
    setCached(cacheKey, result);
    return result;
  } catch {
    setCached(cacheKey, null);
    return null;
  }
}
