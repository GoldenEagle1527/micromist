/** 02 Region map: computed and drawn by the screen in time slices (regionMap.ts). */
import { REGION_MAP } from "../regionMap";
import type { LoadingStepDef } from "./types";

export const regionsStep: LoadingStepDef = {
  id: "regions",
  weight: 12,
  required: true,
  evaluate(snap, { L, mapRows, mapSize }) {
    const km = (REGION_MAP.span / 1000).toFixed(1);
    const pct = Math.floor((mapRows / mapSize) * 100);
    if (!snap) return { state: "pending", lines: [] };
    if (mapRows >= mapSize) return { state: "done", lines: [L.mapProgress(100, km)] };
    return { state: "active", done: mapRows, total: mapSize, lines: [L.mapProgress(pct, km)] };
  },
};
