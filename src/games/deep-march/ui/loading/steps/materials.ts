/** 03 Seabed materials: bytes of all 22 layers, then the GPU upload (materialLibrary.ts). */
import { LAYERS } from "../../../scene/materialCatalog";
import { formatMB } from "../loadingModel";
import type { LoadingStepDef } from "./types";

export const materialsStep: LoadingStepDef = {
  id: "materials",
  weight: 50,
  required: true,
  evaluate(snap, { L }) {
    const m = snap?.materials;
    if (!m) return { state: "pending", lines: [L.connecting] };
    const lines = [L.materialCount(m.done, m.total, formatMB(m.bytes), formatMB(m.totalBytes))];
    if (m.error) lines.push(L.failed(m.error));
    else if (m.done === m.total && !m.ready) lines.push(L.uploading);
    else if (m.last >= 0 && !m.ready) lines.push(L.laying(L.materialNames[LAYERS[m.last].key] ?? LAYERS[m.last].key));
    else if (!m.ready) lines.push(L.connecting);
    if (m.retrying > 0 && !m.error) lines.push(L.retrying(m.retrying));
    if (m.fellBack) lines.push(L.fallback);
    const diag = [{ label: L.diag.texPath, value: m.path === "ktx2" ? "KTX2 (Basis)" : "WebP" }];
    if (m.error) diag.push({ label: L.diag.texError, value: m.error });
    if (m.ready) return { state: "done", lines, diag };
    return { state: m.error ? "error" : "active", done: m.bytes, total: m.totalBytes, lines, diag, actions: m.error ? ["retryMaterials"] : undefined };
  },
};
