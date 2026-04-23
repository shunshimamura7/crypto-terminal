import { NextRequest, NextResponse } from "next/server";

export const runtime     = "nodejs";
export const maxDuration = 30;

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;

const CHAIN_MAP: Record<string, string> = {
  ethereum: "eth",
  bsc:      "bsc",
  base:     "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon:  "polygon",
};

const KNOWN_LABELS: Record<string, string> = {
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be": "Binance",
  "0xd551234ae421e3bcba99a0da6d736074f22192ff": "Binance",
  "0x564286362092d8e7936f0549571a803b203aaced": "Binance",
  "0x0681d8db095565fe8a346fa0277bffde9c0edbbf": "Binance",
  "0xfe9e8709d3215310075d67e3ed32a380ccf451c8": "Binance",
  "0x4e9ce36e442e55ecd9025b9a6e0d88485d628a67": "Binance",
  "0xbe0eb53f46cd790cd13851d5ef9d313c8b7b0af3": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xab5c66752a9e8167967685f1450532fb96d5d24f": "Kraken",
  "0x53d284357ec70ce289d6d64134dfac8e511c8a3d": "Kraken",
  "0x89e51fa8ca5d66cd220baed62ed01e8951aa7c40": "Kraken",
  "0xa7efae728d2936e78bda97dc267687568dd593f3": "OKX",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
  "0x7793cd85c11a924478d358d49b05b37e91b5810f": "Gate.io",
  "0x1c4b70a3968436b9a0a9cf5205c787eb81bb558c": "Gate.io",
  "0x4b9ea4f1cb10d23acf938d9de58c9d26bb6b951b": "Bybit",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
  "0x75e89d5979e4f6fba9f97c104f2c18bd26104e24": "MEXC",
  "0x77696bb39917c91a0c3d2f8c0b058938db88a74f": "MEXC",
};

interface HolderRaw {
  owner_address:                          string;
  balance_formatted:                      string;
  percentage_relative_to_total_supply:    number;
}

interface HolderData {
  rank:         number;
  address:      string;
  label:        string | null;
  balance:      number;
  chainPercent: number;
  totalPercent: number;
  isCex:        boolean;
}

interface ChainResult {
  chain:              string;
  contractAddress:    string;
  totalSupplyOnChain: number;
  decimals:           number;
  holders:            HolderData[];
  error?:             string;
}

async function moralisGet(path: string): Promise<Response | null> {
  try {
    return await fetch(`https://deep-index.moralis.io/api/v2.2${path}`, {
      headers: { "X-API-Key": MORALIS_API_KEY!, "Accept": "application/json" },
    });
  } catch {
    return null;
  }
}

async function fetchChainHolders(chain: string, contractAddress: string): Promise<ChainResult> {
  const moralisChain = CHAIN_MAP[chain];
  if (!moralisChain) {
    return { chain, contractAddress, totalSupplyOnChain: 0, decimals: 18, holders: [], error: "Unknown chain" };
  }

  try {
    const [holdersRes, metaRes] = await Promise.all([
      moralisGet(`/erc20/${contractAddress}/owners?chain=${moralisChain}&limit=20&order=DESC`),
      moralisGet(`/erc20/metadata?chain=${moralisChain}&addresses%5B0%5D=${contractAddress}`),
    ]);

    if (!holdersRes?.ok) {
      return { chain, contractAddress, totalSupplyOnChain: 0, decimals: 18, holders: [], error: `API error: ${holdersRes?.status ?? "timeout"}` };
    }

    const holdersData = await holdersRes.json();
    const rawHolders: HolderRaw[] = holdersData.result ?? [];

    if (rawHolders.length === 0) {
      return { chain, contractAddress, totalSupplyOnChain: 0, decimals: 18, holders: [], error: "No holders found" };
    }

    const metaData   = metaRes?.ok ? await metaRes.json() : [];
    const meta       = Array.isArray(metaData) ? metaData[0] : null;
    const decimals   = parseInt(meta?.decimals ?? "18", 10);
    const totalSupplyOnChain = parseFloat(meta?.total_supply_formatted ?? "0");

    const holders: HolderData[] = rawHolders.map((h, i) => {
      const address      = h.owner_address.toLowerCase();
      const label        = KNOWN_LABELS[address] ?? null;
      const balance      = parseFloat(h.balance_formatted ?? "0");
      const chainPercent = totalSupplyOnChain > 0
        ? (balance / totalSupplyOnChain) * 100
        : (h.percentage_relative_to_total_supply ?? 0);
      return {
        rank: i + 1,
        address: h.owner_address,
        label,
        balance,
        chainPercent,
        totalPercent: 0,
        isCex: !!label,
      };
    });

    return { chain, contractAddress, totalSupplyOnChain, decimals, holders };
  } catch (e) {
    return {
      chain, contractAddress, totalSupplyOnChain: 0, decimals: 18, holders: [],
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export async function POST(req: NextRequest) {
  if (!MORALIS_API_KEY) {
    return NextResponse.json({ error: "MORALIS_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = await req.json() as { chains: { chain: string; address: string }[] };
    const { chains } = body;

    if (!Array.isArray(chains) || chains.length === 0) {
      return NextResponse.json({ error: "chains required" }, { status: 400 });
    }

    const results = await Promise.all(
      chains.map(({ chain, address }) => fetchChainHolders(chain, address)),
    );

    const grandTotalSupply = results.reduce((s, r) => s + r.totalSupplyOnChain, 0);

    const processedResults = results.map(chainData => ({
      ...chainData,
      holders: chainData.holders.map(h => ({
        ...h,
        totalPercent: grandTotalSupply > 0 ? (h.balance / grandTotalSupply) * 100 : 0,
      })),
    }));

    // Concentration check excludes CEX wallets
    const top2Percent = processedResults
      .flatMap(r => r.holders)
      .filter(h => !h.isCex)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 2)
      .reduce((s, h) => s + h.totalPercent, 0);

    const warnings: Array<{ level: "info" | "warning" | "danger"; message: string }> = [];

    if (top2Percent > 20) {
      warnings.push({ level: "danger",  message: `🚨 CEX除く上位2ウォレットで総供給の${top2Percent.toFixed(1)}%を保有。高集中リスク。` });
    } else if (top2Percent > 10) {
      warnings.push({ level: "warning", message: `⚠️ CEX除く上位2ウォレットで総供給の${top2Percent.toFixed(1)}%を保有。要注意。` });
    } else {
      warnings.push({ level: "info",    message: `✅ CEX除く上位2ウォレットの集中度: ${top2Percent.toFixed(1)}% — 正常範囲` });
    }

    warnings.push({
      level: "info",
      message: "ℹ️ 「チェーン上の%」はそのチェーンの流通量に対する割合。「総供給%」は全チェーン合計に対する本当の集中度。",
    });

    return NextResponse.json({ chains: processedResults, grandTotalSupply, top2Percent, warnings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
