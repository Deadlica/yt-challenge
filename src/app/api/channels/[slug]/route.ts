import { NextResponse } from 'next/server';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { getProgress, saveProgress } from '@/lib/data';

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(process.cwd(), 'data', slug);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  const progress = getProgress();
  delete progress[slug];
  if (progress['_lastChannel'] === slug) delete progress['_lastChannel'];
  saveProgress(progress);
  return NextResponse.json({ ok: true });
}
