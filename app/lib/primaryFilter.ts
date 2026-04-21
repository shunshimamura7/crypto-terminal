export interface CoinFilterData {
  id: string
  symbol: string
  name: string
  current_price: number
  market_cap: number
  total_volume: number
  ath: number
  price_change_percentage_24h: number
  price_change_percentage_7d_in_currency: number
}

export interface FilterResult {
  passed: CoinFilterData[]
  stats: { total: number; passed: number }
}

export async function fetchCoinsForFilter(): Promise<CoinFilterData[]> {
  const pages = [1, 2, 3, 4];
  const results: CoinFilterData[] = [];
  for (const page of pages) {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=${page}&sparkline=false&price_change_percentage=7d,24h`;
    try {
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (res.ok) results.push(...await res.json());
    } catch { }
    await new Promise(r => setTimeout(r, 600));
  }
  return results;
}

export function filterGemHunter(coins: CoinFilterData[]): FilterResult {
  const passed = coins.filter(c => {
    const volMcRatio = c.total_volume / c.market_cap;
    const athDrop = (c.ath - c.current_price) / c.ath;
    return (
      c.market_cap >= 500_000 &&
      c.market_cap <= 1_000_000_000 &&
      c.total_volume >= 50_000 &&
      volMcRatio >= 0.05 &&
      athDrop >= 0.4 &&
      athDrop <= 0.95 &&
      c.price_change_percentage_7d_in_currency >= 3 &&
      c.current_price > 0.0000001
    );
  });
  return { passed, stats: { total: coins.length, passed: passed.length } };
}

export function filterRecovery(coins: CoinFilterData[]): FilterResult {
  const passed = coins.filter(c => {
    const athDrop = (c.ath - c.current_price) / c.ath;
    return (
      c.market_cap >= 1_000_000 &&
      c.market_cap <= 2_000_000_000 &&
      athDrop >= 0.65 &&
      athDrop <= 0.97 &&
      c.price_change_percentage_7d_in_currency >= -5 &&
      c.price_change_percentage_7d_in_currency <= 20 &&
      c.total_volume >= 100_000
    );
  });
  return { passed, stats: { total: coins.length, passed: passed.length } };
}

export function filterForSector(coins: CoinFilterData[]): FilterResult {
  const passed = coins.filter(c =>
    c.market_cap >= 500_000 &&
    c.total_volume >= 10_000 &&
    c.current_price > 0
  );
  return { passed, stats: { total: coins.length, passed: passed.length } };
}
