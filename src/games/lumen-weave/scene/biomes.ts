import * as THREE from "three";
import { BIOME_IDS, type BiomeId } from "../biomeIds";
import { clamp, fbm2D, valueNoise2D } from "./seed";

export type { BiomeId } from "../biomeIds";
export { BIOME_IDS } from "../biomeIds";

export type BiomeInfo = {
  id: BiomeId;
  key: BiomeId;
  weights: Record<BiomeId, number>;
};

const CYAN = new THREE.Color(0x3de8ff);
const ICE = new THREE.Color(0xb8f4ff);
const AMBER = new THREE.Color(0xf5a623);
const MAGENTA = new THREE.Color(0xe879f9);
const VIOLET = new THREE.Color(0xa78bfa);
const WHITE = new THREE.Color(0xe8f7ff);

/** Softmax-ish biome weights from dual noise domains (continuous, not templates). */
export function sampleBiomeWeights(
  worldSeed: number,
  wx: number,
  wz: number,
): Record<BiomeId, number> {
  const scale = 0.011;
  const n0 = fbm2D(worldSeed ^ 0x11a1, wx * scale, wz * scale, 4);
  const n1 = fbm2D(worldSeed ^ 0x22b2, wx * scale * 0.73 + 40, wz * scale * 0.73 - 17, 3);
  const n2 = valueNoise2D(worldSeed ^ 0x33c3, wx * scale * 1.6, wz * scale * 1.6);

  // Map noise to five lobes with gentle overlap so transitions blend.
  const raw: Record<BiomeId, number> = {
    dunes: Math.exp(-((n0 - 0.22) ** 2) / 0.045) * (0.55 + n2),
    helix: Math.exp(-((n0 - 0.42) ** 2) / 0.04) * (0.55 + n1),
    warp: Math.exp(-((n0 - 0.58) ** 2) / 0.038) * (0.5 + n2 * 0.8),
    void: Math.exp(-((n0 - 0.74) ** 2) / 0.05) * (0.45 + (1 - n1)),
    ridges: Math.exp(-((n1 - 0.55) ** 2) / 0.042) * (0.5 + n0 * 0.6),
  };

  let sum = 0;
  for (const id of BIOME_IDS) sum += raw[id]!;
  if (sum <= 1e-8) {
    return { dunes: 0.2, helix: 0.2, warp: 0.2, void: 0.2, ridges: 0.2 };
  }
  const out = { ...raw };
  for (const id of BIOME_IDS) out[id] = raw[id]! / sum;
  return out;
}

export function dominantBiome(weights: Record<BiomeId, number>): BiomeId {
  let best: BiomeId = "dunes";
  let bestW = -1;
  for (const id of BIOME_IDS) {
    const w = weights[id]!;
    if (w > bestW) {
      bestW = w;
      best = id;
    }
  }
  return best;
}

export function sampleBiomeAt(worldSeed: number, wx: number, wz: number): BiomeInfo {
  const weights = sampleBiomeWeights(worldSeed, wx, wz);
  const id = dominantBiome(weights);
  return { id, key: id, weights };
}

/** Roulette pick biome for a particle given weights + rng. */
export function pickBiome(weights: Record<BiomeId, number>, u: number): BiomeId {
  let r = clamp(u, 0, 0.999999);
  for (const id of BIOME_IDS) {
    r -= weights[id]!;
    if (r <= 0) return id;
  }
  return "dunes";
}

export function colorForBiome(
  id: BiomeId,
  t: number,
  out: THREE.Color,
): THREE.Color {
  const u = clamp(t, 0, 1);
  switch (id) {
    case "dunes":
      return out.copy(CYAN).lerp(ICE, u * 0.55);
    case "helix":
      return out.copy(AMBER).lerp(CYAN, 0.25 + u * 0.55);
    case "warp":
      return out.copy(ICE).lerp(VIOLET, u * 0.45).lerp(CYAN, 0.2);
    case "void":
      return out.copy(WHITE).lerp(ICE, u * 0.4).multiplyScalar(0.55 + u * 0.35);
    case "ridges":
      return out.copy(MAGENTA).lerp(VIOLET, u * 0.5).lerp(CYAN, 0.12);
    default:
      return out.copy(CYAN);
  }
}
