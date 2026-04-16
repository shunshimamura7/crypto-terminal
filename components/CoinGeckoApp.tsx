"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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
  price_change_percentage_7d_in_currency: number;
  sparkline_in_7d: { price: number[] };
  circulating_supply: number;
  total_supply: number | null;
  ath: number;
  ath_change_percentage: number;
}

interface ChartPoint {
  time: string;
  price: number;
}

type PeriodKey = "1" | "7" | "30" | "365";

const PERIODS: { label: string; value: PeriodKey }[] = [
  { label: "1D", value: "1" },
  { label: "7D", value: "7" },
  { label: "1M", value: "30" },
  { label: "1Y", value: "365" },
];

// ---- Helpers ---------------------------------------------------------------

function fmt(n: number, decimals = 2): string {
  return n?.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtUSD(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${fmt(n)}`;
}

function fmtPrice(n: number): string {
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${fmt(n)}`;
}

function PctBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={`text-sm font-mono ${positive ? "text-emerald-400" : "text-red-400"}`}
    >
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(2)}%
    </span>
  );
}

// Mini sparkline in the table
function Sparkline({ prices }: { prices: number[] }) {
  if (!prices || prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 80;
  const h = 30;
  const points = prices
    .map((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");
  const positive = prices[prices.length - 1] >= prices[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#34d399" : "#f87171"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- Main Component -------------------------------------------------------

export default function CoinGeckoApp() {
  const [coins, setCoins] = useState<CoinMarket[]>([]);
  const [selected, setSelected] = useState<CoinMarket | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("7");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch top coins list
  const fetchCoins = useCallback(async () => {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/coins/markets" +
          "?vs_currency=usd&order=market_cap_desc&per_page=20&page=1" +
          "&sparkline=true&price_change_percentage=7d",
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CoinMarket[] = await res.json();
      setCoins(data);
      setLastUpdated(new Date());
      setError(null);
      // Auto-select first coin if none selected
      setSelected((prev) => prev ?? data[0]);
    } catch (e) {
      setError("データ取得に失敗しました。しばらく後に再試行してください。");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch chart data for selected coin
  const fetchChart = useCallback(
    async (coinId: string, days: PeriodKey) => {
      setChartLoading(true);
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart` +
            `?vs_currency=usd&days=${days}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const points: ChartPoint[] = data.prices.map(
          ([ts, price]: [number, number]) => ({
            time:
              days === "1"
                ? new Date(ts).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : new Date(ts).toLocaleDateString("ja-JP", {
                    month: "short",
                    day: "numeric",
                  }),
            price,
          })
        );
        setChart(points);
      } catch (e) {
        console.error("Chart fetch failed:", e);
      } finally {
        setChartLoading(false);
      }
    },
    []
  );

  // Initial load + auto refresh every 60s
  useEffect(() => {
    fetchCoins();
    const interval = setInterval(fetchCoins, 60_000);
    return () => clearInterval(interval);
  }, [fetchCoins]);

  // Fetch chart when selection or period changes
  useEffect(() => {
    if (selected) fetchChart(selected.id, period);
  }, [selected, period, fetchChart]);

  const positive =
    selected && selected.price_change_percentage_24h >= 0;
  const chartColor = positive ? "#34d399" : "#f87171";
  const chartColorDim = positive
    ? "rgba(52,211,153,0.15)"
    : "rgba(248,113,113,0.15)";

  // ---- Render ---------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl animate-pulse">₿</div>
          <p className="text-gray-400 font-mono text-sm">
            市場データを読み込み中...
          </p>
        </div>
      </div>
    );
  }

  if (error && coins.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchCoins}
            className="px-4 py-2 bg-indigo-600 rounded-lg hover:bg-indigo-700 text-sm"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 font-mono">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">₿</span>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Crypto Terminal
              </h1>
              <p className="text-xs text-gray-500">powered by CoinGecko</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            {error && (
              <span className="text-yellow-500">⚠ {error}</span>
            )}
            {lastUpdated && (
              <span>
                更新: {lastUpdated.toLocaleTimeString("ja-JP")}
              </span>
            )}
            <button
              onClick={fetchCoins}
              className="px-3 py-1 rounded border border-gray-700 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
            >
              ↻ 更新
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Coin List */}
        <div className="xl:col-span-1">
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                マーケット TOP 20
              </h2>
            </div>
            <div className="divide-y divide-gray-800/50">
              {coins.map((coin) => (
                <button
                  key={coin.id}
                  onClick={() => setSelected(coin)}
                  className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-800/60 transition-colors ${
                    selected?.id === coin.id
                      ? "bg-gray-800 border-l-2 border-indigo-500"
                      : ""
                  }`}
                >
                  {/* Rank */}
                  <span className="text-xs text-gray-600 w-5 text-right shrink-0">
                    {coin.market_cap_rank}
                  </span>
                  {/* Icon */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={coin.image}
                    alt={coin.name}
                    width={28}
                    height={28}
                    className="rounded-full shrink-0"
                  />
                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {coin.name}
                    </div>
                    <div className="text-xs text-gray-500 uppercase">
                      {coin.symbol}
                    </div>
                  </div>
                  {/* Price + sparkline */}
                  <div className="text-right shrink-0">
                    <div className="text-sm text-white">
                      {fmtPrice(coin.current_price)}
                    </div>
                    <PctBadge value={coin.price_change_percentage_24h} />
                  </div>
                  <div className="shrink-0 hidden sm:block">
                    <Sparkline
                      prices={coin.sparkline_in_7d?.price ?? []}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          {selected && (
            <>
              {/* Coin Header */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selected.image}
                      alt={selected.name}
                      width={48}
                      height={48}
                      className="rounded-full"
                    />
                    <div>
                      <h2 className="text-2xl font-bold text-white">
                        {selected.name}
                      </h2>
                      <span className="text-sm text-gray-500 uppercase">
                        {selected.symbol} / USD
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-white">
                      {fmtPrice(selected.current_price)}
                    </div>
                    <div className="flex items-center gap-3 justify-end mt-1">
                      <div className="text-sm text-gray-400">24h:</div>
                      <PctBadge
                        value={selected.price_change_percentage_24h}
                      />
                      <div className="text-sm text-gray-400">7d:</div>
                      <PctBadge
                        value={
                          selected.price_change_percentage_7d_in_currency
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                    価格チャート
                  </h3>
                  <div className="flex gap-1">
                    {PERIODS.map(({ label, value }) => (
                      <button
                        key={value}
                        onClick={() => setPeriod(value)}
                        className={`px-3 py-1 text-xs rounded transition-colors ${
                          period === value
                            ? "bg-indigo-600 text-white"
                            : "text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {chartLoading ? (
                  <div className="h-64 flex items-center justify-center text-gray-500 text-sm animate-pulse">
                    チャートを読み込み中...
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart
                      data={chart}
                      margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="chartGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={chartColor}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={chartColor}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="time"
                        tick={{ fill: "#6b7280", fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                        minTickGap={40}
                      />
                      <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fill: "#6b7280", fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) =>
                          v >= 1000
                            ? `$${(v / 1000).toFixed(1)}k`
                            : `$${v.toFixed(v < 1 ? 4 : 0)}`
                        }
                        width={70}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#111827",
                          border: "1px solid #374151",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "#f9fafb",
                        }}
                        formatter={(v) => [fmtPrice(v as number), "価格"]}
                        labelStyle={{ color: "#9ca3af" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke={chartColor}
                        strokeWidth={2}
                        fill="url(#chartGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: chartColor }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Market Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  {
                    label: "時価総額",
                    value: fmtUSD(selected.market_cap),
                  },
                  {
                    label: "24h 取引量",
                    value: fmtUSD(selected.total_volume),
                  },
                  {
                    label: "時価総額ランク",
                    value: `#${selected.market_cap_rank}`,
                  },
                  {
                    label: "流通供給量",
                    value: `${(selected.circulating_supply / 1e6).toFixed(2)}M`,
                  },
                  {
                    label: "総供給量",
                    value: selected.total_supply
                      ? `${(selected.total_supply / 1e6).toFixed(2)}M`
                      : "∞",
                  },
                  {
                    label: "ATH",
                    value: (
                      <span>
                        {fmtPrice(selected.ath)}
                        <br />
                        <span
                          className={
                            selected.ath_change_percentage >= 0
                              ? "text-emerald-400 text-xs"
                              : "text-red-400 text-xs"
                          }
                        >
                          {selected.ath_change_percentage.toFixed(1)}%
                        </span>
                      </span>
                    ),
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3"
                  >
                    <div className="text-xs text-gray-500 mb-1">{label}</div>
                    <div className="text-sm font-semibold text-white">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="max-w-7xl mx-auto px-4 py-6 text-center text-xs text-gray-600">
        データ提供: CoinGecko API &nbsp;·&nbsp; 60秒ごとに自動更新
      </footer>
    </div>
  );
}
