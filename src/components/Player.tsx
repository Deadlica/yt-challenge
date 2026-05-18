'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const i18n = {
  en: {
    title: 'YouTube Challenge', channel: 'Channel', channelPh: 'name, @handle, or ID',
    folderName: 'Folder name', optional: 'optional', apiKey: 'API Key', search: '🔍 Search',
    prev: '← Prev', done: 'Done → Next', next: 'Next →', autoplay: 'Autoplay next', go: 'Go',
    history: '📜 History', clearAll: '🗑 Clear All', titleCol: 'Title', length: 'Length', date: 'Date',
    confirmClear: 'Delete ALL watch history for this channel?', noChannels: 'No channels found.',
    searching: 'Searching...', starting: 'Starting...', connLost: 'Connection lost.', videos: 'videos',
    confirmDelete: 'Delete "{name}" and all its data?', fetchDone: 'Done! {count} videos saved.',
  },
  ja: {
    title: 'YouTubeチャレンジ', channel: 'チャンネル', channelPh: '名前、@ハンドル、またはID',
    folderName: 'フォルダ名', optional: '任意', apiKey: 'APIキー', search: '🔍 検索',
    prev: '← 前へ', done: '完了 → 次へ', next: '次へ →', autoplay: '自動再生', go: '移動',
    history: '📜 履歴', clearAll: '🗑 全削除', titleCol: 'タイトル', length: '長さ', date: '日付',
    confirmClear: 'このチャンネルの視聴履歴を全て削除しますか？', noChannels: 'チャンネルが見つかりません。',
    searching: '検索中...', starting: '開始中...', connLost: '接続が切れました。', videos: '本',
    confirmDelete: '「{name}」とそのデータを全て削除しますか？', fetchDone: '完了！{count}本の動画を保存しました。',
  }
} as const;

type Lang = keyof typeof i18n;

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void; }
}

export default function Player() {
  const [lang, setLang] = useState<Lang>('ja');
  const [channels, setChannels] = useState<any[]>([]);
  const [currentSlug, setCurrentSlug] = useState('');
  const [videos, setVideos] = useState<any[]>([]);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState<any>({});
  const [autoplay, setAutoplay] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]|null>(null);
  const [fetchStatus, setFetchStatus] = useState('');
  const [query, setQuery] = useState('');
  const [slug, setSlug] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  const playerRef = useRef<any>(null);
  const ytReady = useRef(false);
  const savedTime = useRef(0);
  const currentRef = useRef(0);
  const videosRef = useRef<any[]>([]);
  const slugRef = useRef('');

  const t = useCallback((key: string) => (i18n[lang] as any)[key] || key, [lang]);

  // Keep refs in sync
  useEffect(() => { currentRef.current = current; }, [current]);
  useEffect(() => { videosRef.current = videos; }, [videos]);
  useEffect(() => { slugRef.current = currentSlug; }, [currentSlug]);

  // Load lang and api key from localStorage
  useEffect(() => {
    setLang((localStorage.getItem('yt-lang') as Lang) || 'ja');
    setApiKeyInput(localStorage.getItem('yt-api-key') || '');
  }, []);

  // Load YouTube IFrame API
  useEffect(() => {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => { ytReady.current = true; };
  }, []);

  // Initial data load
  useEffect(() => {
    Promise.all([
      fetch('/api/channels').then(r => r.json()),
      fetch('/api/progress').then(r => r.json()),
    ]).then(([chs, prog]) => {
      setChannels(chs);
      setProgress(prog);
      const last = prog['_lastChannel'];
      const defaultSlug = (last && chs.find((c: any) => c.slug === last)) ? last : chs[0]?.slug;
      if (defaultSlug) selectChannel(defaultSlug, prog, chs);
    });
  }, []);

  // Auto-save every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      if (slugRef.current && playerRef.current?.getCurrentTime && playerRef.current.getCurrentTime() > 0) {
        saveProgress();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Save on tab close
  useEffect(() => {
    const handler = () => {
      if (slugRef.current && playerRef.current?.getCurrentTime && playerRef.current.getCurrentTime() > 0) {
        const time = Math.max(0, playerRef.current.getCurrentTime() - 1);
        const blob = new Blob([JSON.stringify({ videoId: videosRef.current[currentRef.current]?.id, time })], { type: 'application/json' });
        navigator.sendBeacon(`/api/progress/${slugRef.current}`, blob);
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  function createPlayer(videoId: string, startTime: number = 0) {
    if (!ytReady.current) {
      setTimeout(() => createPlayer(videoId, startTime), 200);
      return;
    }
    if (playerRef.current) {
      playerRef.current.loadVideoById({ videoId, startSeconds: startTime });
      return;
    }
    playerRef.current = new window.YT.Player('yt-player', {
      width: '100%', height: '100%', videoId,
      playerVars: { autoplay: 1, start: Math.floor(startTime) },
      events: {
        onStateChange: (e: any) => { if (e.data === 0 && autoplay) advance(1); },
        onReady: () => { if (startTime) playerRef.current.seekTo(startTime, true); },
      },
    });
  }

  async function selectChannel(s: string, prog?: any, chs?: any) {
    // Save current channel's progress before switching
    if (slugRef.current && playerRef.current?.getCurrentTime && playerRef.current.getCurrentTime() > 0) {
      await saveProgress();
    }
    const p = prog || await fetch('/api/progress').then(r => r.json());
    setProgress(p);
    const vids = await fetch(`/api/channels/${s}/videos`).then(r => r.json());
    const saved = p[s];
    const savedId = saved?.videoId || saved;
    savedTime.current = saved?.time || 0;
    let idx = savedId ? vids.findIndex((v: any) => v.id === savedId) : 0;
    if (idx < 0) idx = 0;
    setCurrentSlug(s);
    setVideos(vids);
    setCurrent(idx);
    slugRef.current = s;
    videosRef.current = vids;
    currentRef.current = idx;
    createPlayer(vids[idx]?.id, savedTime.current);
  }

  async function saveProgress() {
    const time = playerRef.current?.getCurrentTime?.() || 0;
    const videoId = videosRef.current[currentRef.current]?.id;
    if (!videoId || !slugRef.current) return;
    await fetch(`/api/progress/${slugRef.current}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, time }),
    });
    const chs = await fetch('/api/channels').then(r => r.json());
    setChannels(chs);
  }

  function advance(dir: number) {
    const next = currentRef.current + dir;
    if (next < 0 || next >= videosRef.current.length) return;
    setCurrent(next);
    currentRef.current = next;
    savedTime.current = 0;
    createPlayer(videosRef.current[next].id, 0);
    saveProgress();
    if (historyOpen) loadHistory();
  }

  function jump(n: number) {
    if (n < 1 || n > videos.length) return;
    setCurrent(n - 1);
    currentRef.current = n - 1;
    savedTime.current = 0;
    createPlayer(videosRef.current[n - 1].id, 0);
    saveProgress();
  }

  async function loadHistory() {
    const h = await fetch(`/api/channels/${slugRef.current}/history`).then(r => r.json());
    setHistoryData(h);
  }

  async function deleteHistoryEntry(videoId: string) {
    await fetch(`/api/channels/${slugRef.current}/history/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    loadHistory();
    const chs = await fetch('/api/channels').then(r => r.json());
    setChannels(chs);
  }

  async function clearHistory() {
    if (!confirm(t('confirmClear'))) return;
    await fetch(`/api/channels/${slugRef.current}/history/clear`, { method: 'POST' });
    loadHistory();
    const chs = await fetch('/api/channels').then(r => r.json());
    setChannels(chs);
  }

  async function deleteChannel(s: string, name: string) {
    if (!confirm(t('confirmDelete').replace('{name}', name))) return;
    await fetch(`/api/channels/${s}`, { method: 'DELETE' });
    const chs = await fetch('/api/channels').then(r => r.json());
    setChannels(chs);
    if (s === currentSlug) {
      if (chs.length) selectChannel(chs[0].slug);
      else { setCurrentSlug(''); setVideos([]); }
    } else if (currentSlug) {
      selectChannel(currentSlug);
    }
  }

  async function searchChannel() {
    if (!query) return;
    if (query.startsWith('UC') && query.length === 24) { addChannelById(query); return; }
    setFetchStatus(t('searching'));
    setSearchResults(null);
    const res = await fetch('/api/channels/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, apiKey: apiKeyInput || undefined }),
    });
    const results = await res.json();
    setFetchStatus('');
    if (results.error) { setFetchStatus(`Error: ${results.error}`); return; }
    if (!results.length) { setFetchStatus(t('noChannels')); return; }
    if (results.length === 1 && query.startsWith('@')) { addChannelById(results[0].id); return; }
    setSearchResults(results);
  }

  async function addChannelById(channelId: string) {
    setSearchResults(null);
    setFetchStatus(t('starting'));
    const res = await fetch('/api/channels/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, slug: slug || undefined, apiKey: apiKeyInput || undefined }),
    });
    const data = await res.json();
    if (data.error) { setFetchStatus(`Error: ${data.error}`); return; }
    setFetchStatus(t('fetchDone').replace('{count}', data.videoCount));
    setQuery(''); setSlug('');
    const chs = await fetch('/api/channels').then(r => r.json());
    setChannels(chs);
    if (data.slug) selectChannel(data.slug);
    setTimeout(() => setFetchStatus(''), 5000);
  }

  function toggleLang() {
    const next = lang === 'en' ? 'ja' : 'en';
    setLang(next);
    localStorage.setItem('yt-lang', next);
  }

  const v = videos[current];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem' }}>
      <button onClick={toggleLang} style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.85rem', cursor: 'pointer', background: '#272727', border: '1px solid #444', color: '#fff', padding: '0.3rem 0.6rem', borderRadius: '4px' }}>
        {lang === 'en' ? '日本語' : 'English'}
      </button>

      <h1 style={{ marginBottom: '1.5rem', fontSize: '1.5rem' }}>{t('title')}</h1>

      {/* Add channel section */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label><small>{t('channel')}</small><br/>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchChannel()}
            placeholder={t('channelPh')} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', background: '#1a1a1a', color: '#fff', fontSize: '0.9rem', width: '14rem' }} />
        </label>
        <label><small>{t('folderName')}</small><br/>
          <input value={slug} onChange={e => setSlug(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchChannel()}
            placeholder={t('optional')} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', background: '#1a1a1a', color: '#fff', fontSize: '0.9rem', width: '7rem' }} />
        </label>
        <label><small>{t('apiKey')}</small><br/>
          <input type="password" value={apiKeyInput} onChange={e => { setApiKeyInput(e.target.value); localStorage.setItem('yt-api-key', e.target.value); }} onKeyDown={e => e.key === 'Enter' && searchChannel()}
            placeholder={t('optional')} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', background: '#1a1a1a', color: '#fff', fontSize: '0.9rem', width: '10rem' }} />
        </label>
        <button onClick={searchChannel} style={{ padding: '0.6rem 1.5rem', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer', background: '#272727', color: '#fff' }}>{t('search')}</button>
      </div>

      {searchResults && (
        <div style={{ marginBottom: '1rem', width: '100%', maxWidth: '800px' }}>
          {searchResults.map(r => (
            <div key={r.id} onClick={() => addChannelById(r.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.5rem', borderBottom: '1px solid #222', cursor: 'pointer' }}>
              <img src={r.thumbnail} style={{ width: 40, height: 40, borderRadius: '50%' }} alt="" />
              <div><strong>{r.name}</strong><br/><small style={{ color: '#888' }}>{r.videoCount} {t('videos')} · {r.id}</small></div>
            </div>
          ))}
        </div>
      )}

      {fetchStatus && <div style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: fetchStatus.replace(/href="\//g, 'href="https://developers.google.com/') }} />}

      {/* Channel buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1.5rem' }}>
        {channels.map(ch => (
          <div key={ch.slug} style={{ position: 'relative', display: 'inline-block' }}>
            <button onClick={() => selectChannel(ch.slug)}
              style={{ padding: '0.5rem 2rem 0.5rem 1rem', border: `1px solid ${ch.slug === currentSlug ? '#1a7f37' : '#444'}`, borderRadius: '6px', background: ch.slug === currentSlug ? '#1a3a1f' : '#1a1a1a', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}>
              {ch.name} <small>({ch.watchedCount}/{ch.videoCount} · {formatTime(ch.watchedSeconds)})</small>
            </button>
            <button onClick={() => deleteChannel(ch.slug, ch.name)} style={{ position: 'absolute', top: '2px', right: '4px', padding: '0 0.3rem', fontSize: '0.7rem', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>✕</button>
          </div>
        ))}
      </div>

      {/* Player */}
      {v && (
        <>
          <div style={{ color: '#aaa', marginBottom: '1rem' }}>{current + 1} / {videos.length}</div>
          <div style={{ width: '100%', maxWidth: '800px', aspectRatio: '16/9', marginBottom: '1.5rem' }}>
            <div id="yt-player" style={{ width: '100%', height: '100%' }} />
          </div>
          <div style={{ marginBottom: '1rem', fontSize: '1.1rem', textAlign: 'center', maxWidth: '800px' }}>
            {v.title}{v.duration ? ` (${formatDuration(v.duration)})` : ''}
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => advance(-1)} style={btnStyle}>{t('prev')}</button>
            <button onClick={() => advance(1)} style={{ ...btnStyle, background: '#1a7f37' }}>{t('done')}</button>
            <button onClick={() => advance(1)} style={btnStyle}>{t('next')}</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '1rem', fontSize: '0.85rem', color: '#aaa' }}>
              <input type="checkbox" checked={autoplay} onChange={e => setAutoplay(e.target.checked)} /> {t('autoplay')}
            </label>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="number" min={1} id="jumpInput" placeholder="#" style={{ width: '5rem', padding: '0.4rem', borderRadius: '4px', border: '1px solid #444', background: '#1a1a1a', color: '#fff', fontSize: '0.9rem' }}
              onKeyDown={e => { if (e.key === 'Enter') jump(parseInt((e.target as HTMLInputElement).value)); }} />
            <button onClick={() => jump(parseInt((document.getElementById('jumpInput') as HTMLInputElement).value))} style={btnStyle}>{t('go')}</button>
            <button onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen) loadHistory(); }} style={{ ...btnStyle, marginLeft: '1rem' }}>{t('history')}</button>
            <button onClick={clearHistory} style={{ ...btnStyle, background: '#3a1a1a', border: '1px solid #633' }}>{t('clearAll')}</button>
          </div>

          {historyOpen && (
            <div style={{ marginTop: '1.5rem', width: '100%', maxWidth: '800px', maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead><tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ textAlign: 'left', padding: '0.3rem' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '0.3rem' }}>{t('titleCol')}</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem' }}>{t('length')}</th>
                  <th style={{ textAlign: 'right', padding: '0.3rem' }}>{t('date')}</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {[...historyData].reverse().map((h, i) => (
                    <tr key={h.videoId} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: '0.3rem', color: '#666' }}>{historyData.length - i}</td>
                      <td style={{ padding: '0.3rem' }}>{h.title}</td>
                      <td style={{ padding: '0.3rem', textAlign: 'right', color: '#888' }}>{formatDuration(h.duration)}</td>
                      <td style={{ padding: '0.3rem', textAlign: 'right', color: '#666' }}>{new Date(h.watchedAt).toLocaleString()}</td>
                      <td style={{ padding: '0.3rem' }}>
                        <button onClick={() => deleteHistoryEntry(h.videoId)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: '#3a1a1a', border: '1px solid #633', color: '#fff', cursor: 'pointer', borderRadius: '4px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '0.6rem 1.5rem', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer', background: '#272727', color: '#fff' };
