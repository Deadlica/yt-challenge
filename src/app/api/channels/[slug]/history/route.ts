import { NextResponse } from 'next/server';
import { loadHistory, loadVideos } from '@/lib/data';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const history = loadHistory(slug);
  const videos = loadVideos(slug);
  const videoMap = new Map(videos.map(v => [v.id, v]));
  return NextResponse.json(history.map(h => ({
    videoId: h.videoId,
    title: videoMap.get(h.videoId)?.title || h.videoId,
    watchedAt: h.watchedAt,
    duration: videoMap.get(h.videoId)?.duration || 0,
  })));
}
