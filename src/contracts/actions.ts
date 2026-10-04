/**
 * Store state + action contract. FROZEN CONTRACT — changes go through the orchestrator.
 *
 * The model domain implements this; canvas/build/panels call it but never import the store.
 * All ids passed in may be RESOLVED ids (including layer nail/edge ids).
 */
import type {
  Design,
  EdgeId,
  GroupId,
  Layer,
  LayerId,
  NailId,
  Pin,
  PinId,
  StrandGroup,
  Vec2,
  Wall,
} from './design';
import type { SurpriseResult } from './generator';

export type ToolId = 'select' | 'add-nail' | 'connect' | 'pin' | 'pan';

export interface Selection {
  nails: NailId[];
  edges: EdgeId[];
  pins: PinId[];
}

export type NewLayer = Partial<Omit<Layer, 'id'>> & Pick<Layer, 'generatorId'>;

export interface DesignActions {
  // ── design ──────────────────────────────────────────────
  setWall(patch: Partial<Wall>): void;
  loadDesign(design: Design): void;
  newDesign(wall?: Partial<Wall>): void;
  renameDesign(name: string): void;

  // ── groups (twine colours) ──────────────────────────────
  addGroup(group?: Partial<Omit<StrandGroup, 'id'>>): GroupId;
  updateGroup(id: GroupId, patch: Partial<Omit<StrandGroup, 'id'>>): void;
  /** Edges/layers of a removed group move to the first remaining group. Last group cannot be removed. */
  removeGroup(id: GroupId): void;

  // ── layers ──────────────────────────────────────────────
  /** Missing fields default: params from registry defaults, transform from generator suggestion, new group if none. */
  addLayer(spec: NewLayer): LayerId;
  updateLayer(id: LayerId, patch: Partial<Omit<Layer, 'id'>>): void;
  removeLayer(id: LayerId): void;
  moveLayer(id: LayerId, toIndex: number): void;
  duplicateLayer(id: LayerId): LayerId;
  /** Freeze a layer into plain nails/edges (ids preserved) and remove the layer. */
  bakeLayer(id: LayerId): void;
  /** Add the layers from a SurpriseResult (creating groups from the palette). Returns new layer ids. */
  applySurprise(result: SurpriseResult, replace: boolean): LayerId[];

  // ── geometry ────────────────────────────────────────────
  addNail(p: Vec2): NailId;
  /** Moving a nail that belongs to a live layer bakes that layer first. */
  moveNails(ids: NailId[], delta: Vec2): void;
  /** Returns null if a===b or the edge already exists in that group. Group defaults to the active group. */
  connect(a: NailId, b: NailId, groupId?: GroupId): EdgeId | null;
  updateEdges(ids: EdgeId[], patch: { sag?: number; groupId?: GroupId }): void;
  /** Deletes selected nails (and their edges), edges and pins. Bakes affected live layers first. */
  deleteSelection(): void;

  // ── pins (photos) ───────────────────────────────────────
  addPin(edgeId: EdgeId, t: number): PinId;
  updatePin(id: PinId, patch: Partial<Omit<Pin, 'id'>>): void;
  removePin(id: PinId): void;
  setPins(pins: Pin[]): void;

  // ── ui-ish state kept in the store ──────────────────────
  setSelection(sel: Partial<Selection>): void;
  clearSelection(): void;
  setActiveGroup(id: GroupId): void;

  // ── history ─────────────────────────────────────────────
  undo(): void;
  redo(): void;
  /**
   * Group many changes (e.g. a drag) into one undo step:
   * beginGesture() → many moveNails() → endGesture().
   */
  beginGesture(): void;
  endGesture(): void;
}

export interface DesignState {
  design: Design;
  selection: Selection;
  activeGroupId: GroupId;
  canUndo: boolean;
  canRedo: boolean;
}

export type DesignStoreState = DesignState & DesignActions;

/** Framework-agnostic store handle (zustand vanilla store satisfies this). */
export interface DesignStore {
  getState(): DesignStoreState;
  subscribe(listener: (state: DesignStoreState, prev: DesignStoreState) => void): () => void;
}
