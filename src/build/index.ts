/**
 * BUILD domain — public API. Owner: build agent.
 * Turns a ResolvedDesign + BuildPlan into things you use at the wall.
 */
import type { ResolvedDesign } from '@/contracts/design';
import type { TemplatePdfOptions } from '@/contracts/ui';
import { notImplemented } from '@/lib/notImplemented';

export { Walkthrough } from './Walkthrough';
export { CutList } from './CutList';
export { CoordTable } from './CoordTable';

/** 1:1-scale nail template, tiled across pages with registration marks. */
export async function exportTemplatePdf(_resolved: ResolvedDesign, _opts: TemplatePdfOptions): Promise<Blob> {
  return notImplemented('build.exportTemplatePdf');
}
