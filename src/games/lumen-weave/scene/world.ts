import * as THREE from "three";
import {
  colorForBiome,
  dominantBiome,
  secondaryBiome,
  sampleBiomeWeights,
  type BiomeId,
} from "./biomes";
import { createLineMaterial, createPointsMaterial } from "./glow";
import { clamp, fbm2D, hashInts, mulberry32, valueNoise2D } from "./seed";

export const CHUNK_SIZE = 28;
/** Prefer fewer live chunks × denser structured points (mobile-ish). */
const KEEP_RADIUS = 2;

type ChunkKey = string;

type Sample = { x: number; y: number; z: number; biome: BiomeId; t: number };

type ChunkMesh = {
  key: ChunkKey;
  ix: number;
  iy: number;
  iz: number;
  points: THREE.Points;
  lines: THREE.LineSegments | null;
};

function keyOf(ix: number, iy: number, iz: number): ChunkKey {
  return `${ix},${iy},${iz}`;
}

function pushSample(
  out: Sample[],
  cx: number,
  cy: number,
  cz: number,
  lx: number,
  ly: number,
  lz: number,
  biome: BiomeId,
  t: number,
) {
  out.push({
    x: cx + lx,
    y: cy + ly,
    z: cz + lz,
    biome,
    t,
  });
}

/** Dense heightfield particle grid — rolling digital ocean. */
function buildDunes(
  out: Sample[],
  worldSeed: number,
  cx: number,
  cy: number,
  cz: number,
  ix: number,
  iz: number,
) {
  const nx = 56;
  const nz = 56;
  const amp = 3.6;
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const u = i / (nx - 1);
      const w = j / (nz - 1);
      const lx = (u - 0.5) * CHUNK_SIZE;
      const lz = (w - 0.5) * CHUNK_SIZE;
      const wx = cx + lx;
      const wz = cz + lz;
      const h =
        fbm2D(worldSeed ^ 0xd01e, wx * 0.065, wz * 0.065, 4) * amp +
        Math.sin(wx * 0.22 + wz * 0.13) * 1.15 +
        Math.sin(wx * 0.09 - wz * 0.31) * 0.7;
      // Slight sheet thickness so the sea reads as volume, not a paper plane.
      const ly = h * 0.55 - 1.2 + ((i * 17 + j * 31 + ix * 3) % 5) * 0.04;
      const t = clamp(0.15 + h * 0.12 + valueNoise2D(worldSeed, u * 3, w * 3) * 0.35, 0, 1);
      pushSample(out, cx, cy, cz, lx, ly, lz, "dunes", t);
    }
  }
  // Sparse second ridge sheet above for depth (~12% more points).
  const n2 = 20;
  for (let j = 0; j < n2; j += 1) {
    for (let i = 0; i < n2; i += 1) {
      const u = (i + 0.5) / n2;
      const w = (j + 0.5) / n2;
      const lx = (u - 0.5) * CHUNK_SIZE * 0.92;
      const lz = (w - 0.5) * CHUNK_SIZE * 0.92;
      const wx = cx + lx;
      const wz = cz + lz;
      const h =
        fbm2D(worldSeed ^ 0xd01e, wx * 0.065, wz * 0.065, 3) * amp * 0.85 +
        Math.sin(wx * 0.18) * 0.9;
      pushSample(out, cx, cy, cz, lx, h * 0.55 + 1.1, lz, "dunes", 0.55 + (iz & 1) * 0.2);
    }
  }
}

/** Continuous twisted multi-strand ribbon (cyan + amber threads). */
function buildHelix(
  out: Sample[],
  worldSeed: number,
  cx: number,
  cy: number,
  cz: number,
  rng: () => number,
) {
  const strands = 4;
  const alongN = 220;
  const ribbonW = 3; // cross-section samples per step
  const twist = 0.48;
  const baseR = 3.4;
  for (let s = 0; s < strands; s += 1) {
    const strandPhase = (s / strands) * Math.PI * 2;
    const isAmber = s % 2 === 1;
    for (let k = 0; k < alongN; k += 1) {
      const tAlong = k / (alongN - 1);
      const along = (tAlong - 0.5) * CHUNK_SIZE;
      const ang = along * twist + strandPhase;
      const pulse = 0.55 + Math.sin(along * 0.19 + s) * 0.35;
      for (let r = 0; r < ribbonW; r += 1) {
        const rr = (r / (ribbonW - 1) - 0.5) * 1.15;
        const rad = baseR + pulse + rr * 0.55 + Math.sin(ang * 2 + s) * 0.12;
        const lx = Math.cos(ang) * rad + (rng() - 0.5) * 0.06;
        const ly = Math.sin(ang) * rad * 0.78 + (rng() - 0.5) * 0.05;
        const lz = along + rr * 0.15;
        pushSample(
          out,
          cx,
          cy,
          cz,
          lx,
          ly,
          lz,
          "helix",
          isAmber ? 0.72 + rng() * 0.25 : rng() * 0.35,
        );
      }
    }
  }
  // Inner core filament for woven density.
  const coreN = 280;
  for (let k = 0; k < coreN; k += 1) {
    const tAlong = k / (coreN - 1);
    const along = (tAlong - 0.5) * CHUNK_SIZE;
    const ang = along * twist * 1.15;
    const rad = 1.05 + Math.sin(along * 0.4) * 0.25;
    pushSample(
      out,
      cx,
      cy,
      cz,
      Math.cos(ang) * rad,
      Math.sin(ang) * rad * 0.7,
      along,
      "helix",
      0.4 + (k % 2) * 0.35,
    );
  }
  void worldSeed;
}

/** Long flowing filaments / tube walls converging along +Z (FPS tunnel). */
function buildWarp(
  out: Sample[],
  worldSeed: number,
  cx: number,
  cy: number,
  cz: number,
  rng: () => number,
) {
  const rings = 64;
  const spokes = 48;
  for (let i = 0; i < rings; i += 1) {
    const tAlong = i / (rings - 1);
    const along = (tAlong - 0.5) * CHUNK_SIZE;
    const tube =
      2.35 +
      Math.sin(along * 0.42 + worldSeed * 0.00001) * 0.55 +
      Math.sin(along * 0.17) * 0.7;
    for (let j = 0; j < spokes; j += 1) {
      const ang = (j / spokes) * Math.PI * 2;
      // Filament sway — coherent tube wall, not random sticks.
      const sway =
        Math.sin(along * 0.55 + ang * 3) * 0.28 +
        Math.sin(along * 0.21 + j * 0.4) * 0.18;
      const rad = tube + sway;
      const lx = Math.cos(ang) * rad + (rng() - 0.5) * 0.05;
      const ly = Math.sin(ang) * rad * 0.84 + (rng() - 0.5) * 0.04;
      const lz = along;
      const t = 0.15 + (j % 7) * 0.1 + tAlong * 0.25;
      pushSample(out, cx, cy, cz, lx, ly, lz, "warp", clamp(t, 0, 1));
    }
  }
  // Extra axial filaments toward vanishing point.
  const filaments = 28;
  const perFil = 36;
  for (let f = 0; f < filaments; f += 1) {
    const ang = (f / filaments) * Math.PI * 2 + 0.11;
    const rad0 = 1.1 + (f % 5) * 0.35 + rng() * 0.2;
    for (let k = 0; k < perFil; k += 1) {
      const tAlong = k / (perFil - 1);
      const along = (tAlong - 0.5) * CHUNK_SIZE;
      const rad = rad0 + Math.sin(along * 0.35 + f) * 0.2;
      pushSample(
        out,
        cx,
        cy,
        cz,
        Math.cos(ang) * rad,
        Math.sin(ang) * rad * 0.82,
        along,
        "warp",
        0.35 + tAlong * 0.4,
      );
    }
  }
}

/** Layered magenta particle sheets with clear ridge lines. */
function buildRidges(
  out: Sample[],
  worldSeed: number,
  cx: number,
  cy: number,
  cz: number,
) {
  const layers = 5;
  const nx = 36;
  const nz = 36;
  for (let L = 0; L < layers; L += 1) {
    const yBase = (L / (layers - 1) - 0.5) * CHUNK_SIZE * 0.72;
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const u = i / (nx - 1);
        const w = j / (nz - 1);
        const lx = (u - 0.5) * CHUNK_SIZE;
        const lz = (w - 0.5) * CHUNK_SIZE;
        const wx = cx + lx;
        const wz = cz + lz;
        const ridge =
          Math.abs(
            fbm2D(worldSeed ^ (0x71d9 + L * 19), wx * 0.08, wz * 0.08, 3) - 0.5,
          ) * 2;
        // Emphasize crest lines — denser/higher along ridges.
        const crest = Math.pow(1 - Math.min(1, ridge * 1.6), 2.2);
        if (crest < 0.08 && ((i + j + L) & 3) !== 0) continue;
        const ly =
          yBase +
          crest * 1.8 +
          Math.sin(wx * 0.35 + L) * 0.25 +
          Math.sin(wz * 0.28) * 0.2;
        pushSample(
          out,
          cx,
          cy,
          cz,
          lx,
          ly,
          lz,
          "ridges",
          0.15 + crest * 0.7 + L * 0.05,
        );
      }
    }
  }
}

/** Truly sparse star field — empty vs dense biomes. */
function buildVoid(
  out: Sample[],
  cx: number,
  cy: number,
  cz: number,
  rng: () => number,
) {
  const count = 96;
  for (let i = 0; i < count; i += 1) {
    pushSample(
      out,
      cx,
      cy,
      cz,
      (rng() - 0.5) * CHUNK_SIZE * 1.05,
      (rng() - 0.5) * CHUNK_SIZE * 1.05,
      (rng() - 0.5) * CHUNK_SIZE * 1.05,
      "void",
      rng(),
    );
  }
}

function buildStructure(
  biome: BiomeId,
  out: Sample[],
  worldSeed: number,
  cx: number,
  cy: number,
  cz: number,
  ix: number,
  iz: number,
  rng: () => number,
) {
  switch (biome) {
    case "dunes":
      buildDunes(out, worldSeed, cx, cy, cz, ix, iz);
      break;
    case "helix":
      buildHelix(out, worldSeed, cx, cy, cz, rng);
      break;
    case "warp":
      buildWarp(out, worldSeed, cx, cy, cz, rng);
      break;
    case "ridges":
      buildRidges(out, worldSeed, cx, cy, cz);
      break;
    case "void":
      buildVoid(out, cx, cy, cz, rng);
      break;
    default:
      buildDunes(out, worldSeed, cx, cy, cz, ix, iz);
  }
}

function pointSizeFor(biome: BiomeId): number {
  switch (biome) {
    case "dunes":
      return 0.26;
    case "helix":
      return 0.2;
    case "warp":
      return 0.17;
    case "ridges":
      return 0.22;
    case "void":
      return 0.14;
    default:
      return 0.2;
  }
}

/**
 * Sparse plexus only for helix/warp: connect spatially nearby samples along
 * the structure. Kept very thin so it never becomes “needle sticks”.
 */
function buildSparsePlexus(
  samples: Sample[],
  biome: BiomeId,
  rng: () => number,
): { pos: Float32Array; col: Float32Array; count: number } | null {
  if (biome !== "helix" && biome !== "warp") return null;
  const n = samples.length;
  if (n < 8) return null;
  const maxSeg = biome === "helix" ? 220 : 160;
  const maxDist = biome === "helix" ? 1.85 : 2.4;
  const pos = new Float32Array(maxSeg * 6);
  const col = new Float32Array(maxSeg * 6);
  const color = new THREE.Color();
  let seg = 0;
  // Stride through samples; link each to a nearby later index (coherent, not random pairs).
  const stride = Math.max(1, Math.floor(n / maxSeg));
  for (let i = 0; i < n && seg < maxSeg; i += stride) {
    const a = samples[i]!;
    let bestJ = -1;
    let bestD = maxDist;
    const lim = Math.min(n, i + 28);
    for (let j = i + 1; j < lim; j += 1) {
      const b = samples[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d > 0.25 && d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ < 0 || rng() > 0.72) continue;
    const b = samples[bestJ]!;
    const o = seg * 6;
    pos[o] = a.x;
    pos[o + 1] = a.y;
    pos[o + 2] = a.z;
    pos[o + 3] = b.x;
    pos[o + 4] = b.y;
    pos[o + 5] = b.z;
    colorForBiome(a.biome, a.t, color);
    col[o] = color.r * 0.55;
    col[o + 1] = color.g * 0.55;
    col[o + 2] = color.b * 0.55;
    colorForBiome(b.biome, b.t, color);
    col[o + 3] = color.r * 0.55;
    col[o + 4] = color.g * 0.55;
    col[o + 5] = color.b * 0.55;
    seg += 1;
  }
  if (seg === 0) return null;
  return {
    pos: pos.subarray(0, seg * 6) as Float32Array,
    col: col.subarray(0, seg * 6) as Float32Array,
    count: seg,
  };
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
  const primary = dominantBiome(weights);
  const secondary = secondaryBiome(weights, primary, 0.24);
  const rng = mulberry32(hashInts(worldSeed, ix, iy, iz));

  const samples: Sample[] = [];

  // Vertical neighbors: sparse accent only (budget → denser eye-height seas).
  if (Math.abs(iy) >= 1) {
    buildVoid(samples, cx, cy, cz, rng);
  } else {
    buildStructure(primary, samples, worldSeed, cx, cy, cz, ix, iz, rng);

    // Soft blend: thin overlay of a second biome structure (not per-particle roulette).
    if (secondary && secondary !== "void" && primary !== "void") {
      const blend: Sample[] = [];
      buildStructure(secondary, blend, worldSeed, cx, cy, cz, ix, iz, rng);
      const keep = Math.floor(
        blend.length * clamp(weights[secondary]! * 0.55, 0.12, 0.32),
      );
      const step = Math.max(1, Math.floor(blend.length / Math.max(1, keep)));
      for (let i = 0; i < blend.length && samples.length < 6200; i += step) {
        samples.push(blend[i]!);
      }
    } else if (primary === "void" && secondary) {
      // Void stays sparse — tiny accent only.
      const blend: Sample[] = [];
      buildStructure(secondary, blend, worldSeed, cx, cy, cz, ix, iz, rng);
      const keep = Math.min(40, Math.floor(blend.length * 0.04));
      for (let i = 0; i < keep; i += 1) {
        samples.push(blend[Math.floor(rng() * blend.length)]!);
      }
    }
  }

  const live = Math.max(1, samples.length);
  const posLive = new Float32Array(live * 3);
  const colLive = new Float32Array(live * 3);
  const color = new THREE.Color();
  for (let i = 0; i < live; i += 1) {
    const s = samples[i]!;
    posLive[i * 3] = s.x;
    posLive[i * 3 + 1] = s.y;
    posLive[i * 3 + 2] = s.z;
    colorForBiome(s.biome, s.t, color);
    // Hotter additive glow on dense biomes.
    const glow =
      s.biome === "void"
        ? 0.55 + (i % 5) * 0.06
        : 0.85 + (i % 9) * 0.04;
    colLive[i * 3] = Math.min(1.8, color.r * glow);
    colLive[i * 3 + 1] = Math.min(1.8, color.g * glow);
    colLive[i * 3 + 2] = Math.min(1.8, color.b * glow);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posLive, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colLive, 3));
  const size = pointSizeFor(primary);
  const points = new THREE.Points(
    geo,
    createPointsMaterial(glowMap, size, primary === "void" ? 0.85 : 0.98),
  );
  points.frustumCulled = true;
  scene.add(points);

  let lines: THREE.LineSegments | null = null;
  const plexus =
    Math.abs(iy) < 1 ? buildSparsePlexus(samples, primary, rng) : null;
  if (plexus) {
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(plexus.pos), 3),
    );
    lineGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(plexus.col), 3),
    );
    lines = new THREE.LineSegments(
      lineGeo,
      createLineMaterial(primary === "helix" ? 0.18 : 0.12),
    );
    lines.frustumCulled = true;
    scene.add(lines);
  }

  return { key, ix, iy, iz, points, lines };
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
    const cy = Math.floor(cam.y / CHUNK_SIZE);
    const cz = Math.floor(cam.z / CHUNK_SIZE);

    const needed = new Set<ChunkKey>();
    for (let dz = -1; dz <= KEEP_RADIUS + 1; dz += 1) {
      for (let dx = -KEEP_RADIUS; dx <= KEEP_RADIUS; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (Math.abs(dx) + Math.abs(dy) > KEEP_RADIUS + 1) continue;
          // Prefer horizontal band: skip far vertical corners.
          if (Math.abs(dy) === 1 && Math.abs(dx) === KEEP_RADIUS) continue;
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
