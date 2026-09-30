# conserve/ — 深潜·守恒 (conservation mode)

The conserved world: a bounded 10 × 10 sea whose particles are counted, locked and returned, never created or destroyed. Design: `深潜-粒子守恒设计稿` v0.5. Build order: `深潜-MVP开发计划` (M1 … M9).

This folder is its **own bundle chunk**. The shared game (free dive, terrain, rendering, UI) reaches it only through `modes/conserveLoader.ts`, a single dynamic `import("../conserve")`, plus type-only imports. The free dive never downloads or runs any of it. `npm run test:modes` checks this on the real module graph with an esbuild metafile.

## Module map

| Folder | Responsibility | May import |
|---|---|---|
| `config.ts` | Every tunable of the mode: genesis totals, lander cargo, world size, save slot and throttle, repair order; biomes (order, frequency, signature particle), affinity matrix A, site-table constants (γ, allocation jitter, edge factor, β, δmax), in-site split; the wall model (`WALL`: 160 / 24 m, m_full 0.95, m_break 0.78); M4: node sizes (`NODES`: 20 … 80, mean 50, ≤ 64 per site), each kind's preferred surface (`NODE_SURFACE`), the tank (`TANK`: 200, a node empties in 2 s, a cache at 100 / s), `CACHES.max` 5; M5: the four buildings (`STRUCTURES`: cost, footprint, energy, storage, radius bonus, lighthouse fuel) and the base rules (`BASE`: radius 48 → 120, grid 60 m, gap 2 m, wall clearance 600 m, ≤ 40 buildings, frozen 3 × 3, brown-out order and restart, tide stub 150 energy / 1 departure) | types only |
| `particles/` | The 7 particle kinds, in fixed storage order, and particle count vectors | – |
| `ledger/` | `ParticleLedger`: the five pools W · P · B · S · L and strict conservation (Σ pools = N_k after every operation). Transfers are validated in full, all-or-nothing, and emit events | `particles/` |
| `world/` | World rules on top of the ledger. Genesis (all particles in the world, lander cargo already in the base). M2: the generation's allocation input R = N − P − B (`allocInput.ts`) and the **site table** (`siteTable.ts`): per-site hashes (`siteHash.ts`), region draw (`regionDraw.ts`), largest-remainder allocation (`allocate.ts`), in-site split (`siteSplit.ts`), rock → terrain bias δ (`terrainBias.ts`), summary (`siteSummary.ts`) | `ledger/`, `particles/`, `config` |
| `chaos/` | M3: the ring wall's model (`wallModel.ts`, design doc §4.1): m = Σ R / Σ N, σ = clamp((m − 0.78) / 0.17), T = 24 + 136 · smoothstep(σ) → `WallState` { m, σ, thickness, cracks } (cracks: M6) | `particles/`, `config` |
| `nodes/` | M4: the generation's resource nodes. `nodeTable.ts` splits each site's node share (the site table's `split.nodes`) into nodes of 20 … 80 particles (id = site · 64 + ordinal, a uint32 hash for the terrain's surface search); `nodeState.ts` = particles left per node, saved as a harvested bitset (`bitset.ts`, own base64) + partial counts | `world/`, `particles/`, `config` |
| `expedition/` | M4: `Expedition` implements `ExpeditionPort` (`port.ts`, the scene's type-only view): absorb a node (W → P), the tank limit, death = everything carried becomes a lost cache (P → L; the oldest of 6 → S), retrieve a cache (L → P). `flow.ts` meters whole particles per frame, `caches.ts` the cache list rules | `ledger/`, `nodes/`, `particles/`, `config`; types from `save/` |
| `base/` | M5: `Base` implements `BasePort` (`port.ts`, the scene's type-only view): founding the core (pays its cost, moves the frozen 3 × 3's rock W → B), build / demolish (full refund), storage moves (`storage.ts`: deposit P → B up to the capacity, withdraw B → P up to the tank, 放流 B → S unlimited, death in the base P → B), energy and lighthouse fuel (`energy.ts`, brown-out with hysteresis; burnt lumen B → S), the 2D placement rules (`placementRules.ts`), the frozen area (`frozen.ts`), the tide stub (`tide.ts`: readiness + forecast m / thickness), the saved state and derived numbers (`baseState.ts`, `baseView.ts`) | `ledger/`, `world/`, `particles/`, `config` |
| `save/` | Save format v4 (`schema.ts`: v3 + `generation.dives` + `base`); new save; migrations (`migrate.ts` runs `migrations.ts`: 1 → 2 → 3 → 4); `validateBase.ts`; `reconcileBase.ts` (B must equal the base's locked particles; the ledger wins, repair cause "base"); structural validation; `reconcile.ts` (the totals win, differences go to the suspended pool); `reconcileCaches.ts` (caches must equal pool L; the difference goes L ↔ S, repair cause "caches"); slot read/write (`saveRepository.ts`); throttled writer (injected clock) | `ledger/`, `world/`, `particles/`, `config` |
| `session/` | A world opened for a dive (`ConserveSession`): continue or create, repair on load, read-only annihilated worlds (D14), dive count, throttled and on-close writes, the generation's site table (built once from the save), ring wall (`session.wall`), node table and expedition (`session.expedition`; a death writes at once), the base (`session.base`; a building / storage change writes at once, energy ticks throttled; departures → `generation.dives`). Setup peek (`peekSlot.ts`) | `save/`, `ledger/`, `world/`, `chaos/`, `nodes/`, `expedition/`, `config` |
| `platform/` | The only browser/storage glue: `gameStoreBackend.ts` (platform game-store, key `deep-march/save/<slot>`), `pageLifecycle.ts` (flush on page hide). Adapter to the terrain: `terrainLayout.ts` (site table + wall → `terrain/siteLayout` data incl. `wall` { thickness, cracks }, type-only import) | `lib/game-store`, `settings`; types from `terrain/` |
| `loading/` | The loading-registry step 「世界存档」, which shows the open report (incl. the wall line 「界壁厚 160 米 · 稳固」) | types from `ui/loading/steps` |
| `index.ts` | Public API of the chunk | everything above |

Rules, checked by `test:modes`:
- `particles`, `ledger`, `world`, `chaos`, `nodes`, `expedition`, `base`, `save` and `session` are pure logic. They import nothing outside `conserve/` and never touch the DOM, storage or rendering.
- No conserve file imports `three`, `react` or `scene/`. Rendering for later milestones lives in the shared scene code and reads conserve state through its API.
- No conserve file is longer than 200 lines.

## Data flow (M1 – M5)

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
    session.wall      = wallStateOf(generation.allocInput, totals)        (genesis: m 0.993 → 160 m)
       → terrainLayoutOf(table, wall) ─→ createDeepMarch({ seed, world: layout })
            density: raw += Σ_i w_i δ_i · (bounds widened by the δ range)
                     raw  = Wall(raw) near the outline (terrain/wallDensity.ts): faceted inner face
                            (fixed), solid through T, chaos void beyond — nothing sticks out
            regions: the 10 × 10 sites from the layout, seeded pseudo-sites outside
            material: 7th weight = the wall (palettes 12 / 13 「界壁」, scene/materialCatalog.ts)
            chunks: no column wholly outside the world; the diver meets the wall's rock
                    (the 2 m hard edge stays as a backstop)
            far ring: scene/wallRing.ts — 996-triangle proxy of the face beyond the view
                      distance, drawn only in sonar, lit by long pulses (scene/sonarLong.ts)
            spawn: an inner site (never wall-adjacent); loading map: the whole 10 × 10 world
  loading done → session.recordDiveStart()      (throttled write, 30 s)
  page hidden → session.flush();  leave dive → session.close() (final write)
```

### M4: nodes, tank, lost caches

```
session.nodeTable  = buildNodeTable(siteTable)        (per site: split.nodes → nodes of 20 … 80)
session.expedition = new Expedition({ ledger, NodeState.fromSave(table, generation), caches })
  → useConserveDive → createDeepMarch({ …, expedition })        (the free dive passes null)
      scene/expedition/expeditionScene.ts
        placement.ts   sites within 420 m, nearest first, time-sliced (2.5 / 1.5 ms per frame);
                       each node on a deterministic surface anchor (terrain/surfaceAnchor.ts, seeded
                       by its hash: same spot on every device, in any visiting order)
        nodeView.ts    caches + nearest nodes within 170 m → one InstancedMesh (≤ 96, 87 tris each),
                       shrinking into the rock over the last 50 m (no LOD, no popping)
        interaction.ts aim with the view / lamp → the target lights up → hold E / left mouse /
                       「吸取」: port.absorb (W → P) or port.retrieve (L → P); battery drain 0.5 / s;
                       blocked when the tank is full or the battery is flat
        recall.ts      hold X / ⟲ 2 s → black → port.loseCarried at the nearest open water
                       (terrain/openWater.ts, P → L) → back to the entry point, battery full
        beacon.ts      every lost cache flashes and ticks (sonar clip, by distance) every 5 s
        survival       resource "tank" (capacity 200) mirrors pool P for the HUD
      HUD: ui/expedition (tank gauge, aim prompt, compass cache marks, recall button, 「吸取」 fan
           button); loading map: cache dots
  save: generation.harvested (bitset) + partial [[id, left]] + caches [{ id, pos, gen, contents }]
```

### M5: the base

```
session.base = new Base({ ledger, save: save.base, table: siteTable, gen, dives: generation.dives, totals })
  → useConserveDive → createDeepMarch({ …, expedition, base })          (the free dive passes null)
      scene/base/baseScene.ts
        buildMode.ts   G / 「建造」 → aim at the seabed → terrain/groundProbe.ts (slope 22° core / 15°,
                       roughness, skirt, clearance, region blend) + port.check (2D rules) + for the core
                       terrain/frozenZone.ts (the frozen 3 × 3 must not move the terrain) → hologram
                       green / red → E / click / 「放置」 → port.found / port.build
        found          core cost from storage first, then the tank (P → B); the frozen sites'
                       terrain rock W → B (clamped to W); energy starts at 100
        storage        「基地」 panel (Q): deposit P → B (capacity), withdraw B → P (tank room),
                       放流 B → S (any amount); demolish = full refund into storage
        energy         port.tick(dt): core +0.25 / s, lighthouses −0.3 / s and 1 lumen / 60 s
                       (B → S); brown-out switches lighthouses off until energy > 10
        departures     leaving the protection radius (+ 6 m hysteresis) → generation.dives + 1
                       (before the core: every lander dive counts); the tide stub needs ≥ 1
        recall / death inside the radius → port.depositOnDeath (P → B, capacity ignored);
                       outside → lost cache as in M4; the diver wakes at the core (scene/base/home.ts)
        docking        within 18 m of an energy tower while the base has energy: battery +5 % / s
        lighthouse     lights 80 m of terrain and buildings (2 nearest lit, uniform branch in the
                       seabed shader) + an instanced beam column and sweep
      HUD: ui/base (build bar, base panel, energy chip, home mark on the compass, fan 「建造」 /
           「放置」, 「基地」 button)
  save v4: base { foundedGen, center, frozen, frozenLocked, structures, storage, energy, brownout },
           generation.dives
```

Base-locked particles (design doc §8.1): B = free storage + Σ built costs + the frozen zone's rock. `lockedOf(base)` computes it, the ledger checks and `reconcileBase` hold it after every step and on load. Before founding B is the lander cargo and that is the storage.

Conservation: every particle moves through `ParticleLedger.transfer`, so Σ W + P + B + S + L = N after every frame. The node state and the caches are derived views that are saved with the ledger. On load, `reconcileCaches` makes the caches equal pool L. A node that cannot be anchored is simply not drawn, and its particles stay in W.

The terrain side (`terrain/siteLayout.ts`, `regions.ts`, `density.ts`, `wallGeometry.ts`, `wallDensity.ts`, `wallRing.ts`, `chunks.ts`, `spawn.ts`, `scene/diver.ts`, `scene/wallRing.ts`, `ui/loading/regionMap.ts`) knows only the mode-agnostic "explicit finite site layout" — plain typed arrays, sent to the mesher workers in `init`. Without a layout every new term is an identity, so the free dive stays bit-exact (`test:free-baseline`, and `test:streaming` checks the free request sequence).

Site table (design doc §3.2, §3.3, §5.2), a pure function of (seed, gen, R, frozen):
- region: P(r) ∝ weight_r · (R_sig / N_sig)^γ (kinds absent from the world leave the factor at 1);
- π_{i,k} = A[r_i][k] · (0.75 + 0.5 · hash) · e_i, e = 0.6 on the 36 wall-adjacent sites, frozen sites 0;
- a_{·,k} = largest remainder of R_k over π_{·,k} ⇒ Σ_i a_{i,k} = R_k exactly;
- split: rock 85 % terrain / 15 % nodes, lumen 55 % nodes / 45 % creatures, others 90 / 10;
- δ_i = clamp(β · ln(a_rock,i / ā_rock), ±δmax), ā_rock = (N_rock − lander cargo) / 100.
R is stored per generation (`generation.allocInput`), so the terrain never changes between two tides even as the ledger moves.

Ring wall (design doc §4.1, §4.4; M3). The thickness is a pure function of the generation's R and N (`chaos/wallModel.ts`); the terrain gets it as data (`SiteLayout.wall = { thickness, cracks }`, metres):
- inner face: the world rectangle with 400 m rounded corners, faceted (staggered lattice 96 × 40 m of planar triangles, 4 quantised offsets 4 … 34 m + an 8 m swell) — independent of T, so a thinning wall never moves toward the player;
- outer face at T beyond the outline; beyond it the chaos void (open between −20 and +44 m, sealed above and below);
- cracks { s, width, depth } carve jagged notches into the face (geometry only; M6 drives them and the thickness through the layout);
- the term is an exact identity more than ~107 m inside the outline (`skipSd`), so the rest of the world is bit-identical to M2, and it is skipped per sample where it cannot change the value; where the wall alone fixes the value, `rawClass` returns it exactly (no terrain noise);
- shape tunables: `terrain/wallConfig.ts`; far ring tunables: `scene/wallRing.ts` (`WALL_RING`), long pulses: `scene/sonarLong.ts`.

Invariants:
- `ParticleLedger` is the only thing that changes particle counts, and only through `transfer` / `transferVector`.
- A save is written only by `ConserveSession` (throttled, flush, close) and by `openConserveSession`: a new world, or a repaired or migrated one written back.
- An unreadable save, or one from a newer build, is never overwritten automatically. Only an explicit "new world" on the setup screen replaces it.

## Tests

| Script | Covers |
|---|---|
| `test:ledger` | Kinds and vectors, genesis, every refusal, 10⁵ random operations conserve, state round trip; the expedition (absorb, tank limit, loss, eviction, retrieval) conserves; the base (founding with the frozen rock, build, demolish refund, deposit / withdraw limits, 放流, death in the base, fuel burn, random base steps) keeps B = lockedOf(base) |
| `test:save` | New save, round trip, game-store key, migrations (incl. v2 → v3 → v4), base validation and reconcile, base round trip through the session, validation, reconcile, cache reconcile, throttled writer, sessions (new / continue / repaired / annihilated / unreadable / missing, expedition round trip), setup peek |
| `test:nodes` | Node table (Σ = the site's node share, sizes, ids, determinism), node state and bitset codec; placement on the terrain (deterministic in any order, on the surface, surface rules, in disc / region / world, spacing, attempt cost), open water for caches; the draw (one InstancedMesh, ≤ 10k triangles, busiest spot of whole genesis worlds within the instance cap, selection and prefetch radii: no popping); absorbing, blocks, battery drain, recall timing, loss and retrieval (Σ = N every frame), beacon timing and gain |
| `test:loading` | The 「世界存档」 step: order, done / error states, dive gate, site-table and ring-wall lines, zh and en strings; the bounded region map |
| `test:world` | Site table: biome vocabulary = terrain regions, hashes, largest remainder, split, δ monotone and clamped, region draw monotone in R, determinism, Σ = R, frozen π = 0, edge factor; terrain layout: centred, region field and density (δ term exact, free dive untouched far outside), spawn on an inner site, hard edge; δ-term cost ≤ 2 % per column |
| `test:modes` | Mode setting, setup start plan, bundle separation, module boundaries, file size |
| `test:free-baseline` | Free-dive terrain bit-exact against the fixture recorded before the conserve work |
| `test:wall` | Wall model (monotone, 160 / 24 m, stage table, genesis 160 m); geometry (locate / point, arc length, facets C0 / periodic / in range, cracks); density (inner face independent of T, solid through T, void beyond, exact identity past skipSd, rawClass and bounds); diver stopped by the rock; meshes LOD 0–3 (nothing past the outline, face within ¼ cell of level 0: no popping), wall material weight; far ring (≤ 2.2k triangles, one draw, on the facets, starts at the far plane); cost (non-wall columns identical and ≤ +2 %, wall columns ≤ +10 %, world ≤ +4 %) — run alone |
| `test:wasm`, `test:bricks`, `test:streaming` | Bounded world (genesis wall, ±δmax, a thin cracked wall): δ and wall terms JS = WASM bit-exact; conservative bounds contain the density (1.5·10⁵ points, half near the edge / in the wall), bricks = dense on edge and wall columns; no request outside the world, free request sequence unchanged |
| `test:frozen` | Frozen zone: the 3 × 3 keeps its terrain (density identical across generations at the frozen sites), the frozen check's margin (valid share over 100 seeds), frozen share ≈ 6 % of N, negative control |
| `test:placement` | 2D rules both ways (incl. rounded wall corners), ground rules on synthetic fields and the real terrain, base energy, the base's draw calls (≤ 8) and triangles (≤ 60k for 40 buildings) |
| `test:shaders`, `test:materials` | The wall's material slot (palettes 12 / 13) in the seabed programs; the far ring's and the node material's programs (glslang ES, no samplers) and their Mali-G57 budgets (nodes: arith ≤ 20, LS ≤ 8, no textures); M5: the building, beam and hologram programs (buildings: arith ≤ 24, LS ≤ 14, no textures; overlays arith ≤ 4) and the seabed budget with the lighthouse light |

## Adding to this mode (later milestones)

- New tunables go in `config.ts`.
- New pure rules get their own folder, like `world/`, `chaos/`, `tide/`, `base/` from the plan, each with a node test.
- A new save field means `SAVE_VERSION + 1`, plus a migration in `save/migrations.ts` and a validation rule.
- Shared code that needs conserve behaviour gets it through `index.ts` via the loader. It never imports from here directly.

## Follow-ups (recorded at acceptance)

- **Streaming must widen by the wall thickness T once cracks go through** (M3 deviation #5, recorded when M3 was accepted; owner M6 / M8). `terrain/chunks.ts` clips every column to the world rectangle (`rectOverlaps(this.worldRect, …)`), so the chaos void beyond the wall is never meshed. That is invisible while the wall is never breached (M3), but before a crack can show the void (a through crack, or M8's membrane notch), the streaming rectangle has to grow by T (+ one column of margin), only on the cracked side and only near the crack. Without cracks the request sequence must stay bit-identical (`test:streaming`), and the extra columns must keep the conservative bounds (`test:bricks`). M6's `chaos/cracks.ts` has to put "goes through" and the crack's arc-length span into `SiteLayout.wall.cracks` for the chunk manager to use. Also recorded in the plan doc, section 5 「跟进事项」.
- **Frozen sites take effect from the next generation** (M5 deviation). Founding moves the frozen 3 × 3's rock into B at once, but the current generation's site table was built before the founding, so the terrain there is already the current generation's. `ConserveSession` applies `base.frozen` to the site table only when `base.foundedGen < gen` (π = 0 on frozen sites from the next tide on). The frozen-zone check (`terrain/frozenZone.ts`) makes sure the next generation's region redraw cannot move the terrain under the core. M7's tide must build the next table with the frozen sites.
