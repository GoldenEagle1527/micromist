/**
 * Hydraulic erosion for the 3D density terrain — droplet model ported from
 * Sebastian Lague's Hydraulic-Erosion (MIT, https://github.com/SebLague/Hydraulic-Erosion):
 * inertia, sediment capacity ∝ drop · speed · water, radial erode brush,
 * deposition when over capacity / flowing uphill, evaporation.
 *
 * Adapted from a heightmap to a density grid:
 * - a droplet lives ON the iso-surface of the column's (smoothed) density grid;
 *   it spawns on an upward-facing surface (rain settling from above), flows along
 *   gravity projected onto the tangent plane, and is re-projected onto the
 *   surface every step (Newton on the trilinear field). On walls / overhangs it
 *   falls to the next ledge below. "Height" = world y.
 * - eroding subtracts density with a spherical brush, depositing adds density
 *   trilinearly; amounts are surface displacements (cells) converted to density
 *   with the local gradient magnitude. Carve / deposit per node are capped so
 *   thin rock can't be punched through or sheets grown.
 * - carving skips solid nodes above the droplet and solid nodes with water ≤ 3
 *   cells below them, so shelves / roofs are never thinned into sheets (the rounded look from density smoothing stays).
 * - Seb's speed update `sqrt(v² + Δh·g)` slows droplets going downhill; here
 *   speed grows with the drop: `sqrt(max(0, v² − Δh·g))`.
 *
 * Determinism / seams: the simulation runs per column on its own padded grid
 * with a PRNG seeded by (seed, column), and every change is scaled by a mask
 * that is exactly 0 on the column's boundary lattice planes and their
 * neighbours (plus hard / always-water rows and removed floaters). Values and
 * gradients on shared seam points therefore equal the un-eroded field in every
 * column. The final change is quantised to 1/EROSION_QUANT so the grid, the
 * transferred Int8 copy (collision) and the mesh agree exactly.
 */
import type { TerrainSettings } from "./config";
import type { DensityField } from "./density";
import { mulberry32 } from "./noise";

export const EROSION_QUANT = 32;
const QMAX = 127;

export type ErosionGrid = {
  dens: Float32Array;
  px: number;
  py: number;
  pz: number;
  iso: number;
};

export type ErosionResult = {
  /** Quantised density change per grid point (units of 1/EROSION_QUANT). */
  delta: Int8Array;
  /**
   * Deposited sediment / carved depth per point (cells) for the material. Not
   * masked by the seam taper (the caller zeroes the seam plane), so the
   * visual erosion runs right up to column seams while the geometry fades.
   */
  sediment: Float32Array;
  carved: Float32Array;
  droplets: number;
  steps: number;
};

export function erosionSeed(seed: number, cx: number, cz: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (cx * 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (cz * 0x27d4eb2f), 0x165667b1) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Erode `grid.dens` in place. `mask` (0..1 per point) scales every change;
 * `rowLo..rowHi` bounds the rows droplets may spawn in.
 */
export function erodeGrid(
  grid: ErosionGrid,
  mask: Float32Array,
  rowLo: number,
  rowHi: number,
  s: TerrainSettings,
  seed: number,
  droplets: number,
): ErosionResult {
  const { dens, px, py, pz, iso } = grid;
  const plane = px * py;
  const size = plane * pz;
  const dF = new Float32Array(size); // float change during the simulation
  const sediment = new Float32Array(size);
  const carved = new Float32Array(size);
  const rng = mulberry32(seed);

  const R = s.hydroRadius;
  const Ri = Math.ceil(R);
  const bOff: number[] = [];
  const bDx: number[] = [];
  const bDy: number[] = [];
  const bDz: number[] = [];
  const bW: number[] = [];
  let wSum = 0;
  for (let dz = -Ri; dz <= Ri; dz++)
    for (let dy = -Ri; dy <= Ri; dy++)
      for (let dx = -Ri; dx <= Ri; dx++) {
        const d = Math.hypot(dx, dy, dz);
        if (d >= R) continue;
        const w = 1 - d / R;
        bOff.push((dz * py + dy) * px + dx);
        bDx.push(dx);
        bDy.push(dy);
        bDz.push(dz);
        bW.push(w);
        wSum += w;
      }
  for (let q = 0; q < bW.length; q++) bW[q] /= wSum;
  const maxCarve = s.hydroMaxCarve;
  const maxDep = s.hydroMaxDeposit;

  // trilinear value + gradient (per cell) at grid coords
  const g = new Float64Array(3);
  const sample = (x: number, y: number, z: number): number => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const fx = x - i, fy = y - j, fz = z - k;
    const o = (k * py + j) * px + i;
    const c000 = dens[o], c100 = dens[o + 1], c010 = dens[o + px], c110 = dens[o + px + 1];
    const c001 = dens[o + plane], c101 = dens[o + plane + 1], c011 = dens[o + plane + px], c111 = dens[o + plane + px + 1];
    const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
    const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
    const ex0 = (c100 - c000) + ((c110 - c010) - (c100 - c000)) * fy;
    const ex1 = (c101 - c001) + ((c111 - c011) - (c101 - c001)) * fy;
    g[0] = ex0 + (ex1 - ex0) * fz;
    g[1] = (x10 - x00) + ((x11 - x01) - (x10 - x00)) * fz;
    g[2] = y1 - y0;
    return y0 + (y1 - y0) * fz;
  };
  const inside = (x: number, y: number, z: number) =>
    x >= 1 && y >= 1 && z >= 1 && x < px - 2 && y < py - 2 && z < pz - 2;

  /** Walk down from (x, y, z) (in water) to the first water→rock crossing; NaN if none within maxDrop. */
  const findSurfaceBelow = (x: number, y: number, z: number, maxDrop: number): number => {
    let v = sample(x, y, z);
    if (v >= iso) return NaN;
    for (let t = 0.5; t <= maxDrop; t += 0.5) {
      const yy = y - t;
      if (yy < 1) return NaN;
      const v2 = sample(x, yy, z);
      if (v2 >= iso) return yy + 0.5 * ((v2 - iso) / (v2 - v));
      v = v2;
    }
    return NaN;
  };

  const deposit = (x: number, y: number, z: number, amount: number, gl: number) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const fx = x - i, fy = y - j, fz = z - k;
    for (let c = 0; c < 8; c++) {
      const cx = c & 1, cy = (c >> 1) & 1, cz = c >> 2;
      const w = (cx ? fx : 1 - fx) * (cy ? fy : 1 - fy) * (cz ? fz : 1 - fz);
      const o = ((k + cz) * py + (j + cy)) * px + (i + cx);
      sediment[o] += amount * w;
      const m = mask[o];
      if (m <= 0) continue;
      let dd = amount * w * m * gl;
      if (dF[o] + dd > maxDep) dd = Math.max(0, maxDep - dF[o]);
      dF[o] += dd;
      dens[o] += dd;
    }
  };

  let steps = 0;
  let used = 0;
  const lifetime = s.hydroLifetime;
  const inertia = s.hydroInertia;
  for (let d = 0; d < droplets; d++) {
    let x = 1 + rng() * (px - 3.001);
    let z = 1 + rng() * (pz - 3.001);
    let y0 = rowLo + rng() * (rowHi - rowLo);
    // started inside rock: climb to the water above it, then settle on that top surface
    while (y0 < rowHi && sample(x, y0, z) >= iso) y0 += 1;
    let y = findSurfaceBelow(x, y0, z, rowHi - rowLo);
    if (!Number.isFinite(y) || !inside(x, y, z)) continue;
    used++;
    let dx = 0, dy = 0, dz = 0;
    let speed = s.hydroInitialSpeed;
    let water = 1;
    let sed = 0;
    for (let life = 0; life < lifetime; life++) {
      sample(x, y, z); // fills g
      const gl = Math.hypot(g[0], g[1], g[2]);
      if (gl < 1e-4) break;
      const nx = -g[0] / gl, ny = -g[1] / gl, nz = -g[2] / gl;
      steps++;
      if (ny < s.hydroMinUp) {
        // Wall / overhang: fall to the next ledge below (keeps speed, gains from the drop).
        const ox = x + nx * 0.75, oz = z + nz * 0.75, oy = y + Math.max(0, ny) * 0.75;
        if (!inside(ox, oy, oz)) break;
        const ny2 = findSurfaceBelow(ox, oy, oz, 12);
        if (!Number.isFinite(ny2) || !inside(ox, ny2, oz)) break;
        speed = Math.sqrt(Math.max(0, speed * speed + (y - ny2) * s.hydroGravity * 0.25));
        x = ox;
        z = oz;
        y = ny2;
        continue;
      }
      // downhill tangent: gravity projected onto the tangent plane (|t| = sin slope)
      const tx = ny * nx, ty = -1 + ny * ny, tz = ny * nz;
      dx = dx * inertia + tx * (1 - inertia);
      dy = dy * inertia + ty * (1 - inertia);
      dz = dz * inertia + tz * (1 - inertia);
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) break;
      dx /= len;
      dy /= len;
      dz /= len;
      let qx = x + dx, qy = y + dy, qz = z + dz;
      if (!inside(qx, qy, qz)) break;
      // re-project onto the surface
      for (let it = 0; it < 2; it++) {
        const v = sample(qx, qy, qz);
        const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
        if (g2 < 1e-8) break;
        let t = (v - iso) / g2;
        const tl = Math.abs(t) * Math.sqrt(g2);
        if (tl > 1.5) t *= 1.5 / tl;
        qx -= g[0] * t;
        qy -= g[1] * t;
        qz -= g[2] * t;
        if (!inside(qx, qy, qz)) break;
      }
      if (!inside(qx, qy, qz)) break;
      const dh = qy - y;
      const cap = Math.max(-dh * speed * water * s.hydroCapacity, s.hydroMinCapacity);
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * s.hydroDepositSpeed;
        sed -= amt;
        deposit(x, y, z, amt, gl);
      } else {
        const amt = Math.min((cap - sed) * s.hydroErodeSpeed, -dh);
        const ci = Math.round(x), cj = Math.round(y), ck = Math.round(z);
        const c = (ck * py + cj) * px + ci;
        for (let q = 0; q < bW.length; q++) {
          const ii = ci + bDx[q], jj = cj + bDy[q], kk = ck + bDz[q];
          if (ii < 0 || jj < 0 || kk < 0 || ii >= px || jj >= py || kk >= pz) continue;
          const o = c + bOff[q];
          // material: what this droplet would carve here (unmasked, uncapped)
          carved[o] += amt * bW[q];
          sed += amt * bW[q];
          const m = mask[o];
          if (m <= 0) continue;
          // keep a minimum thickness: never thin rock that is < ~3 cells deep below
          // and never cut into rock above the droplet (overhangs / cave roofs)
          if (dens[o] >= iso - 0.5 && (bDy[q] > 0 || (jj >= 3 && (dens[o - 2 * px] < iso || dens[o - 3 * px] < iso)))) continue;
          let dd = amt * bW[q] * m * gl;
          if (dF[o] - dd < -maxCarve) dd = Math.max(0, dF[o] + maxCarve);
          dF[o] -= dd;
          dens[o] -= dd;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * s.hydroGravity));
      water *= 1 - s.hydroEvaporate;
      x = qx;
      y = qy;
      z = qz;
    }
  }

  // quantise: dens = original + q / QUANT exactly
  const delta = new Int8Array(size);
  for (let o = 0; o < size; o++) {
    const f = dF[o];
    if (f === 0) continue;
    const q = Math.max(-QMAX, Math.min(QMAX, Math.round(f * EROSION_QUANT)));
    delta[o] = q;
    dens[o] = dens[o] - f + q / EROSION_QUANT;
  }
  return { delta, sediment, carved, droplets: used, steps };
}

/** Column erosion deltas on the main thread: collision samples base field + trilinear delta. */
export class ErosionStore {
  private readonly cols = new Map<string, { data: Int8Array; j0: number; j1: number }>();
  private readonly n: number;
  private readonly sp: number;
  private readonly half: number;
  private readonly gjMin: number;
  constructor(n: number, sp: number, half: number, gjMin: number) {
    this.n = n;
    this.sp = sp;
    this.half = half;
    this.gjMin = gjMin;
  }

  /** data: owned points (i, k ∈ [0, n−2]) for rows j0..j1 (relative to gjMin), index ((j − j0)·(n−1) + k)·(n−1) + i. */
  set(cx: number, cz: number, data: Int8Array, j0: number, j1: number) {
    if (data.length === 0) this.cols.delete(`${cx},${cz}`);
    else this.cols.set(`${cx},${cz}`, { data, j0, j1 });
  }

  delete(cx: number, cz: number) {
    this.cols.delete(`${cx},${cz}`);
  }

  private at(gi: number, gj: number, gk: number): number {
    const m = this.n - 1;
    const cx = Math.floor(gi / m), cz = Math.floor(gk / m);
    const c = this.cols.get(`${cx},${cz}`);
    if (!c) return 0;
    const j = gj - this.gjMin;
    if (j < c.j0 || j > c.j1) return 0;
    return c.data[((j - c.j0) * m + (gk - cz * m)) * m + (gi - cx * m)];
  }

  /** Density change at a world position (trilinear over lattice points). */
  delta(x: number, y: number, z: number): number {
    if (this.cols.size === 0) return 0;
    const fx = (x + this.half) / this.sp, fy = (y + this.half) / this.sp, fz = (z + this.half) / this.sp;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    let v = 0;
    for (let c = 0; c < 8; c++) {
      const a = c & 1, b = (c >> 1) & 1, e = c >> 2;
      const q = this.at(i + a, j + b, k + e);
      if (q === 0) continue;
      v += q * (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (e ? tz : 1 - tz);
    }
    return v / EROSION_QUANT;
  }
}

/**
 * The field as rendered: base density + the columns' erosion delta. Collision
 * (and anything else that must match the mesh) samples through this.
 */
export function erodedField(field: DensityField, delta: (x: number, y: number, z: number) => number): DensityField {
  const sample = (x: number, y: number, z: number) => field.sample(x, y, z) + delta(x, y, z);
  return {
    ...field,
    sample,
    gradient: (x, y, z, out, h = 0.1) => {
      const inv = 1 / (2 * h);
      out[0] = (sample(x + h, y, z) - sample(x - h, y, z)) * inv;
      out[1] = (sample(x, y + h, z) - sample(x, y - h, z)) * inv;
      out[2] = (sample(x, y, z + h) - sample(x, y, z - h)) * inv;
    },
  };
}
