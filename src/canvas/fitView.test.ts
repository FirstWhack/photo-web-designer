import { describe, expect, it } from 'vitest';
import { fitView } from './Scene';

describe('fitView', () => {
  const wall = { width: 200, height: 100 };
  it('centres the wall', () => {
    const v = fitView({ w: 800, h: 600 }, wall);
    expect(v.x + 800 / (2 * v.k)).toBeCloseTo(100);
    expect(v.y + 600 / (2 * v.k)).toBeCloseTo(50);
  });
  it('keeps the wall above a reserved bottom band', () => {
    const size = { w: 400, h: 800 };
    const v = fitView(size, { width: 100, height: 100 }, 0.56);
    const bottomPx = (100 - v.y) * v.k;
    expect(bottomPx).toBeLessThanOrEqual(size.h * 0.44);
    expect(fitView(size, { width: 100, height: 100 }, 0).k).toBeGreaterThan(v.k);
  });
});
