import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MEXC = "https://contract.mexc.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeGet(url: string): Promise<any> {
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function GET() {
  const [mexcData, fngData] = await Promise.allSettled([
    safeGet(`${MEXC}/api/v1/contract/ticker`),
    safeGet("https://api.alternative.me/fng/"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickers: any[] = mexcData.status === "fulfilled" && mexcData.value?.data
    ? mexcData.value.data : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (sym: string) => tickers.find((t: any) => t.symbol === sym);
  const btcT = find("BTC_USDT");
  const ethT = find("ETH_USDT");

  const fng = (() => {
    if (fngData.status !== "fulfilled" || !fngData.value?.data?.[0]) return null;
    const d = fngData.value.data[0];
    return { value: parseInt(d.value, 10), valueText: d.value_classification as string };
  })();

  return NextResponse.json({
    btcPrice:     parseFloat(btcT?.lastPrice     || "0"),
    btcChange24h: parseFloat(btcT?.riseFallRate  || "0") * 100,
    ethPrice:     parseFloat(ethT?.lastPrice     || "0"),
    ethChange24h: parseFloat(ethT?.riseFallRate  || "0") * 100,
    fng,
  });
}
