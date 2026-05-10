import type { UpgradeEvent } from './upgradeTypes';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(source: string, url: string): string {
  let hash = 0;
  const str = `${source}:${url}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `${source}-${Math.abs(hash).toString(36)}`;
}

function getTagContent(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  const m = xml.match(regex);
  return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : '';
}

function parseRSSItems(xml: string): Array<{ title: string; link: string; pubDate: string; desc: string }> {
  const results: Array<{ title: string; link: string; pubDate: string; desc: string }> = [];

  // RSS 2.0
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const title   = getTagContent(block, 'title');
    const link    = getTagContent(block, 'link') || ((block.match(/<link>([^<]+)/) ?? [])[1] ?? '');
    const pubDate = getTagContent(block, 'pubDate');
    const desc    = getTagContent(block, 'description') || getTagContent(block, 'summary');
    if (title) results.push({ title, link, pubDate, desc });
  }

  // Atom <entry>
  const entryRx = /<entry>([\s\S]*?)<\/entry>/g;
  while ((m = entryRx.exec(xml)) !== null) {
    const block = m[1];
    const title   = getTagContent(block, 'title');
    const linkM   = block.match(/<link[^>]+href="([^"]+)"/i);
    const link    = linkM ? linkM[1] : '';
    const pubDate = getTagContent(block, 'published') || getTagContent(block, 'updated');
    const desc    = getTagContent(block, 'summary') || getTagContent(block, 'content');
    if (title && link) results.push({ title, link, pubDate, desc });
  }

  return results.slice(0, 10);
}

export function classifyImportance(text: string, version?: string): 'critical' | 'major' | 'minor' {
  const t = (text + ' ' + (version ?? '')).toLowerCase();
  if (/mainnet|hard.?fork|hardfork|migration|breaking.?change|v\d+\.0\.0\b/.test(t)) return 'critical';
  if (/upgrade|release|launch|integration|partnership|v\d+\.\d+\.0\b/.test(t)) return 'major';
  return 'minor';
}

function classifyType(text: string): UpgradeEvent['type'] {
  const t = text.toLowerCase();
  if (/mainnet|main.?network/.test(t)) return 'mainnet';
  if (/hard.?fork|hardfork/.test(t)) return 'hardfork';
  if (/integrat|partner/.test(t)) return 'integration';
  if (/release|v\d+\.\d+/.test(t)) return 'release';
  return 'other';
}

function isUpgradeRelated(text: string): boolean {
  return /upgrade|launch|release|mainnet|fork|migration|v\d+\.\d+|integration|partner|update/i.test(text);
}

function isWithin30Days(dateStr: string): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    return !isNaN(d.getTime()) && (Date.now() - d.getTime()) < 30 * 86400000;
  } catch {
    return false;
  }
}

// ── GitHub Releases ───────────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

export async function fetchGitHubReleases(repo: string): Promise<UpgradeEvent[]> {
  try {
    const headers: Record<string, string> = { 'User-Agent': 'bell-crypto-terminal/1.0' };
    if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=5`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];

    const releases = await res.json() as GitHubRelease[];
    return releases
      .filter(r => !r.draft && !r.prerelease && isWithin30Days(r.published_at))
      .map(r => ({
        id: generateId('github', r.html_url),
        symbol: '',
        source: 'github' as const,
        type: classifyType(`${r.name} ${r.body}`),
        importance: classifyImportance(`${r.name} ${r.body}`, r.tag_name),
        title: r.name || r.tag_name,
        description: (r.body ?? '').slice(0, 300),
        url: r.html_url,
        publishedAt: r.published_at,
      }));
  } catch {
    return [];
  }
}

// ── Blog RSS ──────────────────────────────────────────────────────────────────

export async function fetchBlogRSS(rssUrl: string): Promise<UpgradeEvent[]> {
  try {
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'bell-crypto-terminal/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const items = parseRSSItems(xml);

    return items
      .filter(i => isUpgradeRelated(i.title + ' ' + i.desc) && isWithin30Days(i.pubDate))
      .map(i => ({
        id: generateId('blog', i.link),
        symbol: '',
        source: 'blog' as const,
        type: classifyType(i.title + ' ' + i.desc),
        importance: classifyImportance(i.title + ' ' + i.desc),
        title: i.title,
        description: i.desc.replace(/<[^>]+>/g, '').slice(0, 300),
        url: i.link,
        publishedAt: i.pubDate || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

// ── CoinMarketCal ─────────────────────────────────────────────────────────────

interface CmcEvent {
  id: number;
  title: { en: string };
  date_event: string;
  created_date: string;
  percentage: number;
  source: string;
  description: string;
}

export async function fetchCoinMarketCal(coinId: string): Promise<UpgradeEvent[]> {
  const apiKey = process.env.COINMARKETCAL_API_KEY;
  if (!apiKey) return [];

  try {
    const dateStart = new Date().toISOString().slice(0, 10);
    const dateEnd   = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

    const url = new URL('https://developers.coinmarketcal.com/v1/events');
    url.searchParams.set('coins', coinId);
    url.searchParams.set('dateRangeStart', dateStart);
    url.searchParams.set('dateRangeEnd', dateEnd);
    url.searchParams.set('sortBy', 'significance');
    url.searchParams.set('max', '10');

    const res = await fetch(url.toString(), {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json; charset=UTF-8',
        'Accept-Encoding': 'deflate, gzip',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = await res.json() as { body?: CmcEvent[] };
    const events = data.body ?? [];

    return events
      .filter(e => e.percentage >= 3)
      .map(e => {
        const title       = e.title?.en ?? '';
        const scheduledAt = e.date_event;
        const daysUntil   = scheduledAt
          ? Math.ceil((new Date(scheduledAt).getTime() - Date.now()) / 86400000)
          : undefined;
        return {
          id: generateId('coinmarketcal', String(e.id)),
          symbol: '',
          source: 'coinmarketcal' as const,
          type: classifyType(title),
          importance: classifyImportance(title),
          title,
          description: (e.description ?? '').slice(0, 300),
          url: e.source ?? '',
          publishedAt: e.created_date ?? new Date().toISOString(),
          scheduledAt,
          daysUntil,
        };
      });
  } catch {
    return [];
  }
}

// ── Twitter (Nitter RSS / RSSHub) ─────────────────────────────────────────────

const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
];

export async function fetchTwitter(handle: string): Promise<UpgradeEvent[]> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${instance}/${handle}/rss`, {
        headers: { 'User-Agent': 'bell-crypto-terminal/1.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const items = parseRSSItems(xml);

      const results = items
        .filter(i => isUpgradeRelated(i.title + ' ' + i.desc) && isWithin30Days(i.pubDate))
        .map(i => ({
          id: generateId('twitter', i.link),
          symbol: '',
          source: 'twitter' as const,
          type: classifyType(i.title + ' ' + i.desc),
          importance: classifyImportance(i.title + ' ' + i.desc),
          title: i.title.replace(/^R to @\w+: /, '').slice(0, 120),
          description: i.desc.replace(/<[^>]+>/g, '').slice(0, 300),
          url: i.link,
          publishedAt: i.pubDate || new Date().toISOString(),
        }));

      if (results.length > 0) return results;
    } catch {
      // try next instance
    }
  }
  return [];
}
