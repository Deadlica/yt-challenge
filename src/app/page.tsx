import type { Metadata } from 'next';
import Player from '@/components/Player';

export const metadata: Metadata = {
  title: 'YouTube Challenge',
};

export default function Home() {
  return <Player />;
}
