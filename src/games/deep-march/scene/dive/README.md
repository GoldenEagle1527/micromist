# scene/dive — the dive's parts

`world.ts` (`createDeepMarch`) is a thin orchestrator: it builds these parts in a fixed order (the scene's child order and every per-frame step are part of the free dive's bit-exact baseline), starts the loop and hands the React shell its handle.

| File | What |
|---|---|
| `types.ts` | Public types: `DeepMarchOptions`, `DeepMarchHandle`, `Telemetry`, `LoadingSnapshot`, `HudLabels` (re-exported by `world.ts`) |
| `params.ts` | The dive's debug overrides (pixel ratio, LOD radius, refine, bricks, WASM, fog, detail, occlusion, simple tide, chaos preview, WebP, sound off): session-only, set by the staging debug panel (`debug/`), read once per dive; defaults everywhere else. The device terrain preset with overrides |
| `rendererRig.ts` | WebGL renderer + frame pacer, the canvas overlay (lock prompt, stats, alert), resize |
| `waterLook.ts` | Fog colour, water gradient dome, down-welling lights, the per-frame depth × light-mode lighting; the tide's veil (`setVeil`: darkness, P1's clear water; off = unchanged) |
| `gpuHealth.ts` | GPU facts, shader link failures, warm compile (system check), WebGL context loss |
| `loadingGate.ts` | The loading gate (terrain, textures, programs, sounds with `AUDIO_GRACE_MS`), throttled terrain progress |
| `conserveLayer.ts` | The conserve mode in the dive: `ExpeditionScene` + `BaseScene`, their per-frame input (base presses first, then absorbing), hold keys, respawn; the tide's lock (no build / recall in the show) and hold (particle-ized). Never built in the free dive |
| `tideWiring.ts` | Conserve with a tide port: the tide's director (scene/tide) wired to the loop's and the handle's parts, which it rebinds at the switch to gen + 1 |
| `debugWiring.ts` | Staging only: the debug panel's runtime port (`debug/port.ts`: teleport, light, overlay, battery) built from what the dive lends, when the page passes the factory (`DeepMarchOptions.debug`); production builds never do |
| `diveCues.ts` | Battery warnings, bumps, sonar pings, ambience / swim loops; light and ping controls (key 3) with their cues |
| `cameraSync.ts` | First-person camera: sprint FOV, bob, stroke roll |
| `hudChips.ts` | 4 Hz terrain / region chips (with hold / hysteresis), fps, the stats line |
| `diveLoop.ts` | The per-frame loop in its fixed order (the tide, if any, right after occlusion; the chaos, if any, after the water look and after the sonar); pause while hidden |
| `handle.ts` | The handle: loading snapshot, controls, telemetry (incl. `tide()`) |
| `debugKey.ts` | B toggles the spawn-candidate markers (also in the debug panel's 调试叠加层) |

Rendering-only code; the rules (conserve ledger, base, chaos) live in `conserve/` and reach the scene through the ports.
