# scene/expedition — the conserve expedition in the dive (plan M4)

Rendering and interaction for resource nodes, the particle tank and lost caches. `world.ts` (via `dive/conserveLayer.ts`) creates `ExpeditionScene` only when the conserve mode passes an `ExpeditionPort` (a type-only import from `conserve/`; the object comes from the conserve chunk). The free dive never builds any of it and its input keys stay unchanged.

| File | Role | three.js |
|---|---|---|
| `config.ts` | Tunables: draw radius 170 m / shrink band 50 m, ≤ 96 instances, prefetch 420 m, placement budget, look, absorb reach and cone, recall timing, beacon | colours only |
| `placement.ts` | Deterministic node anchors, sites queued nearest first, time-sliced | no |
| `selection.ts` | Visible set (caches + nearest nodes) and aim target | no |
| `interaction.ts` | Hold to absorb / retrieve through the port; tank-full and flat-battery blocks; battery drain | no |
| `absorbFlow.ts`, `absorbFlowShader.ts` | The inflow while particles move: one `THREE.Points` draw (phone 48 / desktop 160) spiralling from the node / cache into the tank below the view, tinted by the particle kind, all motion in the vertex shader; the `flow` loop follows its fade. Hidden with the nodes (a child of their draw) | yes |
| `recall.ts` | Emergency recall timing (hold 2 s, fade, the loss in the dark, fade in). M5: inside the base the tank goes into storage (`safeLoss`), and the diver wakes at the base core once built | no |
| `beacon.ts` | Cache flash phase and audio tick timing / gain | no |
| `telemetry.ts` | HUD data types, compass bearings | no |
| `nodeGeometry.ts`, `nodeInstances.ts` | Low-poly crystal cluster (75 tris) + cache bipyramid (12 tris) in one InstancedMesh | yes |
| `nodeShader.ts`, `nodeMaterial.ts` | Patched MeshPhongMaterial: faceted normal-map look without textures, deep-blue glow, the terrain's water / fog / beam / sonar chain, distance shrink + grow-in (no popping) | yes |
| `nodeView.ts` | Ties placement, selection and instances together | yes |
| `expeditionScene.ts` | Composition: frame update, the survival resource "tank", the blackout, cues, telemetry | yes |

Tests: `test:nodes` (placement, draw counts and triangle budget, interaction / recall / beacon rules) and `test:shaders` (glslang ES compile, Mali-G57 budget). Pure files stay free of three.js so these run in node.
