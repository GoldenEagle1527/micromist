# scene/chaos — the chaos presentation (plan M8 stages 0–2, backlog stages 3–5)

The rules (m, stage, χ_g, cracks, healing, the wall's thickness) are `conserve/chaos/`; this folder draws a generation's chaos as a fixed `ChaosView` (`conserve/chaos/view.ts`: stage, χ_g, open cracks and scars as world points with tangent / outward normal). The view is fixed for the generation (D11): nothing here reads the live ledger. Conserve worlds only (`world.ts`); the free dive builds none of it.

| File | What |
|---|---|
| `config.ts` | `CHAOS_LOOK`: every strength — per-stage rows (stage 0 all zero; stage 3+ global fog, plankton, warp, global audio, events), local reach, veins, crack light, fog, scars, lamp wave, audio, ghost echoes, omen, `deep` (plankton colours, surge, blink, pupil), `shell` |
| `effects.ts` | Pure: the generation's levels, local intensity χ_l = max exp(−d²/r²) over open cracks, the slow light wave (≤ 3 Hz sines), a frame's lamp / fog / audio / glow values, "it watches" follow factor, fog hue shift, audio parameters (identity at 0) |
| `seabedChaos.ts` | GLSL under `DM_CHAOS` + uniforms: scars (per vertex, darken the wall albedo), veins (iso-line of a 2-octave solid value noise, width from the pixel footprint, energy-conserving, faded before cells get small: no aliasing shimmer), crack light (baked `aChaos` weight on the notch + a water haze by the view ray's closest approach, piercing the turbidity) |
| `chaosSlots.ts` | Fills the nearest-crack / nearest-scar uniform slots |
| `chaosDirector.ts` | Per frame: uniforms, lamp modulation, fog shift, audio detune (`frame`, after the water look); ghost echoes and the omen (`sonar`, after the pulses). Does nothing for a calm generation; the tide hands it gen + 1's view at the switch |
| `deepChaos.ts` | Stage 3+ layer owned by the director: global fog / audio, plankton tint and distorted swarm (uniforms in `particles.ts`), the timed events, the shell (not on the main breach at stage 5: the eye is there, `scene/gaze/`); the `dread` loop during a surge (the gaze's floor is its own `growl` loop; `ChaosDirector.floor` keeps only the rumble) |
| `chaosEvents.ts` | Pure, stage 4+: the surge (every 3–5 min, 5 s in / 20 s / 5 s out, a ghost pulse every 4 s at its height), the blink (2 s low rumble, then every crack light eases out for 1.5 s), the pupil sweep (every 40–90 s, 7 s) |
| `chaosShell.ts`, `chaosShellShader.ts` | The chaos beyond the wall: a 48-triangle concave curtain 90 m beyond the nearest through crack's outer mouth, emissive 2-octave noise cycling through its palette, the eye's light (watch × blink) and the pupil's dark bar; additive, depth-tested (seen only through the crack), drawn only within 520 m of it |
| `ghostEcho.ts` | Pure: a share of the pings (stage 1 25 %, stage 2 35 %) answered 0.3–1.2 s later by a fainter pulse from the wall's direction (`SonarPulses.echo`) |
| `omen.ts` | Pure state machine of the distant giant squid: rumble 6 s → silhouette fades in over 3 s at 230–280 m (never < 180 m), drifts 18 s → withdraws; near cracks, first after 50 s (12 s in a debug-panel preview), then every 4–7 min, ≤ 3 per generation, never during the tide |
| `omenGeometry.ts`, `omenShader.ts`, `omenMesh.ts` | The silhouette: 1228 triangles of tubes, limbs swaying in the vertex shader, drawn additively only by the long sonar pulses — a sonar return, so rock between does not hide it (no depth test): the rumble is the cue to ping |
| `chaosAudio.ts` | Web Audio insert on the mixer: wet path (low-pass sweep → short feedback delay) built on first use, disconnected 1.5 s after it falls silent (a timer: also when the stage drops and nobody calls any more); the rumble (41 / 55 / 110 Hz → 180 Hz low-pass), stopped the same way. Detune = loops' / shots' playback rate |
| `rng.ts` | Seeded stream for ghosts and omens |
| `lateChaos.ts` | Stage 3–4 omens owned by the director (`CHAOS_LOOK.late`): runs even in a calm generation when the debug panel forces one |
| `phantoms.ts`, `phantomContacts.ts` | Pure, 声呐假读数: within 400 m of an open crack a ping is sometimes answered by a phantom contact 70 … 190 m out (a node-like cluster or one 26 … 48 m body); the next ping decides afresh (the old one fades), coming within 55 m dissolves it. Shapes incl. the base's (column over core) |
| `phantomMesh.ts` | One additive `THREE.Points` draw (≤ 24 soft world-sized sprites, no texture, no depth test), lit on the CPU by the near pulses with the seabed's own front / afterglow curves: a return shows only where a ping or ghost echo passes |
| `readingGlitch.ts` | Pure, 读数跳变: near a crack every 18 … 45 s the depth / heading readouts are wrong for 0.7 … 1.6 s (handle telemetry) |
| `lighthouseDim.ts` | Pure, 基地灯塔变暗: near a lit lighthouse every 2–4 min a 2.5 s low groan (the heavy metal `creak`, slowed and muffled, over a softer rumble), then the lighthouse light (terrain light + beam columns) eases to 20 % over 2.5 s, holds 4 … 7 s, recovers over 3.5 s; 「减弱灯光起伏」: 60 %, 1.6× slower |
| `homeGhost.ts` | Pure, 基地的幽灵回波: ≥ 160 m from the base a ping is sometimes answered 0.6 … 1.4 s later by a pulse from a phantom base 120 … 240 m away, 70 … 180° off the true bearing, its silhouette in the returns, the deep far ping (`farping`, a little low and muffled) |

## Stages

- **0**: nothing. The columns keep the M7 programs bit for bit (`test:shaders` hashes), the director returns at once, no audio node is built.
- **1**: glowing hairline veins in patches on the wall, ghost sonar echoes from the wall's side.
- **2**: + 1–2 open cracks (not passable: depth < T) with pale light in them and the water in front, fog tinted near them, the lamp slowly dimming / recovering (≤ 40 %, ≤ 3 Hz), sounds detuned and wavering near them, the omen. Healed cracks leave darker scars.
- **3**: stronger rows; the fog tinted 10 % everywhere; the plankton turning sickly green-white, a quarter of it swimming distorted (jerky held poses, more violent near cracks); more ghost echoes.
- **4**: the plankton red-violet, half of it distorted; the sound wavers everywhere; the surge, the blink and the pupil; the first through (passable) crack — beyond it the shell. The diver may swim through to one column past the outer face (`terrain/edgePassages.ts`).
  Stage 3 also: phantom sonar contacts and jumping depth / heading readouts near cracks; the anomalous terrain around the cracks (baked at the tide: `terrain/anomaly.ts` — W × (1 + 2k), inverted strata, barbs from the rock ceiling and spikes from the floor within 300 m).
  Stage 4 also: the lighthouse dimming now and then, the base's ghost echo.
- **5**: stage 4's look, stronger (unreachable without abyss particles; see the plan's backlog).

「减弱灯光起伏」 (settings): the lamp keeps only the slowest component at a quarter of the depth, the glows stop breathing.

Budgets (`test:shaders`, `test:chaos`): the chaos seabed variant within the seabed Mali-G57 budget (longest arith +7.5 … 8.75 cycles over M7), omen program arith ≤ 12, no textures, ≤ 1.6k triangles. Stages 3–5 add no seabed shader work: plankton uniforms, one 48-triangle shell draw near a through crack, CPU events.

## Preview on staging

The staging debug panel (`debug/`, 混沌预览) shows this dive at stage 0 | 1 | 2 | 3 | 4 | 5 (stage 5: the main breach and the eye, which turns toward the base 20 s into the dive) (1–2 cracks at stage 2, 3 at stage 3, 5 at stage 4 with crack 0 through; optional scar; never saved; the forecast and the next tide keep the real chaos), and its 传送 puts the diver in front of any open crack (`debug/teleport.ts`). The surge comes 90 s and the first blink 60 s into the dive.

The four stage 3–4 omens have their own switches there (预览·声呐假读数 / 异常地形 / 基地灯塔变暗 / 基地的幽灵回波): on at any stage, first event about 8 s in (`late.previewS`), never saved; the anomalous terrain bakes into this dive's wall layout at full strength (with no open crack it previews stage 2 with two).
