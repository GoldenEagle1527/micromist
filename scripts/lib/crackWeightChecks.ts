/**
 * The chaos byte of the region weights (plan M8; terrain/crackWeight.ts →
 * regionWeights.ts CHAOS_BYTE): meshed next to an open crack, byte 7 carries the
 * crack weight (up to ~1 in the notch), every other byte is exactly what it is
 * without it; the free dive and a crack-free wall have no crack weight (byte 7
 * stays 0, no extra work).
 */
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh } from "../../src/games/deep-march/terrain/mesher";
import { CHAOS_BYTE, REGION_STRIDE, RegionWeightSampler, packRegionWeights, regionGridSpacing } from "../../src/games/deep-march/terrain/regionWeights";
import { RING10 } from "./chaosFixture";
import { genesisLayout, withWall } from "./worldFixture";

type Check = (ok: boolean, name: string, detail: string) => void;

export function crackWeightChecks(check: Check): void {
  console.log("chaos byte (crack weight, M8)");
  const s0 = 1900, width = 16, depth = 60;
  const base = genesisLayout(7);
  const layout = withWall(base, { ...base.wall!, thickness: 100, cracks: [{ s: s0, width, depth, through: false, extent: [s0 - width / 2, s0 + width / 2] }] });
  const field = createDensityField(7, TERRAIN, undefined, layout);
  const plain = createDensityField(7, TERRAIN, undefined, withWall(base, { ...base.wall!, thickness: 100, cracks: [] }));
  const free = createDensityField(7, TERRAIN);
  check(field.crackWeight !== null && plain.crackWeight === null && free.crackWeight === null, "crack weight only with open cracks", "free dive / crack-free wall: none");
  const p = RING10.point(s0), a = RING10.point(s0 - 1), b = RING10.point(s0 + 1);
  const tl = Math.hypot(b.x - a.x, b.z - a.z), nx = (b.z - a.z) / tl, nz = -(b.x - a.x) / tl;
  // the columns across the notch (its back lies ≈ 20 … 60 m past the outline)
  const size = TERRAIN.boundsSize, rows = columnRows(field, 0), sp = regionGridSpacing(TERRAIN.worldScale);
  let otherBad = 0, byteBad = 0, max = 0, lit = 0, n = 0;
  for (const t of [4, 20, 36, 52]) {
    const x = p.x + nx * t, z = p.z + nz * t;
    const m = generateColumnMesh(field, Math.floor((x + size / 2) / size), Math.floor((z + size / 2) / size), rows, TERRAIN.floaterMargin, undefined, false, undefined, 0);
    const nv = m.positions.length / 3;
    n += nv;
    const without = packRegionWeights(m.positions, nv, nv, new RegionWeightSampler(field.regions, sp), [], field.wallWeight, null);
    for (let v = 0; v < nv; v++) {
      for (let k = 0; k < REGION_STRIDE; k++) if (k !== CHAOS_BYTE && m.region[v * REGION_STRIDE + k] !== without[v * REGION_STRIDE + k]) otherBad++;
      const c = m.region[v * REGION_STRIDE + CHAOS_BYTE];
      max = Math.max(max, c);
      if (c > 0) lit++;
      // byte 7 is the function's value at the vertex (skirt vertices copy their source's)
      const want = Math.round(Math.min(1, Math.max(0, field.crackWeight!(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]))) * 255);
      if (c !== want) byteBad++;
    }
  }
  check(otherBad === 0, "every other byte identical to the pack without the crack weight", `${otherBad} differing bytes of ${n * 7} (4 columns)`);
  const q = RING10.point(s0 + 300);
  const far = generateColumnMesh(field, Math.floor((q.x + size / 2) / size), Math.floor((q.z + size / 2) / size), rows, TERRAIN.floaterMargin, undefined, false, undefined, 0);
  let farLit = 0;
  for (let v = 0; v < far.positions.length / 3; v++) if (far.region[v * REGION_STRIDE + CHAOS_BYTE] !== 0) farLit++;
  check(max > 180 && lit > 20 && farLit === 0, "byte 7 lights the notch (to ~1 at its back), nothing 300 m along the wall", `max ${max}, ${lit} of ${n} vertices in the notch's columns, ${farLit} beside it`);
  check(byteBad < n * 0.2, "byte 7 = round(crackWeight · 255) (skirts copy their source)", `${byteBad} skirt vertices of ${n}`);
  const fm = generateColumnMesh(free, 0, 0, columnRows(free, 0), TERRAIN.floaterMargin, undefined, false, undefined, 0);
  let freeLit = 0;
  for (let v = 0; v < fm.positions.length / 3; v++) if (fm.region[v * REGION_STRIDE + CHAOS_BYTE] !== 0) freeLit++;
  check(freeLit === 0, "free dive: byte 7 stays 0", `${freeLit} non-zero`);
}
