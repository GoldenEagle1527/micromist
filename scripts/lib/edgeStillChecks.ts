/**
 * Bounded world, diver holding still at the edge (terrain/chunks.ts +
 * terrain/terrainExtent.ts): at the middle of each of the four sides, on each
 * rounded corner and 10 / 60 / 150 m in front of a crack, once the streaming has
 * converged nothing may change any more — over a stable window no LOD crossfade
 * starts and no column is requested (the pre-fix scheduler re-merged every
 * top-level column straddling the edge and split it again, forever), and the
 * column under the diver is drawn at level 0.
 *
 * Both presets. The phone's 230 m view also exercises chunks.ts childrenInView: a
 * top-level column split within 128 m could have a quadrant beyond the view that
 * is never built, and re-merged / split the same way anywhere — so the free dive
 * (phone) is held still at a few spots too.
 */
import * as THREE from "three";
import { TERRAIN, terrainForDevice, type TerrainSettings } from "../../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../../src/games/deep-march/terrain/density";
import type { ChunkManager } from "../../src/games/deep-march/terrain/chunks";
import type { SiteLayout } from "../../src/games/deep-march/terrain/siteLayout";
import { WALL_UNIT } from "../../src/games/deep-march/terrain/wallGeometry";
import { createSimManager } from "./streamingSim";
import { genesisLayout, withWall } from "./worldFixture";

type Check = (ok: boolean, name: string, detail: string) => void;

/** Converged = nothing queued, pending or crossfading for this long (s). */
const SETTLE_S = 3;
/** Give up converging after this long (s, virtual). */
const MAX_S = 90;
/** Stable window checked after convergence (s). */
const WINDOW_S = 12;
/** How far in front of the wall's deepest face the diver waits at the sides / corners (m). */
const EDGE_GAP_M = 10;
const CRACK_GAPS_M = [10, 60, 150];

type Spot = { name: string; x: number; z: number; nx: number; nz: number };

/** A spot `gap` metres in front of the wall's deepest face at arc length s (base units), looking at the wall. */
function spotAt(field: DensityField, name: string, s: number, gap: number): Spot {
  const shape = field.wall!.shape;
  const out = new Float64Array(4);
  shape.point(s, shape.faceMax + gap / WALL_UNIT, out);
  const S = field.settings.worldScale;
  return { name, x: out[0] * S, z: out[1] * S, nx: out[2], nz: out[3] };
}

/** Middle of each side and of each rounded corner (the outline's arc length: 0 = middle of +x, counter-clockwise). */
function edgeSpots(field: DensityField): Spot[] {
  const P = field.wall!.shape.perimeter;
  const names = ["east side", "north-east corner", "north side", "north-west corner", "west side", "south-west corner", "south side", "south-east corner"];
  return names.map((n, i) => spotAt(field, n, (i * P) / 8, EDGE_GAP_M));
}

type StillResult = { converged: boolean; at: number; requests: number; fadeFrames: number; l0: boolean };

function isFading(mgr: ChunkManager): boolean {
  for (const o of mgr.meshGroup.children) {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && !mgr.isStable(m)) return true;
  }
  return false;
}

/** Deterministic still dive at `spot` (virtual clock, as requestSequence): converge, then watch a window. */
function holdStill(field: DensityField, spot: Spot, workers: number, factor: number, fps: number): StillResult {
  const perf = globalThis.performance;
  const realNow = perf.now.bind(perf);
  let virtualMs = 0;
  perf.now = () => virtualMs;
  try {
    const { mgr, pool } = createSimManager(field, 7, workers, factor);
    const s = field.settings;
    const camera = new THREE.PerspectiveCamera(70, 0.5, 0.05, s.viewDistance + 40);
    const pos = new THREE.Vector3(spot.x, -40, spot.z);
    camera.position.copy(pos);
    camera.lookAt(pos.x + spot.nx, pos.y - 0.15, pos.z + spot.nz);
    const dt = 1 / fps;
    let t = 0;
    const step = () => {
      t += dt;
      pool.now = t;
      virtualMs = t * 1000;
      mgr.update(pos, camera, dt);
    };
    while (mgr.loading && t < MAX_S) {
      step();
      if (mgr.nearReady(pos, 14) && mgr.coverageComplete(pos)) mgr.loading = false;
    }
    let quiet = 0;
    while (quiet < SETTLE_S && t < MAX_S) {
      step();
      const st = mgr.stats();
      quiet = mgr.queueLength === 0 && st.pending === 0 && !isFading(mgr) ? quiet + dt : 0;
    }
    const at = t;
    const before = pool.log.length;
    let fadeFrames = 0;
    let l0 = true;
    const b = s.boundsSize;
    const gx = Math.floor((pos.x + b / 2) / b), gz = Math.floor((pos.z + b / 2) / b);
    while (t - at < WINDOW_S) {
      step();
      if (isFading(mgr)) fadeFrames++;
      if (!mgr.drawnAt(0, gx, gz)) l0 = false;
    }
    const out = { converged: quiet >= SETTLE_S, at, requests: pool.log.length - before, fadeFrames, l0 };
    mgr.dispose();
    return out;
  } finally {
    perf.now = realNow;
  }
}

function checkSpots(check: Check, preset: string, field: DensityField, spots: Spot[], workers: number, factor: number, fps: number) {
  for (const spot of spots) {
    const r = holdStill(field, spot, workers, factor, fps);
    check(
      r.converged && r.requests === 0 && r.fadeFrames === 0 && r.l0,
      `${preset} ${spot.name}: still after convergence`,
      `${r.converged ? `converged at ${r.at.toFixed(1)} s` : `never converged in ${MAX_S} s`}; over ${WINDOW_S} s: ${r.requests} requests, ${r.fadeFrames} crossfade frames, diver column ${r.l0 ? "L0" : "not L0"}`,
    );
  }
}

/** The free dive holding still, phone preset (no edge: only the view reach can loop). */
function freeStillChecks(check: Check): void {
  console.log("free dive, holding still (seed 7, phone)");
  const field = createDensityField(7, terrainForDevice(true));
  const spots: Spot[] = [[0, 0], [100, 37], [-230, 410], [700, -90], [1234, 555]].map(([x, z]) => ({ name: `at ${x}, ${z}`, x, z, nx: 1, nz: 0 }));
  checkSpots(check, "phone free", field, spots, 2, 4, 30);
}

export function edgeStillChecks(check: Check): void {
  freeStillChecks(check);
  console.log("bounded world, holding still at the edge (seed 7)");
  const presets: [string, TerrainSettings, number, number, number][] = [
    ["phone", terrainForDevice(true), 2, 4, 30],
    ["desktop", TERRAIN, 4, 1, 60],
  ];
  const base = genesisLayout(7);
  for (const [preset, st, w, f, fps] of presets) {
    const field = createDensityField(7, st, undefined, base);
    checkSpots(check, preset, field, edgeSpots(field), w, f, fps);
    for (const through of [false, true]) {
      // a crack in the middle of the east side (arc length 0), as the crack streaming checks
      const T = 100;
      const crack = { s: 0, width: 16, depth: through ? T + 40 : 60, through, extent: [-8, 8] as const };
      const layout: SiteLayout = withWall(base, { ...base.wall!, thickness: T, cracks: [crack] });
      const cf = createDensityField(7, st, undefined, layout);
      const kind = through ? "through crack" : "stage-2 crack";
      checkSpots(check, preset, cf, CRACK_GAPS_M.map((g) => spotAt(cf, `${g} m in front of a ${kind}`, 0, g)), w, f, fps);
    }
  }
}
