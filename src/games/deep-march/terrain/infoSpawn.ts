/**
 * Spawn candidates of one column's terrain classification (terrainInfoGen.ts,
 * format in terrainInfoData.ts): one per 1.5-unit world cell that contains
 * surface — the mesh vertex nearest to a seeded jitter point of the cell (cells
 * are owned by the column whose footprint contains the jitter point, so each
 * appears exactly once) — with its surface type, the water class in front,
 * exposure, shelter, curvature and macro region.
 */
import { latticeCoord } from "./columnLattice";
import { ENV, ENV_T, SURF, hash01, type ChunkTerrainInfo } from "./terrainInfo";
import { createRegionSample } from "./regions";
import { DIRS, type ColumnInfoInput, type InfoGeom } from "./infoGeom";
import type { LineAt } from "./infoLines";
import type { ClassGrid } from "./infoClassGrid";

export function spawnCandidates(inp: ColumnInfoInput, g: InfoGeom, L: LineAt, grid: ClassGrid): ChunkTerrainInfo["spawn"] {
  const { field, iso, n, sp, S, nyL, y0, gi0, gk0, ci0, cj0, ck0, nx, ny, nz, RING } = g;
  const { env, up8, sides } = grid;
  const s = field.settings;
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
    count, pos: sPos, nrm: sNrm, type: sType, env: sEnv, exposure: sExp, flags: sFlags, curv: sCurv,
    region: sRegion, regionW: sRegionW, regionEdge: sRegionEdge,
  };
}
