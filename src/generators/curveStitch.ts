/**
 * Curve stitching: straight threads between two rows of nails whose envelope is a parabola.
 * Point i (counting from the shared corner) on one arm joins point n+1−i on the next arm.
 */
import type { ParamValues, Vec2 } from '@/contracts/design';
import type { Generator, ParamSchema } from '@/contracts/generator';
import { Builder, centredTransform, fitPoints, readParams, ringPoint } from './util';

const schema: ParamSchema = [
  {
    key: 'shape',
    label: 'Shape',
    kind: 'select',
    options: [
      { value: 'polygon', label: 'N-gon star' },
      { value: 'corner', label: 'Corner (L)' },
      { value: 'angle', label: 'Angled lines' },
      { value: 'fan', label: 'Fan' },
    ],
    default: 'polygon',
  },
  { key: 'points', label: 'Points per arm', kind: 'int', min: 4, max: 24, default: 10 },
  { key: 'arms', label: 'Arms', kind: 'int', min: 3, max: 12, default: 5, hint: 'For n-gon star and fan' },
  { key: 'angle', label: 'Angle', kind: 'number', min: 20, max: 160, step: 1, default: 60, hint: 'Opening of the angled lines or fan (degrees)' },
  { key: 'drawArms', label: 'String arms', kind: 'bool', default: true, hint: 'Also run twine along each arm' },
];

type Arm = number[]; // nail indices from the shared corner outward

function stitch(b: Builder, a: Arm, c: Arm) {
  const n = Math.min(a.length, c.length);
  for (let i = 0; i < n; i++) b.edge(a[i], c[n - 1 - i]);
}

function generate(params: ParamValues) {
  const p = readParams(schema, params);
  const shape = p.str('shape');
  const n = p.num('points');
  const arms = p.num('arms');
  const angle = (p.num('angle') * Math.PI) / 180;
  const drawArms = p.bool('drawArms');
  const b = new Builder();

  /** Arm of n nails from `from` toward `to`, skipping `from` itself (t from t0 to 1). */
  const arm = (from: Vec2, to: Vec2, t0: number): Arm =>
    Array.from({ length: n }, (_, i) => {
      const t = t0 + ((1 - t0) * (n > 1 ? i : 0)) / Math.max(1, n - 1);
      return b.nail(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    });

  if (shape === 'corner' || shape === 'angle') {
    // Two arms from a shared vertex. Corner = an upright L (vertex bottom-left);
    // angle = a V opening upward by the angle param. Fit vertex/tipA/tipB into the box.
    const theta = angle;
    const dirA =
      shape === 'corner' ? { x: 0, y: -1 } : { x: Math.cos(-Math.PI / 2 - theta / 2), y: Math.sin(-Math.PI / 2 - theta / 2) };
    const dirB =
      shape === 'corner' ? { x: 1, y: 0 } : { x: Math.cos(-Math.PI / 2 + theta / 2), y: Math.sin(-Math.PI / 2 + theta / 2) };
    const pts = [{ x: 0, y: 0 }, dirA, dirB];
    const minX = Math.min(...pts.map((q) => q.x)), maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y)), maxY = Math.max(...pts.map((q) => q.y));
    const s = 1.9 / Math.max(maxX - minX, maxY - minY);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const fit = (q: Vec2) => ({ x: (q.x - cx) * s, y: (q.y - cy) * s });
    const v = fit({ x: 0, y: 0 });
    const vi = b.nail(v.x, v.y);
    const A = arm(v, fit(dirA), 1 / n);
    const B = arm(v, fit(dirB), 1 / n);
    stitch(b, A, B);
    if (drawArms) {
      b.path([vi, ...A]);
      b.path([vi, ...B]);
    }
    return b.output(true);
  }

  // Radial arms from the centre: polygon = evenly around 360°, fan = spread over `angle`.
  let centre: Vec2 = { x: 0, y: 0 };
  const t0 = 0.18;
  let tips: Vec2[];
  if (shape === 'polygon') {
    tips = Array.from({ length: arms }, (_, a) => ringPoint(a, arms));
  } else {
    // Keep neighbouring fan arms far enough apart for their inner nails.
    const spread = Math.min(Math.max(angle, ((arms - 1) * 15 * Math.PI) / 180), (300 * Math.PI) / 180);
    tips = Array.from({ length: arms }, (_, a) => {
      const ang = -Math.PI / 2 - spread / 2 + (spread * a) / (arms - 1);
      return { x: Math.cos(ang), y: Math.sin(ang) };
    });
    const fitted = fitPoints([centre, ...tips], 0.95);
    centre = fitted[0];
    tips = fitted.slice(1);
  }
  const armNails = tips.map((tip) => arm(centre, tip, t0));
  const pairs = shape === 'polygon' ? arms : arms - 1;
  for (let a = 0; a < pairs; a++) stitch(b, armNails[a], armNails[(a + 1) % arms]);
  if (drawArms) {
    const ci = b.nail(centre.x, centre.y);
    for (const A of armNails) b.path([ci, ...A]);
  }
  return b.output(true);
}

export const curveStitch: Generator = {
  id: 'curve-stitch',
  label: 'Curve stitch',
  description: 'Parabolic curve stitching between rows of nails: corners, fans and n-gon stars.',
  schema,
  suggestTransform: centredTransform,
  generate,
};
