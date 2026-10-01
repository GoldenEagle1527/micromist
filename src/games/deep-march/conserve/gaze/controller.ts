/**
 * The gaze's sequence on top of the session (design doc §7.3, §9.1; D13, D14):
 * game time runs only while playing (not during a tide, not once both 封界
 * conditions hold); ② the swarm saps the base's energy; ③ tentacles crush the
 * buildings one by one (assault.ts), their particles scattered B → S; the diver
 * lights anchors from the tank (P → S); at 45 minutes the eye's forced tide —
 * 湮灭 (the host writes the final save and ends the session). Pure: the host
 * owns the save, the base and the writes.
 */
import type { BaseView, TideForecast } from "../base/port";
import type { ParticleLedger } from "../ledger/particleLedger";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { vectorFromCounts } from "../particles/particleVector";
import { anchorInReach, type AnchorPoint } from "./anchors";
import { Assault } from "./assault";
import { GAZE } from "./config";
import { litCount, phaseOf, phaseProgress, type GazeState } from "./model";
import type { GazeInput, GazePort, GazeRehearsal, GazeView } from "./port";
import { rehearsalOps } from "./rehearsalOps";

/** What the gaze does to the base (base/base.ts). */
export type GazeBase = {
  view(): BaseView;
  forecast(): TideForecast;
  ruin(id: number): boolean;
  sap(amount: number): void;
  release(kind: number, count: number): number;
};

export type GazeHost = {
  readonly ledger: ParticleLedger;
  /** The generation's gaze — the save's own object, changed in place; null when there is none. */
  gaze(): GazeState | null;
  /** This generation's anchor points (beyond the main breach). */
  anchors(): readonly AnchorPoint[];
  base(): GazeBase;
  /** The gaze changed: write when the throttle allows / now. */
  dirty(): void;
  flush(): void;
  /** 湮灭: write the final save, end the session. */
  annihilate(): void;
  /** The staging 结局演练 sandbox (its controls are offered). */
  rehearsal: boolean;
};

const COST = vectorFromCounts(GAZE.anchors.cost);

export class GazeController implements GazePort {
  readonly rehearsal: GazeRehearsal | null;
  private readonly host: GazeHost;
  private readonly assault = new Assault();
  private ended = false;
  private reach = -1;
  private held = 0;
  private short = false;
  /** Rehearsal 立即封界: the seal tide wherever the diver is. */
  anywhere = false;

  constructor(host: GazeHost) {
    this.host = host;
    this.rehearsal = host.rehearsal ? rehearsalOps(this, host) : null;
  }

  /** For the base's tide readiness: null without a gaze. */
  sealState(): { sealReady: boolean } | null {
    const g = this.host.gaze();
    return g && !this.ended ? { sealReady: this.sealReady(g) } : null;
  }

  damage(id: number): number {
    return this.assault.damage(id);
  }

  tick(i: GazeInput): GazeView {
    const g = this.host.gaze();
    if (g && !this.ended && !i.tide && i.dt > 0) this.advance(g, i);
    return this.view();
  }

  /** 湮灭 now (the sequence's end, or the rehearsal's). */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.host.annihilate();
  }

  private sealReady(g: GazeState): boolean {
    return litCount(g) === GAZE.anchors.count && this.host.base().forecast().m >= GAZE.seal.m - 1e-9;
  }

  private advance(g: GazeState, i: GazeInput): void {
    this.interact(g, i);
    if (this.sealReady(g)) return;
    g.elapsed = Math.min(GAZE.duration, g.elapsed + i.dt);
    const phase = phaseOf(g.elapsed), base = this.host.base();
    if (phase >= 1) base.sap(GAZE.sapPerSec * i.dt);
    if (phase >= 2) {
      const v = base.view();
      const gone = this.assault.step(i.dt, v.buildings, v.center);
      if (gone !== null) base.ruin(gone);
    }
    if (g.elapsed >= GAZE.duration) this.end();
    else this.host.dirty();
  }

  private interact(g: GazeState, i: GazeInput): void {
    const k = anchorInReach(this.host.anchors(), g.anchors, i.diver);
    if (k !== this.reach) [this.reach, this.held] = [k, 0];
    this.short = k >= 0 && !this.affordable();
    if (k < 0 || this.short || !i.interact) {
      this.held = 0;
      return;
    }
    this.held += i.dt;
    if (this.held >= GAZE.anchors.hold) this.light(g, k);
  }

  private affordable(): boolean {
    return COST.every((n, k) => this.host.ledger.amount("player", PARTICLE_TYPES[k]) >= n);
  }

  /** Light anchor k: its price leaves the tank for the suspended pool. */
  light(g: GazeState, k: number, free = false): void {
    if (g.anchors[k]) return;
    if (!free) COST.forEach((n, j) => n > 0 && this.host.ledger.transfer("player", "suspended", PARTICLE_TYPES[j], n));
    g.anchors[k] = true;
    this.held = 0;
    this.host.flush();
  }

  view(): GazeView {
    const g = this.host.gaze();
    const e = g?.elapsed ?? 0, base = g ? this.host.base() : null;
    const sq = this.assault.squeeze, b = sq && base?.view().buildings.find((x) => x.id === sq.id);
    return {
      active: !!g && !this.ended,
      phase: phaseOf(e),
      phaseU: phaseProgress(e),
      elapsed: e,
      left: Math.max(0, GAZE.duration - e),
      forecastM: base ? base.forecast().m : 0,
      sealM: GAZE.seal.m,
      anchors: g ? this.host.anchors().map((p, k) => ({ ...p, lit: g.anchors[k] ?? false })) : [],
      lit: g ? litCount(g) : 0,
      sealReady: !!g && !this.ended && this.sealReady(g),
      anywhere: this.anywhere,
      price: COST,
      reach: g ? this.reach : -1,
      hold: Math.min(1, this.held / GAZE.anchors.hold),
      short: this.short,
      squeeze: sq && b ? { id: sq.id, stage: sq.stage, u: Math.min(1, sq.t / sq.length), pos: b.pos } : null,
      ended: this.ended,
    };
  }
}
