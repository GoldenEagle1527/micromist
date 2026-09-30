/**
 * The ring wall's outline in metres, as the terrain draws it (terrain/
 * wallGeometry.ts): the world rectangle with rounded corners; arc length s runs
 * counter-clockwise from the middle of the +x side. The world is centred on the
 * origin like the site layout (cells −⌊n/2⌋ … n − 1 − ⌊n/2⌋). Pure; test:chaos
 * checks it against the terrain's own outline.
 */
import { RING } from "./config";

export type RingPoint = { x: number; z: number };

export type Ring = {
  /** Outline length, m (the period of s). */
  perimeter: number;
  /** Outline point at arc length s (any real: wraps). */
  point: (s: number) => RingPoint;
  /** Row-major index of the site cell the outline passes at s (the wall site). */
  siteAt: (s: number) => number;
  /** Farthest two points of the world can be apart (normalises distances). */
  diagonal: number;
};

export type RingTuning = { readonly siteMetres: number; readonly cornerRadius: number };

const HALF_PI = Math.PI / 2;

export function ringOf(size: { sitesX: number; sitesZ: number }, t: RingTuning = RING): Ring {
  const G = t.siteMetres;
  const x0 = -Math.floor(size.sitesX / 2) * G, z0 = -Math.floor(size.sitesZ / 2) * G;
  const hx = (size.sitesX * G) / 2, hz = (size.sitesZ * G) / 2;
  const cx = x0 + hx, cz = z0 + hz;
  const rc = Math.min(t.cornerRadius, hx, hz);
  const a = hx - rc, b = hz - rc;
  const Q = b + rc * HALF_PI + a;
  const P = 4 * Q;

  const point = (s: number): RingPoint => {
    s = ((s % P) + P) % P;
    const q = Math.min(3, Math.floor(s / Q));
    const u = q === 0 ? s : q === 1 ? 2 * Q - s : q === 2 ? s - 2 * Q : 4 * Q - s;
    let px: number, pz: number;
    if (u <= b) [px, pz] = [a + rc, u];
    else if (u <= b + rc * HALF_PI) {
      const th = (u - b) / rc;
      [px, pz] = [a + rc * Math.cos(th), b + rc * Math.sin(th)];
    } else [px, pz] = [a - (u - b - rc * HALF_PI), b + rc];
    const sx = q === 0 || q === 3 ? 1 : -1, sz = q <= 1 ? 1 : -1;
    return { x: cx + px * sx, z: cz + pz * sz };
  };

  const clampCell = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  const siteAt = (s: number): number => {
    const p = point(s);
    return clampCell((p.z - z0) / G, size.sitesZ) * size.sitesX + clampCell((p.x - x0) / G, size.sitesX);
  };

  return { perimeter: P, point, siteAt, diagonal: Math.hypot(2 * hx, 2 * hz) };
}

/** Straight-line distance of two points. */
export function ringDistance(p: RingPoint, x: number, z: number): number {
  return Math.hypot(p.x - x, p.z - z);
}
