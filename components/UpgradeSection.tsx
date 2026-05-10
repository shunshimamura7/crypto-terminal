'use client';

import { useEffect, useState } from 'react';
import type { UpgradeEvent } from '@/app/lib/upgradeTypes';
import { UPGRADE_SOURCES } from '@/app/lib/upgradeSources';

const SOURCE_ICON: Record<UpgradeEvent['source'], string> = {
  github: '🐙',
  blog: '📝',
  twitter: '🐦',
  coinmarketcal: '📅',
};

const IMPORTANCE_STYLE: Record<UpgradeEvent['importance'], string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  major:    'bg-amber-100 text-amber-700 border-amber-200',
  minor:    'bg-gray-100 text-gray-500 border-gray-200',
};

const IMPORTANCE_LABEL: Record<UpgradeEvent['importance'], string> = {
  critical: '🔴 重大',
  major:    '🟡 主要',
  minor:    '⚪ マイナー',
};

function daysBadge(days: number): string {
  if (days <= 0)  return '本日';
  if (days === 1) return '明日';
  return `${days}日後`;
}

export default function UpgradeSection({ symbol }: { symbol: string }) {
  const [events, setEvents]     = useState<UpgradeEvent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showMinor, setShowMinor] = useState(false);

  // UPGRADE_SOURCES にない銘柄はフェッチしない
  const hasSource = symbol.toUpperCase() in UPGRADE_SOURCES;

  useEffect(() => {
    if (!hasSource) { setLoading(false); return; }

    const ctrl = new AbortController();
    fetch(`/api/upgrades?symbol=${symbol.toUpperCase()}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { events?: UpgradeEvent[] }) => {
        setEvents(d.events ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, [symbol, hasSource]);

  if (!hasSource || loading) return null;
  if (events.length === 0)   return null;

  const upcoming = events
    .filter(e => e.scheduledAt && (e.daysUntil ?? 0) >= 0)
    .sort((a, b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999));

  const recent = events.filter(e => !e.scheduledAt || (e.daysUntil ?? 0) < 0);
  const filteredRecent = showMinor ? recent : recent.filter(e => e.importance !== 'minor');

  if (upcoming.length === 0 && filteredRecent.length === 0 && !showMinor) return null;

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border)] px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">⚡ アップグレード情報</span>
        {recent.some(e => e.importance === 'minor') && (
          <button
            onClick={() => setShowMinor(v => !v)}
            className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-full px-2 py-0.5 hover:border-blue-400 transition-colors"
          >
            {showMinor ? 'マイナー非表示' : 'マイナー表示'}
          </button>
        )}
      </div>

      {/* 今後のカタリスト */}
      {upcoming.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-[var(--text-secondary)] font-medium mb-2">📅 今後のカタリスト</div>
          <div className="flex flex-col gap-2">
            {upcoming.map(e => (
              <a
                key={e.id}
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 p-2 rounded-lg border border-[var(--border)] hover:border-blue-400 transition-colors group"
              >
                <span className="text-lg leading-none mt-0.5 shrink-0">
                  {SOURCE_ICON[e.source]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs border rounded px-1.5 py-0.5 font-medium ${IMPORTANCE_STYLE[e.importance]}`}>
                      {IMPORTANCE_LABEL[e.importance]}
                    </span>
                    <span className="text-xs font-mono text-blue-600 font-semibold shrink-0">
                      {daysBadge(e.daysUntil ?? 0)}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-[var(--text-primary)] mt-1 truncate group-hover:text-blue-600 transition-colors">
                    {e.title}
                  </div>
                  {e.description && (
                    <div className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">
                      {e.description}
                    </div>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 最近のアップデート */}
      {filteredRecent.length > 0 && (
        <div>
          <div className="text-xs text-[var(--text-secondary)] font-medium mb-2">📰 最近のアップデート</div>
          <div className="flex flex-col gap-1.5">
            {filteredRecent.map(e => (
              <a
                key={e.id}
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors group"
              >
                <span className="text-base leading-none mt-0.5 shrink-0">{SOURCE_ICON[e.source]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs border rounded px-1 py-0.5 ${IMPORTANCE_STYLE[e.importance]}`}>
                      {e.importance === 'critical' ? '重大' : e.importance === 'major' ? '主要' : 'Minor'}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] shrink-0">
                      {new Date(e.publishedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-[var(--text-primary)] mt-0.5 truncate group-hover:text-blue-600 transition-colors">
                    {e.title}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {events.length > 0 && filteredRecent.length === 0 && upcoming.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] text-center py-2">
          表示可能な更新がありません（マイナー更新のみ）
        </div>
      )}
    </div>
  );
}
