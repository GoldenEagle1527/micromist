/**
 * Far proxy ring of the ring wall (design doc §4.4): a low-poly band on the wall's
 * own facet lattice (wallGeometry.ts), so on the straight sides its triangles ARE
 * the inner face's planar facets (arcs: chords), moved `inset` metres in front of
 * the face. Drawn only beyond the terrain's view distance (scene/wallRing.ts), where
 * no column exists. Pure: world-space arrays, no three.
 */
import type { WallShape } from "./wallGeometry";

export type WallRingOptions = {
  /** Metres in front of the inner face (arcs add their chord sag toward the inside). */
  inset: number;
  /** Height span (metres); the rows are the facet lattice rows inside it. */
  yBot: number;
  yTop: number;
};

export type WallRingGeometry = {
  /** World xyz per vertex. */
  positions: Float32Array;
  indices: Uint16Array;
  triangles: number;
  /** Height span of the rows actually used (metres). */
  y0: number;
  y1: number;
};

/** shape: base units; worldScale: metres per base unit of the field it belongs to. */
export function buildWallRing(shape: WallShape, worldScale: number, o: WallRingOptions): WallRingGeometry {
  const S = worldScale;
  const rows: number[] = [];
  for (let j = 0; j < shape.nr; j++) {
    const y = (shape.y0 + j * shape.dy) * S;
    if (y >= o.yBot - 1e-9 && y <= o.yTop + 1e-9) rows.push(j);
  }
  if (rows.length < 2) throw new Error("wall ring: fewer than 2 facet rows in [yBot, yTop]");
  const ns = shape.ns;
  const positions = new Float32Array(rows.length * ns * 3);
  const p = new Float64Array(4);
  rows.forEach((j, r) => {
    const y = shape.y0 + j * shape.dy;
    for (let i = 0; i < ns; i++) {
      const s = (i + 0.5 * (j & 1)) * shape.ds;
      shape.point(s, shape.facet(s, y) + o.inset / S, p);
      positions.set([p[0] * S, y * S, p[1] * S], (r * ns + i) * 3);
    }
  });
  const idx: number[] = [];
  const at = (r: number, i: number) => r * ns + (i % ns);
  for (let r = 0; r + 1 < rows.length; r++) {
    const odd = rows[r] & 1;
    for (let i = 0; i < ns; i++) {
      const B0 = at(r, i), B1 = at(r, i + 1), T0 = at(r + 1, i), T1 = at(r + 1, i + 1);
      // the lattice triangles of wallGeometry.facet (diagonal by row parity)
      if (!odd) idx.push(B0, B1, T0, B1, T1, T0);
      else idx.push(B0, B1, T1, B0, T1, T0);
    }
  }
  return {
    positions,
    indices: Uint16Array.from(idx),
    triangles: idx.length / 3,
    y0: (shape.y0 + rows[0] * shape.dy) * S,
    y1: (shape.y0 + rows[rows.length - 1] * shape.dy) * S,
  };
}
