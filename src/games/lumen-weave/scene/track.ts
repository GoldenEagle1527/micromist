import * as THREE from "three";
import { createLineMaterial, createPointsMaterial } from "./glow";
import { clamp, createPathFrame, pathFrame, pathToWorld, type PathFrame } from "./path";

export type TrackBudget = {
  along: number;
  across: number;
  helixStrands: number;
  helixAlong: number;
};

export function trackBudget(mult: number): TrackBudget {
  const m = clamp(mult, 0.7, 1.25);
  return {
    along: Math.round(150 * m),
    across: Math.round(24 * m),
    helixStrands: 7,
    helixAlong: Math.round(210 * m),
  };
}

const CYAN = new THREE.Color(0x3de8ff);
const AMBER = new THREE.Color(0xf5a623);
const MAGENTA = new THREE.Color(0xe879f9);
const WHITE = new THREE.Color(0xd8f6ff);

type TrackSystem = {
  points: THREE.Points;
  lines: THREE.LineSegments;
  seeds: Float32Array;
  along: number;
  across: number;
  helixStrands: number;
  helixAlong: number;
  terrainCount: number;
  helixCount: number;
  scratch: PathFrame;
  scratchPos: THREE.Vector3;
};

function paintMix(seed: number, out: THREE.Color): THREE.Color {
  const lane = seed % 1;
  if (lane < 0.62) return out.copy(CYAN).lerp(WHITE, seed * 0.22);
  if (lane < 0.84) return out.copy(AMBER).lerp(WHITE, (seed * 3) % 0.28);
  return out.copy(MAGENTA).lerp(CYAN, (seed * 5) % 0.4);
}

export function createTrack(scene: THREE.Scene, map: THREE.Texture, budget: TrackBudget) {
  const { along, across, helixStrands, helixAlong } = budget;
  const terrainCount = along * across;
  const helixCount = helixStrands * helixAlong;
  const count = terrainCount + helixCount;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    seeds[i] = Math.random();
    paintMix(seeds[i]!, color);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(geo, createPointsMaterial(map, 0.11, 0.95));
  points.frustumCulled = false;
  scene.add(points);

  // Structured plexus: terrain flow-lines + helix spines + occasional weft.
  const terrainLines = Math.floor(across / 2) * Math.max(0, along - 1);
  const helixLines = helixStrands * Math.max(0, helixAlong - 1);
  const weftEvery = 14;
  const weftLines = helixStrands * Math.floor(helixAlong / weftEvery);
  const segCount = terrainLines + helixLines + weftLines;
  const linePos = new Float32Array(segCount * 2 * 3);
  const lineCol = new Float32Array(segCount * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));
  const lines = new THREE.LineSegments(lineGeo, createLineMaterial(0.26));
  lines.frustumCulled = false;
  scene.add(lines);

  const sys: TrackSystem = {
    points,
    lines,
    seeds,
    along,
    across,
    helixStrands,
    helixAlong,
    terrainCount,
    helixCount,
    scratch: createPathFrame(),
    scratchPos: new THREE.Vector3(),
  };

  const writePoint = (
    index: number,
    x: number,
    y: number,
    z: number,
    pos: Float32Array,
  ) => {
    const o = index * 3;
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
  };

  const update = (travel: number, origin: THREE.Vector3) => {
    const pos = sys.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const span = 52;
    const near = -3.2;

    for (let a = 0; a < along; a += 1) {
      const t = travel + near + (a / Math.max(1, along - 1)) * span;
      pathFrame(t, sys.scratch);
      for (let c = 0; c < across; c += 1) {
        const i = a * across + c;
        const seed = seeds[i]!;
        const u = (c / Math.max(1, across - 1) - 0.5) * 2;
        const lx = u * 2.35 + (seed - 0.5) * 0.08;
        const wave = Math.sin(t * 0.42 + u * 2.3) * 0.22 + Math.sin(t * 0.17 + u * 5.1) * 0.08;
        const bowl = Math.pow(Math.abs(u), 2.15) * 1.55;
        const ly = -1.08 + wave + bowl + (seed - 0.5) * 0.05;
        pathToWorld(sys.scratch, lx, ly, sys.scratchPos).sub(origin);
        writePoint(i, sys.scratchPos.x, sys.scratchPos.y, sys.scratchPos.z, arr);
      }
    }

    for (let a = 0; a < helixAlong; a += 1) {
      const t = travel + near + (a / Math.max(1, helixAlong - 1)) * span;
      pathFrame(t, sys.scratch);
      for (let s = 0; s < helixStrands; s += 1) {
        const i = terrainCount + s * helixAlong + a;
        const seed = seeds[i]!;
        const phase = (s / helixStrands) * Math.PI * 2;
        const twist = t * 0.33 + phase;
        const radius = 1.92 + Math.sin(t * 0.21 + phase) * 0.16 + (s % 2) * 0.12;
        const lx = Math.cos(twist) * radius;
        const ly = Math.sin(twist) * radius * 0.78;
        const jitter = (seed - 0.5) * 0.05;
        pathToWorld(sys.scratch, lx + jitter, ly - jitter * 0.4, sys.scratchPos).sub(origin);
        writePoint(i, sys.scratchPos.x, sys.scratchPos.y, sys.scratchPos.z, arr);
      }
    }

    pos.needsUpdate = true;

    const lpos = sys.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const lcol = sys.lines.geometry.getAttribute("color") as THREE.BufferAttribute;
    const lp = lpos.array as Float32Array;
    const lc = lcol.array as Float32Array;
    const pcol = sys.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    const pc = pcol.array as Float32Array;

    const copySeg = (seg: number, ia: number, ib: number) => {
      const o = seg * 6;
      lp[o] = arr[ia * 3]!;
      lp[o + 1] = arr[ia * 3 + 1]!;
      lp[o + 2] = arr[ia * 3 + 2]!;
      lp[o + 3] = arr[ib * 3]!;
      lp[o + 4] = arr[ib * 3 + 1]!;
      lp[o + 5] = arr[ib * 3 + 2]!;
      lc[o] = pc[ia * 3]!;
      lc[o + 1] = pc[ia * 3 + 1]!;
      lc[o + 2] = pc[ia * 3 + 2]!;
      lc[o + 3] = pc[ib * 3]!;
      lc[o + 4] = pc[ib * 3 + 1]!;
      lc[o + 5] = pc[ib * 3 + 2]!;
    };

    let seg = 0;
    for (let c = 0; c < across; c += 2) {
      for (let a = 0; a < along - 1; a += 1) {
        copySeg(seg, a * across + c, (a + 1) * across + c);
        seg += 1;
      }
    }
    for (let s = 0; s < helixStrands; s += 1) {
      const base = terrainCount + s * helixAlong;
      for (let a = 0; a < helixAlong - 1; a += 1) {
        copySeg(seg, base + a, base + a + 1);
        seg += 1;
      }
      for (let a = 0; a < helixAlong; a += weftEvery) {
        const ia = base + a;
        const ib = terrainCount + ((s + 1) % helixStrands) * helixAlong + a;
        copySeg(seg, ia, ib);
        seg += 1;
      }
    }

    lpos.needsUpdate = true;
    lcol.needsUpdate = true;
  };

  const dispose = () => {
    scene.remove(points);
    scene.remove(lines);
    points.geometry.dispose();
    lines.geometry.dispose();
    (points.material as THREE.Material).dispose();
    (lines.material as THREE.Material).dispose();
  };

  return { update, dispose, pointCount: count };
}

export type TrackHandle = ReturnType<typeof createTrack>;
