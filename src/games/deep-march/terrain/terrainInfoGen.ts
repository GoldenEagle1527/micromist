/**
 * Worker-side builder of ChunkTerrainInfo (see terrainInfo.ts for the format).
 * Runs inside generateColumnMesh after floater removal and meshing; uses the
 * column's final density grid for its own cells, a line sampler (bit-identical
 * to the mesher's own arithmetic) for a 3-cell ring, and the mesh vertices for
 * spawn candidates. No ray marching: vertical distances come from full-height
 * line scans, horizontal ones from ≤ 3-cell grid scans with linear refinement.
 */
import type { DensityField } from "./density";
import { columnRegionMask, columnRowPlan, latticeCoord, latticeSpacing, type ColumnRows } from "./mesher";
import { ENV, ENV_T, SURF, hash01, type ChunkTerrainInfo } from "./terrainInfo";
import { REGION, createRegionSample } from "./regions";

/** 8 horizontal directions (dx, dz): +x, +x+z, +z, −x+z, −x, −x−z, −z, +x−z. */
const DIRS = [1, 0, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1];

export type LineSampler = (gi: number, gk: number, out: Float32Array) => void;

/**
 * Final density along the full-height lattice line (gi, gk), rows gjMin … gjMax,
 * computed exactly like the owning column's mesher does (same raw sample
 * coordinates, same row plan of the owning column's region mask, same smoothing
 * order, same Float32 rounding) — before floater removal.
 */
export function createLineSampler(field: DensityField, rows: ColumnRows): LineSampler {
  const s = field.settings;
  const n = s.numPointsPerAxis;
  const sp = latticeSpacing(field);
  const y0 = latticeCoord(rows.gjMin, field);
  const K = s.smoothCells;
  const SW = field.smoothWeights;
  const half = (SW.length - 1) / 2;
  const R = half * K;
  const fill = new Float32Array(1);
  let raw = new Float32Array(0);
  const needCache = new Map<number, Uint8Array>();
  return (gi, gk, out) => {
    const oi = Math.floor(gi / (n - 1)) * (n - 1);
    const ok = Math.floor(gk / (n - 1)) * (n - 1);
    const mask = columnRegionMask(field, oi / (n - 1), ok / (n - 1));
    const plan = columnRowPlan(field, rows, mask);
    const { py, rowSkip, rowFill } = plan;
    const ny = py - 2;
    let rawNeed = needCache.get(mask);
    if (!rawNeed) {
      rawNeed = new Uint8Array(py + 2 * R);
      for (let j = 0; j < py; j++) if (!rowSkip[j]) for (let d = 0; d <= 2 * R; d++) rawNeed[j + d] = 1;
      needCache.set(mask, rawNeed);
    }
    if (raw.length < py + 2 * R) raw = new Float32Array(py + 2 * R);
    const wx = latticeCoord(oi, field) + (gi - oi) * sp;
    const wz = latticeCoord(ok, field) + (gk - ok) * sp;
    for (let r = 0; r < py + 2 * R; r++) if (rawNeed[r]) raw[r] = field.sampleRaw(wx, y0 + (r - R - 1) * sp, wz);
    for (let ju = 0; ju < ny; ju++) {
      const j = ju + 1;
      if (rowSkip[j]) {
        fill[0] = rowFill[j];
        out[ju] = fill[0];
        continue;
      }
      const c = j + R;
      let v = 0;
      for (let t = 0; t < SW.length; t++) v += SW[t] * raw[c + (t - half) * K];
      out[ju] = v;
    }
  };
}

export type ColumnInfoInput = {
  field: DensityField;
  rows: ColumnRows;
  cx: number;
  cz: number;
  /** Padded final density grid of the column (index (k·py + j)·px + i, padding 1). */
  dens: Float32Array;
  px: number;
  py: number;
  positions: Float32Array;
  normals: Float32Array;
  ao: Float32Array;
  sampler: LineSampler;
  /** Test/reference: read own lines from the sampler too (ignores floater removal). */
  ownFromSampler?: boolean;
  /** Column removed no floating rock → its own lines equal the sampler bit-for-bit and may be cached. */
  floaterFree?: boolean;
};

/**
 * Per-field cache of sampled lines (a worker meshes many neighbouring columns;
 * rings overlap each other and neighbours' own lines). Values are bit-identical
 * to fresh samples, so the cache never changes results.
 */
const LINE_CACHE_CAP = 6000;
const lineCaches = new WeakMap<DensityField, Map<number, Float32Array>>();
const lineKey = (gi: number, gk: number) => (gi + 50000) * 100000 + (gk + 50000);
function cachePut(cache: Map<number, Float32Array>, key: number, d: Float32Array) {
  if (cache.has(key)) return;
  if (cache.size >= LINE_CACHE_CAP) {
    // drop the oldest ~10 % (Map iterates in insertion order)
    let drop = LINE_CACHE_CAP / 10;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (--drop <= 0) break;
    }
  }
  cache.set(key, d);
}
export const lineCacheStats = { hits: 0, misses: 0 };

type Line = { d: Float32Array; above: Float32Array; below: Float32Array };

export function buildColumnTerrainInfo(inp: ColumnInfoInput): ChunkTerrainInfo {
  const { field, rows, cx, cz, dens, px, py } = inp;
  const s = field.settings;
  const iso = s.isoLevel;
  const n = s.numPointsPerAxis;
  const sp = latticeSpacing(field);
  const S = Math.max(1, Math.round(ENV_T.classSpacing / sp));
  const C = S * sp;
  const { gjMin, gjMax } = rows;
  const nyL = gjMax - gjMin + 1;
  const y0 = latticeCoord(gjMin, field);
  const gi0 = cx * (n - 1);
  const gk0 = cz * (n - 1);
  const ci0 = Math.ceil(gi0 / S), ci1 = Math.floor((gi0 + n - 2) / S);
  const ck0 = Math.ceil(gk0 / S), ck1 = Math.floor((gk0 + n - 2) / S);
  const cj0 = Math.ceil(gjMin / S), cj1 = Math.floor(gjMax / S);
  const nx = ci1 - ci0 + 1, nz = ck1 - ck0 + 1, ny = cj1 - cj0 + 1;
  // Region-aware reach: columns near the cave warren / canyon belt scan farther.
  const colMask = columnRegionMask(field, cx, cz);
  const longCol = (colMask & ((1 << REGION.CAVE) | (1 << REGION.CANYON))) !== 0;
  const RING = longCol ? ENV_T.ringAxisLong : ENV_T.ringAxis;

  // ---- lines (own from the final grid, ring from the sampler) ----
  const LW = nx + 2 * RING;
  const LD = nz + 2 * RING;
  const lines: Line[] = new Array(LW * LD);
  let cache = lineCaches.get(field);
  if (!cache) lineCaches.set(field, (cache = new Map()));
  const makeLine = (li: number, lk: number): Line => {
    const ci = ci0 - RING + li, ck = ck0 - RING + lk;
    let d: Float32Array;
    const key = lineKey(ci * S, ck * S);
    if (!inp.ownFromSampler && li >= RING && li < RING + nx && lk >= RING && lk < RING + nz) {
      d = new Float32Array(nyL);
      const i = ci * S - gi0, k = ck * S - gk0;
      for (let ju = 0; ju < nyL; ju++) d[ju] = dens[((k + 1) * py + (ju + 1)) * px + (i + 1)];
      if (inp.floaterFree) cachePut(cache, key, d);
    } else {
      const hit = inp.ownFromSampler ? undefined : cache.get(key);
      if (hit) {
        d = hit;
        lineCacheStats.hits++;
      } else {
        d = new Float32Array(nyL);
        inp.sampler(ci * S, ck * S, d);
        lineCacheStats.misses++;
        if (!inp.ownFromSampler) cachePut(cache, key, d);
      }
    }
    // Nearest rock surface above / below each row (linear crossing between rows).
    const above = new Float32Array(nyL);
    const below = new Float32Array(nyL);
    let a = Infinity;
    for (let ju = nyL - 1; ju >= 0; ju--) {
      const y = y0 + ju * sp;
      if (d[ju] >= iso) a = y;
      else if (ju + 1 < nyL && d[ju + 1] >= iso) a = y + ((iso - d[ju]) / (d[ju + 1] - d[ju])) * sp;
      above[ju] = a;
    }
    let b = -Infinity;
    for (let ju = 0; ju < nyL; ju++) {
      const y = y0 + ju * sp;
      if (d[ju] >= iso) b = y;
      else if (ju > 0 && d[ju - 1] >= iso) b = y - ((iso - d[ju]) / (d[ju - 1] - d[ju])) * sp;
      below[ju] = b;
    }
    return { d, above, below };
  };
  for (let lk = 0; lk < LD; lk++) for (let li = 0; li < LW; li++) lines[lk * LW + li] = makeLine(li, lk);
  /** Line at class index offset (ix, iz) relative to the own-grid origin (may be in the ring). */
  const L = (ix: number, iz: number) => lines[(iz + RING) * LW + ix + RING];

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
  const longD = new Float64Array(8);
  const longV = new Uint8Array(8);
  const longTop = new Int32Array(8); // row where the wall hit in each direction ends (first water row above)
  // Canyon belt: water between two trench walls, below their crest, reads as canyon
  // (row index up to which the column is canyon; −1 = none yet).
  const canyonRim = new Int32Array(nx * nz).fill(-1);

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
          const g = sideD[a] + sideD[a + 4];
          if (g <= ENV_T.canyonGap && sideV[a] && sideV[a + 4]) {
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
        else if ((rid === REGION.CAVE && k !== ENV.CAVE) || (rid === REGION.CANYON && k !== ENV.CAVE && k !== ENV.OVERHANG)) {
          // long horizontal scans (same arithmetic as above, farther reach)
          let closedL = 0;
          for (let dir = 0; dir < 8; dir++) {
            const dx = DIRS[dir * 2], dz = DIRS[dir * 2 + 1];
            const diag = dx !== 0 && dz !== 0;
            const steps = diag ? ENV_T.ringDiagLong : ENV_T.ringAxisLong;
            const len = diag ? C * Math.SQRT2 : C;
            let prev = d0;
            longD[dir] = Infinity;
            longV[dir] = 0;
            for (let st = 1; st <= steps; st++) {
              const l2 = L(ix + dx * st, iz + dz * st);
              const v = l2.d[ju];
              if (v >= iso) {
                longD[dir] = (st - 1 + (iso - prev) / (v - prev)) * len;
                const jA = Math.min(nyL - 1, ju + S), jB = Math.max(0, ju - S);
                longV[dir] = l2.d[jA] >= iso && l2.d[jB] >= iso ? 1 : 0;
                // crest of that wall: highest rock top (at this row) among the lines out to the reach
                let top = ju;
                for (let s2 = st; s2 <= steps; s2++) {
                  const l3 = L(ix + dx * s2, iz + dz * s2);
                  if (l3.d[ju] < iso) continue;
                  let t = ju;
                  while (t < nyL && l3.d[t] >= iso) t++;
                  if (t > top) top = t;
                }
                longTop[dir] = top;
                break;
              }
              prev = v;
            }
            if (longD[dir] <= ENV_T.caveReachLong) closedL++;
          }
          if (rid === REGION.CAVE) {
            if ((up <= ENV_T.caveUpLong && closedL >= ENV_T.caveClosedLong) || (up <= ENV_T.overhangUp && closedL >= ENV_T.caveClosedLong - 1)) k = ENV.CAVE;
          } else if (up > ENV_T.overhangUp) {
            let rimPair = -1;
            for (let a = 0; a < 4; a++) {
              const g = longD[a] + longD[a + 4];
              if (g <= ENV_T.canyonGapLong && (longV[a] || longV[a + 4])) {
                const p = (a + 2) % 8;
                if (!Number.isFinite(longD[p]) || !Number.isFinite(longD[(p + 4) % 8])) {
                  k = ENV.CANYON;
                  rimPair = a;
                  break;
                }
                if (k === ENV.CANYON && rimPair < 0) rimPair = a; // canyon by the short rule
              }
            }
            // the cells above stay canyon up to the lower of the two walls' crests
            if (k === ENV.CANYON && rimPair >= 0) canyonRim[col] = Math.max(canyonRim[col], Math.min(longTop[rimPair], longTop[rimPair + 4]));
          }
        }
        env[idx] = k;
        up8[idx] = q(up);
        down8[idx] = q(down);
        side8[idx] = q(minSide);
        sides[idx] = mask;
      }
    }
  }

  // ---- (b) spawn candidates ----
  const pos = inp.positions, nrm = inp.normals, ao = inp.ao;
  const V = pos.length / 3;
  const h = s.boundsSize / 2;
  const fx0 = latticeCoord(gi0, field), fx1 = latticeCoord(gi0 + n - 1, field);
  const fz0 = latticeCoord(gk0, field), fz1 = latticeCoord(gk0 + n - 1, field);
  const CELL = ENV_T.spawnCell;
  const seed = field.seed;
  const cellBest = new Map<number, number>(); // cell key → best vertex
  const cellDist = new Map<number, number>();
  const cellKey = (a: number, b: number, c: number) => ((a + 4096) * 8192 + (b + 4096)) * 8192 + (c + 4096);
  for (let v = 0; v < V; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const a = Math.floor(x / CELL), b = Math.floor(y / CELL), c = Math.floor(z / CELL);
    const tx = (a + 0.15 + 0.7 * hash01(seed, a, b, c, 1)) * CELL;
    const tz = (c + 0.15 + 0.7 * hash01(seed, a, b, c, 3)) * CELL;
    if (tx < fx0 || tx >= fx1 || tz < fz0 || tz >= fz1) continue; // cell owned by another column
    const ty = (b + 0.15 + 0.7 * hash01(seed, a, b, c, 2)) * CELL;
    const key = cellKey(a, b, c);
    const dd = (x - tx) * (x - tx) + (y - ty) * (y - ty) + (z - tz) * (z - tz);
    const prev = cellDist.get(key);
    if (prev === undefined || dd < prev || (dd === prev && v < cellBest.get(key)!)) {
      cellDist.set(key, dd);
      cellBest.set(key, v);
    }
  }
  // Vertex hash (1-unit buckets) for curvature.
  const bucket = new Map<number, number[]>();
  const R = ENV_T.curvRadius;
  for (let v = 0; v < V; v++) {
    const key = cellKey(Math.floor(pos[v * 3] / R), Math.floor(pos[v * 3 + 1] / R), Math.floor(pos[v * 3 + 2] / R));
    let arr = bucket.get(key);
    if (!arr) bucket.set(key, (arr = []));
    arr.push(v);
  }
  const chosen = [...cellBest.values()].sort((a, b) => a - b);
  const count = chosen.length;
  const sPos = new Float32Array(count * 3);
  const sNrm = new Int8Array(count * 3);
  const sType = new Uint8Array(count);
  const sEnv = new Uint8Array(count);
  const sExp = new Uint8Array(count);
  const sFlags = new Uint8Array(count);
  const sCurv = new Int8Array(count);
  const sRegion = new Uint8Array(count);
  const sRegionW = new Uint8Array(count);
  const sRegionEdge = new Uint8Array(count);
  const rs = createRegionSample();
  const cellOf = (wx: number, wy: number, wz: number) => {
    const ix = Math.min(nx - 1, Math.max(0, Math.round((wx + h) / sp / S) - ci0));
    const iz = Math.min(nz - 1, Math.max(0, Math.round((wz + h) / sp / S) - ck0));
    const iy = Math.min(ny - 1, Math.max(0, Math.round((wy + h) / sp / S) - cj0));
    return (iz * ny + iy) * nx + ix;
  };
  for (let o = 0; o < count; o++) {
    const v = chosen[o];
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const nX = nrm[v * 3], nY = nrm[v * 3 + 1], nZ = nrm[v * 3 + 2];
    // curvature: mean height of neighbours over the tangent plane (+ = concave)
    let sum = 0, cnt = 0;
    const bx = Math.floor(x / R), by = Math.floor(y / R), bz = Math.floor(z / R);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const arr = bucket.get(cellKey(bx + dx, by + dy, bz + dz));
      if (!arr) continue;
      for (const w of arr) {
        const ex = pos[w * 3] - x, ey = pos[w * 3 + 1] - y, ez = pos[w * 3 + 2] - z;
        const r2 = ex * ex + ey * ey + ez * ez;
        if (r2 > R * R || r2 < 1e-6) continue;
        sum += ex * nX + ey * nY + ez * nZ;
        cnt++;
      }
    }
    const curvRaw = cnt ? sum / cnt / R : 0; // + concave
    const curv = -curvRaw; // report + convex
    // water cell in front
    let ci = cellOf(x + nX * ENV_T.frontOffset, y + nY * ENV_T.frontOffset, z + nZ * ENV_T.frontOffset);
    if (env[ci] === ENV.ROCK) ci = cellOf(x + nX * 2 * ENV_T.frontOffset, y + nY * 2 * ENV_T.frontOffset, z + nZ * 2 * ENV_T.frontOffset);
    const e = env[ci];
    let open = 0;
    if (e !== ENV.ROCK) {
      for (let dir = 0; dir < 8; dir++) if (!(sides[ci] & (1 << dir))) open++;
      if (up8[ci] > ENV_T.openClear * 4) open++;
    }
    const exposure = open / 9;
    const sheltered = exposure < ENV_T.shelteredExposure || e === ENV.CAVE || e === ENV.OVERHANG || ao[v] < ENV_T.shelteredAo;
    const floorish = nY >= 0.45;
    let type: number;
    if (nY < -0.45) type = SURF.CEILING;
    else if (floorish && e === ENV.CAVE) type = SURF.CAVE_FLOOR;
    else if (curvRaw >= ENV_T.concave) type = SURF.CREVICE;
    else if (nY >= 0.6 && ledge(x, y, z)) type = SURF.LEDGE_TOP;
    else if (curvRaw <= ENV_T.convex && nY >= ENV_T.ridgeMinNy) type = SURF.RIDGE;
    else type = nY >= 0.8 ? SURF.FLOOR_FLAT : floorish ? SURF.FLOOR_SLOPE : SURF.WALL;
    sPos[o * 3] = x;
    sPos[o * 3 + 1] = y;
    sPos[o * 3 + 2] = z;
    sNrm[o * 3] = Math.round(nX * 127);
    sNrm[o * 3 + 1] = Math.round(nY * 127);
    sNrm[o * 3 + 2] = Math.round(nZ * 127);
    sType[o] = type;
    sEnv[o] = e;
    sExp[o] = Math.round(exposure * 255);
    sFlags[o] = sheltered ? 1 : 0;
    sCurv[o] = Math.max(-127, Math.min(127, Math.round(curv * 127)));
    field.regions.sample(x, z, rs);
    sRegion[o] = rs.id;
    sRegionW[o] = Math.round(rs.dominant * 255);
    sRegionEdge[o] = Math.round(rs.edge);
  }

  /** Floor 1–2 cells aside (4 axis directions) lies ≥ ledgeDrop below y. */
  function ledge(x: number, y: number, z: number): boolean {
    const ix = Math.round((x + h) / sp / S) - ci0;
    const iz = Math.round((z + h) / sp / S) - ck0;
    const ju = Math.min(nyL - 1, Math.max(0, Math.ceil((y - y0) / sp) + 1));
    const yr = y0 + ju * sp;
    for (let dir = 0; dir < 8; dir += 2) {
      for (let st = 1; st <= 2; st++) {
        const lx = ix + DIRS[dir * 2] * st, lz = iz + DIRS[dir * 2 + 1] * st;
        if (lx < -RING || lz < -RING || lx >= nx + RING || lz >= nz + RING) continue;
        const l2 = L(lx, lz);
        if (l2.d[ju] >= iso) break; // rock rises: not a drop this way
        if (y - Math.max(l2.below[ju], yr - 99) >= ENV_T.ledgeDrop) return true;
      }
    }
    return false;
  }

  return {
    cx, cz, stride: S, spacing: C, ci0, cj0, ck0, nx, ny, nz,
    env, up: up8, down: down8, side: side8, sides, regionId, regionW, regionEdge,
    spawn: {
      count, pos: sPos, nrm: sNrm, type: sType, env: sEnv, exposure: sExp, flags: sFlags, curv: sCurv,
      region: sRegion, regionW: sRegionW, regionEdge: sRegionEdge,
    },
  };
}
