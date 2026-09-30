/** test:placement — the 2D rules (conserve/base/placementRules.ts), each rule both ways. */
import { BASE, STRUCTURES, type StructureKind } from "../../src/games/deep-march/conserve/config";
import type { BaseStructure } from "../../src/games/deep-march/conserve/base/baseState";
import { placementReason, wallDistance, type PlacementQuery } from "../../src/games/deep-march/conserve/base/placementRules";
import { RECT } from "./baseFixture";
import type { Checker } from "./checks";

const RICH = [99_999, 0, 99_999, 99_999, 0, 0, 0];
const core: BaseStructure = { id: 1, kind: "core", pos: [0, -100, 0], yaw: 0, on: true, fuel: 0 };
const at = (id: number, kind: StructureKind, x: number, z: number): BaseStructure => ({ id, kind, pos: [x, -100, z], yaw: 0, on: true, fuel: 0 });
const q = (kind: StructureKind, x: number, z: number, structures: BaseStructure[] = [core], funds = RICH): PlacementQuery => ({ kind, x, z, structures, rect: RECT, funds });

export function rulesChecks(c: Checker): void {
  c.section("placement rules (2D)");
  c.check(placementReason(q("core", 0, 0, [])) === "ok", "core: first building, in the middle → ok");
  c.check(placementReason(q("core", 50, 0)) === "has-core", "core: a second core → has-core");
  c.check(placementReason(q("lighthouse", 20, 0, [])) === "no-core", "others before the core → no-core");
  const edge = RECT.maxX - BASE.wallClearance;
  c.check(placementReason(q("core", edge + 1, 0, [])) === "wall" && placementReason(q("core", edge - 1, 0, [])) === "ok", "core: 599 m from the wall → wall; 601 m → ok", `${wallDistance(RECT, edge + 1, 0)} / ${wallDistance(RECT, edge - 1, 0)} m`);
  c.check(placementReason(q("core", 0, RECT.minZ + BASE.wallClearance - 1, [])) === "wall", "core: too near the south wall → wall");
  const round = { ...RECT, corner: 400 };
  c.check(Math.abs(wallDistance(round, RECT.maxX - 350, RECT.maxZ - 350) - (400 - Math.hypot(50, 50))) < 1e-9 && wallDistance(RECT, RECT.maxX - 350, RECT.maxZ - 350) === 350, "rounded corner (400 m): 350 m from both sides is 329 m from the curved face", `${wallDistance(round, RECT.maxX - 350, RECT.maxZ - 350).toFixed(1)} m`);
  const cx = RECT.maxX - 400, cz = RECT.maxZ - 400, o = 300 / Math.SQRT2;
  c.check(Math.abs(wallDistance(round, cx, cz) - 400) < 1e-9 && Math.abs(wallDistance(round, cx + o, cz + o) - 100) < 1e-9, "distance to the corner arc is measured from its centre (400 m at the centre, 100 m at 300 m out)");
  const r = BASE.radius - STRUCTURES.lighthouse.radius;
  c.check(placementReason(q("lighthouse", r, 0)) === "ok" && placementReason(q("lighthouse", r + 0.5, 0)) === "radius", "lighthouse at the rim of the 48 m radius → ok; beyond → radius");
  const grown = [core, at(2, "lighthouse", 30, 0), at(3, "storage", -30, 0)];
  c.check(placementReason(q("energy", 0, BASE.radius + 8 - 5, grown)) === "ok" && placementReason(q("energy", 0, BASE.radius + 8 - 5, [core])) === "radius", "each lighthouse / storage adds 8 m to the radius");
  const many = [core, at(50, "energy", 0, 60), ...Array.from({ length: 12 }, (_, i) => at(i + 2, "storage", 1000 + i * 40, 0))];
  c.check(placementReason(q("energy", 0, 100, many)) === "ok" && placementReason(q("energy", 0, 121 - 5 + 1, many)) === "radius", "the radius stops at 120 m");
  const far = [core, ...Array.from({ length: 12 }, (_, i) => at(i + 2, "lighthouse", 2000 + i * 40, 0))];
  c.check(placementReason(q("storage", 0, 70, far)) === "grid", "inside the radius but 70 m from the core, no tower → grid");
  c.check(placementReason(q("storage", 0, 70, [...far, at(99, "energy", 0, 40)])) === "ok", "an energy tower 30 m away relays the grid → ok");
  c.check(placementReason(q("lighthouse", 14.9, 0)) === "overlap" && placementReason(q("lighthouse", 17.1, 0)) === "ok", "footprints (10 + 5 m + 2 m gap): 14.9 m → overlap; 17.1 m → ok");
  const full = [core, ...Array.from({ length: BASE.maxStructures - 1 }, (_, i) => at(i + 2, "energy", 5000, i * 20))];
  c.check(placementReason(q("energy", 20, 20, full)) === "limit" && placementReason(q("energy", 20, 20, full.slice(0, -1))) === "ok", "40 buildings → limit; 39 → ok");
  const cost = [300, 0, 60, 40, 0, 0, 0];
  c.check(placementReason(q("lighthouse", 20, 0, [core], cost)) === "ok" && placementReason(q("lighthouse", 20, 0, [core], [300, 0, 59, 40, 0, 0, 0])) === "cost", "exactly the cost → ok; one lumen short → cost");
}
