import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MEXC      = "https://contract.mexc.com";
const YAHOO     = "https://query1.finance.yahoo.com/v8/finance/chart";
const CG_GLOBAL = "https://api.coingecko.com/api/v3/global";

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

export async function GET() {
  const cpKey = process.env.CRYPTOPANIC_API_KEY;
  const [mexcData, fngData, cgGlobal, us100R, dxyR, goldR, us10yR, newsData] = await Promise.allSettled([
    safeGet(`${MEXC}/api/v1/contract/ticker`),
    safeGet("https://api.alternative.me/fng/"),
    safeGet(CG_GLOBAL, 300),
    fetchYahoo("QQQ"),
    fetchYahoo("DX-Y.NYB"),
    fetchYahoo("GC=F"),
    fetchYahoo("^TNX"),
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
    us10y:        us10y.price,
    us10yValue:   us10y.price,
    us10yChange:  us10y.changePercent,
    sentimentScore,
    sentimentLabel,
  });
}
