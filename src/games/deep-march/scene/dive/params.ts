/**
 * URL switches of the dive (debugging, screenshots, comparisons), read once:
 * ?dpr ?lodNear ?refine=0 ?bricks=0 ?wasm=0|1 ?fog ?detail=0 ?occ=0
 * ?debugSpawns=1 ?at=x,y,z,yawDeg,pitchDeg ?light=off|beam|high|sonar
 * ?tide=simple (conserve: always the 浊潮 murk instead of the tide's show).
 */
import { terrainForDevice, type TerrainSettings } from "../../terrain/config";

export type DiveParams = {
  /** Pinned pixel ratio (> 0), else NaN / 0. */
  dpr: number;
  /** Full-resolution ring radius override (> 0). */
  lodNear: number;
  noRefine: boolean;
  noBricks: boolean;
  wasm: boolean | undefined;
  fog: string | null;
  detail: boolean;
  occlusion: boolean;
  debugSpawns: boolean;
  at: string | null;
  light: string | null;
  tideSimple: boolean;
};

export function readDiveParams(search: string): DiveParams {
  const qs = new URLSearchParams(search);
  const wasm = qs.get("wasm");
  return {
    dpr: Number(qs.get("dpr")),
    lodNear: Number(qs.get("lodNear")),
    noRefine: qs.get("refine") === "0",
    noBricks: qs.get("bricks") === "0",
    wasm: wasm === "1" ? true : wasm === "0" ? false : undefined,
    fog: qs.get("fog"),
    detail: qs.get("detail") !== "0",
    occlusion: qs.get("occ") !== "0",
    debugSpawns: qs.get("debugSpawns") === "1",
    at: qs.get("at"),
    light: qs.get("light"),
    tideSimple: qs.get("tide") === "simple",
  };
}

/** The device's terrain preset with the URL overrides. */
export function diveTerrain(lowSpec: boolean, p: DiveParams): TerrainSettings {
  // ?lodNear=<units> overrides the full-resolution ring radius (LOD comparisons / debugging)
  const base = p.lodNear > 0 ? { ...terrainForDevice(lowSpec), lodNear: p.lodNear } : terrainForDevice(lowSpec);
  return {
    ...base,
    // ?refine=0 forces full noise evaluation in mesh jobs (no coarse pre-pass, terrain/refine.ts)
    ...(p.noRefine ? { refine: false } : {}),
    // ?bricks=0: dense mesher passes instead of sparse 8³ bricks (terrain/bricks.ts; same output)
    ...(p.noBricks ? { bricks: false } : {}),
    // ?wasm=1: WebAssembly noise (bit-exact; default JS, see TerrainSettings.wasm); ?wasm=0: JS
    ...(p.wasm !== undefined ? { wasm: p.wasm } : {}),
  };
}

/** ?at=x,y,z,yawDeg,pitchDeg → position and view (radians), or null. */
export function parseViewpoint(at: string | null): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
  if (!at) return null;
  const v = at.split(",").map(Number);
  if (v.length < 3 || !v.every(Number.isFinite)) return null;
  return { x: v[0], y: v[1], z: v[2], yaw: ((v[3] ?? 0) * Math.PI) / 180, pitch: ((v[4] ?? 0) * Math.PI) / 180 };
}
