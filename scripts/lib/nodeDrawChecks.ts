/**
 * test:nodes — the node draw on phones (scene/expedition/nodeView.ts): the
 * whole genesis world placed for two seeds, the busiest spot on a 10 m grid
 * still fits the one instanced draw with every cache (so the nearest-first cap
 * never drops a node inside the draw radius: no popping), the triangle budget,
 * the selection radius beyond the shader's shrink radius, and the prefetch
 * radius covering a site's whole search disc before its nodes come in sight.
 */
import * as THREE from "three";
import { CACHES } from "../../src/games/deep-march/conserve/config";
import { Expedition } from "../../src/games/deep-march/conserve/expedition/expedition";
import { NodeState } from "../../src/games/deep-march/conserve/nodes/nodeState";
import { buildNodeTable } from "../../src/games/deep-march/conserve/nodes/nodeTable";
import { createGenesisLedger } from "../../src/games/deep-march/conserve/world/genesis";
import { NODE_VIEW } from "../../src/games/deep-march/scene/expedition/config";
import { NodeInstances } from "../../src/games/deep-march/scene/expedition/nodeInstances";
import { selectRadius } from "../../src/games/deep-march/scene/expedition/nodeView";
import { NodePlacement } from "../../src/games/deep-march/scene/expedition/placement";
import { ANCHOR } from "../../src/games/deep-march/terrain/anchorConfig";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect } from "../../src/games/deep-march/terrain/siteLayout";
import type { Checker } from "./checks";
import { genesisLayout, genesisTable } from "./worldFixture";

/** Triangles of the whole set on a phone frame (≈ 1 % of the terrain's). */
export const NODE_TRIANGLE_BUDGET = 10_000;
const GRID = 10;

export function drawChecks(c: Checker): void {
  c.section("node draw (one instanced mesh, counts, no popping)");
  const inst = new NodeInstances(new THREE.MeshBasicMaterial(), NODE_VIEW.maxInstances);
  const perInstance = inst.crystalTriangles + inst.cacheTriangles;
  c.check(inst.mesh.isInstancedMesh && inst.mesh.count === 0 && inst.mesh.geometry.groups.length === 0, "one InstancedMesh, one geometry group: 1 draw call for every node and cache", `${inst.crystalTriangles} + ${inst.cacheTriangles} triangles per instance`);
  c.check(NODE_VIEW.maxInstances * perInstance <= NODE_TRIANGLE_BUDGET, `full set ≤ ${NODE_TRIANGLE_BUDGET} triangles`, `${NODE_VIEW.maxInstances} × ${perInstance} = ${NODE_VIEW.maxInstances * perInstance}`);
  inst.dispose();
  c.check(selectRadius() >= NODE_VIEW.radius + 6, "selection radius ≥ shader shrink radius + rebuild step (a node leaves the set only once shrunk to nothing)", `${selectRadius()} ≥ ${NODE_VIEW.radius} + 6`);
  const cell = MACRO.cell * TERRAIN.worldScale;
  const disc = ANCHOR.discFraction * cell + ANCHOR.wallReach;
  c.check(NODE_VIEW.prefetch >= selectRadius() + disc, "prefetch radius ≥ selection radius + a site's search disc (+ wall reach)", `${NODE_VIEW.prefetch} ≥ ${selectRadius()} + ${disc.toFixed(0)}`);
  for (const seed of [7, 42]) {
    const layout = genesisLayout(seed);
    const field = createDensityField(seed, TERRAIN, undefined, layout);
    const table = genesisTable(seed);
    const exp = new Expedition({ ledger: createGenesisLedger(), nodes: NodeState.fresh(buildNodeTable(table)), caches: [], gen: 1, sitesX: 10, sitesZ: 10 });
    const p = new NodePlacement(field, layout, exp, NODE_VIEW.prefetch);
    const t0 = performance.now();
    for (let s = 0; s < layout.nx * layout.nz; s++) p.placeSite(s);
    const ms = performance.now() - t0;
    const pts: number[] = [];
    p.forEach((n) => pts.push(n.anchor.x, n.anchor.z));
    const rect = layoutRect(layout, cell);
    const r2 = selectRadius() ** 2;
    let worst = 0, wx = 0, wz = 0;
    for (let x = rect.x0; x <= rect.x1; x += GRID)
      for (let z = rect.z0; z <= rect.z1; z += GRID) {
        let n = 0;
        // horizontal distance ≤ 3D distance: an upper bound on the set at any depth
        for (let i = 0; i < pts.length; i += 2) if ((pts[i] - x) ** 2 + (pts[i + 1] - z) ** 2 <= r2) n++;
        if (n > worst) [worst, wx, wz] = [n, x, z];
      }
    const cap = NODE_VIEW.maxInstances - CACHES.max;
    c.check(worst <= cap, `seed ${seed}: busiest spot ≤ ${cap} nodes within the selection radius (+ ${CACHES.max} caches = one full draw)`, `${worst} at (${wx.toFixed(0)}, ${wz.toFixed(0)}); ${pts.length / 2} placed, whole world in ${(ms / 1000).toFixed(1)} s`);
  }
}
