import { describe, expect, it } from 'vitest';
import { registry } from '@/generators';
import { usesSeed } from '@/panels';

describe('seed field matches reality', () => {
  it('a generator whose seed is hidden really ignores it', () => {
    for (const g of registry.list()) {
      const same = JSON.stringify(g.generate({}, 1)) === JSON.stringify(g.generate({}, 2));
      expect(!same, g.id).toBe(usesSeed(g.id, {}, g.schema));
    }
  });
});
