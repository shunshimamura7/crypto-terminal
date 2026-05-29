# プロジェクト設定値リファレンス

## バックテスト設定

```yaml
# app/lib/backtestChecker.ts
SCORE_THRESHOLD: 13     # 変更: 8→13 (2026-05-29) 推奨閾値と統一
EXPIRE_DAYS: 14         # アクティブレコードの有効期限（日）
SCORING_VERSION: "v2.0"
```

### preset 別記録条件

| preset | 条件 |
|--------|------|
| `low_lev` | `shortScore >= 10` & `athDropPct <= -30` & `vol >= 50k` & `OI >= 20k` |
| `new_listing` | `shortScore >= 13` & `listedDaysAgo <= 30` |
| `high_lev` | `shortScore >= 12` & `athDropPct <= -70` & `vol >= 500k` & `OI >= 200k` |
| `production` / `collect` / default | `shortScore >= 13` |

### TP/SL 設定値（shortScorer.ts:calcTradeSetup）

| ライン | 範囲 | 典型値 |
|--------|------|--------|
| SL | +3% 〜 +12% | +5〜+8% |
| TP1 | -3% 〜 -25% | -5〜-10% |
| TP2 | -15% 〜 -45% | -20〜-30% |
| TP3 | -30% 〜 -65% | -45〜-65% |

R:R 参考値（SL=+8% の場合）: TP1=0.875R / TP2=3.75R / TP3=8.125R

---

## PnlSimulator 設定

```yaml
# components/PnlSimulator.tsx
DEFAULT_TP_LEVEL: "tp1"   # tp1（保守的）/ tp1_tp2（標準）/ all（楽観的）
DEFAULT_RISK_PCT: 2        # リスク%
DEFAULT_LEVERAGE: 3        # レバレッジ（risk modeでは損益に影響しない）
STORAGE_KEY: "bell:portfolio:settings"   # capital / riskPct / leverage / calcMode / posSizePct / tpLevel
```

### TPレベルフィルターのロジック

| tpLevel | tp2_hit の exit | tp3_hit の exit |
|---------|-----------------|-----------------|
| `"tp1"` | r.tp1 | r.tp1 |
| `"tp1_tp2"` | r.tp2 | r.tp2 |
| `"all"` | r.tp2 | r.tp3 |

---

## バックテストストレージ

```yaml
STORAGE_KEY: "bell:backtest:records"   # localStorage
MAX_RECORDS: 1000
MIGRATION_KEY: "bell:backtest:migration_v4"
```

### BacktestStatus 有効値

```
active | tp1_hit | tp2_hit | tp3_hit | sl_hit | expired
pending_tp1 | pending_tp2 | pending_tp3 | pending_sl
```

シミュレーション対象: `tp1_hit | tp2_hit | tp3_hit | sl_hit` のみ（expired は除外）

---

## スコア体系

### メインスキャナー (shortScorer.ts)
- `shortScore` / `scoreMax: 27`（サーバーサイド）
- `displayScore` 最大 45pt（CG連携時）/ 39pt（非連携）
- 推奨閾値: `RECOMMEND_THRESHOLD = 13`（CG連携）/ 11（非連携）

### 前兆スキャナー (precursorScanner.ts)
- `precursorScore` / `scoreMax: 7`（独立スケール）
- 記録閾値: `>= 4`（hardcoded）
- TP/SL: 固定 -5% / +8%（ATR計算なし）
- `strategy: "PRECURSOR"` タグで識別

---

## ショートスキャナー定数 (ShortScanner.tsx)

```typescript
DISPLAY_MAX = HAS_CG ? 45 : 39
RECOMMEND_THRESHOLD = HAS_CG ? 13 : 11
```
