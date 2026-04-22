import ShortScanner from "@/components/ShortScanner";

export default function ShortScanPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* B: Landing hero */}
      <section className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 bg-red-50 text-red-700 text-xs font-semibold px-3 py-1 rounded-full border border-red-200 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                MEXC Futures ショートスキャナー
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight mb-3">
                ATH急落 × 出来高枯渇を<br className="hidden sm:inline" />リアルタイムで自動検出
              </h1>
              <p className="text-sm text-gray-500 leading-relaxed mb-5 max-w-xl">
                MEXC先物の全銘柄を自動スキャンし、高値から大幅下落 × 出来高枯渇 ×
                ファンディングレート逆張り × OI過剰 × 急騰後リバなど複数シグナルを
                総合スコアリング。ショートエントリー候補をTOP20で表示します。
              </p>
              {/* Feature badges */}
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: "📉", label: "ATH比下落率スキャン" },
                  { icon: "📊", label: "出来高プロファイル(VPCR)" },
                  { icon: "💸", label: "ファンディングレート" },
                  { icon: "🔗", label: "OI/出来高比" },
                  { icon: "🚀", label: "急騰後リバ検出" },
                  { icon: "⚔️", label: "SL/TP自動計算" },
                ].map(f => (
                  <span key={f.label} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full font-medium">
                    <span>{f.icon}</span>{f.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Stats panel */}
            <div className="flex-shrink-0 grid grid-cols-2 gap-3 md:gap-4 w-full md:w-auto">
              {[
                { value: "全銘柄", sub: "MEXC先物を網羅スキャン", color: "text-indigo-600" },
                { value: "TOP 20", sub: "スコア順で表示", color: "text-red-600" },
                { value: "7スコア", sub: "独自アルゴリズム", color: "text-orange-500" },
                { value: "SL/TP", sub: "Klineから自動算出", color: "text-green-600" },
              ].map(s => (
                <div key={s.value} className="bg-gray-50 rounded-xl p-3 border border-gray-200 text-center">
                  <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{s.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">スコアリング方法</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {[
                { label: "ATH下落", max: "3pt", color: "#ef4444" },
                { label: "出来高枯渇", max: "3pt", color: "#f97316" },
                { label: "FR逆張り", max: "2pt", color: "#a855f7" },
                { label: "上場新しさ", max: "2pt", color: "#3b82f6" },
                { label: "OI過剰", max: "2pt", color: "#06b6d4" },
                { label: "EMAトレンド", max: "2pt", color: "#10b981" },
                { label: "7d急騰", max: "2pt", color: "#f43f5e" },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center gap-1 text-center">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-[10px] text-gray-600 font-medium leading-tight">{s.label}</span>
                  <span className="text-[10px] font-bold" style={{ color: s.color }}>{s.max}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Scanner */}
      <section className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <ShortScanner />
      </section>

      {/* H: Disclaimer */}
      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <p className="text-xs font-semibold text-gray-500 mb-2">⚠️ 免責事項 / Disclaimer</p>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            本ツールは情報提供のみを目的としており、投資助言・売買推奨ではありません。
            暗号資産取引には元本損失リスクを含む重大なリスクが伴います。
            スコアやトレードセットアップはアルゴリズムによる参考値であり、
            実際の取引判断はご自身の責任で行ってください。
            過去のパフォーマンスは将来の結果を保証するものではありません。
          </p>
          <p className="text-[11px] text-gray-400 leading-relaxed mt-1">
            This tool is for informational purposes only and does not constitute investment advice or trading recommendations.
            Cryptocurrency trading involves substantial risk of loss. All signals and trade setups are algorithmic estimates.
            Always conduct your own due diligence before trading.
          </p>
        </div>
      </footer>
    </main>
  );
}
