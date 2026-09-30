/**
 * The seven particle kinds of the conserved world (design doc §3.4), in their fixed
 * storage order: every particle vector is indexed by this order.
 */
export const PARTICLE_TYPES = ["lithic", "silica", "lumen", "ferro", "voltite", "resonite", "abyssal"] as const;

export type ParticleType = (typeof PARTICLE_TYPES)[number];

export const PARTICLE_TYPE_COUNT = PARTICLE_TYPES.length;

export function isParticleType(value: unknown): value is ParticleType {
  return typeof value === "string" && (PARTICLE_TYPES as readonly string[]).includes(value);
}

/** Storage index of a particle kind. */
export function particleIndex(type: ParticleType): number {
  return PARTICLE_TYPES.indexOf(type);
}
