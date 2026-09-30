# scene/dive — the dive's parts

`world.ts` (`createDeepMarch`) is a thin orchestrator: it builds these parts in a fixed order (the scene's child order and every per-frame step are part of the free dive's bit-exact baseline), starts the loop and hands the React shell its handle.

| File | What |
|---|---|
| `types.ts` | Public types: `DeepMarchOptions`, `DeepMarchHandle`, `Telemetry`, `LoadingSnapshot`, `HudLabels` (re-exported by `world.ts`) |
| `params.ts` | URL switches (`?dpr ?lodNear ?refine ?bricks ?wasm ?fog ?detail ?occ ?debugSpawns ?at ?light`), read once; the device terrain preset with overrides |
| `rendererRig.ts` | WebGL renderer + frame pacer, the canvas overlay (lock prompt, stats, alert), resize |
| `waterLook.ts` | Fog colour, water gradient dome, down-welling lights, the per-frame depth × light-mode lighting |
| `gpuHealth.ts` | GPU facts, shader link failures, warm compile (system check), WebGL context loss |
| `loadingGate.ts` | The loading gate (terrain, textures, programs, sounds with `AUDIO_GRACE_MS`), throttled terrain progress |
| `conserveLayer.ts` | The conserve mode in the dive: `ExpeditionScene` + `BaseScene`, their per-frame input (base presses first, then absorbing), hold keys, respawn. Never built in the free dive |
| `diveCues.ts` | Battery warnings, bumps, sonar pings, ambience / swim loops; light controls with their cues |
| `cameraSync.ts` | First-person camera: sprint FOV, bob, stroke roll |
| `hudChips.ts` | 4 Hz terrain / region chips (with hold / hysteresis), fps, the stats line |
| `diveLoop.ts` | The per-frame loop in its fixed order; pause while hidden |
| `handle.ts` | The handle: loading snapshot, controls, telemetry |
| `debugKey.ts` | B toggles the spawn-candidate markers |

Rendering-only code; the rules (conserve ledger, base, chaos) live in `conserve/` and reach the scene through the ports.
