import type { ShortCandidate } from "./shortScorer";
import type { ScanSnapshot } from "./snapshotStorage";

export type AlertType = "score_up" | "oi_spike" | "vol_dry" | "fr_change";
export type AlertSeverity = "high" | "medium" | "low";

export interface DiffAlert {
  symbol: string;
  type: AlertType;
  message: string;
  severity: AlertSeverity;
  prevValue?: number | null;
  currentValue?: number | null;
}

export function detectAlerts(
  current: ShortCandidate[],
  snapshots: ScanSnapshot[],
): DiffAlert[] {
  if (snapshots.length === 0) return [];

  // 直前のスナップショットを使う
  const prev = snapshots[snapshots.length - 1];
  const alerts: DiffAlert[] = [];

  for (const c of current) {
    const p = prev.data[c.symbol];
    if (!p) continue;

    // score_up: スコアが+2以上上昇
    if (c.shortScore - p.score >= 2) {
      alerts.push({
        symbol: c.symbol,
        type: "score_up",
        message: `スコア ${p.score}→${c.shortScore} (+${c.shortScore - p.score})`,
        severity: "high",
        prevValue: p.score,
        currentValue: c.shortScore,
      });
    }

    // oi_spike: OIが前回比50%以上増加
    if (p.oi > 0 && c.openInterest / p.oi >= 1.5) {
      const pct = ((c.openInterest / p.oi - 1) * 100).toFixed(0);
      alerts.push({
        symbol: c.symbol,
        type: "oi_spike",
        message: `OI +${pct}% 急増`,
        severity: "medium",
        prevValue: p.oi,
        currentValue: c.openInterest,
      });
    }

    // vol_dry: 出来高比率が前回の半分以下に減少
    if (p.volRatio > 0 && c.volumeChangeRatio / p.volRatio <= 0.5) {
      alerts.push({
        symbol: c.symbol,
        type: "vol_dry",
        message: `出来高比率 ${p.volRatio.toFixed(2)}×→${c.volumeChangeRatio.toFixed(2)}× 急枯渇`,
        severity: "medium",
        prevValue: p.volRatio,
        currentValue: c.volumeChangeRatio,
      });
    }

    // fr_change: FRがマイナス→プラス転換
    if (p.fr !== null && c.fundingRate !== null) {
      if (p.fr < 0 && c.fundingRate > 0) {
        alerts.push({
          symbol: c.symbol,
          type: "fr_change",
          message: `FR マイナス→プラス転換 (+${(c.fundingRate * 100).toFixed(4)}%)`,
          severity: "medium",
          prevValue: p.fr,
          currentValue: c.fundingRate,
        });
      }
    }
  }

  // severity優先度でソート
  const order: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

// 最新スナップショット比の変化サマリを取得
export function getDiffSummary(
  symbol: string,
  candidate: ShortCandidate,
  snapshots: ScanSnapshot[],
): { scoreDiff: number; oiDiff: number | null; frDiff: number | null } | null {
  if (snapshots.length === 0) return null;
  const prev = snapshots[snapshots.length - 1].data[symbol];
  if (!prev) return null;
  return {
    scoreDiff: candidate.shortScore - prev.score,
    oiDiff: prev.oi > 0 ? (candidate.openInterest / prev.oi - 1) * 100 : null,
    frDiff:
      prev.fr !== null && candidate.fundingRate !== null
        ? (candidate.fundingRate - prev.fr) * 100
        : null,
  };
}
