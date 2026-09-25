/// Module worker: builds marching-cubes chunk meshes off the main thread.
import { createDensityField, type DensityField } from "./density";
import { generateChunkMesh } from "./mesher";
import type { MesherRequest, MesherResponse } from "./protocol";

type WorkerScope = {
  onmessage: ((ev: MessageEvent<MesherRequest>) => void) | null;
  postMessage: (msg: MesherResponse, transfer: Transferable[]) => void;
};

const ctx = self as unknown as WorkerScope;
let field: DensityField | null = null;

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    field = createDensityField(msg.seed, msg.settings);
    return;
  }
  if (msg.type === "chunk" && field) {
    const t0 = performance.now();
    const m = generateChunkMesh(field, msg.cx, msg.cy, msg.cz);
    const res: MesherResponse = {
      type: "chunk",
      id: msg.id,
      positions: m.positions,
      normals: m.normals,
      colors: m.colors,
      indices: m.indices,
      ms: performance.now() - t0,
    };
    ctx.postMessage(res, [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer]);
  }
};
