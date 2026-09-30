/**
 * Streaming at the cracks (plan M8, follow-up "M3 deviation #5"; terrain/
 * crackReach.ts, terrainExtent.ts): without cracks the bounded world's request
 * sequence is bit for bit the recorded one; with an open crack the only extra
 * requests lie outside the crack-free terrain extent (the world rectangle grown by
 * the wall's thickness) inside that crack's reach rectangle (T + one column for a
 * through crack, its depth + one column otherwise).
 */
import * as THREE from "three";
import { terrainForDevice } from "../../src/games/deep-march/terrain/config";
import { crackReachRects } from "../../src/games/deep-march/terrain/crackReach";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect, rectOverlaps, type SiteLayout } from "../../src/games/deep-march/terrain/siteLayout";
import { hasTerrain, terrainExtent } from "../../src/games/deep-march/terrain/terrainExtent";
import { INFO_GRID } from "../../src/games/deep-march/terrain/config";
import { hashRequests, requestSequence } from "./streamingSim";
import { genesisLayout, withWall } from "./worldFixture";

type Check = (ok: boolean, name: string, detail: string) => void;

/**
 * Phone preset, seed 7, 180 u inside the east edge swimming east. Recorded at
 * deep-march-boundary-lod-fix: the terrain extent includes the wall's shell and the
 * edge columns no longer re-merge and split again (M7's 0e551d26 / 66 requests
 * carried that churn); a79fa85e / 62 with the view-reach split rule (chunks.ts
 * childrenInView; 8b9eec13 / 66 before it).
 */
const NO_CRACKS = { hash: "a79fa85e", requests: 62 };

export function crackStreamingChecks(check: Check): void {
  console.log("streaming at the cracks (M8)");
  const st = terrainForDevice(true);
  const base = genesisLayout(7);
  const rect = layoutRect(base, MACRO.cell * st.worldScale);
  const start = new THREE.Vector3(rect.x1 - 180, -40, 0);
  const seq = (layout: SiteLayout) => requestSequence(createDensityField(7, st, undefined, layout), 7, 2, 4, 30, 15, start, 0);
  const plain = seq(base);
  check(hashRequests(plain.log) === NO_CRACKS.hash && plain.log.length === NO_CRACKS.requests, "no cracks: the recorded request sequence, bit for bit", `${hashRequests(plain.log)}, ${plain.log.length} requests`);
  const b = st.boundsSize;
  const foot = (q: (typeof plain.log)[number]) => {
    const size = q.type === "info" ? INFO_GRID.boundsSize * st.worldScale : b * (1 << q.lod);
    const o = q.type === "info" ? -size / 2 : -b / 2;
    return { x0: o + q.cx * size, z0: o + q.cz * size, size };
  };
  for (const through of [false, true]) {
    // a crack in the middle of the east side (arc length 0), right ahead of the swim
    const T = 100, crack = { s: 0, width: 16, depth: through ? T + 40 : 60, through, extent: [-8, 8] as const };
    const layout = withWall(base, { ...base.wall!, thickness: T, cracks: [crack] });
    const field = createDensityField(7, st, undefined, layout);
    const rects = crackReachRects(field.wall!.shape, [crack], st.worldScale, b);
    const shell = terrainExtent(createDensityField(7, st, undefined, withWall(base, { ...base.wall!, thickness: T, cracks: [] })));
    const r = seq(layout);
    const outside = r.log.filter((q) => {
      const p = foot(q);
      return !hasTerrain(shell, p.x0, p.z0, p.size);
    });
    const stray = outside.filter((q) => {
      const p = foot(q);
      return q.type === "info" || !rects.some((w) => rectOverlaps(w, p.x0, p.z0, p.size));
    });
    const reach = rects[0].x1 - rect.x1;
    const want = (through ? T : crack.depth) + b;
    const streamed = terrainExtent(field)!.rects.some((w) => w.x0 === rects[0].x0 && w.z0 === rects[0].z0 && w.x1 === rects[0].x1 && w.z1 === rects[0].z1);
    check(streamed && stray.length === 0 && Math.abs(reach - want) < 1e-6, `${through ? "through" : "stage-2"} crack: its reach is terrain, extra mesh columns only there (${through ? "T" : "depth"} + one column)`, `${outside.length} outside the crack-free extent, ${stray.length} stray; reach ${reach.toFixed(0)} u past the edge`);
  }
}
