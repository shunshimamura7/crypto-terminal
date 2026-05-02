import { NextRequest } from "next/server";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { researchCoin, getCachedCommunity, getCachedMetrics } from "@/app/lib/coinResearch";
import type { MarketMetrics } from "@/app/lib/coinResearch";
import { fetchCoinglassData, formatCoinglass } from "@/app/lib/derivativesData";
import { fetchEtfFlows, formatEtfFlows } from "@/app/lib/sosovalue";
import { fetchArkhamData, formatArkham } from "@/app/lib/arkham";
import { calculateXHeatScore } from "@/app/lib/socialScore";
import type { CoinglassData } from "@/app/lib/derivativesData";
import type { ArkhamData } from "@/app/lib/arkham";
import type { EtfFlowData } from "@/app/lib/sosovalue";

export const runtime = "nodejs";
export const maxDuration = 120;

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

async function getChainForAddress(address: string): Promise<{ chainId: string; chainName: string }> {
  const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${address}`, 5000);
  if (!res?.ok) return { chainId: "1", chainName: "Ethereum" };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const pair = (data.pairs ?? [])[0];
    if (!pair) return { chainId: "1", chainName: "Ethereum" };
    const chainIdRaw = pair.chainId as string;
    const chainIdNum =
      chainIdRaw === "solana" ? "solana" :
      chainIdRaw === "ton"    ? "ton"    :
      chainIdRaw === "sui"    ? "sui"    :
      chainIdRaw === "tron"   ? "tron"   :
      ({ ethereum: "1", bsc: "56", polygon: "137", arbitrum: "42161", optimism: "10", avalanche: "43114", base: "8453" }[chainIdRaw] ?? "1");
    return {
      chainId:   chainIdNum,
      chainName: CHAIN_ID_NAME[chainIdNum] ?? chainIdRaw,
    };
  } catch {
    return { chainId: "1", chainName: "Ethereum" };
  }
}

export interface BatchResultItem {
  input: string;
  type: InputKind;
  chain: string;
  rank: string;
  alpha: number;
  risk: number;
  smart_money_score_100: number;
  decision: string;
  one_line_reason: string;
  // New fields
  fundingRate: number | null;
  openInterest: number | null;
  longRatio: number | null;
  xheatScore: number | null;
  etfBtcDirection: "in" | "out" | null;
  etfBtcFlow: number | null;
  unlockDays: number | null;
  unlockPercent: number | null;
  arkhamEntity: string | null;
  isInstitutional: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

function adjustScores(
  baseAlpha: number,
  baseRisk: number,
  glass: CoinglassData,
  etf: EtfFlowData,
  xheat: number,
  inputStr: string,
  metrics: MarketMetrics,
): { alpha: number; risk: number } {
  let alphaDelta = 0;
  let riskDelta = 0;

  // ETF flow adjustment (Alpha +/-5)
  const isBtcOrEth = /^(btc|bitcoin|eth|ethereum)$/i.test(inputStr);
  if (isBtcOrEth && etf.btcDirection) {
    alphaDelta += etf.btcDirection === "in" ? 5 : -5;
  }

  // OI trend adjustment (Alpha +/-5)
  if (glass.openInterestChange24h !== null) {
    if (glass.openInterestChange24h > 5) alphaDelta += 5;
    else if (glass.openInterestChange24h < -5) alphaDelta -= 5;
  }

  // XHeat adjustment (Alpha +/-5): high engagement boosts, extreme heat warns
  if (xheat >= 70) alphaDelta -= 5; // overheated = risk
  else if (xheat >= 50) alphaDelta += 3;
  else if (xheat >= 30) alphaDelta += 5;

  // FR overheating risk (Risk +15 if FR > 0.1%/8h)
  if (glass.fundingRate !== null && glass.fundingRate * 100 > 0.1) {
    riskDelta += 15;
  }

  // Long overheating risk (+10 if long ratio > 70%)
  if (glass.longRatio !== null) {
    const longPct = glass.longRatio > 1 ? glass.longRatio : glass.longRatio * 100;
    if (longPct > 70) riskDelta += 10;
  }

  // ── MC/FDV比 補正 ──
  if (metrics.mc && metrics.fdv && metrics.fdv > 0) {
    const mcFdvRatio = metrics.mc / metrics.fdv;
    if (mcFdvRatio < 0.2) {
      riskDelta  += 15;
      alphaDelta -= 5;
    } else if (mcFdvRatio < 0.4) {
      riskDelta += 8;
    } else if (mcFdvRatio > 0.8) {
      riskDelta -= 5;
    }
  }

  // ── Vol/MC比 補正 ──
  if (metrics.vol24h && metrics.mc && metrics.mc > 0) {
    const volMcRatio = metrics.vol24h / metrics.mc;
    if (volMcRatio < 0.03) {
      riskDelta += 5;
    } else if (volMcRatio > 0.5) {
      riskDelta += 8;
    }
  }

  // ── 7d急騰 過熱補正 ──
  if (metrics.priceChange7d !== null) {
    if (metrics.priceChange7d > 100) {
      riskDelta  += 10;
      alphaDelta -= 5;
    } else if (metrics.priceChange7d > 50) {
      riskDelta += 5;
    } else if (metrics.priceChange7d < -30) {
      alphaDelta += 3;
    }
  }

  // ── 24h急落 補正 ──
  if (metrics.priceChange24h !== null && metrics.priceChange24h < -20) {
    riskDelta += 5;
  }

  return {
    alpha: clamp(0, 100, baseAlpha + alphaDelta),
    risk:  clamp(0, 100, baseRisk  + riskDelta),
  };
}

function determineRank(alpha: number, risk: number): string {
  if (alpha >= 85 && risk <= 35) return "S";
  if (alpha >= 70 && risk <= 50) return "A";
  if (alpha >= 55 && risk <= 60) return "B";
  if (alpha >= 40)               return "C";
  if (risk  >  85)               return "F";
  if (risk  >  70)               return "E";
  return "D";
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

  // Gather chain info for address inputs
  const chainResults = await Promise.all(valid.map(async (input) => {
    const kind = classifyInput(input) as InputKind;
    let chainId = "";
    let chainName = "";
    if (kind === "evm" || kind === "solana" || kind === "ton" || kind === "sui" || kind === "tron") {
      const r = await getChainForAddress(input);
      chainId   = r.chainId;
      chainName = r.chainName;
    }
    return { input, kind, chainId, chainName };
  }));

  // Fetch global ETF flows once (not per-coin)
  const etfFlows = await fetchEtfFlows().catch(() => ({
    btcNetFlow: null, ethNetFlow: null,
    btcDirection: null, ethDirection: null, btcTotalAum: null,
  } as EtfFlowData));

  // Sequential research with 1000ms delay to avoid rate limits
  // Fetch new API data in parallel with each researchCoin call
  const researched: Array<{
    input: string;
    kind: InputKind;
    chainName: string;
    context: string;
    glass: CoinglassData;
    arkham: ArkhamData;
  }> = [];

  for (let i = 0; i < chainResults.length; i++) {
    if (i > 0) await sleep(1000);
    const { input, kind, chainName } = chainResults[i];

    const isTicker = kind === "ticker";
    const isAddress = !isTicker;

    const [context, glass, arkham] = await Promise.all([
      researchCoin(input),
      isTicker
        ? fetchCoinglassData(input).catch(() => ({ fundingRate: null, openInterest: null, openInterestChange24h: null, longRatio: null } as CoinglassData))
        : Promise.resolve({ fundingRate: null, openInterest: null, openInterestChange24h: null, longRatio: null } as CoinglassData),
      isAddress
        ? fetchArkhamData(input).catch(() => ({ entityName: null, entityType: null, labels: [], isInstitutional: false } as ArkhamData))
        : Promise.resolve({ entityName: null, entityType: null, labels: [], isInstitutional: false } as ArkhamData),
    ]);

    researched.push({ input, kind, chainName, context, glass, arkham });
  }

  const client = new Anthropic();

  const analysisResults: Array<Omit<BatchResultItem, "type" | "chain">> = [];

  for (let i = 0; i < researched.length; i++) {
    if (i > 0) await sleep(1000);
    const { input, context, glass, arkham } = researched[i];

    // Build supplemental context strings
    const glassStr   = formatCoinglass(glass);
    const arkhamStr  = formatArkham(arkham);
    const etfStr     = formatEtfFlows(etfFlows);

    const supplemental = [glassStr, arkhamStr, etfStr]
      .filter(Boolean)
      .join("\n");

    // Calculate XHeat Score from cached community data
    const community = getCachedCommunity(input);
    const xheatResult = community
      ? calculateXHeatScore(community)
      : { score: 0, twitterComponent: 0, redditComponent: 0, communityComponent: 0 };
    const xheatStr = community
      ? `XHeat Score:${xheatResult.score}/100(TW:${xheatResult.twitterComponent}, Reddit:${xheatResult.redditComponent}, CS:${xheatResult.communityComponent})`
      : "";

    const fullContext = [context, supplemental, xheatStr].filter(Boolean).join("\n");

    const prompt = `以下のデータを基に「${input}」を評価し、JSONのみ返せ。

## データ
${fullContext || "データなし"}

## 出力形式（JSONのみ・説明文不要）
\`\`\`json
{
  "input": "${input}",
  "rank": "S|A|B|C|D|E|F",
  "alpha": 75,
  "risk": 30,
  "smart_money_score_100": 60,
  "decision": "推奨(Gem)|投機的(Degen)|要注意|回避推奨",
  "one_line_reason": "根拠を1行で"
}
\`\`\`

スコア基準（0-100）— 定量アンカー厳守：

### Alpha（上昇ポテンシャル）
- MC/FDV比: >0.8→+0, 0.4-0.8→+10, 0.2-0.4→+15, <0.2→+5（希薄化リスク相殺）
- ATH比: -90%以上下落→+15, -70%以上→+10, -50%以上→+5
- 出来高トレンド: 7d出来高増加傾向→+5, 減少→-5
- OI増加: 24h OI 5%+増→+5
- ETFフロー（BTC/ETHのみ）: インフロー→+5, アウトフロー→-5
- プロダクト/TVL成長: 実需あり→+10, なし→+0
- 開発活動: GitHub活発→+5, 放置→-5
- ベースライン: 40（特筆事項なし）

### Risk（リスク）
- MC/FDV比: <0.2→+20, 0.2-0.4→+10, >0.8→-5
- FR: >0.1%/8h→+15, >0.05%→+5
- ロング比率: >70%→+10
- アンロック: 30日以内5%+→+10, 10%+→+20
- 監査: なし→+10, あり→-5
- 流動性: Vol/MC<3%→+10
- XHeat: >70→+5（過熱）
- ベースライン: 40（特筆事項なし）

### Smart Money Score
- 機関/VC保有確認→+20
- 大口ウォレット蓄積→+15
- Arkham識別エンティティあり→+10
- 出来高異常急増→+5
- ベースライン: 30（情報不足時）

重要: データが不足する項目はベースライン値を使え。推測で極端な値を出すな。
ランク：S:Alpha≥85かつRisk≤35 / A:Alpha≥70かつRisk≤50 / B:Alpha≥55かつRisk≤60 / C:Alpha≥40 / D:Alpha<40かつRisk<50 / E:Risk>70 / F:Risk>85またはScam疑い
プレースホルダーのまま出力するな。必ず実際の評価値を入れよ。`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: "あなたは仮想通貨フォレンジックアナリストです。指示通りJSONのみ出力せよ。",
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content
        .filter(b => b.type === "text")
        .map(b => (b as { type: "text"; text: string }).text)
        .join("");

      const m = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
      if (m) {
        const parsed = JSON.parse(m[1]);
        const baseAlpha = parsed.alpha ?? 50;
        const baseRisk  = parsed.risk  ?? 50;

        const metrics = getCachedMetrics(input) ?? { mc: null, fdv: null, vol24h: null, priceChange24h: null, priceChange7d: null };
        const adjusted = adjustScores(baseAlpha, baseRisk, glass, etfFlows, xheatResult.score, input, metrics);

        analysisResults.push({
          input: parsed.input ?? input,
          rank: determineRank(adjusted.alpha, adjusted.risk),
          alpha: adjusted.alpha,
          risk: adjusted.risk,
          smart_money_score_100: parsed.smart_money_score_100 ?? 50,
          decision: parsed.decision ?? "要注意",
          one_line_reason: parsed.one_line_reason ?? "",
          fundingRate: glass.fundingRate,
          openInterest: glass.openInterest,
          longRatio: glass.longRatio,
          xheatScore: community ? xheatResult.score : null,
          etfBtcDirection: etfFlows.btcDirection,
          etfBtcFlow: etfFlows.btcNetFlow,
          unlockDays: null,
          unlockPercent: null,
          arkhamEntity: arkham.entityName,
          isInstitutional: arkham.isInstitutional,
        });
      } else {
        analysisResults.push(makeDefault(input, glass, etfFlows, xheatResult.score, community !== null, arkham));
      }
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      if (err instanceof APIError) {
        const status = err.status ?? 500;
        if (status === 402 || /credit|billing|balance|insufficient/i.test(message)) {
          message = "💳 Anthropic APIのクレジット残高が不足しています";
        }
      }
      console.error(`[batch] Error analyzing ${input}:`, err);
      analysisResults.push({
        ...makeDefault(input, glass, etfFlows, xheatResult.score, community !== null, arkham),
        one_line_reason: `分析エラー: ${message}`,
      });
    }
  }

  const kindMap  = Object.fromEntries(researched.map(d => [d.input, d.kind]));
  const chainMap = Object.fromEntries(researched.map(d => [d.input, d.chainName]));

  const results: BatchResultItem[] = analysisResults.map(item => ({
    ...item,
    type:  (kindMap[item.input]  ?? "ticker") as InputKind,
    chain: chainMap[item.input]  ?? "",
  }));

  return Response.json({ results });
}

function makeDefault(
  input: string,
  glass: CoinglassData,
  etf: EtfFlowData,
  xheat: number,
  hasCommunity: boolean,
  arkham: ArkhamData,
): Omit<BatchResultItem, "type" | "chain"> {
  return {
    input,
    rank: "C",
    alpha: 50,
    risk: 50,
    smart_money_score_100: 50,
    decision: "要注意",
    one_line_reason: "解析失敗",
    fundingRate: glass.fundingRate,
    openInterest: glass.openInterest,
    longRatio: glass.longRatio,
    xheatScore: hasCommunity ? xheat : null,
    etfBtcDirection: etf.btcDirection,
    etfBtcFlow: etf.btcNetFlow,
    unlockDays: null,
    unlockPercent: null,
    arkhamEntity: arkham.entityName,
    isInstitutional: arkham.isInstitutional,
  };
}
