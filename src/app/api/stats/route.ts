import { NextResponse } from 'next/server';
import { getChannelSlugs, getChannelMeta, loadHistory, loadVideos } from '@/lib/data';

export async function GET() {
  const slugs = getChannelSlugs();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const channelStats = slugs.map(slug => {
    const history = loadHistory(slug);
    const videos = loadVideos(slug);
    const durationMap = new Map(videos.map(v => [v.id, v.duration || 0]));
    const meta = getChannelMeta(slug);

    // Daily breakdown (last 30 days)
    const daily: Record<string, number> = {};
    let totalSeconds = 0;
    let todaySeconds = 0;

    for (const h of history) {
      const day = h.watchedAt.slice(0, 10);
      const dur = durationMap.get(h.videoId) || 0;
      daily[day] = (daily[day] || 0) + dur;
      totalSeconds += dur;
      if (day === todayStr) todaySeconds += dur;
    }

    return { slug, name: meta.name, totalSeconds, todaySeconds, daily, watchedCount: history.length };
  });

  // Aggregate daily across all channels (all time)
  const allDays = new Set<string>();
  for (const ch of channelStats) {
    for (const day of Object.keys(ch.daily)) allDays.add(day);
  }
  const dailyTotal: Record<string, number> = {};
  for (const day of [...allDays].sort()) {
    dailyTotal[day] = 0;
    for (const ch of channelStats) {
      dailyTotal[day] += ch.daily[day] || 0;
    }
  }

  const totalSeconds = channelStats.reduce((s, c) => s + c.totalSeconds, 0);
  const todaySeconds = channelStats.reduce((s, c) => s + c.todaySeconds, 0);

  return NextResponse.json({
    totalSeconds,
    todaySeconds,
    dailyTotal,
    channels: channelStats.map(c => ({ slug: c.slug, name: c.name, totalSeconds: c.totalSeconds, todaySeconds: c.todaySeconds, watchedCount: c.watchedCount, daily: c.daily })),
  });
}
