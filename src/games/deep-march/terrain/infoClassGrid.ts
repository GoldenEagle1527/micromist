/**
 * Class grid of one column's terrain classification (terrainInfoGen.ts, format
 * in terrainInfoData.ts): the macro region per class-cell column, then per water
 * cell its EnvCode (rules in terrainCodes.ts), distances to rock up / down /
 * sideways and the closed horizontal directions. No ray marching: vertical
 * distances come from the full-height lines, horizontal ones from ≤ 3-cell grid
 * scans with linear refinement (longer in the cave warren / canyon belt, infoScans.ts).
 */
import { ENV, ENV_T } from "./terrainInfo";
import { REGION, createRegionSample } from "./regions";
import { DIRS, type InfoGeom } from "./infoGeom";
import type { Line, LineAt } from "./infoLines";
import { createLongScan } from "./infoScans";

export type ClassGrid = {
  env: Uint8Array;
  up8: Uint8Array;
  down8: Uint8Array;
  side8: Uint8Array;
  sides: Uint8Array;
  regionId: Uint8Array;
  regionW: Uint8Array;
  regionEdge: Uint8Array;
};

export function classifyCells(g: InfoGeom, L: LineAt): ClassGrid {
  const { field, iso, sp, S, C, gjMin, nyL, y0, ci0, cj0, ck0, nx, ny, nz, longCol } = g;
  const s = field.settings;
  const floorAt = (ln: Line, ju: number, y: number) => (ln.d[ju] >= iso ? y + C : ln.below[ju]);

  // ---- macro region per class-cell column (also drives the region-aware class rules) ----
  const rsC = createRegionSample();
  const regionId = new Uint8Array(nx * nz);
  const regionW = new Uint8Array(nx * nz);
  const regionEdge = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      field.regions.sample(-s.boundsSize / 2 + (ci0 + ix) * S * sp, -s.boundsSize / 2 + (ck0 + iz) * S * sp, rsC);
      regionId[iz * nx + ix] = rsC.id;
      regionW[iz * nx + ix] = Math.round(rsC.dominant * 255);
      regionEdge[iz * nx + ix] = Math.round(rsC.edge);
    }
  }

  // ---- (a) class grid ----
  const cells = nx * ny * nz;
  const env = new Uint8Array(cells);
  const up8 = new Uint8Array(cells);
  const down8 = new Uint8Array(cells);
  const side8 = new Uint8Array(cells);
  const sides = new Uint8Array(cells);
  const q = (v: number) => (Number.isFinite(v) ? Math.min(255, Math.max(0, Math.round(v * 4))) : 255);
  const sideD = new Float64Array(8);
  const sideV = new Uint8Array(8);
  // Canyon belt: water between two trench walls, below their crest, reads as canyon
  // (row index up to which the column is canyon; −1 = none yet).
  const canyonRim = new Int32Array(nx * nz).fill(-1);
  const longScan = createLongScan(g, L, canyonRim);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const ln = L(ix, iz);
      for (let iy = 0; iy < ny; iy++) {
        const ju = (cj0 + iy) * S - gjMin;
        const idx = (iz * ny + iy) * nx + ix;
        const d0 = ln.d[ju];
        if (d0 >= iso) {
          env[idx] = ENV.ROCK;
          continue;
        }
        const y = y0 + ju * sp;
        const up = ln.above[ju] - y;
        const down = y - ln.below[ju];
        // horizontal scans
        let mask = 0, closed = 0, minSide = Infinity, minDir = -1;
        for (let dir = 0; dir < 8; dir++) {
          const dx = DIRS[dir * 2], dz = DIRS[dir * 2 + 1];
          const diag = dx !== 0 && dz !== 0;
          const steps = diag ? ENV_T.ringDiag : ENV_T.ringAxis;
          const len = diag ? C * Math.SQRT2 : C;
          let prev = d0;
          sideD[dir] = Infinity;
          sideV[dir] = 0;
          for (let st = 1; st <= steps; st++) {
            const l2 = L(ix + dx * st, iz + dz * st);
            const v = l2.d[ju];
            if (v >= iso) {
              sideD[dir] = (st - 1 + (iso - prev) / (v - prev)) * len;
              const jA = Math.min(nyL - 1, ju + S), jB = Math.max(0, ju - S);
              sideV[dir] = l2.d[jA] >= iso && l2.d[jB] >= iso ? 1 : 0;
              break;
            }
            prev = v;
          }
          if (Number.isFinite(sideD[dir])) {
            mask |= 1 << dir;
            closed++;
            if (sideD[dir] < minSide) {
              minSide = sideD[dir];
              minDir = dir;
            }
          }
        }
        // floor slope / convexity
        let slope = NaN;
        let falloff = 0;
        if (down <= ENV_T.floorNear) {
          const fy = y - down;
          const hx1 = floorAt(L(ix + 1, iz), ju, y), hx0 = floorAt(L(ix - 1, iz), ju, y);
          const hz1 = floorAt(L(ix, iz + 1), ju, y), hz0 = floorAt(L(ix, iz - 1), ju, y);
          const clampH = (h: number) => (Number.isFinite(h) ? h : fy - 2 * C);
          const gx = (clampH(hx1) - clampH(hx0)) / (2 * C);
          const gz = (clampH(hz1) - clampH(hz0)) / (2 * C);
          slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
          for (let dir = 0; dir < 8; dir++) {
            const l2 = L(ix + DIRS[dir * 2] * 2, iz + DIRS[dir * 2 + 1] * 2);
            if (l2.d[ju] >= iso) continue;
            if (fy - l2.below[ju] > ENV_T.ridgeDrop) falloff++;
          }
        }
        let canyon = false;
        for (let a = 0; a < 4 && !canyon; a++) {
          // opposite pairs (a, a+4): x, diagonal, z, other diagonal
          const gap = sideD[a] + sideD[a + 4];
          if (gap <= ENV_T.canyonGap && sideV[a] && sideV[a + 4]) {
            const p = (a + 2) % 8;
            canyon = !Number.isFinite(sideD[p]) || !Number.isFinite(sideD[(p + 4) % 8]);
          }
        }
        const nearVertical = minDir >= 0 && sideV[minDir] === 1;
        let k: number;
        if (up <= ENV_T.caveUp && closed >= ENV_T.caveClosed) k = ENV.CAVE;
        else if (up <= ENV_T.overhangUp) k = ENV.OVERHANG;
        else if (canyon) k = ENV.CANYON;
        else if (minSide <= ENV_T.cliffDist && nearVertical) k = ENV.CLIFF;
        else if (down <= ENV_T.ridgeFloor && slope <= ENV_T.ridgeSlope && falloff >= ENV_T.ridgeFalloff) k = ENV.RIDGE;
        else if (up > ENV_T.openClear && down > ENV_T.openClear && closed === 0) k = ENV.OPEN;
        else if (down <= ENV_T.floorNear) k = slope < ENV_T.flatSlope ? ENV.FLAT : ENV.SLOPE;
        else if (closed > 0) k = nearVertical ? ENV.CLIFF : ENV.SLOPE;
        else k = ENV.OPEN;
        const rid = longCol ? regionId[iz * nx + ix] : -1;
        const col = iz * nx + ix;
        if (rid === REGION.CANYON && ju < canyonRim[col] && up > ENV_T.overhangUp && k !== ENV.CAVE && k !== ENV.OVERHANG) k = ENV.CANYON;
        else if ((rid === REGION.CAVE && k !== ENV.CAVE) || (rid === REGION.CANYON && k !== ENV.CAVE && k !== ENV.OVERHANG)) k = longScan(ix, iz, ju, d0, up, k, rid, col);
        env[idx] = k;
        up8[idx] = q(up);
        down8[idx] = q(down);
        side8[idx] = q(minSide);
        sides[idx] = mask;
      }
    }
  }
  return { env, up8, down8, side8, sides, regionId, regionW, regionEdge };
}
