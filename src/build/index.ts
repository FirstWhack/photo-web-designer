/**
 * BUILD domain — public API. Owner: build agent.
 * Turns a ResolvedDesign + BuildPlan into things you use at the wall.
 */
export { Walkthrough } from './Walkthrough';
export { CutList } from './CutList';
export { CoordTable } from './CoordTable';
/** 1:1-scale nail template, tiled across pages with registration marks. */
export { exportTemplatePdf, templateLayout } from './pdf';
export { computeTiles, PAPER_MM, type Paper, type Tile, type TileLayout } from './tiles';
export { coordRows, coordCsv, measureFrom } from './coords';
