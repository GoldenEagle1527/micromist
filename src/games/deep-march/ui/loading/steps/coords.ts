/** 01 Sea coordinates: the world exists = seed read and entry point found. */
import type { LoadingStepDef } from "./types";

export const coordsStep: LoadingStepDef = {
  id: "coords",
  weight: 4,
  required: true,
  evaluate(snap, { L, seedText, seed }) {
    const seedLine = L.seed(seedText, (seed >>> 0).toString(16).padStart(8, "0"));
    if (!snap) return { state: "active", lines: [seedLine, L.locating] };
    const { x, y, z } = snap.spawn;
    return {
      state: "done",
      lines: [seedLine, L.spawnFix(Math.round(x), Math.round(z), Math.round(100 - y))],
      diag: [{ label: L.diag.spawn, value: `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}` }],
    };
  },
};
