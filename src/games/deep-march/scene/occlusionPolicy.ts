/**
 * Terrain occlusion culling policy (occlusion.ts): tuning, the per-column query
 * state, the pure draw decision and collecting a finished query result.
 */
import type * as THREE from "three";

export const OCC = {
  /** Frames a column stays drawn after its box was last seen. */
  HOLD_FRAMES: 10,
  /** A negative result older than this (frames) doesn't count. */
  MAX_RESULT_AGE: 3,
  /** A query still pending after this many frames: assume visible. */
  MAX_PENDING: 8,
  /** Visible columns re-query this often (frames). */
  VISIBLE_REQUERY: 4,
  /** Box padding (units) for the proxy. */
  BOX_PAD: 2,
  /** Never cull when the camera is within this of a column's box. */
  NEAR_PAD: 12,
  /** Camera move (units) / forward-vector change (1 − dot) per frame that suspends culling. */
  JUMP_DIST: 3,
  JUMP_TURN: 0.03,
  /** Frames culling stays suspended after a jump. */
  JUMP_FRAMES: 4,
};

/** Culled-layer index (the camera only renders layer 0). */
export const HIDDEN_LAYER = 5;

export type OccState = {
  /** Frame of the latest query result that saw the box. */
  lastSeen: number;
  /** Frame the latest completed query was issued, and its result. */
  resultFrame: number;
  resultVisible: boolean;
};

/**
 * Pure decision: draw this column this frame? (see header). `frame` is the current
 * frame number; `unsafe` = camera near / inside, crossfading, or culling suspended.
 */
export function shouldDraw(s: OccState, frame: number, unsafe: boolean): boolean {
  if (unsafe) return true;
  if (s.resultFrame < 0) return true; // never tested
  if (frame - s.resultFrame > OCC.MAX_RESULT_AGE) return true; // stale
  if (s.resultVisible) return true;
  return frame - s.lastSeen > OCC.HOLD_FRAMES ? false : true;
}

export type Entry = OccState & {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  proxy: THREE.Mesh;
  query: WebGLQuery | null;
  /** Frame the in-flight query was issued (−1: none). */
  pendingFrame: number;
  /** Proxy drawn this frame → query begun in onBeforeRender. */
  issuing: boolean;
  culled: boolean;
  touched: number;
};

/**
 * Collect the column's finished query, if any (frame f): result → state; a query
 * pending for too long counts as seen. False on a GL error (culling then fails off).
 */
export function collectQuery(gl: WebGL2RenderingContext, e: Entry, f: number): boolean {
  try {
    if (gl.getQueryParameter(e.query!, gl.QUERY_RESULT_AVAILABLE)) {
      const vis = gl.getQueryParameter(e.query!, gl.QUERY_RESULT) !== 0;
      e.resultFrame = e.pendingFrame;
      e.resultVisible = vis;
      if (vis) e.lastSeen = e.pendingFrame;
      e.pendingFrame = -1;
    } else if (f - e.pendingFrame > OCC.MAX_PENDING) {
      e.lastSeen = f; // slow driver: treat as seen, keep waiting
    }
    return true;
  } catch {
    return false;
  }
}
