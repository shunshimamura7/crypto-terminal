const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/historical/results/S01-trades.json','utf8'));
const trades = data.trades ?? data;

function stats(arr) {
  const total = arr.length;
  if (total === 0) return { total: 0 };
  const wins = arr.filter(x => x.exitReason === 'tp_hit').length;
  const losses = arr.filter(x => x.exitReason === 'sl_hit').length;
  const timeouts = arr.filter(x => x.exitReason === 'timeout').length;
  const resolved = wins + losses;
  const winRate = resolved > 0 ? (wins / resolved * 100).toFixed(1) : 0;
  const avgPnl = (arr.reduce((s,x) => s + x.pnlPct, 0) / total).toFixed(2);
  return { total, wins, losses, timeouts, winRate: winRate + '%', avgPnl: avgPnl + '%' };
}

const stocks = trades.filter(x => x.symbol.endsWith('STOCK_USDT'));
const nonStocks = trades.filter(x => !x.symbol.endsWith('STOCK_USDT'));

console.log('=== 全体 ===', stats(trades));
console.log('=== STOCK のみ ===', stats(stocks));
console.log('=== STOCK 除外後 ===', stats(nonStocks));
