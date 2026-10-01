/**
 * The 结局演练 sandbox's world (staging debug panel; session/rehearsal.ts): a
 * copy of the save turned into a generation at stage 5 — the main breach open
 * by the tide's own crack rules, the wall at m 0.79, the gaze at the chosen
 * phase — with enough in base storage to rehearse both endings: what brings the
 * forecast down to m ≈ 0.79 (归还 gives it back) and the four anchors' price.
 * Only ever held in memory: the real slot is never written. Pure.
 */
import { evolveCracks } from "../chaos/cracks";
import { ringOf } from "../chaos/ring";
import { wallThickness } from "../chaos/wallModel";
import { PARTICLE_TYPES } from "../particles/particleTypes";
import { vectorFromCounts } from "../particles/particleVector";
import type { WorldSave } from "../save/schema";
import { GAZE, type GazePhase } from "./config";
import { freshGaze } from "./model";

const M = 0.79;

/** Move up to `n` of kind k from the world into base storage (keeping half the world's). */
function lock(s: WorldSave, k: number, n: number): number {
  const take = Math.max(0, Math.min(Math.floor(n), Math.floor(s.ledger.world[k] / 2)));
  s.ledger.world[k] -= take;
  s.ledger.base[k] += take;
  s.base!.storage[k] += take;
  return take;
}

function stockBase(s: WorldSave): void {
  const price = vectorFromCounts(GAZE.anchors.cost).map((n) => n * GAZE.anchors.count);
  price.forEach((n, k) => n > 0 && lock(s, k, n));
  const N = s.totals.reduce((a, b) => a + b, 0);
  const outside = N - s.ledger.player.reduce((a, b) => a + b, 0) - s.ledger.base.reduce((a, b) => a + b, 0);
  let need = outside - Math.floor(M * N);
  const order = PARTICLE_TYPES.map((_, k) => k).sort((a, b) => s.ledger.world[b] - s.ledger.world[a]);
  for (const k of order) if (need > 0) need -= lock(s, k, need);
}

export function rehearsalSave(save: WorldSave, phase: GazePhase): WorldSave {
  const s = structuredClone(save);
  delete s.flags.endingA;
  if (s.base) stockBase(s);
  const thickness = wallThickness(M);
  const center = s.base?.center ?? null;
  const cracks = evolveCracks(s.chaos.cracks, {
    m: M, thickness, gen: s.gen, seed: s.seed, ring: ringOf(s.size), base: center && { x: center[0], z: center[2] }, siteHarvest: [], gaze: true,
  });
  s.chaos = { m: M, stage: 5, wallThickness: thickness, cracks, gaze: freshGaze(GAZE.phases[phase]) };
  return s;
}
