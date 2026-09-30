/**
 * A record tile's surface (pure): an indexed triangle mesh in the grid's quantised
 * form (scanGrid.ts) — 3 × u16 position + 2 bytes of normal per vertex, u16 indices —
 * and the flat "soup" form the sphere cut works on (world-space floats, 9 per
 * triangle for positions and 9 for normals). MeshBuilder turns soup back into a
 * mesh, merging corners that snap to the same grid point and dropping triangles
 * that collapse.
 */
import { decodeNormal, dequantXZ, dequantY, encodeNormal, quantXZ, quantY } from "./scanGrid";

export type TileMesh = {
  readonly pos: Uint16Array;
  readonly nrm: Uint8Array;
  readonly idx: Uint16Array;
  /** Surveyed area: the triangles' footprint (m², x / z projection). */
  readonly area: number;
};

/** Triangle soup: p / n hold 9 numbers per triangle (3 corners × xyz). */
export type Soup = { p: number[]; n: number[] };

export const newSoup = (): Soup => ({ p: [], n: [] });
export const soupTris = (s: Soup): number => s.p.length / 9;
export const meshVerts = (m: TileMesh): number => m.pos.length / 3;
export const meshTris = (m: TileMesh): number => m.idx.length / 3;

const MAX_VERTS = 65535;

export class MeshBuilder {
  private readonly tx: number;
  private readonly tz: number;
  private readonly at = new Map<number, number>();
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly idx: number[] = [];
  private area = 0;
  private readonly nb = new Uint8Array(2);

  constructor(tx: number, tz: number) {
    this.tx = tx;
    this.tz = tz;
  }

  get full(): boolean {
    return this.pos.length / 3 >= MAX_VERTS - 3;
  }

  /** Triangle `t` of a soup; false if it collapsed on the grid (or the tile is full). */
  add(s: Soup, t: number): boolean {
    if (this.full) return false;
    const o = t * 9, p = s.p;
    const a = this.vertex(s, o), b = this.vertex(s, o + 3), c = this.vertex(s, o + 6);
    if (a === b || b === c || a === c) return false;
    this.idx.push(a, b, c);
    this.area += Math.abs((p[o + 3] - p[o]) * (p[o + 8] - p[o + 2]) - (p[o + 6] - p[o]) * (p[o + 5] - p[o + 2])) / 2;
    return true;
  }

  finish(): TileMesh | null {
    if (this.idx.length === 0) return null;
    return { pos: Uint16Array.from(this.pos), nrm: Uint8Array.from(this.nrm), idx: Uint16Array.from(this.idx), area: this.area };
  }

  private vertex(s: Soup, o: number): number {
    const qx = quantXZ(s.p[o], this.tx), qy = quantY(s.p[o + 1]), qz = quantXZ(s.p[o + 2], this.tz);
    const key = (qx * 65536 + qy) * 65536 + qz;
    let i = this.at.get(key);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.at.set(key, i);
      this.pos.push(qx, qy, qz);
      encodeNormal(s.n[o], s.n[o + 1], s.n[o + 2], this.nb, 0);
      this.nrm.push(this.nb[0], this.nb[1]);
    }
    return i;
  }
}

/** A tile's mesh as world-space soup (appended to `out`). */
export function soupOf(m: TileMesh, tx: number, tz: number, out: Soup): Soup {
  const nv = new Float64Array(3);
  for (let k = 0; k < m.idx.length; k++) {
    const v = m.idx[k];
    out.p.push(dequantXZ(m.pos[v * 3], tx), dequantY(m.pos[v * 3 + 1]), dequantXZ(m.pos[v * 3 + 2], tz));
    decodeNormal(m.nrm[v * 2], m.nrm[v * 2 + 1], nv, 0);
    out.n.push(nv[0], nv[1], nv[2]);
  }
  return out;
}

/** Soup → mesh (null when nothing is left). */
export function buildMesh(s: Soup, tx: number, tz: number): TileMesh | null {
  const b = new MeshBuilder(tx, tz);
  for (let t = 0, n = soupTris(s); t < n; t++) b.add(s, t);
  return b.finish();
}
