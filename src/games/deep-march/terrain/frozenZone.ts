/**
 * The frozen-zone check (design doc §5.3, plan M5): will the terrain inside the
 * base's protection radius stay exactly as it is when the sites around the
 * core are frozen and every other site is drawn again at the next tide?
 *
 * regions.ts weighs, at warped point q, only the sites of q's 5 × 5 cell window
 * whose distance is below d_min + 2·band (the candidates, Δd < band, and the
 * sites that can shape their weights, Δd < 2·band). So if, over the whole zone,
 *
 *   min over non-frozen layout sites of their *smallest possible* distance
 *     (anywhere in their jitter box)  ≥  d_fixed + 2·band + slack,
 *
 * with d_fixed the distance to the nearest fixed site (frozen, or a seeded one
 * outside the layout — those never change), no redrawn site can ever weigh in:
 * weights, regions, hashes and biases (the frozen δ) — the density — are the
 * same in every generation. Checked on a grid of step h: the margin is
 * 2-Lipschitz in q and the warp (1 + L)-Lipschitz, hence the slack
 * 2·(1 + L)·h·√½. Everything in world metres (the scaled region field).
 */
import { MACRO, type RegionField } from "./regions";

export type FrozenZoneQuery = {
  /** Protection zone: centre and radius (world). */
  x: number;
  z: number;
  radius: number;
  /** Layout indices of the frozen sites. */
  frozen: ReadonlySet<number>;
  /** World scale S (terrain settings). */
  worldScale: number;
  /** Grid step, world metres. */
  step?: number;
};

export type FrozenZoneResult = { ok: boolean; margin: number; slack: number; points: number };

/** Warp Lipschitz constant (as in regions.ts maskInRect: |∇ simplex| < 7). */
const WARP_L = MACRO.warpAmp * MACRO.warpFreq * 7;

/** Smallest distance from (qx, qz) to the jitter box of cell (cx, cz), world. */
function boxDistance(qx: number, qz: number, cx: number, cz: number, G: number): number {
  const lo = (1 - MACRO.jitter) / 2, hi = (1 + MACRO.jitter) / 2;
  const dx = Math.max((cx + lo) * G - qx, 0, qx - (cx + hi) * G);
  const dz = Math.max((cz + lo) * G - qz, 0, qz - (cz + hi) * G);
  return Math.hypot(dx, dz);
}

/** Margin (world) at warped point q: min redrawn distance − (fixed distance + 2·band). */
function marginAt(regions: RegionField, q: { x: number; z: number }, frozen: ReadonlySet<number>, G: number, band: number, s: { x: number; z: number; li: number }): number {
  const gx = Math.floor(q.x / G), gz = Math.floor(q.z / G);
  let fixed = Infinity, redrawn = Infinity;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      regions.siteOf(gx + dx, gz + dz, s);
      if (s.li < 0 || frozen.has(s.li)) fixed = Math.min(fixed, Math.hypot(s.x - q.x, s.z - q.z));
      else redrawn = Math.min(redrawn, boxDistance(q.x, q.z, gx + dx, gz + dz, G));
    }
  }
  return redrawn - (fixed + 2 * band);
}

export function checkFrozenZone(regions: RegionField, query: FrozenZoneQuery): FrozenZoneResult {
  const S = query.worldScale;
  const G = MACRO.cell * S, band = MACRO.band * S;
  const h = query.step ?? 2 * S;
  const slack = 2 * (1 + WARP_L) * h * Math.SQRT1_2;
  const q = { x: 0, z: 0 };
  const s = { x: 0, z: 0, li: -1 };
  const r = query.radius + h;
  const n = Math.ceil(r / h);
  let margin = Infinity, points = 0;
  for (let iz = -n; iz <= n; iz++) {
    for (let ix = -n; ix <= n; ix++) {
      if (Math.hypot(ix * h, iz * h) > r) continue;
      regions.warp(query.x + ix * h, query.z + iz * h, q);
      margin = Math.min(margin, marginAt(regions, q, query.frozen, G, band, s));
      points++;
      if (margin < slack) return { ok: false, margin, slack, points };
    }
  }
  return { ok: margin >= slack, margin, slack, points };
}

/** Layout indices of the (2·reach + 1)² cells around the cell holding world (x, z) — the core's frozen square. */
export function frozenCellsAt(regions: RegionField, x: number, z: number, worldScale: number, reach = 1): Set<number> {
  const G = MACRO.cell * worldScale;
  const cx = Math.floor(x / G), cz = Math.floor(z / G);
  const out = new Set<number>();
  const s = { x: 0, z: 0, li: -1 };
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      regions.siteOf(cx + dx, cz + dz, s);
      if (s.li >= 0) out.add(s.li);
    }
  }
  return out;
}
