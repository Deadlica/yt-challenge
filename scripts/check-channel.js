// Usage: node scripts/check-channel.js <CHANNEL_NAME_OR_HANDLE_OR_ID>
// Reads YOUTUBE_API_KEY from .env

const https = require('https');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const apiKey = process.env.YOUTUBE_API_KEY;
const channelArg = process.argv[2];

if (!channelArg || !apiKey) {
  console.error('Usage: node scripts/check-channel.js <CHANNEL_NAME_OR_HANDLE_OR_ID>');
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

async function main() {
  let items;

  if (channelArg.startsWith('UC') && channelArg.length === 24) {
    const res = await get(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelArg}&key=${apiKey}`);
    items = res.items;
  } else {
    const handle = channelArg.startsWith('@') ? channelArg.slice(1) : channelArg;
    const res = await get(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`);
    items = res.items;
  }

  if (!items || !items.length) { console.log('Channel not found!'); return; }
  const item = items[0];
  console.log('Channel ID:', item.id);
  console.log('Channel name:', item.snippet.title);
  console.log('Video count:', item.statistics.videoCount);
  console.log('Uploads playlist:', item.contentDetails.relatedPlaylists.uploads);
}

main().catch(console.error);
