/**
 * Phantom sonar contacts (design doc §4.5 声呐假读数, §4.2 侵蚀 基地的幽灵回波), pure:
 * returns with nothing behind them, drawn by phantomMesh.ts only where a sonar
 * front or its trail passes (they are echoes, not objects). Shapes, in metres:
 *  - node: a tight cluster of small returns, like a crystal node's;
 *  - mass: one large body — returns strung along a gently bent 26 … 48 m curve;
 *  - home: the base's silhouette (a tall lighthouse column over a broad core).
 * A contact fades out (never pops) once the diver comes close, at its end of
 * life, or when a new ping replaces it.
 */
import { CHAOS_LOOK } from "./config";

export type Blip = { x: number; y: number; z: number; size: number };
export type PhantomContact = { blips: Blip[]; born: number; life: number; fade: number; leaving: boolean };

type Rand = () => number;
type Point = { x: number; y: number; z: number };

export function nodeShape(c: Point, rand: Rand): Blip[] {
  const N = CHAOS_LOOK.late.phantom.node;
  return Array.from({ length: N.blips }, () => ({
    x: c.x + (rand() * 2 - 1) * N.spread,
    y: c.y + (rand() * 2 - 1) * N.spread * 0.6,
    z: c.z + (rand() * 2 - 1) * N.spread,
    size: N.size * (0.7 + 0.5 * rand()),
  }));
}

export function massShape(c: Point, rand: Rand): Blip[] {
  const M = CHAOS_LOOK.late.phantom.mass;
  const len = M.length[0] + (M.length[1] - M.length[0]) * rand();
  const h = rand() * Math.PI * 2, dx = Math.cos(h), dz = Math.sin(h);
  const bend = (rand() * 2 - 1) * 0.18 * len, rise = (rand() * 2 - 1) * 0.08 * len;
  return Array.from({ length: M.blips }, (_, i) => {
    const t = i / (M.blips - 1) - 0.5, arc = Math.cos(t * Math.PI);
    return { x: c.x + dx * t * len - dz * bend * arc, y: c.y + rise * arc, z: c.z + dz * t * len + dx * bend * arc, size: M.size * (0.55 + 0.45 * arc) };
  });
}

/** The base as the sonar knows it: a lighthouse column over the core's broad return. */
export function homeShape(c: Point): Blip[] {
  const out: Blip[] = [];
  for (let i = 0; i < 6; i++) out.push({ x: c.x, y: c.y + 6 + i * 7, z: c.z, size: 6 });
  for (let i = 0; i < 3; i++) out.push({ x: c.x + Math.cos(i * 2.1) * 7, y: c.y + 2, z: c.z + Math.sin(i * 2.1) * 7, size: 13 });
  return out;
}

export class ContactSet {
  readonly list: PhantomContact[] = [];

  add(blips: Blip[], born: number, life: number): void {
    this.list.push({ blips, born, life, fade: 1, leaving: false });
  }

  /** Every current contact fades out (a new ping: what it shows is decided afresh). */
  leaveAll(): void {
    for (const c of this.list) c.leaving = true;
  }

  /** Per frame: approach / age fade, retire the faded. */
  update(dt: number, time: number, diver: Point): void {
    const P = CHAOS_LOOK.late.phantom;
    for (const c of this.list) {
      if (!c.leaving && (time - c.born > c.life || c.blips.some((b) => Math.hypot(b.x - diver.x, b.y - diver.y, b.z - diver.z) < P.vanish))) c.leaving = true;
      if (c.leaving) c.fade = Math.max(0, c.fade - dt / P.fadeS);
    }
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].fade <= 0) this.list.splice(i, 1);
  }

  clear(): void {
    this.list.length = 0;
  }
}
