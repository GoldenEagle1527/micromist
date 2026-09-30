# conserve/ — 深潜·守恒 (conservation mode)

The conserved world: a bounded 10 × 10 sea whose particles are counted, locked and returned, never created or destroyed. Design: `深潜-粒子守恒设计稿` v0.5. Build order: `深潜-MVP开发计划` (M1 … M9).

This folder is its **own bundle chunk**. The shared game (free dive, terrain, rendering, UI) reaches it only through `modes/conserveLoader.ts`, a single dynamic `import("../conserve")`, plus type-only imports. The free dive never downloads or runs any of it. `npm run test:modes` checks this on the real module graph with an esbuild metafile.

## Module map

| Folder | Responsibility | May import |
|---|---|---|
| `config.ts` | Every tunable of the mode: genesis totals, lander cargo, world size, save slot and throttle, repair order; biomes (order, frequency, signature particle), affinity matrix A, site-table constants (γ, allocation jitter, edge factor, β, δmax), in-site split | types only |
| `particles/` | The 7 particle kinds, in fixed storage order, and particle count vectors | – |
| `ledger/` | `ParticleLedger`: the five pools W · P · B · S · L and strict conservation (Σ pools = N_k after every operation). Transfers are validated in full, all-or-nothing, and emit events | `particles/` |
| `world/` | World rules on top of the ledger. Genesis (all particles in the world, lander cargo already in the base). M2: the generation's allocation input R = N − P − B (`allocInput.ts`) and the **site table** (`siteTable.ts`): per-site hashes (`siteHash.ts`), region draw (`regionDraw.ts`), largest-remainder allocation (`allocate.ts`), in-site split (`siteSplit.ts`), rock → terrain bias δ (`terrainBias.ts`), summary (`siteSummary.ts`) | `ledger/`, `particles/`, `config` |
| `save/` | Save format v2 (`schema.ts`: v1 + `generation.allocInput`); new save; migrations (`migrate.ts` runs `migrations.ts`: 1 → 2); structural validation; `reconcile.ts` (the totals win, differences go to the suspended pool); slot read/write (`saveRepository.ts`); throttled writer (injected clock) | `ledger/`, `world/`, `particles/`, `config` |
| `session/` | A world opened for a dive (`ConserveSession`): continue or create, repair on load, read-only annihilated worlds (D14), dive count, throttled and on-close writes, the generation's site table (built once from the save). Setup peek (`peekSlot.ts`) | `save/`, `ledger/`, `world/`, `config` |
| `platform/` | The only browser/storage glue: `gameStoreBackend.ts` (platform game-store, key `deep-march/save/<slot>`), `pageLifecycle.ts` (flush on page hide). Adapter to the terrain: `terrainLayout.ts` (site table → `terrain/siteLayout` data, type-only import) | `lib/game-store`, `settings`; types from `terrain/` |
| `loading/` | The loading-registry step 「世界存档」, which shows the open report | types from `ui/loading/steps` |
| `index.ts` | Public API of the chunk | everything above |

Rules, checked by `test:modes`:
- `particles`, `ledger`, `world`, `save` and `session` are pure logic. They import nothing outside `conserve/` and never touch the DOM, storage or rendering.
- No conserve file imports `three`, `react` or `scene/`. Rendering for later milestones lives in the shared scene code and reads conserve state through its API.
- No conserve file is longer than 200 lines.

## Data flow (M1 + M2)

```
Setup screen (ui/setup/SetupScreen)
  mode = conserve → modes/useConserveSlot → loadConserve() → peekWorldSlot(backend)
                                          → "your world · seed · generation · dives" / empty / ended / unreadable
  start → OpenIntent { continue } | { new, seedText }

Play (modes/useConserveDive)
  loadConserve() → openConserveSession({ backend: game-store, intent, hashSeed })
     continue: readSlot → migrate → validate → reconcile → ParticleLedger.fromState
     new:      createWorldSave (genesis) → writeSlot
  → OpenReport ─→ withWorldSaveStep(LOADING_STEPS) → LoadingScreen (step 1 「世界存档」)
  → session.siteTable = buildSiteTable(seed, gen, generation.allocInput, totals)
       → terrainLayoutOf(table) ─→ createDeepMarch({ seed, world: layout })
            density: raw += Σ_i w_i δ_i · (bounds widened by the δ range)
            regions: the 10 × 10 sites from the layout, seeded pseudo-sites outside
            chunks: no column wholly outside the world; diver held 2 m inside (temporary hard edge)
            spawn: an inner site (never wall-adjacent); loading map: the whole 10 × 10 world
  loading done → session.recordDiveStart()      (throttled write, 30 s)
  page hidden → session.flush();  leave dive → session.close() (final write)
```

The terrain side (`terrain/siteLayout.ts`, `regions.ts`, `density.ts`, `chunks.ts`, `spawn.ts`, `scene/diver.ts`, `ui/loading/regionMap.ts`) knows only the mode-agnostic "explicit finite site layout" — plain typed arrays, sent to the mesher workers in `init`. Without a layout every new term is an identity, so the free dive stays bit-exact (`test:free-baseline`, and `test:streaming` checks the free request sequence).

Site table (design doc §3.2, §3.3, §5.2), a pure function of (seed, gen, R, frozen):
- region: P(r) ∝ weight_r · (R_sig / N_sig)^γ (kinds absent from the world leave the factor at 1);
- π_{i,k} = A[r_i][k] · (0.75 + 0.5 · hash) · e_i, e = 0.6 on the 36 wall-adjacent sites, frozen sites 0;
- a_{·,k} = largest remainder of R_k over π_{·,k} ⇒ Σ_i a_{i,k} = R_k exactly;
- split: rock 85 % terrain / 15 % nodes, lumen 55 % nodes / 45 % creatures, others 90 / 10;
- δ_i = clamp(β · ln(a_rock,i / ā_rock), ±δmax), ā_rock = (N_rock − lander cargo) / 100.
R is stored per generation (`generation.allocInput`), so the terrain never changes between two tides even as the ledger moves.

Invariants:
- `ParticleLedger` is the only thing that changes particle counts, and only through `transfer` / `transferVector`.
- A save is written only by `ConserveSession` (throttled, flush, close) and by `openConserveSession`: a new world, or a repaired or migrated one written back.
- An unreadable save, or one from a newer build, is never overwritten automatically. Only an explicit "new world" on the setup screen replaces it.

## Tests

| Script | Covers |
|---|---|
| `test:ledger` | Kinds and vectors, genesis, every refusal, 10⁵ random operations conserve, state round trip |
| `test:save` | New save, round trip, game-store key, migrations, validation, reconcile, throttled writer, sessions (new / continue / repaired / annihilated / unreadable / missing), setup peek |
| `test:loading` | The 「世界存档」 step: order, done / error states, dive gate, site-table line, zh and en strings; the bounded region map |
| `test:world` | Site table: biome vocabulary = terrain regions, hashes, largest remainder, split, δ monotone and clamped, region draw monotone in R, determinism, Σ = R, frozen π = 0, edge factor; terrain layout: centred, region field and density (δ term exact, free dive untouched far outside), spawn on an inner site, hard edge; δ-term cost ≤ 2 % per column |
| `test:modes` | Mode setting, setup start plan, bundle separation, module boundaries, file size |
| `test:free-baseline` | Free-dive terrain bit-exact against the fixture recorded before the conserve work |
| `test:wasm`, `test:bricks`, `test:streaming` | Bounded world: δ term JS = WASM bit-exact; conservative bounds contain the density with δ (10⁵ points, half on wall-adjacent sites), bricks = dense on edge columns; no request outside the world, free request sequence unchanged |

## Adding to this mode (later milestones)

- New tunables go in `config.ts`.
- New pure rules get their own folder, like `world/`, `chaos/`, `tide/`, `base/` from the plan, each with a node test.
- A new save field means `SAVE_VERSION + 1`, plus a migration in `save/migrations.ts` and a validation rule.
- Shared code that needs conserve behaviour gets it through `index.ts` via the loader. It never imports from here directly.
