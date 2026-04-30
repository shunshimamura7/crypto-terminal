import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MEXC       = "https://contract.mexc.com";
const YAHOO      = "https://query1.finance.yahoo.com/v8/finance/chart";
const CG_GLOBAL  = "https://api.coingecko.com/api/v3/global";
const CG_STABLES = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&per_page=2&sparkline=false";

interface YahooResult {
  price:         number | null;
  changePercent: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeGet(url: string, revalidate = 60): Promise<any> {
  try {
    const res = await fetch(url, { next: { revalidate } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchYahoo(symbol: string): Promise<YahooResult> {
  try {
    const res = await fetch(
      `${YAHOO}/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      {
        next: { revalidate: 300 },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
        },
      },
    );
    if (!res.ok) return { price: null, changePercent: null };
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, changePercent: null };

    const price = (meta.regularMarketPrice as number) ?? null;

    // regularMarketChangePercent is the canonical field; fall back to manual calc
    let changePercent: number | null = (meta.regularMarketChangePercent as number) ?? null;
    if (changePercent == null && price != null && meta.chartPreviousClose) {
      const prev = meta.chartPreviousClose as number;
      if (prev !== 0) changePercent = ((price - prev) / prev) * 100;
    }

    return { price, changePercent };
  } catch {
    return { price: null, changePercent: null };
  }
}

// 米2年債(DGS2)はFRED API経由で取得。FRED_API_KEY未設定時は13週T-Bill(^IRX)で代用（厳密には別物）。
async function fetchFred(seriesId: string): Promise<{ value: number; change: number } | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const obs: Array<{ value: string }> = json?.observations ?? [];
    const valid = obs.filter(o => o.value !== "." && !isNaN(parseFloat(o.value)));
    if (valid.length < 2) return null;
    const latest = parseFloat(valid[0].value);
    const prev   = parseFloat(valid[1].value);
    const change = prev !== 0 ? ((latest - prev) / prev) * 100 : 0;
    return { value: latest, change };
  } catch {
    return null;
  }
}

export async function GET() {
  const cpKey = process.env.CRYPTOPANIC_API_KEY;
  const [mexcData, fngData, cgGlobal, us100R, dxyR, goldR, us10yR, fredUs2yR, us2yFallbackR, cgStablesR, newsData] = await Promise.allSettled([
    safeGet(`${MEXC}/api/v1/contract/ticker`),
    safeGet("https://api.alternative.me/fng/"),
    safeGet(CG_GLOBAL, 300),
    fetchYahoo("QQQ"),
    fetchYahoo("DX-Y.NYB"),
    fetchYahoo("GC=F"),
    fetchYahoo("^TNX"),
    fetchFred("DGS2"),                // primary: FRED 2-Year Treasury
    fetchYahoo("^IRX"),               // fallback: 13-Week T-Bill (fires in parallel, used only if FRED fails)
    safeGet(CG_STABLES, 300),
    cpKey
      ? safeGet(`https://cryptopanic.com/api/free/v1/posts/?auth_token=${cpKey}&kind=news&filter=hot&public=true`, 300)
      : Promise.resolve(null),
  ]);

  // MEXC tickers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickers: any[] = mexcData.status === "fulfilled" && mexcData.value?.data
    ? mexcData.value.data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (sym: string) => tickers.find((t: any) => t.symbol === sym);
  const btcT = find("BTC_USDT");
  const ethT = find("ETH_USDT");

  // F&G
  const fng = (() => {
    if (fngData.status !== "fulfilled" || !fngData.value?.data?.[0]) return null;
    const d = fngData.value.data[0];
    return { value: parseInt(d.value, 10), valueText: d.value_classification as string };
  })();

  // BTC Dominance from CoinGecko global
  const cgG = cgGlobal.status === "fulfilled" ? cgGlobal.value : null;
  const btcDominance: number | null = cgG?.data?.market_cap_percentage?.btc ?? null;

  // Yahoo Finance results
  const resolveY = (r: PromiseSettledResult<YahooResult>): YahooResult =>
    r.status === "fulfilled" ? r.value : { price: null, changePercent: null };

  const us100 = resolveY(us100R);
  const dxy   = resolveY(dxyR);
  const gold  = resolveY(goldR);
  const us10y = resolveY(us10yR);

  // 米2年債: FRED DGS2 優先、API未設定 or 失敗時は ^IRX(13wkT-Bill) で代用
  let us2y: number | null = null;
  let us2yChange: number | null = null;
  if (fredUs2yR.status === "fulfilled" && fredUs2yR.value !== null) {
    us2y       = fredUs2yR.value.value;
    us2yChange = fredUs2yR.value.change;
  } else {
    const fb = resolveY(us2yFallbackR);
    us2y       = fb.price;
    us2yChange = fb.changePercent;
  }

  // Stablecoin market cap (USDT + USDC)
  let stableMcap: number | null = null;
  let stableMcapChange: number | null = null;
  if (cgStablesR.status === "fulfilled" && Array.isArray(cgStablesR.value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coins = cgStablesR.value as Array<{ market_cap: number; market_cap_change_24h: number }>;
    const total    = coins.reduce((s, c) => s + (c.market_cap        ?? 0), 0);
    const change24 = coins.reduce((s, c) => s + (c.market_cap_change_24h ?? 0), 0);
    if (total > 0) {
      stableMcap = total;
      const prev = total - change24;
      stableMcapChange = prev > 0 ? (change24 / prev) * 100 : null;
    }
  }

  const btcChange = parseFloat(btcT?.riseFallRate || "0") * 100;
  const ethChange = parseFloat(ethT?.riseFallRate || "0") * 100;

  // CryptoPanic sentiment
  let sentimentScore: number | null = null;
  let sentimentLabel: string | null = null;
  if (newsData.status === "fulfilled" && newsData.value?.results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posts = newsData.value.results as Array<{ votes: any }>;
    let positive = 0, negative = 0;
    for (const p of posts.slice(0, 20)) {
      positive += (p.votes?.positive ?? 0) as number;
      negative += (p.votes?.negative ?? 0) as number;
    }
    const total = positive + negative;
    if (total > 0) {
      sentimentScore = Math.round((positive / total) * 100);
      sentimentLabel = sentimentScore >= 70 ? "Bullish" : sentimentScore >= 40 ? "Neutral" : "Bearish";
    }
  }

  return NextResponse.json({
    // existing fields (backward-compatible)
    btcPrice:     parseFloat(btcT?.lastPrice || "0"),
    btcChange24h: btcChange,
    btcChange,
    ethPrice:     parseFloat(ethT?.lastPrice || "0"),
    ethChange24h: ethChange,
    ethChange,
    fng,
    // macro fields
    btcDominance,
    us100:        us100.price,
    us100Change:  us100.changePercent,
    dxy:          dxy.price,
    dxyChange:    dxy.changePercent,
    gold:         gold.price,
    goldChange:   gold.changePercent,
    us10y:           us10y.price,
    us10yValue:      us10y.price,
    us10yChange:     us10y.changePercent,
    us2y,
    us2yChange,
    stableMcap,
    stableMcapChange,
    sentimentScore,
    sentimentLabel,
  });
}
