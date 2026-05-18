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
  if (input.startsWith('UC') && input.length === 24) return input;
  const handle = input.startsWith('@') ? input.slice(1) : input;
  const res = await get(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
  );
  if (res.items && res.items.length) return res.items[0].id;
  const search = await get(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(input)}&maxResults=1&key=${apiKey}`
  );
  if (search.items && search.items.length) return search.items[0].snippet.channelId;
  throw new Error(`Could not resolve channel: ${input}`);
}

async function main() {
  const channelId = await resolveChannelId(channelArg);
  console.log(`Resolved channel ID: ${channelId}`);

  const channelInfo = await get(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`
  );
  const channelName = channelInfo.items[0].snippet.title;
  const slug = slugArg || channelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '') || 'channel';
  console.log(`Channel: ${channelName} (${channelInfo.items[0].statistics.videoCount} videos) → slug: "${slug}"`);

  // Fetch via search (date-windowed)
  const startYear = 2018;
  const now = new Date();
  const windows = [];
  for (let y = startYear; y <= now.getFullYear(); y++) {
    for (let m = 0; m < 12; m += 6) {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 6, 1);
      if (from > now) break;
      windows.push({ after: from.toISOString(), before: (to > now ? now : to).toISOString() });
    }
  }

  const searchVids = [];
  for (const w of windows) {
    let pageToken = '';
    do {
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=50&publishedAfter=${w.after}&publishedBefore=${w.before}&key=${apiKey}`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const page = await get(url);
      if (page.error || !page.items) break;
      for (const item of page.items) {
        searchVids.push({ id: item.id.videoId, title: item.snippet.title, published: item.snippet.publishedAt });
      }
      pageToken = page.nextPageToken || '';
      await sleep(100);
    } while (pageToken);
    console.log(`[search] ${w.after.slice(0,7)} → ${w.before.slice(0,7)}: ${searchVids.length} videos`);
  }

  // Fetch via playlist
  const uploadsId = 'UU' + channelId.slice(2);
  const playlistVids = [];
  let pageToken = '';
  do {
    let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsId}&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const page = await get(url);
    if (page.error || !page.items) break;
    for (const item of page.items) {
      playlistVids.push({ id: item.snippet.resourceId.videoId, title: item.snippet.title, published: item.snippet.publishedAt });
    }
    pageToken = page.nextPageToken || '';
    await sleep(100);
  } while (pageToken);
  console.log(`[playlist] ${playlistVids.length} videos`);

  // Deduplicate and sort
  const map = new Map();
  for (const v of [...searchVids, ...playlistVids]) {
    if (!map.has(v.id)) map.set(v.id, v);
  }
  const videos = [...map.values()];
  videos.sort((a, b) => a.published.localeCompare(b.published));

  // Fetch durations
  console.log(`Fetching durations for ${videos.length} videos...`);
  const durations = new Map();
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.map(v => v.id).join(',')}&key=${apiKey}`;
    const res = await get(url);
    if (res.items) {
      for (const item of res.items) {
        const m = item.contentDetails.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (m) durations.set(item.id, (parseInt(m[1]||'0')*3600)+(parseInt(m[2]||'0')*60)+parseInt(m[3]||'0'));
      }
    }
    await sleep(100);
  }

  const output = videos.map(v => ({ id: v.id, title: v.title, duration: durations.get(v.id) || 0 }));

  const outDir = path.join(__dirname, '..', 'data', slug);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'videos.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ name: channelName }));
  console.log(`Done. ${output.length} unique videos written to data/${slug}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
