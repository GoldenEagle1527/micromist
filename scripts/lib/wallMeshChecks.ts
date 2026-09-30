/**
 * test:wall, meshes and cost (terrain/mesher + regionWeights with the wall, the far
 * ring terrain/wallRing + scene/wallRing):
 *   - no terrain past the wall: at LOD 0–3 (skirts off) every vertex is in front of
 *     the outline, on the outer face or on the void's floor / roof;
 *   - no LOD popping: wall-face vertices of every level lie within a quarter cell of
 *     the level-0 surface (p99);
 *   - material: face vertices carry the wall weight (byte 6 ≥ 250), 0 elsewhere and
 *     in the free dive;
 *   - far ring: ≤ 2.2k triangles, one mesh / one draw, on the facets `inset` in front
 *     of the face, starting beyond the camera's far plane (never over a column);
 *   - performance: non-wall columns identical and ≤ +2 %, wall columns ≤ +10 % time
 *     and triangles, the whole world ≤ +4 % (weighted by the wall columns' share).
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../../src/games/deep-march/terrain/density";
import { columnRows, generateColumnMesh } from "../../src/games/deep-march/terrain/mesher";
import { REGION_STRIDE, WALL_SLOT } from "../../src/games/deep-march/terrain/regionWeights";
import { buildWallRing } from "../../src/games/deep-march/terrain/wallRing";
import { WALL_SHAPE } from "../../src/games/deep-march/terrain/wallConfig";
import { WALL_RING, createWallRing } from "../../src/games/deep-march/scene/wallRing";
import { createLongPulses } from "../../src/games/deep-march/scene/sonarLong";
import { createWaterUniforms } from "../../src/games/deep-march/scene/seabedMaterial";
import { createFogUniforms } from "../../src/games/deep-march/scene/fog";
import { SonarPulses, createSonarUniforms } from "../../src/games/deep-march/scene/sonar";
import { withWall } from "./worldFixture";
import type { Checker } from "./checks";
import type { SiteLayout } from "../../src/games/deep-march/terrain/siteLayout";

const S = TERRAIN.worldScale, iso = TERRAIN.isoLevel;
type Col = [number, number];

export function meshChecks(c: Checker, field: DensityField, layout: SiteLayout) {
  const w = field.wall!, shape = w.shape, T = shape.thickness * S;
  const none = createDensityField(field.seed, TERRAIN, undefined, withWall(layout, null));
  const loc = new Float64Array(2);
  const sdAt = (x: number, z: number) => (shape.locate(x / S, z / S, loc), loc[0] * S);
  const x1 = (shape.cx + shape.a + shape.rc) * S, z1 = (shape.cz + shape.b + shape.rc) * S;
  const cols = (size: number): Col[] => {
    const out: Col[] = [];
    for (let x = x1 - 200; x < x1 + T + size; x += size) for (let z = -160; z < 160; z += size) out.push([Math.floor(x / size), Math.floor(z / size)]);
    for (let x = x1 - 360; x < x1 + size; x += size) for (let z = z1 - 360; z < z1 + size; z += size) out.push([Math.floor(x / size), Math.floor(z / size)]);
    return out;
  };
  const dist = (x: number, y: number, z: number) => {
    const e = 0.05, F = field.sampleRaw;
    const g = Math.hypot(F(x + e, y, z) - F(x - e, y, z), F(x, y + e, z) - F(x, y - e, z), F(x, y, z + e) - F(x, y, z - e)) / (2 * e);
    return (F(x, y, z) - iso) / Math.max(1e-6, g);
  };

  c.section("wall meshes (LOD 0–3, skirts off)");
  let faceVerts = 0, faceLow = 0;
  for (const lod of [0, 1, 2, 3]) {
    const size = 32 << lod, cell = 1 << lod, rows = columnRows(field, lod);
    let stick = 0, worst = -Infinity, verts = 0;
    const errs: number[] = [];
    for (const [cx, cz] of cols(size)) {
      const m = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin * cell, undefined, false, undefined, lod, false);
      const P = m.positions;
      for (let v = 0; v < P.length / 3; v++) {
        const X = P[v * 3], Y = P[v * 3 + 1], Z = P[v * 3 + 2], sd = sdAt(X, Z);
        verts++;
        const tol = 2 * cell + 1;
        const onVoid = sd > T && (Math.abs(Y - WALL_SHAPE.voidLo) < tol || Math.abs(Y - WALL_SHAPE.voidHi) < tol);
        if (!(sd <= 0.5 || Math.abs(sd - T) < tol || onVoid)) (stick++, (worst = Math.max(worst, sd)));
        if (sd > 0.5 || field.wallWeight!(X, Y, Z) < 0.99) continue;
        errs.push(Math.abs(dist(X, Y, Z)));
        if (lod === 0) {
          faceVerts++;
          if (m.region[v * REGION_STRIDE + WALL_SLOT] < 250) faceLow++;
        }
      }
    }
    errs.sort((a, b) => a - b);
    const p99 = errs[Math.floor(0.99 * (errs.length - 1))];
    c.check(stick === 0, `LOD ${lod}: no terrain past the outline (only the outer face / void floor and roof)`, `${verts} vertices, ${stick} stick out${stick ? ` (worst ${worst.toFixed(1)} m)` : ""}`);
    c.check(errs.length > 100 && p99 <= cell / 4, `LOD ${lod}: wall face within ${cell / 4} m of the level-0 surface (no popping)`, `${errs.length} face vertices, p99 ${p99.toFixed(2)} m, max ${errs[errs.length - 1].toFixed(2)} m`);
  }
  c.check(faceVerts > 100 && faceLow === 0, "face vertices carry the wall material (byte 6 ≥ 250)", `${faceLow} of ${faceVerts} below`);
  {
    const inner = generateColumnMesh(field, 3, 2, columnRows(field), TERRAIN.floaterMargin, undefined, false);
    const free = createDensityField(field.seed, TERRAIN);
    const fm = generateColumnMesh(free, 3, 2, columnRows(free), TERRAIN.floaterMargin, undefined, false);
    const zero = (m: typeof fm) => m.region.every((b, i) => i % REGION_STRIDE !== WALL_SLOT || b === 0);
    c.check(inner.region.length > 0 && zero(inner) && zero(fm), "wall byte 0 away from the wall and in the free dive");
  }

  c.section("far ring");
  {
    const g = buildWallRing(shape, S, WALL_RING);
    const long = createLongPulses();
    const water = createWaterUniforms(new THREE.Color(0, 0.1, 0.2), TERRAIN.viewDistance);
    const ring = createWallRing(field, { water, fog: createFogUniforms(), sonar: createSonarUniforms(new SonarPulses(5)), long, far: TERRAIN.viewDistance })!;
    const geo = ring.mesh.geometry;
    c.check(g.triangles <= 2200 && ring.triangles === g.triangles && geo.index!.count === 3 * g.triangles && geo.groups.length === 0 && ring.mesh.children.length === 0, "≤ 2.2k triangles in one mesh (one draw)", `${g.triangles} triangles`);
    let off = 0, yOut = 0;
    for (let v = 0; v < g.positions.length / 3; v++) {
      const X = g.positions[v * 3], Y = g.positions[v * 3 + 1], Z = g.positions[v * 3 + 2];
      shape.locate(X / S, Z / S, loc);
      off = Math.max(off, Math.abs((loc[0] + shape.face(loc[1], Y / S)) * S + WALL_RING.inset));
      if (Y < WALL_RING.yBot - 1e-3 || Y > WALL_RING.yTop + 1e-3) yOut++;
    }
    c.check(off < 0.01 && yOut === 0, `ring vertices on the facets, ${WALL_RING.inset} m in front of the face, within [${WALL_RING.yBot}, ${WALL_RING.yTop}] m`, `max offset error ${off.toExponential(1)} m`);
    const margin = Number(/viewDistance \+ (\d+)\)/.exec(readFileSync("src/games/deep-march/scene/world.ts", "utf8"))?.[1] ?? NaN);
    const start = (ring.mesh.material as THREE.ShaderMaterial).uniforms.uRing.value.x;
    c.check(start >= TERRAIN.viewDistance + margin, "ring starts at / beyond the camera's far plane: never overlaps a terrain column", `ring from ${start} m, far plane ${TERRAIN.viewDistance + margin} m`);
    const diag = Math.hypot(x1 * 2, z1 * 2);
    c.check(ring.reach >= diag, "ring reach covers the world's diagonal", `${ring.reach.toFixed(0)} ≥ ${diag.toFixed(0)} m`);
    ring.dispose();
  }

  c.section("performance (run alone)");
  {
    const rows = columnRows(field), rows0 = columnRows(none);
    const inner: Col[] = [[3, 2], [-20, 11], [40, -33], [-51, -48], [12, 57], [-8, -30], [25, 25], [0, 0]];
    const edge: Col[] = [];
    for (let i = 0; i < 12; i++) {
      const s = ((i + 0.37) / 12) * shape.perimeter, p = new Float64Array(4);
      shape.point(s, 6, p); // 24 m inside the outline: the face region
      edge.push([Math.floor((p[0] * S) / 32), Math.floor((p[1] * S) / 32)]);
    }
    const bit = (f: DensityField, [cx, cz]: Col) => f.wallMask(cx * 32, cz * 32, cx * 32 + 32, cz * 32 + 32);
    c.check(inner.every((k) => bit(field, k) === 0) && edge.every((k) => bit(field, k) !== 0), "column sets: inner columns off the wall mask, edge columns on it");
    const run = (f: DensityField, r: typeof rows, set: Col[]) => {
      let tris = 0;
      const t = performance.now();
      for (const [cx, cz] of set) tris += generateColumnMesh(f, cx, cz, r, TERRAIN.floaterMargin, undefined, false).indices.length / 3;
      return { ms: (performance.now() - t) / set.length, tris };
    };
    const same = inner.every(([cx, cz]) => {
      const a = generateColumnMesh(field, cx, cz, rows, TERRAIN.floaterMargin, undefined, false), b = generateColumnMesh(none, cx, cz, rows0, TERRAIN.floaterMargin, undefined, false);
      return a.stats.noiseSamples === b.stats.noiseSamples && a.positions.length === b.positions.length && a.positions.every((v, i) => v === b.positions[i]) && a.region.every((v, i) => v === b.region[i]);
    });
    c.check(same, "non-wall columns: meshes, weights and noise samples identical with / without the wall (+0 work)");
    const best = { iw: Infinity, i0: Infinity, ew: Infinity, e0: Infinity };
    let trisW = 0, tris0 = 0;
    for (let round = 0; round < 8; round++) {
      // alternate the order (JIT / thermal drift hits both sides alike)
      const odd = round % 2 === 1;
      const i0 = odd ? run(none, rows0, inner) : null;
      best.iw = Math.min(best.iw, run(field, rows, inner).ms);
      best.i0 = Math.min(best.i0, (i0 ?? run(none, rows0, inner)).ms);
      const b0 = odd ? run(none, rows0, edge) : null;
      const a = run(field, rows, edge), b = b0 ?? run(none, rows0, edge);
      best.ew = Math.min(best.ew, a.ms);
      best.e0 = Math.min(best.e0, b.ms);
      [trisW, tris0] = [a.tris, b.tris];
    }
    const rIn = best.iw / best.i0, rEdge = best.ew / best.e0;
    c.check(rIn <= 1.02, "non-wall columns: time ≤ +2 % (noise)", `${best.i0.toFixed(1)} → ${best.iw.toFixed(1)} ms/column (×${rIn.toFixed(3)})`);
    c.check(rEdge <= 1.1 && trisW <= 1.1 * tris0, "wall columns: time and triangles ≤ +10 %", `${best.e0.toFixed(1)} → ${best.ew.toFixed(1)} ms/column (×${rEdge.toFixed(3)}), triangles ${tris0} → ${trisW}`);
    let nWall = 0, n = 0;
    const lo = Math.floor(-x1 / 32) - 8, hi = Math.ceil(x1 / 32) + 8, loZ = Math.floor(-z1 / 32) - 8, hiZ = Math.ceil(z1 / 32) + 8;
    for (let cx = lo; cx < hi; cx++) for (let cz = loZ; cz < hiZ; cz++) (n++, bit(field, [cx, cz]) && nWall++);
    const f = nWall / n, global = (1 - f) * Math.max(1, rIn) + f * rEdge;
    c.check(global <= 1.04, "whole world: ≤ +4 % (columns weighted by the wall's share)", `${nWall} of ${n} columns near the wall (${(100 * f).toFixed(1)} %), ×${global.toFixed(3)}`);
  }
}
