# scene/sonarScan — the sonar scan record and 声呐观察模式

Every ping (key 3) records the seabed surfaces its wavefront sweeps over; **N** (or 「观察」 under the battery) swaps the view for that record. No map: the record is drawn in place, from the diver's own camera, in the old continuous sonar light mode's look — dark surfaces with cyan height contours and rims on black.

| File | Role |
|---|---|
| `scanGrid.ts` | Pure: 32 m tiles; one absolute quantisation grid (1/1024 m across, 1/16 m up) so a vertex is bit-identical in every tile and ping; 2-byte octahedral normals |
| `tileMesh.ts` | Pure: a tile's surface (u16 positions, 2-byte normals, u16 indices) ⇄ world-space triangle soup; the builder merges corners and drops collapsed triangles |
| `sphereClip.ts` | Pure: cut soup along a ping's sphere, keeping inside or outside; the two sides are exact complements (the same crossing points, bit for bit) |
| `scanRecord.ts` | Pure: the record. A ping commits tile by tile: old surface outside the sphere + what the ping saw inside it. LRU eviction past the vertex cap (never the current ping's tiles) |
| `scanSweep.ts` | Pure: one ping spread over the frames with its wavefront (nearest column first, triangle budget per frame); a tile commits once the front has passed it |
| `scanCodec.ts` | Pure: binary form for saves ("DMSC" v2: 8 B per vertex + 6 B per triangle, LRU order kept); malformed or v1 (the old points) → null |
| `scanStore.ts` | Pure: free dive = this session, last seed only; conserve = game-store key `scan/<save id>`, tagged with the world (creation time + seed) |
| `scanShader.ts`, `scanView.ts` | The observation scene: one opaque mesh per 128 m block, rebuilt when its tiles changed; shaded like SONAR_OPAQUE (contours AA'd with a minimum pixel width, rim, faint echo) at a steady level, plus the latest ping's front |
| `sonarScanner.ts` | Wiring for the dive: ping → sweep over the drawn column meshes (skirts and meshes dissolving out of a LOD crossfade skipped), per-frame step + eviction + throttled save (20 s, page hide, dive end), observation on / off |

**Why surfaces this way.** Options weighed: (1) a recorded height field — compact, but loses overhangs, caves and the ring wall; (2) a recorded SDF re-meshed — clean merges, but needs the density field sampled at every ping (seconds of noise on a phone) or an approximate splat, and a re-mesher; (3) snapshots of the column meshes as drawn (chosen) — the exact surfaces the old mode lit, already built, at their distance LOD (fine near the diver, coarse far away: a far scan stays coarse until re-pinged up close). The ping-radius boundary is an exact sphere cut on both sides, so unchanged terrain continues seamlessly across it; only where two older rims cross can mm-wide slivers remain (black on black).

**Stale by design.** The record is never refreshed from the live terrain and the tide never touches it: after a tide it shows the old seabed until a ping overwrites it (only inside that ping's sphere; what fell away there is cut out). Places never pinged are black. Observation mode is refused while loading and during a tide.

**Budgets** (phone / desktop): 150k / 400k recorded vertices (≈ 20 B each with their triangles: ≤ 3 / 8 MB in memory and in the save; one 206 m phone ping over LOD columns ≈ 40k), 4k / 16k triangles of scan work per frame (a full phone ping ≈ 200k: ~50 ms of desktop JS spread over its ~2 s front), 20k / 60k vertices rebuilt per frame in the view, radius 300 / 420 m. The fragment is ~3 Mali-G57 arithmetic cycles, no textures (test:shaders).

Tests: `test:scan` (grid, sphere cut, recording, seams between overlapping pings, stale after a tide and holes, sweep pacing, LRU bounds, codec, stores, mesh sources), `test:shaders` (the view's program and draw budget).
