# 変更ログ

## 2026-05-01 バックテスト導出フィルタールール追加

**対象ファイル**: `components/ShortScanner.tsx`

### 背景

バックテスト73件の負けパターン分析（7敗）から3つの共通パターンを発見し、
ショートスキャナーのフィルタールールに反映。

### 変更内容

#### ルール1: trendAlignment ≤ 1 → 注意 [BT-R1]

`getShortRecommendation` の注意条件に追加。

- 条件: `c.trendMultiTF.alignment <= 1`（NEUTRAL or UP方向）
- 結果: `"caution"` → ⚠️要注意バッジ
- 根拠: trendDirection ≠ DOWN で負け確率2.4倍（勝ち24% vs 負け57%）
- tier3flags: `"⚠️ トレンド非DOWN"`

#### ルール2: 新規上場 × MEXC独占 × 低ドロップ → 禁止 [BT-R2]

`getShortRecommendation` の禁止条件に追加（`banned_fresh` チェックより前）。

- 条件: `listedDaysAgo <= 14` AND `exclusivityScore >= 2` AND `dropScore <= 1`
- 結果: `"banned"` → 🚫ショート禁止バッジ
- 根拠: UPEG/BULL/NOCK で3連続SL hit
- 副作用: 「今狙うショート」からも自動除外（`=== "recommended"` フィルターにより）
- tier3flags: `"🚫 新規×独占×低ドロップ"`

#### ルール3: 下落根拠スコア合計 ≤ 2 → 注意 [BT-R3]

`getShortRecommendation` の注意条件に追加。

- 条件: `dropScore + volumeDryScore + trendScore <= 2`（最大9点中2点以下）
- 結果: `"caution"` → ⚠️要注意バッジ
- 根拠: 下落根拠が弱い銘柄で損失が集中
- tier3flags: `"⚠️ 下落根拠不足(N/9)"`

### 後方互換

- `scoreBreakdown` 未定義の場合は `?? デフォルト値` で安全にスキップ
- `trendMultiTF == null` の場合はルール1をスキップ
- 既存の禁止・注意条件は全て維持（削除・変更なし）

### 動作確認

- `npm run build` 成功（型エラーなし）
- NOCK example: `listedDaysAgo=3, exclusivityScore=2, dropScore=0` → ルール2でbanned
- trendAlignment=0 → ルール1でcaution
- dropScore=0+volumeDryScore=0+trendScore=1=1 ≤ 2 → ルール3でcaution

---

## 2026-05-01 損益シミュレーター（PnlSimulator）追加

**新規ファイル**: `app/lib/backtestSimulator.ts`, `components/PnlSimulator.tsx`
**変更ファイル**: `components/ShortScanner.tsx`

### 機能概要

- バックテスト結果を使ってリスクベースの損益シミュレーションを提供する独立コンポーネント
- バックテストパネルの直上に常時表示（データ0件でも「まだデータがありません」表示）

### 実装詳細

**`app/lib/backtestSimulator.ts`**
- `SimulationConfig`: `initialCapital / riskPerTrade / leverage / usdJpy`
- `simulateBacktest()`: 決着済みレコードをresolvedAt順に処理し複利計算
  - 各トレード: `realR = (entryPrice - resolvedPrice) / (sl - entryPrice)`
  - `tradePnl = realR × (equity × riskPerTrade / 100)`
  - 最大DD・PF・勝率・avgWinR/avgLossR を出力

**`components/PnlSimulator.tsx`**
- 入力: 軍資金（プリセットボタン）/ リスク% / レバレッジ（セレクト）
- 出力: 初期資金・最終資金・損益・最大DD の4カード + 詳細5統計
- Recharts AreaChart で資金推移チャート（グリーン/レッド自動切替）
- localStorage `bell:portfolio:settings` で設定を永続化・共有

### 設計
- 完全独立コンポーネント（props: `records, lang` のみ）
- ja/en 翻訳内包
- `npm run build` 成功（型エラーなし）
