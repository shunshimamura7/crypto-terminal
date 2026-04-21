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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  // Primary: CryptoCompare (no API key needed for basic access)
  const ccRes = await fetchWithTimeout(
    "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular"
  );
  if (ccRes?.ok) {
    try {
      const json = await ccRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: NewsItem[] = (json.Data ?? []).slice(0, 10).map((d: any) => ({
        id: String(d.id ?? Math.random()),
        title: d.title ?? "",
        url: d.url ?? "#",
        source: d.source ?? "CryptoCompare",
        publishedAt: d.published_on ? new Date(d.published_on * 1000).toISOString() : "",
        sentiment: mapSentiment(d.sentiment),
      })).filter((i: NewsItem) => i.title);
      if (items.length > 0) return Response.json({ items });
    } catch { /* fall through */ }
  }

  // Fallback: CoinGecko news
  const cgRes = await fetchWithTimeout("https://api.coingecko.com/api/v3/news");
  if (cgRes?.ok) {
    try {
      const json = await cgRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = Array.isArray(json) ? json : (json.data ?? []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: NewsItem[] = raw.slice(0, 10).map((d: any) => ({
        id: String(d.id ?? Math.random()),
        title: d.title ?? d.description ?? "",
        url: d.url ?? "#",
        source: d.news_site ?? d.author ?? "CoinGecko",
        publishedAt: d.updated_at ?? d.created_at ?? "",
        sentiment: "neutral" as const,
      })).filter((i: NewsItem) => i.title);
      if (items.length > 0) return Response.json({ items });
    } catch { /* ignore */ }
  }

  return Response.json({ items: [] });
}
