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
- サーバーサイド最大: 23pt
  - dropScore(3) + volumeDry(3) + FR(2) + freshness(2) + OI(2) + oiChange(2) + trend(3) + pump(2) + btcCorr(1) + pattern(3)
- クライアント追加（CoinGecko連携時）: 最大+11pt = 合計34pt
  - exclusivity(2) + frConsecutive(1) + futuresHeat(2) + snsHeat(1) + mcFdv(3) + oiChangeClient(2)
- バックテスト scoreMax: 23

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
