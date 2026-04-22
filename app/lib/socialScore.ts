export interface SocialData {
  twitterFollowers: number | null;
  redditSubscribers: number | null;
  redditPosts48h: number | null;
  communityScore: number | null;
}

export interface XHeatResult {
  score: number;
  twitterComponent: number;
  redditComponent: number;
  communityComponent: number;
}

export function calculateXHeatScore(data: SocialData): XHeatResult {
  // Twitter component (40%): log-scale, 1M followers = ~85 pts, 10M = 100
  let twitterScore = 0;
  if (data.twitterFollowers !== null && data.twitterFollowers > 1000) {
    twitterScore = Math.min(100, (Math.log10(data.twitterFollowers) - 3) / (7 - 3) * 100);
  }

  // Reddit component (30%): posts per 48h activity
  // Fallback to subscriber count if posts data is missing
  let redditScore = 0;
  if (data.redditPosts48h !== null && data.redditPosts48h > 0) {
    redditScore = Math.min(100, (data.redditPosts48h / 10) * 100);
  } else if (data.redditSubscribers !== null && data.redditSubscribers > 1000) {
    redditScore = Math.min(100, (Math.log10(data.redditSubscribers) - 3) / (6 - 3) * 100);
  }

  // Community score component (30%): CoinGecko community_score is 0-100
  const communityScore = Math.max(0, Math.min(100, data.communityScore ?? 0));

  const xheat = twitterScore * 0.4 + redditScore * 0.3 + communityScore * 0.3;

  return {
    score: Math.round(Math.max(0, Math.min(100, xheat))),
    twitterComponent: Math.round(Math.max(0, Math.min(100, twitterScore))),
    redditComponent: Math.round(Math.max(0, Math.min(100, redditScore))),
    communityComponent: Math.round(communityScore),
  };
}

export function xheatLabel(score: number): string {
  if (score >= 80) return "過熱";
  if (score >= 60) return "高温";
  if (score >= 40) return "普通";
  if (score >= 20) return "低温";
  return "冷却";
}
