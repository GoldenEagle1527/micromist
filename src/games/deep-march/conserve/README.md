# conserve/ — 深潜·守恒 (conservation mode)

The conserved world: a bounded 10 × 10 sea whose particles are counted, locked and returned, never created or destroyed. Design: `深潜-粒子守恒设计稿` v0.5. Build order: `深潜-MVP开发计划` (M1 … M9).

This folder is its **own bundle chunk**. The shared game (free dive, terrain, rendering, UI) reaches it only through `modes/conserveLoader.ts`, a single dynamic `import("../conserve")`, plus type-only imports. The free dive never downloads or runs any of it. `npm run test:modes` checks this on the real module graph with an esbuild metafile.

## Module map

| Folder | Responsibility | May import |
|---|---|---|
| `config.ts` | Every tunable of the mode: genesis totals, lander cargo, world size, save slot and throttle, repair order; biomes (order, frequency, signature particle), affinity matrix A, site-table constants (γ, allocation jitter, edge factor, β, δmax), in-site split; the wall model (`WALL`: 160 / 24 m, m_full 0.95, m_break 0.78); M4: node sizes (`NODES`: 20 … 80, mean 50, ≤ 64 per site), each kind's preferred surface (`NODE_SURFACE`), the tank (`TANK`: 200, a node empties in 2 s, a cache at 100 / s), `CACHES.max` 5; M5: the four buildings (`STRUCTURES`: cost, footprint, energy, storage, radius bonus, lighthouse fuel) and the base rules (`BASE`: radius 48 → 120, grid 60 m, gap 2 m, wall clearance 600 m, ≤ 40 buildings, frozen 3 × 3, brown-out order and restart, the tide's readiness 150 energy / 1 departure) | types only |
| `particles/` | The 7 particle kinds, in fixed storage order, and particle count vectors | – |
| `ledger/` | `ParticleLedger`: the five pools W · P · B · S · L and strict conservation (Σ pools = N_k after every operation). Transfers are validated in full, all-or-nothing, and emit events | `particles/` |
| `world/` | World rules on top of the ledger. Genesis (all particles in the world, lander cargo already in the base). M2: the generation's allocation input R = N − P − B (`allocInput.ts`) and the **site table** (`siteTable.ts`): per-site hashes (`siteHash.ts`), region draw (`regionDraw.ts`), largest-remainder allocation (`allocate.ts`), in-site split (`siteSplit.ts`), rock → terrain bias δ (`terrainBias.ts`), summary (`siteSummary.ts`) | `ledger/`, `particles/`, `config` |
| `chaos/` | M3: the ring wall's model (`wallModel.ts`, design doc §4.1): m = Σ R / Σ N, σ = clamp((m − 0.78) / 0.17), T = 24 + 136 · smoothstep(σ) → `WallState` { m, σ, thickness, cracks }. M6: the generation's chaos (`model.ts`: `ChaosState` { m, stage 0–5, wallThickness, cracks }, χ_g), the cracks (`cracks.ts`: size, through flag, arc extent, placement score and distance rules, open / heal / scar), the ring outline in metres (`ring.ts`), the tide's chaos (`tide.ts`: R' = N − P − B → next state) and the forecast (`forecast.ts`: exactly the tide's result). M8: the scene's view (`view.ts`: `ChaosView` — stage, χ_g, the position inside the stage's band, open cracks and scars as world points with tangent / outward normal, the outline's box) and the staging preview (`preview.ts`: stage 0 | 1 | 2, 1–2 cracks, optional scar, picked in the debug panel's 混沌预览 → a chaos state placed by the tide's own crack rules); tunables in `chaos/config.ts` (`CHAOS`, `CRACKS`, `BREACH`, `RING`) | `particles/`, `ledger/` (types), `world/` (hash, R'), `config` |
| `nodes/` | M4: the generation's resource nodes. `nodeTable.ts` splits each site's node share (the site table's `split.nodes`) into nodes of 20 … 80 particles (id = site · 64 + ordinal, a uint32 hash for the terrain's surface search); `nodeState.ts` = particles left per node, saved as a harvested bitset (`bitset.ts`, own base64) + partial counts | `world/`, `particles/`, `config` |
| `expedition/` | M4: `Expedition` implements `ExpeditionPort` (`port.ts`, the scene's type-only view): absorb a node (W → P), the tank limit, death = everything carried becomes a lost cache (P → L; the oldest of 6 → S), retrieve a cache (L → P). `flow.ts` meters whole particles per frame, `caches.ts` the cache list rules | `ledger/`, `nodes/`, `particles/`, `config`; types from `save/` |
| `base/` | M5: `Base` implements `BasePort` (`port.ts`, the scene's type-only view): founding the core (pays its cost, moves the frozen 3 × 3's rock W → B), build / demolish (full refund), storage moves (`storage.ts`: deposit P → B up to the capacity, withdraw B → P up to the tank, 放流 B → S unlimited, death in the base P → B), energy and lighthouse fuel (`energy.ts`, brown-out with hysteresis; burnt lumen B → S; M9: `switchStructure`, the lighthouse switch), the 2D placement rules (`placementRules.ts`), the frozen area (`frozen.ts`), the tide's gate (`tide.ts`: readiness + the forecast from `chaos/forecast.ts`, recomputed only when R' changes), the saved state and derived numbers (`baseState.ts`, `baseView.ts`) | `ledger/`, `world/`, `particles/`, `config` |
| `tide/` | M7: the tide (design doc §5.5, §5.6). `config.ts` (`TIDE`: 60 s warning + 30 s extension, the show's phases 吸气 5 · 剥离 8 · 洋流 8 · 凝聚 9 · 平息 5 s, switch at P4, murk 3 + ≥ 3 … 20 + 6 s, dome 5 m / 2 s, frame-time governor, low memory ≤ 2 GB); `machine.ts` (`TideMachine`: warning → show or murk → done, one-frame events precompute → commit → swap → done, every fallback), `governor.ts` (mean frame time over a window), `dome.ts` (inside / edge / outside, `DiverFate`: dissolve in 2 s, wake after the tide), `plan.ts` (at the call: R', the chaos = the forecast, gen + 1's site table with the frozen sites, the generation summary), `commit.ts` (W topped up to R' from L, then S; the rest of L to S; caches cleared; energy paid), `controller.ts` (`TideController`: the session's tide, locks absorbing / retrieving from the call to the end, dissolve P → S), `port.ts` (types the scene sees) | `ledger/`, `save/`, `world/`, `chaos/`, `base/` (types), `config` |
| `save/` | Save format v5 (`schema.ts`: v3 + `generation.dives` + `base` (v4) + `chaos` (v5)); new save; migrations (`migrate.ts` runs `migrations.ts`: 1 → 2 → 3 → 4 → 5; 4 → 5 derives the chaos from `generation.allocInput`, no cracks); `validateBase.ts`, `validateChaos.ts`; `reconcileBase.ts` (B must equal the base's locked particles; the ledger wins, repair cause "base"); structural validation; `reconcile.ts` (the totals win, differences go to the suspended pool); `reconcileCaches.ts` (caches must equal pool L; the difference goes L ↔ S, repair cause "caches"); slot read/write (`saveRepository.ts`); throttled writer (injected clock) | `ledger/`, `world/`, `particles/`, `config` |
| `session/` | A world opened for a dive (`ConserveSession`): continue or create, repair on load, read-only annihilated worlds (D14), dive count, throttled and on-close writes, the generation's site table (built once from the save), chaos (`session.chaos`, fixed until the tide) and ring wall (`session.wall`, from the chaos: T and the open cracks), node table and expedition (`session.expedition`; a death writes at once), the base (`session.base`; a building / storage change writes at once, energy ticks throttled; departures → `generation.dives`), the tide (`session.tide`; its commit replaces the generation in place and writes at once — `advance`). Setup peek (`peekSlot.ts`) | `save/`, `ledger/`, `world/`, `chaos/`, `nodes/`, `expedition/`, `base/`, `tide/`, `config` |
| `platform/` | The only browser/storage glue: `gameStoreBackend.ts` (platform game-store, key `deep-march/save/<slot>`), `pageLifecycle.ts` (flush on page hide). M8: `diveChaos.ts` (the dive's chaos: the generation's own, or the debug panel's preview — view + wall, never saved); `tidePort.ts` also gives gen + 1's `ChaosView` (`nextChaos`). Adapter to the terrain: `terrainLayout.ts` (site table + wall → `terrain/siteLayout` data incl. `wall` { thickness, cracks }, type-only import); `tidePort.ts` (the tide for the scene: the controller + gen + 1's layout, the timeline, the new generation's ports after the commit) | `lib/game-store`, `settings`; types from `terrain/` |
| `loading/` | The loading-registry step 「世界存档」, which shows the open report (incl. the wall line 「界壁厚 160 米 · 稳固」) | types from `ui/loading/steps` |
| `index.ts` | Public API of the chunk | everything above |

Rules, checked by `test:modes`:
- `particles`, `ledger`, `world`, `chaos`, `nodes`, `expedition`, `base`, `tide`, `save` and `session` are pure logic. They import nothing outside `conserve/` and never touch the DOM, storage or rendering.
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
    session.wall      = wallStateOfChaos(save.chaos)                       (genesis: m 0.993 → 160 m, no cracks)
       → terrainLayoutOf(table, wall) ─→ createDeepMarch({ seed, world: layout })
            density: raw += Σ_i w_i δ_i · (bounds widened by the δ range)
                     raw  = Wall(raw) near the outline (terrain/wallDensity.ts): faceted inner face
                            (fixed), solid through T, chaos void beyond — nothing sticks out
            regions: the 10 × 10 sites from the layout, seeded pseudo-sites outside
            material: 7th weight = the wall (palettes 12 / 13 「界壁」, scene/materialCatalog.ts)
            chunks: no column wholly outside the terrain extent (terrain/terrainExtent.ts:
                    the world grown by T, plus the cracks' reach); quadrants beyond it count
                    as covered, so edge columns keep the LOD hysteresis (no re-merge churn);
                    the diver meets the wall's rock (the 2 m hard edge stays as a backstop)
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
                       (before the core: every lander dive counts); 唤潮 needs ≥ 1
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

### M6: chaos core and the tide forecast

```
save.chaos { m, stage, wallThickness, cracks [{ j, s, mOpen, bornGen, width, depth, open, healed, through }] }
  — set at a tide (M7 calls chaos/tide.ts chaosAtTide), fixed for the whole generation
session.wall = wallStateOfChaos(chaos) → terrainLayoutOf → SiteLayout.wall { thickness, cracks: open ones
               { s, width, depth, through, extent [s0, s1] } } → density / wall geometry (M3 notches)
base panel 「唤潮」: port.forecast() = chaos/forecast.ts forecastTide(save.chaos, tideChaosInput(ledger now))
  → ui/base/TideForecastCard: m, wall, stage after the tide vs now; cracks opening / healing / open
  cracks (design doc §4.3): j opens when m < [0.90, 0.875, 0.855, 0.838, 0.825, 0.81][j]
    (main breach: m < 0.80 with ≥ 200 abyssal locked = stage 5); width 4 + 4 / 0.01 (≤ 60 m),
    depth 40 % + 10 % / 0.01 of T; through at full depth and ≥ 30 m; spot at the first opening:
    candidates every 32 m, 0.35 thinness + 0.35 harvested wall site + 0.15 toward the base + 0.15 hash,
    ≥ 600 m from the core, ≥ 500 m from other cracks / scars; heals at m ≥ mOpen + 0.01 (scar),
    reopens in place
```

### M7: the tide

```
唤潮 (base panel, at the base, energy ≥ 150, ≥ 1 departure) → TideController.call
  plan (tide/plan.ts): R' = W + S + L now (N − P − B), chaos = forecastTide (the card's numbers),
    gen + 1's site table (seed, gen + 1, R', base.frozen: the M5 follow-up) and summary
  absorbing / retrieving locked (R' stays available); 放流, fuel, deaths during the warning → S
P0 warning 60 s (+ up to 30 s while gen + 1 is not precomputed: 「潮在积蓄」)
  scene: gen + 1's columns stream on the same workers (terrain/poolRouter.ts), hidden
end of P0 → commit (tide/commit.ts) → session.advance: the save is gen + 1, written at once
  W := R' (from L, then S), L → S, caches [], generation reset, chaos = plan, energy − 150
  — then the show: closing the page from here on cold-starts in gen + 1; closing in P0 = still gen
show P1 吸气 0–5 · P2 剥离 5–13 · P3 洋流 13–21 · P4 凝聚 21–30 (terrain + collision switch at 21) · P5 平息 30–35
  or the murk 浊潮 (≈ 12 s: 3 s to black, switch in the dark, 6 s clearing) when:
  debug panel 简化潮汐 · deviceMemory ≤ 2 GB · not precomputed at +30 s · mean frame > 40 ms over the
  warning's last 8 s · > 66 ms over 2 s of the show before the switch · WebGL context lost
  (lost during the show: switch and end at once)
dome = the protection radius: within 5 m of its edge → warning; outside once the show / murk
  begins → particle-ized in 2 s: the tank P → gen + 1's S (no lost cache), black, wake at the
  core after the tide with the battery full. Σ = N every frame.
```

### M8: chaos stages 0–2 in the dive

```
dive start: diveChaosOf(session, location.search)
  → { view: ChaosView (stage, χ_g, open cracks, scars), wall }   (debug-panel preview: never saved)
  → world = terrainLayoutOf(siteTable, wall): open cracks cut notches (depth < T at stage 2)
  → scene: seabed program = chaos variant iff stage ≥ 1 or a scar (else the M7 programs)
           scene/chaos/chaosDirector.ts: veins, crack light, scars, lamp / fog / audio near cracks,
           ghost echoes, the omen — all from the view, fixed for the generation
tide: precompute → tidePort.nextChaos() = gen + 1's view → its terrain's program variant (warm compiled)
      swap → director.setView(gen + 1's view)
```

### M9: integration, onboarding, tuning

```
lighthouse switch (numeric review): core +0.25 / s, a lit lighthouse −0.3 / s → net −0.05 / s; the
  brown-out restarts at 10, so with one lit lighthouse the energy never reaches the tide's 150.
  base panel 「开启 / 关闭」 per consumer → port.setOn → energy.ts switchStructure (saved as
  structure.on; switched off: no energy, no fuel); the tide card's advice: capacity < 150 → build an
  energy tower, falling → switch the lighthouses off, rising → minutes to 150, no departure → dive
diagnostics: the 「世界存档」 step's drawer adds chaos (stage · open cracks · healed scars)
new-player hints (ui/hints, game-store key `hints`): 采集 → 建核心 → 存入 → 唤潮 → 放流, one
  small dismissible card at a time, never during a tide / recall / the base panel; setup toggle
strings: every zh / en entry and function checked (test:i18n)
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
| `test:placement` | 2D rules both ways (incl. rounded wall corners), ground rules on synthetic fields and the real terrain, base energy, the base's draw calls (≤ 8) and triangles (≤ 60k for 40 buildings); M9: the lighthouse switch (lit: stuck near the restart level, never 150; off: 150 reached; saved, refused for non-consumers) |
| `test:chaos` | M6: ring outline = the terrain's; M counts W, S, L (not P, B), base fuel raises m; stage / thickness monotone, χ_g, stage 5; crack size and through flag; spots deterministic, ≥ 600 m from the base, ≥ 500 m apart (60 random worlds), drawn to the harvested wall and toward the base; open / heal (+0.01) / scar / reopen in place, fixed across tides, previous state untouched; forecast ≡ tide bit for bit; a generation's chaos fixed while the ledger moves, forecasting moves nothing; save v5 (genesis, v4 → v5, validation, round trip); SiteLayout.wall crack data; a through crack's notch passes the outer face |
| `test:chaos` (M8 part) | the view on the ring (outward normals), the preview (parse, deterministic, stage 1 no cracks, stage 2 one / two impassable cracks, scars, never touches the session), a stage-2 crack is rock up to the outer face; effects (stage 0 zero, χ_l, lamp ≤ 3 Hz and ≥ 60 %, calm, fog hue), ghosts, omen rules, the director (stage 0 touches nothing) |
| `test:tide` | M7: timeline (35 s, phase starts), state machine (commit in the step that ends the warning — before any show frame; swap at P4; events once, in order; extension; timeout → murk ≈ 12 s; simple / low memory; the governor both ways; context lost in the warning / the show), governor, dome rules; through the session: plan = forecast, lock, gen + 1 on disk before the show, W = R', L = 0, Σ = N, 放流 in the warning waits in S, caches returned, energy paid, the frozen 9 sites in the new table, cold start mid-show = gen + 1, closed in the warning = gen, particle-ization P → S (no cache), wake, edge warning, determinism, the next tide needs a departure; frozen 3 × 3 density bit-exact (10⁴ probes, two seeds) with a negative control; double-buffered streaming on one pool (router ids / losses / dropGen, peak ≤ 2.1 × baseline, back to the baseline after the switch, precompute estimate, front draw classes) |
| `test:economy` | M6 tuning guard (pure projection): m ≈ 0.934 after founding; 7–8 dives × 200 locked per generation → first crack in the gen 3 → 4 tide (average world; ±1 generation per seed); 1.1 % → gen 4 → 5; release needed to heal it |
| `test:hints` | M9: the hint sequence (order, the core gate, returning players, busy, dismiss, off / on again, stored progress), telemetry → observation, the tide advice |
| `test:i18n` | M9: zh / en dictionaries — same keys and kinds, nothing empty, same arity, every function called with fixtures (no undefined / NaN), each language in its own script |
| `test:shaders`, `test:materials` | The wall's material slot (palettes 12 / 13) in the seabed programs; the far ring's and the node material's programs (glslang ES, no samplers) and their Mali-G57 budgets (nodes: arith ≤ 20, LS ≤ 8, no textures); M5: the building, beam and hologram programs (buildings: arith ≤ 24, LS ≤ 14, no textures; overlays arith ≤ 4) and the seabed budget with the lighthouse light |

## Adding to this mode (later milestones)

- New tunables go in `config.ts`.
- New pure rules get their own folder, like `world/`, `chaos/`, `tide/`, `base/` from the plan, each with a node test.
- A new save field means `SAVE_VERSION + 1`, plus a migration in `save/migrations.ts` and a validation rule.
- Shared code that needs conserve behaviour gets it through `index.ts` via the loader. It never imports from here directly.

## Follow-ups (recorded at acceptance)

- **Streaming must widen by the wall thickness T once cracks go through** (M3 deviation #5, recorded when M3 was accepted; owner M6 / M8). `terrain/chunks.ts` clips every column to the world rectangle (`rectOverlaps(this.worldRect, …)`), so the chaos void beyond the wall is never meshed. That is invisible while the wall is never breached (M3), but before a crack can show the void (a through crack, or M8's membrane notch), the streaming rectangle has to grow by T (+ one column of margin), only on the cracked side and only near the crack. Without cracks the request sequence must stay bit-identical (`test:streaming`), and the extra columns must keep the conservative bounds (`test:bricks`). M6's `chaos/cracks.ts` has to put "goes through" and the crack's arc-length span into `SiteLayout.wall.cracks` for the chunk manager to use. Also recorded in the plan doc, section 5 「跟进事项」. **M6: the data part is done** (`through`, `extent` on every open crack in `SiteLayout.wall.cracks`; the terrain's jag widens the span by up to `WALL_SHAPE.crackJag` · width a side); the streaming change itself is left to M8 (no crack can go through before m ≈ 0.835, about generation 8). **M7: still left to M8** (the tide's double buffer came first; the widening belongs with M8's membrane notch). **Done in M8**: `terrain/crackReach.ts` gives each open crack a rectangle from the outline out to T (through) or its depth (stage 2), plus one column; `chunks.ts` streams mesh columns overlapping it (info columns unchanged). Without cracks the request sequence is M7's bit for bit (`test:streaming` hash); with one, the only extra requests lie in its rectangle. **Boundary LOD fix (after the MVP)**: the streaming set and the LOD coverage test now share one predicate, the terrain extent (`terrain/terrainExtent.ts`: the world rectangle grown by T, plus the cracks' rectangles) — the clipped-but-awaited quadrants had made every edge column re-merge and split forever. The crack-free sequence was re-recorded (`8b9eec13`; M7's carried that churn); `test:streaming` holds the diver still at the sides, corners and in front of cracks and asserts no crossfade and no request after convergence. **Phone view-reach fix (same day)**: on the phone preset (230 m view) a top-level column split within 128 m could have a quadrant beyond the view, never built, and looped the same way anywhere (free dive too); `chunks.ts` now splits a column only when all its children with terrain are within the view (`childrenInView`). Fixtures re-recorded: free dive phone `d30cab2b` / 137 (desktop unchanged), crack-free bounded `a79fa85e` / 62; the still checks run on both presets plus five free-dive phone spots.
- **Frozen sites take effect from the next generation** (M5 deviation). Founding moves the frozen 3 × 3's rock into B at once, but the current generation's site table was built before the founding, so the terrain there is already the current generation's. `ConserveSession` applies `base.frozen` to the site table only when `base.foundedGen < gen` (π = 0 on frozen sites from the next tide on). The frozen-zone check (`terrain/frozenZone.ts`) makes sure the next generation's region redraw cannot move the terrain under the core. M7's tide must build the next table with the frozen sites. **Done in M7**: `tide/plan.ts` builds gen + 1's table with `base.frozen` (`test:tide` checks the 9 sites and the density bit for bit).

## Open after the MVP (M9)

Deviations from the design doc that the MVP ships with; the full list with owners is in the plan doc's 「跟进事项」:

- Chaos stages 3–5 reuse stage 2's look: no chaos shell outside the wall, no chaos plankton, no distorted creatures (畸变萤群).
- The tide show has no 2 km sonar pulse and no particle-flow effect (G10); `scene/diver.ts` keeps its world-edge behaviour (`diver.edge`) as in M3.
- Streaming widens for every open crack (not only through-cracks); the veins are a per-fragment term (no per-vertex mask); the omen is drawn in the sonar pass only and can be occluded by terrain; the tide front uses the non-chaos material; the wet audio path stays connected at gain 0.
- No lighthouse reactor: the base's only producer is the core, hence the lighthouse switch (M9).
- Legacy files over the 200-line limit (terrain chunks / mesher / density / bricks / terrainInfo, audio, diver, world, the main i18n, the loading screen) and long MVP test files are left as they are; `scene/materialCatalog.ts` `SLOT_NAMES` is kept for the legacy slot order.
