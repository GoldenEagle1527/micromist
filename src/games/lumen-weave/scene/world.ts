import * as THREE from "three";
import {
  colorForBiome,
  colorFromWeights,
  dominantBiome,
  sampleBiomeWeights,
  type BiomeId,
} from "./biomes";
import { createLineMaterial, createPointsMaterial } from "./glow";
import { clamp, fbm2D, hashInts, mulberry32, valueNoise2D } from "./seed";

export const CHUNK_SIZE = 32;
/** Horizontal ring of surface chunks around the skim camera. */
const KEEP_RADIUS = 2;

type ChunkKey = string;

type ChunkMesh = {
  key: ChunkKey;
  ix: number;
  iz: number;
  points: THREE.Points;
  lines: THREE.LineSegments | null;
};

function keyOf(ix: number, iz: number): ChunkKey {
  return `${ix},${iz}`;
}

/**
 * Continuous particle-ocean heightfield. Base fBm sea + soft biome landform
 * modulation so hills/valleys morph with biome weights (no hard chunk swap).
 */
export function sampleSurfaceHeight(
  worldSeed: number,
  wx: number,
  wz: number,
): number {
  const base =
    fbm2D(worldSeed ^ 0xd01e, wx * 0.048, wz * 0.048, 5) * 4.2 +
    Math.sin(wx * 0.17 + wz * 0.11) * 1.05 +
    Math.sin(wx * 0.07 - wz * 0.23) * 0.65 +
    fbm2D(worldSeed ^ 0xa7c3, wx * 0.12, wz * 0.12, 2) * 1.15;

  const w = sampleBiomeWeights(worldSeed, wx, wz);

  // Dunes: fine ripple corrugation on the sea.
  const dunesRipple =
    Math.sin(wx * 0.55 + wz * 0.08) * 0.35 +
    Math.sin(wx * 0.22 - wz * 0.48) * 0.22;

  // Helix: gentle swell lifts where ribbons rise from the surface.
  const helixLift =
    Math.sin(wx * 0.09 + wz * 0.14) * 1.4 +
    fbm2D(worldSeed ^ 0x11e1, wx * 0.06, wz * 0.06, 2) * 1.1;

  // Warp: carved channels / troughs across the sea.
  const warpChannel =
    -Math.abs(Math.sin(wx * 0.13 + wz * 0.19)) * 1.8 -
    fbm2D(worldSeed ^ 0x22f2, wx * 0.09, wz * 0.09, 2) * 0.7;

  // Ridges: sharp crest lifts along noise ridges.
  const ridgeNoise = fbm2D(worldSeed ^ 0x71d9, wx * 0.075, wz * 0.075, 3);
  const ridgeCrest = Math.pow(1 - Math.min(1, Math.abs(ridgeNoise - 0.5) * 3.2), 2.4) * 2.6;

  // Void: flatten toward mean sea level (sparse patches read as calmer water).
  const voidFlat = -base * 0.55;

  const landform =
    w.dunes * dunesRipple +
    w.helix * helixLift +
    w.warp * warpChannel +
    w.ridges * ridgeCrest +
    w.void * voidFlat;

  return base * (0.55 + w.dunes * 0.25 + w.helix * 0.15 + w.ridges * 0.2) + landform;
}

/** Forward slope (radians, mild) for camera pitch follow. */
export function sampleSurfaceSlopePitch(
  worldSeed: number,
  wx: number,
  wz: number,
  heading: number,
  lookAhead = 6,
): number {
  const h0 = sampleSurfaceHeight(worldSeed, wx, wz);
  const ax = wx + Math.sin(heading) * lookAhead;
  const az = wz + Math.cos(heading) * lookAhead;
  const h1 = sampleSurfaceHeight(worldSeed, ax, az);
  return clamp(Math.atan2(h1 - h0, lookAhead) * 0.72, -0.28, 0.28);
}

function pushPos(
  pos: number[],
  col: number[],
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number,
) {
  pos.push(x, y, z);
  col.push(r, g, b);
}

/**
 * Build one XZ chunk of the continuous particle sea + soft biome micro-structure.
 */
function buildChunk(
  scene: THREE.Scene,
  glowMap: THREE.Texture,
  worldSeed: number,
  ix: number,
  iz: number,
): ChunkMesh {
  const key = keyOf(ix, iz);
  const cx = (ix + 0.5) * CHUNK_SIZE;
  const cz = (iz + 0.5) * CHUNK_SIZE;
  const rng = mulberry32(hashInts(worldSeed, ix, 0, iz));

  const pos: number[] = [];
  const col: number[] = [];
  const color = new THREE.Color();
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();

  // Dense heightfield grid — the particle ocean surface.
  const nx = 52;
  const nz = 52;
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const u = i / (nx - 1);
      const v = j / (nz - 1);
      const lx = (u - 0.5) * CHUNK_SIZE;
      const lz = (v - 0.5) * CHUNK_SIZE;
      const wx = cx + lx;
      const wz = cz + lz;
      const weights = sampleBiomeWeights(worldSeed, wx, wz);

      // Sparse void: skip some surface points so calm patches open up.
      if (weights.void > 0.35 && rng() < weights.void * 0.55) continue;

      const h = sampleSurfaceHeight(worldSeed, wx, wz);
      // Micro thickness so the sea reads as volume.
      const yOff = ((i * 17 + j * 31 + ix * 3 + iz * 7) % 5) * 0.035;
      const t =
        clamp(
          0.2 +
            h * 0.08 +
            valueNoise2D(worldSeed, wx * 0.05, wz * 0.05) * 0.4,
          0,
          1,
        );

      colorFromWeights(weights, t, color, tmpA, tmpB);
      const glow = 0.82 + ((i + j) % 9) * 0.04;
      pushPos(
        pos,
        col,
        wx,
        h + yOff,
        wz,
        Math.min(1.85, color.r * glow),
        Math.min(1.85, color.g * glow),
        Math.min(1.85, color.b * glow),
      );

      // Dune ripple second sheet (soft, only where dunes weigh in).
      if (weights.dunes > 0.22 && ((i + j) & 3) === 0) {
        const ripple =
          Math.sin(wx * 0.55 + wz * 0.08) * 0.45 * weights.dunes;
        colorFromWeights(weights, t + 0.15, color, tmpA, tmpB);
        pushPos(
          pos,
          col,
          wx + 0.15,
          h + ripple + 0.55 * weights.dunes,
          wz + 0.12,
          Math.min(1.7, color.r * 0.9),
          Math.min(1.7, color.g * 0.9),
          Math.min(1.7, color.b * 0.9),
        );
      }
    }
  }

  // Helix ribbons rising from the continuous surface (weighted density).
  const helixN = 90;
  for (let k = 0; k < helixN; k += 1) {
    const wx = cx + (rng() - 0.5) * CHUNK_SIZE * 0.95;
    const wz = cz + (rng() - 0.5) * CHUNK_SIZE * 0.95;
    const weights = sampleBiomeWeights(worldSeed, wx, wz);
    if (weights.helix < 0.18 || rng() > weights.helix * 1.15) continue;
    const baseH = sampleSurfaceHeight(worldSeed, wx, wz);
    const strand = Math.floor(rng() * 4);
    const phase = (strand / 4) * Math.PI * 2;
    const steps = 10 + Math.floor(weights.helix * 14);
    for (let s = 0; s < steps; s += 1) {
      const t = s / Math.max(1, steps - 1);
      const ang = phase + t * 5.2 + wx * 0.02;
      const rad = 0.55 + t * 0.85;
      const px = wx + Math.cos(ang) * rad;
      const pz = wz + Math.sin(ang) * rad * 0.7;
      const py = baseH + t * (2.8 + weights.helix * 3.2);
      const amber = strand % 2 === 1;
      colorForBiome("helix", amber ? 0.8 : 0.2, color);
      // Soft-mix toward blended surface color.
      colorFromWeights(weights, amber ? 0.75 : 0.25, tmpA, tmpB, tmpB);
      color.lerp(tmpA, 0.35);
      const glow = 0.95 + t * 0.35;
      pushPos(
        pos,
        col,
        px,
        py,
        pz,
        Math.min(1.9, color.r * glow),
        Math.min(1.9, color.g * glow),
        Math.min(1.9, color.b * glow),
      );
    }
  }

  // Warp channel accent particles (along troughs).
  const warpN = 70;
  for (let k = 0; k < warpN; k += 1) {
    const wx = cx + (rng() - 0.5) * CHUNK_SIZE * 0.95;
    const wz = cz + (rng() - 0.5) * CHUNK_SIZE * 0.95;
    const weights = sampleBiomeWeights(worldSeed, wx, wz);
    if (weights.warp < 0.2 || rng() > weights.warp * 1.1) continue;
    const baseH = sampleSurfaceHeight(worldSeed, wx, wz);
    const ang = rng() * Math.PI * 2;
    const rad = 0.8 + rng() * 1.6;
    const px = wx + Math.cos(ang) * rad;
    const pz = wz + Math.sin(ang) * rad;
    const py = baseH + 0.2 + rng() * 1.4 * weights.warp;
    colorFromWeights(weights, 0.45 + rng() * 0.4, color, tmpA, tmpB);
    pushPos(
      pos,
      col,
      px,
      py,
      pz,
      Math.min(1.75, color.r * 1.05),
      Math.min(1.75, color.g * 1.05),
      Math.min(1.75, color.b * 1.05),
    );
  }

  // Ridge crest glitter (denser along crests).
  const ridgeN = 80;
  for (let k = 0; k < ridgeN; k += 1) {
    const wx = cx + (rng() - 0.5) * CHUNK_SIZE * 0.95;
    const wz = cz + (rng() - 0.5) * CHUNK_SIZE * 0.95;
    const weights = sampleBiomeWeights(worldSeed, wx, wz);
    if (weights.ridges < 0.2 || rng() > weights.ridges * 1.2) continue;
    const ridgeNoise = fbm2D(worldSeed ^ 0x71d9, wx * 0.075, wz * 0.075, 3);
    const crest = Math.pow(
      1 - Math.min(1, Math.abs(ridgeNoise - 0.5) * 3.2),
      2.4,
    );
    if (crest < 0.25) continue;
    const baseH = sampleSurfaceHeight(worldSeed, wx, wz);
    colorFromWeights(weights, 0.55 + crest * 0.4, color, tmpA, tmpB);
    pushPos(
      pos,
      col,
      wx + (rng() - 0.5) * 0.4,
      baseH + crest * 1.2 * weights.ridges + 0.3,
      wz + (rng() - 0.5) * 0.4,
      Math.min(1.9, color.r * 1.15),
      Math.min(1.9, color.g * 1.15),
      Math.min(1.9, color.b * 1.15),
    );
  }

  // Sparse void stars floating just above calm patches.
  const voidN = 28;
  for (let k = 0; k < voidN; k += 1) {
    const wx = cx + (rng() - 0.5) * CHUNK_SIZE;
    const wz = cz + (rng() - 0.5) * CHUNK_SIZE;
    const weights = sampleBiomeWeights(worldSeed, wx, wz);
    if (weights.void < 0.28 || rng() > weights.void * 0.9) continue;
    const baseH = sampleSurfaceHeight(worldSeed, wx, wz);
    colorFromWeights(weights, rng(), color, tmpA, tmpB);
    pushPos(
      pos,
      col,
      wx,
      baseH + 1.5 + rng() * 4.5,
      wz,
      Math.min(1.4, color.r * 0.7),
      Math.min(1.4, color.g * 0.7),
      Math.min(1.4, color.b * 0.7),
    );
  }

  const live = Math.max(1, pos.length / 3);
  const posLive = new Float32Array(pos);
  const colLive = new Float32Array(col);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posLive, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colLive, 3));
  const points = new THREE.Points(
    geo,
    createPointsMaterial(glowMap, 0.22, 0.98),
  );
  points.frustumCulled = true;
  scene.add(points);

  // Sparse low-opacity plexus only along strong helix / ridge regions.
  let lines: THREE.LineSegments | null = null;
  const plexus = buildSparsePlexus(worldSeed, cx, cz, rng);
  if (plexus) {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(plexus.pos, 3),
    );
    lineGeo.setAttribute("color", new THREE.BufferAttribute(plexus.col, 3));
    lines = new THREE.LineSegments(lineGeo, createLineMaterial(0.14));
    lines.frustumCulled = true;
    scene.add(lines);
  }

  void live;
  return { key, ix, iz, points, lines };
}

function buildSparsePlexus(
  worldSeed: number,
  cx: number,
  cz: number,
  rng: () => number,
): { pos: Float32Array; col: Float32Array } | null {
  const maxSeg = 90;
  const pts: { x: number; y: number; z: number; biome: BiomeId; t: number }[] =
    [];
  for (let n = 0; n < 48; n += 1) {
    const wx = cx + (rng() - 0.5) * CHUNK_SIZE * 0.9;
    const wz = cz + (rng() - 0.5) * CHUNK_SIZE * 0.9;
    const weights = sampleBiomeWeights(worldSeed, wx, wz);
    const dom = dominantBiome(weights);
    if (dom !== "helix" && dom !== "ridges") continue;
    if (weights[dom]! < 0.3) continue;
    const baseH = sampleSurfaceHeight(worldSeed, wx, wz);
    const lift =
      dom === "helix" ? 1.2 + rng() * 2.8 : 0.4 + rng() * 1.2;
    pts.push({
      x: wx,
      y: baseH + lift,
      z: wz,
      biome: dom,
      t: rng(),
    });
  }
  if (pts.length < 4) return null;

  const pos = new Float32Array(maxSeg * 6);
  const col = new Float32Array(maxSeg * 6);
  const color = new THREE.Color();
  let seg = 0;
  for (let i = 0; i < pts.length && seg < maxSeg; i += 1) {
    const a = pts[i]!;
    let bestJ = -1;
    let bestD = 3.2;
    for (let j = i + 1; j < pts.length; j += 1) {
      const b = pts[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 0.4 && d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ < 0 || rng() > 0.55) continue;
    const b = pts[bestJ]!;
    const o = seg * 6;
    pos[o] = a.x;
    pos[o + 1] = a.y;
    pos[o + 2] = a.z;
    pos[o + 3] = b.x;
    pos[o + 4] = b.y;
    pos[o + 5] = b.z;
    colorForBiome(a.biome, a.t, color);
    col[o] = color.r * 0.45;
    col[o + 1] = color.g * 0.45;
    col[o + 2] = color.b * 0.45;
    colorForBiome(b.biome, b.t, color);
    col[o + 3] = color.r * 0.45;
    col[o + 4] = color.g * 0.45;
    col[o + 5] = color.b * 0.45;
    seg += 1;
  }
  if (seg === 0) return null;
  return {
    pos: pos.subarray(0, seg * 6) as Float32Array,
    col: col.subarray(0, seg * 6) as Float32Array,
  };
}

function disposeChunk(scene: THREE.Scene, chunk: ChunkMesh) {
  scene.remove(chunk.points);
  chunk.points.geometry.dispose();
  (chunk.points.material as THREE.Material).dispose();
  if (chunk.lines) {
    scene.remove(chunk.lines);
    chunk.lines.geometry.dispose();
    (chunk.lines.material as THREE.Material).dispose();
  }
}

export type WorldField = {
  update: (cam: THREE.Vector3) => void;
  dispose: () => void;
};

export function createWorldField(
  scene: THREE.Scene,
  glowMap: THREE.Texture,
  worldSeed: number,
): WorldField {
  const chunks = new Map<ChunkKey, ChunkMesh>();

  const update = (cam: THREE.Vector3) => {
    const cx = Math.floor(cam.x / CHUNK_SIZE);
    const cz = Math.floor(cam.z / CHUNK_SIZE);

    const needed = new Set<ChunkKey>();
    // Prefer more chunks ahead of travel (+Z bias via larger forward ring).
    for (let dz = -1; dz <= KEEP_RADIUS + 1; dz += 1) {
      for (let dx = -KEEP_RADIUS; dx <= KEEP_RADIUS; dx += 1) {
        if (Math.abs(dx) + Math.max(0, -dz) > KEEP_RADIUS + 1) continue;
        const ix = cx + dx;
        const iz = cz + dz;
        const k = keyOf(ix, iz);
        needed.add(k);
        if (!chunks.has(k)) {
          chunks.set(k, buildChunk(scene, glowMap, worldSeed, ix, iz));
        }
      }
    }

    for (const [k, chunk] of chunks) {
      if (!needed.has(k)) {
        disposeChunk(scene, chunk);
        chunks.delete(k);
      }
    }
  };

  const dispose = () => {
    for (const chunk of chunks.values()) disposeChunk(scene, chunk);
    chunks.clear();
  };

  return { update, dispose };
}
