/**
 * test:placement — the base's GPU cost (scene/base): four instanced meshes for
 * any number of buildings (one per kind, no LOD objects: nothing can pop), a
 * full base of 40 buildings within BASE_DRAW_BUDGET (buildings + lighthouse
 * beams + placement hologram), and per-kind triangle counts low-poly enough to
 * draw whole at any distance.
 */
import * as THREE from "three";
import type { StructureKind } from "../../src/games/deep-march/conserve";
import { BASE } from "../../src/games/deep-march/conserve/config";
import { BeamColumns } from "../../src/games/deep-march/scene/base/beamColumn";
import { MAX_PER_KIND } from "../../src/games/deep-march/scene/base/config";
import { Hologram } from "../../src/games/deep-march/scene/base/hologram";
import { StructureInstances, type PlacedBuilding } from "../../src/games/deep-march/scene/base/structureInstances";
import { structureShape } from "../../src/games/deep-march/scene/base/structureShapes";
import type { Checker } from "./checks";

/** A full base (40 buildings, every lighthouse lit, hologram on): draw calls and triangles. */
export const BASE_DRAW_BUDGET = { draws: 8, triangles: 60_000 } as const;
/** Largest single building (triangles). */
const SHAPE_MAX = 1_500;
const KINDS: readonly StructureKind[] = ["core", "lighthouse", "energy", "storage"];
const RING_TRIS = 64 * 2;

function placed(kinds: readonly StructureKind[]): PlacedBuilding[] {
  return kinds.map((kind, i) => ({ id: i + 1, kind, pos: [i * 20, 0, 0] as const, yaw: i, working: true, on: true, damage: 0, birth: 0 }));
}

export function drawChecks(c: Checker): void {
  c.section("base draw calls and triangles");
  const tris = Object.fromEntries(KINDS.map((k) => [k, structureShape(k).triangles])) as Record<StructureKind, number>;
  c.check(KINDS.every((k) => tris[k] > 0 && tris[k] <= SHAPE_MAX), `each building is low-poly (<= ${SHAPE_MAX} triangles)`, KINDS.map((k) => `${k} ${tris[k]}`).join(", "));
  const mat = new THREE.MeshBasicMaterial();
  const inst = new StructureInstances(mat, KINDS, MAX_PER_KIND);
  let lods = 0;
  inst.group.traverse((o) => void (o instanceof THREE.LOD && lods++));
  c.check(inst.group.children.length === 4 && inst.group.children.every((o) => o instanceof THREE.InstancedMesh) && lods === 0, "one InstancedMesh per kind, no LOD objects (no popping)", `${inst.group.children.length} meshes, ${lods} LOD`);
  inst.set(placed(KINDS));
  const one = inst.cost();
  inst.set(placed(KINDS.flatMap((k) => Array.from({ length: 9 }, () => k))));
  const many = inst.cost();
  c.check(one.draws === 4 && many.draws === 4 && many.triangles === 9 * one.triangles, "draw calls do not grow with the building count (4 for 4 or 36 buildings)", `${one.draws} / ${many.draws} draws, ${one.triangles} / ${many.triangles} triangles`);
  inst.set([]);
  c.check(inst.cost().draws === 0, "no buildings: no draws", `${inst.cost().draws}`);
  // worst case: the core + the heaviest other kind up to the limit, all lighthouses lit
  const others = KINDS.filter((k) => k !== "core");
  const heavy = others.reduce((a, b) => (tris[b] > tris[a] ? b : a));
  const full = placed(["core", ...Array.from({ length: BASE.maxStructures - 1 }, () => heavy)]);
  inst.set(full);
  const beams = new BeamColumns(MAX_PER_KIND, 500);
  // bound: a beam over every non-core building (only lit lighthouses carry one)
  const lit = full.slice(1);
  beams.set(lit.map((b) => ({ x: b.pos[0], y: 41, z: b.pos[2] })), 0, 0);
  const holo = new Hologram(inst.geometries);
  const holoTris = Math.max(...KINDS.map((k) => tris[k])) + RING_TRIS;
  const cost = inst.cost();
  // all four kinds present (4 draws), beams (1), hologram + rings (2)
  const draws = KINDS.length + 1 + 2;
  const triangles = cost.triangles + beams.mesh.count * beams.triangles + holoTris;
  c.check(draws <= BASE_DRAW_BUDGET.draws, `a full base draws in <= ${BASE_DRAW_BUDGET.draws} calls (buildings + beams + hologram + rings)`, `${draws}`);
  c.check(triangles <= BASE_DRAW_BUDGET.triangles, `a full base (40 buildings, ${lit.length} beams, hologram) stays <= ${BASE_DRAW_BUDGET.triangles} triangles`, `${triangles} (buildings ${cost.triangles}, beams ${beams.mesh.count} x ${beams.triangles}, hologram ${holoTris})`);
  c.check(MAX_PER_KIND >= BASE.maxStructures, "every kind can draw the whole building limit", `${MAX_PER_KIND} >= ${BASE.maxStructures}`);
  inst.dispose();
  beams.dispose();
  holo.dispose();
  mat.dispose();
}
