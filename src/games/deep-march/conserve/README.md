# conserve/ — 深潜·守恒 (conservation mode)

The conserved world: a bounded 10 × 10 sea whose particles are counted, locked and returned, never created or destroyed. Design: `深潜-粒子守恒设计稿` v0.5. Build order: `深潜-MVP开发计划` (M1 … M9).

This folder is its **own bundle chunk**. The shared game (free dive, terrain, rendering, UI) reaches it only through `modes/conserveLoader.ts`, a single dynamic `import("../conserve")`, plus type-only imports. The free dive never downloads or runs any of it. `npm run test:modes` checks this on the real module graph with an esbuild metafile.

## Module map

| Folder | Responsibility | May import |
|---|---|---|
| `config.ts` | Every tunable of the mode: genesis totals, lander cargo, world size, save slot and throttle, repair order | types only |
| `particles/` | The 7 particle kinds, in fixed storage order, and particle count vectors | – |
| `ledger/` | `ParticleLedger`: the five pools W · P · B · S · L and strict conservation (Σ pools = N_k after every operation). Transfers are validated in full, all-or-nothing, and emit events | `particles/` |
| `world/` | World rules on top of the ledger. M1: genesis (all particles in the world, lander cargo already in the base) | `ledger/`, `particles/`, `config` |
| `save/` | Save format v1 (`schema.ts`); new save; migrations (`migrate.ts`); structural validation; `reconcile.ts` (the totals win, differences go to the suspended pool); slot read/write (`saveRepository.ts`); throttled writer (injected clock) | `ledger/`, `world/`, `particles/`, `config` |
| `session/` | A world opened for a dive (`ConserveSession`): continue or create, repair on load, read-only annihilated worlds (D14), dive count, throttled and on-close writes. Setup peek (`peekSlot.ts`) | `save/`, `ledger/`, `config` |
| `platform/` | The only browser/storage glue: `gameStoreBackend.ts` (platform game-store, key `deep-march/save/<slot>`), `pageLifecycle.ts` (flush on page hide) | `lib/game-store`, `settings` |
| `loading/` | The loading-registry step 「世界存档」, which shows the open report | types from `ui/loading/steps` |
| `index.ts` | Public API of the chunk | everything above |

Rules, checked by `test:modes`:
- `particles`, `ledger`, `world`, `save` and `session` are pure logic. They import nothing outside `conserve/` and never touch the DOM, storage or rendering.
- No conserve file imports `three`, `react` or `scene/`. Rendering for later milestones lives in the shared scene code and reads conserve state through its API.
- No conserve file is longer than 200 lines.

## Data flow (M1)

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
  → session.seedText ─→ createDeepMarch(seed)   (M1: the free-dive terrain; the bounded world comes in M2)
  loading done → session.recordDiveStart()      (throttled write, 30 s)
  page hidden → session.flush();  leave dive → session.close() (final write)
```

Invariants:
- `ParticleLedger` is the only thing that changes particle counts, and only through `transfer` / `transferVector`.
- A save is written only by `ConserveSession` (throttled, flush, close) and by `openConserveSession`: a new world, or a repaired or migrated one written back.
- An unreadable save, or one from a newer build, is never overwritten automatically. Only an explicit "new world" on the setup screen replaces it.

## Tests

| Script | Covers |
|---|---|
| `test:ledger` | Kinds and vectors, genesis, every refusal, 10⁵ random operations conserve, state round trip |
| `test:save` | New save, round trip, game-store key, migrations, validation, reconcile, throttled writer, sessions (new / continue / repaired / annihilated / unreadable / missing), setup peek |
| `test:loading` | The 「世界存档」 step: order, done / error states, dive gate, zh and en strings |
| `test:modes` | Mode setting, setup start plan, bundle separation, module boundaries, file size |
| `test:free-baseline` | Free-dive terrain bit-exact against the fixture recorded before the conserve work |

## Adding to this mode (later milestones)

- New tunables go in `config.ts`.
- New pure rules get their own folder, like `world/`, `chaos/`, `tide/`, `base/` from the plan, each with a node test.
- A new save field means `SAVE_VERSION + 1`, plus a migration in `save/migrate.ts` and a validation rule.
- Shared code that needs conserve behaviour gets it through `index.ts` via the loader. It never imports from here directly.
