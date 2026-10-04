/**
 * GENERATORS domain — public API. Owner: generators agent.
 * Pure, deterministic, no React.
 */
import type { GeneratorRegistry } from '@/contracts/generator';
import { notImplemented } from '@/lib/notImplemented';

export const registry: GeneratorRegistry = {
  list: () => [],
  get: () => undefined,
  defaults: () => ({}),
  surprise: () => notImplemented('generators.registry.surprise'),
};
