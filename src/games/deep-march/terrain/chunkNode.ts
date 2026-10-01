/**
 * Streaming quadtree nodes (chunks.ts): the node record, its keys, the tuning
 * constants and the footprint relations / draw-state predicates every chunk
 * module shares.
 */
import type * as THREE from "three";
import type { LodFadeMaterial } from "../scene/seabedMaterial";

export type NodeState = "queued" | "pending" | "ready";
export type NodeKind = "mesh" | "info";

/** A node the planner wants: mesh column (lod, cx, cz) or base-scale info column. */
export type WantedNode = { kind: NodeKind; lod: number; cx: number; cz: number };

export type ChunkNode = {
  key: string;
  /** "mesh": LOD column of the world field; "info": base-scale classification column. */
  kind: NodeKind;
  lod: number;
  cx: number;
  cz: number;
  state: NodeState;
  id: number;
  mesh: THREE.Mesh | null;
  priority: number;
  /** Level 0 only: removed lattice points owned by this column, keyed (j*(n-1) + k)*(n-1) + i. */
  removed: Set<number> | null;
  /** Still part of the wanted set (else drawn only until its replacement is ready). */
  wanted: boolean;
  /** Mesh ready but hidden until the meshes it replaces can crossfade with it. */
  awaitFade: boolean;
  /** Crossfade in progress: +1 fading in, −1 fading out, 0 none. */
  fade: number;
  fadeStart: number;
  fadeMat: LodFadeMaterial | null;
  /** Top level only: built, hidden while finer columns cover it, kept for instant coarsening. */
  resident: boolean;
};

export type ChunkStats = {
  active: number;
  meshes: number;
  queued: number;
  pending: number;
  triangles: number;
  workers: number;
  /** Mean generation time of level-0 columns (ms). */
  avgMs: number;
  /** Mean base-scale classification job time (ms). */
  avgInfoMs: number;
  floaters: number;
  /** Drawn columns / triangles per LOD level. */
  lodMeshes: number[];
  lodTriangles: number[];
  /** Mean generation ms per LOD level. */
  lodMs: number[];
};

export const UPLOAD_BUDGET_MS = 4;
export const MAIN_THREAD_BUDGET_MS = 8;
/**
 * LOD crossfade duration (s): long enough to read as a dissolve rather than a pop,
 * short enough not to hold up the next refinement step (a column splits only once
 * it has settled, see wantedSet).
 */
export const LOD_FADE_S = 0.5;
/** How far ahead (s of travel) the LOD split / build order looks. */
export const LOOKAHEAD_S = 2.5;
/**
 * Top-level columns are wanted this far beyond viewDistance (units): at 9.8 u/s a
 * phone builds a top column (~0.1 s × 3–5) long before the view edge reaches it.
 */
export const PREFETCH_U = 48;
/** A split area merges back only this factor beyond the split distance (no split/merge churn). */
export const SPLIT_HYST = 1.3;
/** Priority band of footprints nothing drawn covers (built before any refinement). */
export const UNCOVERED_BAND = -1e6;

export const meshKey = (lod: number, cx: number, cz: number) => `${lod}:${cx}:${cz}`;
export const infoKey = (cx: number, cz: number) => `i:${cx}:${cz}`;

/** A fresh queued node for a wanted footprint. */
export function newNode(key: string, w: WantedNode): ChunkNode {
  return {
    key, kind: w.kind, lod: w.lod, cx: w.cx, cz: w.cz, state: "queued", id: 0, mesh: null, priority: 0, removed: null, wanted: true,
    awaitFade: false, fade: 0, fadeStart: 0, fadeMat: null, resident: false,
  };
}

/** Drawn on its own: built, not waiting to crossfade in, not mid-crossfade. */
export function settled(n: ChunkNode | undefined): boolean {
  return !!n && n.state === "ready" && !n.awaitFade && n.fade === 0;
}

/** On screen (possibly mid-crossfade), or built empty. */
export function drawn(n: ChunkNode | undefined): boolean {
  return !!n && n.state === "ready" && !n.awaitFade && (!n.mesh || n.mesh.visible);
}

/** Node b's footprint contains node a's (both mesh nodes). */
export function contains(b: ChunkNode, a: ChunkNode): boolean {
  if (b.lod <= a.lod) return b.lod === a.lod && b.cx === a.cx && b.cz === a.cz;
  const d = b.lod - a.lod;
  return a.cx >> d === b.cx && a.cz >> d === b.cz;
}

export function overlaps(a: ChunkNode, b: ChunkNode): boolean {
  return contains(a, b) || contains(b, a);
}
