/**
 * Building ground on the density field (mode-agnostic; conserve's base, M5):
 * where the diver aims, and whether a footprint of radius r and height h can
 * stand there (design doc §6.1, measured on the smoothed field itself, the
 * same on every device):
 *   no-ground  the aim ray hits nothing, or the point is not under open water;
 *   slope      the best-fit plane of the footprint is steeper than `slopeMax`;
 *   rough      a rim point has no floor near the plane, a bump / hole beyond
 *              GROUND.roughness, or a dip deeper than the skirt covers;
 *   clearance  rock within the building's height above the footprint;
 *   blend      the footprint centre sits on a biome blend (regionW < 0.6).
 * The result's y is the centre floor; `sink` is how deep the skirt must reach.
 */
import { GROUND } from "./anchorConfig";
import type { DensityField } from "./density";
import { createRegionSample } from "./regions";

export type GroundReason = "ok" | "no-ground" | "slope" | "rough" | "clearance" | "blend";

export type GroundSpec = { radius: number; height: number; slopeMax: number };

export type GroundResult = { reason: GroundReason; x: number; y: number; z: number; slopeDeg: number; sink: number };

export type Vec3Like = { x: number; y: number; z: number };

export class GroundProbe {
  private readonly field: DensityField;
  private readonly iso: number;
  private readonly rs = createRegionSample();
  private readonly pts: number[] = [];

  constructor(field: DensityField) {
    this.field = field;
    this.iso = field.settings.isoLevel;
  }

  private solid(x: number, y: number, z: number): boolean {
    return this.field.sample(x, y, z) >= this.iso;
  }

  /** First rock along the ray from `eye` in direction `dir` (unit), within GROUND.reach; null = none. */
  pick(eye: Vec3Like, dir: Vec3Like, reach: number = GROUND.reach): Vec3Like | null {
    let prev = 0;
    for (let t: number = GROUND.rayStep; t <= reach; t += GROUND.rayStep) {
      if (!this.solid(eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t)) {
        prev = t;
        continue;
      }
      let lo = prev, hi = t;
      for (let i = 0; i < GROUND.refine; i++) {
        const m = (lo + hi) / 2;
        if (this.solid(eye.x + dir.x * m, eye.y + dir.y * m, eye.z + dir.z * m)) hi = m;
        else lo = m;
      }
      return { x: eye.x + dir.x * lo, y: eye.y + dir.y * lo, z: eye.z + dir.z * lo };
    }
    return null;
  }

  /** Highest water → rock crossing going down from `top` over `depth` metres; null = none (or `top` in rock). */
  floorAt(x: number, top: number, z: number, depth: number): number | null {
    if (this.solid(x, top, z)) return null;
    let prev = top;
    for (let y: number = top - GROUND.scanStep; y >= top - depth; y -= GROUND.scanStep) {
      if (!this.solid(x, y, z)) {
        prev = y;
        continue;
      }
      let lo = y, hi = prev;
      for (let i = 0; i < GROUND.refine; i++) {
        const m = (lo + hi) / 2;
        if (this.solid(x, m, z)) lo = m;
        else hi = m;
      }
      return hi;
    }
    return null;
  }

  /** Can a footprint `spec` stand on the floor under (x, near, z)? */
  footprint(x: number, near: number, z: number, spec: GroundSpec): GroundResult {
    const out: GroundResult = { reason: "no-ground", x, y: near, z, slopeDeg: 0, sink: 0 };
    const y0 = this.floorAt(x, near + GROUND.scanAbove, z, GROUND.scanAbove + GROUND.scanBelow);
    if (y0 === null) return out;
    out.y = y0;
    const fit = this.fitPlane(x, y0, z, spec);
    if (!fit) return { ...out, reason: "rough" };
    out.slopeDeg = fit.slopeDeg;
    out.sink = y0 - fit.minY;
    if (fit.slopeDeg > spec.slopeMax) return { ...out, reason: "slope" };
    if (fit.resid > GROUND.roughness || out.sink > GROUND.skirt) return { ...out, reason: "rough" };
    if (!this.clear(x, y0, z, spec)) return { ...out, reason: "clearance" };
    const region = this.field.regions.sample(x, z, this.rs);
    if (region.dominant < GROUND.regionMin) return { ...out, reason: "blend" };
    return { ...out, reason: "ok" };
  }

  /** Floors of the rim / half-radius samples → least-squares plane y = a + b·dx + c·dz. */
  private fitPlane(x: number, y0: number, z: number, spec: GroundSpec): { slopeDeg: number; resid: number; minY: number } | null {
    const reach = spec.radius * Math.tan((spec.slopeMax * Math.PI) / 180) + GROUND.roughness + 1;
    const p = this.pts;
    p.length = 0;
    p.push(0, y0, 0);
    for (const f of [1, 0.5]) {
      for (let i = 0; i < GROUND.rimPoints; i++) {
        const a = (i / GROUND.rimPoints) * Math.PI * 2 + (f < 1 ? Math.PI / GROUND.rimPoints : 0);
        const dx = Math.cos(a) * spec.radius * f, dz = Math.sin(a) * spec.radius * f;
        const y = this.floorAt(x + dx, y0 + reach, z + dz, 2 * reach);
        if (y === null) return null;
        p.push(dx, y, dz);
      }
    }
    // normal equations of the plane fit (Σ dx = Σ dz = 0 by symmetry, but kept general)
    let n = 0, sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0, minY = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i], y = p[i + 1], dz = p[i + 2];
      n++; sx += dx; sz += dz; sy += y; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxy += dx * y; szy += dz * y;
      minY = Math.min(minY, y);
    }
    const mx = sx / n, mz = sz / n, my = sy / n;
    const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxy = sxy / n - mx * my, czy = szy / n - mz * my;
    const det = cxx * czz - cxz * cxz || 1e-9;
    const b = (cxy * czz - czy * cxz) / det, c = (czy * cxx - cxy * cxz) / det;
    let resid = 0;
    for (let i = 0; i < p.length; i += 3) resid = Math.max(resid, Math.abs(p[i + 1] - (my + b * (p[i] - mx) + c * (p[i + 2] - mz))));
    return { slopeDeg: (Math.atan(Math.hypot(b, c)) * 180) / Math.PI, resid, minY };
  }

  /** Water from just above the floor to the building's top, at the centre and 4 inner points. */
  private clear(x: number, y0: number, z: number, spec: GroundSpec): boolean {
    const r = spec.radius * GROUND.clearanceAt;
    const cols = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    const lift = spec.radius * Math.tan((spec.slopeMax * Math.PI) / 180) + 1;
    for (const [dx, dz] of cols) {
      for (let h: number = dx || dz ? lift : 1; h <= spec.height; h += GROUND.clearanceStep) {
        if (this.solid(x + dx, y0 + h, z + dz)) return false;
      }
    }
    return true;
  }
}
