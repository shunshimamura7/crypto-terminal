export interface OrderbookImbalance {
  bidTotal: number;
  askTotal: number;
  imbalanceRatio: number;
  imbalanceScore: number;
  topAskWall: number | null;
  topAskWallSize: number | null;
}

export async function fetchOrderbookImbalance(symbol: string): Promise<OrderbookImbalance | null> {
  try {
    const res = await fetch(`https://contract.mexc.com/api/v1/contract/depth/${symbol}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const data = json?.data;
    if (!data?.asks?.length || !data?.bids?.length) return null;

    let bidTotal = 0;
    let askTotal = 0;
    let topAskWall: number | null = null;
    let topAskWallSize: number | null = null;

    for (const [priceStr, qtyStr] of data.bids as string[][]) {
      bidTotal += parseFloat(priceStr) * parseFloat(qtyStr);
    }

    for (const [priceStr, qtyStr] of data.asks as string[][]) {
      const price = parseFloat(priceStr);
      const sizeUsd = price * parseFloat(qtyStr);
      askTotal += sizeUsd;
      if (topAskWallSize === null || sizeUsd > topAskWallSize) {
        topAskWall = price;
        topAskWallSize = sizeUsd;
      }
    }

    const imbalanceRatio = bidTotal > 0 ? askTotal / bidTotal : 0;
    let imbalanceScore = 0;
    if (imbalanceRatio >= 2.0) imbalanceScore = 2;
    else if (imbalanceRatio >= 1.5) imbalanceScore = 1;

    return { bidTotal, askTotal, imbalanceRatio, imbalanceScore, topAskWall, topAskWallSize };
  } catch {
    return null;
  }
}
