import { Controller, Get, Post, Param, Body, Sse } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import * as https from 'https';
import { Observable, Subject } from 'rxjs';

interface Video {
  id: string;
  title: string;
  duration?: number; // seconds
}

interface ChannelMeta {
  slug: string;
  name: string;
  videoCount: number;
  watchedCount: number;
  watchedSeconds: number;
}

interface Progress {
  [channelSlug: string]: any;
}

const DATA_DIR = join(__dirname, '..', 'data');
const PROGRESS_FILE = join(DATA_DIR, 'progress.json');

function getApiKey(): string {
  const envPath = join(__dirname, '..', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && match[1].trim() === 'YOUTUBE_API_KEY') return match[2].trim();
    }
  }
  return process.env.YOUTUBE_API_KEY || '';
}

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

@Controller('api')
export class VideosController {
  private fetchJobs = new Map<string, Subject<MessageEvent>>();

  // --- Static routes FIRST (before any :slug params) ---

  @Get('channels')
  getChannels(): ChannelMeta[] {
    return readdirSync(DATA_DIR).filter((f) => {
      return existsSync(join(DATA_DIR, f, 'videos.json'));
    }).map((slug) => {
      const videos = this.loadVideos(slug);
      const metaPath = join(DATA_DIR, slug, 'meta.json');
      const name = existsSync(metaPath)
        ? JSON.parse(readFileSync(metaPath, 'utf-8')).name
        : slug;
      const history = this.loadHistory(slug);
      const watchedIds = new Set(history.map(h => h.videoId));
      const watchedSeconds = videos
        .filter(v => watchedIds.has(v.id))
        .reduce((sum, v) => sum + (v.duration || 0), 0);
      return { slug, name, videoCount: videos.length, watchedCount: history.length, watchedSeconds };
    });
  }

  @Post('channels/search')
  async searchChannels(@Body() body: { query: string; apiKey?: string }): Promise<any> {
    const apiKey = body.apiKey || getApiKey();
    if (!apiKey || apiKey === 'your_key_here') return { error: 'YOUTUBE_API_KEY not set in .env' };

    const handle = body.query.startsWith('@') ? body.query.slice(1) : body.query;
    const handleRes = await httpGet(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`
    );
    if (handleRes.error) return { error: handleRes.error.message || 'API error' };
    if (handleRes.items?.length) {
      return handleRes.items.map((item: any) => ({
        id: item.id,
        name: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.default?.url || '',
        videoCount: item.statistics.videoCount,
      }));
    }

    const search = await httpGet(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(body.query)}&maxResults=5&key=${apiKey}`
    );
    if (search.error) return { error: search.error.message || 'API error' };
    if (!search.items?.length) return [];

    const ids = search.items.map((i: any) => i.snippet.channelId).join(',');
    const details = await httpGet(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids}&key=${apiKey}`
    );
    return (details.items || []).map((item: any) => ({
      id: item.id,
      name: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
      videoCount: item.statistics.videoCount,
    }));
  }

  @Post('channels/add')
  addChannel(@Body() body: { channel: string; slug?: string; apiKey?: string }): { jobId: string } {
    const jobId = Date.now().toString(36);
    const subject = new Subject<MessageEvent>();
    this.fetchJobs.set(jobId, subject);
    this.runFetch(body.channel, body.slug, subject, body.apiKey);
    return { jobId };
  }

  @Sse('channels/add/:jobId/progress')
  streamProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
    const subject = this.fetchJobs.get(jobId);
    if (!subject) {
      const done = new Subject<MessageEvent>();
      done.next({ data: JSON.stringify({ error: 'Job not found' }) } as any);
      done.complete();
      return done.asObservable();
    }
    return subject.asObservable();
  }

  @Get('progress')
  getProgress(): Progress {
    if (!existsSync(PROGRESS_FILE)) return {};
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  }

  @Post('progress/:slug')
  setProgress(@Param('slug') slug: string, @Body() body: { videoId: string; time?: number }): { ok: true } {
    const progress = this.getProgress();
    progress[slug] = { videoId: body.videoId, time: body.time || 0 };
    progress['_lastChannel'] = slug;
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    this.addToHistory(slug, body.videoId);
    return { ok: true };
  }

  // --- Parameterized routes AFTER ---

  @Get('channels/:slug/videos')
  getVideos(@Param('slug') slug: string): Video[] {
    return this.loadVideos(slug);
  }

  @Get('channels/:slug/history')
  getHistory(@Param('slug') slug: string): { videoId: string; title: string; watchedAt: string; duration: number }[] {
    const history = this.loadHistory(slug);
    const videos = this.loadVideos(slug);
    const videoMap = new Map(videos.map(v => [v.id, v]));
    return history.map(h => ({
      videoId: h.videoId,
      title: videoMap.get(h.videoId)?.title || h.videoId,
      watchedAt: h.watchedAt,
      duration: videoMap.get(h.videoId)?.duration || 0,
    }));
  }

  @Post('channels/:slug/history/delete')
  deleteHistoryEntry(@Param('slug') slug: string, @Body() body: { videoId: string }): { ok: true } {
    const history = this.loadHistory(slug);
    const filtered = history.filter(h => h.videoId !== body.videoId);
    const p = join(DATA_DIR, slug, 'history.json');
    writeFileSync(p, JSON.stringify(filtered, null, 2));
    return { ok: true };
  }

  @Post('channels/:slug/history/clear')
  clearHistory(@Param('slug') slug: string): { ok: true } {
    const p = join(DATA_DIR, slug, 'history.json');
    writeFileSync(p, '[]');
    return { ok: true };
  }

  // --- Private methods ---

  private async runFetch(channelInput: string, slugInput: string | undefined, subject: Subject<MessageEvent>, clientApiKey?: string) {
    try {
      const apiKey = clientApiKey || getApiKey();
      if (!apiKey || apiKey === 'your_key_here') {
        subject.next({ data: JSON.stringify({ error: 'YOUTUBE_API_KEY not set in .env' }) } as any);
        subject.complete();
        return;
      }

      subject.next({ data: JSON.stringify({ status: 'Resolving channel...' }) } as any);
      const channelId = await this.resolveChannelId(channelInput, apiKey);

      const chInfo = await httpGet(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`
      );
      if (!chInfo.items?.length) {
        subject.next({ data: JSON.stringify({ error: 'Channel not found' }) } as any);
        subject.complete();
        return;
      }

      const channelName = chInfo.items[0].snippet.title;
      const totalVideos = parseInt(chInfo.items[0].statistics.videoCount, 10);
      const slug = slugInput || channelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '') || 'channel';

      subject.next({ data: JSON.stringify({ status: `Found: ${channelName} (${totalVideos} videos). Fetching...`, slug }) } as any);

      const searchVids = await this.fetchViaSearch(channelId, apiKey, (count) => {
        subject.next({ data: JSON.stringify({ status: `Fetching... ${count} videos found`, slug }) } as any);
      });

      const playlistVids = await this.fetchViaPlaylist(channelId, apiKey);
      subject.next({ data: JSON.stringify({ status: `Merging ${searchVids.length} + ${playlistVids.length} videos...`, slug }) } as any);

      const map = new Map<string, any>();
      for (const v of [...searchVids, ...playlistVids]) {
        if (!map.has(v.id)) map.set(v.id, v);
      }
      const videos = [...map.values()];
      videos.sort((a, b) => a.published.localeCompare(b.published));

      subject.next({ data: JSON.stringify({ status: `Fetching durations for ${videos.length} videos...`, slug }) } as any);
      const durations = await this.fetchDurations(videos.map(v => v.id), apiKey);

      const output = videos.map(v => ({ id: v.id, title: v.title, duration: durations.get(v.id) || 0 }));

      const outDir = join(DATA_DIR, slug);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'videos.json'), JSON.stringify(output, null, 2));
      writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ name: channelName }));

      subject.next({ data: JSON.stringify({ status: `Done! ${output.length} videos saved.`, slug, done: true }) } as any);
    } catch (e: any) {
      subject.next({ data: JSON.stringify({ error: e.message }) } as any);
    }
    subject.complete();
  }

  private async resolveChannelId(input: string, apiKey: string): Promise<string> {
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

  private async fetchViaSearch(channelId: string, apiKey: string, onProgress: (n: number) => void) {
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
      onProgress(videos.length);
    }
    return videos;
  }

  private async fetchViaPlaylist(channelId: string, apiKey: string) {
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

  private async fetchDurations(videoIds: string[], apiKey: string): Promise<Map<string, number>> {
    const durations = new Map<string, number>();
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch.join(',')}&key=${apiKey}`;
      const res = await httpGet(url);
      if (res.items) {
        for (const item of res.items) {
          durations.set(item.id, this.parseDuration(item.contentDetails.duration));
        }
      }
      await sleep(100);
    }
    return durations;
  }

  private parseDuration(iso: string): number {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
  }

  private loadVideos(slug: string): Video[] {
    const p = join(DATA_DIR, slug, 'videos.json');
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, 'utf-8'));
  }

  private loadHistory(slug: string): { videoId: string; watchedAt: string }[] {
    const p = join(DATA_DIR, slug, 'history.json');
    if (!existsSync(p)) return [];
    return JSON.parse(readFileSync(p, 'utf-8'));
  }

  private addToHistory(slug: string, videoId: string) {
    const history = this.loadHistory(slug);
    if (history.some(h => h.videoId === videoId)) return;
    history.push({ videoId, watchedAt: new Date().toISOString() });
    const p = join(DATA_DIR, slug, 'history.json');
    writeFileSync(p, JSON.stringify(history, null, 2));
  }
}
