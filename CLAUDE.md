@AGENTS.md

# bell-crypto-terminal プロジェクトルール

## 概要
MEXC先物ショートスキャナーを中心とした暗号資産トレーディングターミナル。
Next.js 16 (App Router) + TypeScript + Vercel Hobby Plan。

## ドメイン
- Production: https://bell-sig.vercel.app
- 旧ドメイン使用禁止: bell-crypto-terminal.vercel.app, crypto-terminal-psi.vercel.app

## ファイル規約
- API routes: `app/api/<name>/route.ts`
- ビジネスロジック: `app/lib/<name>.ts`
- UIコンポーネント: `components/<Name>.tsx`
- `derivativesData.ts` = OKX/Gate.io APIラッパー（旧coinglass.ts。Coinglass APIは使っていない）

## コーディング規約
- 言語: TypeScript strict
- スタイル: Tailwind CSS 4（utility classes）
- 状態管理: React hooks（useState/useEffect/useMemo/useCallback）
- ストレージ: クライアントサイドはlocalStorage、サーバーサイドDBなし
- fetch: 必ずタイムアウト設定（AbortSignal.timeout）
- キャッシュ: インメモリMap + TTL（5分が標準）
- エラーハンドリング: try/catch必須、Anthropic APIのクレジットエラーは専用メッセージ
- eslint-disable: `@typescript-eslint/no-explicit-any` のみ許容（API応答のパース時）

## Vercel制約
- Hobby Plan: 関数タイムアウト60s（vercel.jsonで上書き可能だがHobbyでは60sが実質上限）
- short-scan/batch/sector: maxDuration=120（Pro移行時に有効化）
- レートリミット: インメモリMap（再デプロイでリセット）

## ショートスキャナー スコアリング（Phase 3後）
- サーバーサイド最大: 27pt
  - dropScore(3) + volumeDry(3) + FR(2) + freshness(2) + OI(2) + trend(3) + pump(2) + btcCorr(1) + pattern(3) + rsi(2) + pocDistance(2) + volTrend(2)
  - ※ oiChangeScore はサーバー側では常時0（null渡し）
- クライアント追加: DISPLAY_MAX = 45pt（CG連携時）/ 39pt（CG連携なし）[ShortScanner.tsx:55]
  - exclusivity(2) + frConsecutive(1) + futuresHeat(2) + snsHeat(1) + mcFdv(3) + oiChangeClient(2) + riskOffBonus(最大+1) + newListingBonus(最大+5) + fearGreedBonus(最大+2) - mcFdvPenalty(最大-2)
  - RECOMMEND_THRESHOLD: displayScore >= 13（CG連携時）/ >= 11（CG連携なし）[ShortScanner.tsx:57]
- バックテスト scoreMax: 27 [backtestChecker.ts:311]

## 外部API
- MEXC Futures: 公開API（認証不要）
- CoinGecko: API Key（オプション）
- OKX/Gate.io: 公開API（FR/OI取得。derivativesData.ts）
- Anthropic Claude: Sonnet 4.6（チャット/バッチ/セクター）、Haiku 4.5（openclaw）
- Tokenomist/Arkham/SoSoValue/CryptoPanic: 各API Key

## テスト
- `npm run build` が通ること（型チェック含む）
- ローカルテスト: `npm run dev` → localhost:3000

## コミットメッセージ
- feat(<scope>): 新機能
- fix(<scope>): バグ修正
- refactor(<scope>): リファクタリング
- chore(<scope>): 雑務
