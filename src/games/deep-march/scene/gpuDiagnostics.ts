/**
 * GPU / shader diagnostics for the loading screen's system check (node-safe, pure
 * helpers + a WebGL query): renderer string, the limits the seabed programs depend
 * on, and a compact report of a failed program's info logs.
 */
export type GpuInfo = {
  /** Unmasked renderer (WEBGL_debug_renderer_info) or the masked RENDERER string. */
  renderer: string;
  /** MAX_TEXTURE_IMAGE_UNITS (fragment samplers; WebGL2 minimum 16). */
  textureUnits: number;
  /** MAX_FRAGMENT_UNIFORM_VECTORS (WebGL2 minimum 224). */
  fragmentVectors: number;
  /** highp float supported in fragment shaders. */
  highp: boolean;
};

export function gpuInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo {
  let renderer = "";
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    renderer = "unknown";
  }
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  return {
    renderer: renderer || "unknown",
    textureUnits: Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) || 0,
    fragmentVectors: Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)) || 0,
    highp: !!hp && hp.precision > 0,
  };
}

const MAX_LOG = 360;

/** Program / vertex / fragment info logs → one compact line set (empty logs named as such). */
export function failureReport(programLog: string | null, vertexLog: string | null, fragmentLog: string | null): string {
  const clean = (s: string | null) => (s ?? "").replace(/\u0000/g, "").trim();
  const p = clean(programLog), v = clean(vertexLog), f = clean(fragmentLog);
  const parts = [`program: ${p || "(empty)"}`, `fragment log: ${f || "(empty)"}`];
  if (v) parts.push(`vertex log: ${v}`);
  const text = parts.join(" | ").replace(/\s*\n\s*/g, " / ");
  return text.length > MAX_LOG ? `${text.slice(0, MAX_LOG - 1)}…` : text;
}
