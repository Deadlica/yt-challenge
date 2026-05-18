import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const PROGRESS_FILE = join(DATA_DIR, 'progress.json');

export interface Video {
  id: string;
  title: string;
  duration?: number;
}

export function loadVideos(slug: string): Video[] {
  const p = join(DATA_DIR, slug, 'videos.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function loadHistory(slug: string): { videoId: string; watchedAt: string }[] {
  const p = join(DATA_DIR, slug, 'history.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function addToHistory(slug: string, videoId: string) {
  const history = loadHistory(slug);
  if (history.some(h => h.videoId === videoId)) return;
  history.push({ videoId, watchedAt: new Date().toISOString() });
  const dir = join(DATA_DIR, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'history.json'), JSON.stringify(history, null, 2));
}

export function getChannelSlugs(): string[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR).filter(f => existsSync(join(DATA_DIR, f, 'videos.json')));
}

export function getChannelMeta(slug: string) {
  const metaPath = join(DATA_DIR, slug, 'meta.json');
  if (existsSync(metaPath)) return JSON.parse(readFileSync(metaPath, 'utf-8'));
  return { name: slug };
}

export function getProgress(): Record<string, any> {
  if (!existsSync(PROGRESS_FILE)) return {};
  return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
}

export function saveProgress(data: Record<string, any>) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

export function getApiKey(): string {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && match[1].trim() === 'YOUTUBE_API_KEY') return match[2].trim();
    }
  }
  return process.env.YOUTUBE_API_KEY || '';
}

export function getDataDir() { return DATA_DIR; }
