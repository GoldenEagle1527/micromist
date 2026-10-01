/**
 * The session's side of the tide (tide/controller.ts) and of the gaze
 * (gaze/controller.ts): the save, the base and the expedition they act on, the
 * expedition lock, the commit of gen + 1, the gaze's anchors (cached per
 * generation), its writes and 湮灭 (the final save written once).
 */
import type { Base } from "../base/base";
import type { Expedition } from "../expedition/expedition";
import type { TideHost } from "../tide/controller";
import { anchorPoints, type AnchorPoint } from "../gaze/anchors";
import type { GazeHost } from "../gaze/controller";
import type { ParticleLedger } from "../ledger/particleLedger";
import type { WorldSave } from "../save/schema";

export type GazeSessionSide = {
  readonly ledger: ParticleLedger;
  /** The live save header (its chaos.gaze is changed in place). */
  header(): WorldSave;
  base(): Base;
  markDirty(): void;
  flush(): void;
  annihilate(): void;
  rehearsal: boolean;
};

export function gazeHostOf(s: GazeSessionSide): GazeHost {
  let cached: { gen: number; points: AnchorPoint[] } | null = null;
  return {
    ledger: s.ledger,
    gaze: () => s.header().chaos.gaze ?? null,
    anchors: () => {
      const h = s.header();
      if (cached?.gen !== h.gen) cached = { gen: h.gen, points: anchorPoints(h.chaos, h.size) };
      return cached.points;
    },
    base: () => s.base(),
    dirty: () => s.markDirty(),
    flush: () => s.flush(),
    annihilate: () => s.annihilate(),
    rehearsal: s.rehearsal,
  };
}

export type TideSessionSide = {
  readonly ledger: ParticleLedger;
  snapshot(): WorldSave;
  readonly gen: number;
  readonly expedition: Expedition;
  readonly base: Base;
};

export function tideHostOf(s: TideSessionSide, lockExpedition: (on: boolean) => void, advance: (next: WorldSave) => void): TideHost {
  return {
    ledger: s.ledger,
    snapshot: () => s.snapshot(),
    gen: () => s.gen,
    siteHarvest: () => s.expedition.siteHarvest(),
    readiness: () => s.base.tide(),
    dome: () => {
      const { center: c, radius } = s.base.view();
      return c && { x: c[0], y: c[1], z: c[2], radius };
    },
    lockExpedition,
    advance,
  };
}
