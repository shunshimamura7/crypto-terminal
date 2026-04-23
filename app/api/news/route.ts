import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
}

async function fetchWithTimeout(url: string, timeout = 5000): Promise<Response | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch { clearTimeout(id); return null; }
}

function mapSentiment(s?: string): "positive" | "negative" | "neutral" {
  if (!s) return "neutral";
  const l = s.toLowerCase();
  if (l.includes("bull") || l.includes("positive")) return "positive";
  if (l.includes("bear") || l.includes("negative")) return "negative";
  return "neutral";
}

function detectSentimentJa(title: string): "positive" | "negative" | "neutral" {
  if (/上昇|高騰|急騰|最高値|強気|承認|提携|採用|好調|ローンチ|上場/.test(title)) return "positive";
  if (/下落|暴落|急落|規制|禁止|ハッキング|流出|詐欺|破綻|警告/.test(title)) return "negative";
  return "neutral";
}

// ── Source 1: 日本語RSSフィード ──────────────────────────────────────────────
const RSS_FEEDS = [
  { url: "https://coinpost.jp/?feed=rss2",          source: "CoinPost" },
  { url: "https://www.coindeskjapan.com/feed/",     source: "CoinDesk Japan" },
  { url: "https://www.neweconomy.jp/feed",           source: "あたらしい経済" },
];

async function fetchRSS(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const res = await fetchWithTimeout(url);
      if (!res?.ok) return [] as NewsItem[];
      const xml = await res.text();
      const items: NewsItem[] = [];
      const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
      let m: RegExpExecArray | null;
      while ((m = itemRe.exec(xml)) !== null) {
        const block = m[1];
        // CDATA対応: <title><![CDATA[...]]></title> と <title>...</title> 両対応
        const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() ?? "";
        const link  = (block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)?.[1]?.trim()) ??
                      (block.match(/<guid[^>]*>(https?[^<]+)<\/guid>/)?.[1]?.trim()) ?? "#";
        const pub   = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
        if (title) {
          items.push({
            id: `rss-${source}-${items.length}`,
            title,
            url: link,
            source,
            publishedAt: pub ? new Date(pub).toISOString() : "",
            sentiment: detectSentimentJa(title),
          });
        }
      }
      return items;
    })
  );

  const all: NewsItem[] = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => (r as PromiseFulfilledResult<NewsItem[]>).value);

  return all
    .sort((a, b) => (b.publishedAt > a.publishedAt ? 1 : -1))
    .slice(0, 10);
}

// ── Fallback 1: CryptoCompare ─────────────────────────────────────────────────
async function fetchCryptoCompare(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout(
    "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular"
  );
  if (!res?.ok) return [];
  try {
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (json.Data ?? []).slice(0, 10).map((d: any) => ({
      id: String(d.id ?? Math.random()),
      title: d.title ?? "",
      url: d.url ?? "#",
      source: d.source ?? "CryptoCompare",
      publishedAt: d.published_on ? new Date(d.published_on * 1000).toISOString() : "",
      sentiment: mapSentiment(d.sentiment),
    })).filter((i: NewsItem) => i.title);
  } catch { return []; }
}

// ── Fallback 2: CoinGecko News ────────────────────────────────────────────────
async function fetchCoinGecko(): Promise<NewsItem[]> {
  const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/news");
  if (!res?.ok) return [];
  try {
    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = Array.isArray(json) ? json : (json.data ?? []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return raw.slice(0, 10).map((d: any) => ({
      id: String(d.id ?? Math.random()),
      title: d.title ?? d.description ?? "",
      url: d.url ?? "#",
      source: d.news_site ?? d.author ?? "CoinGecko",
      publishedAt: d.updated_at ?? d.created_at ?? "",
      sentiment: "neutral" as const,
    })).filter((i: NewsItem) => i.title);
  } catch { return []; }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  // Source 1: 日本語RSSフィード（CoinPost / CoinDesk Japan / あたらしい経済）
  const rss = await fetchRSS();
  if (rss.length > 0) return Response.json({ items: rss });

  // Fallback 1: CryptoCompare（英語）
  const cc = await fetchCryptoCompare();
  if (cc.length > 0) return Response.json({ items: cc });

  // Fallback 2: CoinGecko（英語）
  const cg = await fetchCoinGecko();
  if (cg.length > 0) return Response.json({ items: cg });

  return Response.json({ items: [] });
}
