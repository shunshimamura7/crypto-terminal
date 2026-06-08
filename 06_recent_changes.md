# 変更ログ

## 2026-06-08

#### Phase 9: ETFフロー連携
**目的**: BTC現物ETFの net flow を marketRegime 判定に統合

**実装**:
- `app/api/etf-flow/route.ts`（新規）: farside.co.uk/btc/ をサーバーfetch + HTMLパース、1時間キャッシュ
- 戻り値: `{ latest, last3dSum, last5dSum, latestDate, trend }`
- `app/lib/marketRegime.ts`: `etfFlow3dSum?: number` 追加。≤ -1000M → favorableScore+1、≥ +1500M → dangerScore+1（仮値）
- `components/MarketRegimeBanner.tsx`: 並列fetch追加、ETF3日計を流出=緑/流入=赤で表示
- `app/lib/backtestStorage.ts`: `marketContext.etfFlow3dSum?` 追加
- `app/short-scan/page.tsx`: `marketEnvData` 型に `etfFlow3dSum?` 追加

**根拠**: 直近のBTC ETFは連日アウトフロー基調（5/27 -733M, 6/1 -484M, 6/2 -519M）。機関売りはショート追い風のマクロシグナルとして統合

---

#### Phase 10: BTCドミナンス連携
**目的**: アルトのショート専門ツール特有のシグナルとしてドミナンス変化を統合

**実装**:
- `app/api/btc-dominance/route.ts`（新規）: CoinGecko 3エンドポイント並列fetch
  - `/api/v3/global` → 現在のBTCドミナンス
  - `/api/v3/coins/bitcoin/market_chart?days=7` → BTC時価総額履歴
  - `/api/v3/global/market_cap_chart?days=7` → 総時価総額履歴
  - 7日前のドミナンスを算出 → 現在との差分を `dominanceDelta7d` として返す
- `app/lib/marketRegime.ts`: `btcDominanceDelta?: number` 追加。≥ +1.5pt → favorableScore+1（アルト売られ=ショート追い風）、≤ -1.5pt → dangerScore+1（アルトシーズン=ショート危険）、仮値
- `components/MarketRegimeBanner.tsx`: 並列fetchに追加、BTC.D + 7日変化を色分け表示
- `app/lib/backtestStorage.ts`: `marketContext.btcDominance?`, `btcDominanceDelta?` 追加

---

#### Phase 10 バグ修正: dominanceDelta7d 計算ズレ
**問題**: 初回実装で BTC市場履歴 `days=8`、総時価総額履歴 `days=7` と指定がズレてた。両配列の `[0]` を使って7日前ドミナンスを算出してたため「8日前のBTC時価総額 ÷ 7日前の総時価総額」という実在しない時点を計算していた

**修正**: 両エンドポイントを `days=7` に統一。`[0]` が両方とも7日前で揃うようになり、正しい7日前ドミナンスを算出

**教訓**: Claude Code が「だいたい合ってる」近似実装をするケースあり。新規実装したAPIは計算ロジックを自分で読み返させる工程を入れるとリグレッション防げる

---

## 2026-06-06
- fix: precursorScanner の非crypto除外フィルター漏れ修正（USOIL/UKOIL/SILVER/XAUT/NAS100/NFP/SPX500/US対応）
- feat: バックテスト記録の個別削除ボタン追加（データ健全性パネル + レコード一覧）

---

## 2026-06-03: 非crypto銘柄除外を共通化（symbolFilters.ts）

**対象ファイル**: `app/lib/symbolFilters.ts`（新規）, `app/lib/precursorScanner.ts`, `app/api/short-scan/route.ts`, `app/api/optimizer/collect/route.ts`

- `isNonCryptoSymbol` / `filterCryptoOnly` を `app/lib/symbolFilters.ts` に集約
- USOIL/NFP/NAS100/SPX500/SILVER/US 等の株価指数・コモディティ・FXシンセティックを全スキャン経路から除外
- 前兆スキャン(`precursorScanner.ts`)は除外フィルタが皆無だったため追加（根本原因対処）
- `short-scan/route.ts` はローカル定義の `isNonCrypto()` を削除してimport統一
- `optimizer/collect/route.ts` はローカル定義の `isExcluded()` を削除してimport統一

---

## 2026-05-29: バックテスト・シミュレーション品質改善【MAJOR】

**対象ファイル**: `app/lib/backtestSimulator.ts`, `components/PnlSimulator.tsx`, `components/ShortScanner.tsx`, `app/lib/backtestChecker.ts`

### 修正内容

#### 1. expired レコードのシミュレーション混入バグを修正
- **ファイル**: `app/lib/backtestSimulator.ts`, `components/PnlSimulator.tsx`（Sharpe計算も）
- **Before**: `r.status !== "active"` フィルター → expired が混入
- **After**: `tp1_hit | tp2_hit | tp3_hit | sl_hit` ホワイトリスト化
- `backtestStats.ts` / `backtestAnalysis.ts` と同じ設計に統一

#### 2. PnlSimulator に TPレベルフィルター追加
- **ファイル**: `app/lib/backtestSimulator.ts`（`TpLevel` 型 / `SimulationConfig.tpLevel`）, `components/PnlSimulator.tsx`
- **`"tp1"`（デフォルト）**: tp2_hit / tp3_hit もすべて `r.tp1` 価格で利確扱い（保守的・現実的）
- **`"tp1_tp2"`**: tp3_hit のみ `r.tp2` にキャップ
- **`"all"`**: 従来通り（楽観的）
- localStorage `bell:portfolio:settings` に `tpLevel` 永続化
- 軍資金ボタン直後に常時表示 UI として追加（advancedOpen の外）

#### 3. autoRecord dead code を削除
- **ファイル**: `components/ShortScanner.tsx`
- `toAutoRecord` を計算してトーストのみ出す無意味なブロック（L.3091〜3111相当）を削除
- `autoRecordRef` / その `useEffect` も削除（24行削減）
- `autoRecord` state と UI トグルは維持（設定永続化用途）

#### 4. バックテスト記録閾値 8 → 13 に引き上げ
- **ファイル**: `app/lib/backtestChecker.ts`
- `SCORE_THRESHOLD = 8` → `SCORE_THRESHOLD = 13`
- `new_listing` プリセットのハードコード `>= 8` も `>= SCORE_THRESHOLD` 参照に統一
- 推奨閾値(13)未満のノイズ銘柄がバックテストに混入する問題を解消

#### 5. UIテキスト修正
- **ファイル**: `components/ShortScanner.tsx`
- 「スコア8以上の銘柄が自動記録されます」→「スコア13以上」（ja/en両対応）

#### 6. 既存データリセット（手動）
- 旧データ（スコア8〜12混入）を UI の「データリセット」ボタンで全削除
- 2026-05-29 よりクリーンなデータ蓄積開始

### 既知の残存問題
- **SL未検知バイアス**: `lastPrice` のみ使用でチェック間隔内のSLタッチを見逃す可能性（勝率数〜10%過大評価）。修正にはOHLCV対応が必要（難度高・未対処）
- **TP2/TP3のR倍率過大**: TP2 = 3.75〜6R、TP3 = 8〜13R（SL比較）→ TPレベルフィルターで対処済み

### バックテストの正しい読み方
- **TP1のみモードで見る**（デフォルト設定）
- PF 1.5以上でエッジあり
- 100件確定後にスコア帯別分析を実施
- シミュレーション数字は「上限値」。実践では1/3〜1/2程度に収まると想定

---

## 2026-05-01 推奨停止・精度警告・v2.0フィルター追加

**対象ファイル**: `components/ShortScanner.tsx`, `components/BacktestPanel.tsx`

### 変更内容

#### 修正1: ショート停止推奨時に推奨リストを非表示
- `RecommendedPanel` に `isShortStopped` prop 追加
- `dangerZone.shouldBlockEntry === true` 時、推奨カードの代わりに⏸️停止メッセージを表示
- テーブル側の✅推奨バッジは維持（個別銘柄評価は別レイヤー）

#### 修正2: バックテストパネルに精度警告バナー追加
- v1.0件数・v2.0件数・v2.0決着済み件数を表示
- v1Count > 0 かつ v2Count < 200 の時のみバナー表示
- 200件蓄積まで統計は参考値として扱うよう注意喚起

#### 修正3: バックテストパネルに「v2.0のみ」タブ追加
- フィルタータブに `v2_only` を追加（emerald色で区別）
- v2.0のみにフィルタリングして勝率・期待値・全統計を独立計算

#### 修正4: 推奨カードに免責注記追加
- picks.length > 0 かつ停止中でない時、カード下部に小さく表示
- ja/en両対応

---

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
