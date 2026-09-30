/**
 * Chaos as the scene presents it (plan M8; conserve/chaos/view.ts, preview.ts,
 * platform/diveChaos.ts): cracks on the terrain's own outline with an outward
 * normal; the debug panel's chaos preview is deterministic, never saved, and gives stage 1
 * no cracks, stage 2 one or two impassable ones (depth < T), a scar case whose
 * notch is gone; a stage-2 crack is a notch the diver cannot pass (density
 * sampling hits rock before the outer face).
 */
import { RING } from "../../src/games/deep-march/conserve/chaos/config";
import { previewChaos, previewTarget, type ChaosPreviewSpec } from "../../src/games/deep-march/conserve/chaos/preview";
import { DEFAULT_DIVE_PARAMS } from "../../src/games/deep-march/scene/dive/params";
import { chaosViewOf, stageWithin, type ChaosView } from "../../src/games/deep-march/conserve/chaos/view";
import { wallStateOfChaos } from "../../src/games/deep-march/conserve/chaos/wallModel";
import { diveChaosOf } from "../../src/games/deep-march/conserve/platform/diveChaos";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { createMemoryBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import { openConserveSession } from "../../src/games/deep-march/conserve/session/openSession";
import type { ConserveSession } from "../../src/games/deep-march/conserve/session/conserveSession";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import type { Checker } from "./checks";
import { RING10 } from "./chaosFixture";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function session(seedText = "view"): ConserveSession {
  const opened = openConserveSession({ backend: createMemoryBackend(), intent: { kind: "new", seedText }, hashSeed: seedFromString });
  if (!opened.ok) throw new Error("fixture: session");
  return opened.session;
}

function viewChecks(c: Checker): void {
  c.section("chaos view (conserve/chaos/view.ts)");
  const ctx = { gen: 3, seed: 42, ring: RING10, base: { x: 0, z: 0 }, siteHarvest: new Array(100).fill(0) };
  const st = previewChaos({ stage: 2, cracks: 2, scar: false }, ctx);
  const v = chaosViewOf(st, { sitesX: 10, sitesZ: 10 });
  const onRing = v.cracks.every((k) => {
    const p = RING10.point(st.cracks.find((q) => q.j === k.j)!.s);
    return Math.hypot(p.x - k.x, p.z - k.z) < 1e-9;
  });
  const b = v.bounds;
  const outward = v.cracks.every((k) => (k.x - b.cx) * k.nx + (k.z - b.cz) * k.nz > 0 && Math.abs(Math.hypot(k.nx, k.nz) - 1) < 1e-9 && Math.abs(k.nx * k.tx + k.nz * k.tz) < 1e-9);
  c.check(onRing && outward, "cracks sit on the ring outline, unit normal pointing out of the world");
  c.check(Math.abs(b.hx - 5 * RING.siteMetres) < 1e-9 && Math.abs(b.cx) <= RING.siteMetres && v.chi > 0 && v.within >= 0 && v.within <= 1, "bounds and χ_g / within", `hx ${b.hx} m, χ ${v.chi.toFixed(3)}, within ${v.within.toFixed(2)}`);
  c.check(stageWithin(0, 0.95) === 0 && stageWithin(1, 0.92) >= 0 && stageWithin(1, 0.9) === 1, "within: 0 at stage 0, grows through the band");
}

function previewChecks(c: Checker): void {
  c.section("chaos preview (debug panel → conserve/chaos/preview.ts, platform/diveChaos.ts)");
  c.check(DEFAULT_DIVE_PARAMS.chaos === null, "no preview unless the staging debug panel picks one");
  const s = session();
  const before = JSON.stringify(s.chaos);
  const P = (stage: 0 | 1 | 2, cracks: 1 | 2 = 1, scar = false): ChaosPreviewSpec => ({ stage, cracks, scar });
  const of = (spec: ChaosPreviewSpec | null) => diveChaosOf(s, spec);
  const cases: [string, ChaosPreviewSpec, (v: ChaosView) => boolean][] = [
    ["stage 0", P(0), (v) => v.stage === 0 && v.cracks.length === 0 && v.scars.length === 0],
    ["stage 1", P(1), (v) => v.stage === 1 && v.cracks.length === 0 && v.scars.length === 0],
    ["stage 2", P(2), (v) => v.stage === 2 && v.cracks.length === 1],
    ["stage 2, 2 cracks", P(2, 2), (v) => v.stage === 2 && v.cracks.length === 2],
    ["stage 1 + scar", P(1, 1, true), (v) => v.stage === 1 && v.cracks.length === 0 && v.scars.length === 1],
    ["stage 2 + scar", P(2, 1, true), (v) => v.stage === 2 && v.cracks.length >= 1 && v.scars.length >= 1],
  ];
  for (const [q, spec, ok] of cases) {
    const d = of(spec);
    const shallow = d.view.cracks.every((k) => !k.through && k.depth < d.view.wallThickness);
    c.check(ok(d.view) && shallow && d.view.preview && d.view.m === previewTarget(spec), `${q}: stage, cracks, scars; every crack impassable (depth < T)`, `${d.view.cracks.map((k) => `${k.width.toFixed(0)}×${k.depth.toFixed(0)} m`).join(", ")} of T ${d.view.wallThickness.toFixed(0)} m`);
  }
  c.check(same(of(P(2, 2)), of(P(2, 2))), "deterministic for the world and base");
  const own = of(null);
  c.check(!own.view.preview && same(own.view, chaosViewOf(s.chaos, { sitesX: s.siteTable.sitesX, sitesZ: s.siteTable.sitesZ })), "no preview: the generation's own chaos");
  c.check(JSON.stringify(s.chaos) === before && same(s.wall, wallStateOfChaos(s.chaos)), "a preview never touches the session's chaos (save, forecast and tide keep it)");
  const scar = of(P(1, 1, true));
  c.check(scar.wall.cracks.length === 0 && scar.view.scars[0].width > 0, "healed: its notch is gone from the wall, the scar keeps its last opening's width");
  s.close();
}

function collisionChecks(c: Checker): void {
  c.section("a stage-2 crack is not passable (terrain density)");
  const s = session("crack");
  const d = diveChaosOf(s, { stage: 2, cracks: 2, scar: false });
  const layout = terrainLayoutOf(s.siteTable, d.wall);
  const field = createDensityField(s.seed, TERRAIN, undefined, layout);
  const iso = field.settings.isoLevel;
  const T = d.view.wallThickness;
  c.check(field.crackWeight !== null && createDensityField(s.seed, TERRAIN, undefined, terrainLayoutOf(s.siteTable, diveChaosOf(s, { stage: 1, cracks: 1, scar: false }).wall)).crackWeight === null, "crack weight only when the wall has open cracks");
  // the wall's rock run that reaches its outer face (walking in from just inside it)
  const rockAt = (x: number, z: number, y: number) => field.sample(x, y, z) >= iso;
  const wallStart = (x: number, z: number, nx: number, nz: number, y: number) => {
    let t = T - 2;
    while (t > -120 && rockAt(x + nx * t, z + nz * t, y)) t -= 0.5;
    return t + 0.5;
  };
  let blocked = true, deeper = true, info = "";
  for (const k of d.view.cracks) {
    for (const y of [20, 30, 40]) {
      let at = -Infinity, side = -Infinity;
      for (let o = -k.width; o <= k.width; o += 0.5) {
        at = Math.max(at, wallStart(k.x + k.tx * o, k.z + k.tz * o, k.nx, k.nz, y));
        side = Math.max(side, wallStart(k.x + k.tx * (o + 300), k.z + k.tz * (o + 300), k.nx, k.nz, y));
        blocked &&= rockAt(k.x + k.tx * o + k.nx * (T - 2), k.z + k.tz * o + k.nz * (T - 2), y);
      }
      deeper &&= at > side + 5;
      info += `${at.toFixed(0)}/${side.toFixed(0)} `;
    }
  }
  c.check(blocked, "across the crack's opening the wall is rock right up to its outer face");
  c.check(deeper, "the notch cuts into the wall (its rock starts deeper than 300 m along the face)", `crack/side start (m past the outline): ${info.trim()}`);
  s.close();
}

export function chaosViewChecks(c: Checker): void {
  viewChecks(c);
  previewChecks(c);
  collisionChecks(c);
}
