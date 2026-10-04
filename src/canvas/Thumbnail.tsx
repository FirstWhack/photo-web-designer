import type { ThumbnailProps } from '@/contracts/ui';
import { Scene } from './Scene';

/** Wave-0 stub. */
export function Thumbnail({ resolved, width }: ThumbnailProps) {
  const height = (width * resolved.wall.height) / resolved.wall.width;
  return (
    <div style={{ width, height }}>
      <Scene resolved={resolved} selection={{ nails: [], edges: [], pins: [] }} tool="select" activeGroupId="" />
    </div>
  );
}
