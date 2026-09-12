/** Pure engine for Pottery / 陶艺 — vertical radius profile, revolved for display. */

export type ClaySize = "small" | "medium" | "large";

export type ToolId = "hand" | "sponge" | "wire";

export const PROFILE_SAMPLES = 48;
export const MIN_RADIUS = 0.12;
export const MAX_RADIUS = 1;
export const MIN_HEIGHT_SAMPLES = 16;
export const UNDO_LIMIT = 40;

export const CLAY_PRESETS: Record<
  ClaySize,
  { radius: number; belly: number; neck: number }
> = {
  small: { radius: 0.52, belly: 0.07, neck: 0.1 },
  medium: { radius: 0.68, belly: 0.1, neck: 0.12 },
  large: { radius: 0.82, belly: 0.12, neck: 0.14 },
};

export type Piece = {
  id: string;
  name: string;
  firedAt: number;
  claySize: ClaySize;
  version: 1;
  profile: number[];
  thumbDataUrl?: string;
};

export function normalizeClaySize(raw: unknown): ClaySize | null {
  if (raw === "small" || raw === "medium" || raw === "large") return raw;
  return null;
}

export function normalizeToolId(raw: unknown): ToolId | null {
  if (raw === "hand" || raw === "sponge" || raw === "wire") return raw;
  return null;
}

export function clampRadius(r: number): number {
  if (!Number.isFinite(r)) return MIN_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));
}

export function clampSampleIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.round(index)));
}

export function cloneProfile(profile: number[]): number[] {
  return profile.slice();
}

export function isValidProfile(raw: unknown): raw is number[] {
  if (!Array.isArray(raw)) return false;
  if (raw.length < MIN_HEIGHT_SAMPLES || raw.length > PROFILE_SAMPLES) {
    return false;
  }
  return raw.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Fresh thrown blank: slight base, soft belly, modest neck. */
export function createProfile(size: ClaySize): number[] {
  const preset = CLAY_PRESETS[size];
  const profile: number[] = [];
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const t = i / (PROFILE_SAMPLES - 1);
    const belly = Math.sin(t * Math.PI) * preset.belly;
    const neck = t * t * preset.neck;
    const base = t < 0.08 ? 0.04 * (1 - t / 0.08) : 0;
    profile.push(clampRadius(preset.radius + belly - neck + base));
  }
  return profile;
}

/**
 * Pull/push clay at a height. `deltaRadius` > 0 widens.
 * Neighbors get a short falloff so the wall stays continuous.
 */
export function applyHand(
  profile: number[],
  sampleIndex: number,
  deltaRadius: number,
): number[] {
  const next = cloneProfile(profile);
  if (next.length === 0 || !Number.isFinite(deltaRadius) || deltaRadius === 0) {
    return next;
  }
  const i = clampSampleIndex(sampleIndex, next.length);
  const falloff = [1, 0.55, 0.22];
  for (let d = 0; d < falloff.length; d++) {
    const amt = deltaRadius * falloff[d]!;
    const a = i - d;
    const b = i + d;
    if (a >= 0) next[a] = clampRadius(next[a]! + amt);
    if (d !== 0 && b < next.length) next[b] = clampRadius(next[b]! + amt);
  }
  return next;
}

/** Smooth a neighborhood around `sampleIndex` (wet sponge). */
export function applySponge(profile: number[], sampleIndex: number): number[] {
  const next = cloneProfile(profile);
  if (next.length === 0) return next;
  const i = clampSampleIndex(sampleIndex, next.length);
  const radius = 3;
  const lo = Math.max(0, i - radius);
  const hi = Math.min(next.length - 1, i + radius);
  for (let j = lo; j <= hi; j++) {
    let sum = 0;
    let n = 0;
    const a = Math.max(0, j - 1);
    const b = Math.min(next.length - 1, j + 1);
    for (let k = a; k <= b; k++) {
      sum += profile[k]!;
      n += 1;
    }
    next[j] = clampRadius(sum / n);
  }
  return next;
}

/**
 * Wire-cut from the rim: keep the bottom `keepSamplesFromBase` samples.
 * Clamped so the pot never disappears and never exceeds PROFILE_SAMPLES.
 */
export function applyWireCut(
  profile: number[],
  keepSamplesFromBase: number,
): number[] {
  const keep = Math.max(
    MIN_HEIGHT_SAMPLES,
    Math.min(PROFILE_SAMPLES, Math.floor(keepSamplesFromBase)),
  );
  if (keep >= profile.length) return cloneProfile(profile);
  return profile.slice(0, keep);
}

export function pushProfileUndo(
  stack: number[][],
  profile: number[],
  max = UNDO_LIMIT,
): number[][] {
  const next = [...stack, cloneProfile(profile)];
  if (next.length > max) return next.slice(next.length - max);
  return next;
}

export function popProfileUndo(stack: number[][]): {
  stack: number[][];
  profile: number[] | null;
} {
  if (stack.length === 0) return { stack, profile: null };
  const profile = cloneProfile(stack[stack.length - 1]!);
  return { stack: stack.slice(0, -1), profile };
}

export function newPieceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
