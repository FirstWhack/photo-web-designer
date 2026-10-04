/**
 * Hand-checked sample data so every domain can be built and tested in isolation.
 * Units are inches; wall is 72 × 48. All fixture edges are taut (sag 0) unless noted,
 * so lengths are exact chord lengths.
 */
import type { Design, Edge, Nail, ResolvedDesign, StrandGroup } from '../design';
import type { BuildPlan, Report } from '../plan';
import { emptyDesign } from '../defaults';

const WALL = { width: 72, height: 48, units: 'in' as const };

export const JUTE: StrandGroup = { id: 'g-jute', name: 'Natural jute', color: '#c8a165', thickness: 2 };
export const RED: StrandGroup = { id: 'g-red', name: 'Red cotton', color: '#b5523b', thickness: 1.5 };

const n = (id: string, x: number, y: number): Nail => ({ id, x, y });
const e = (id: string, a: string, b: string, groupId = JUTE.id, sag = 0): Edge => ({ id, a, b, groupId, sag });

// ── triangle: 3-4-5 right triangle, one closed loop → 1 run ──────────────
export const triangle: ResolvedDesign = {
  wall: WALL,
  groups: [JUTE],
  nails: [n('A', 10, 10), n('B', 40, 10), n('C', 10, 40)],
  edges: [e('e-ab', 'A', 'B'), e('e-bc', 'B', 'C'), e('e-ca', 'C', 'A')],
  pins: [{ id: 'p1', edgeId: 'e-ab', t: 0.5 }],
};
// NOTE: C is at (10, 40) → AB = 30, AC = 30, BC = √1800 ≈ 42.426

// ── plus: four arms meeting at O → 4 odd nails → 2 runs ──────────────────
export const plus: ResolvedDesign = {
  wall: WALL,
  groups: [JUTE],
  nails: [n('O', 30, 30), n('N', 30, 10), n('E', 50, 30), n('S', 30, 48), n('W', 10, 30)],
  edges: [e('e-on', 'O', 'N'), e('e-oe', 'O', 'E'), e('e-os', 'O', 'S'), e('e-ow', 'O', 'W')],
  pins: [],
};
// NOTE: S is at (30, 48) → OS = 18; ON = OE = OW = 20.

// ── star {5/2}: five nails on a circle, every degree 2 → 1 run ──────────
const starNails: Nail[] = Array.from({ length: 5 }, (_, i) => {
  const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
  return n(`S${i}`, 36 + 15 * Math.cos(ang), 24 + 15 * Math.sin(ang));
});
export const star: ResolvedDesign = {
  wall: WALL,
  groups: [RED],
  nails: starNails,
  edges: [0, 1, 2, 3, 4].map((i) => e(`e-s${i}`, `S${i}`, `S${(i + 2) % 5}`, RED.id)),
  pins: [],
};

// ── spider: centre + 6 inner + 6 outer nails, spokes and two rings ──────
// Degrees: centre 6, inner 4, outer 3 → 6 odd nails → 3 runs.
const spiderNails: Nail[] = [n('C0', 36, 24)];
const spiderEdges: Edge[] = [];
for (let i = 0; i < 6; i++) {
  const ang = (i * Math.PI) / 3;
  spiderNails.push(n(`I${i}`, 36 + 10 * Math.cos(ang), 24 + 10 * Math.sin(ang)));
  spiderNails.push(n(`O${i}`, 36 + 20 * Math.cos(ang), 24 + 20 * Math.sin(ang)));
}
for (let i = 0; i < 6; i++) {
  const j = (i + 1) % 6;
  spiderEdges.push(e(`e-ci${i}`, 'C0', `I${i}`));
  spiderEdges.push(e(`e-io${i}`, `I${i}`, `O${i}`));
  spiderEdges.push(e(`e-ii${i}`, `I${i}`, `I${j}`, JUTE.id, 0.2));
  spiderEdges.push(e(`e-oo${i}`, `O${i}`, `O${j}`, JUTE.id, 0.35));
}
export const spider: ResolvedDesign = {
  wall: WALL,
  groups: [JUTE],
  nails: spiderNails,
  edges: spiderEdges,
  pins: [
    { id: 'p-s1', edgeId: 'e-oo1', t: 0.5 },
    { id: 'p-s2', edgeId: 'e-oo2', t: 0.5 },
  ],
};

// ── combo: spider (jute) + star (red, shifted right), two groups ─────────
export const combo: ResolvedDesign = {
  wall: WALL,
  groups: [JUTE, RED],
  nails: [...spiderNails.map((p) => ({ ...p, x: p.x - 14 })), ...starNails.map((p) => ({ ...p, x: p.x + 20 }))],
  edges: [...spiderEdges, ...star.edges],
  pins: [],
};

export const fixtures = { triangle, plus, star, spider, combo };

/** Minimum number of runs (pieces of twine) each fixture needs. */
export const EXPECTED_RUNS: Record<keyof typeof fixtures, number> = {
  triangle: 1,
  plus: 2,
  star: 1,
  spider: 3,
  combo: 4,
};

// ── hand-checked BuildPlans (one valid answer; planners may choose other routes) ──
const cut = (raw: number, steps: number) => (raw + 0.5 * (steps - 1) + 2 * 6) * 1.1;
const BC = Math.sqrt(1800);

export const trianglePlan: BuildPlan = {
  runs: [
    {
      id: 'r1',
      groupId: JUTE.id,
      nails: ['A', 'B', 'C', 'A'],
      steps: [
        { from: 'A', to: 'B', edgeId: 'e-ab', length: 30, wrap: 'cw', hairpin: false },
        { from: 'B', to: 'C', edgeId: 'e-bc', length: BC, wrap: 'cw', hairpin: false },
        { from: 'C', to: 'A', edgeId: 'e-ca', length: 30, wrap: 'tie-off', hairpin: false },
      ],
      rawLength: 60 + BC,
      cutLength: cut(60 + BC, 3),
    },
  ],
  totals: { runs: 1, nails: 3, edges: 3, cutLengthByGroup: { [JUTE.id]: cut(60 + BC, 3) }, cutLength: cut(60 + BC, 3) },
};

export const plusPlan: BuildPlan = {
  runs: [
    {
      id: 'r1',
      groupId: JUTE.id,
      nails: ['N', 'O', 'S'],
      steps: [
        { from: 'N', to: 'O', edgeId: 'e-on', length: 20, wrap: 'pass', hairpin: false },
        { from: 'O', to: 'S', edgeId: 'e-os', length: 18, wrap: 'tie-off', hairpin: false },
      ],
      rawLength: 38,
      cutLength: cut(38, 2),
    },
    {
      id: 'r2',
      groupId: JUTE.id,
      nails: ['W', 'O', 'E'],
      steps: [
        { from: 'W', to: 'O', edgeId: 'e-ow', length: 20, wrap: 'pass', hairpin: false },
        { from: 'O', to: 'E', edgeId: 'e-oe', length: 20, wrap: 'tie-off', hairpin: false },
      ],
      rawLength: 40,
      cutLength: cut(40, 2),
    },
  ],
  totals: {
    runs: 2,
    nails: 5,
    edges: 4,
    cutLengthByGroup: { [JUTE.id]: cut(38, 2) + cut(40, 2) },
    cutLength: cut(38, 2) + cut(40, 2),
  },
};

/**
 * Triangle analysis with DEFAULT_ANALYZE_OPTIONS_IN (photo 4×6, gap 2, clearance 3, any angle):
 *  AB horizontal, L=30, pitch 6 → floor(24/6) = 4 slots, score 1
 *  BC at 45°, L=30√2, pitch 6√2 → floor((30√2-6)/(6√2)) = 4 slots, score 0.7
 *  CA vertical, L=30, pitch 8 → floor(24/8) = 3 slots, score 0.4
 */
export const triangleReport: Report = {
  issues: [],
  nailLoad: { A: 2, B: 2, C: 2 },
  edgeScore: { 'e-ab': 1, 'e-bc': 0.7, 'e-ca': 0.4 },
  photoSlots: { 'e-ab': 4, 'e-bc': 4, 'e-ca': 3 },
  stats: { nails: 3, edges: 3, twineLength: 60 + BC, photoSlots: 11, bbox: { minX: 10, minY: 10, maxX: 40, maxY: 40 } },
};

/** A source Design: one live layer (generator 'spider-web') plus the baked triangle. */
export function sampleDesign(): Design {
  const d = emptyDesign(WALL, 0);
  d.groups = [JUTE, RED];
  d.nails = triangle.nails.map((p) => ({ ...p }));
  d.edges = triangle.edges.map((x) => ({ ...x }));
  d.pins = [...triangle.pins];
  d.layers = [
    {
      id: 'L1',
      name: 'Spider web',
      generatorId: 'spider-web',
      params: {},
      seed: 42,
      transform: { x: 50, y: 24, scaleX: 16, scaleY: 16, rotation: 0 },
      groupId: RED.id,
      sag: 0.2,
      visible: true,
      locked: false,
    },
  ];
  d.meta.name = 'Sample web';
  return d;
}
