import { describe, expect, it } from 'vitest';
import { usesSeed } from './paramVisibility';

describe('usesSeed', () => {
  it('is false for exact generators', () => {
    for (const id of ['frame', 'string-art', 'star', 'curve-stitch', 'swag']) expect(usesSeed(id, {})).toBe(false);
  });
  it('depends on the setting for spider web and lattice', () => {
    expect(usesSeed('spider-web', { irregularity: 0 })).toBe(false);
    expect(usesSeed('spider-web', { irregularity: 0.4 })).toBe(true);
    expect(usesSeed('lattice', {})).toBe(false);
    expect(usesSeed('lattice', { removal: 0.2 })).toBe(true);
  });
  it('is always true for organic', () => {
    expect(usesSeed('organic', {})).toBe(true);
  });
});
