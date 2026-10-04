/**
 * Component prop contracts between UI domains. FROZEN CONTRACT — changes go through the orchestrator.
 */
import type { DesignActions, Selection, ToolId } from './actions';
import type { GroupId, ResolvedDesign } from './design';
import type { BuildPlan, Report } from './plan';

// ── canvas domain ─────────────────────────────────────────

export interface SnapOptions {
  grid: boolean;
  /** Grid pitch in wall units. */
  gridSize: number;
  nails: boolean;
}

export type Overlay = 'none' | 'issues' | 'photos' | 'load';

export interface PlaybackState {
  playing: boolean;
  /** Global step index across all runs in plan order (0 .. totalSteps). */
  step: number;
  /** Progress 0..1 through the current step. */
  progress: number;
  totalSteps: number;
  /** Steps per second. */
  speed: number;
}

export interface PlaybackControls {
  state: PlaybackState;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Jump to a global step index. */
  seek(step: number): void;
  setSpeed(stepsPerSecond: number): void;
  reset(): void;
}

export interface SceneProps {
  resolved: ResolvedDesign;
  selection: Selection;
  tool: ToolId;
  activeGroupId: GroupId;
  /** Omit for a read-only scene. */
  actions?: DesignActions;
  report?: Report;
  overlay?: Overlay;
  plan?: BuildPlan;
  /** When present, only strung-so-far twine is drawn and the current step animates. */
  playback?: PlaybackState;
  showPins?: boolean;
  showNailLabels?: boolean;
  snap?: SnapOptions;
  /** Edge/nail ids to emphasise (e.g. current walkthrough step). */
  highlight?: { nails?: string[]; edges?: string[] };
  /** Fraction (0..0.9) of the height, at the bottom, covered by other UI such as the phone inspector sheet; "fit" keeps the wall above it. */
  viewReserve?: number;
  className?: string;
}

export interface ThumbnailProps {
  resolved: ResolvedDesign;
  /** Pixel width; height follows the wall aspect. */
  width: number;
}

// ── build domain ──────────────────────────────────────────

export type MeasureOrigin = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface WalkthroughProps {
  resolved: ResolvedDesign;
  plan: BuildPlan;
  /** localStorage key for remembering progress. */
  storageKey?: string;
}

export interface CutListProps {
  resolved: ResolvedDesign;
  plan: BuildPlan;
  report?: Report;
}

export interface CoordTableProps {
  resolved: ResolvedDesign;
  origin: MeasureOrigin;
}

export interface TemplatePdfOptions {
  paper: 'letter' | 'a4';
  /** Page margin in mm. */
  margin: number;
  origin: MeasureOrigin;
  title?: string;
}
