# scene/gaze/ — 直视 (stage 5) in the dive

The session's gaze (`conserve/gaze/`) on screen (design doc §4.6, §7.3, §9.1). Megalophobia only: everything is
huge, slow and announced (heard, then on the sonar); nothing appears at once, no stingers.

| File | What |
|---|---|
| `config.ts` | `GAZE_LOOK`: the eye (curtain, sphere 1.5 km at 2.4 km, iris, slit widths, turn 90 s, pupil follow, colours, pierce, draw distance, the seal's close), the anchors, the swarm rings per phase and the echo giant, the plankton current, sound floors, the lighthouse ×0.5, the ending's veil |
| `eyeShader.ts`, `eyeMesh.ts` | The eye: a 48-triangle curtain round the breach's outer mouth carrying a per-pixel traced sphere (sclera, flowing iris fibres, vertical slit pupil); an analytic aperture keeps it to the breach's opening; additive, depth-tested, far-plane pinned, drawn within 760 m of the breach |
| `anchorMesh.ts` | The four 封界 anchors: one instanced draw of solid octahedra (32 triangles), dim → lit, fogged |
| `berserk.ts` | The berserk swarm: 10 omen silhouettes in one instanced draw (the omen shader with `USE_INSTANCING`), closing in 900 → 110 m over the phases, one coiled round the squeezed building, the echo giant over the dome from ③; long-sonar only |
| `atmosphere.ts` | Plankton current toward the base, lighthouse light halved from ②, the sound floor: the `growl` loop (the dread clip, lower and muffled, from ①) over a softer sub rumble (into `ChaosDirector.floor`), a squeeze's groan; after 湮灭 the veil closes |
| `gazeDirector.ts` | Per frame after the chaos frame: ticks the port (interact = E / left mouse / the touch hold button near an anchor), calls the 封界潮 when both conditions hold and the diver is under the dome, draws the eye (preview: visual only), locks the layer after 湮灭; `telemetry()` for the HUD (`ui/gaze/`) |
| `telemetry.ts` | What the HUD reads |

Cost on a Mali-G57: the eye is one curtain draw (fragment work only inside the breach's opening), anchors one tiny draw near the breach, the swarm ≈ 13.5k additive triangles only while a long pulse is alive. Buildings crush in their own vertex shader (`aState.z`, `scene/base/structureShader.ts`). No LOD, no lines.
