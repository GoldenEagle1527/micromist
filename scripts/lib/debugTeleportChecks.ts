/**
 * The debug panel's teleports (debug/teleport.ts): pure placement on synthetic
 * seabeds, then on real terrain — the free dive's field and a conserve world
 * with the panel's stage-2 chaos preview (crack, edge and corner targets).
 */
import { diveChaosOf } from "../../src/games/deep-march/conserve/platform/diveChaos";
import { terrainLayoutOf } from "../../src/games/deep-march/conserve/platform/terrainLayout";
import { createMemoryBackend } from "../../src/games/deep-march/conserve/save/saveBackend";
import { openConserveSession } from "../../src/games/deep-march/conserve/session/openSession";
import { TELEPORT, heightRange, isClear, placeSafely, seabedAt, standY, teleportTargets, yawToward } from "../../src/games/deep-march/debug/teleport";
import type { Pose, Solid } from "../../src/games/deep-march/debug/types";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField, type DensityField } from "../../src/games/deep-march/terrain/density";
import { seedFromString } from "../../src/games/deep-march/terrain/noise";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect } from "../../src/games/deep-march/terrain/siteLayout";
import type { Checker } from "./checks";

const H = heightRange(TERRAIN.worldScale);
const near = (a: number, b: number, e = 0.51) => Math.abs(a - b) <= e;
const forward = (p: Pose) => ({ x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) });

export function syntheticTeleportChecks(c: Checker): void {
  c.section("teleport placement (synthetic seabed)");
  const flat: Solid = (_x, y) => y < 0;
  c.check(near(seabedAt(flat, 5, 5, H) ?? NaN, 0) && near(standY(flat, 5, 5, H), TELEPORT.eye), "flat seabed at 0: stand eye metres above it", `floor ${seabedAt(flat, 5, 5, H)}, stand ${standY(flat, 5, 5, H)}`);
  const inRock = placeSafely(flat, { x: 1, y: -40, z: 1, yaw: 0, pitch: 0 }, H);
  c.check(isClear(flat, inRock.x, inRock.y, inRock.z) && inRock.y > 0 && inRock.y <= TELEPORT.clearance + 0.5, "a point inside rock is lifted to the first clear water above it", `y −40 → ${inRock.y}`);
  const open = { x: 3, y: 25, z: -4, yaw: 1, pitch: 0.2 };
  c.check(placeSafely(flat, open, H) === open, "a clear point is kept as asked");
  const shelf: Solid = (_x, y) => y < 0 || (y >= 20 && y < 30);
  c.check(near(seabedAt(shelf, 0, 0, H) ?? NaN, 30) && isClear(shelf, 0, standY(shelf, 0, 0, H), 0), "overhang: stands on its top, in clear water");
  const solidAll: Solid = () => true;
  c.check(seabedAt(solidAll, 0, 0, H) === null && placeSafely(solidAll, open, H).y >= H.hi - 0.5, "all rock (no water in range): no seabed, lifted to the top of the range");
  const f = forward({ x: 0, y: 0, z: 0, yaw: yawToward(1, 0), pitch: 0 });
  c.check(near(f.x, 1, 1e-9) && near(f.z, 0, 1e-9), "yawToward: the diver's forward points along the direction");

  const rect = { x0: -1000, z0: -800, x1: 1000, z1: 800 };
  const crack = { j: 0, x: 1000, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, width: 20, depth: 30, through: false };
  const chaos = { cracks: [crack, { ...crack, x: -1000, nx: -1 }] } as unknown as Parameters<typeof teleportTargets>[1]["chaos"];
  const all = teleportTargets(flat, { spawn: { x: 0, y: 5, z: 0, yaw: 0 }, home: { x: 50, y: 5, z: 50, yaw: 1 }, world: rect, chaos }, H);
  c.check(all.map((t) => `${t.kind}:${t.key}`).join(" ") === "spawn:spawn base:base crack:1 crack:2 edge:n edge:e edge:s edge:w corner:ne corner:nw corner:se corner:sw", "targets in the panel's order: spawn, base, cracks, 4 edges, 4 corners", `${all.length}`);
  const rim = all.filter((t) => t.kind === "edge" || t.kind === "corner").map((t) => t.pose());
  const inside = rim.every((p) => near(Math.min(p.x - rect.x0, rect.x1 - p.x, p.z - rect.z0, rect.z1 - p.z), TELEPORT.edgeInset, 1e-9));
  const out = rim.every((p) => forward(p).x * p.x + forward(p).z * p.z > 0);
  c.check(inside && out, `edges / corners: ${TELEPORT.edgeInset} m inside the world, facing out`);
  const k1 = all[2].pose();
  c.check(near(k1.x, 1000 - TELEPORT.crackInside, 1e-9) && near(forward(k1).x, 1, 1e-9) && near(k1.y, TELEPORT.eye), `crack: ${TELEPORT.crackInside} m in front, facing it along its normal, eye height`);
  const n = all.find((t) => t.kind === "edge" && t.key === "n")!.pose();
  c.check(n.z < 0 && near(forward(n).z, -1, 1e-9), "north = −z (yaw 0 faces north)");
  const free = teleportTargets(flat, { spawn: { x: 0, y: 5, z: 0, yaw: 0 }, home: null, world: null, chaos: null }, H);
  c.check(free.length === 1 && free[0].kind === "spawn", "free dive: only the spawn (no base, cracks or rim)");
}

const solidOf = (f: DensityField): Solid => (x, y, z) => f.sample(x, y, z) >= f.settings.isoLevel;

export function terrainTeleportChecks(c: Checker): void {
  c.section("teleport on real terrain");
  const free = solidOf(createDensityField(7, TERRAIN));
  const spots = [[0, 0], [100, 37], [-230, 410], [700, -90], [1234, 555]];
  const stands = spots.map(([x, z]) => ({ x, z, y: standY(free, x, z, H) }));
  c.check(stands.every((p) => isClear(free, p.x, p.y, p.z)), "free dive (seed 7): standing spots are clear water", stands.map((p) => p.y.toFixed(1)).join(", "));
  const buried = spots.map(([x, z]) => placeSafely(free, { x, y: (seabedAt(free, x, z, H) ?? 0) - 20, z, yaw: 0, pitch: 0 }, H));
  c.check(buried.every((p) => isClear(free, p.x, p.y, p.z)), "custom points 20 m under the seabed end in clear water");

  const opened = openConserveSession({ backend: createMemoryBackend(), intent: { kind: "new", seedText: "crack" }, hashSeed: seedFromString });
  if (!opened.ok) return c.check(false, "fixture: conserve session");
  const s = opened.session;
  const dc = diveChaosOf(s, { stage: 2, cracks: 2, scar: false });
  const layout = terrainLayoutOf(s.siteTable, dc.wall);
  const solid = solidOf(createDensityField(s.seed, TERRAIN, undefined, layout));
  const rect = layoutRect(layout, MACRO.cell * TERRAIN.worldScale);
  const targets = teleportTargets(solid, { spawn: { x: 0, y: 0, z: 0, yaw: 0 }, home: null, world: rect, chaos: dc.view }, H);
  const poses = targets.filter((t) => t.kind !== "spawn").map((t) => ({ t, p: t.pose() }));
  const bad = poses.filter(({ p }) => !isClear(solid, p.x, p.y, p.z)).map(({ t }) => `${t.kind}:${t.key}`);
  const inWorld = poses.every(({ p }) => p.x > rect.x0 && p.x < rect.x1 && p.z > rect.z0 && p.z < rect.z1);
  c.check(dc.view.cracks.length === 2 && poses.length === 10 && bad.length === 0 && inWorld, "conserve world, stage-2 preview: 2 crack + 4 edge + 4 corner targets, all in clear water inside the world", bad.join(", ") || poses.map(({ t, p }) => `${t.kind}:${t.key} ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`).join(" "));
  s.close();
}
