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
 * Soft biome weights over world XZ. Wider lobes so colors/micro-structure
 * lerp continuously — no hard chunk dominant pop.
 */
export function sampleBiomeWeights(
  worldSeed: number,
  wx: number,
  wz: number,
): Record<BiomeId, number> {
  // Large contiguous domains that still overlap enough to morph visibly.
  const scale = 0.0028;
  const n0 = fbm2D(worldSeed ^ 0x11a1, wx * scale, wz * scale, 4);
  const n1 = fbm2D(
    worldSeed ^ 0x22b2,
    wx * scale * 0.71 + 40,
    wz * scale * 0.71 - 17,
    3,
  );
  const n2 = valueNoise2D(worldSeed ^ 0x33c3, wx * scale * 1.2, wz * scale * 1.2);

  // Softer lobes (larger variance) → smooth multi-biome blends.
  const raw: Record<BiomeId, number> = {
    dunes: Math.exp(-((n0 - 0.16) ** 2) / 0.055) * (0.7 + n2 * 0.45),
    helix: Math.exp(-((n0 - 0.38) ** 2) / 0.05) * (0.7 + n1 * 0.4),
    warp: Math.exp(-((n0 - 0.58) ** 2) / 0.048) * (0.65 + n2 * 0.5),
    void: Math.exp(-((n0 - 0.8) ** 2) / 0.06) * (0.55 + (1 - n1) * 0.45),
    ridges: Math.exp(-((n1 - 0.55) ** 2) / 0.052) * (0.65 + n0 * 0.35),
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
  minWeight = 0.18,
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

/** Blended HUD label when two biomes share the sea. */
export function biomeBlendLabel(
  weights: Record<BiomeId, number>,
  nameOf: (id: BiomeId) => string,
): string {
  const primary = dominantBiome(weights);
  const secondary = secondaryBiome(weights, primary, 0.22);
  if (!secondary) return nameOf(primary);
  return `${nameOf(primary)} · ${nameOf(secondary)}`;
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

/**
 * Soft-lerp particle color from all biome weights on the continuous sea.
 */
export function colorFromWeights(
  weights: Record<BiomeId, number>,
  t: number,
  out: THREE.Color,
  scratchA: THREE.Color,
  scratchB: THREE.Color,
): THREE.Color {
  out.setRGB(0, 0, 0);
  let sum = 0;
  for (const id of BIOME_IDS) {
    const w = weights[id]!;
    if (w < 0.02) continue;
    colorForBiome(id, t, scratchA);
    out.r += scratchA.r * w;
    out.g += scratchA.g * w;
    out.b += scratchA.b * w;
    sum += w;
  }
  if (sum > 1e-6) out.multiplyScalar(1 / sum);
  else colorForBiome("dunes", t, out);
  void scratchB;
  return out;
}
