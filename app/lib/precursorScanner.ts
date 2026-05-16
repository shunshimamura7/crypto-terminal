const MEXC = "https://api.mexc.com";
const DELAY_MS = 110;

export interface PrecursorSignal {
  symbol: string;
  currentPrice: number;
  precursorScore: number;
  signals: {
    volDecline4h: boolean;
    lowerHighs4h: boolean;
    volDryDaily: boolean;
    lowerHighsDaily: boolean;
    frLongTrap: boolean;
  };
  fr: number;
  openInterest: number;
  volume24h: number;
  suggestedTP: number;
  suggestedSL: number;
  detectedAt: number;
}

interface KlineBar {
  time: number;
  high: number;
  low: number;
  vol: number;
}

interface MexcKlineRaw {
  success: boolean;
  data?: {
    time: number[];
    open: string[];
    close: string[];
    high: string[];
    low: string[];
    vol?: string[];
  };
}

interface MexcTickerItem {
  symbol: string;
  lastPrice: string;
  volume24: string;
  fundingRate: string;
  holdVol: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchKlines(symbol: string, interval: string, limitHours: number): Promise<KlineBar[]> {
  const endSec   = Math.floor(Date.now() / 1000);
  const startSec = endSec - limitHours * 3600;
  const url = `${MEXC}/api/v1/contract/kline/${symbol}?interval=${interval}&start=${startSec}&end=${endSec}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "bell-crypto-terminal/precursor-scan" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json: MexcKlineRaw = await res.json();
    if (!json.success || !json.data) return [];
    const { time, high, low, vol } = json.data;
    const bars: KlineBar[] = [];
    for (let i = 0; i < (time?.length ?? 0); i++) {
      const h = parseFloat(high[i] ?? "0");
      const l = parseFloat(low[i] ?? "0");
      const v = parseFloat(vol?.[i] ?? "0");
      if (time[i] > 0 && h > 0) bars.push({ time: time[i], high: h, low: l, vol: v });
    }
    return bars;
  } catch {
    return [];
  }
}

function calcSignals(
  bars4h: KlineBar[],
  barsDaily: KlineBar[],
  fr: number,
): PrecursorSignal["signals"] {
  // volDecline4h: 直近3本の4h足出来高が連続減少
  const vol4h = bars4h.slice(-4).map(b => b.vol);
  const volDecline4h =
    vol4h.length >= 3 &&
    vol4h[vol4h.length - 3] > vol4h[vol4h.length - 2] &&
    vol4h[vol4h.length - 2] > vol4h[vol4h.length - 1];

  // lowerHighs4h: 直近4本中で高値切り下がりが2回以上
  const highs4h = bars4h.slice(-4).map(b => b.high);
  let lowerHighCount = 0;
  for (let i = 1; i < highs4h.length; i++) {
    if (highs4h[i] < highs4h[i - 1]) lowerHighCount++;
  }
  const lowerHighs4h = lowerHighCount >= 2;

  // volDryDaily: 直近日足出来高が5日平均の50%以下
  const dailyVols = barsDaily.slice(-6).map(b => b.vol);
  const lastDailyVol = dailyVols[dailyVols.length - 1] ?? 0;
  const avg5Vol = dailyVols.length >= 2
    ? dailyVols.slice(0, -1).reduce((a, b) => a + b, 0) / (dailyVols.length - 1)
    : 0;
  const volDryDaily = avg5Vol > 0 && lastDailyVol < avg5Vol * 0.5;

  // lowerHighsDaily: 日足高値3日連続切り下がり
  const dailyHighs = barsDaily.slice(-3).map(b => b.high);
  const lowerHighsDaily =
    dailyHighs.length >= 3 &&
    dailyHighs[0] > dailyHighs[1] &&
    dailyHighs[1] > dailyHighs[2];

  // frLongTrap: FR > +0.03%（ロングが積み上がり過熱）
  const frLongTrap = fr > 0.0003;

  return { volDecline4h, lowerHighs4h, volDryDaily, lowerHighsDaily, frLongTrap };
}

export async function scanPrecursors(tickers: MexcTickerItem[]): Promise<PrecursorSignal[]> {
  const results: PrecursorSignal[] = [];

  for (const ticker of tickers) {
    const symbol = ticker.symbol;
    const currentPrice = parseFloat(ticker.lastPrice);
    const fr = parseFloat(ticker.fundingRate) || 0;
    const openInterest = parseFloat(ticker.holdVol) || 0;
    const volume24h = parseFloat(ticker.volume24) || 0;

    if (!(currentPrice > 0)) {
      await sleep(DELAY_MS);
      continue;
    }

    const [bars4h, barsDaily] = await Promise.all([
      fetchKlines(symbol, "Hour4", 48),
      fetchKlines(symbol, "Day1", 8 * 24),
    ]);

    await sleep(DELAY_MS);

    if (bars4h.length < 3 || barsDaily.length < 3) continue;

    const signals = calcSignals(bars4h, barsDaily, fr);
    const precursorScore =
      (signals.volDecline4h   ? 2 : 0) +
      (signals.lowerHighs4h   ? 2 : 0) +
      (signals.volDryDaily    ? 1 : 0) +
      (signals.lowerHighsDaily ? 1 : 0) +
      (signals.frLongTrap     ? 1 : 0);

    if (precursorScore < 4) continue;

    results.push({
      symbol,
      currentPrice,
      precursorScore,
      signals,
      fr,
      openInterest,
      volume24h,
      suggestedTP: currentPrice * 0.95,
      suggestedSL: currentPrice * 1.08,
      detectedAt: Date.now(),
    });
  }

  return results.sort((a, b) => b.precursorScore - a.precursorScore);
}

export async function fetchTopTickers(limit = 200): Promise<MexcTickerItem[]> {
  const res = await fetch(`${MEXC}/api/v1/contract/ticker`, {
    headers: { "User-Agent": "bell-crypto-terminal/precursor-scan" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const all: MexcTickerItem[] = (json?.data ?? [])
    .filter((t: MexcTickerItem) => t.symbol?.endsWith("_USDT"));
  all.sort((a, b) => parseFloat(b.volume24) - parseFloat(a.volume24));
  return all.slice(0, limit);
}
