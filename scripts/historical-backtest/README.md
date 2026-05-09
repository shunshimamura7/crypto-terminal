# 新規上場ヒストリカル・バックテスター

過去1年のMEXC新規上場銘柄を全件取得し、ショート戦略を統計的に検証する。

## ステップ概要

| # | スクリプト | 目的 | 出力 |
|---|---|---|---|
| 1 | `01-fetch-listings.ts` | 過去1年の上場リスト取得 | `data/historical/listings.json` |
| 2 | `02-fetch-klines.ts` | Min15 Kline 全期間取得 | `data/historical/klines/*.json` (gitignore) |
| 3 | `03-simulate.ts` | 戦略シミュレーション（10戦略×35パラメータ×306銘柄） | `data/historical/results/*.json` |
| 4 | `04-aggregate.ts` | 集計レポート生成 | `data/historical/results/summary.md` |

## 実行手順

```bash
# Phase 0
npx tsx scripts/historical-backtest/01-fetch-listings.ts
npx tsx scripts/historical-backtest/02-fetch-klines.ts --poc   # PoC
npx tsx scripts/historical-backtest/02-fetch-klines.ts         # 本番
npx tsx scripts/historical-backtest/02-fetch-klines.ts --retry-failed
npx tsx scripts/historical-backtest/03-simulate.ts
npx tsx scripts/historical-backtest/04-aggregate.ts
npx tsx scripts/historical-backtest/05-deep-dive-s01.ts

# Phase 1: S01 細密グリッドサーチ
npx tsx scripts/historical-backtest/06-grid-search-s01.ts
```

## ファイル構成

```
scripts/historical-backtest/
├── 01-fetch-listings.ts
├── 02-fetch-klines.ts
├── 03-simulate.ts
├── 04-aggregate.ts           (TODO)
├── lib/
│   ├── mexc.ts               # MEXC APIラッパー
│   ├── strategies.ts         # 戦略定義（S01〜S10）
│   ├── simulator.ts          # TP/SL/Timeout判定
│   └── types.ts              # 共通型定義
└── README.md

data/historical/              # ルート直下
├── listings.json             ⭐ git管理（~50KB）
├── klines/                   ❌ gitignore（~330MB）
│   └── {SYMBOL}_USDT.json
└── results/
    ├── strategies-detail.json    ⭐ git管理（~10MB想定）
    ├── strategies-summary.json   ⭐ git管理（~50KB）
    ├── per-symbol-trades.json    ⭐ git管理（~5MB想定）
    └── summary.md                ⭐ git管理（人間用）
```

## 注意事項

- **MEXCベースURL**: `https://api.mexc.com` を使用（旧 `contract.mexc.com` は2026-01-19廃止）
- **ローカル実行前提**: Vercel関数の60秒制限を回避するためサーバーサイドでは動かさない
- **生Klineデータはコミットしない**: サイズ大、UIでは集計結果のみ使用

## トラブルシュート

### `429 Too Many Requests`
`mexc.ts` のリトライロジックが自動対応。それでも頻発する場合は並列数を下げる。

### MEXC APIが応答しない
ベースURLが `api.mexc.com` か確認。一部古いコードが `contract.mexc.com` を参照している可能性あり。

### `tsx` が見つからない
```bash
npm install -D tsx
```
