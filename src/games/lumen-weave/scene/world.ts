import * as THREE from "three";
import {
  colorForBiome,
  pickBiome,
  sampleBiomeWeights,
  type BiomeId,
} from "./biomes";
import { createLineMaterial, createPointsMaterial } from "./glow";
import { clamp, hashInts, mulberry32 } from "./seed";

export const CHUNK_SIZE = 26;
const PTS_PER_CHUNK = 720;
const LINE_SEGS_PER_CHUNK = 180;
const KEEP_RADIUS = 3;

type ChunkKey = string;

type Sample = { x: number; y: number; z: number; biome: BiomeId };

type ChunkMesh = {
  key: ChunkKey;
  ix: number;
  iy: number;
  iz: number;
  points: THREE.Points;
  lines: THREE.LineSegments;
};

function keyOf(ix: number, iy: number, iz: number): ChunkKey {
  return `${ix},${iy},${iz}`;
}

function localPattern(
  biome: BiomeId,
  u: number,
  v: number,
  w: number,
  rng: () => number,
): { x: number; y: number; z: number } {
  switch (biome) {
    case "dunes": {
      const x = (u - 0.5) * CHUNK_SIZE;
      const z = (w - 0.5) * CHUNK_SIZE;
      const wave =
        Math.sin(x * 0.38 + z * 0.21) * 2.4 +
        Math.sin(x * 0.11 - z * 0.47) * 1.1 +
        (rng() - 0.5) * 0.35;
      const y = (v - 0.5) * 2.2 + wave * 0.55 + (v - 0.5) * Math.abs(wave) * 0.15;
      return { x, y, z };
    }
    case "helix": {
      const along = (w - 0.5) * CHUNK_SIZE;
      const strand = Math.floor(rng() * 6);
      const ang = along * 0.42 + strand * ((Math.PI * 2) / 6) + u * Math.PI * 2;
      const rad = 3.2 + Math.sin(along * 0.18 + strand) * 0.55 + v * 1.4;
      return {
        x: Math.cos(ang) * rad + (rng() - 0.5) * 0.2,
        y: Math.sin(ang) * rad * 0.78 + (rng() - 0.5) * 0.15,
        z: along,
      };
    }
    case "warp": {
      const along = (w - 0.5) * CHUNK_SIZE;
      const ang = u * Math.PI * 2;
      const tube =
        2.1 +
        Math.sin(along * 0.55 + ang * 3) * 0.45 +
        Math.sin(along * 0.17) * 0.8;
      const shell = v < 0.72 ? tube : tube * (0.35 + v);
      return {
        x: Math.cos(ang) * shell + (rng() - 0.5) * 0.12,
        y: Math.sin(ang) * shell * 0.82 + (rng() - 0.5) * 0.1,
        z: along + (rng() - 0.5) * 0.4,
      };
    }
    case "void": {
      return {
        x: (rng() - 0.5) * CHUNK_SIZE * 1.15,
        y: (rng() - 0.5) * CHUNK_SIZE * 1.15,
        z: (rng() - 0.5) * CHUNK_SIZE * 1.15,
      };
    }
    case "ridges": {
      const gx = Math.floor(u * 7);
      const gy = Math.floor(v * 5);
      const gz = Math.floor(w * 7);
      const onX =
        Math.abs(u * 7 - gx - 0.5) < 0.08 || Math.abs(w * 7 - gz - 0.5) < 0.08;
      const onY = Math.abs(v * 5 - gy - 0.5) < 0.1;
      const jitter = (rng() - 0.5) * 0.25;
      if (onX || onY) {
        return {
          x: (u - 0.5) * CHUNK_SIZE + jitter,
          y: (v - 0.5) * CHUNK_SIZE * 0.85 + Math.sin(gz + gx) * 0.4,
          z: (w - 0.5) * CHUNK_SIZE + jitter * 0.6,
        };
      }
      return {
        x: (gx / 7 - 0.5) * CHUNK_SIZE + jitter,
        y: (gy / 5 - 0.5) * CHUNK_SIZE * 0.7,
        z: (gz / 7 - 0.5) * CHUNK_SIZE,
      };
    }
    default:
      return {
        x: (u - 0.5) * CHUNK_SIZE,
        y: (v - 0.5) * CHUNK_SIZE,
        z: (w - 0.5) * CHUNK_SIZE,
      };
  }
}

function buildChunk(
  scene: THREE.Scene,
  glowMap: THREE.Texture,
  worldSeed: number,
  ix: number,
  iy: number,
  iz: number,
): ChunkMesh {
  const key = keyOf(ix, iy, iz);
  const cx = (ix + 0.5) * CHUNK_SIZE;
  const cy = (iy + 0.5) * CHUNK_SIZE;
  const cz = (iz + 0.5) * CHUNK_SIZE;
  const weights = sampleBiomeWeights(worldSeed, cx, cz);
  const rng = mulberry32(hashInts(worldSeed, ix, iy, iz));

  const density = clamp(1 - weights.void * 0.72, 0.22, 1);
  const target = Math.max(48, Math.floor(PTS_PER_CHUNK * density));
  const samples: Sample[] = [];
  const color = new THREE.Color();

  for (let i = 0; i < target; i += 1) {
    const biome = pickBiome(weights, rng());
    if (biome === "void" && rng() > 0.35) continue;
    const local = localPattern(biome, rng(), rng(), rng(), rng);
    samples.push({
      x: cx + local.x,
      y: cy + local.y,
      z: cz + local.z,
      biome,
    });
  }

  const live = Math.max(1, samples.length);
  const posLive = new Float32Array(live * 3);
  const colLive = new Float32Array(live * 3);
  for (let i = 0; i < live; i += 1) {
    const s = samples[i] ?? {
      x: cx,
      y: cy,
      z: cz,
      biome: "void" as BiomeId,
    };
    posLive[i * 3] = s.x;
    posLive[i * 3 + 1] = s.y;
    posLive[i * 3 + 2] = s.z;
    colorForBiome(s.biome, ((i * 17) % 100) / 100, color);
    const glow = 0.7 + ((i * 13) % 7) * 0.04;
    colLive[i * 3] = color.r * glow;
    colLive[i * 3 + 1] = color.g * glow;
    colLive[i * 3 + 2] = color.b * glow;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posLive, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colLive, 3));
  const size =
    weights.warp > 0.35
      ? 0.1
      : weights.void > 0.4
        ? 0.07
        : weights.ridges > 0.35
          ? 0.095
          : 0.11;
  const points = new THREE.Points(geo, createPointsMaterial(glowMap, size, 0.94));
  points.frustumCulled = true;
  scene.add(points);

  const wantLines =
    weights.helix + weights.ridges + weights.warp > 0.28
      ? Math.floor(
          LINE_SEGS_PER_CHUNK * (0.35 + weights.helix + weights.warp * 0.6),
        )
      : Math.floor(40 * weights.dunes);
  const segCount = Math.min(wantLines, Math.max(0, live - 1));
  const linePos = new Float32Array(Math.max(1, segCount) * 2 * 3);
  const lineCol = new Float32Array(Math.max(1, segCount) * 2 * 3);
  for (let s = 0; s < segCount; s += 1) {
    const ia = Math.floor(rng() * live);
    let ib = Math.floor(rng() * live);
    if (ib === ia) ib = (ia + 1) % live;
    const a = samples[ia]!;
    const b = samples[ib]!;
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const o = s * 6;
    linePos[o] = a.x;
    linePos[o + 1] = a.y;
    linePos[o + 2] = a.z;
    if (dist > CHUNK_SIZE * 0.55) {
      const t = (CHUNK_SIZE * 0.35) / Math.max(dist, 1e-3);
      linePos[o + 3] = a.x + (b.x - a.x) * t;
      linePos[o + 4] = a.y + (b.y - a.y) * t;
      linePos[o + 5] = a.z + (b.z - a.z) * t;
    } else {
      linePos[o + 3] = b.x;
      linePos[o + 4] = b.y;
      linePos[o + 5] = b.z;
    }
    colorForBiome(a.biome, 0.4, color);
    lineCol[o] = color.r;
    lineCol[o + 1] = color.g;
    lineCol[o + 2] = color.b;
    colorForBiome(b.biome, 0.6, color);
    lineCol[o + 3] = color.r;
    lineCol[o + 4] = color.g;
    lineCol[o + 5] = color.b;
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));
  if (segCount === 0) lineGeo.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(
    lineGeo,
    createLineMaterial(0.22 + weights.helix * 0.12),
  );
  lines.frustumCulled = true;
  scene.add(lines);

  return { key, ix, iy, iz, points, lines };
}

function disposeChunk(scene: THREE.Scene, chunk: ChunkMesh) {
  scene.remove(chunk.points);
  scene.remove(chunk.lines);
  chunk.points.geometry.dispose();
  chunk.lines.geometry.dispose();
  (chunk.points.material as THREE.Material).dispose();
  (chunk.lines.material as THREE.Material).dispose();
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
    const cy = Math.floor(cam.y / CHUNK_SIZE);
    const cz = Math.floor(cam.z / CHUNK_SIZE);

    const needed = new Set<ChunkKey>();
    for (let dz = -1; dz <= KEEP_RADIUS + 1; dz += 1) {
      for (let dx = -KEEP_RADIUS; dx <= KEEP_RADIUS; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (Math.abs(dx) + Math.abs(dy) > KEEP_RADIUS + 1) continue;
          const ix = cx + dx;
          const iy = cy + dy;
          const iz = cz + dz;
          const k = keyOf(ix, iy, iz);
          needed.add(k);
          if (!chunks.has(k)) {
            chunks.set(k, buildChunk(scene, glowMap, worldSeed, ix, iy, iz));
          }
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
