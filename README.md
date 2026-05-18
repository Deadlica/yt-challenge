# YouTube Challenge

Watch every video from a YouTube channel in chronological order. Supports multiple channels, server-side progress tracking, watch history, and EN/JP localization.

## Setup

```bash
npm install
echo "YOUTUBE_API_KEY=your_key_here" >> .env
```

Set `YOUTUBE_API_KEY` in `.env` or provide it via the UI.

## Run

```bash
npm run start:dev
```

Open http://localhost:3000. Channels can be added directly from the UI (search by name, @handle, or channel ID).

## CLI usage

```bash
node scripts/fetch-videos.js <name|@handle|ID> [folder-name]
```

Reads `YOUTUBE_API_KEY` from `.env`. Example:

```bash
node scripts/fetch-videos.js @ComDot komdot
```

## Docker

```bash
echo "DOCKER_IMAGE=yourdockerhubuser/yt-challenge" >> .env
npm run deploy
```

Builds and pushes the image with `latest` + a date tag.

Run on a server:

```bash
docker run -d -p 3000:3000 -v /path/to/data:/app/data -e YOUTUBE_API_KEY=your_key yourdockerhubuser/yt-challenge:latest
```

Data (videos, progress, history) persists in the mounted volume.
