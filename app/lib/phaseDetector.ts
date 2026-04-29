export type Phase =
  | "ACCUMULATING"
  | "SQUEEZING"
  | "CHAOTIC"
  | "SETTLED"
  | "NEUTRAL";

export interface PhaseResult {
  phase: Phase;
  label: string;
  emoji: string;
  shortable: boolean;
  description: string;
}

export function detectPhase(
  fr: number | null,
  oiChange24h: number | null,
  volChange24h: number | null,
  priceChange24h: number,
): PhaseResult {
  if (fr === null) {
    return { phase: "NEUTRAL", label: "不明", emoji: "❓", shortable: false, description: "FR取得不可" };
  }

  const absFr    = Math.abs(fr);
  const absPrice = Math.abs(priceChange24h);

  // Phase 3: スクイーズ中 — FR極端 + 価格急変動 + OI急増
  if (absFr >= 0.001 && absPrice >= 30 && (oiChange24h ?? 0) >= 50) {
    return { phase: "SQUEEZING", label: "スクイーズ中", emoji: "🌋", shortable: false, description: "急変動中 — 触るな" };
  }

  // Phase 4: 混乱期 — FR極端だが価格は落ち着き始めてる
  if (absFr >= 0.001 && absPrice < 30) {
    return { phase: "CHAOTIC", label: "混乱期", emoji: "⚠️", shortable: false, description: "FR偏り残存 — まだ待て" };
  }

  // Phase 2: 蓄積中 — FR偏ってるが価格はまだ大きく動いてない
  if (absFr >= 0.0005 && absPrice < 15) {
    return { phase: "ACCUMULATING", label: "蓄積中", emoji: "⏳", shortable: false, description: "FR偏り蓄積中 — スクイーズ警戒" };
  }

  // Phase 5: 安定期 — FR中立
  if (absFr < 0.0005) {
    return { phase: "SETTLED", label: "安定期", emoji: "✅", shortable: true, description: "FR中立 — エントリー検討可" };
  }

  return { phase: "NEUTRAL", label: "中立", emoji: "⚪", shortable: false, description: "特記事項なし" };
}

export function phaseBadgeCls(phase: Phase): string {
  switch (phase) {
    case "SETTLED":     return "bg-slate-100 text-slate-600 border-slate-200";
    case "ACCUMULATING":return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "CHAOTIC":     return "bg-purple-50 text-purple-600 border-purple-200";
    case "SQUEEZING":   return "bg-pink-50 text-pink-600 border-pink-200";
    default:            return "bg-gray-50 text-gray-400 border-gray-200";
  }
}
