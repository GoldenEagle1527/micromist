/**
 * The base's 2D placement rules (§6.1) — what the ledger side can decide from
 * positions alone. The ground itself (flat, slope, clearance, region blend,
 * frozen-zone check) is the terrain's (terrain/groundProbe.ts, frozenZone.ts);
 * the scene asks both and shows the first reason (red hologram).
 *
 *   core:   first; ≥ BASE.wallClearance from the wall's inner face;
 *   others: after the core; inside the protection radius; within the grid
 *           (BASE.gridRange of the core or an energy tower); no footprint
 *           overlap (+ BASE.gap); at most BASE.maxStructures;
 *   all:    the cost is covered by base storage + the diver's tank.
 */
import { BASE, STRUCTURES, type StructureKind } from "../config";
import type { ReadonlyParticleVector } from "../particles/particleVector";
import { coreOf, costOf, protectionRadius, type BaseStructure } from "./baseState";

export type PlacementReason = "ok" | "no-core" | "has-core" | "wall" | "radius" | "grid" | "overlap" | "limit" | "cost";

/** The ring wall's inner face as a rectangle with rounded corners (world x/z, m; corner radius, default 0). */
export type WorldRect = { minX: number; maxX: number; minZ: number; maxZ: number; corner?: number };

export type PlacementQuery = {
  kind: StructureKind;
  x: number;
  z: number;
  structures: readonly BaseStructure[];
  rect: WorldRect;
  /** Base storage + tank, per kind (what can pay). */
  funds: ReadonlyParticleVector;
};

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Distance from (x, z) to the wall's inner face (negative outside). */
export function wallDistance(rect: WorldRect, x: number, z: number): number {
  const a = (rect.maxX - rect.minX) / 2, b = (rect.maxZ - rect.minZ) / 2;
  const rc = Math.min(rect.corner ?? 0, a, b);
  const px = Math.abs(x - (rect.minX + a)), pz = Math.abs(z - (rect.minZ + b));
  const qx = px - (a - rc), qz = pz - (b - rc);
  if (qx > 0 && qz > 0) return rc - Math.hypot(qx, qz);
  return Math.min(a - px, b - pz);
}

/** Particles still missing to pay for `kind` (all zero = affordable). */
export function shortfall(kind: StructureKind, funds: ReadonlyParticleVector): number[] {
  return costOf(kind).map((n, k) => Math.max(0, n - funds[k]));
}

function spacingReason(q: PlacementQuery, core: BaseStructure): PlacementReason {
  const def = STRUCTURES[q.kind];
  if (q.structures.length >= BASE.maxStructures) return "limit";
  const [cx, , cz] = core.pos;
  if (dist(q.x, q.z, cx, cz) + def.radius > protectionRadius(q.structures)) return "radius";
  const relays = q.structures.filter((s) => s.kind === "core" || s.kind === "energy");
  if (!relays.some((s) => dist(q.x, q.z, s.pos[0], s.pos[2]) <= BASE.gridRange)) return "grid";
  const hit = q.structures.some((s) => dist(q.x, q.z, s.pos[0], s.pos[2]) < def.radius + STRUCTURES[s.kind].radius + BASE.gap);
  return hit ? "overlap" : "ok";
}

export function placementReason(q: PlacementQuery): PlacementReason {
  const core = coreOf(q.structures);
  if (q.kind === "core") {
    if (core) return "has-core";
    if (wallDistance(q.rect, q.x, q.z) < BASE.wallClearance) return "wall";
  } else {
    if (!core) return "no-core";
    const r = spacingReason(q, core);
    if (r !== "ok") return r;
  }
  return shortfall(q.kind, q.funds).some((n) => n > 0) ? "cost" : "ok";
}
