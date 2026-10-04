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
/** The dimensioned, scaled engineering drawing (SVG + matching vector PDF). */
export { PlanSheet, type PlanSheetProps } from './PlanSheet';
export { exportPlanPdf, type PlanPdfOptions } from './planPdf';
export { buildPlanDrawing, chooseScale, PAPER_LABEL, SHEET_MM, type PlanDrawing, type PlanPaper } from './drawing';
export { axisDimensions, clusterPositions, equalSpacingGroups, nailDimensions } from './dimensions';
