/** 04 Terrain gate around the spawn: every footprint in view + level 0 near the diver. */
import type { LoadingStepDef } from "./types";

export const terrainStep: LoadingStepDef = {
  id: "terrain",
  weight: 29,
  required: true,
  evaluate(snap, { L }) {
    if (!snap) return { state: "pending", lines: [] };
    const t = snap.terrain;
    if (t.ready) return { state: "done", lines: [L.terrain(100)] };
    if (t.total === 0) return { state: "active", done: 0, total: 1, lines: [L.terrainPlanning] };
    return { state: "active", done: t.done, total: t.total, lines: [L.terrain(Math.floor(Math.min(0.99, t.done / t.total) * 100))] };
  },
};
