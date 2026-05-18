import { NextResponse } from 'next/server';
import { loadVideos } from '@/lib/data';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return NextResponse.json(loadVideos(slug));
}
