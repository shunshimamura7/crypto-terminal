"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  FormEvent,
} from "react";

// ---- Types ----------------------------------------------------------------

interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  sparkline_in_7d?: { price: number[] };
  circulating_supply: number;
  total_supply: number | null;
  ath: number;
  ath_change_percentage: number;
}

interface DexPair {
  pairAddress: string;
  chainId: string;
  dexId: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume: { h24: number };
  priceChange: { h24: number };
  url: string;
}

interface PriceAlert {
  id: string;
  coinId: string;
  coinName: string;
  coinSymbol: string;
  targetPrice: number;
  direction: "above" | "below";
}

type MessageType = "text" | "coin-card" | "dex-card";

interface Message {
  id: string;
  role: "user" | "bot";
  type: MessageType;
  content: string;
  coinData?: CoinMarket;
  dexData?: DexPair[];
  streaming?: boolean;
  timestamp: Date;
}

// ---- Constants ------------------------------------------------------------

const COIN_ALIASES: Record<string, string> = {
  ビットコイン: "bitcoin", btc: "bitcoin", bitcoin: "bitcoin",
  イーサリアム: "ethereum", eth: "ethereum", ethereum: "ethereum",
  ソラナ: "solana", sol: "solana", solana: "solana",
  リップル: "ripple", xrp: "ripple", ripple: "ripple",
  バイナンスコイン: "binancecoin", bnb: "binancecoin", binancecoin: "binancecoin",
  ドージコイン: "dogecoin", doge: "dogecoin", dogecoin: "dogecoin",
  ポリゴン: "matic-network", matic: "matic-network", polygon: "matic-network",
  アバランチ: "avalanche-2", avax: "avalanche-2", avalanche: "avalanche-2",
  チェーンリンク: "chainlink", link: "chainlink",
  ユニスワップ: "uniswap", uni: "uniswap",
  シバイヌ: "shiba-inu", shib: "shiba-inu",
  カルダノ: "cardano", ada: "cardano",
  ポルカドット: "polkadot", dot: "polkadot",
  コスモス: "cosmos", atom: "cosmos",
  ニア: "near", near: "near",
  アービトラム: "arbitrum", arb: "arbitrum",
  オプティミズム: "optimism", op: "optimism",
  スイ: "sui", sui: "sui",
  アプトス: "aptos", apt: "aptos",
  pepe: "pepe",
  trump: "official-trump",
  wif: "dogwifcoin",
  bonk: "bonk",
  ltc: "litecoin", litecoin: "litecoin", ライトコイン: "litecoin",
  inj: "injective-protocol",
};

const QUICK_COINS = [
  { label: "BTC", query: "bitcoin" },
  { label: "ETH", query: "ethereum" },
  { label: "SOL", query: "solana" },
  { label: "BNB", query: "bnb" },
  { label: "XRP", query: "xrp" },
  { label: "DOGE", query: "doge" },
  { label: "AVAX", query: "avax" },
  { label: "LINK", query: "link" },
];

const WELCOME_MESSAGE = `👋 こんにちは！暗号通貨情報 AI アシスタントです。

銘柄名を入力すると以下の情報をまとめてお届けします：
📊 CoinGecko — 価格・時価総額・チャート・ATH・供給量
🐋 スマートマネー — Arkham/Whale Alertの大口動向
🔓 トークンアンロック — 直近のアンロックスケジュール
🔵 ホルダー分散 — 上位ウォレット集中度
📈 DEXScreener — リアルタイム DEX 価格・流動性
🗣️ 著名人発言 — イーロン・マスク/Vitalik 等の最新コメント
💼 VC投資情報 — a16z/Paradigm 等の動向

「BTC」「ソラナ」「ethereum」など日本語・英語どちらでもOK！`;

// ---- Helpers --------------------------------------------------------------

function fmtPrice(n: number): string {
  if (!n) return "$0";
  if (n < 0.001) return `$${n.toFixed(8)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtLarge(n: number): string {
  if (!n) return "$0";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function getCoinId(query: string): string | null {
  return COIN_ALIASES[query.toLowerCase().trim()] ?? null;
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---- Sub-components -------------------------------------------------------

function PctBadge({ value }: { value: number }) {
  const pos = value >= 0;
  return (
    <span className={`text-xs font-mono ${pos ? "text-emerald-400" : "text-red-400"}`}>
      {pos ? "▲" : "▼"} {Math.abs(value).toFixed(2)}%
    </span>
  );
}

function Sparkline({ prices }: { prices: number[] }) {
  if (!prices || prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const W = 120;
  const H = 40;
  const pts = prices
    .map((p, i) => `${(i / (prices.length - 1)) * W},${H - ((p - min) / range) * H}`)
    .join(" ");
  const pos = prices[prices.length - 1] >= prices[0];
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={pos ? "#34d399" : "#f87171"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CoinCard({ coin }: { coin: CoinMarket }) {
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 p-4 w-full max-w-sm">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coin.image} alt={coin.name} width={36} height={36} className="rounded-full" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white truncate">{coin.name}</div>
          <div className="text-xs text-gray-500 uppercase">{coin.symbol} / USD</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-white">{fmtPrice(coin.current_price)}</div>
          <PctBadge value={coin.price_change_percentage_24h} />
        </div>
      </div>

      {/* Sparkline */}
      {coin.sparkline_in_7d && (
        <div className="mb-3 flex justify-center">
          <Sparkline prices={coin.sparkline_in_7d.price} />
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {([
          ["時価総額", fmtLarge(coin.market_cap)],
          ["24h取引量", fmtLarge(coin.total_volume)],
          ["ATH", fmtPrice(coin.ath)],
          ["ATH乖離", `${coin.ath_change_percentage.toFixed(1)}%`],
          ["流通量", `${(coin.circulating_supply / 1e6).toFixed(2)}M`],
          ["総供給量", coin.total_supply ? `${(coin.total_supply / 1e6).toFixed(2)}M` : "∞"],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="bg-gray-800 rounded-lg p-2">
            <div className="text-gray-500 text-xs mb-0.5">{label}</div>
            <div className="text-white font-mono text-xs">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-right">
        <span className="text-xs text-gray-600">出典: CoinGecko | ランク #{coin.market_cap_rank}</span>
      </div>
    </div>
  );
}

function DexCard({ pairs }: { pairs: DexPair[] }) {
  if (pairs.length === 0) return null;
  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700 p-4 w-full max-w-sm">
      <div className="flex items-center gap-2 mb-3">
        <span>📊</span>
        <span className="font-semibold text-white text-sm">DEXScreener リアルタイムデータ</span>
      </div>
      <div className="space-y-2">
        {pairs.map((pair) => (
          <a
            key={pair.pairAddress}
            href={pair.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-gray-800 rounded-xl p-3 hover:bg-gray-750 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-white font-mono">
                {pair.baseToken.symbol}/{pair.quoteToken.symbol}
              </span>
              <span className="text-xs text-gray-400 capitalize">
                {pair.dexId} · {pair.chainId}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono text-white">
                ${parseFloat(pair.priceUsd || "0").toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
                })}
              </span>
              <div className="flex items-center gap-2">
                {pair.liquidity?.usd != null && (
                  <span className="text-xs text-gray-400">
                    流動性: {fmtLarge(pair.liquidity.usd)}
                  </span>
                )}
                <PctBadge value={pair.priceChange?.h24 ?? 0} />
              </div>
            </div>
            {pair.volume?.h24 > 0 && (
              <div className="text-xs text-gray-500 mt-0.5">
                24h量: {fmtLarge(pair.volume.h24)}
              </div>
            )}
          </a>
        ))}
      </div>
      <div className="mt-2 text-right">
        <span className="text-xs text-gray-600">出典: DEXScreener</span>
      </div>
    </div>
  );
}

// Simple markdown-like renderer for AI responses
function AiText({ content }: { content: string }) {
  return (
    <div className="space-y-0.5 text-sm">
      {content.split("\n").map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <div key={i} className="text-indigo-400 font-bold mt-4 first:mt-0 pb-0.5 border-b border-gray-700">
              {line.slice(3)}
            </div>
          );
        }
        if (line.startsWith("### ")) {
          return <div key={i} className="text-gray-200 font-semibold mt-2">{line.slice(4)}</div>;
        }
        if (line.startsWith("- ") || line.startsWith("• ") || line.startsWith("* ")) {
          return (
            <div key={i} className="text-gray-300 ml-3">
              • {line.replace(/^[-•*] /, "")}
            </div>
          );
        }
        if (line === "") {
          return <div key={i} className="h-1" />;
        }
        // Inline bold: **text**
        if (line.includes("**")) {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <div key={i} className="text-gray-300">
              {parts.map((part, j) =>
                part.startsWith("**") && part.endsWith("**") ? (
                  <strong key={j} className="text-white font-semibold">
                    {part.slice(2, -2)}
                  </strong>
                ) : (
                  part
                )
              )}
            </div>
          );
        }
        return <div key={i} className="text-gray-300">{line}</div>;
      })}
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 150, 300].map((delay) => (
        <div
          key={delay}
          className="w-2 h-2 rounded-full bg-gray-500 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

function AlertModal({
  coinData,
  onClose,
  onSave,
}: {
  coinData: CoinMarket | null;
  onClose: () => void;
  onSave: (alert: Omit<PriceAlert, "id">) => void;
}) {
  const [targetPrice, setTargetPrice] = useState(
    coinData ? String(coinData.current_price) : ""
  );
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [coinId, setCoinId] = useState(coinData?.id ?? "bitcoin");
  const [coinName, setCoinName] = useState(coinData?.name ?? "Bitcoin");
  const [coinSymbol, setCoinSymbol] = useState(
    coinData?.symbol.toUpperCase() ?? "BTC"
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const price = parseFloat(targetPrice);
    if (!price || !coinId) return;
    onSave({ coinId, coinName, coinSymbol, targetPrice: price, direction });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 rounded-2xl border border-gray-700 p-6 w-full max-w-sm">
        <h2 className="text-white font-bold text-lg mb-5">🔔 価格アラート設定</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {coinData ? (
            <div className="flex items-center gap-3 bg-gray-800 rounded-xl p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coinData.image} alt={coinData.name} width={32} height={32} className="rounded-full" />
              <div>
                <div className="text-white font-semibold text-sm">{coinData.name}</div>
                <div className="text-gray-400 text-xs">
                  現在: {fmtPrice(coinData.current_price)}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-gray-400 text-xs block">銘柄 ID (CoinGecko)</label>
              <input
                value={coinId}
                onChange={(e) => setCoinId(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 text-sm border border-gray-700 focus:border-indigo-500 outline-none"
                placeholder="bitcoin"
              />
              <input
                value={coinName}
                onChange={(e) => setCoinName(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-xl px-3 py-2 text-sm border border-gray-700 focus:border-indigo-500 outline-none"
                placeholder="Bitcoin"
              />
            </div>
          )}

          <div>
            <label className="text-gray-400 text-xs mb-1 block">目標価格 (USD)</label>
            <input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-xl px-3 py-2.5 text-sm border border-gray-700 focus:border-indigo-500 outline-none"
              placeholder="100000"
              step="any"
              min="0"
              required
            />
          </div>

          <div>
            <label className="text-gray-400 text-xs mb-1 block">アラート条件</label>
            <div className="grid grid-cols-2 gap-2">
              {(["above", "below"] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setDirection(dir)}
                  className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    direction === dir
                      ? dir === "above"
                        ? "bg-emerald-600 text-white"
                        : "bg-red-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {dir === "above" ? "▲ 価格以上" : "▼ 価格以下"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 bg-gray-800 text-gray-400 rounded-xl text-sm hover:bg-gray-700"
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700"
            >
              設定する
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Main component -------------------------------------------------------

export default function ChatApp() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "bot",
      type: "text",
      content: WELCOME_MESSAGE,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [latestCoin, setLatestCoin] = useState<CoinMarket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persist alerts
  useEffect(() => {
    try {
      const saved = localStorage.getItem("crypto-price-alerts");
      if (saved) setAlerts(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("crypto-price-alerts", JSON.stringify(alerts));
    } catch {}
  }, [alerts]);

  // Price alert checker (every 60s)
  useEffect(() => {
    if (alerts.length === 0) return;

    const check = async () => {
      for (const alert of alerts) {
        try {
          const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${alert.coinId}&vs_currencies=usd`
          );
          const data = await res.json();
          const price: number = data[alert.coinId]?.usd;
          if (!price) continue;

          const triggered =
            (alert.direction === "above" && price >= alert.targetPrice) ||
            (alert.direction === "below" && price <= alert.targetPrice);

          if (!triggered) continue;

          // Browser notification
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification("🚨 Crypto Terminal アラート", {
              body: `${alert.coinName} が $${alert.targetPrice.toLocaleString()} に到達！現在: $${price.toLocaleString()}`,
            });
          }

          // In-chat notification
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: "bot",
              type: "text",
              content: `🚨 **価格アラート発動！**\n**${alert.coinName} (${alert.coinSymbol})** が目標価格 **$${alert.targetPrice.toLocaleString()}** に到達しました。\n現在価格: $${price.toLocaleString()}`,
              timestamp: new Date(),
            },
          ]);

          setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
        } catch {}
      }
    };

    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [alerts]);

  const updateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
      );
    },
    []
  );

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || loading) return;

      setLoading(true);
      setInput("");
      inputRef.current?.blur();

      // User message
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: "user",
          type: "text",
          content: query.trim(),
          timestamp: new Date(),
        },
      ]);

      const coinId = getCoinId(query);

      // --- CoinGecko fetch ---
      const coinDataPromise: Promise<CoinMarket | null> = (async () => {
        try {
          let id = coinId;
          if (!id) {
            // Search by name
            const sr = await fetch(
              `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
              { signal: AbortSignal.timeout(6000) }
            );
            const sd = await sr.json();
            id = sd.coins?.[0]?.id ?? null;
          }
          if (!id) return null;
          const r = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${id}&sparkline=true&price_change_percentage=7d`,
            { signal: AbortSignal.timeout(6000) }
          );
          const d: CoinMarket[] = await r.json();
          return d[0] ?? null;
        } catch {
          return null;
        }
      })();

      // --- DEXScreener fetch ---
      const dexDataPromise: Promise<DexPair[]> = (async () => {
        try {
          const r = await fetch(
            `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!r.ok) return [];
          const d = await r.json();
          if (!Array.isArray(d.pairs)) return [];
          return (d.pairs as DexPair[])
            .filter((p) => (p.liquidity?.usd ?? 0) > 50_000)
            .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
            .slice(0, 3);
        } catch {
          return [];
        }
      })();

      // Placeholder coin card (loading state)
      const coinCardId = `coin-${genId()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: coinCardId,
          role: "bot",
          type: "coin-card",
          content: "",
          streaming: true,
          timestamp: new Date(),
        },
      ]);

      const [coinData, dexData] = await Promise.all([coinDataPromise, dexDataPromise]);

      // Update or remove coin card
      if (coinData) {
        setLatestCoin(coinData);
        updateMessage(coinCardId, { coinData, streaming: false });
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== coinCardId));
      }

      // DEX card
      if (dexData.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "bot",
            type: "dex-card",
            content: "",
            dexData,
            timestamp: new Date(),
          },
        ]);
      }

      // AI analysis placeholder
      const aiId = genId();
      setMessages((prev) => [
        ...prev,
        {
          id: aiId,
          role: "bot",
          type: "text",
          content: "",
          streaming: true,
          timestamp: new Date(),
        },
      ]);

      // Stream AI analysis
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim() }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "接続エラー");
          updateMessage(aiId, { content: `❌ ${errText}`, streaming: false });
          setLoading(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "text") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiId
                      ? { ...m, content: m.content + ev.text }
                      : m
                  )
                );
              } else if (ev.type === "done") {
                updateMessage(aiId, { streaming: false });
              } else if (ev.type === "error") {
                updateMessage(aiId, {
                  content: `❌ AI エラー: ${ev.message}`,
                  streaming: false,
                });
              }
            } catch {}
          }
        }

        updateMessage(aiId, { streaming: false });
      } catch (err) {
        updateMessage(aiId, {
          content: `❌ 接続エラー: ${err instanceof Error ? err.message : "Unknown"}`,
          streaming: false,
        });
      }

      setLoading(false);
    },
    [loading, updateMessage]
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleSearch(input);
  };

  const addAlert = (alert: Omit<PriceAlert, "id">) => {
    setAlerts((prev) => [...prev, { id: genId(), ...alert }]);
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "bot",
        type: "text",
        content: WELCOME_MESSAGE,
        timestamp: new Date(),
      },
    ]);
    setLatestCoin(null);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 font-sans">
      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-lg font-bold text-white shrink-0">
            ₿
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-tight">
              Crypto Terminal AI
            </h1>
            <p className="text-gray-500 text-xs">
              CoinGecko · DEXScreener · Claude AI
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {alerts.length > 0 && (
            <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
              🔔 {alerts.length}
            </span>
          )}
          <button
            onClick={() => setShowAlertModal(true)}
            className="text-xs text-gray-400 border border-gray-700 rounded-lg px-2.5 py-1.5 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
          >
            アラート設定
          </button>
          <button
            onClick={clearChat}
            className="text-xs text-gray-400 border border-gray-700 rounded-lg px-2.5 py-1.5 hover:border-red-500 hover:text-red-400 transition-colors"
          >
            クリア
          </button>
        </div>
      </header>

      {/* ── Quick Buttons ── */}
      <div className="bg-gray-900 border-b border-gray-800 px-3 py-2 flex gap-1.5 overflow-x-auto shrink-0">
        {QUICK_COINS.map(({ label, query }) => (
          <button
            key={label}
            onClick={() => handleSearch(query)}
            disabled={loading}
            className="shrink-0 px-3 py-1.5 bg-gray-800 text-gray-300 text-xs font-mono rounded-lg hover:bg-indigo-600 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-end gap-2 ${
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {/* Bot avatar */}
            {msg.role === "bot" && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shrink-0 mb-1">
                ₿
              </div>
            )}

            <div
              className={`flex flex-col gap-1 ${
                msg.role === "user" ? "items-end" : "items-start"
              } max-w-[88%] sm:max-w-lg`}
            >
              {/* Coin card */}
              {msg.type === "coin-card" && (
                <div>
                  {msg.streaming ? (
                    <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-gray-400 text-sm">
                      <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      CoinGecko データ取得中...
                    </div>
                  ) : msg.coinData ? (
                    <CoinCard coin={msg.coinData} />
                  ) : null}
                </div>
              )}

              {/* DEX card */}
              {msg.type === "dex-card" && msg.dexData && (
                <DexCard pairs={msg.dexData} />
              )}

              {/* Text bubble */}
              {msg.type === "text" && (
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm text-sm"
                      : "bg-gray-800 rounded-bl-sm w-full"
                  }`}
                >
                  {msg.role === "bot" ? (
                    <>
                      {msg.content ? (
                        <AiText content={msg.content} />
                      ) : msg.streaming ? (
                        <LoadingDots />
                      ) : null}
                      {msg.streaming && msg.content && (
                        <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse align-middle ml-0.5" />
                      )}
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
              )}

              {/* Timestamp */}
              <div className="text-xs text-gray-600 px-1">
                {msg.timestamp.toLocaleTimeString("ja-JP", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="bg-gray-900 border-t border-gray-800 px-3 py-3 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="銘柄名を入力（BTC、ソラナ、ethereum…）"
            className="flex-1 bg-gray-800 text-white placeholder-gray-500 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-gray-700 min-w-0"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-indigo-700 transition-colors"
            aria-label="送信"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                className="w-5 h-5 text-white translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </form>
      </div>

      {/* ── Alert Modal ── */}
      {showAlertModal && (
        <AlertModal
          coinData={latestCoin}
          onClose={() => setShowAlertModal(false)}
          onSave={addAlert}
        />
      )}
    </div>
  );
}
