# scene/chaos — the chaos presentation (plan M8, stages 0–2)

The rules (m, stage, χ_g, cracks, healing, the wall's thickness) are `conserve/chaos/`; this folder draws a generation's chaos as a fixed `ChaosView` (`conserve/chaos/view.ts`: stage, χ_g, open cracks and scars as world points with tangent / outward normal). The view is fixed for the generation (D11): nothing here reads the live ledger. Conserve worlds only (`world.ts`); the free dive builds none of it.

| File | What |
|---|---|
| `config.ts` | `CHAOS_LOOK`: every strength — per-stage rows (stage 0 all zero), local reach, veins, crack light, fog, scars, lamp wave, audio, ghost echoes, omen |
| `effects.ts` | Pure: the generation's levels, local intensity χ_l = max exp(−d²/r²) over open cracks, the slow light wave (≤ 3 Hz sines), a frame's lamp / fog / audio / glow values, "it watches" follow factor, fog hue shift, audio parameters (identity at 0) |
| `seabedChaos.ts` | GLSL under `DM_CHAOS` + uniforms: scars (per vertex, darken the wall albedo), veins (iso-line of a 2-octave solid value noise, width from the pixel footprint, energy-conserving, faded before cells get small: no aliasing shimmer), crack light (baked `aChaos` weight on the notch + a water haze by the view ray's closest approach, piercing the turbidity) |
| `chaosSlots.ts` | Fills the nearest-crack / nearest-scar uniform slots |
| `chaosDirector.ts` | Per frame: uniforms, lamp modulation, fog shift, audio detune (`frame`, after the water look); ghost echoes and the omen (`sonar`, after the pulses). Does nothing for a calm generation; the tide hands it gen + 1's view at the switch |
| `ghostEcho.ts` | Pure: a share of the pings (stage 1 25 %, stage 2 35 %) answered 0.3–1.2 s later by a fainter pulse from the wall's direction (`SonarPulses.echo`) |
| `omen.ts` | Pure state machine of the distant giant squid: rumble 6 s → silhouette fades in over 3 s at 230–280 m (never < 180 m), drifts 18 s → withdraws; near cracks, first after 50 s (12 s in a debug-panel preview), then every 4–7 min, ≤ 3 per generation, never during the tide |
| `omenGeometry.ts`, `omenShader.ts`, `omenMesh.ts` | The silhouette: 1228 triangles of tubes, limbs swaying in the vertex shader, drawn additively only by the long sonar pulses |
| `chaosAudio.ts` | Web Audio insert on the mixer: wet path (low-pass sweep → short feedback delay) built on first use, disconnected when silent; the rumble (41 / 55 / 110 Hz → 180 Hz low-pass). Detune = loops' / shots' playback rate. No sound files |
| `rng.ts` | Seeded stream for ghosts and omens |

## Stages

- **0**: nothing. The columns keep the M7 programs bit for bit (`test:shaders` hashes), the director returns at once, no audio node is built.
- **1**: glowing hairline veins in patches on the wall, ghost sonar echoes from the wall's side.
- **2**: + 1–2 open cracks (not passable: depth < T) with pale light in them and the water in front, fog tinted near them, the lamp slowly dimming / recovering (≤ 40 %, ≤ 3 Hz), sounds detuned and wavering near them, the omen. Healed cracks leave darker scars.

「减弱灯光起伏」 (settings): the lamp keeps only the slowest component at a quarter of the depth, the glows stop breathing.

Budgets (`test:shaders`, `test:chaos`): the chaos seabed variant within the seabed Mali-G57 budget (longest arith +7.5 … 8.75 cycles over M7), omen program arith ≤ 12, no textures, ≤ 1.6k triangles.

## Preview on staging

The staging debug panel (`debug/`, 混沌预览) shows this dive at stage 0 | 1 | 2 (1–2 cracks, optional scar; never saved; the forecast and the next tide keep the real chaos), and its 传送 puts the diver in front of any open crack (`debug/teleport.ts`).
