// Fetches all uploads from a YouTube channel (oldest first) by combining
// search (date-windowed) + playlistItems, then deduplicating.
// Usage: node scripts/fetch-videos.js <CHANNEL_NAME_OR_ID> [slug]
// Reads YOUTUBE_API_KEY from .env

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const apiKey = process.env.YOUTUBE_API_KEY;
const [channelArg, slugArg] = process.argv.slice(2);

if (!channelArg || !apiKey || apiKey === 'your_key_here') {
  console.error('Usage: node scripts/fetch-videos.js <CHANNEL_NAME_OR_HANDLE_OR_ID> [slug]');
  console.error('Set YOUTUBE_API_KEY in .env');
  process.exit(1);
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resolveChannelId(input) {
  // Already a channel ID (starts with UC)
  if (input.startsWith('UC') && input.length === 24) return input;

  // Try as handle (with or without @)
  const handle = input.startsWith('@') ? input : `@${input}`;
  const res = await get(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(handle.slice(1))}&key=${apiKey}`
  );
  if (res.items && res.items.length) return res.items[0].id;

  // Try as search query
  const search = await get(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(input)}&maxResults=1&key=${apiKey}`
  );
  if (search.items && search.items.length) return search.items[0].snippet.channelId;

  throw new Error(`Could not resolve channel: ${input}`);
}

async function getChannelInfo(channelId) {
  const ch = await get(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${channelId}&key=${apiKey}`
  );
  if (!ch.items || !ch.items.length) throw new Error('Channel not found');
  return ch.items[0];
}

async function fetchViaSearch(channelId) {
  const startYear = 2018;
  const now = new Date();
  const windows = [];
  for (let y = startYear; y <= now.getFullYear(); y++) {
    for (let m = 0; m < 12; m += 6) {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 6, 1);
      if (from > now) break;
      windows.push({
        after: from.toISOString(),
        before: (to > now ? now : to).toISOString(),
      });
    }
  }

  const videos = [];
  for (const w of windows) {
    let pageToken = '';
    do {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=50&publishedAfter=${w.after}&publishedBefore=${w.before}&key=${apiKey}`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const page = await get(url);
      if (page.error || !page.items) break;
      for (const item of page.items) {
        videos.push({
          id: item.id.videoId,
          title: item.snippet.title,
          published: item.snippet.publishedAt,
        });
      }
      pageToken = page.nextPageToken || '';
      await sleep(100);
    } while (pageToken);
    console.log(`[search] ${w.after.slice(0,7)} → ${w.before.slice(0,7)}: ${videos.length} videos`);
  }
  return videos;
}

async function fetchViaPlaylist(channelId) {
  const uploadsId = 'UU' + channelId.slice(2);
  const videos = [];
  let pageToken = '';
  do {
    let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsId}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const page = await get(url);
    if (page.error || !page.items) break;
    for (const item of page.items) {
      videos.push({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        published: item.snippet.publishedAt,
      });
    }
    pageToken = page.nextPageToken || '';
    await sleep(100);
  } while (pageToken);
  console.log(`[playlist] ${videos.length} videos`);
  return videos;
}

async function main() {
  const channelId = await resolveChannelId(channelArg);
  console.log(`Resolved channel ID: ${channelId}`);

  const channelInfo = await getChannelInfo(channelId);
  const channelName = channelInfo.snippet.title;
  const slug = slugArg || channelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '') || 'channel';

  console.log(`Channel: ${channelName} (${channelInfo.statistics.videoCount} videos) → slug: "${slug}"`);

  const [searchVids, playlistVids] = await Promise.all([
    fetchViaSearch(channelId),
    fetchViaPlaylist(channelId),
  ]);

  const map = new Map();
  for (const v of [...searchVids, ...playlistVids]) {
    if (!map.has(v.id)) map.set(v.id, v);
  }

  const videos = [...map.values()];
  videos.sort((a, b) => a.published.localeCompare(b.published));

  const output = videos.map(v => ({ id: v.id, title: v.title }));

  const outDir = path.join(__dirname, '..', 'data', slug);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'videos.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ name: channelName }));
  console.log(`Done. ${output.length} unique videos written to data/${slug}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
