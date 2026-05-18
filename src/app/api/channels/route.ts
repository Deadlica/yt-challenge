import { NextResponse } from 'next/server';
import { getChannelSlugs, getChannelMeta, loadVideos, loadHistory } from '@/lib/data';

export async function GET() {
  const channels = getChannelSlugs().map(slug => {
    const videos = loadVideos(slug);
    const meta = getChannelMeta(slug);
    const history = loadHistory(slug);
    const watchedIds = new Set(history.map(h => h.videoId));
    const watchedSeconds = videos
      .filter(v => watchedIds.has(v.id))
      .reduce((sum, v) => sum + (v.duration || 0), 0);
    return { slug, name: meta.name, videoCount: videos.length, watchedCount: history.length, watchedSeconds };
  });
  return NextResponse.json(channels);
}
