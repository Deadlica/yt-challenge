import { NextResponse } from 'next/server';
import { loadHistory } from '@/lib/data';
import { writeFileSync } from 'fs';
import { join } from 'path';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { videoId } = await req.json();
  const history = loadHistory(slug);
  const filtered = history.filter(h => h.videoId !== videoId);
  const p = join(process.cwd(), 'data', slug, 'history.json');
  writeFileSync(p, JSON.stringify(filtered, null, 2));
  return NextResponse.json({ ok: true });
}
