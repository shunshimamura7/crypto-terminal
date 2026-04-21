const KEY = "watchlist";
const MAX = 30;

function getAll(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function getWatchlist(): string[] { return getAll(); }

export function addToWatchlist(item: string): "added" | "exists" | "full" {
  const items = getAll();
  const t = item.trim();
  if (items.includes(t)) return "exists";
  if (items.length >= MAX) return "full";
  localStorage.setItem(KEY, JSON.stringify([...items, t]));
  return "added";
}

export function removeFromWatchlist(item: string): void {
  localStorage.setItem(KEY, JSON.stringify(getAll().filter(i => i !== item.trim())));
}

export function isInWatchlist(item: string): boolean {
  return getAll().includes(item.trim());
}
