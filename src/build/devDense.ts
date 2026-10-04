/**
 * Dev-page helper only: a dense string-art design (~2000 edges) for checking that the
 * engineering drawing stays legible.
 */
import type { Edge, Nail, ResolvedDesign } from '@/contracts/design';
import { JUTE, RED } from '@/contracts/fixtures';

export function denseFixture(): ResolvedDesign {
  const nails: Nail[] = [];
  const edges: Edge[] = [];
  const N = 96;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    nails.push({ id: `c${i}`, x: 36 + 20 * Math.cos(a), y: 24 + 20 * Math.sin(a) });
  }
  for (let i = 0; i < N; i++)
    for (let k = 1; k <= 21; k++)
      edges.push({ id: `e${i}-${k}`, a: `c${i}`, b: `c${(i + k * 2) % N}`, groupId: k % 2 ? JUTE.id : RED.id, sag: 0 });
  // A row of equally spaced nails along the bottom, strung as a gentle garland.
  for (let i = 0; i < 17; i++) nails.push({ id: `r${i}`, x: 4 + i * 4, y: 46 });
  for (let i = 0; i < 16; i++) edges.push({ id: `g${i}`, a: `r${i}`, b: `r${i + 1}`, groupId: RED.id, sag: 0.3 });
  const seen = new Set<string>();
  const uniq = edges.filter((e) => {
    const key = [e.a, e.b].sort().join('|') + e.groupId;
    if (e.a === e.b || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { wall: { width: 72, height: 48, units: 'in' }, groups: [JUTE, RED], nails, edges: uniq, pins: [] };
}
