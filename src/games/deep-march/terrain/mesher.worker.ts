/// Module worker: builds full-height marching-cubes column meshes (any LOD) and
/// base-scale terrain classification off the main thread. Keeps one pair of
/// density fields per terrain generation (key 0 = the init layout; the tide adds
/// gen + 1 with addGen and drops the old one with dropGen, poolRouter.ts).
import { baseTerrain, type TerrainSettings } from "./config";
import { createDensityField, type DensityField } from "./density";
import { columnRows, generateColumnMesh, type ColumnRows } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";
import type { SiteLayout } from "./siteLayout";
import { terrainInfoTransfers } from "./terrainInfo";

type WorkerScope = {
  onmessage: ((ev: MessageEvent<MesherRequest>) => void) | null;
  postMessage: (msg: MesherResponse, transfer: Transferable[]) => void;
};

type Generation = { field: DensityField; base: DensityField; baseRows: ColumnRows; rowsByLod: ColumnRows[] };

const ctx = self as unknown as WorkerScope;
const gens = new Map<number, Generation>();
let world: { seed: number; settings: TerrainSettings } | null = null;

function generation(layout: SiteLayout | null): Generation {
  const { seed, settings } = world!;
  const base = createDensityField(seed, baseTerrain(settings), undefined, layout);
  return { field: createDensityField(seed, settings, undefined, layout), base, baseRows: columnRows(base), rowsByLod: [] };
}

const EMPTY = () => ({ positions: new Float32Array(0), normals: new Float32Array(0), ao: new Float32Array(0), region: new Uint8Array(0), indices: new Uint16Array(0), removed: new Int32Array(0) });

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    world = { seed: msg.seed, settings: msg.settings };
    gens.clear();
    gens.set(0, generation(msg.layout));
    return;
  }
  if (msg.type === "addGen") {
    if (world) gens.set(msg.gen, generation(msg.layout));
    return;
  }
  if (msg.type === "dropGen") {
    gens.delete(msg.gen);
    return;
  }
  const g = gens.get(msg.gen ?? 0);
  const t0 = performance.now();
  let m: ReturnType<typeof generateColumnMesh>;
  if (!g) {
    // generation dropped while the job was queued: answer (the pool counts in-flight jobs), nothing built
    const stats = { floaters: 0, floaterPoints: 0, ambiguous: 0, searched: 0, noiseSamples: 0, rawPoints: 0, coarseSamples: 0 };
    m = { ...EMPTY(), bounds: new Float32Array(6), stats, info: null, infoMs: 0 } as ReturnType<typeof generateColumnMesh>;
  } else if (msg.type === "column") {
    const rows = (g.rowsByLod[msg.lod] ??= columnRows(g.field, msg.lod));
    m = generateColumnMesh(g.field, msg.cx, msg.cz, rows, g.field.settings.floaterMargin * (1 << msg.lod), undefined, false, undefined, msg.lod);
  } else {
    const full = generateColumnMesh(g.base, msg.cx, msg.cz, g.baseRows, g.base.settings.floaterMargin, undefined, true);
    m = { ...full, ...EMPTY() };
  }
  const res: MesherResponse = { type: msg.type, id: msg.id, ...m, ms: performance.now() - t0 };
  const transfer: Transferable[] = [m.positions.buffer, m.normals.buffer, m.ao.buffer, m.region.buffer, m.indices.buffer, m.removed.buffer];
  if (m.info) transfer.push(...terrainInfoTransfers(m.info));
  ctx.postMessage(res, transfer);
};
