import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'YouTube Challenge',
  icons: { icon: '/icon.svg' },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0f0f0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, padding: 0, background: '#0f0f0f', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
