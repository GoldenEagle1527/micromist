/**
 * Where the dissolve front is (pure; design doc §5.5): P2 剥离 sweeps it from
 * beyond the view in to the dome, the old terrain kept inside it; P3 leaves
 * only the dome (the frozen 3 × 3, identical in both generations); from P4 the
 * new terrain is drawn inside a front growing back out. Linear in time, so the
 * particles' birth and landing (tideParticleShader.ts) follow the same front.
 */
import type { TidePhase, TideState } from "../../conserve";

export type FrontInput = { state: TideState; phase: TidePhase | null; u: number };

/** Radius (m, horizontal, from the dome centre) inside which the terrain is drawn; null = no front (all of it). */
export function frontRadius(f: FrontInput, domeR: number, reach: number): number | null {
  if (f.state !== "show") return null;
  const u = Math.min(1, Math.max(0, f.u));
  if (f.phase === "strip") return reach + (domeR - reach) * u;
  if (f.phase === "currents") return domeR;
  if (f.phase === "gather") return domeR + (reach - domeR) * u;
  return null;
}

/** Farthest terrain from the dome centre that can be on screen: the view around a diver inside the dome, plus the band. */
export function frontReach(domeR: number, viewDistance: number, band: number): number {
  return domeR + viewDistance + band;
}

export type BoxZone = "in" | "band" | "out";

/**
 * A column's footprint (x0, z0) – (x1, z1) against the front (centre cx, cz,
 * radius r, band w): wholly inside r − w → drawn plainly; wholly beyond r → not
 * drawn; else the dither variant (only this ring pays for discard).
 */
export function boxZone(x0: number, z0: number, x1: number, z1: number, cx: number, cz: number, r: number, w: number): BoxZone {
  const nx = Math.max(x0, Math.min(cx, x1)) - cx, nz = Math.max(z0, Math.min(cz, z1)) - cz;
  const near = Math.hypot(nx, nz);
  const fx = Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), fz = Math.max(Math.abs(z0 - cz), Math.abs(z1 - cz));
  const far = Math.hypot(fx, fz);
  if (near >= r) return "out";
  if (far <= r - w) return "in";
  return "band";
}
