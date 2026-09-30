/**
 * Conserve mode — resource nodes (plan M4; conserve/nodes, conserve/expedition):
 *   - node table: deterministic in (seed, gen, R); per site and kind, Σ node
 *     sizes + the unplaced remainder = the site's node share exactly; sizes 20–80;
 *     ≤ 64 nodes per site, ids = site · 64 + ordinal; surface preference per kind;
 *     reef sites carry ~6–10 lumen nodes (design doc §7.1);
 *   - absorbing a node: W → P conserves, a full node drains in 2 s of holding,
 *     partial progress kept, harvested at 0;
 *   - node state save: base64 codec (vs Node's Buffer), harvested bitset + partial
 *     round trip over random states, foreign / invalid entries dropped;
 *   - placement on the terrain and open water for caches (lib/nodePlacementChecks.ts).
 * Run: npm run test:nodes
 */
import { NODES, NODE_SURFACE } from "../src/games/deep-march/conserve/config";
import { Expedition } from "../src/games/deep-march/conserve/expedition/expedition";
import { base64ToBytes, bytesToBase64, decodeIdSet, encodeIdSet } from "../src/games/deep-march/conserve/nodes/bitset";
import { NodeState } from "../src/games/deep-march/conserve/nodes/nodeState";
import { buildNodeTable, type NodeTable } from "../src/games/deep-march/conserve/nodes/nodeTable";
import { PARTICLE_TYPES } from "../src/games/deep-march/conserve/particles/particleTypes";
import { createWorldSave } from "../src/games/deep-march/conserve/save/createSave";
import { createGenesisLedger } from "../src/games/deep-march/conserve/world/genesis";
import { buildSiteTable, type SiteTable } from "../src/games/deep-march/conserve/world/siteTable";
import { mulberry32 } from "../src/games/deep-march/terrain/noise";
import { createChecker } from "./lib/checks";
import { drawChecks } from "./lib/nodeDrawChecks";
import { placementChecks } from "./lib/nodePlacementChecks";

const c = createChecker();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function genesis(seed: number): { sites: SiteTable; nodes: NodeTable } {
  const save = createWorldSave({ id: "main", seedText: String(seed), seed, now: 0 });
  const sites = buildSiteTable({ seed, gen: 1, allocInput: save.generation.allocInput, totals: save.totals });
  return { sites, nodes: buildNodeTable(sites) };
}

c.section("node table");
{
  const a = genesis(7), b = genesis(7), other = genesis(8);
  c.check(same(a.nodes.sites, b.nodes.sites), "deterministic: same (seed, gen, R) → same nodes");
  c.check(!same(a.nodes.sites, other.nodes.sites), "another seed → other nodes");
  for (const seed of [7, 42, 1234]) {
    const { sites, nodes } = genesis(seed);
    let exact = true, inRange = true, ids = true, surfaces = true, perSite = 0;
    const all = nodes.sites.flatMap((s) => s.nodes);
    for (const s of sites.sites) {
      const sn = nodes.sites[s.i];
      perSite = Math.max(perSite, sn.nodes.length);
      s.split.nodes.forEach((share, k) => {
        const sum = sn.nodes.filter((n) => n.kind === k).reduce((t, n) => t + n.amount, 0);
        if (sum + sn.unplaced[k] !== share || (sn.unplaced[k] > 0 && sum > 0)) exact = false;
        if (sn.unplaced[k] >= NODES.minSize) exact = false;
      });
      sn.nodes.forEach((n, j) => {
        if (n.amount < NODES.minSize || n.amount > NODES.maxSize) inRange = false;
        if (n.id !== s.i * NODES.perSite + j || n.ordinal !== j || n.site !== s.i) ids = false;
        if (n.surface !== NODE_SURFACE[PARTICLE_TYPES[n.kind]]) surfaces = false;
      });
    }
    c.check(exact, `seed ${seed}: Σ node sizes + unplaced = the site's node share, per site and kind (unplaced only below ${NODES.minSize})`);
    c.check(inRange, `seed ${seed}: every node ${NODES.minSize}–${NODES.maxSize} particles`, `${all.length} nodes, mean ${(all.reduce((t, n) => t + n.amount, 0) / all.length).toFixed(1)}`);
    c.check(ids && perSite <= NODES.perSite && new Set(all.map((n) => n.id)).size === all.length, `seed ${seed}: ids = site · 64 + ordinal, unique, ≤ 64 per site`, `max ${perSite} per site`);
    c.check(surfaces, `seed ${seed}: surface preference by kind (lithic rock, lumen ledge, ferro wall)`);
    const reef = sites.sites.filter((s) => s.biome === "reef" && !s.edge);
    const lumen = reef.map((s) => nodes.sites[s.i].nodes.filter((n) => PARTICLE_TYPES[n.kind] === "lumen").length);
    const mean = lumen.reduce((t, n) => t + n, 0) / Math.max(1, lumen.length);
    c.check(mean >= 5 && mean <= 12, `seed ${seed}: inner reef sites carry ~6–10 lumen nodes (§7.1)`, `mean ${mean.toFixed(1)} over ${lumen.length} sites (${Math.min(...lumen)}–${Math.max(...lumen)})`);
    const hashes = new Set(all.map((n) => n.hash));
    c.check(hashes.size >= all.length - 1 && all.every((n) => Number.isInteger(n.hash) && n.hash >= 0 && n.hash < 2 ** 32), `seed ${seed}: placement hashes uint32, distinct`);
  }
}

c.section("absorbing a node (W → P)");
{
  const { nodes } = genesis(7);
  const ledger = createGenesisLedger();
  const exp = new Expedition({ ledger, nodes: NodeState.fresh(nodes), caches: [], gen: 1, sitesX: 10, sitesZ: 10 });
  const node = nodes.sites.flatMap((s) => s.nodes).find((n) => n.amount >= 50)!;
  const type = PARTICLE_TYPES[node.kind];
  const w0 = ledger.amount("world", type);
  let frames = 0;
  while (exp.remaining(node.id) > 0 && frames < 1000) {
    exp.absorb(node.id, 1 / 60);
    frames++;
    if (!ledger.isConserved()) break;
  }
  c.check(ledger.isConserved() && ledger.amount("world", type) === w0 - node.amount && ledger.amount("player", type) === node.amount, "a whole node moves W → P, conserved", `${node.amount} ${type}`);
  c.check(Math.abs(frames - 120) <= 1, "a full node drains in 2 s of holding (60 fps)", `${frames} frames`);
  const n2 = nodes.sites.flatMap((s) => s.nodes).find((n) => n.id !== node.id && n.amount >= 40)!;
  for (let i = 0; i < 30; i++) exp.absorb(n2.id, 1 / 60);
  exp.release();
  const left = exp.remaining(n2.id);
  c.check(left > 0 && left < n2.amount && exp.toSave().partial.some(([id, l]) => id === n2.id && l === left), "a released hold keeps the partial node");
  const decoded = decodeIdSet(exp.toSave().harvested);
  c.check(!!decoded && decoded.has(node.id) && decoded.size === 1, "an emptied node is harvested (bitset)");
}

c.section("node state save");
{
  const rnd = mulberry32(5);
  let codec = true;
  for (let i = 0; i < 300; i++) {
    const bytes = new Uint8Array(Math.floor(rnd() * 40)).map(() => Math.floor(rnd() * 256));
    const text = bytesToBase64(bytes);
    if (text !== Buffer.from(bytes).toString("base64") || !same([...(base64ToBytes(text) ?? [])], [...bytes])) codec = false;
  }
  c.check(codec, "base64 codec = Buffer's, and round trips (300 random byte strings)");
  c.check(base64ToBytes("QQ") === null && base64ToBytes("a$b=") === null && decodeIdSet("") !== null && decodeIdSet("")!.size === 0, "malformed base64 → null; empty → no ids");
  c.check(same([...decodeIdSet(encodeIdSet([0, 7, 8, 6399]))!].sort((a, b) => a - b), [0, 7, 8, 6399]), "id set round trip (0, 7, 8, 6399)");
  const { nodes } = genesis(42);
  const all = nodes.sites.flatMap((s) => s.nodes);
  let roundTrip = true;
  let bytes = 0;
  for (let trial = 0; trial < 20; trial++) {
    const st = NodeState.fresh(nodes);
    for (const n of all) {
      const r = rnd();
      if (r < 0.3) st.take(n.id, n.amount);
      else if (r < 0.5) st.take(n.id, 1 + Math.floor(rnd() * (n.amount - 1)));
    }
    const saved = st.toSave();
    bytes = Math.max(bytes, JSON.stringify(saved).length);
    const back = NodeState.fromSave(nodes, JSON.parse(JSON.stringify(saved)));
    if (back.dropped !== 0 || all.some((n) => back.state.remaining(n.id) !== st.remaining(n.id))) roundTrip = false;
  }
  c.check(roundTrip, "harvested bitset + partial: 20 random states round trip exactly", `≤ ${bytes} B of JSON for ${all.length} nodes`);
  const foreign = NodeState.fromSave(nodes, { harvested: encodeIdSet([63]), partial: [[all[0].id, 0], [all[1].id, all[1].amount], [all[2].id, 3], [all[2].id, 2], [999_999, 5]] });
  const expectDropped = (nodes.byId.has(63) ? 0 : 1) + 4;
  c.check(foreign.dropped === expectDropped && foreign.state.remaining(all[2].id) === (all[2].amount > 3 ? 3 : all[2].amount), "foreign ids, remaining ≤ 0 or ≥ amount, duplicates dropped", `${foreign.dropped} dropped`);
}

placementChecks(c);
drawChecks(c);
c.finish();
