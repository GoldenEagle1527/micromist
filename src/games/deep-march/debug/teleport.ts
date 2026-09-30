/**
 * Teleport destinations and safe placement (pure; the debug panel's 传送). Every
 * destination stands in open water `eye` m above the seabed, never inside rock:
 *   - spawn / base: the dive's own spots;
 *   - crack N: `crackInside` m in from the outline, facing the crack;
 *   - edges and corners of a bounded world: `edgeInset` m inside (further in where
 *     the wall rounds a corner), facing out;
 *   - a custom x / y / z: kept when clear, else lifted to the first
 *     clear point above it, else stood on the seabed.
 * Directions: north = −z (yaw 0), east = +x.
 */
import type { ChaosView } from "../conserve";
import type { WorldRect } from "../terrain/siteLayout";
import type { Pose, Solid, TeleportTarget } from "./types";

export const TELEPORT = { eye: 7, clearance: 2, step: 0.5, crackInside: 90, edgeInset: 60, pitchDeg: 4, rimWalk: 600, rimStep: 10 } as const;

/** Vertical search range (m): the terrain's (world scale × the spawn search's units). */
export function heightRange(worldScale: number): { lo: number; hi: number } {
  return { lo: -32 * worldScale, hi: 30 * worldScale };
}

/** Open water with `clearance` m free up, down and to the four sides. */
export function isClear(solid: Solid, x: number, y: number, z: number, r: number = TELEPORT.clearance): boolean {
  return !solid(x, y, z) && !solid(x, y + r, z) && !solid(x, y - r, z) && !solid(x + r, y, z) && !solid(x - r, y, z) && !solid(x, y, z + r) && !solid(x, y, z - r);
}

/** The seabed under the topmost water at (x, z): scanning down, the first rock below open water; null = none in range. */
export function seabedAt(solid: Solid, x: number, z: number, h: { lo: number; hi: number }): number | null {
  let water = false;
  for (let y = h.hi; y >= h.lo; y -= TELEPORT.step) {
    if (!solid(x, y, z)) water = true;
    else if (water) return y + TELEPORT.step;
  }
  return null;
}

/** Standing height at (x, z): `eye` m above the seabed, lifted until clear (range middle without a seabed). */
export function standY(solid: Solid, x: number, z: number, h: { lo: number; hi: number }): number {
  const floor = seabedAt(solid, x, z, h);
  let y = floor === null ? (h.lo + h.hi) / 2 : floor + TELEPORT.eye;
  while (y < h.hi && !isClear(solid, x, y, z)) y += TELEPORT.step;
  return y;
}

/** A requested pose made safe: kept if clear, else the first clear point above, else stood on the seabed. */
export function placeSafely(solid: Solid, p: Pose, h: { lo: number; hi: number }): Pose {
  if (isClear(solid, p.x, p.y, p.z)) return p;
  for (let y = Math.max(p.y, h.lo); y <= h.hi; y += TELEPORT.step) {
    if (isClear(solid, p.x, y, p.z)) return { ...p, y };
  }
  return { ...p, y: standY(solid, p.x, p.z, h) };
}

const PITCH = (TELEPORT.pitchDeg * Math.PI) / 180;
/** Yaw facing the direction (dx, dz): forward = (−sin yaw, 0, −cos yaw). */
export const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);

function standing(solid: Solid, x: number, z: number, yaw: number, h: { lo: number; hi: number }): Pose {
  return { x, y: standY(solid, x, z, h), z, yaw, pitch: PITCH };
}

/** Standing at (x, z), or — inside the wall (rounded corners) — the first clear column walking toward (cx, cz). */
function standingInside(solid: Solid, x: number, z: number, c: { x: number; z: number }, yaw: number, h: { lo: number; hi: number }): Pose {
  const len = Math.hypot(c.x - x, c.z - z) || 1;
  const ux = (c.x - x) / len, uz = (c.z - z) / len;
  for (let t = 0; t <= Math.min(len, TELEPORT.rimWalk); t += TELEPORT.rimStep) {
    const p = standing(solid, x + ux * t, z + uz * t, yaw, h);
    if (isClear(solid, p.x, p.y, p.z)) return p;
  }
  return standing(solid, x, z, yaw, h);
}

/** In front of an open crack, facing it along its outward normal. */
export function crackPose(solid: Solid, c: { x: number; z: number; nx: number; nz: number }, h: { lo: number; hi: number }): Pose {
  const x = c.x - c.nx * TELEPORT.crackInside, z = c.z - c.nz * TELEPORT.crackInside;
  return standing(solid, x, z, yawToward(c.nx, c.nz), h);
}

/** Edge midpoints (n, e, s, w) and corners (ne, nw, se, sw), inset (and clear of the wall), facing out. */
export function rimTargets(solid: Solid, r: WorldRect, h: { lo: number; hi: number }): TeleportTarget[] {
  const i = TELEPORT.edgeInset;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const west = r.x0 + i, east = r.x1 - i, north = r.z0 + i, south = r.z1 - i;
  const at = (kind: "edge" | "corner", key: string, x: number, z: number): TeleportTarget => ({ kind, key, pose: () => standingInside(solid, x, z, { x: cx, z: cz }, yawToward(x - cx, z - cz), h) });
  return [
    at("edge", "n", cx, north),
    at("edge", "e", east, cz),
    at("edge", "s", cx, south),
    at("edge", "w", west, cz),
    at("corner", "ne", east, north),
    at("corner", "nw", west, north),
    at("corner", "se", east, south),
    at("corner", "sw", west, south),
  ];
}

export type TargetInfo = {
  spawn: { x: number; y: number; z: number; yaw: number };
  home: { x: number; y: number; z: number; yaw: number } | null;
  world: WorldRect | null;
  chaos: ChaosView | null;
};

/** Every destination of this dive, in the panel's order: spawn, base, cracks, edges, corners. */
export function teleportTargets(solid: Solid, info: TargetInfo, h: { lo: number; hi: number }): TeleportTarget[] {
  const spot = (kind: "spawn" | "base", s: TargetInfo["spawn"]): TeleportTarget => ({ kind, key: kind, pose: () => ({ ...s, pitch: 0 }) });
  return [
    spot("spawn", info.spawn),
    ...(info.home ? [spot("base", info.home)] : []),
    ...(info.chaos?.cracks ?? []).map((c, n) => ({ kind: "crack" as const, key: String(n + 1), pose: () => crackPose(solid, c, h) })),
    ...(info.world ? rimTargets(solid, info.world, h) : []),
  ];
}
