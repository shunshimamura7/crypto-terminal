"use client";

import type { BacktestRecord } from "./backtestStorage";

export type IntegrityIssueLevel = "critical" | "warning" | "info";

export interface IntegrityIssue {
  level: IntegrityIssueLevel;
  category: string;
  symbol: string;
  description: string;
  recordId?: string;
}

export interface IntegrityReport {
  totalChecked: number;
  issues: IntegrityIssue[];
  healthScore: number;   // 0-100
  storageUsage: {
    used: number;        // bytes (UTF-16 estimate)
    quota: number;       // 5MB
    pct: number;
  };
}

export function checkDataIntegrity(records: BacktestRecord[]): IntegrityReport {
  const issues: IntegrityIssue[] = [];

  for (const r of records) {
    // チェック1: TP順序（ショートでは TP1 > TP2 > TP3）
    // v1.0では既知のバグでTP順序が逆転していたため warning に軽減
    if (r.tp1 < r.tp2) {
      const isV2 = r.version === "v2.0";
      issues.push({
        level: isV2 ? "critical" : "warning",
        category: "TP順序異常",
        symbol: r.symbol,
        description: `TP1(${r.tp1.toPrecision(5)}) < TP2(${r.tp2.toPrecision(5)}) — ショート時の順序逆転${!isV2 ? "（v1.0既知バグ）" : ""}`,
        recordId: r.id,
      });
    }
    if (r.tp2 < r.tp3) {
      const isV2 = r.version === "v2.0";
      issues.push({
        level: isV2 ? "critical" : "warning",
        category: "TP順序異常",
        symbol: r.symbol,
        description: `TP2(${r.tp2.toPrecision(5)}) < TP3(${r.tp3.toPrecision(5)}) — ショート時の順序逆転${!isV2 ? "（v1.0既知バグ）" : ""}`,
        recordId: r.id,
      });
    }

    // チェック2: SL方向（ショートでは SL > entryPrice）
    if (r.sl <= r.entryPrice) {
      issues.push({
        level: "critical",
        category: "SL方向異常",
        symbol: r.symbol,
        description: `SL(${r.sl.toPrecision(5)}) <= Entry(${r.entryPrice.toPrecision(5)}) — ショートではSL>Entryが正常`,
        recordId: r.id,
      });
    }

    // チェック3: TP方向（ショートでは TP1 < entryPrice）
    if (r.tp1 >= r.entryPrice) {
      issues.push({
        level: "critical",
        category: "TP方向異常",
        symbol: r.symbol,
        description: `TP1(${r.tp1.toPrecision(5)}) >= Entry(${r.entryPrice.toPrecision(5)}) — ショートではTP<Entryが正常`,
        recordId: r.id,
      });
    }

    // チェック4: recordedAt 未来日
    if (r.recordedAt > Date.now() + 60_000) {
      issues.push({
        level: "warning",
        category: "時刻異常",
        symbol: r.symbol,
        description: `recordedAt が未来日 (${new Date(r.recordedAt).toISOString()})`,
        recordId: r.id,
      });
    }

    // チェック5: status と resolvedAt の整合性
    const isResolved = ["tp1_hit", "tp2_hit", "tp3_hit", "sl_hit", "expired"].includes(r.status);
    if (isResolved && !r.resolvedAt) {
      issues.push({
        level: "warning",
        category: "データ欠損",
        symbol: r.symbol,
        description: `status=${r.status} だが resolvedAt が未設定`,
        recordId: r.id,
      });
    }

    // チェック6: rrRatio 異常値
    if (r.rrRatio !== undefined && (r.rrRatio < 0 || r.rrRatio > 50)) {
      issues.push({
        level: "warning",
        category: "rrRatio異常",
        symbol: r.symbol,
        description: `rrRatio=${r.rrRatio.toFixed(2)} — 異常範囲（0-50想定）`,
        recordId: r.id,
      });
    }

    // チェック7: maxDrawdown の符号
    if (r.maxDrawdown !== null && r.maxDrawdown !== undefined && r.maxDrawdown > 0) {
      issues.push({
        level: "info",
        category: "DD符号",
        symbol: r.symbol,
        description: `maxDrawdown が正の値 (${r.maxDrawdown.toFixed(2)}) — 通常は負`,
        recordId: r.id,
      });
    }
  }

  const storageUsage = calcStorageUsage();
  const criticalCount = issues.filter(i => i.level === "critical").length;
  const warningCount  = issues.filter(i => i.level === "warning").length;
  const healthScore   = Math.max(0, 100 - criticalCount * 10 - warningCount * 2);

  return { totalChecked: records.length, issues, healthScore, storageUsage };
}

function calcStorageUsage(): IntegrityReport["storageUsage"] {
  if (typeof window === "undefined") return { used: 0, quota: 5 * 1024 * 1024, pct: 0 };
  let used = 0;
  for (const key in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
      used += (localStorage[key].length + key.length) * 2; // UTF-16
    }
  }
  const quota = 5 * 1024 * 1024;
  return { used, quota, pct: (used / quota) * 100 };
}
