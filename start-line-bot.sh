#!/bin/bash
# ============================================================
# Crypto Terminal LINE Bot 起動スクリプト
# ============================================================
# 使用前に以下の環境変数を設定してください：
#   export LINE_CHANNEL_ACCESS_TOKEN="your_token_here"
#   export LINE_CHANNEL_SECRET="your_secret_here"
#   export ANTHROPIC_API_KEY="your_anthropic_key_here"
# ============================================================

set -e

# --- 環境変数チェック ---
if [ -z "$LINE_CHANNEL_ACCESS_TOKEN" ]; then
  echo "❌ LINE_CHANNEL_ACCESS_TOKEN が設定されていません"
  echo "   export LINE_CHANNEL_ACCESS_TOKEN='your_token' を実行してください"
  exit 1
fi

if [ -z "$LINE_CHANNEL_SECRET" ]; then
  echo "❌ LINE_CHANNEL_SECRET が設定されていません"
  echo "   export LINE_CHANNEL_SECRET='your_secret' を実行してください"
  exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "⚠️  ANTHROPIC_API_KEY が設定されていません（AI分析機能が使えません）"
fi

echo "✅ 環境変数チェック完了"

# --- OpenClawゲートウェイをバックグラウンドで起動 ---
echo ""
echo "🦞 OpenClaw ゲートウェイを起動中..."
openclaw gateway start &
GATEWAY_PID=$!
echo "   Gateway PID: $GATEWAY_PID"

# ゲートウェイの起動を待つ
sleep 3

# --- ngrokでHTTPSトンネルを開く ---
echo ""
echo "🌐 ngrok でHTTPSトンネルを開いています..."
echo "   (ngrokが未インストールの場合: https://ngrok.com/download からインストール)"
echo ""

# OpenClawのデフォルトポート 18789 をトンネル
ngrok http 18789 --log=stdout &
NGROK_PID=$!

sleep 3

# ngrok の公開URLを取得
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tunnels = data.get('tunnels', [])
    for t in tunnels:
        if t.get('proto') == 'https':
            print(t['public_url'])
            break
except:
    pass
" 2>/dev/null)

echo ""
echo "============================================================"
echo "🎉 起動完了！"
echo ""
if [ -n "$NGROK_URL" ]; then
  echo "📱 LINE Webhook URL:"
  echo "   ${NGROK_URL}/line/webhook"
  echo ""
  echo "👉 LINE Developers コンソールでこのURLを設定してください"
  echo "   https://developers.line.biz/console/"
else
  echo "📱 LINE Webhook URL（ngrok起動後に確認）:"
  echo "   http://127.0.0.1:4040 でngrokのURLを確認し、"
  echo "   <ngrok_url>/line/webhook を LINE に設定してください"
fi
echo ""
echo "🔍 ゲートウェイ管理UI: http://127.0.0.1:18789"
echo "============================================================"
echo ""
echo "停止するには Ctrl+C を押してください"
echo ""

# 終了時にバックグラウンドプロセスを停止
cleanup() {
  echo ""
  echo "🛑 停止中..."
  kill $GATEWAY_PID 2>/dev/null || true
  kill $NGROK_PID 2>/dev/null || true
  openclaw gateway stop 2>/dev/null || true
  echo "✅ 停止完了"
}
trap cleanup EXIT INT TERM

# ゲートウェイのログを表示しながら待機
wait $GATEWAY_PID
