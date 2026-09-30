# scene/sonarScan — the sonar scan record and 声呐观察模式

Every ping (key 3) records the seabed its wavefront sweeps over; **N** (or 「观察」 under the battery) swaps the view for that record. No map: the record is drawn in place, from the diver's own camera, as cyan points on black.

| File | Role |
|---|---|
| `scanGrid.ts` | Pure: 32 m tiles, 2 m cells (one point each), a point packed in 52 bits (x / z 1/128 m, y 1/16 m, octahedral normal) |
| `scanRecord.ts` | Pure: the record. A ping adds what it sees and clears older points inside its sphere it no longer sees; LRU eviction past the point cap (never the current ping's tiles) |
| `scanSweep.ts` | Pure: one ping spread over the frames with its wavefront (nearest column first, vertex budget per frame); a tile is cleared once the front has passed it |
| `scanCodec.ts` | Pure: binary form for saves ("DMSC" v1, 7 B per point, LRU order kept); malformed → null |
| `scanStore.ts` | Pure: free dive = this session, last seed only; conserve = game-store key `scan/<save id>`, tagged with the world (creation time + seed) |
| `scanShader.ts`, `scanView.ts` | The observation scene: one additive Points draw per 128 m block, rebuilt when its tiles changed, distance fade, 4 m height contours, the latest ping's front |
| `sonarScanner.ts` | Wiring for the dive: ping → sweep, per-frame step + eviction + throttled save (20 s, page hide, dive end), observation on / off |

**Stale by design.** The record is never refreshed from the live terrain and the tide never touches it: after a tide it shows the old seabed until a ping overwrites it (only inside that ping's sphere). Places never pinged show nothing. Observation mode is refused while loading and during a tide.

**Budgets** (phone / desktop): 90k / 150k points (≈ 0.6 / 1 MB saved), 8k / 24k terrain vertices scanned per frame, 10k / 30k points rebuilt per frame, view radius 300 / 420 m, sprites ≤ 7 / 10 px. The fragment is ~1 Mali-G57 arithmetic cycle, no textures (test:shaders).

Tests: `test:scan` (packing, record / clear / stale after a tide, sweep pacing, LRU bounds, codec, stores, mesh sources), `test:shaders` (the view's program and draw budget).
