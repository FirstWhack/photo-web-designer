# Photo Web Designer: rules for domain agents

The app helps people design "photo webs": nails on a wall and craft twine strung between them, with photos clothes-pinned to the twine. The stringing pattern is the star of the show.

## Architecture
```
Design ──resolveDesign(model)──► ResolvedDesign ──planBuild/analyze(plan)──► BuildPlan / Report
                                        │
                     Scene/Thumbnail (canvas) · Walkthrough/CutList/CoordTable/PDF (build) · panels/app (ui shell)
```
- `src/contracts/`: the **frozen** types and interfaces, plus `fixtures/` (hand-checked sample data). **Do not edit these files.** If you need a contract change, describe it under "Contract change requests" in your final report and work around it locally.
- `src/lib/`: shared helpers: `geom` (sag curves, transforms, turns), `rng` (seeded random numbers), `units`, `id`. **Always use these** instead of reimplementing them. Treat this folder as read-only too.
- Each domain owns **one folder** and exposes its public API via `index.ts`. **The exported signatures in the Wave-0 stub are the API.** Keep them exactly as they are; you may add exports.

## Hard rules
1. Only edit files inside the folder you own. Tests go next to the code as `*.test.ts(x)`.
2. A domain may import only from `@/contracts`, `@/lib`, and its own folder. `npm run lint` enforces this through `scripts/check-boundaries.mjs`.
3. `generators`, `plan`, `lib` and `contracts` must stay pure TypeScript: no React and no zustand.
4. Never use `Math.random` in domain code; use `createRng(seed)`.
5. Canvas and build components display data and change things only through `DesignActions` callbacks passed as props. They never import a store.
6. Don't add npm dependencies. If you really need one, ask for it in your report.
7. Definition of done: `npm run check` passes (typecheck, lint plus boundaries, tests), and your work is committed on your branch.

## Setup in a worktree
`node_modules` is not copied into worktrees. Link the main checkout's instead of reinstalling:
```powershell
New-Item -ItemType Junction -Path node_modules -Target G:\FastDev\Webs\node_modules
```

## Dev pages
`npm run dev`, then open `/?dev=canvas` or `/?dev=build`. These pages render the fixtures without the rest of the app.
