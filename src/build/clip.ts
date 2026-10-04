/** Liang–Barsky: clip segment p→q to the rectangle; returns null when fully outside. */
export function clipSegment(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    { x: p.x + t0 * dx, y: p.y + t0 * dy },
    { x: p.x + t1 * dx, y: p.y + t1 * dy },
  ];
}
