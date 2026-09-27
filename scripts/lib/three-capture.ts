/**
 * Capture the exact GLSL three.js (WebGLRenderer) sends to the driver, without a GPU:
 * a mock WebGL2 context records shaderSource() while the real renderer builds its
 * programs for a scene. Used by test:shaders to validate the final seabed programs
 * (three's prefix, precision, light counts, defines, our onBeforeCompile patches).
 */
import * as THREE from "three";

export type CapturedProgram = { vertex: string; fragment: string };

export type MockOptions = {
  /** Reported highp support (false → three falls back to mediump). */
  highp?: boolean;
};

function mockGL(opts: MockOptions, sources: string[]): WebGL2RenderingContext {
  const consts = new Map<string, number>();
  let next = 0x9000;
  const known: Record<string, number> = { VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, VERSION: 0x1f02, SHADING_LANGUAGE_VERSION: 0x8b8c, HIGH_FLOAT: 0x8df2, MEDIUM_FLOAT: 0x8df1, VIEWPORT: 0x0ba2, SCISSOR_BOX: 0x0c10 };
  const constant = (name: string) => {
    if (known[name] !== undefined) return known[name];
    if (!consts.has(name)) consts.set(name, next++);
    return consts.get(name)!;
  };
  const shaders = new Map<object, number>();
  const impl: Record<string, unknown> = {
    canvas: { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {} },
    drawingBufferWidth: 1,
    drawingBufferHeight: 1,
    drawingBufferColorSpace: "srgb",
    getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "default", failIfMajorPerformanceCaveat: false }),
    isContextLost: () => false,
    getExtension: (name: string) => (/color_buffer_float|texture_float_linear/.test(name) ? {} : null),
    getSupportedExtensions: () => [],
    getParameter: (p: number) => {
      if (p === known.VERSION) return "WebGL 2.0 (mock)";
      if (p === known.SHADING_LANGUAGE_VERSION) return "WebGL GLSL ES 3.00 (mock)";
      if (p === known.VIEWPORT || p === known.SCISSOR_BOX) return new Int32Array([0, 0, 1, 1]);
      return 4096;
    },
    getShaderPrecisionFormat: (_s: number, t: number) => ({ precision: t === known.HIGH_FLOAT && opts.highp === false ? 0 : 23, rangeMin: 127, rangeMax: 127 }),
    createShader: (type: number) => {
      const s = {};
      shaders.set(s, type);
      return s;
    },
    shaderSource: (s: object, src: string) => {
      sources.push(`${shaders.get(s) === known.VERTEX_SHADER ? "V" : "F"}\u0000${src}`);
    },
    getShaderParameter: () => true,
    getProgramParameter: (_p: object, n: number) => (n === known.LINK_STATUS ? true : 0),
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getShaderSource: () => "",
    getUniformLocation: () => null,
    getAttribLocation: () => -1,
    getActiveAttrib: () => null,
    getActiveUniform: () => null,
  };
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (/^[A-Z0-9_]+$/.test(prop)) return constant(prop);
      if (prop.startsWith("create")) return () => ({});
      if (prop.startsWith("is")) return () => false;
      if (prop.startsWith("check")) return () => 0x8cd5; // FRAMEBUFFER_COMPLETE-ish
      return () => undefined;
    },
  }) as unknown as WebGL2RenderingContext;
}

/** Build every program of `objects` in `scene` and return the captured sources in order. */
export function capturePrograms(scene: THREE.Scene, camera: THREE.Camera, opts: MockOptions = {}): CapturedProgram[] {
  const g = globalThis as Record<string, unknown>;
  g.self ??= globalThis;
  g.requestAnimationFrame ??= () => 0;
  g.cancelAnimationFrame ??= () => {};
  const sources: string[] = [];
  const gl = mockGL(opts, sources);
  const renderer = new THREE.WebGLRenderer({ context: gl, canvas: (gl as unknown as { canvas: HTMLCanvasElement }).canvas });
  const warn = console.warn;
  console.warn = () => {};
  try {
    renderer.compile(scene, camera);
  } finally {
    console.warn = warn;
  }
  const out: CapturedProgram[] = [];
  for (let i = 0; i + 1 < sources.length; i += 2) {
    const [a, b] = [sources[i], sources[i + 1]];
    const v = a.startsWith("V") ? a : b;
    const f = a.startsWith("F") ? a : b;
    out.push({ vertex: v.slice(2), fragment: f.slice(2) });
  }
  return out;
}
