/**
 * Diver spawn point — deterministic per seed (same seed → same spot, on every
 * device and preset), in a seeded region: regions.spawnRegion() is uniform over
 * all six, so different seeds start in different kinds of terrain.
 *
 * Search (pure function of the density field):
 *   1. cores of the spawn region nearest the origin (regions.coresOf), up to 4;
 *   2. columns at the core and on rings of 7 / 14 / 21 base units (× worldScale;
 *      region weight ≥ 0.99);
 *   3. vertical scan of each column (0.5 u) over the whole water band → water runs;
 *      candidate eye height a little above the run's floor (up to 2.6 base units)
 *      (cave warren: the middle of the run — a chamber);
 *   4. clearance probe: 26 rays (cube directions), rock distance up to 8 u:
 *        clearance = min reach, openness = mean reach, exits = horizontal rays
 *        reaching ≥ 6 u (a tunnel dead end has ≤ 1);
 *      accepted when clearance ≥ 1.8, exits ≥ 2 and openness ≥ 3.5; best score
 *      wins, the search stops at the first core with an accepted spot;
 *   Clearance / exits are diver-scale (world units), everything else scales with
 *   the world.
 *   5. yaw faces the longest horizontal sightline (16 directions, capped at 30 base u,
 *      ties broken toward the farthest seabed 15° below the horizon).
 * Falls back to the next region if a region has no acceptable spot (never seen
 * in tests), and finally to the most open probed point.
 */
import type { DensityField } from "./density";
import { REGION, REGION_COUNT, createRegionSample } from "./regions";

export type SpawnSpot = { x: number; y: number; z: number; yaw: number; region: number; clearance: number; exits: number };

const DIRS26: number[] = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue;
      const l = Math.hypot(dx, dy, dz);
      DIRS26.push(dx / l, dy / l, dz / l);
    }

const cache = new WeakMap<DensityField, SpawnSpot>();

export function findSpawn(field: DensityField): SpawnSpot {
  const hit = cache.get(field);
  if (hit) return hit;
  const iso = field.settings.isoLevel;
  const W = field.settings.worldScale;
  const solid = (x: number, y: number, z: number) => field.sample(x, y, z) >= iso;
  const rs = createRegionSample();
  const reach = (x: number, y: number, z: number, dx: number, dy: number, dz: number, max: number, step: number) => {
    for (let t = step; t <= max; t += step) if (solid(x + dx * t, y + dy * t, z + dz * t)) return t - step;
    return max;
  };
  const probe = (x: number, y: number, z: number) => {
    let min = Infinity, sum = 0, exits = 0;
    for (let i = 0; i < DIRS26.length; i += 3) {
      const r = reach(x, y, z, DIRS26[i], DIRS26[i + 1], DIRS26[i + 2], 8, 0.5);
      if (r < min) min = r;
      sum += r;
      if (DIRS26[i + 1] === 0 && r >= 6) exits++;
    }
    return { clearance: min, openness: sum / 26, exits };
  };
  let fallback: SpawnSpot | null = null, fallbackScore = -Infinity;
  const start = field.regions.spawnRegion();
  for (let k = 0; k < REGION_COUNT; k++) {
    const region = (start + k) % REGION_COUNT;
    for (const core of field.regions.coresOf(region, 4)) {
      let best: SpawnSpot | null = null, bestScore = -Infinity;
      for (let ring = 0; ring <= 3; ring++) {
        const nDir = ring === 0 ? 1 : 8;
        for (let a = 0; a < nDir; a++) {
          const ang = (a / nDir) * Math.PI * 2;
          const x = core.x + Math.cos(ang) * ring * 7 * W, z = core.z + Math.sin(ang) * ring * 7 * W;
          field.regions.sample(x, z, rs);
          if (rs.w[region] < 0.99) continue;
          // water runs of this column
          let runStart = NaN;
          const yTop = 24 * W;
          for (let y = -32 * W; y <= yTop; y += 0.5) {
            const water = !solid(x, y, z);
            if (water && Number.isNaN(runStart)) runStart = y;
            if ((!water || y >= yTop) && !Number.isNaN(runStart)) {
              const gap = y - runStart;
              runStart = NaN;
              if (gap < 3.6) continue;
              const cy = region === REGION.CAVE ? y - gap / 2 : y - gap + Math.min(gap / 2, 2.6 * W);
              const p = probe(x, cy, z);
              const ok = p.clearance >= 1.8 && p.exits >= 2 && p.openness >= 3.5;
              // canyon belt: prefer the trench floor over the plateau top
              const low = region === REGION.CANYON ? (-0.6 * cy) / W : 0;
              const score = Math.min(p.clearance, 4) * 3 + p.openness + p.exits * 0.5 + low + (ok ? 100 : 0);
              const spot = { x, y: cy, z, yaw: 0, region, clearance: p.clearance, exits: p.exits };
              if (score > bestScore) {
                bestScore = score;
                best = spot;
              }
              if (score > fallbackScore) {
                fallbackScore = score;
                fallback = spot;
              }
            }
          }
        }
        if (bestScore >= 100 + 12 + 5 && region !== REGION.CANYON) break; // comfortably open: no need to widen the ring
      }
      if (best && bestScore >= 100) return finish(best);
    }
  }
  return finish(fallback ?? { x: 0, y: 5 * W, z: 0, yaw: 0, region: start, clearance: 0, exits: 0 });

  function finish(s: SpawnSpot): SpawnSpot {
    // face the longest horizontal sightline: forward = (−sin yaw, 0, −cos yaw)
    let bestYaw = 0, bestR = -1;
    for (let a = 0; a < 16; a++) {
      const yaw = (a / 16) * Math.PI * 2;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      // long open sightline, preferring one that still shows the seabed / walls ahead
      const r = Math.min(30 * W, reach(s.x, s.y, s.z, fx, 0, fz, 40 * W, W)) + 0.3 * reach(s.x, s.y, s.z, fx * 0.966, -0.259, fz * 0.966, 40 * W, W);
      if (r > bestR + 1e-9) {
        bestR = r;
        bestYaw = yaw;
      }
    }
    const out = { ...s, yaw: bestYaw };
    cache.set(field, out);
    return out;
  }
}
