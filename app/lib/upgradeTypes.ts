export interface UpgradeEvent {
  id: string;
  symbol: string;
  source: 'github' | 'blog' | 'twitter' | 'coinmarketcal';
  type: 'mainnet' | 'hardfork' | 'release' | 'integration' | 'other';
  importance: 'critical' | 'major' | 'minor';
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  scheduledAt?: string;
  daysUntil?: number;
}

export interface UpgradeSourceConfig {
  github?: string;         // 'owner/repo'
  blog_rss?: string;
  twitter?: string;
  coinmarketcal_id?: string;
}
