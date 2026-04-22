import type { SocialData } from "./socialScore";

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// Module-level cache for community data populated by fetchCoinGecko calls
const communityCache = new Map<string, SocialData>();

export function getCachedCommunity(query: string): SocialData | null {
  return communityCache.get(query.toLowerCase()) ?? null;
}

async function fetchCoinGecko(query: string): Promise<string> {
  const knownIds: Record<string, string> = {
    btc: "bitcoin", eth: "ethereum", sol: "solana", xrp: "ripple",
    bnb: "binancecoin", doge: "dogecoin", avax: "avalanche-2",
    link: "chainlink", ada: "cardano", dot: "polkadot",
    uni: "uniswap", atom: "cosmos", near: "near", arb: "arbitrum",
    op: "optimism", sui: "sui", apt: "aptos", inj: "injective-protocol",
    pepe: "pepe", shib: "shiba-inu", bonk: "bonk",
  };

  const tryId = async (id: string, queryKey: string): Promise<string | null> => {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&sparkline=false`,
      6000
    );
    if (!res?.ok) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d: any = await res.json();
      const md = d?.market_data;
      const cd = d?.community_data;
      if (!md) return null;

      const price  = md.current_price?.usd ?? 0;
      const mc     = md.market_cap?.usd ?? 0;
      const vol    = md.total_volume?.usd ?? 0;
      const ch24   = md.price_change_percentage_24h ?? 0;
      const ch7d   = md.price_change_percentage_7d ?? 0;
      const ath    = md.ath?.usd ?? 0;
      const fdv    = md.fully_diluted_valuation?.usd ?? 0;
      const athDrop = ath > 0 ? ((ath - price) / ath * 100).toFixed(0) : "N/A";
      const mcFdv   = fdv > 0 ? (mc / fdv).toFixed(2) : "N/A";
      const circ    = md.circulating_supply ?? 0;
      const total   = md.total_supply ?? 0;
      const circRatio = total > 0 ? (circ / total * 100).toFixed(0) : "N/A";
      const sentiment = d.sentiment_votes_up_percentage
        ? `強気投票:${d.sentiment_votes_up_percentage.toFixed(0)}%`
        : "";

      // Cache community data for later XHeat calculation
      const social: SocialData = {
        twitterFollowers: cd?.twitter_followers ?? null,
        redditSubscribers: cd?.reddit_subscribers ?? null,
        redditPosts48h: cd?.reddit_average_posts_48h ?? null,
        communityScore: d.community_score ?? null,
      };
      communityCache.set(queryKey, social);

      // Community data for prompt
      const commParts: string[] = [];
      if (social.twitterFollowers) commParts.push(`TW:${(social.twitterFollowers / 1000).toFixed(0)}K`);
      if (social.redditSubscribers) commParts.push(`Reddit:${(social.redditSubscribers / 1000).toFixed(0)}K`);
      if (social.communityScore) commParts.push(`CS:${social.communityScore.toFixed(0)}`);

      return [
        `CoinGecko: ${d.name}(${(d.symbol || "").toUpperCase()})`,
        `価格:$${price}`,
        `MC:${fmtUsd(mc)}`,
        `Vol24h:${fmtUsd(vol)}`,
        `24h:${ch24.toFixed(1)}%`,
        `7d:${ch7d.toFixed(1)}%`,
        `ATH比:-${athDrop}%`,
        `MC/FDV:${mcFdv}`,
        `流通率:${circRatio}%`,
        sentiment,
        commParts.length > 0 ? `SNS(${commParts.join(", ")})` : "",
      ].filter(Boolean).join(", ");
    } catch { return null; }
  };

  const qKey = query.toLowerCase();
  const knownId = knownIds[qKey];
  if (knownId) {
    const r = await tryId(knownId, qKey);
    if (r) return r;
  }

  const sr = await fetchWithTimeout(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, 5000);
  if (!sr?.ok) return `CoinGecko(${query}): データなし`;
  try {
    const sd = await sr.json();
    const foundId: string | undefined = sd.coins?.[0]?.id;
    if (!foundId) return `CoinGecko(${query}): 銘柄不明`;
    const r = await tryId(foundId, qKey);
    return r ?? `CoinGecko(${query}): データなし`;
  } catch { return `CoinGecko(${query}): パース失敗`; }
}

async function fetchDexScreener(query: string): Promise<string> {
  const res = await fetchWithTimeout(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
    5000
  );
  if (!res?.ok) return "DEXScreener: データなし";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const pairs = (data.pairs ?? []).slice(0, 3);
    if (pairs.length === 0) return "DEXScreener: ペアなし";
    return pairs.map((p: {
      chainId: string; dexId: string; priceUsd?: string;
      liquidity?: { usd?: number }; volume?: { h24?: number };
      priceChange?: { h24?: number }; txns?: { h24?: { buys?: number; sells?: number } };
    }) => {
      const buys  = p.txns?.h24?.buys ?? 0;
      const sells = p.txns?.h24?.sells ?? 0;
      return `DEX[${p.chainId}/${p.dexId}]: $${p.priceUsd ?? "N/A"}, Liq:${fmtUsd(p.liquidity?.usd ?? 0)}, Vol24h:${fmtUsd(p.volume?.h24 ?? 0)}, 24h:${(p.priceChange?.h24 ?? 0).toFixed(1)}%, Txn(買:${buys}/売:${sells})`;
    }).join("\n");
  } catch { return "DEXScreener: パース失敗"; }
}

async function fetchGeckoTerminal(query: string): Promise<string> {
  const res = await fetchWithTimeout(
    `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(query)}&page=1`,
    5000
  );
  if (!res?.ok) return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const pools = (data.data ?? []).slice(0, 2);
    if (pools.length === 0) return "";
    return pools.map((p: { attributes?: {
      name?: string; reserve_in_usd?: string; volume_usd?: { h24?: string };
      price_change_percentage?: { h24?: string }; transactions?: { h24?: { buys?: number; sells?: number } };
    }}) => {
      const attr = p.attributes ?? {};
      return `GeckoTerminal[${attr.name ?? "?"}]: Reserve:${fmtUsd(parseFloat(attr.reserve_in_usd ?? "0"))}, Vol24h:${fmtUsd(parseFloat(attr.volume_usd?.h24 ?? "0"))}, 24h:${parseFloat(attr.price_change_percentage?.h24 ?? "0").toFixed(1)}%`;
    }).join("\n");
  } catch { return ""; }
}

async function fetchGoPlus(query: string): Promise<string> {
  // GoPlus requires contract address — skip for ticker queries
  if (!/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(query)) {
    return "";
  }
  const isSolana = !/^0x/.test(query);
  const url = isSolana
    ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${query}`
    : `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${query}`;
  const res = await fetchWithTimeout(url, 5000);
  if (!res?.ok) return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const data = json?.result?.[query.toLowerCase()] ?? json?.result?.[query];
    if (!data) return "";
    const flags: string[] = [];
    if (data.is_honeypot === "1") flags.push("ハニーポット⚠️");
    if (data.is_mintable === "1") flags.push("Mint権限⚠️");
    if (data.can_take_back_ownership === "1") flags.push("Owner奪還可⚠️");
    if (parseFloat(data.sell_tax ?? "0") > 10) flags.push(`売りTax:${data.sell_tax}%`);
    if (data.is_open_source === "0") flags.push("非公開コード");
    const lpLocked = data.lp_holders?.some((h: { is_locked?: number }) => h.is_locked === 1);
    const top10Holder = data.holders?.slice(0, 10)
      .reduce((sum: number, h: { percent?: string }) => sum + parseFloat(h.percent ?? "0"), 0);
    return [
      `GoPlus: ${flags.length > 0 ? flags.join(", ") : "主要リスクなし✅"}`,
      `LP:${lpLocked ? "ロック済" : "未ロック"}`,
      top10Holder ? `上位10ホルダー:${(top10Holder * 100).toFixed(1)}%` : "",
    ].filter(Boolean).join(", ");
  } catch { return ""; }
}

async function fetchDeFiLlamaTVL(query: string): Promise<string> {
  const res = await fetchWithTimeout("https://api.llama.fi/protocols", 6000);
  if (!res?.ok) return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocols: any[] = await res.json();
    const q = query.toLowerCase();
    const match = protocols.find(p =>
      p.symbol?.toLowerCase() === q || p.name?.toLowerCase() === q
    );
    if (!match) return "";
    return `DeFiLlama TVL: ${fmtUsd(match.tvl ?? 0)}, 7d変化:${match.change_7d?.toFixed(1) ?? "N/A"}%, チェーン:${match.chain ?? "?"}`;
  } catch { return ""; }
}

async function fetchFearGreed(): Promise<string> {
  const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", 4000);
  if (!res?.ok) return "";
  try {
    const json = await res.json();
    const d = json?.data?.[0];
    if (!d) return "";
    return `Fear&Greed: ${d.value}/100 (${d.value_classification})`;
  } catch { return ""; }
}

export async function researchCoin(query: string): Promise<string> {
  const [cgData, dexData, gtData, gpData, llamaData, fgData] = await Promise.all([
    fetchCoinGecko(query),
    fetchDexScreener(query),
    fetchGeckoTerminal(query),
    fetchGoPlus(query),
    fetchDeFiLlamaTVL(query),
    fetchFearGreed(),
  ]);

  return [cgData, dexData, gtData, gpData, llamaData, fgData]
    .filter(Boolean)
    .join("\n");
}
