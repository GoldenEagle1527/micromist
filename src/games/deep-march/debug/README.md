# debug/ — the staging debug panel

Replaces every URL debug switch (`?chaos= &cracks= &scar= ?at= ?light= ?tide=simple ?ktx2=0 ?audio=0 ?dpr= ?lodNear= ?refine=0 ?bricks=0 ?wasm= ?fog= ?detail=0 ?occ=0 ?debugSpawns=1`). The game reads no URL parameter any more (test:debug checks it).

**Availability.** Staging and local dev only. `modes/debugLoader.ts` is the one door in: `import.meta.env.MODE !== "production" && siteKind() !== "prod" ? import("../debug") : null`. `npm run build` / `deploy` build in production mode, so the condition folds away with the import: no chunk, no strings, no panel. `deploy:staging` builds with `--mode staging` and keeps it as a lazy chunk. test:modes checks both bundles.

**Open.** The backquote key on desktop (Esc closes), or 「调试」 in the in-game ≡ menu (touch and desktop; `ui/menu/`). Opening releases the pointer lock; the dive keeps running.

| Section | Commands | Takes effect |
|---|---|---|
| 传送 | spawn, base, crack N, the 4 edges and 4 corners of a bounded world, a custom x / y / z (steppers ±10 / ±100, "use current position") | at once; every destination is made safe (`teleport.ts`: eye height above the seabed, lifted out of rock, walked in from a rounded wall corner) |
| 混沌预览 | stage (this generation / 0 / 1 / 2 / 3 / 4 / 5), cracks 1–2 at stage 2 (3 at stage 3, 5 at stage 4 with the first through, at stage 5 six and the main breach with the eye beyond it — teleport 「裂缝 7」), a healed scar | restart; conserve only; never saved, the forecast and the tide keep the real chaos; stage 5 is the look only (no gaze sequence) |
| 灯光/声呐 | off / beam / high (the gear's modes); a free sonar ping (no battery, no cooldown); sonar observation mode (same as N); forget the scan record | at once; forgetting also clears the conserve world's saved record |
| 潮汐 | simple tide (the 浊潮 murk instead of the show) | restart; conserve only |
| 结局演练 | 直视 sandbox off / ① / ② / ③ / ④: the next dive plays a stage-5 copy of the save (main breach, gaze at that phase, base stocked to m ≈ 0.79 plus the four anchors' price) held in memory only (`conserve/session/rehearsal.ts`); in such a dive: gaze time +5 min, light every anchor, release to forecast m ≥ 0.84, seal now (both conditions + the 封界潮 where the diver is), annihilate now (the ending; only the sandbox ends) | the choice: restart; the shortcuts: at once, rehearsal dives only. The real slot and the real scan record are never written while it is on |
| 资源 | fill the battery | at once; the battery is the dive's own, not in the save |
| 渲染 | KTX2 (off = WebP), pixel ratio, full-detail radius, turbidity, noise engine JS / WASM, coarse pre-pass, sparse bricks, detail normals, occlusion culling | restart |
| 声音 | sound off (no audio context at all) | restart |
| 调试叠加层 | spawn-candidate and region markers (same as B); the fps / streaming stats line (hidden otherwise) | at once |

Restart commands edit a draft; the bar at the bottom shows how many wait and 「重新开始下潜」 applies them (`scene/dive/params.ts`, session-only, in memory — no URL, no storage). A free dive is rebuilt with the same seed; a conserve dive re-opens the save with "continue" (like leaving and continuing: progress is saved as usual). Nothing in the panel writes the save, except 「清空声呐记录」 (the scan record is its own game-store entry, `scan/<save id>`, not the save). Filling the tank or the base energy is deliberately missing: particles are conserved by the ledger (a fill would create them from nothing), and the energy lives in the saved base state.

| File | What |
|---|---|
| `types.ts` | The contract with the dive: `DebugParts` (what the dive lends), `DebugPort` (what the panel may do), `Pose`, `TeleportTarget` |
| `teleport.ts` | Pure: seabed search, safe placement, crack / edge / corner / spawn / base targets |
| `port.ts` | `createDebugPort(parts)`: the runtime port (built by `scene/dive/debugWiring.ts`) |
| `registry.ts` | Command types, sections, the context, `visibleCommands`, `stepValue`, `pendingKeys` |
| `liveCommands.ts` / `diveCommands.ts` / `commands.ts` | The declarative commands: runtime ones through the port, restart ones on the draft |
| `i18n.ts`, `labels.ts` | zh / en strings (test:i18n), option and target labels |
| `ui/` | `DebugPanel` (key, the menu's open signal, pointer lock), `DebugSheet` (sections, restart bar), `CommandRow` (one command as buttons), `debug.css` |

Tests: `npm run test:debug` (teleports on synthetic and real terrain, the registry, the old-switch coverage, no URL reads, file sizes), `test:modes` (bundles), `test:i18n` (strings).
