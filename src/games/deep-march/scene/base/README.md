# scene/base — the conserve base in the dive (plan M5)

Buildings, the lighthouse light, build mode and the base's HUD data. `world.ts` (via `dive/conserveLayer.ts`) creates `BaseScene` only when the conserve mode passes a `BasePort` (a type-only import from `conserve/`; the object comes from the conserve chunk) together with the expedition. The free dive never builds any of it: its input keys stay unchanged and the seabed's lighthouse block is skipped (`uBLCount` = 0, a uniform branch).

| File | Role | three.js |
|---|---|---|
| `config.ts` | Tunables: placement (slope 22° / 15°, re-check interval, frozen-check radius, yaw step), building look, lighthouse light (80 m, 2 lights, sweep, column), docking (18 m, 5 % / s), instances per kind | colours only |
| `buildMode.ts` | Aim → ground probe (terrain/groundProbe.ts) → the port's 2D rules → for the core the frozen-zone check (terrain/frozenZone.ts); throttled; place | no |
| `innerRect.ts` | The ring wall's inner face as the base rules' rectangle (rounded corners) | no |
| `dock.ts` | Departure detection (radius + 6 m hysteresis), docking at an energy tower | no |
| `home.ts` | Where recall / death wakes the diver once the core stands | no |
| `commands.ts` | Keys / HUD buttons → port and build mode, cues, notices; M9: `switch` (a lighthouse on / off, from anywhere) | no |
| `telemetry.ts` | HUD data and command types | no |
| `shapes.ts`, `structureShapes.ts`, `structureGeometry.ts` | Low-poly flat-shaded forms (≈ 180–240 triangles each, 6 m skirt into the ground), glow strips as a vertex attribute (0 hull, 1 strip, 2 lantern, 3 the volt reactor's amber crystal) | geometry only |
| `structureShader.ts`, `structureMaterial.ts` | One patched MeshPhong program for all kinds: panel-seam normals without textures, glow, grow-in, the terrain's water / fog / sonar / high beam and the lighthouse light | yes |
| `structureInstances.ts` | One InstancedMesh per kind (≤ 5 draws for any number of buildings, no LOD: nothing pops); a reactor on standby stays lit | yes |
| `baseLightShader.ts`, `baseLight.ts` | The lighthouse light on terrain and buildings: nearest 2 lit lanterns, (1 − d²/r²)² falloff, sweeping beam | yes |
| `beamShader.ts`, `beamColumn.ts` | Visible column + sweep cones, one instanced additive draw | yes |
| `hologramShader.ts`, `hologram.ts` | Placement preview (green / red) + footprint and base-radius rings | yes |
| `baseScene.ts` | Composition: energy tick, departures, docking, light and beams, hologram, telemetry, warm compile | yes |

Controls: G build mode, T next building, E / left click place (absorbing is off while building), Q base panel (lighthouse / reactor 「开启 / 关闭」 from anywhere, M9; 唤潮 at the base, M7: `commands.ts` → the tide director; off while a tide runs, and build mode / recall are off during its show); touch: 「建造」 / 「放置」 in the action fan, the 「基地」 HUD button, the build bar's cards and buttons.

Tests: `test:placement` (rules, ground, energy, draw calls ≤ 8 and ≤ 60k triangles for a full base), `test:frozen`, `test:shaders` (glslang ES, Mali-G57 budgets for the building / beam / hologram programs and the seabed with the light). Pure files stay free of three.js so these run in node.
