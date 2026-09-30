/**
 * The generation's chaos as the scene presents it (MVP plan M8): stage, global
 * intensity χ_g and every crack as a world point on the ring with its tangent and
 * outward normal (metres, chaos/ring.ts — the terrain's own outline). Open cracks
 * glow; healed ones are scars. Fixed for the generation (D11): the scene never
 * recomputes chaos from the live ledger. Pure.
 */
import { CHAOS, RING } from "./config";
import { chaosIntensity, type ChaosStage, type ChaosState } from "./model";
import { ringOf } from "./ring";

export type ChaosCrackView = {
  j: number;
  /** Outline point at the crack's arc length (world m). */
  x: number;
  z: number;
  /** Unit tangent along the ring (counter-clockwise) and outward normal. */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  /** Opening width and depth into the wall (m); a scar keeps its last opening's. */
  width: number;
  depth: number;
  through: boolean;
};

export type ChaosView = {
  stage: ChaosStage;
  /** Global intensity χ_g ∈ [0, 1] (0 at stage 0). */
  chi: number;
  /** How far m is into its stage's band: 0 at the calmer end, 1 at the next stage (0 at stage 0). */
  within: number;
  m: number;
  wallThickness: number;
  /** The outline's bounding box: centre and half extents (m). */
  bounds: { cx: number; cz: number; hx: number; hz: number };
  /** Open cracks (they glow) and healed ones (scars), ascending j. */
  cracks: ChaosCrackView[];
  scars: ChaosCrackView[];
  /** A staging preview (debug panel, never saved), not the generation's own state. */
  preview: boolean;
};

/** Half the arc step used for the tangent (m). */
const H = 0.5;

/** Position of m inside its stage's band of m (CHAOS.stages). */
export function stageWithin(stage: ChaosStage, m: number): number {
  const st: readonly number[] = CHAOS.stages;
  if (stage === 0) return 0;
  if (stage >= st.length) return 1;
  const hi = st[stage - 1], lo = st[stage] ?? hi;
  return Math.min(1, Math.max(0, (hi - m) / (hi - lo)));
}

export function chaosViewOf(c: ChaosState, size: { sitesX: number; sitesZ: number }, preview = false): ChaosView {
  const ring = ringOf(size);
  const place = (k: ChaosState["cracks"][number]): ChaosCrackView => {
    const p = ring.point(k.s), a = ring.point(k.s - H), b = ring.point(k.s + H);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / l, tz = (b.z - a.z) / l;
    return { j: k.j, x: p.x, z: p.z, tx, tz, nx: tz, nz: -tx, width: k.width, depth: k.depth, through: k.through };
  };
  return {
    stage: c.stage,
    chi: chaosIntensity(c.m),
    within: stageWithin(c.stage, c.m),
    m: c.m,
    wallThickness: c.wallThickness,
    bounds: boundsOf(size),
    cracks: c.cracks.filter((k) => k.open).map(place),
    scars: c.cracks.filter((k) => k.healed && !k.open).map(place),
    preview,
  };
}

/** The ring outline's bounding box (the same extents as ringOf). */
function boundsOf(size: { sitesX: number; sitesZ: number }): ChaosView["bounds"] {
  const G = RING.siteMetres;
  const hx = (size.sitesX * G) / 2, hz = (size.sitesZ * G) / 2;
  return { cx: -Math.floor(size.sitesX / 2) * G + hx, cz: -Math.floor(size.sitesZ / 2) * G + hz, hx, hz };
}
