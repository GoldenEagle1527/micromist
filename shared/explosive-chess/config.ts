export const EXPLOSION_DELAY_MAX_MS = 1000;

export function clampExplosionDelay(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(EXPLOSION_DELAY_MAX_MS, Math.max(0, n));
}
