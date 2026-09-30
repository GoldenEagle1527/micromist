/**
 * Low-poly building blocks for the base's buildings (structureGeometry.ts):
 * faceted frustum bands, caps and slanted slabs, flat-shaded (every triangle
 * its own face normal: the facets read as hewn stone / cast hull), plus a
 * per-vertex glow weight (0 hull, 1 light strip, 2 lantern). Pure geometry
 * arrays; no three import, so the triangle counts are testable anywhere.
 */
export type ShapeArrays = { position: number[]; normal: number[]; glow: number[] };

type V3 = [number, number, number];

export class ShapeBuilder {
  readonly a: ShapeArrays = { position: [], normal: [], glow: [] };

  get triangles(): number {
    return this.a.position.length / 9;
  }

  tri(p: V3, q: V3, r: V3, glow: number): void {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [p, q, r]) {
      this.a.position.push(v[0], v[1], v[2]);
      this.a.normal.push(nx, ny, nz);
      this.a.glow.push(glow);
    }
  }

  quad(p: V3, q: V3, r: V3, s: V3, glow: number): void {
    this.tri(p, q, r, glow);
    this.tri(p, r, s, glow);
  }

  /** Side of a frustum: `sides` facets from (y0, r0) to (y1, r1), each ring turned by its twist (rad). */
  band(sides: number, y0: number, r0: number, y1: number, r1: number, glow = 0, twist0 = 0, twist1 = twist0): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0: V3 = [Math.cos(a0 + twist0) * r0, y0, Math.sin(a0 + twist0) * r0];
      const p1: V3 = [Math.cos(a1 + twist0) * r0, y0, Math.sin(a1 + twist0) * r0];
      const q0: V3 = [Math.cos(a0 + twist1) * r1, y1, Math.sin(a0 + twist1) * r1];
      const q1: V3 = [Math.cos(a1 + twist1) * r1, y1, Math.sin(a1 + twist1) * r1];
      this.quad(p0, q0, q1, p1, glow);
    }
  }

  /** Flat annulus / disc at height y facing up (r0 outer → r1 inner; r1 = 0: disc). */
  cap(sides: number, y: number, r0: number, r1 = 0, glow = 0, twist = 0): void {
    this.band(sides, y, r0, y, r1, glow, twist);
  }

  /** Cone from (y0, r0) to an apex at y1. */
  cone(sides: number, y0: number, r0: number, y1: number, glow = 0, twist = 0): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2 + twist, a1 = ((i + 1) / sides) * Math.PI * 2 + twist;
      this.tri([Math.cos(a0) * r0, y0, Math.sin(a0) * r0], [0, y1, 0], [Math.cos(a1) * r0, y0, Math.sin(a1) * r0], glow);
    }
  }

  /**
   * A slanted slab (buttress / fin / rib) at heading `angle`: from the foot
   * (radius rFoot, height yFoot) to the head (rHead, yHead), `width` across and
   * `depth` radially at the foot (the head is `taper` × as deep). 5 faces (no bottom).
   */
  slab(angle: number, rFoot: number, yFoot: number, rHead: number, yHead: number, width: number, depth: number, taper = 0.5, glow = 0): void {
    const c = Math.cos(angle), s = Math.sin(angle);
    const pt = (r: number, y: number, w: number): V3 => [c * r - s * w, y, s * r + c * w];
    const h = width / 2, dh = depth * taper;
    const f = [pt(rFoot, yFoot, -h), pt(rFoot, yFoot, h), pt(rFoot - depth, yFoot, h), pt(rFoot - depth, yFoot, -h)];
    const t = [pt(rHead, yHead, -h), pt(rHead, yHead, h), pt(rHead - dh, yHead, h), pt(rHead - dh, yHead, -h)];
    this.quad(f[0], t[0], t[1], f[1], glow); // outer edge
    this.quad(f[1], t[1], t[2], f[2], glow);
    this.quad(f[3], t[3], t[0], f[0], glow);
    this.quad(f[2], t[2], t[3], f[3], glow);
    this.quad(t[0], t[3], t[2], t[1], glow); // top
  }
}
