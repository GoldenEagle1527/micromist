/**
 * Best-first search of one solid component (mesher.ts floating-rock removal):
 * from a point of the component, toward the hard rows, through the column's padded
 * grid and lazily sampled lattice points in a window `floaterMargin` units around it:
 * - reaches a hard row / anchored point → 0 (anchored, keep);
 * - reaches the window edge or SEARCH_NODE_CAP → 1 (ambiguous, keep);
 * - exhausted → 2: the whole component is enclosed and unanchored, i.e. a true
 *   floater globally (identical in every column whose window holds it).
 */
import { KEEP, NEIGHBOURS, SOLID, type ColumnGrid, type ColumnStats } from "./mesherGrid";
import { lodCoord } from "./columnLattice";

const SEARCH_NODE_CAP = 250_000;

/** The search over grid `state` (window margin Mi lattice points); counts into stats.searched. */
export function createComponentSearch(g: ColumnGrid, state: Uint8Array, Mi: number, stats: ColumnStats): (startIdx: number) => number {
  const { field, iso, lod, sp, px, py, pz, plane, y0, gi0, gk0, rowKind } = g;
  const lc = (v: number) => lodCoord(v, field, lod);
  // Window-local coords: padded grid i=0 ↔ lx = Mi.
  const WX = px + 2 * Mi;
  const WZ = pz + 2 * Mi;
  const wx0 = gi0 - 1 - Mi; // global gi at lx = 0
  const wz0 = gk0 - 1 - Mi;
  const keyOf = (lx: number, ly: number, lz: number) => (lz * WX + lx) * py + ly;
  const outsideSolid = new Map<number, boolean>(); // lazily sampled, shared by searches
  const isOutsideSolid = (lx: number, ly: number, lz: number): boolean => {
    const key = keyOf(lx, ly, lz);
    let v = outsideSolid.get(key);
    if (v === undefined) {
      if (rowKind[ly] === 2) v = true;
      else if (rowKind[ly] === 1) v = false;
      else {
        const ox = lc(wx0 + lx), oy = y0 + (ly - 1) * sp, oz = lc(wz0 + lz);
        v = (lod > 0 ? field.sampleRaw(ox, oy, oz) : field.sample(ox, oy, oz)) >= iso;
        stats.noiseSamples++;
      }
      outsideSolid.set(key, v);
    }
    return v;
  };
  const halfRows = Math.ceil(py / 2) + 1;
  const priority = (ly: number) => {
    // distance (rows) to the nearest hard row: greedy toward anchors
    let d = halfRows;
    for (let j = ly; j >= 0 && ly - j < d; j--) if (rowKind[j] === 2) { d = ly - j; break; }
    for (let j = ly; j < py && j - ly < d; j++) if (rowKind[j] === 2) { d = j - ly; break; }
    return d;
  };
  const rowPriority = new Int32Array(py);
  for (let j = 0; j < py; j++) rowPriority[j] = priority(j);

  /** 0 = anchored, 1 = ambiguous, 2 = exhausted (floating). */
  return (startIdx: number): number => {
    const buckets: number[][] = [];
    let minBucket = Infinity;
    const visited = new Set<number>();
    const push = (key: number, ly: number) => {
      const p = rowPriority[ly];
      (buckets[p] ??= []).push(key);
      if (p < minBucket) minBucket = p;
    };
    const si = startIdx % px;
    const sj = ((startIdx - si) / px) % py;
    const sk = Math.floor(startIdx / plane);
    const startKey = keyOf(si + Mi, sj, sk + Mi);
    visited.add(startKey);
    push(startKey, sj);
    let count = 0;
    while (minBucket < Infinity) {
      const b = buckets[minBucket];
      if (!b || b.length === 0) {
        minBucket++;
        if (minBucket >= buckets.length) minBucket = Infinity;
        continue;
      }
      const key = b.pop()!;
      if (++count > SEARCH_NODE_CAP) {
        stats.searched += count;
        return 1;
      }
      const ly = key % py;
      const rest = (key - ly) / py;
      const lx = rest % WX;
      const lz = (rest - lx) / WX;
      if (rowKind[ly] === 2) {
        stats.searched += count;
        return 0;
      }
      if (lx === 0 || lz === 0 || lx === WX - 1 || lz === WZ - 1) {
        stats.searched += count;
        return 1;
      }
      for (let q = 0; q < NEIGHBOURS.length; q += 3) {
        const nx = lx + NEIGHBOURS[q], nyy = ly + NEIGHBOURS[q + 1], nz = lz + NEIGHBOURS[q + 2];
        if (nyy < 0 || nyy >= py) continue;
        const nkey = keyOf(nx, nyy, nz);
        if (visited.has(nkey)) continue;
        const gx = nx - Mi, gz = nz - Mi;
        if (gx >= 0 && gz >= 0 && gx < px && gz < pz) {
          const st = state[(gz * py + nyy) * px + gx];
          if (st === KEEP) {
            stats.searched += count;
            return 0;
          }
          if (st !== SOLID) continue;
        } else if (!isOutsideSolid(nx, nyy, nz)) continue;
        visited.add(nkey);
        push(nkey, nyy);
      }
    }
    stats.searched += count;
    return 2;
  };
}
