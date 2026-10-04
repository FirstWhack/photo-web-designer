/**
 * Pure tiling math for the 1:1 paper template. All values in millimetres.
 */

export type Paper = 'letter' | 'a4';

/** Portrait sheet sizes in mm. */
export const PAPER_MM: Record<Paper, { w: number; h: number }> = {
  letter: { w: 215.9, h: 279.4 },
  a4: { w: 210, h: 297 },
};

/** Space reserved inside the margins for the header (tile id) and footer (calibration square). */
export interface PageChrome {
  top: number;
  bottom: number;
}

export const DEFAULT_CHROME: PageChrome = { top: 10, bottom: 32 };
export const DEFAULT_OVERLAP_MM = 10;

export interface Tile {
  /** "A1" = row A, column 1. */
  id: string;
  row: number;
  col: number;
  /** Wall-space rectangle (mm from the wall's top-left) printed on this sheet. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileLayout {
  orientation: 'portrait' | 'landscape';
  pageW: number;
  pageH: number;
  /** Top-left of the printed wall area on the page. */
  contentX: number;
  contentY: number;
  /** Size of the printed wall area on each sheet. */
  contentW: number;
  contentH: number;
  overlap: number;
  cols: number;
  rows: number;
  tiles: Tile[];
}

export const rowName = (row: number): string =>
  row < 26 ? String.fromCharCode(65 + row) : rowName(Math.floor(row / 26) - 1) + String.fromCharCode(65 + (row % 26));

/** Smallest n with (n - 1) * (size - overlap) + size >= length. */
function count(length: number, size: number, overlap: number): number {
  if (length <= size) return 1;
  return Math.ceil((length - overlap) / (size - overlap) - 1e-9);
}

function layoutFor(
  wallMm: { width: number; height: number },
  pageW: number,
  pageH: number,
  margin: number,
  overlap: number,
  chrome: PageChrome,
  orientation: TileLayout['orientation'],
): TileLayout {
  const contentW = pageW - 2 * margin;
  const contentH = pageH - 2 * margin - chrome.top - chrome.bottom;
  if (contentW <= overlap || contentH <= overlap) throw new Error('Margins too large for the paper size');
  const cols = count(wallMm.width, contentW, overlap);
  const rows = count(wallMm.height, contentH, overlap);
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        id: `${rowName(r)}${c + 1}`,
        row: r,
        col: c,
        x: c * (contentW - overlap),
        y: r * (contentH - overlap),
        w: contentW,
        h: contentH,
      });
    }
  }
  return {
    orientation,
    pageW,
    pageH,
    contentX: margin,
    contentY: margin + chrome.top,
    contentW,
    contentH,
    overlap,
    cols,
    rows,
    tiles,
  };
}

/**
 * Tile a wall (mm) across sheets. Neighbouring tiles share `overlap` mm of wall so they
 * can be taped together. Tries portrait and landscape and keeps whichever needs fewer
 * sheets (portrait on a tie).
 */
export function computeTiles(
  wallMm: { width: number; height: number },
  paper: Paper,
  margin: number,
  overlap = DEFAULT_OVERLAP_MM,
  chrome: PageChrome = DEFAULT_CHROME,
): TileLayout {
  const { w, h } = PAPER_MM[paper];
  const portrait = layoutFor(wallMm, w, h, margin, overlap, chrome, 'portrait');
  let landscape: TileLayout | null;
  try {
    landscape = layoutFor(wallMm, h, w, margin, overlap, chrome, 'landscape');
  } catch {
    landscape = null;
  }
  return landscape && landscape.tiles.length < portrait.tiles.length ? landscape : portrait;
}

/** Millimetres per wall unit. */
export const mmPerUnit = (units: 'in' | 'cm') => (units === 'in' ? 25.4 : 10);
