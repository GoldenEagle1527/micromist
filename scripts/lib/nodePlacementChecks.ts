/**
 * test:nodes — node placement on the terrain (scene/expedition/placement.ts,
 * terrain/surfaceAnchor.ts, terrain/openWater.ts), genesis worlds of two seeds:
 * deterministic and independent of the visiting order; every anchor on the iso
 * surface, grounded, in its site's disc / region / the world margin, spaced;
 * the surface preference met in the kind's own biome; Σ placed + missed +
 * unplaced = the site's node share; attempt cost; open-water points for caches.
 */
import { Expedition } from "../../src/games/deep-march/conserve/expedition/expedition";
import { NodeState } from "../../src/games/deep-march/conserve/nodes/nodeState";
import { buildNodeTable } from "../../src/games/deep-march/conserve/nodes/nodeTable";
import { createGenesisLedger } from "../../src/games/deep-march/conserve/world/genesis";
import { NodePlacement, type PlacedNode } from "../../src/games/deep-march/scene/expedition/placement";
import { ANCHOR, OPEN_WATER } from "../../src/games/deep-march/terrain/anchorConfig";
import { TERRAIN } from "../../src/games/deep-march/terrain/config";
import { createDensityField } from "../../src/games/deep-march/terrain/density";
import { clearanceAt, findOpenWater } from "../../src/games/deep-march/terrain/openWater";
import { MACRO } from "../../src/games/deep-march/terrain/regions";
import { layoutRect, insideRect } from "../../src/games/deep-march/terrain/siteLayout";
import { findSpawn } from "../../src/games/deep-march/terrain/spawn";
import { AnchorProbe, anchorAttempt } from "../../src/games/deep-march/terrain/surfaceAnchor";
import type { Checker } from "./checks";
import { genesisLayout, genesisTable } from "./worldFixture";

function world(seed: number) {
  const layout = genesisLayout(seed);
  const field = createDensityField(seed, TERRAIN, undefined, layout);
  const table = genesisTable(seed);
  const exp = () => new Expedition({ ledger: createGenesisLedger(), nodes: NodeState.fresh(buildNodeTable(table)), caches: [], gen: 1, sitesX: 10, sitesZ: 10 });
  return { layout, field, table, exp };
}

const key = (p: PlacedNode) => `${p.node.id}:${p.anchor.x.toFixed(6)},${p.anchor.y.toFixed(6)},${p.anchor.z.toFixed(6)}`;

export function placementChecks(c: Checker): void {
  c.section("node placement on the terrain");
  for (const seed of [7, 42]) {
    const w = world(seed);
    const inner = w.table.sites.filter((s) => !s.edge).map((s) => s.i);
    const sites = inner.filter((_, j) => j % 3 === 0);
    const a = new NodePlacement(w.field, w.layout, w.exp(), 400);
    const b = new NodePlacement(w.field, w.layout, w.exp(), 400);
    const t0 = performance.now();
    const placed = sites.flatMap((s) => [...a.placeSite(s)]);
    const ms = performance.now() - t0;
    const again = [...sites].reverse().flatMap((s) => [...b.placeSite(s)]);
    c.check(JSON.stringify(placed.map(key).sort()) === JSON.stringify(again.map(key).sort()), `seed ${seed}: deterministic, independent of the site order`, `${placed.length} nodes on ${sites.length} sites`);
    const iso = w.field.settings.isoLevel;
    const probe = new AnchorProbe(w.field);
    const cell = MACRO.cell * TERRAIN.worldScale;
    const rect = layoutRect(w.layout, cell);
    let onSurface = 0, fits = 0, inside = 0, spaced = true;
    const bad: string[] = [];
    for (const p of placed) {
      const { x, y, z, nx, ny, nz } = p.anchor;
      if (w.field.sample(x + nx * 0.2, y + ny * 0.2, z + nz * 0.2) < iso && w.field.sample(x - nx * 0.2, y - ny * 0.2, z - nz * 0.2) >= iso) onSurface++;
      if (probe.fits(p.anchor, p.anchor.strict ? p.node.surface : "rock") && probe.grounded(p.anchor)) fits++;
      const sp = a.sitePoint(p.node.site);
      const inDisc = Math.hypot(x - sp.x, z - sp.z) <= ANCHOR.discFraction * cell + ANCHOR.wallReach;
      const inWorld = insideRect(rect, x, z, ANCHOR.worldMargin);
      const inRegion = probe.regionWeight(x, z, w.layout.region[p.node.site]) >= ANCHOR.regionMin;
      if (inDisc && inWorld && inRegion) inside++;
      else bad.push(`${p.node.id}${inDisc ? "" : " disc"}${inWorld ? "" : " world"}${inRegion ? "" : " region"}`);
      if (placed.some((q) => q !== p && q.node.site === p.node.site && Math.hypot(q.anchor.x - x, q.anchor.y - y, q.anchor.z - z) < ANCHOR.spacing)) spaced = false;
    }
    c.check(onSurface === placed.length, `seed ${seed}: every anchor on the iso surface (rock 0.2 m behind, water 0.2 m in front)`, `${onSurface}/${placed.length}`);
    c.check(fits === placed.length, `seed ${seed}: every anchor meets its surface rule (strict or relaxed) and is grounded`, `${fits}/${placed.length}`);
    c.check(inside === placed.length && spaced, `seed ${seed}: in the site's disc (+ wall reach) and region, ${ANCHOR.worldMargin} m inside the world, ≥ ${ANCHOR.spacing} m apart`, bad.join(", ") || (spaced ? "" : "spacing"));
    const home = (kind: number, biome: string) => placed.filter((p) => p.node.kind === kind && w.table.sites[p.node.site].biome === biome);
    for (const [kind, biome, name] of [[2, "reef", "lumen ledges in reefs"], [3, "canyon", "ferro walls in canyons"]] as const) {
      const hs = home(kind, biome);
      const strict = hs.filter((p) => p.anchor.strict).length;
      c.check(hs.length === 0 || strict / hs.length >= 0.9, `seed ${seed}: surface preference met in the kind's own biome (${name})`, `${strict}/${hs.length} strict`);
    }
    const st = a.stats();
    let exact = true;
    for (const s of sites) {
      const nodes = w.table.sites[s].split.nodes;
      const got = placed.filter((p) => p.node.site === s);
      const all = a.placeSite(s);
      if (all.length !== got.length) exact = false;
      const sum = [0, 1, 2, 3, 4, 5, 6].map((k) => w.exp().siteNodes(s).filter((n) => n.kind === k).reduce((t, n) => t + n.amount, 0));
      const share = buildNodeTable(w.table).sites[s];
      if (sum.some((n, k) => n + share.unplaced[k] !== nodes[k])) exact = false;
    }
    c.check(exact && st.missed <= Math.ceil(0.03 * (st.placed + st.missed)), `seed ${seed}: placed + missed nodes + unplaced share = the site's node share; ≤ 3 % missed (their particles stay in the terrain body)`, `${st.missed} missed of ${st.placed + st.missed}`);
    let worst = 0;
    for (const p of placed.slice(0, 40))
      for (let at = 0; at < 4; at++) {
        const t = performance.now();
        anchorAttempt(probe, { cx: p.anchor.x, cz: p.anchor.z, radius: 150, rect, region: -1, surface: p.node.surface, seed: p.node.hash }, at, []);
        worst = Math.max(worst, performance.now() - t);
      }
    c.check(worst < 6, `seed ${seed}: one attempt ≤ 6 ms here (sliced under the frame budget)`, `worst ${worst.toFixed(2)} ms · ${(ms / sites.length).toFixed(1)} ms per site`);
  }

  c.section("open water for lost caches");
  {
    const w = world(7);
    const spawn = findSpawn(w.field);
    const s = findOpenWater(w.field, spawn.x, spawn.y, spawn.z);
    c.check(s.x === spawn.x && s.y === spawn.y && s.z === spawn.z && s.clearance >= OPEN_WATER.clearance, "an open start is kept as it is");
    const placed = new NodePlacement(w.field, w.layout, w.exp(), 400).placeSite(45);
    let ok = 0, far = 0;
    for (const p of placed) {
      const o = findOpenWater(w.field, p.anchor.x - p.anchor.nx * 0.3, p.anchor.y - p.anchor.ny * 0.3, p.anchor.z - p.anchor.nz * 0.3);
      if (clearanceAt(w.field, o.x, o.y, o.z) >= OPEN_WATER.clearance) ok++;
      far = Math.max(far, Math.hypot(o.x - p.anchor.x, o.y - p.anchor.y, o.z - p.anchor.z));
    }
    c.check(ok === placed.length, `from inside the rock: the nearest point with ≥ ${OPEN_WATER.clearance} m clearance`, `${ok}/${placed.length}, farthest ${far.toFixed(1)} m`);
  }
}
