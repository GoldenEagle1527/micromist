/**
 * Shared low-poly geometry of every node and cache instance (one instanced
 * draw): part 0 = a crystal cluster (5 faceted pentagonal crystals, 75
 * triangles), part 1 = a lost cache (a hexagonal bipyramid "beacon", 12
 * triangles). The instance picks its part; the other collapses to a point in
 * the vertex shader. Flat normals (faceted look); `aTip` = 0 at a crystal's
 * foot … 1 at its tip (the inner glow brightens toward the tips).
 * +Y is the growth axis; y < 0 is sunk into the rock.
 */
import * as THREE from "three";

type Tri = { p: THREE.Vector3[]; tip: number[] };

/** Push a triangle wound counter-clockwise seen from outside (away from `centre`). */
function face(out: Tri[], p: THREE.Vector3[], tip: number[], centre: THREE.Vector3): void {
  const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
  const c = new THREE.Vector3().add(p[0]).add(p[1]).add(p[2]).multiplyScalar(1 / 3).sub(centre);
  out.push(n.dot(c) >= 0 ? { p, tip } : { p: [p[0], p[2], p[1]], tip: [tip[0], tip[2], tip[1]] });
}

function crystal(out: Tri[], axis: THREE.Vector3, base: THREE.Vector3, r: number, h: number, tipH: number, twist: number): void {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(base);
  const ring = (y: number, rr: number) => [0, 1, 2, 3, 4].map((i) => {
    const a = twist + (i / 5) * Math.PI * 2;
    return at(Math.cos(a) * rr, y, Math.sin(a) * rr);
  });
  const lo = ring(-0.35, r), hi = ring(h, r * 0.92), tip = at(0, h + tipH, 0);
  const tl = -0.35 / (h + tipH), th = h / (h + tipH);
  const mid = at(0, h * 0.5, 0), top = at(0, h, 0);
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    face(out, [lo[i], hi[j], lo[j]], [tl, th, tl], mid);
    face(out, [lo[i], hi[i], hi[j]], [tl, th, th], mid);
    face(out, [hi[i], tip, hi[j]], [th, 1, th], top);
  }
}

function bipyramid(out: Tri[], r: number, h: number): void {
  const ring = [0, 1, 2, 3, 4, 5].map((i) => new THREE.Vector3(Math.cos((i / 6) * Math.PI * 2) * r, h * 0.5, Math.sin((i / 6) * Math.PI * 2) * r));
  const top = new THREE.Vector3(0, h * 1.25, 0), bot = new THREE.Vector3(0, -h * 0.15, 0);
  const centre = new THREE.Vector3(0, h * 0.5, 0);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    face(out, [ring[i], top, ring[j]], [0.5, 1, 0.5], centre);
    face(out, [ring[j], bot, ring[i]], [0.5, 0, 0.5], centre);
  }
}

export type NodeGeometryInfo = { geometry: THREE.BufferGeometry; crystalTriangles: number; cacheTriangles: number };

export function createNodeGeometry(): NodeGeometryInfo {
  const cluster: Tri[] = [];
  crystal(cluster, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 0.2, 0.95, 0.38, 0.2);
  const spokes: [number, number, number, number, number][] = [
    // angle around, lean, radius, height, offset
    [0.3, 0.55, 0.13, 0.55, 0.22],
    [1.9, 0.7, 0.11, 0.42, 0.24],
    [3.4, 0.45, 0.15, 0.68, 0.2],
    [4.9, 0.8, 0.1, 0.36, 0.26],
  ];
  for (const [a, lean, r, h, off] of spokes) {
    const axis = new THREE.Vector3(Math.cos(a) * Math.sin(lean), Math.cos(lean), Math.sin(a) * Math.sin(lean));
    crystal(cluster, axis, new THREE.Vector3(Math.cos(a) * off, 0, Math.sin(a) * off), r, h, h * 0.45, a);
  }
  const cache: Tri[] = [];
  bipyramid(cache, 0.32, 0.75);
  const tris = [...cluster.map((t) => ({ ...t, part: 0 })), ...cache.map((t) => ({ ...t, part: 1 }))];
  const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9);
  const tip = new Float32Array(tris.length * 3), part = new Float32Array(tris.length * 3);
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  tris.forEach((t, i) => {
    e1.subVectors(t.p[1], t.p[0]);
    e2.subVectors(t.p[2], t.p[0]);
    n.crossVectors(e1, e2).normalize();
    t.p.forEach((v, k) => {
      pos.set([v.x, v.y, v.z], i * 9 + k * 3);
      nrm.set([n.x, n.y, n.z], i * 9 + k * 3);
      tip[i * 3 + k] = Math.max(0, t.tip[k]);
      part[i * 3 + k] = t.part;
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geometry.setAttribute("aTip", new THREE.BufferAttribute(tip, 1));
  geometry.setAttribute("aPart", new THREE.BufferAttribute(part, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.6);
  return { geometry, crystalTriangles: cluster.length, cacheTriangles: cache.length };
}
