/**
 * 05 System check: battery, lamps, sonar, seabed programs compiled / linked. The GPU
 * facts and full shader logs go to the diagnostics drawer (a long ANGLE renderer
 * string used to overflow the row on phones). A shader failure can be overridden with
 * "Dive anyway"; a lost GPU context cannot.
 */
import type { LoadingStepDef } from "./types";

export const systemStep: LoadingStepDef = {
  id: "system",
  weight: 5,
  required: true,
  bypassable: true,
  evaluate(snap, { L }) {
    if (!snap) return { state: "pending", lines: [] };
    const s = snap.system;
    const mark = (ok: boolean) => (ok ? "✓" : "·");
    const broken = !!s.shaderError || s.gpuLost;
    const lines = [
      `${mark(s.battery > 0)} ${L.battery(Math.round(s.battery * 100))} · ${mark(s.sonar)} ${L.sonar}`,
      `${mark(s.lamps.length > 0)} ${L.lamps(s.lamps.map((m) => L.lightModes[m]).join(" · "))}`,
      s.gpuLost ? `✗ ${L.gpuLost}` : s.shaderError ? `✗ ${L.shaderErrorShort}` : `${mark(s.shaders)} ${L.shaders}`,
    ];
    const g = s.gpu;
    const diag = [
      { label: L.diag.gpu, value: g.renderer },
      { label: L.diag.limits, value: L.diag.limitsValue(g.textureUnits, g.fragmentVectors, g.highp) },
    ];
    if (s.shaderError) diag.push({ label: L.diag.shaderLog, value: s.shaderError });
    const ok = [s.battery > 0, s.lamps.length > 0, s.sonar, s.shaders && !broken].filter(Boolean).length;
    if (ok === 4) return { state: "done", lines, diag };
    return {
      state: broken ? "error" : "active",
      done: ok,
      total: 4,
      lines,
      diag,
      actions: s.shaderError && !s.gpuLost ? ["diveAnyway"] : undefined,
    };
  },
};
