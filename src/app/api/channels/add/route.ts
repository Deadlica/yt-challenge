import { NextResponse } from 'next/server';
import { getApiKey, getDataDir } from '@/lib/data';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function resolveChannelId(input: string, apiKey: string): Promise<string> {
  if (input.startsWith('UC') && input.length === 24) return input;
  const handle = input.startsWith('@') ? input.slice(1) : input;
  const res = await httpGet(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
  );
  if (res.items?.length) return res.items[0].id;
  const search = await httpGet(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(input)}&maxResults=1&key=${apiKey}`
  );
  if (search.items?.length) return search.items[0].snippet.channelId;
  throw new Error(`Could not resolve channel: ${input}`);
}

async function fetchViaSearch(channelId: string, apiKey: string) {
  const startYear = 2018;
  const now = new Date();
  const windows: { after: string; before: string }[] = [];
  for (let y = startYear; y <= now.getFullYear(); y++) {
    for (let m = 0; m < 12; m += 6) {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 6, 1);
      if (from > now) break;
      windows.push({ after: from.toISOString(), before: (to > now ? now : to).toISOString() });
    }
  }
  const videos: any[] = [];
  for (const w of windows) {
    let pageToken = '';
    do {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=50&publishedAfter=${w.after}&publishedBefore=${w.before}&key=${apiKey}`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const page = await httpGet(url);
      if (page.error || !page.items) break;
      for (const item of page.items) {
        videos.push({ id: item.id.videoId, title: item.snippet.title, published: item.snippet.publishedAt });
      }
      pageToken = page.nextPageToken || '';
      await sleep(100);
    } while (pageToken);
  }
  return videos;
}

async function fetchViaPlaylist(channelId: string, apiKey: string) {
  const uploadsId = 'UU' + channelId.slice(2);
  const videos: any[] = [];
  let pageToken = '';
  do {
    let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsId}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const page = await httpGet(url);
    if (page.error || !page.items) break;
    for (const item of page.items) {
      videos.push({ id: item.snippet.resourceId.videoId, title: item.snippet.title, published: item.snippet.publishedAt });
    }
    pageToken = page.nextPageToken || '';
    await sleep(100);
  } while (pageToken);
  return videos;
}

async function fetchDurations(videoIds: string[], apiKey: string): Promise<Map<string, number>> {
  const durations = new Map<string, number>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.join(',')}&key=${apiKey}`;
    const res = await httpGet(url);
    if (res.items) {
      for (const item of res.items) {
        const m = item.contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (m) durations.set(item.id, (parseInt(m[1]||'0')*3600)+(parseInt(m[2]||'0')*60)+parseInt(m[3]||'0'));
      }
    }
    await sleep(100);
  }
  return durations;
}

export async function POST(req: Request) {
  const { channel, slug: slugInput, apiKey: clientKey } = await req.json();
  const apiKey = clientKey || getApiKey();
  if (!apiKey || apiKey === 'your_key_here') {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' });
  }

  try {
    const channelId = await resolveChannelId(channel, apiKey);
    const chInfo = await httpGet(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`
    );
    if (!chInfo.items?.length) return NextResponse.json({ error: 'Channel not found' });

    const channelName = chInfo.items[0].snippet.title;
    const handle = (chInfo.items[0].snippet.customUrl || '').replace(/^@/, '').toLowerCase();
    const slug = slugInput || handle || channelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || channelId.slice(2, 10).toLowerCase();

    // Check for slug conflict (different channel using same slug)
    const metaPath = join(getDataDir(), slug, 'meta.json');
    if (existsSync(metaPath)) {
      const existing = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (existing.channelId && existing.channelId !== channelId) {
        return NextResponse.json({ error: `Folder "${slug}" already used by "${existing.name}". Choose a different folder name.` });
      }
    }

    const [searchVids, playlistVids] = await Promise.all([
      fetchViaSearch(channelId, apiKey),
      fetchViaPlaylist(channelId, apiKey),
    ]);

    const map = new Map<string, any>();
    for (const v of [...searchVids, ...playlistVids]) {
      if (!map.has(v.id)) map.set(v.id, v);
    }
    const videos = [...map.values()];
    videos.sort((a, b) => a.published.localeCompare(b.published));

    const durations = await fetchDurations(videos.map(v => v.id), apiKey);
    const output = videos.map(v => ({ id: v.id, title: v.title, duration: durations.get(v.id) || 0 }));

    const outDir = join(getDataDir(), slug);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'videos.json'), JSON.stringify(output, null, 2));
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ name: channelName, channelId }));

    return NextResponse.json({ status: 'done', slug, videoCount: output.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}
