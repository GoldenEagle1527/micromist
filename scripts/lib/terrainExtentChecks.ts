/**
 * The terrain extent (terrain/terrainExtent.ts), pure: the endless field has none,
 * a bounded world's is its cell rectangle grown by the wall's thickness plus each
 * open crack's reach, and a footprint holds terrain iff it touches one of them.
 */
import { terrainForDevice } from "../../src/games/deep-march/terrain/config";
import { crackReachRects } from "../../src/games/deep-march/terrain/crackReach";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect, type WorldRect } from "../../src/games/deep-march/terrain/siteLayout";
import { extentOf, growRect, hasTerrain, terrainExtent } from "../../src/games/deep-march/terrain/terrainExtent";
import { genesisLayout, withWall } from "./worldFixture";

type Check = (ok: boolean, name: string, detail: string) => void;

const same = (a: WorldRect, b: WorldRect) => Math.abs(a.x0 - b.x0) + Math.abs(a.z0 - b.z0) + Math.abs(a.x1 - b.x1) + Math.abs(a.z1 - b.z1) < 1e-6;
const show = (r: WorldRect) => `[${r.x0.toFixed(0)}, ${r.x1.toFixed(0)}] × [${r.z0.toFixed(0)}, ${r.z1.toFixed(0)}]`;

export function terrainExtentChecks(check: Check): void {
  console.log("terrain extent (pure)");
  const world = { x0: -100, z0: -50, x1: 100, z1: 50 };
  const e = extentOf(world, 20, [{ x0: 118, z0: -8, x1: 160, z1: 8 }]);
  check(same(e.rects[0], growRect(world, 20)) && e.rects.length === 2, "rectangle grown by the thickness, plus the reach", e.rects.map(show).join(" ∪ "));
  check(
    hasTerrain(e, 110, 0, 5) && !hasTerrain(e, 121, 20, 5) && hasTerrain(e, 150, -2, 4) && !hasTerrain(e, 160, -2, 4) && hasTerrain(e, 115, 0, 10),
    "footprints: shell and reach in, beyond out, straddling in",
    "x 110 / 121 (z 20) / 150 / 160 / straddle 115…125",
  );
  check(same(extentOf(world, 0, []).rects[0], world), "no wall: the rectangle itself", show(world));
  check(hasTerrain(null, 1e7, -1e7, 32), "endless: every footprint", "null extent");

  const st = terrainForDevice(true);
  check(terrainExtent(createDensityField(7, st)) === null, "free dive field: no extent", "endless");
  const base = genesisLayout(7);
  const rect = layoutRect(base, MACRO.cell * st.worldScale);
  const walled = terrainExtent(createDensityField(7, st, undefined, base))!;
  const T = base.wall!.thickness;
  check(walled.rects.length === 1 && same(walled.rects[0], growRect(rect, T)), "genesis world: the rectangle grown by the wall's thickness", `T ${T.toFixed(1)} m → ${show(walled.rects[0])}`);
  const open = terrainExtent(createDensityField(7, st, undefined, withWall(base, null)))!;
  check(open.rects.length === 1 && same(open.rects[0], rect), "open edge (no wall): the rectangle", show(open.rects[0]));
  const crack = { s: 0, width: 16, depth: 140, through: true, extent: [-8, 8] as const };
  const cracked = createDensityField(7, st, undefined, withWall(base, { thickness: 100, cracks: [crack] }));
  const ce = terrainExtent(cracked)!;
  const reach = crackReachRects(cracked.wall!.shape, [crack], st.worldScale, st.boundsSize)[0];
  check(ce.rects.length === 2 && same(ce.rects[0], growRect(rect, 100)) && same(ce.rects[1], reach), "open crack: shell ∪ its reach", ce.rects.map(show).join(" ∪ "));
}
