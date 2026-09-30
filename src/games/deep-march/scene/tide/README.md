# scene/tide — the tide in the dive (plan M7)

The rules (timeline, save order, fallbacks, the dome, the ledger) are `conserve/tide/`; this folder draws them and moves the dive to gen + 1. Built only in conserve worlds with a tide port (`dive/tideWiring.ts`); the free dive never loads it.

| File | What |
|---|---|
| `tideDirector.ts` | Per frame: steps the tide (frame time → governor, context loss, gen + 1 readiness) and carries out its events: precompute → `NextTerrain`; commit → a new conserve layer on the new ports (nodes hidden, no LOD crossfades); swap → terrain, collision (`DiverController.setField`), HUD lookups, wall ring to gen + 1, old columns freed; done → normal streaming, 12 s summary. Telemetry for the HUD |
| `nextTerrain.ts` | gen + 1's field and a second `ChunkManager` on the same workers (`terrain/poolRouter.ts`, `addGen` / `dropGen`), hidden; ready = view covered and settled |
| `tideVisuals.ts` | The look per frame: front, dome, particles, burst, veil, sounds |
| `frontSchedule.ts` | Pure: the front radius per phase (P2 in from beyond the view to the dome, P3 the dome, P4 back out) and a column's zone (in / band / out) |
| `terrainFront.ts` | Applies the front after occlusion: plain material inside, the seabed's tide variant across the band (the LOD crossfade's 2 × 2 screen door keyed by distance, glowing edge — `tideFrontShader.ts`), culled layer beyond |
| `domeMesh.ts`, `domeShader.ts` | The dome: 552-triangle cap of the protection radius, additive fresnel, brighter in front of a diver near the edge |
| `tideParticles.ts`, `tideParticleShader.ts` | One `THREE.Points` draw: phone 3k / desktop 12k current particles + 500 for the particle-ization burst; born where P2's front passes, vortex with a wobble, land where P4's front passes — all in the vertex shader |
| `tideCues.ts` | Bells in the warning (faster outside the dome), P1's long pulse, P3's pulses every 2.5 s, P4's chord — existing clips pitched (silent without the sound pack) |
| `telemetry.ts` | `TideTelemetry` (types only) |
| `config.ts` | `TIDE_VIEW`: front band and glow, dome, particle counts / size / fade, veil visibilities, summary time |

Budgets (`test:shaders`, `test:tide`): tide-front program within the seabed's Mali budget and discarding before shading; dome and particle programs arith ≤ 6, no textures; dome ≤ 1k triangles; only one terrain set is ever drawn (next hidden until the switch, the old one freed at it), the front's dither band a ring of columns; resident columns ≤ 2.1 × baseline while both sets exist.

Controls: 唤潮 in the base panel (Q / 基地 button) at the base. During the show you can swim and look freely inside the dome; build mode and recall are off.
