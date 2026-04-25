# bell-crypto-terminal システム概要

## アーキテクチャ

Next.js App Router (nodejs runtime) を使用したサーバーサイドレンダリング+APIルートのモノリス構成。

### ディレクトリ構造

```
app/
  api/
    chat/route.ts        — 個別分析（Streaming, claude-sonnet-4-6, web_search x3）
    batch/route.ts       — バッチ分析（最大20銘柄, adjustScores+determineRank）
    sector/route.ts      — セクター分析（DeFiLlama+CoinGecko, claude-sonnet-4-6）
    info/route.ts        — 銘柄基本情報 (CoinGecko)
    derivatives/[symbol]/route.ts — FR/OI取得 (Coinglass fallback chain)
    market-env/route.ts  — マクロ環境データ
    openclaw/route.ts    — OpenClaw API (CoinGecko + AI + web_search x1)
  lib/
    coinResearch.ts      — CoinGecko/DexScreener/GeckoTerminal/GoPlus/DeFiLlama並列取得 + fetchWithRetry
    coinglass.ts         — FR/OI取得 (OKX→Gate.io→MEXC fallback) + evaluateShortSignal
    sosovalue.ts         — ETFフロー取得
    tokenomist.ts        — トークンアンロックデータ
    arkham.ts            — Arkham Intelligence
    socialScore.ts       — XHeat Score算出
    systemPrompts/
      bell_v5.ts         — BASE_SYSTEM_PROMPT (ホルダー/スマートマネー/アンロック強化版)
components/
  ChatApp.tsx            — メインUI (タブ管理, 検索, 結果表示, DataConfidenceBadge)
  SectorAnalyzer.tsx     — セクター分析UI (GemsTable MC/FDV列, ShortCandidatesCard, HolderConcentrationCard)
  BatchAnalyzer.tsx      — バッチ分析UI
  ShortScanner.tsx       — Short Scanner (ShortSignalBadge付き)
  DerivativesPanel.tsx   — デリバティブデータパネル (自己fetch)
  PortfolioCalc.tsx      — ポートフォリオ配分計算 (合計%比例スケール編集対応)
```

## 主要APIルート仕様

### `/api/chat` (POST)
- モデル: claude-sonnet-4-6, streaming
- tools: web_search_20250305 (max_uses: 3)
- 事前注入データ: GoPlus, DeFiLlama, FearGreed, CoinResearch(CoinGecko/DexScreener), Coinglass(FR/OI), ステーブルコインMC
- 出力: ストリーミングテキスト + 末尾JSONブロック (rank/alpha/risk/data_confidence等)
- Rate limit: 20回/日/IP

### `/api/batch` (POST)
- モデル: claude-sonnet-4-6, max_tokens: 1000
- 最大20銘柄、銘柄間1000ms間隔
- 事後補正: adjustScores (MC/FDV・Vol/MC・7d・24h・FR・LongRatio・UnlockRisk・ETFFlow・XHeat)
- ランク: determineRank(alpha, risk) でサーバー側確定 (S/A/B/C/D/E/F)

### `/api/sector` (POST)
- モデル: claude-sonnet-4-6, max_tokens: 4000
- データ: DeFiLlama TVL + CoinGecko Top15(MC/FDV/Vol/MC/流通率付き) + FearGreed
- deepResearch: 上位5銘柄 × 1500ms間隔 (CoinGecko 429対策)
- 出力JSON: gems[]/warnings[]/short_candidates/holder_concentration/high_concentration_tickers

### `/api/derivatives/[symbol]` (GET)
- Coinglass fallback chain: OKX → Gate.io → MEXC
- 返却: fundingRate, openInterest, longRatio, shortSignal (danger/caution/neutral/favorable/strong)

## スコアリング設計

### Alpha基準 (ベースライン: 40)
| 条件 | 加点 |
|---|---|
| MC/FDV 0.4-0.8 | +10 |
| MC/FDV 0.2-0.4 | +15 |
| MC/FDV < 0.2 | +5（希薄化で相殺） |
| ATH比 -90%+ | +15 |
| ATH比 -70%+ | +10 |
| ATH比 -50%+ | +5 |
| OI 24h +5%以上 | +5 |
| ETF インフロー(BTC/ETH) | +5 |

### Risk基準 (ベースライン: 40)
| 条件 | 加点 |
|---|---|
| MC/FDV < 0.2 | +20 |
| FR > 0.1%/8h | +15 |
| ロング比率 > 70% | +10 |
| アンロック 30日以内 10%+ | +20 |
| アンロック 30日以内 5%+ | +10 |
| Vol/MC < 3% | +10 |
| MC/FDV > 0.8 | -5 |

### ランク判定
| ランク | 条件 |
|---|---|
| S | Alpha≥85 かつ Risk≤35 |
| A | Alpha≥70 かつ Risk≤50 |
| B | Alpha≥55 かつ Risk≤60 |
| C | Alpha≥40 |
| D | Alpha<40 かつ Risk<50 |
| E | Risk>70 |
| F | Risk>85 またはScam疑い |

---

## 精度向上アップグレード（2026-04-25）

### バッチ分析精度向上
- **adjustScores 補正ロジック強化**: MC/FDV比・Vol/MC比・7d急騰・24h急落の4つの定量補正を追加。LLM依存度を低減
- **ランク再計算**: adjustScores後のAlpha/Riskからサーバー側でランクを再決定。Claude出力との矛盾を解消
- **定量スコアリングアンカー**: プロンプトにMC/FDV比・ATH比・FR等の具体的な加点/減点基準を追加。ベースライン40からの加算方式でLLMのスコアブレを抑制
- **MarketMetrics キャッシュ**: CoinResearch内のCoinGeckoデータをキャッシュしてadjustScoresに渡す仕組みを追加

### チャット分析精度向上
- **CoinResearch + Coinglass事前注入**: web_search不要の基本データをシステムプロンプトに注入。web_searchを3回に増加
- **ステーブルコインMC注入**: 市場環境の追加コンテキスト
- **ホルダー分析強化**: 健全性スコア(1-10)、集中リスク4段階判定、Top10保有率基準値を追加
- **スマートマネー分析強化**: 流入強度(0-10)、Exit Liquidity判定を追加
- **アンロック分析強化**: アンロックリスクスコア(0-10)、MC/FDV希薄化リスク4段階を追加
- **信頼度サマリー**: [実測]/[推定]/[要確認]の集計をJSON出力 + UIバッジ表示

### セクター分析精度向上
- **定量スコアリングアンカー**: Gems Top10にMC/FDV比・Vol/MC比・TVL成長率等の定量基準を追加
- **CoinGeckoレート制限対策**: deepResearch対象を10→5銘柄、間隔を500ms→1500msに。fetchCategoryCoinsにFDV/流通率追加。fetchWithRetry(exponential backoff)追加
- **UI拡張**: ショート候補カード、ホルダー集中度カード、GemsテーブルにMC/FDV列、WarningテーブルにRiskスコア列を追加
- **ランク判定基準統一**: バッチ分析と同じS〜F閾値を適用

### その他
- **OpenClaw API**: web_search(max_uses:1)を追加
- **ゴミファイル削除**: route.ts.backup削除、@google/generative-ai SDK削除

---

## 既知の課題

| 優先度 | 項目 | 詳細 | ステータス |
|---|---|---|---|
| **高** | Coinglass FR精度 | 無料枠だとデータが古い可能性 | 未対応 |
| **中** | セクター分析タイムアウト | CoinGecko 429多発時に全データなし | 部分対応(fetchWithRetry) |
| **低** | ~~Google Generative AI SDK~~ | ~~package.jsonにあるが、用途が不明確~~ | **削除済み（2026-04-25）** |
| **低** | ~~`route.ts.backup`~~ | ~~`/api/chat/route.ts.backup` が残っている~~ | **削除済み（2026-04-25）** |
