/**
 * Helpers to validate WebGL2 (GLSL ES 3.00) shader strings with glslang, which only
 * emits SPIR-V (ES ≥ 3.10, uniforms in blocks, explicit locations): the source is
 * rewritten minimally (version, plain uniforms → globals, samplers bound, in/out
 * locations) keeping every ES typing / precision rule. Plus an estimate of uniform
 * vectors (GLSL ES packing) for the per-stage limits.
 */
import glslangInit from "@webgpu/glslang/dist/node-devel/glslang.js";

export type Glslang = { compileGLSL(src: string, stage: "vertex" | "fragment", debug: boolean): Uint32Array };

export async function loadGlslang(): Promise<Glslang> {
  // the emscripten module is a thenable resolving to itself: unwrap it by hand
  return new Promise<Glslang>((res) => (glslangInit() as unknown as { then(cb: (g: Glslang & { then?: unknown }) => void): void }).then((g) => {
    delete g.then;
    res(g);
  }));
}

/** three's WebGL2 program string → glslang-compilable ES 3.10 (same code). */
export function esForGlslang(src: string, stage: "vertex" | "fragment"): string {
  let binding = 0, inLoc = 0, outLoc = 1;
  return src
    .replace(/^#version 300 es/, "#version 310 es")
    // glslang's SPIR-V front end knows extension built-ins GLSL ES doesn't have
    .replace(/\baverage\b/g, "average_")
    .replace(/^#define (attribute|varying) (in|out)\s*$/gm, "")
    // precision: a keyword or a macro (DM_M, seabedShader.ts)
    .replace(/\buniform\s+((?:highp|mediump|lowp|DM_\w+)\s+)?((?:[iu]?sampler\w+))\s+(\w+)\s*;/g, (_, p, t, n) => `layout(binding = ${binding++}) uniform ${p ?? ""}${t} ${n};`)
    .replace(/\buniform\s+(?!((?:highp|mediump|lowp|DM_\w+)\s+)?[iu]?sampler)/g, "")
    // a matN attribute (instanceMatrix) takes N locations
    .replace(/^(\s*)attribute\s+((?:(?:highp|mediump|lowp)\s+)?)(\w+)/gm, (_, sp, prec, type) => {
      const loc = inLoc;
      inLoc += /^mat4/.test(type) ? 4 : /^mat3/.test(type) ? 3 : /^mat2/.test(type) ? 2 : 1;
      return `${sp}layout(location = ${loc}) in ${prec}${type}`;
    })
    .replace(/^(\s*)(flat\s+)?varying\s+/gm, (_, sp, fl) => (stage === "vertex" ? `layout(location = ${outLoc++}) ${fl ?? ""}out ` : `layout(location = ${inLoc++}) ${fl ?? ""}in `));
}

/** Minimal C preprocessor pass (#define / #if / #ifdef / #elif / #else / #endif) → active lines. */
export function preprocess(src: string): string {
  const defs = new Map<string, string>();
  const out: string[] = [];
  const stack: { on: boolean; taken: boolean; parent: boolean }[] = [];
  const active = () => stack.every((s) => s.on);
  const evalExpr = (e: string): boolean => {
    let x = e.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (defs.has(n) ? "1" : "0")).replace(/defined\s+(\w+)/g, (_, n) => (defs.has(n) ? "1" : "0"));
    for (let k = 0; k < 4; k++) x = x.replace(/\b[A-Za-z_]\w*\b/g, (n) => (defs.has(n) && /^[\d\s.+\-*/()]+$/.test(defs.get(n)!) ? `(${defs.get(n)})` : defs.has(n) ? "1" : "0"));
    if (!/^[\d\s()+\-*/<>=!&|.]*$/.test(x)) throw new Error(`preprocess: cannot evaluate '${e}'`);
    return !!Function(`"use strict"; return (${x});`)();
  };
  for (const line of src.split("\n")) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (!m) {
      if (active()) out.push(line);
      continue;
    }
    const [, dir, rest] = m;
    if (dir === "ifdef" || dir === "ifndef" || dir === "if") {
      const parent = active();
      const on = parent && (dir === "if" ? evalExpr(rest) : dir === "ifdef" ? defs.has(rest.trim()) : !defs.has(rest.trim()));
      stack.push({ on, taken: on, parent });
    } else if (dir === "elif") {
      const s = stack[stack.length - 1];
      s.on = s.parent && !s.taken && evalExpr(rest);
      s.taken ||= s.on;
    } else if (dir === "else") {
      const s = stack[stack.length - 1];
      s.on = s.parent && !s.taken;
      s.taken = true;
    } else if (dir === "endif") stack.pop();
    else if (active()) {
      if (dir === "define") {
        const d = /^(\w+)(\([^)]*\))?\s*(.*)$/.exec(rest);
        if (d && !d[2]) defs.set(d[1], d[3].replace(/\/\/.*$/, "").trim());
      } else if (dir === "undef") defs.delete(rest.trim());
      out.push(line);
    }
  }
  return out.join("\n");
}

/** Optional precision qualifier: a keyword or one of our precision macros (DM_P / DM_M, seabedShader.ts). */
const PREC = String.raw`(?:(?:highp|mediump|lowp|DM_[A-Z]\w*)\s+)?`;

const ROWS: Record<string, [number, number]> = {
  // [rows, columns used per row]
  float: [1, 1], int: [1, 1], uint: [1, 1], bool: [1, 1],
  vec2: [1, 2], ivec2: [1, 2], bvec2: [1, 2],
  vec3: [1, 3], ivec3: [1, 3], bvec3: [1, 3],
  vec4: [1, 4], ivec4: [1, 4], bvec4: [1, 4],
  mat2: [2, 2], mat3: [3, 3], mat4: [4, 4],
};

/**
 * Uniform vectors of the default-block uniforms declared in `src` (after three's
 * defines are expanded for array sizes): `rows` = every declaration its own rows
 * (upper bound), `packed` ≈ GLSL ES Appendix A packing (vec3 rows share their spare
 * column with floats, vec2s pair, scalars share rows).
 */
export function uniformVectors(source: string): { rows: number; packed: number; names: [string, number][] } {
  const src = preprocess(source);
  const defs = new Map<string, number>();
  for (const m of src.matchAll(/^\s*#define\s+(\w+)\s+(\d+)\s*$/gm)) defs.set(m[1], Number(m[2]));
  const structs = new Map<string, [string, number][]>();
  for (const m of src.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g)) {
    const members: [string, number][] = [];
    for (const d of m[2].matchAll(new RegExp(String.raw`(${PREC})(\w+)\s+(\w+)(?:\s*\[\s*(\w+)\s*\])?\s*;`, "g"))) members.push([d[2], d[4] ? Number(defs.get(d[4]) ?? d[4]) : 1]);
    structs.set(m[1], members);
  }
  const names: [string, number][] = [];
  let rows = 0, full = 0, v3 = 0, v2 = 0, v1 = 0;
  const add = (type: string, count: number, name: string, array: boolean) => {
    const st = structs.get(type);
    if (st) {
      for (let i = 0; i < count; i++) for (const [t, n] of st) add(t, n, name, n > 1);
      return;
    }
    const r = ROWS[type];
    if (!r) return; // samplers
    rows += r[0] * count;
    if (r[1] === 4 || r[0] > 1 || array) full += r[0] * count;
    else if (r[1] === 3) v3 += count;
    else if (r[1] === 2) v2 += count;
    else v1 += count;
  };
  for (const m of src.matchAll(new RegExp(String.raw`\buniform\s+(${PREC})(\w+)\s+(\w+)(?:\s*\[\s*(\w+)\s*\])?\s*;`, "g"))) {
    const n = m[4] ? Number(defs.get(m[4]) ?? m[4]) : 1;
    const before = rows;
    add(m[2], n, m[3], !!m[4]);
    if (rows > before) names.push([m[3], rows - before]);
  }
  const floatsLeft = Math.max(0, v1 - v3);
  const packed = full + v3 + Math.ceil(v2 / 2) + Math.ceil(Math.max(0, floatsLeft - (v2 % 2) * 2) / 4);
  return { rows, packed, names };
}

/** Active sampler uniforms (preprocessed source), arrays counted by size. */
export function samplerUniforms(source: string): { count: number; names: string[] } {
  const src = preprocess(source);
  const defs = new Map<string, number>();
  for (const m of src.matchAll(/^\s*#define\s+(\w+)\s+(\d+)\s*$/gm)) defs.set(m[1], Number(m[2]));
  let count = 0;
  const names: string[] = [];
  for (const m of src.matchAll(new RegExp(String.raw`\buniform\s+${PREC}([iu]?sampler\w+)\s+(\w+)(?:\s*\[\s*(\w+)\s*\])?\s*;`, "g"))) {
    const n = m[3] ? Number(defs.get(m[3]) ?? m[3]) : 1;
    count += n;
    if (n > 0) names.push(n > 1 ? `${m[2]}[${n}]` : m[2]);
  }
  return { count, names };
}

/** Sampler-array accesses whose index isn't an integer literal (must be constant-index-expressions). */
export function dynamicSamplerIndexing(source: string): string[] {
  const src = preprocess(source);
  const arrays = [...src.matchAll(new RegExp(String.raw`\buniform\s+${PREC}[iu]?sampler\w+\s+(\w+)\s*\[`, "g"))].map((m) => m[1]);
  const out: string[] = [];
  for (const a of arrays) for (const m of src.matchAll(new RegExp(`\\b${a}\\s*\\[\\s*([^\\]]*)\\]`, "g"))) if (!/^\d+$/.test(m[1].trim()) && !/uniform/.test(src.slice(Math.max(0, m.index! - 60), m.index))) out.push(m[0]);
  return out;
}

const ARRAY_ELEM = String.raw`(?:float|int|uint|bool|[biu]?vec[234]|mat[234](?:x[234])?)`;

/**
 * Array-type precision lint. Mali's native compiler behind ANGLE (Mali-G57, "S0032:
 * no default precision defined for variable 'float[5]'") rejects array types the
 * default precision statement doesn't reach: every array constructor
 * (`float[5](...)`) is an error, and every array declaration / parameter / return
 * type must carry an explicit precision qualifier (highp / mediump / lowp / DM_P).
 * `constructorsOnly` checks only the constructors (for three's own chunks).
 */
export function arrayPrecisionIssues(source: string, opts: { constructorsOnly?: boolean } = {}): string[] {
  const src = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(String.raw`\b${ARRAY_ELEM}\s*\[\s*[\w${"$"}{}.* ]*\]\s*\(`, "g"))) {
    // a return-type array (`float[5] f(`) is caught below, not a constructor
    const after = src.slice(m.index! + m[0].length - 1);
    if (!/^\(/.test(after)) continue;
    out.push(`array constructor: ${m[0].trim()}…`);
  }
  if (opts.constructorsOnly) return out;
  const decl = new RegExp(String.raw`(^|[;{}(,]|\n)\s*((?:(?:const|in|out|inout|uniform|flat)\s+)*)((?:highp|mediump|lowp|DM_P)\s+)?(${ARRAY_ELEM})\s+(\w+)\s*\[`, "g");
  for (const m of src.matchAll(decl)) if (!m[3]) out.push(`array without precision: ${`${m[2]}${m[4]} ${m[5]}[`.trim()}`);
  const ret = new RegExp(String.raw`(^|[;{}]|\n)\s*((?:highp|mediump|lowp|DM_P)\s+)?(${ARRAY_ELEM})\s*\[[^\]]*\]\s+(\w+)\s*\(`, "g");
  for (const m of src.matchAll(ret)) if (!m[2]) out.push(`array return type without precision: ${m[3]}[] ${m[4]}(`);
  return out;
}
