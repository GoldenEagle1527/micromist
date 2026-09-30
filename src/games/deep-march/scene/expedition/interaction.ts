/**
 * Absorbing (吸取, plan M4): the diver aims with the view (the head lamp's
 * axis) — the node or lost cache nearest that axis within reach lights up —
 * and holds the absorb control (E, the left mouse button while captured, or
 * the touch button). Each held frame moves particles into the tank through
 * the expedition port (W → P for a node, L → P for a cache) and drains the
 * battery (the suit's pump, survival/config.ts actions.absorb). A full tank or
 * a flat battery blocks it, and the HUD says why. No three.js scene objects:
 * only the view's aim candidates and the port.
 */
import type { ExpeditionNode, ExpeditionPort } from "../../conserve";
import type { ResourceSystem } from "../../survival";
import { SURVIVAL_TUNING } from "../../survival";
import { ABSORB } from "./config";
import { pickTarget, type Candidate } from "./selection";

export type AbsorbBlock = "full" | "battery" | null;

export type AbsorbTarget = {
  key: number;
  kind: "node" | "cache";
  id: number;
  /** Particle kind (storage index) of a node; null for a cache (mixed). */
  particle: number | null;
  left: number;
  /** Node: its generation-start amount; cache: its total when first aimed at. */
  amount: number;
};

export type AbsorbState = {
  target: AbsorbTarget | null;
  /** Particles are moving this frame. */
  absorbing: boolean;
  /** The control is held. */
  holding: boolean;
  blocked: AbsorbBlock;
};

/** One-shot events for sounds (the scene maps them to cues). */
export type AbsorbEvent = "start" | "emptied" | "full" | "battery" | null;

const DRAIN_SOURCE = "absorb";

/** An aim candidate; nodes carry their spec (nodeView.ts). */
export type AimItem = Candidate & { node?: ExpeditionNode };

export class AbsorbInteraction {
  private readonly port: ExpeditionPort;
  private readonly resources: ResourceSystem;
  private state: AbsorbState = { target: null, absorbing: false, holding: false, blocked: null };
  private cacheStart = new Map<number, number>();
  private wasMoving = false;
  private lastBlock: AbsorbBlock = null;

  constructor(port: ExpeditionPort, resources: ResourceSystem) {
    this.port = port;
    this.resources = resources;
  }

  current(): AbsorbState {
    return this.state;
  }

  /** Eye and unit view direction; `hold` = the control is down; `enabled` false while recalling / loading. */
  update(dt: number, items: readonly AimItem[], eye: readonly [number, number, number], dir: readonly [number, number, number], hold: boolean, enabled: boolean): AbsorbEvent {
    const hit = enabled ? pickTarget(items, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], ABSORB) : null;
    const target = hit ? this.describe(hit) : null;
    const holding = enabled && hold;
    let moved = 0;
    let blocked: AbsorbBlock = null;
    if (holding && target) {
      if (this.resources.view("battery").empty) blocked = "battery";
      else {
        const r = target.kind === "node" ? this.port.absorb(target.id, dt) : this.port.retrieve(target.id, dt);
        moved = r.moved;
        if (r.full) blocked = "full";
        target.left = r.left;
      }
    }
    const moving = holding && !!target && blocked === null;
    this.resources.setDrain("battery", DRAIN_SOURCE, moving ? SURVIVAL_TUNING.actions.absorb : 0);
    if (!moving || (this.state.target && target && this.state.target.key !== target.key)) this.port.release();
    let ev: AbsorbEvent = null;
    if (moving && !this.wasMoving) ev = "start";
    if (moving && moved > 0 && target && target.left <= 0) ev = "emptied";
    if (blocked && blocked !== this.lastBlock) ev = blocked;
    this.wasMoving = moving;
    this.lastBlock = blocked;
    this.state = { target: target && target.left > 0 ? target : null, absorbing: moving, holding, blocked };
    return ev;
  }

  private describe(c: AimItem): AbsorbTarget {
    if (c.kind === "cache") {
      const cache = this.port.caches().find((k) => k.id === c.id);
      const left = cache?.total ?? 0;
      const start = Math.max(this.cacheStart.get(c.id) ?? 0, left);
      this.cacheStart.set(c.id, start);
      return { key: c.key, kind: "cache", id: c.id, particle: null, left, amount: start };
    }
    return { key: c.key, kind: "node", id: c.id, particle: c.node?.kind ?? null, left: this.port.remaining(c.id), amount: c.node?.amount ?? 0 };
  }

  dispose(): void {
    this.resources.clearDrain("battery", DRAIN_SOURCE);
    this.port.release();
  }
}
