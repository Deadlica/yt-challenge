import { NextResponse } from 'next/server';
import { getApiKey } from '@/lib/data';
import https from 'https';

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

export async function POST(req: Request) {
  const { query, apiKey: clientKey } = await req.json();
  const apiKey = clientKey || getApiKey();
  if (!apiKey || apiKey === 'your_key_here') return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' });

  const handle = query.startsWith('@') ? query.slice(1) : query;
  const handleRes = await httpGet(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
  );
  if (handleRes.error) return NextResponse.json({ error: handleRes.error.message || 'API error' });
  if (handleRes.items?.length) {
    return NextResponse.json(handleRes.items.map((item: any) => ({
      id: item.id,
      name: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
      videoCount: item.statistics.videoCount,
    })));
  }

  const search = await httpGet(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=5&key=${apiKey}`
  );
  if (search.error) return NextResponse.json({ error: search.error.message || 'API error' });
  if (!search.items?.length) return NextResponse.json([]);

  const ids = search.items.map((i: any) => i.snippet.channelId).join(',');
  const details = await httpGet(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids}&key=${apiKey}`
  );
  return NextResponse.json((details.items || []).map((item: any) => ({
    id: item.id,
    name: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.default?.url || '',
    videoCount: item.statistics.videoCount,
  })));
}
