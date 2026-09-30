/**
 * test:scan — the pure pieces under the record: the grid's quantisation (one world
 * grid for every tile), normals, and the sphere cut (in + out = the triangle, the
 * crossings bit-identical on both sides, winding kept).
 */
import { SCAN_GRID, decodeNormal, dequantXZ, encodeNormal, quantXZ, snapXZ } from "../../src/games/deep-march/scene/sonarScan/scanGrid";
import { clipSoup, type Sphere } from "../../src/games/deep-march/scene/sonarScan/sphereClip";
import { newSoup, soupTris, type Soup } from "../../src/games/deep-march/scene/sonarScan/tileMesh";
import type { Checker } from "./checks";

const area3 = (p: number[], o: number) => {
  const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
  const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
  return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
};
const soupArea = (s: Soup) => {
  let a = 0;
  for (let o = 0; o < s.p.length; o += 9) a += Math.hypot(...Object.values(area3(s.p, o))) / 2;
  return a;
};

export function scanClipChecks(c: Checker): void {
  c.section("grid: one world grid, compact normals");
  {
    let same = true, worst = 1, rnd = 11;
    const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 4000; i++) {
      const v = -500 + r() * 1000, t = Math.floor((v + (r() - 0.5) * 2 * (SCAN_GRID.pad - 0.1)) / SCAN_GRID.tile); // any tile whose pad reaches v
      if (dequantXZ(quantXZ(v, t), t) !== snapXZ(v)) same = false;
      const n = [r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...n), b = new Uint8Array(2), o = [0, 0, 0];
      encodeNormal(n[0] / l, n[1] / l, n[2] / l, b, 0);
      decodeNormal(b[0], b[1], o, 0);
      worst = Math.min(worst, (o[0] * n[0] + o[1] * n[1] + o[2] * n[2]) / l);
    }
    c.check(same, "a vertex quantises to the same world point in either tile it can belong to");
    c.check(worst > 0.995, "normals in 2 bytes within ~6°", `min dot ${worst.toFixed(4)}`);
  }

  c.section("sphere cut");
  {
    let rnd = 5;
    const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    const src = newSoup();
    for (let t = 0; t < 3000; t++) {
      const x = -30 + r() * 60, y = -20 + r() * 40, z = -30 + r() * 60;
      for (let k = 0; k < 3; k++) {
        src.p.push(snapXZ(x + (r() - 0.5) * 8), y + (r() - 0.5) * 8, snapXZ(z + (r() - 0.5) * 8));
        src.n.push(0, 1, 0);
      }
    }
    const s: Sphere = { x: 1.3, y: -2.1, z: 0.7, r: 21 };
    const inn = newSoup(), out = newSoup();
    const changed = clipSoup(src, s, "in", inn);
    clipSoup(src, s, "out", out);
    const a0 = soupArea(src), a1 = soupArea(inn) + soupArea(out);
    c.check(Math.abs(a1 - a0) <= 1e-6 * a0 && changed > 0, "inside + outside pieces = the whole surface", `${soupTris(inn)} + ${soupTris(out)} triangles from ${soupTris(src)}, area ${a0.toFixed(2)} vs ${a1.toFixed(2)}`);
    const d = (p: number[], o: number) => Math.hypot(p[o] - s.x, p[o + 1] - s.y, p[o + 2] - s.z);
    let inOk = true, outOk = true;
    for (let o = 0; o < inn.p.length; o += 3) if (d(inn.p, o) > s.r + 1e-9) inOk = false;
    for (let o = 0; o < out.p.length; o += 3) if (d(out.p, o) < s.r - 1e-9) outOk = false;
    c.check(inOk && outOk, "the inside piece never leaves the sphere, the outside never enters it");
    const onSphere = (q: Soup) => {
      const set = new Set<string>();
      for (let o = 0; o < q.p.length; o += 3) if (Math.abs(d(q.p, o) - s.r) < 1e-6) set.add(`${q.p[o]},${q.p[o + 1]},${q.p[o + 2]}`);
      return set;
    };
    const si = onSphere(inn), so = onSphere(out);
    c.check(si.size > 100 && si.size === so.size && [...si].every((k) => so.has(k)), "the crossings are bit-identical on both sides (no gap, no overlap)", `${si.size} crossings`);
    let wound = true;
    for (let o = 0; o < src.p.length && wound; o += 9) {
      const one: Soup = { p: src.p.slice(o, o + 9), n: src.n.slice(o, o + 9) }, f = area3(one.p, 0);
      for (const side of ["in", "out"] as const) {
        const q = newSoup();
        clipSoup(one, s, side, q);
        for (let k = 0; k < q.p.length; k += 9) {
          const g = area3(q.p, k);
          if (g.x * f.x + g.y * f.y + g.z * f.z < -1e-9) wound = false;
        }
      }
    }
    c.check(wound, "every cut piece faces the way its triangle did (winding kept)");
  }
}
