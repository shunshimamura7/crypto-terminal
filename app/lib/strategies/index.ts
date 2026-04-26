export * from "./types";
export { strategyA } from "./strategyA";
export { strategyB } from "./strategyB";
export { strategyC } from "./strategyC";
export { evaluateDangerZone } from "./dangerZone";
export type { DangerZoneResult, DangerLevel, DangerZoneInputs } from "./dangerZone";

import { strategyA } from "./strategyA";
import { strategyB } from "./strategyB";
import { strategyC } from "./strategyC";
import type { StrategyDef, CandidateInput, StrategyTag } from "./types";

export const ALL_STRATEGIES: StrategyDef[] = [strategyA, strategyB, strategyC];

/**
 * 候補に対して全戦略を評価し、最も確信度の高い戦略を返す。
 * どの戦略にもマッチしない場合は null を返す。
 */
export function findBestStrategy(c: CandidateInput): {
  tag: StrategyTag;
  confidence: number;
  reasons: string[];
  warnings: string[];
} | null {
  let best: { tag: StrategyTag; confidence: number; reasons: string[]; warnings: string[] } | null = null;
  for (const strategy of ALL_STRATEGIES) {
    const match = strategy.evaluate(c);
    if (match.matched && (!best || match.confidence > best.confidence)) {
      best = {
        tag: strategy.tag,
        confidence: match.confidence,
        reasons: match.reasons,
        warnings: match.warnings,
      };
    }
  }
  return best;
}
