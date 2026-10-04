/**
 * GENERATORS domain — public API. Owner: generators agent.
 * Pure, deterministic, no React.
 */
import type { Generator, GeneratorRegistry } from '@/contracts/generator';
import { curveStitch } from './curveStitch';
import { frame } from './frame';
import { lattice } from './lattice';
import { organic } from './organic';
import { spiderWeb } from './spiderWeb';
import { star } from './star';
import { stringArt } from './stringArt';
import { surprise } from './surprise';
import { swag } from './swag';
import { schemaDefaults } from './util';

const ALL: Generator[] = [frame, spiderWeb, stringArt, star, curveStitch, lattice, organic, swag];
const BY_ID = new Map(ALL.map((g) => [g.id, g]));

export const registry: GeneratorRegistry = {
  list: () => ALL.slice(),
  get: (id) => BY_ID.get(id),
  defaults: (id) => {
    const g = BY_ID.get(id);
    return g ? schemaDefaults(g.schema) : {};
  },
  surprise: (seed, wall) => surprise(seed, wall, (id) => BY_ID.get(id)),
};

export { curveStitch, frame, lattice, organic, spiderWeb, star, stringArt, swag };
