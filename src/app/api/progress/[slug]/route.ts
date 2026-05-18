import { NextResponse } from 'next/server';
import { getProgress, saveProgress, addToHistory } from '@/lib/data';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { videoId, time } = await req.json();
  const progress = getProgress();
  progress[slug] = { videoId, time: time || 0 };
  progress['_lastChannel'] = slug;
  saveProgress(progress);
  if (videoId) addToHistory(slug, videoId);
  return NextResponse.json({ ok: true });
}
