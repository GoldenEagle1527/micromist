/**
 * The 结局演练 controls (staging debug panel, a sandboxed session only —
 * session/rehearsal.ts): skip ahead, light the anchors, give particles back
 * until the forecast reaches the seal's m, end it either way. They act on the
 * sandbox's copy of the save; the real slot is never written.
 */
import { GAZE } from "./config";
import type { GazeController, GazeHost } from "./controller";
import type { GazeRehearsal } from "./port";

export function rehearsalOps(ctl: GazeController, host: GazeHost): GazeRehearsal {
  const lightAll = () => {
    const g = host.gaze();
    if (g) g.anchors.forEach((_, k) => ctl.light(g, k, true));
  };
  const returnParticles = () => {
    const base = host.base(), N = host.ledger.grandTotal();
    const outside = N - host.ledger.poolTotal("player") - host.ledger.poolTotal("base");
    let need = Math.ceil((GAZE.seal.m + 1e-4) * N) - outside;
    const storage = base.view().storage;
    const order = storage.map((n, k) => [n, k] as const).sort((a, b) => b[0] - a[0]);
    for (const [n, k] of order) if (need > 0) need -= base.release(k, Math.min(n, need));
    host.flush();
  };
  return {
    skip: (seconds) => {
      const g = host.gaze();
      if (g) g.elapsed = Math.min(GAZE.duration - 1, g.elapsed + seconds);
    },
    lightAll,
    returnParticles,
    annihilate: () => ctl.end(),
    seal: () => {
      lightAll();
      returnParticles();
      ctl.anywhere = true;
    },
  };
}
