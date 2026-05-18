import { NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { join } from 'path';

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = join(process.cwd(), 'data', slug, 'history.json');
  writeFileSync(p, '[]');
  return NextResponse.json({ ok: true });
}
