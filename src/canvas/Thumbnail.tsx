import { memo, useMemo } from 'react';
import type { ThumbnailProps } from '@/contracts/ui';
import { pointOnSag, sagPath } from '@/lib/geom';
import { nailMap, shade, sizes, twineWidth } from './math';
import s from './Thumbnail.module.css';
import { usePhotoSize } from './PhotoSize';

/**
 * Static, read-only preview: one path per twine colour, one path for all nails,
 * tiny photo markers. No interaction, no per-edge elements, cheap to render many.
 */
export const Thumbnail = memo(function Thumbnail({ resolved, width }: ThumbnailProps) {
  const { wall } = resolved;
  const photoSize = usePhotoSize(wall.units);
  const height = (width * wall.height) / Math.max(1e-6, wall.width);
  const k = width / Math.max(1e-6, wall.width); // px per wall unit

  const drawn = useMemo(() => {
    const nails = nailMap(resolved.nails);
    const byGroup = new Map<string, string[]>();
    for (const e of resolved.edges) {
      const a = nails.get(e.a);
      const b = nails.get(e.b);
      if (!a || !b) continue;
      let list = byGroup.get(e.groupId);
      if (!list) byGroup.set(e.groupId, (list = []));
      list.push(sagPath(a, b, e.sag));
    }
    const groups = resolved.groups
      .filter((g) => byGroup.has(g.id))
      .map((g) => ({ id: g.id, color: g.color, tw: twineWidth(g.thickness, wall.units), d: byGroup.get(g.id)!.join('') }));
    // edges in groups not listed (shouldn't happen) still show
    for (const [id, list] of byGroup) if (!groups.some((g) => g.id === id)) groups.push({ id, color: '#999', tw: 0.08, d: list.join('') });

    const r = Math.max(sizes(wall.units).nailR * 1.2, 1.1 / k);
    let nd = '';
    for (const n of resolved.nails) nd += `M${n.x - r} ${n.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

    const edges = new Map(resolved.edges.map((e) => [e.id, e]));
    const photo = photoSize?.width ?? sizes(wall.units).photoW;
    let pd = '';
    for (const p of resolved.pins) {
      const e = edges.get(p.edgeId);
      const a = e && nails.get(e.a);
      const b = e && nails.get(e.b);
      if (!e || !a || !b) continue;
      const { x, y } = pointOnSag(a, b, e.sag, p.t);
      const photoHeight = p.photo?.aspect ? photo / p.photo.aspect : photoSize?.height ?? photo * 1.2;
      pd += `M${x - photo / 2} ${y + 0.3}h${photo}v${photoHeight}h${-photo}Z`;
    }
    return { groups, nd, pd };
  }, [resolved, wall.units, k, photoSize]);

  const minW = 0.9 / k;
  return (
    <svg
      className={s.thumb}
      width={width}
      height={height}
      viewBox={`0 0 ${wall.width} ${wall.height}`}
      role="img"
      aria-label="Photo web preview"
    >
      <rect className={s.wall} width={wall.width} height={wall.height} />
      {drawn.groups.map((g) => {
        const w = Math.max(g.tw, minW);
        return (
          <g key={g.id}>
            <path d={g.d} className={s.shadow} strokeWidth={w * 1.3} transform={`translate(${w * 0.5} ${w * 0.9})`} />
            <path d={g.d} className={s.twine} stroke={g.color} strokeWidth={w} />
            {w * k > 2.2 && <path d={g.d} className={s.twine} stroke={shade(g.color, 0.4)} strokeWidth={w * 0.4} strokeDasharray={`${w} ${w * 1.3}`} strokeLinecap="butt" />}
          </g>
        );
      })}
      {drawn.nd && <path d={drawn.nd} className={s.nail} />}
      {drawn.pd && <path d={drawn.pd} className={s.photo} />}
    </svg>
  );
});
