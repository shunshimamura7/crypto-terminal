import { NextRequest } from "next/server";
import Anthropic, { APIError } from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

type InputKind = "ticker" | "evm" | "solana" | "ton" | "sui" | "tron";

function isTonAddress(q: string): boolean {
  return /^[0-9A-Za-z_-]{48}$/.test(q.trim());
}
function isSuiAddress(q: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(q.trim());
}
function isTronAddress(q: string): boolean {
  return /^T[0-9A-Za-z]{33}$/.test(q.trim());
}

function classifyInput(line: string): InputKind | "invalid" {
  const t = line.trim();
  if (!t) return "invalid";
  if (isSuiAddress(t)) return "sui";
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return "evm";
  if (isTronAddress(t)) return "tron";
  if (isTonAddress(t)) return "ton";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) && !/^0x/.test(t)) return "solana";
  if (t.length <= 20) return "ticker";
  return "invalid";
}

const CHAIN_ID_NAME: Record<string, string> = {
  "1": "Ethereum", "56": "BSC", "137": "Polygon",
  "42161": "Arbitrum", "10": "Optimism", "43114": "Avalanche",
  "8453": "Base", "solana": "Solana", "ton": "TON",
  "sui": "SUI", "tron": "TRON",
};

async function fetchWithTimeout(url: string, timeout = 4000): Promise<Response | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

async function fetchGoPlusSecurity(address: string, kind: InputKind, evmChainId = "1"): Promise<string> {
  let url: string;
  if (kind === "evm") {
    url = `https://api.gopluslabs.io/api/v1/token_security/${evmChainId}?contract_addresses=${address}`;
  } else if (kind === "solana") {
    url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
  } else {
    return "GoPlus: このチェーンは非対応";
  }
  const res = await fetchWithTimeout(url, 5000);
  if (!res || !res.ok) return "GoPlus: データ取得失敗";
  try {
    const json = await res.json();
    const data = json?.result?.[address.toLowerCase()] || json?.result?.[address];
    if (!data) return "GoPlus: データなし";
    const flags: string[] = [];
    if (data.is_honeypot === "1") flags.push("ハニーポット");
    if (data.is_mintable === "1") flags.push("Mint権限");
    if (data.can_take_back_ownership === "1") flags.push("Owner奪還可");
    if (parseFloat(data.sell_tax || "0") > 10) flags.push(`売りTax:${data.sell_tax}%`);
    if (data.is_open_source === "0") flags.push("非公開");
    const lpLocked = data.lp_holders?.some((h: { is_locked?: number }) => h.is_locked === 1);
    return [
      flags.length > 0 ? `⚠️ ${flags.join(",")}` : "✅ 主要リスクなし",
      `LP:${lpLocked ? "ロック済" : "未ロック"}`,
    ].join(" / ");
  } catch {
    return "GoPlus: パース失敗";
  }
}

const COIN_ID_MAP: Record<string, string> = {
  btc: "bitcoin", eth: "ethereum", sol: "solana", xrp: "ripple",
  bnb: "binancecoin", doge: "dogecoin", avax: "avalanche-2",
  link: "chainlink", ada: "cardano", dot: "polkadot", matic: "matic-network",
  uni: "uniswap", atom: "cosmos", near: "near", arb: "arbitrum",
  op: "optimism", sui: "sui", apt: "aptos", inj: "injective-protocol",
  pepe: "pepe", shib: "shiba-inu", ltc: "litecoin", bonk: "bonk",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCoinData(data: any, label: string): string {
  const md = data?.market_data;
  if (!md) return `${label}: 市場データなし`;
  const price = md.current_price?.usd ?? 0;
  const mc    = md.market_cap?.usd ?? 0;
  const vol   = md.total_volume?.usd ?? 0;
  const ch24  = md.price_change_percentage_24h ?? 0;
  const ch7d  = md.price_change_percentage_7d  ?? 0;
  const ath   = md.ath?.usd ?? 0;
  const fdv   = md.fully_diluted_valuation?.usd ?? 0;
  const athDrop = ath > 0 ? ((ath - price) / ath * 100).toFixed(0) : "N/A";
  const mcFdv   = fdv > 0 ? (mc / fdv).toFixed(2) : "N/A";
  const fmtUsd  = (n: number) =>
    n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${n.toFixed(0)}`;
  return `${data.name}(${(data.symbol || "").toUpperCase()}): $${price}, MC:${fmtUsd(mc)}, Vol:${fmtUsd(vol)}, 24h:${ch24.toFixed(1)}%, 7d:${ch7d.toFixed(1)}%, ATH比:-${athDrop}%, MC/FDV:${mcFdv}`;
}

async function fetchCoinData(ticker: string): Promise<string> {
  const id  = COIN_ID_MAP[ticker.toLowerCase()] ?? ticker.toLowerCase();
  const res = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&sparkline=false`
  );
  if (res?.ok) return formatCoinData(await res.json(), ticker);
  // fallback: search
  const sr = await fetchWithTimeout(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`);
  if (!sr?.ok) return `${ticker}: データなし`;
  const sd  = await sr.json();
  const foundId: string | undefined = sd.coins?.[0]?.id;
  if (!foundId) return `${ticker}: データなし`;
  const res2 = await fetchWithTimeout(
    `https://api.coingecko.com/api/v3/coins/${foundId}?localization=false&tickers=false&market_data=true&sparkline=false`
  );
  if (!res2?.ok) return `${ticker}: データなし`;
  return formatCoinData(await res2.json(), ticker);
}

const DEXSCREENER_CHAIN_MAP: Record<string, string> = {
  ethereum: "1", bsc: "56", polygon: "137",
  arbitrum: "42161", optimism: "10", avalanche: "43114",
  base: "8453", solana: "solana", ton: "ton",
  sui: "sui", tron: "tron",
};

async function fetchDexDataWithChain(address: string): Promise<{ summary: string; chainId: string }> {
  const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!res?.ok) return { summary: "DEX: データなし", chainId: "1" };
  try {
    const data = await res.json();
    const pair = (data.pairs ?? [])[0];
    if (!pair) return { summary: "DEX: ペアなし", chainId: "1" };
    const fmtUsd = (n: number) =>
      n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
    const chainId = DEXSCREENER_CHAIN_MAP[pair.chainId] ?? "1";
    return {
      summary: `DEX: $${pair.priceUsd ?? "N/A"}, Liq:${fmtUsd(pair.liquidity?.usd ?? 0)}, Vol24h:${fmtUsd(pair.volume?.h24 ?? 0)}, Chain:${pair.chainId}`,
      chainId,
    };
  } catch {
    return { summary: "DEX: パース失敗", chainId: "1" };
  }
}

export interface BatchResultItem {
  input: string;
  type: InputKind;
  chain: string;
  rank: string;
  alpha: number;
  risk: number;
  smart_money: number;
  decision: string;
  one_line_reason: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rawInputs: string[] = (body.inputs || []).slice(0, 20);

  const valid = rawInputs
    .map(i => i.trim())
    .filter(i => i && classifyInput(i) !== "invalid")
    .slice(0, 20);

  if (valid.length === 0) {
    return Response.json({ error: "有効な入力がありません" }, { status: 400 });
  }

  // 並列でデータ取得
  const dataResults = await Promise.all(valid.map(async (input) => {
    const kind = classifyInput(input) as InputKind;
    let marketData   = "";
    let securityData = "";
    let chainName    = "";

    if (kind === "evm") {
      const { summary, chainId } = await fetchDexDataWithChain(input);
      marketData = summary;
      chainName  = CHAIN_ID_NAME[chainId] ?? `Chain ${chainId}`;
      securityData = await fetchGoPlusSecurity(input, kind, chainId);
    } else if (kind === "solana") {
      chainName = "Solana";
      [marketData, securityData] = await Promise.all([
        fetchDexDataWithChain(input).then(r => r.summary),
        fetchGoPlusSecurity(input, kind),
      ]);
    } else if (kind === "ton") {
      chainName  = "TON";
      marketData = (await fetchDexDataWithChain(input)).summary;
    } else if (kind === "sui") {
      chainName  = "SUI";
      marketData = (await fetchDexDataWithChain(input)).summary;
    } else if (kind === "tron") {
      chainName  = "TRON";
      marketData = (await fetchDexDataWithChain(input)).summary;
    } else {
      marketData = await fetchCoinData(input);
    }

    return { input, kind, marketData, securityData, chainName };
  }));

  const contextLines = dataResults.map(d => {
    const label =
      d.kind === "evm"    ? `[EVM:${d.input.slice(0,8)}...]` :
      d.kind === "solana" ? `[SOL:${d.input.slice(0,8)}...]` :
      d.kind === "ton"    ? `[TON:${d.input.slice(0,8)}...]` :
      d.kind === "sui"    ? `[SUI:${d.input.slice(0,8)}...]` :
      d.kind === "tron"   ? `[TRX:${d.input.slice(0,8)}...]` :
      `[${d.input.toUpperCase()}]`;
    return [
      d.chainName ? `チェーン: ${d.chainName}` : "",
      `${label} ${d.marketData}`,
      d.securityData ? `  セキュリティ: ${d.securityData}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const client = new Anthropic();
  const prompt = `以下の${valid.length}銘柄を評価し、JSONのみ返せ。

## データ
${contextLines}

## 出力形式（JSONのみ・説明文不要）
\`\`\`json
[
  {
    "input": "元の入力文字列をそのまま",
    "rank": "S|A|B|C|D|E|F",
    "alpha": 0,
    "risk": 0,
    "smart_money": 0,
    "decision": "推奨(Gem)|投機的(Degen)|要注意|回避推奨",
    "one_line_reason": "根拠を1行で"
  }
]
\`\`\`

ランク基準：
S: Alpha≥85かつRisk≤35  A: Alpha≥70かつRisk≤50
B: Alpha≥55かつRisk≤60  C: Alpha≥40
D: Alpha<40かつRisk<50   E: Risk>70  F: Risk>85またはScam疑い
セキュリティ問題があればRiskを必ず上げること。全${valid.length}件必ず含めること。`;

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      system: "あなたは仮想通貨フォレンジックアナリストです。指示通りJSONのみ出力せよ。",
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof APIError) {
      const status = err.status ?? 500;
      const isCreditError = status === 402 || /credit|billing|balance|insufficient/i.test(message);
      if (isCreditError) {
        message =
          "💳 Anthropic APIのクレジット残高が不足しています。残高の確認・チャージ: https://console.anthropic.com/settings/billing";
      }
    }
    console.error("[batch] Anthropic API error:", err);
    return Response.json({ error: message }, { status: 500 });
  }

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");

  try {
    const m = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/(\[[\s\S]*\])/);
    if (!m) throw new Error("JSON not found");
    const parsed: Omit<BatchResultItem, "type">[] = JSON.parse(m[1]);
    const kindMap  = Object.fromEntries(dataResults.map(d => [d.input, d.kind]));
    const chainMap = Object.fromEntries(dataResults.map(d => [d.input, d.chainName]));
    const results: BatchResultItem[] = parsed.map(item => ({
      ...item,
      type:  (kindMap[item.input]  ?? "ticker") as InputKind,
      chain: chainMap[item.input]  ?? "",
    }));
    return Response.json({ results });
  } catch {
    return Response.json({ error: "結果の解析に失敗しました", raw: text }, { status: 500 });
  }
}
