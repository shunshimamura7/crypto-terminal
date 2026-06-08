import { NextResponse } from "next/server";

interface EtfFlowResult {
  latest: number | null;
  last3dSum: number | null;
  last5dSum: number | null;
  latestDate: string | null;
  trend: "outflow" | "inflow" | "mixed" | null;
}

const EMPTY: EtfFlowResult = {
  latest: null,
  last3dSum: null,
  last5dSum: null,
  latestDate: null,
  trend: null,
};

function parseFarsideValue(text: string): number | null {
  const s = text.trim();
  // Bracketed negative: (123.4) → -123.4
  const bracket = s.match(/^\(([0-9,]+\.?\d*)\)$/);
  if (bracket) return -parseFloat(bracket[1].replace(/,/g, ""));
  // Plain number
  const plain = s.match(/^-?[0-9,]+\.?\d*$/);
  if (plain) return parseFloat(s.replace(/,/g, ""));
  return null;
}

export async function GET() {
  try {
    const res = await fetch("https://farside.co.uk/btc/", {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; bell-sig/1.0)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json(EMPTY);

    const html = await res.text();
    const dateRe = /^\d{1,2} [A-Za-z]+ \d{4}$/;
    const dailyValues: { date: string; total: number }[] = [];

    // Split on <tr — each chunk represents one table row's content
    const chunks = html.split(/<tr/i);
    for (const chunk of chunks) {
      // Skip aggregate rows (Total/Average/Maximum/Minimum) and header rows
      if (
        /background-color\s*:\s*#eaeffa/i.test(chunk) ||
        /bgcolor\s*=\s*["']#eaeffa["']/i.test(chunk)
      ) continue;

      // Extract all tabletext span contents (strip nested HTML tags inside)
      const spanRe = /<span\s+class=["']tabletext["'][^>]*>([\s\S]*?)<\/span>/gi;
      const texts: string[] = [];
      let m;
      while ((m = spanRe.exec(chunk)) !== null) {
        const text = m[1].replace(/<[^>]+>/g, "").trim();
        if (text) texts.push(text);
      }
      if (texts.length < 2) continue;

      // First text must be a date like "20 May 2026"
      if (!dateRe.test(texts[0])) continue;

      // Last text = Total net flow column
      const total = parseFarsideValue(texts[texts.length - 1]);
      if (total === null) continue;

      dailyValues.push({ date: texts[0], total });
    }

    if (dailyValues.length === 0) return NextResponse.json(EMPTY);

    // Data is chronological (oldest first); take last 5 days
    const last5 = dailyValues.slice(-5);
    const last3 = last5.slice(-3);
    const latest = last5[last5.length - 1];

    const last3dSum = last3.reduce((s, v) => s + v.total, 0);
    const last5dSum = last5.reduce((s, v) => s + v.total, 0);

    const last3vals = last3.map(v => v.total);
    let trend: "outflow" | "inflow" | "mixed";
    if (last3vals.every(v => v < 0)) trend = "outflow";
    else if (last3vals.every(v => v > 0)) trend = "inflow";
    else trend = "mixed";

    return NextResponse.json({
      latest: latest.total,
      last3dSum,
      last5dSum,
      latestDate: latest.date,
      trend,
    });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
