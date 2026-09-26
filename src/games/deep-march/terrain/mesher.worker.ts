/// Module worker: builds full-height marching-cubes column meshes off the main thread.
import { createDensityField, type DensityField } from "./density";
import { columnRows, generateColumnMesh, type ColumnRows } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";
import { terrainInfoTransfers } from "./terrainInfo";

type WorkerScope = {
  onmessage: ((ev: MessageEvent<MesherRequest>) => void) | null;
  postMessage: (msg: MesherResponse, transfer: Transferable[]) => void;
};

const ctx = self as unknown as WorkerScope;
let field: DensityField | null = null;
let rows: ColumnRows | null = null;

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    field = createDensityField(msg.seed, msg.settings);
    rows = columnRows(field);
    return;
  }
  if (msg.type === "column" && field && rows) {
    const t0 = performance.now();
    const m = generateColumnMesh(field, msg.cx, msg.cz, rows, field.settings.floaterMargin);
    const res: MesherResponse = { type: "column", id: msg.id, ...m, ms: performance.now() - t0 };
    const transfer: Transferable[] = [m.positions.buffer, m.normals.buffer, m.ao.buffer, m.indices.buffer, m.removed.buffer];
    if (m.info) transfer.push(...terrainInfoTransfers(m.info));
    ctx.postMessage(res, transfer);
  }
};
