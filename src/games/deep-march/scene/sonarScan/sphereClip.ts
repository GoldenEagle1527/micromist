/**
 * Cutting a triangle soup along a ping's sphere (pure). "in" keeps the part inside,
 * "out" the part outside; the two are exact complements of the same triangle: a
 * vertex is inside when its distance² < r², and a cut edge is always solved from its
 * inside end to its outside end (the exact sphere crossing, not a lerp of distances),
 * so both sides produce the bit-identical crossing point. Where old and new terrain
 * are the same, the kept-old and newly recorded pieces therefore meet without a gap
 * or an overlap; triangles keep their winding.
 */
import type { Soup } from "./tileMesh";

export type Sphere = { x: number; y: number; z: number; r: number };
export type Side = "in" | "out";

const P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const N = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const X = [0, 0, 0, 0, 0, 0]; // crossing points (2 × xyz) and their normals
const XN = [0, 0, 0, 0, 0, 0];

/** Crossing on the edge from corner a (inside) to corner b (outside), written to X / XN slot s. */
function cross(s: Sphere, a: number, b: number, slot: number): void {
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const dx = P[b * 3] - ax, dy = P[b * 3 + 1] - ay, dz = P[b * 3 + 2] - az;
  const fx = ax - s.x, fy = ay - s.y, fz = az - s.z;
  const qa = dx * dx + dy * dy + dz * dz, qb = fx * dx + fy * dy + fz * dz, qc = fx * fx + fy * fy + fz * fz - s.r * s.r;
  const t = qa > 0 ? Math.min(1, Math.max(0, (-qb + Math.sqrt(Math.max(0, qb * qb - qa * qc))) / qa)) : 0;
  const o = slot * 3;
  let l = 0;
  for (let k = 0; k < 3; k++) {
    X[o + k] = P[a * 3 + k] + t * (P[b * 3 + k] - P[a * 3 + k]);
    XN[o + k] = N[a * 3 + k] + t * (N[b * 3 + k] - N[a * 3 + k]);
    l += XN[o + k] * XN[o + k];
  }
  l = Math.sqrt(l) || 1;
  for (let k = 0; k < 3; k++) XN[o + k] /= l;
}

/** Push a triangle of corners: 0–2 = the source's corners, 3–4 = crossings. */
function emit(out: Soup, a: number, b: number, c: number): void {
  for (const v of [a, b, c]) {
    if (v < 3) {
      out.p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      out.n.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    } else {
      const o = (v - 3) * 3;
      out.p.push(X[o], X[o + 1], X[o + 2]);
      out.n.push(XN[o], XN[o + 1], XN[o + 2]);
    }
  }
}

/**
 * Keep `side` of every triangle of `src` (appended to `out`). Returns how many
 * triangles were not simply kept whole (cut or dropped): 0 = nothing changed.
 */
export function clipSoup(src: Soup, s: Sphere, side: Side, out: Soup): number {
  const r2 = s.r * s.r;
  let changed = 0;
  const inside = [false, false, false];
  for (let o = 0; o < src.p.length; o += 9) {
    let k = 0;
    for (let v = 0; v < 3; v++) {
      const x = src.p[o + v * 3] - s.x, y = src.p[o + v * 3 + 1] - s.y, z = src.p[o + v * 3 + 2] - s.z;
      inside[v] = x * x + y * y + z * z < r2;
      if (inside[v]) k++;
    }
    const keepWhole = side === "in" ? k === 3 : k === 0;
    const dropWhole = side === "in" ? k === 0 : k === 3;
    if (keepWhole || dropWhole) {
      if (keepWhole) {
        for (let i = 0; i < 9; i++) {
          out.p.push(src.p[o + i]);
          out.n.push(src.n[o + i]);
        }
      } else changed++;
      continue;
    }
    changed++;
    for (let i = 0; i < 9; i++) {
      P[i] = src.p[o + i];
      N[i] = src.n[o + i];
    }
    // the odd corner out: the one alone on its side; rotate so it is corner a (winding kept)
    const lone = k === 1 ? inside.indexOf(true) : inside.indexOf(false);
    const a = lone, b = (lone + 1) % 3, c = (lone + 2) % 3;
    // crossings on a–b (slot 3) and a–c (slot 4), solved from the inside end
    if (inside[a]) {
      cross(s, a, b, 0);
      cross(s, a, c, 1);
    } else {
      cross(s, b, a, 0);
      cross(s, c, a, 1);
    }
    const keepLone = inside[a] === (side === "in");
    if (keepLone) emit(out, a, 3, 4);
    else {
      emit(out, 3, b, c);
      emit(out, 3, c, 4);
    }
  }
  return changed;
}
