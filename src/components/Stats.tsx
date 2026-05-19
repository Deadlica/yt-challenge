'use client';

import { useEffect, useState, useCallback } from 'react';

interface StatsData {
  totalSeconds: number;
  todaySeconds: number;
  dailyTotal: Record<string, number>;
  channels: { slug: string; name: string; totalSeconds: number; todaySeconds: number; watchedCount: number; daily: Record<string, number> }[];
}

function formatHM(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Stats({ lang, refreshKey }: { lang: string; refreshKey: number }) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<'30d' | '1y' | 'all'>('30d');

  const t = useCallback((en: string, ja: string) => lang === 'ja' ? ja : en, [lang]);

  useEffect(() => {
    if (open) {
      fetch('/api/stats').then(r => r.json()).then(setStats);
    }
  }, [open, refreshKey]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ padding: '0.5rem 1rem', border: '1px solid #444', borderRadius: '6px', background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '1rem' }}>
        📊 {t('Stats', '統計')}
      </button>
    );
  }

  if (!stats) return <div style={{ color: '#888', marginBottom: '1rem' }}>Loading...</div>;

  return (
    <div style={{ width: '100%', maxWidth: '800px', marginBottom: '1.5rem', background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.2rem' }}>📊 {t('Stats', '統計')}</h2>
        <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#888', fontSize: '0.8rem' }}>{t('Today', '今日')}</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{formatHM(stats.todaySeconds)}</div>
        </div>
        <div>
          <div style={{ color: '#888', fontSize: '0.8rem' }}>{t('All time', '合計')}</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{formatHM(stats.totalSeconds)}</div>
        </div>
      </div>

      {/* Per channel */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{t('Per channel', 'チャンネル別')}</div>
        {stats.channels.map(ch => (
          <div key={ch.slug} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid #222' }}>
            <span>{ch.name}</span>
            <span style={{ color: '#888' }}>
              {t('Today', '今日')}: {formatHM(ch.todaySeconds)} · {t('Total', '合計')}: {formatHM(ch.totalSeconds)} · {ch.watchedCount} {t('videos', '本')}
            </span>
          </div>
        ))}
      </div>

      {/* Graph */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ color: '#888', fontSize: '0.8rem' }}>{t('Watch time', '視聴時間')}</span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {(['30d', '1y', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', borderRadius: '3px', border: 'none', background: range === r ? '#1a7f37' : '#333', color: '#fff', cursor: 'pointer' }}>
                {r === '30d' ? t('30 days', '30日') : r === '1y' ? t('1 year', '1年') : t('All', '全期間')}
              </button>
            ))}
          </div>
        </div>
        {(() => {
          const now = new Date();
          const cutoff = range === '30d' ? new Date(now.getTime() - 30*86400000)
            : range === '1y' ? new Date(now.getTime() - 365*86400000)
            : null;
          const allDays = Object.keys(stats.dailyTotal).sort();
          const startDate = cutoff || (allDays.length ? new Date(allDays[0]) : now);

          // Build daily data
          const days: string[] = [];
          const d = new Date(startDate);
          while (d <= now) {
            days.push(d.toISOString().slice(0, 10));
            d.setDate(d.getDate() + 1);
          }

          // Aggregate into buckets
          let buckets: { label: string; value: number }[] = [];
          if (range === '30d') {
            buckets = days.map(day => ({ label: day, value: stats.dailyTotal[day] || 0 }));
          } else if (range === '1y') {
            // Weekly
            for (let i = 0; i < days.length; i += 7) {
              const week = days.slice(i, i + 7);
              const sum = week.reduce((s, day) => s + (stats.dailyTotal[day] || 0), 0);
              buckets.push({ label: `${week[0]} ~ ${week[week.length-1]}`, value: sum });
            }
          } else {
            // Monthly
            const monthly: Record<string, number> = {};
            for (const day of days) {
              const month = day.slice(0, 7);
              monthly[month] = (monthly[month] || 0) + (stats.dailyTotal[day] || 0);
            }
            buckets = Object.entries(monthly).map(([m, v]) => ({ label: m, value: v }));
          }

          const vals = buckets.map(b => b.value);
          const maxV = Math.max(...vals, 1);
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '100px' }}>
                {buckets.map((b, i) => {
                  const h = vals[i] > 0 ? Math.max(4, (vals[i] / maxV) * 100) : 0;
                  return <div key={i} title={`${b.label}: ${formatHM(vals[i])}`} style={{ flex: 1, height: `${h}px`, background: vals[i] > 0 ? '#1a7f37' : '#222', borderRadius: '2px 2px 0 0', cursor: 'pointer', minWidth: '2px' }} />;
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#666', marginTop: '0.3rem' }}>
                <span>{buckets[0]?.label.slice(0, 7)}</span>
                <span>{buckets[buckets.length - 1]?.label.slice(0, 7)}</span>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
