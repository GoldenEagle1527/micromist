/**
 * The omen's silhouette (MVP plan M8): a giant squid built of tubes — a tapered
 * mantle with two fins, eight arms and two long tentacles — ≈ 1.2k triangles,
 * never textured (only the sonar ever draws it, from hundreds of metres away).
 * Local frame: it swims mantle-first toward −z; the limbs trail along +z.
 * Pure: arrays for the renderer (omenMesh.ts) and the tests.
 *   aSway: 0 on the mantle, growing along each limb to 1 at its tip;
 *   aPhase: the limb's sway phase (rad).
 */
import { CHAOS_LOOK } from "./config";

export type OmenGeometry = { positions: Float32Array; normals: Float32Array; sway: Float32Array; phase: Float32Array; indices: Uint16Array; triangles: number };

type Tube = { from: [number, number, number]; to: [number, number, number]; r0: number; r1: number; rings: number; sides: number; sway0: number; sway1: number; phase: number };

class Builder {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly s: number[] = [];
  readonly ph: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, sway: number, phase: number): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.s.push(sway);
    this.ph.push(phase);
    return this.p.length / 3 - 1;
  }

  /** A tube along a straight axis with a linear radius taper; closed to a point where r = 0. */
  tube(t: Tube): void {
    const [ax, ay, az] = t.from, [bx, by, bz] = t.to;
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1;
    const w = [dx / len, dy / len, dz / len];
    // a frame around the axis
    const up = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(up, w)), v = cross(w, u);
    const base = this.p.length / 3;
    for (let i = 0; i <= t.rings; i++) {
      const k = i / t.rings, r = t.r0 + (t.r1 - t.r0) * k;
      const cx = ax + dx * k, cy = ay + dy * k, cz = az + dz * k;
      const sway = t.sway0 + (t.sway1 - t.sway0) * k;
      for (let j = 0; j < t.sides; j++) {
        const a = (j / t.sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = u[0] * ca + v[0] * sa, ny = u[1] * ca + v[1] * sa, nz = u[2] * ca + v[2] * sa;
        this.vertex(cx + nx * r, cy + ny * r, cz + nz * r, nx, ny, nz, sway, t.phase);
      }
    }
    for (let i = 0; i < t.rings; i++) {
      for (let j = 0; j < t.sides; j++) {
        const a = base + i * t.sides + j, b = base + i * t.sides + ((j + 1) % t.sides);
        const c = a + t.sides, d = b + t.sides;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }

  /** A flat fin: a fan of triangles in the x–z plane on one side. */
  fin(side: number, z0: number, z1: number, span: number): void {
    const root0 = this.vertex(side * 0.6, 0, z0, 0, 1, 0, 0, 0);
    const root1 = this.vertex(side * 1.8, 0, z1, 0, 1, 0, 0, 0);
    const tip = this.vertex(side * span, 0, (z0 + z1) * 0.5, 0, 1, 0, 0.15, side);
    const mid = this.vertex(side * span * 0.7, 0, z1 - (z1 - z0) * 0.15, 0, 1, 0, 0.1, side);
    this.idx.push(root0, tip, root1, root1, tip, mid);
  }
}

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function buildOmenGeometry(size = CHAOS_LOOK.omen.body): OmenGeometry {
  const b = new Builder();
  const M = size.mantle, A = size.arm, T = size.tentacle, R = size.radius;
  // mantle: a pointed cone to the tip, then the head
  b.tube({ from: [0, 0, -M], to: [0, 0, -M * 0.35], r0: 0.001, r1: R, rings: 5, sides: 12, sway0: 0, sway1: 0, phase: 0 });
  b.tube({ from: [0, 0, -M * 0.35], to: [0, 0, 0], r0: R, r1: R * 0.7, rings: 4, sides: 12, sway0: 0, sway1: 0.02, phase: 0 });
  b.fin(1, -M, -M * 0.7, R * 2.6);
  b.fin(-1, -M, -M * 0.7, R * 2.6);
  // eight arms fanning slightly outward, two long tentacles between them
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, sx = Math.cos(a) * R * 0.5, sy = Math.sin(a) * R * 0.5;
    b.tube({ from: [sx, sy, 0], to: [sx * 2.2, sy * 2.2, A], r0: R * 0.2, r1: 0.05, rings: 8, sides: 6, sway0: 0.05, sway1: 1, phase: a });
  }
  for (const side of [-1, 1]) {
    b.tube({ from: [side * R * 0.2, 0, 0], to: [side * R * 0.9, -R * 0.4, T], r0: R * 0.1, r1: 0.04, rings: 12, sides: 5, sway0: 0.05, sway1: 1.4, phase: side * 2.1 });
  }
  return {
    positions: new Float32Array(b.p),
    normals: new Float32Array(b.n),
    sway: new Float32Array(b.s),
    phase: new Float32Array(b.ph),
    indices: new Uint16Array(b.idx),
    triangles: b.idx.length / 3,
  };
}
