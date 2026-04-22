const API_KEY = process.env.SOSOVALUE_API_KEY ?? "";
const BASE = "https://openapi.sosovalue.com/api/v1";

export interface EtfFlowData {
  btcNetFlow: number | null;
  ethNetFlow: number | null;
  btcDirection: "in" | "out" | null;
  ethDirection: "in" | "out" | null;
  btcTotalAum: number | null;
}

let _cached: EtfFlowData | null = null;
let _cachedAt = 0;
const TTL = 5 * 60_000;

async function apiFetch(path: string): Promise<unknown> {
  if (!API_KEY) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(tid);
    return null;
  }
}

export async function fetchEtfFlows(): Promise<EtfFlowData> {
  if (_cached && Date.now() - _cachedAt < TTL) return _cached;

  const empty: EtfFlowData = {
    btcNetFlow: null,
    ethNetFlow: null,
    btcDirection: null,
    ethDirection: null,
    btcTotalAum: null,
  };
  if (!API_KEY) return empty;

  const [btcRaw, ethRaw] = await Promise.all([
    apiFetch("/etf/bitcoin/flow/history"),
    apiFetch("/etf/ethereum/flow/history"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const btc = btcRaw as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eth = ethRaw as any;

  const btcFlow =
    btc?.data?.[0]?.netFlow ?? btc?.data?.netFlow ?? btc?.data?.[0]?.totalNetAssets ?? null;
  const ethFlow =
    eth?.data?.[0]?.netFlow ?? eth?.data?.netFlow ?? eth?.data?.[0]?.totalNetAssets ?? null;
  const btcAum = btc?.data?.[0]?.totalAum ?? btc?.data?.totalAum ?? btc?.data?.[0]?.totalNetAssets ?? null;

  const result: EtfFlowData = {
    btcNetFlow: btcFlow !== null ? Number(btcFlow) : null,
    ethNetFlow: ethFlow !== null ? Number(ethFlow) : null,
    btcDirection: btcFlow !== null ? (Number(btcFlow) >= 0 ? "in" : "out") : null,
    ethDirection: ethFlow !== null ? (Number(ethFlow) >= 0 ? "in" : "out") : null,
    btcTotalAum: btcAum !== null ? Number(btcAum) : null,
  };

  _cached = result;
  _cachedAt = Date.now();
  return result;
}

export function formatEtfFlows(d: EtfFlowData): string {
  if (!API_KEY) return "";
  const parts: string[] = [];
  if (d.btcNetFlow !== null) {
    const arrow = d.btcDirection === "in" ? "↑" : "↓";
    const amt = Math.abs(d.btcNetFlow);
    const fmtAmt = amt >= 1000 ? `$${(amt / 1000).toFixed(1)}B` : `$${amt.toFixed(0)}M`;
    parts.push(`BTC ETF:${arrow}${fmtAmt}`);
  }
  if (d.ethNetFlow !== null) {
    const arrow = d.ethDirection === "in" ? "↑" : "↓";
    const amt = Math.abs(d.ethNetFlow);
    const fmtAmt = amt >= 1000 ? `$${(amt / 1000).toFixed(1)}B` : `$${amt.toFixed(0)}M`;
    parts.push(`ETH ETF:${arrow}${fmtAmt}`);
  }
  if (d.btcTotalAum !== null) {
    parts.push(`BTC ETF AUM:$${(d.btcTotalAum / 1e9).toFixed(1)}B`);
  }
  return parts.length > 0 ? `SoSoValue[${parts.join(", ")}]` : "";
}
