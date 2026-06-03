// Non-crypto base symbols — exact match after stripping _USDT
const NON_CRYPTO_BASES = new Set([
  // コモディティ
  "USOIL", "UKOIL", "XAUT", "SILVER", "ALUMINUM", "COPPER", "NATGAS",
  "WHEAT", "CORN", "CRUDE", "OIL", "NFP", "US",
  // 指数 (exact base names)
  "SPX", "VIX", "DJI", "HSI", "IBEX", "NIFTY", "KOSPI", "JP225",
  // FX
  "EURUSD", "GBPUSD", "USDJPY",
  // 株式トークン
  "NVDA", "TSLA", "AAPL", "META", "GOOGL", "AMZN", "MSFT", "NFLX", "AMD", "COIN", "MSTR",
  "ANTHROPIC", "OPENAI", "SPACEX", "USIB", "USIN",
]);

// Keywords appearing within the base name (covers tokenized equities with brand names)
const NON_CRYPTO_KEYWORDS = [
  "TRUMP", "MUSK", "NVIDIA", "UBER", "HOOD",
];

// Regex patterns matched against the full symbol string (e.g. "NAS100_USDT")
const NON_CRYPTO_PATTERNS = [
  // Precious metals & commodities
  /^(GOLD|SILVER|COPPER|XAU|XAG|XPD|XPT|USOIL|UKOIL|WTI|BRENT|NATGAS|WHEAT|CORN|SOYBEAN|SUGAR|COFFEE|COTTON|COCOA)_/i,
  // Stock indices (fixed names)
  /^(FTSE|DAX|CAC40|IBEX|KOSPI|NIFTY|ASX200|NASDAQ|NDX|DJI|HSI|NI225)_/i,
  // Stock indices with numeric suffix: SPX500, NAS100, US30, HK50, GER40, UK100, JPN225 …
  /^(SPX|NAS|HK|US|GER|UK|JPN|JP|NI)\d+_/i,
  // FX pairs
  /^(EUR|GBP|JPY|AUD|CAD|CHF|NZD|KRW|HKD|CNH|SGD|MXN|BRL|INR|ZAR)_/i,
  // Macro economic synthetics
  /^NFP_/i,
];

export function isNonCryptoSymbol(symbol: string): boolean {
  const base = symbol.replace(/_USDT$/i, "").toUpperCase();
  if (NON_CRYPTO_BASES.has(base)) return true;
  // Tokenized equities often have STOCK in the name (e.g. AAPLSTOCK_USDT)
  if (/STOCK/i.test(base)) return true;
  if (NON_CRYPTO_KEYWORDS.some(kw => base.includes(kw))) return true;
  if (NON_CRYPTO_PATTERNS.some(p => p.test(symbol))) return true;
  return false;
}

export function filterCryptoOnly<T extends { symbol: string }>(items: T[]): T[] {
  return items.filter(it => !isNonCryptoSymbol(it.symbol));
}
