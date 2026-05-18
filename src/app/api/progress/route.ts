import { NextResponse } from 'next/server';
import { getProgress } from '@/lib/data';

export async function GET() {
  return NextResponse.json(getProgress());
}
