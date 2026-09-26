/// Module worker: builds full-height marching-cubes column meshes (any LOD) and
/// base-scale terrain classification off the main thread.
import { baseTerrain } from "./config";
import { createDensityField, type DensityField } from "./density";
import { columnRows, generateColumnMesh, lodField, type ColumnRows } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";
import { terrainInfoTransfers } from "./terrainInfo";

type WorkerScope = {
  onmessage: ((ev: MessageEvent<MesherRequest>) => void) | null;
  postMessage: (msg: MesherResponse, transfer: Transferable[]) => void;
};

const ctx = self as unknown as WorkerScope;
let field: DensityField | null = null;
let base: DensityField | null = null;
let baseRows: ColumnRows | null = null;
const rowsByLod: ColumnRows[] = [];

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    field = createDensityField(msg.seed, msg.settings);
    base = msg.settings.worldScale === 1 ? field : createDensityField(msg.seed, baseTerrain(msg.settings));
    baseRows = columnRows(base);
    rowsByLod.length = 0;
    return;
  }
  if (!field || !base || !baseRows) return;
  const t0 = performance.now();
  let m: ReturnType<typeof generateColumnMesh>;
  if (msg.type === "column") {
    const f = lodField(field, msg.lod);
    const rows = (rowsByLod[msg.lod] ??= columnRows(f, msg.lod));
    m = generateColumnMesh(f, msg.cx, msg.cz, rows, field.settings.floaterMargin * (1 << msg.lod), undefined, false, undefined, msg.lod);
  } else {
    const full = generateColumnMesh(base, msg.cx, msg.cz, baseRows, base.settings.floaterMargin, undefined, true);
    m = { ...full, positions: new Float32Array(0), normals: new Float32Array(0), ao: new Float32Array(0), indices: new Uint16Array(0), removed: new Int32Array(0) };
  }
  const res: MesherResponse = { type: msg.type, id: msg.id, ...m, ms: performance.now() - t0 };
  const transfer: Transferable[] = [m.positions.buffer, m.normals.buffer, m.ao.buffer, m.indices.buffer, m.removed.buffer];
  if (m.info) transfer.push(...terrainInfoTransfers(m.info));
  ctx.postMessage(res, transfer);
};
