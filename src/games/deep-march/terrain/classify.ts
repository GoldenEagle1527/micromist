/**
 * Terrain classification — pure, deterministic, allocation-light helpers on top
 * of the density field, for the HUD and for future gameplay (placing corals /
 * shells / creatures, spawning enemies, ambience, …).
 *
 * Everything works on a `TerrainProbe`, i.e. "what collision treats as rock":
 * the final (vertically smoothed) density with floating rock removed by the
 * mesher counted as water. Build one with `createTerrainProbe(field, isRemoved)`
 * (pass `ChunkManager.isRemoved`; omit it in node tools → raw field).
 *
 * ── 1. Environment at a point (the diver) ──────────────────────────────────
 *   classifyEnvironment(probe, x, y, z) → { kind, features }
 *   26 short rays (up, down, 8 horizontal, 8 at +40°, 8 at −40°) plus 4 floor-fit
 *   rays (down from ±1.5 in x / z) are marched on the density (Lipschitz-bounded
 *   steps + bisection), then:
 *     features.up / down            distance to rock straight up / down (∞ = none within range)
 *     features.side[8]              horizontal distances, 45° apart (index 0 = +x, CCW seen from above)
 *     features.upper[8] / lower[8]  distances along the ±40° rays
 *     features.minSide / meanSide   nearest / mean horizontal hit (misses count as range)
 *     features.openness             fraction of the 26 direction rays that escape (0 = sealed, 1 = open sea)
 *     features.enclosure            weighted closeness of rock around (0 … 1)
 *     features.floorSlope           degrees from horizontal of the floor below, plane fit over ±1.5 (NaN = no floor)
 *     features.wallSteep            |sin| steepness of the nearest horizontal wall (1 = vertical; 0 if none)
 *     features.canyonWidth          narrowest opposing wall pair (∞ = none)
 *     features.falloff              how many of the 8 downward-diagonal rays drop away (convexity, 0 … 8)
 *   Kinds, first match wins (thresholds in ENV, world units / degrees):
 *     cave      rock above (up < 5) and ≥ 6/8 sides closed within 6 and ≥ 6/8 upper (+40°) rays closed
 *     overhang  rock close above (up < 3.5) but open sideways (overhang / under an arch)
 *     canyon    two opposing steep walls (steepness ≥ 0.65), pair width ≤ 8, the other axis ≥ 1.4× wider
 *     cliff     a near-vertical wall (steepness ≥ 0.8) within 3.2
 *     ridge     floor within 3.5, slope ≤ 40°, and ≥ 5/8 downward diagonals fall away (convex high point)
 *     open      nothing within 4.5 in any direction
 *     flat      floor within 4.5 and slope < 22°
 *     slope     floor within 4.5 and slope ≥ 22° (or no floor, nearest side rock not vertical)
 *               (no floor, a vertical wall within 4.5 → cliff)
 *   `EnvironmentTracker` wraps this for real-time use: rays are time-sliced
 *   (5 per frame), one full evaluation every ≥ 0.22 s (≈ 4 Hz), and the shown
 *   label only switches after a candidate has persisted ≥ 0.4 s (hysteresis).
 *
 * ── 2. Surface points (placement) ──────────────────────────────────────────
 *   classifySurface(probe, x, y, z, normal?) → SurfaceInfo
 *     type        "floor-flat" | "floor-slope" | "wall" | "ceiling" | "ledge-top" | "crevice" | "ridge"
 *     orientation "floor-flat" | "floor-slope" | "wall" | "ceiling"   (from the normal alone)
 *     normal      unit normal pointing into water (from the gradient if not given)
 *     curvature   −1 (concave) … +1 (convex): two rings of 8 points at radius 1, lifted / sunk 0.35 along n
 *     exposure    fraction of 9 hemisphere rays escaping 6 units (0 … 1)
 *     sheltered   exposure < 0.45, or a floor-type point with rock overhead within 8
 *   raycastTerrain(probe, ox, oy, oz, dx, dy, dz, maxDist) → { t, x, y, z } | null
 *     find a surface point (e.g. drop a shell: cast (0,−1,0) from a spot in water).
 *   Typical use: pick a candidate with raycastTerrain, then classifySurface and
 *   filter (corals: floor-flat/ridge + exposed; shells: crevice or sheltered floor;
 *   lurking enemies: ceiling / crevice + sheltered).
 */
import type { DensityField } from "./density";

export type TerrainProbe = {
  /** Density relative to the iso level (> 0 solid), as collision sees it. */
  density: (x: number, y: number, z: number) => number;
  /** Unit normal pointing into water (−gradient), written to out. h = difference step. */
  normal: (x: number, y: number, z: number, out: Float64Array, h?: number) => void;
};

/** Build a probe from the field; `isRemoved` = floater cells the renderer dropped (count as water). */
export function createTerrainProbe(
  field: DensityField,
  isRemoved: (x: number, y: number, z: number) => boolean = () => false,
): TerrainProbe {
  const iso = field.settings.isoLevel;
  const density = (x: number, y: number, z: number) => {
    const d = field.sample(x, y, z) - iso;
    return d >= 0 && isRemoved(x, y, z) ? -1 : d;
  };
  const normal = (x: number, y: number, z: number, out: Float64Array, h = 0.15) => {
    const gx = density(x + h, y, z) - density(x - h, y, z);
    const gy = density(x, y + h, z) - density(x, y - h, z);
    const gz = density(x, y, z + h) - density(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[0] = -gx / l;
    out[1] = -gy / l;
    out[2] = -gz / l;
  };
  return { density, normal };
}

// ───────────────────────── rays ─────────────────────────

/** Conservative |∇density| bound used to size march steps (measured max |∂d/∂y| ≈ 10.4). */
const LIPSCHITZ = 12;
const MIN_STEP = 0.12;
const MAX_STEP = 0.9;

/** Number of direction rays from the point itself (the rest are floor-fit rays). */
export const ENV_DIRS = 26;

export type RayHit = { t: number; x: number; y: number; z: number };

/** Distance along a unit direction to the first rock within maxDist, or Infinity. */
export function marchDistance(
  probe: TerrainProbe,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): number {
  let t = 0;
  let d = probe.density(ox, oy, oz);
  if (d >= 0) return 0;
  while (t < maxDist) {
    const step = Math.min(MAX_STEP, Math.max(MIN_STEP, -d / LIPSCHITZ));
    const t1 = Math.min(maxDist, t + step);
    const d1 = probe.density(ox + dx * t1, oy + dy * t1, oz + dz * t1);
    if (d1 >= 0) {
      let lo = t, hi = t1;
      for (let i = 0; i < 4; i++) {
        const m = (lo + hi) / 2;
        if (probe.density(ox + dx * m, oy + dy * m, oz + dz * m) >= 0) hi = m;
        else lo = m;
      }
      return hi;
    }
    if (t1 >= maxDist) break;
    t = t1;
    d = d1;
  }
  return Infinity;
}

/** First rock hit along (dx, dy, dz) (normalised internally), or null. */
export function raycastTerrain(
  probe: TerrainProbe,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): RayHit | null {
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  const t = marchDistance(probe, ox, oy, oz, dx, dy, dz, maxDist);
  return Number.isFinite(t) ? { t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t } : null;
}

// ───────────────────────── environment ─────────────────────────

export type EnvironmentKind = "open" | "flat" | "slope" | "cliff" | "cave" | "overhang" | "canyon" | "ridge";
export const ENVIRONMENT_KINDS: readonly EnvironmentKind[] = ["open", "flat", "slope", "cliff", "cave", "overhang", "canyon", "ridge"];

/** Thresholds (world units unless noted). The diver collision radius is ~0.3. */
export const ENV = {
  rangeUp: 8,
  rangeDown: 8,
  rangeSide: 8,
  rangeDiag: 8,
  diagElevDeg: 40,
  ceiling: 5,
  overhang: 3.5,
  caveSide: 6,
  caveSidesClosed: 6,
  caveUpperClosed: 6,
  canyonWidth: 8,
  canyonAspect: 1.4,
  canyonSteep: 0.65,
  cliffDist: 3.2,
  cliffSteep: 0.8,
  ridgeFloor: 3.5,
  ridgeSlope: 40,
  ridgeFalloff: 5,
  /** A diagonal "falls away" when its hit is farther than this × the flat-floor expectation. */
  falloffRatio: 1.6,
  openClear: 4.5,
  floorNear: 4.5,
  flatSlope: 22,
  /** Evaluation / hysteresis (EnvironmentTracker). */
  evalInterval: 0.22,
  stableTime: 0.4,
  raysPerFrame: 5,
} as const;

export type EnvironmentFeatures = {
  up: number;
  down: number;
  side: number[];
  upper: number[];
  lower: number[];
  minSide: number;
  meanSide: number;
  openness: number;
  enclosure: number;
  floorSlope: number;
  floorNormal: [number, number, number];
  wallSteep: number;
  canyonWidth: number;
  falloff: number;
};

export type EnvironmentResult = { kind: EnvironmentKind; features: EnvironmentFeatures };

/** Horizontal offset of the 4 floor-fit rays. */
const FLOOR_RING = 1.5;

type RayDir = { dx: number; dy: number; dz: number; range: number; ox?: number; oz?: number };

/**
 * Probe rays: [0] up, [1] down, [2..9] side, [10..17] upper, [18..25] lower, and
 * [26..29] down from ±FLOOR_RING in x / z (floor plane fit for the slope).
 */
export const ENV_RAYS: readonly RayDir[] = (() => {
  const out: RayDir[] = [
    { dx: 0, dy: 1, dz: 0, range: ENV.rangeUp },
    { dx: 0, dy: -1, dz: 0, range: ENV.rangeDown },
  ];
  const e = (ENV.diagElevDeg * Math.PI) / 180;
  for (const [cy, sy, range] of [
    [1, 0, ENV.rangeSide],
    [Math.cos(e), Math.sin(e), ENV.rangeDiag],
    [Math.cos(e), -Math.sin(e), ENV.rangeDiag],
  ] as const) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      out.push({ dx: Math.cos(a) * cy, dy: sy, dz: Math.sin(a) * cy, range });
    }
  }
  for (const [ox, oz] of [[FLOOR_RING, 0], [-FLOOR_RING, 0], [0, FLOOR_RING], [0, -FLOOR_RING]]) {
    out.push({ dx: 0, dy: -1, dz: 0, range: ENV.rangeDown + 3, ox, oz });
  }
  return out;
})();

const tmpN = new Float64Array(3);


/** Distance to rock for ray i of ENV_RAYS from (x, y, z). */
export function castEnvRay(probe: TerrainProbe, x: number, y: number, z: number, i: number): number {
  const r = ENV_RAYS[i];
  return marchDistance(probe, x + (r.ox ?? 0), y, z + (r.oz ?? 0), r.dx, r.dy, r.dz, r.range);
}

/** Turn the ray distances (ENV_RAYS order) into features + kind. */
export function classifyFromRays(probe: TerrainProbe, x: number, y: number, z: number, dist: ArrayLike<number>): EnvironmentResult {
  const up = dist[0];
  const down = dist[1];
  const side = Array.from({ length: 8 }, (_, i) => dist[2 + i]);
  const upper = Array.from({ length: 8 }, (_, i) => dist[10 + i]);
  const lower = Array.from({ length: 8 }, (_, i) => dist[18 + i]);

  let escaped = 0;
  let encl = 0;
  for (let i = 0; i < ENV_DIRS; i++) {
    const t = dist[i];
    if (!Number.isFinite(t)) escaped++;
    else encl += 1 - t / ENV_RAYS[i].range;
  }
  const openness = escaped / ENV_DIRS;
  const enclosure = encl / ENV_DIRS;

  let minSide = Infinity, minIdx = -1, sum = 0;
  for (let i = 0; i < 8; i++) {
    const t = side[i];
    sum += Number.isFinite(t) ? t : ENV.rangeSide;
    if (t < minSide) { minSide = t; minIdx = i; }
  }
  const meanSide = sum / 8;

  // Floor slope: plane through the floor below and the 4 ring hits (±1.5 in x / z);
  // ring rays that start inside rock or find no floor fall back to the centre /
  // the wide-step gradient. Much steadier than the local normal on rough rock.
  let floorSlope = NaN;
  const floorNormal: [number, number, number] = [0, 1, 0];
  if (Number.isFinite(down)) {
    probe.normal(x, y - down, z, tmpN, 0.6);
    const ring = (i: number) => {
      const t = dist[26 + i];
      return t > 0 && Number.isFinite(t) && Math.abs(t - down) < 2 * FLOOR_RING ? -t : NaN;
    };
    const c = -down;
    const axis = (p: number, m: number, g: number) =>
      Number.isFinite(p) && Number.isFinite(m) ? (p - m) / (2 * FLOOR_RING)
      : Number.isFinite(p) ? (p - c) / FLOOR_RING
      : Number.isFinite(m) ? (c - m) / FLOOR_RING
      : g;
    const gy = Math.max(0.2, tmpN[1]);
    const a = axis(ring(0), ring(1), -tmpN[0] / gy);
    const b = axis(ring(2), ring(3), -tmpN[2] / gy);
    const l = Math.hypot(a, 1, b);
    floorNormal[0] = -a / l; floorNormal[1] = 1 / l; floorNormal[2] = -b / l;
    floorSlope = (Math.atan(Math.hypot(a, b)) * 180) / Math.PI;
  }

  // Steepness of a horizontal wall hit: 1 − |ny| of its normal.
  const steepAt = (i: number) => {
    const r = ENV_RAYS[2 + i];
    const t = side[i];
    probe.normal(x + r.dx * t, y, z + r.dz * t, tmpN, 0.4);
    return 1 - Math.abs(tmpN[1]);
  };
  const wallSteep = minIdx >= 0 && Number.isFinite(minSide) ? steepAt(minIdx) : 0;

  // Canyon: narrowest opposing pair, the perpendicular pair clearly wider.
  let canyonWidth = Infinity;
  let canyonPair = -1;
  for (let i = 0; i < 4; i++) {
    const w = side[i] + side[i + 4];
    if (w < canyonWidth) { canyonWidth = w; canyonPair = i; }
  }
  let isCanyon = false;
  if (canyonPair >= 0 && canyonWidth <= ENV.canyonWidth) {
    const j = (canyonPair + 2) % 4;
    const perp = Math.min(side[j], ENV.rangeSide) + Math.min(side[j + 4], ENV.rangeSide);
    isCanyon = perp >= ENV.canyonAspect * canyonWidth && steepAt(canyonPair) >= ENV.canyonSteep && steepAt(canyonPair + 4) >= ENV.canyonSteep;
  }

  // Convexity: downward diagonals landing much farther than a flat floor would.
  let falloff = 0;
  if (Number.isFinite(down)) {
    const expect = down / Math.sin((ENV.diagElevDeg * Math.PI) / 180);
    for (let i = 0; i < 8; i++) if (lower[i] > expect * ENV.falloffRatio + 0.5) falloff++;
  }

  const sidesClosed = side.filter((t) => t <= ENV.caveSide).length;
  const upperClosed = upper.filter((t) => Number.isFinite(t)).length;
  let minAll = Infinity;
  for (let i = 0; i < ENV_DIRS; i++) minAll = Math.min(minAll, dist[i]);

  let kind: EnvironmentKind;
  if (up < ENV.ceiling && sidesClosed >= ENV.caveSidesClosed && upperClosed >= ENV.caveUpperClosed) kind = "cave";
  else if (up < ENV.overhang) kind = "overhang";
  else if (isCanyon) kind = "canyon";
  else if (minSide <= ENV.cliffDist && wallSteep >= ENV.cliffSteep) kind = "cliff";
  else if (down <= ENV.ridgeFloor && floorSlope <= ENV.ridgeSlope && falloff >= ENV.ridgeFalloff) kind = "ridge";
  else if (minAll > ENV.openClear) kind = "open";
  else if (down <= ENV.floorNear) kind = floorSlope < ENV.flatSlope ? "flat" : "slope";
  else if (minSide <= ENV.openClear) kind = wallSteep >= ENV.cliffSteep ? "cliff" : "slope";
  else kind = "open";

  return {
    kind,
    features: { up, down, side, upper, lower, minSide, meanSide, openness, enclosure, floorSlope, floorNormal, wallSteep, canyonWidth, falloff },
  };
}

/** One-shot environment classification (30 rays; ~2–3 ms on desktop). */
export function classifyEnvironment(probe: TerrainProbe, x: number, y: number, z: number): EnvironmentResult {
  const dist = new Float64Array(ENV_RAYS.length);
  for (let i = 0; i < ENV_RAYS.length; i++) dist[i] = castEnvRay(probe, x, y, z, i);
  return classifyFromRays(probe, x, y, z, dist);
}

/**
 * Real-time wrapper: casts a few rays per update from a frozen origin, then
 * classifies (≈ 4 Hz) and applies hysteresis. Deterministic for a given
 * sequence of (position, dt) calls.
 */
export class EnvironmentTracker {
  private readonly probe: TerrainProbe;
  private readonly dist = new Float64Array(ENV_RAYS.length);
  private next = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private sinceEval = Infinity;
  private candidate: EnvironmentKind | null = null;
  private candidateTime = 0;
  /** Stable (displayed) kind; null until the first evaluation. */
  kind: EnvironmentKind | null = null;
  /** Latest raw (unfiltered) result. */
  last: EnvironmentResult | null = null;
  /** Cost of the last full evaluation, ms (sum of its slices). */
  lastCostMs = 0;
  private cost = 0;

  constructor(probe: TerrainProbe) {
    this.probe = probe;
  }

  reset() {
    this.next = 0;
    this.sinceEval = Infinity;
    this.candidate = null;
    this.kind = null;
    this.last = null;
  }

  update(x: number, y: number, z: number, dt: number, now: () => number = () => performance.now()) {
    this.sinceEval += dt;
    this.candidateTime += dt;
    if (this.next === 0) {
      if (this.sinceEval < ENV.evalInterval) return;
      this.ox = x; this.oy = y; this.oz = z;
      this.cost = 0;
    }
    const t0 = now();
    // First evaluation runs in one go so the HUD isn't blank.
    const n = this.kind === null ? ENV_RAYS.length : ENV.raysPerFrame;
    const end = Math.min(ENV_RAYS.length, this.next + n);
    for (let i = this.next; i < end; i++) this.dist[i] = castEnvRay(this.probe, this.ox, this.oy, this.oz, i);
    this.next = end;
    if (end < ENV_RAYS.length) { this.cost += now() - t0; return; }
    this.next = 0;
    this.sinceEval = 0;
    const r = classifyFromRays(this.probe, this.ox, this.oy, this.oz, this.dist);
    this.cost += now() - t0;
    this.lastCostMs = this.cost;
    this.last = r;
    if (this.kind === null) { this.kind = r.kind; this.candidate = r.kind; return; }
    if (r.kind === this.kind) { this.candidate = r.kind; return; }
    if (r.kind !== this.candidate) { this.candidate = r.kind; this.candidateTime = 0; return; }
    if (this.candidateTime >= ENV.stableTime) this.kind = r.kind;
  }
}

// ───────────────────────── surfaces ─────────────────────────

export type SurfaceOrientation = "floor-flat" | "floor-slope" | "wall" | "ceiling";
export type SurfaceType = SurfaceOrientation | "ledge-top" | "crevice" | "ridge";

export type SurfaceInfo = {
  type: SurfaceType;
  orientation: SurfaceOrientation;
  normal: [number, number, number];
  curvature: number;
  exposure: number;
  sheltered: boolean;
};

export const SURFACE = {
  flatNy: 0.8,
  floorNy: 0.45,
  ceilingNy: -0.45,
  ringRadius: 1.0,
  ringOffset: 0.35,
  /** curvature ≤ concave → crevice; ≥ convex → ridge. */
  concave: -0.375,
  convex: 0.375,
  ledgeReach: 1.4,
  ledgeDrop: 2,
  exposureRange: 6,
  shelterRoof: 8,
  shelteredExposure: 0.45,
} as const;

/**
 * Classify a point on (or within ~0.3 of) the rock surface. `normal` (unit,
 * pointing into water) is taken from the density gradient when omitted.
 */
export function classifySurface(
  probe: TerrainProbe,
  x: number, y: number, z: number,
  normal?: ArrayLike<number>,
): SurfaceInfo {
  let nx: number, ny: number, nz: number;
  if (normal) { nx = normal[0]; ny = normal[1]; nz = normal[2]; }
  else { probe.normal(x, y, z, tmpN, 0.25); nx = tmpN[0]; ny = tmpN[1]; nz = tmpN[2]; }
  const orientation: SurfaceOrientation =
    ny >= SURFACE.flatNy ? "floor-flat" : ny >= SURFACE.floorNy ? "floor-slope" : ny > SURFACE.ceilingNy ? "wall" : "ceiling";

  // Tangent basis.
  let tx: number, ty: number, tz: number;
  if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; } else { tx = 1; ty = 0; tz = 0; tx -= nx * nx; ty -= ny * nx; tz -= nz * nx; }
  let l = Math.hypot(tx, ty, tz) || 1;
  tx /= l; ty /= l; tz /= l;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;

  // Curvature: solid fraction on a tangent ring lifted slightly off the surface.
  const R = SURFACE.ringRadius;
  const lift = SURFACE.ringOffset;
  let solid = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a) * R, s = Math.sin(a) * R;
    const px = x + tx * c + bx * s + nx * lift;
    const py = y + ty * c + by * s + ny * lift;
    const pz = z + tz * c + bz * s + nz * lift;
    if (probe.density(px, py, pz) >= 0) solid++;
  }
  let sunkWater = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const c = Math.cos(a) * R, s = Math.sin(a) * R;
    if (probe.density(x + tx * c + bx * s - nx * lift, y + ty * c + by * s - ny * lift, z + tz * c + bz * s - nz * lift) < 0) sunkWater++;
  }
  // Flat → 0; convex (sunk ring pokes out into water) → +; concave (lifted ring buried) → −.
  const curvature = (sunkWater - solid) / 8;

  // Exposure: 9 rays over the hemisphere around the normal.
  const ex = x + nx * 0.3, ey = y + ny * 0.3, ez = z + nz * 0.3;
  let escaped = 0;
  const cone = Math.SQRT1_2;
  for (let i = 0; i < 9; i++) {
    let dx = nx, dy = ny, dz = nz;
    if (i > 0) {
      const a = ((i - 1) * Math.PI) / 4;
      const c = Math.cos(a), s = Math.sin(a);
      dx = nx * cone + (tx * c + bx * s) * cone;
      dy = ny * cone + (ty * c + by * s) * cone;
      dz = nz * cone + (tz * c + bz * s) * cone;
    }
    if (!Number.isFinite(marchDistance(probe, ex, ey, ez, dx, dy, dz, SURFACE.exposureRange))) escaped++;
  }
  const exposure = escaped / 9;
  const floorish = orientation === "floor-flat" || orientation === "floor-slope";
  const roof = floorish ? marchDistance(probe, ex, ey, ez, 0, 1, 0, SURFACE.shelterRoof) : Infinity;
  const sheltered = exposure < SURFACE.shelteredExposure || Number.isFinite(roof);

  let type: SurfaceType = orientation;
  if (orientation !== "ceiling") {
    if (curvature <= SURFACE.concave) type = "crevice";
    else if (floorish && ny >= 0.6) {
      // Ledge top: a drop within reach on some side.
      let drop = false;
      for (let i = 0; i < 4 && !drop; i++) {
        const a = (i * Math.PI) / 2;
        const c = Math.cos(a) * SURFACE.ledgeReach, s = Math.sin(a) * SURFACE.ledgeReach;
        const px = x + c, pz = z + s, py = y + 0.4;
        if (probe.density(px, py, pz) >= 0) continue;
        if (!Number.isFinite(marchDistance(probe, px, py, pz, 0, -1, 0, SURFACE.ledgeDrop + 0.4))) drop = true;
      }
      if (drop) type = "ledge-top";
      else if (curvature >= SURFACE.convex) type = "ridge";
    } else if (curvature >= SURFACE.convex) type = "ridge";
  }
  l = Math.hypot(nx, ny, nz) || 1;
  return { type, orientation, normal: [nx / l, ny / l, nz / l], curvature, exposure, sheltered };
}
