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

/**
 * Softmax-ish biome weights. Smaller spatial scale → larger contiguous regions
 * so biomes persist through longer travel before flipping.
 */
export function sampleBiomeWeights(
  worldSeed: number,
  wx: number,
  wz: number,
): Record<BiomeId, number> {
  // Was ~0.011 (regions flipped quickly). ~0.0035 ≈ 3× larger domains.
  const scale = 0.0035;
  const n0 = fbm2D(worldSeed ^ 0x11a1, wx * scale, wz * scale, 4);
  const n1 = fbm2D(
    worldSeed ^ 0x22b2,
    wx * scale * 0.71 + 40,
    wz * scale * 0.71 - 17,
    3,
  );
  const n2 = valueNoise2D(worldSeed ^ 0x33c3, wx * scale * 1.35, wz * scale * 1.35);

  // Sharper lobes so one (or two) biomes dominate a chunk at a glance.
  const raw: Record<BiomeId, number> = {
    dunes: Math.exp(-((n0 - 0.18) ** 2) / 0.028) * (0.65 + n2 * 0.5),
    helix: Math.exp(-((n0 - 0.38) ** 2) / 0.026) * (0.65 + n1 * 0.45),
    warp: Math.exp(-((n0 - 0.56) ** 2) / 0.024) * (0.6 + n2 * 0.55),
    void: Math.exp(-((n0 - 0.76) ** 2) / 0.032) * (0.55 + (1 - n1) * 0.5),
    ridges: Math.exp(-((n1 - 0.58) ** 2) / 0.028) * (0.6 + n0 * 0.4),
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

/** Second-strongest biome if it is a meaningful soft blend partner. */
export function secondaryBiome(
  weights: Record<BiomeId, number>,
  primary: BiomeId,
  minWeight = 0.22,
): BiomeId | null {
  let best: BiomeId | null = null;
  let bestW = minWeight;
  for (const id of BIOME_IDS) {
    if (id === primary) continue;
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

export function colorForBiome(
  id: BiomeId,
  t: number,
  out: THREE.Color,
): THREE.Color {
  const u = clamp(t, 0, 1);
  switch (id) {
    case "dunes":
      return out.copy(CYAN).lerp(ICE, u * 0.45);
    case "helix":
      // Distinct cyan + amber strands (caller picks t≈0 or ≈1).
      return u < 0.5
        ? out.copy(CYAN).lerp(ICE, u * 0.35)
        : out.copy(AMBER).lerp(new THREE.Color(0xffd089), (u - 0.5) * 0.5);
    case "warp":
      return out.copy(ICE).lerp(CYAN, 0.35 + u * 0.4).lerp(VIOLET, u * 0.25);
    case "void":
      return out.copy(WHITE).lerp(ICE, u * 0.35).multiplyScalar(0.45 + u * 0.4);
    case "ridges":
      return out.copy(MAGENTA).lerp(VIOLET, u * 0.55).lerp(ICE, 0.08);
    default:
      return out.copy(CYAN);
  }
}
