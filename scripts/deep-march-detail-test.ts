/**
 * Shader detail normal (scene/detailNormal.ts) — code checks only:
 *  1. the seabed fragment code (DECLS + DETAIL_GLSL + WATER_GLSL + MAP_FRAGMENT with
 *     DETAIL_APPLY) compiles with glslang for every variant (detail on / off ×
 *     desktop / low spec), with three's built-ins stubbed;
 *  2. JS mirror of dmDetailNormal on random surfaces:
 *     - low amplitude: tilt ≤ DETAIL_MAX_TILT, mean tilt small;
 *     - creases, not pits: crease pixels form connected lines, almost none sit in
 *       small compact blobs;
 *     - no tiling: the perturbation at p and p + T is uncorrelated for candidate periods;
 *     - anti-aliasing: both scales are off once a pixel covers a large part of a crease cell;
 *     - low spec: coarse scale only;
 *     - facet blend: 0 where the facet disagrees with the smooth normal (slivers) and far away.
 * Run: npm run test:detail
 */
import glslangInit from "@webgpu/glslang/dist/node-devel/glslang.js";
import { DECLS, MAP_FRAGMENT, WATER_GLSL } from "../src/games/deep-march/scene/seabedShader";
import { DETAIL_GLSL, DETAIL_MAX_TILT, DETAIL_SCALES, creaseHeightJS, detailNormalJS, facetWJS } from "../src/games/deep-march/scene/detailNormal";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

function fragmentSource(defines: string[]): string {
  let binding = 0, loc = 0;
  const vk = (src: string) =>
    src
      .replace(/uniform ((?:highp |mediump |lowp |DM_M )?)(sampler2D|sampler2DArray) (\w+);/g, (_, q, t, n) => `layout(set = 0, binding = ${binding++}) uniform ${q}${t} ${n};`)
      .replace(/uniform ((?:highp |mediump |lowp |DM_P )?)(float|int|vec2|vec3|vec4) (\w+(?:\[\w+\])?);/g, "$1$2 $3;")
      .replace(/varying (\w+) (\w+);/g, (_, t, n) => `layout(location = ${loc++}) in ${t} ${n};`);
  return [
    "#version 450",
    ...defines.map((d) => `#define ${d}`),
    "vec3 cameraPosition;",
    vk(DECLS),
    DETAIL_GLSL,
    vk(WATER_GLSL),
    "layout(location = 0) out vec4 outColor;",
    "void main() {",
    "  vec4 diffuseColor = vec4(1.0);",
    MAP_FRAGMENT,
    "  outColor = vec4(dmWorldNormal * dmRough + diffuseColor.rgb, 1.0);",
    "}",
  ].join("\n");
}

async function compileChecks() {
  // the emscripten module is a thenable resolving to itself: unwrap it by hand
  type G = { compileGLSL(src: string, stage: "fragment", debug: boolean): Uint32Array };
  const glslang = await new Promise<G>((res) => (glslangInit() as unknown as { then(cb: (g: G & { then?: unknown }) => void): void }).then((g) => {
    delete g.then;
    res(g);
  }));
  for (const defs of [["DM_DETAIL"], ["DM_DETAIL", "DM_LOW_SPEC"], [], ["DM_LOW_SPEC"]]) {
    let err = "";
    let words = 0;
    try {
      words = glslang.compileGLSL(fragmentSource(defs), "fragment", false).length;
    } catch (e) {
      err = String(e).slice(0, 600);
    }
    check(!err && words > 0, `fragment compiles [${defs.join(" + ") || "no detail"}]`, err || `${words} SPIR-V words`);
  }
}

function statsChecks() {
  let rnd = 12345;
  const next = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const unit = () => {
    const z = next() * 2 - 1, a = next() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), z, r * Math.sin(a)];
  };
  const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  // amplitude
  let maxT = 0, sumT = 0;
  const N = 60000;
  for (let q = 0; q < N; q++) {
    const n = unit();
    const p = [(next() - 0.5) * 4000, (next() - 0.5) * 300, (next() - 0.5) * 4000];
    const t = angle(n, detailNormalJS(n, p, 0.004, 1));
    maxT = Math.max(maxT, t);
    sumT += t;
  }
  const meanDeg = (sumT / N) * (180 / Math.PI);
  check(maxT <= DETAIL_MAX_TILT + 1e-6, "tilt capped", `max ${(maxT * 180 / Math.PI).toFixed(1)}° (cap ${(DETAIL_MAX_TILT * 180 / Math.PI).toFixed(1)}°)`);
  check(meanDeg > 1 && meanDeg < 7, "low amplitude", `mean tilt ${meanDeg.toFixed(2)}°`);
  // creases, not pits: on planes through the field, the crease pixels (h below 60 % of
  // the depth) form connected lines; pits would be small compact blobs. Share of crease
  // pixels in components smaller than half a crease cell across must stay tiny.
  for (let s = 0; s < DETAIL_SCALES.length; s++) {
    const cell = 1 / DETAIL_SCALES[s][0];
    const step = cell / 16, W = 400;
    let crease = 0, small = 0, comps = 0, smallComps = 0;
    for (let plane = 0; plane < 4; plane++) {
      const o = [next() * 1000, next() * 200, next() * 1000];
      const m = new Uint8Array(W * W);
      for (let v = 0; v < W; v++)
        for (let u = 0; u < W; u++) {
          const p = plane % 2 === 0 ? [o[0] + u * step, o[1], o[2] + v * step] : [o[0] + u * step, o[1] + v * step, o[2]];
          if (creaseHeightJS(p, s) < -0.6 * DETAIL_SCALES[s][1]) m[v * W + u] = 1;
        }
      const seen = new Uint8Array(W * W);
      const st: number[] = [];
      for (let q = 0; q < W * W; q++) {
        if (!m[q] || seen[q]) continue;
        let cnt = 0, u0 = W, u1 = 0, v0 = W, v1 = 0, edge = false;
        seen[q] = 1;
        st.push(q);
        while (st.length) {
          const c = st.pop()!;
          const u = c % W, v = (c - u) / W;
          cnt++;
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
          if (u === 0 || v === 0 || u === W - 1 || v === W - 1) edge = true;
          for (const d of [-1, 1, -W, W]) {
            const nq = c + d;
            if (nq < 0 || nq >= W * W || (d === -1 && u === 0) || (d === 1 && u === W - 1)) continue;
            if (m[nq] && !seen[nq]) { seen[nq] = 1; st.push(nq); }
          }
        }
        crease += cnt;
        comps++;
        if (!edge && Math.max(u1 - u0, v1 - v0) * step < 0.5 * cell) { small += cnt; smallComps++; }
      }
    }
    check(crease > 0 && small / crease < 0.03, `scale ${s} creases are lines, not pits`, `${((100 * small) / Math.max(1, crease)).toFixed(2)}% of crease pixels in blobs < ½ cell (${smallComps} of ${comps} components)`);
  }
  // no tiling: correlation of the tangential perturbation at p and p + T
  const periods = [1, 2, 3.14159, 5.5, 8, 16, 17, 32, 53.4, 64, 100, 128, 256, 512];
  let worst = 0, worstT = 0;
  for (const T of periods) {
    for (const axis of [0, 1, 2]) {
      let sab = 0, saa = 0, sbb = 0;
      for (let q = 0; q < 4000; q++) {
        const n = [0, 1, 0];
        const p = [(next() - 0.5) * 3000, (next() - 0.5) * 200, (next() - 0.5) * 3000];
        const p2 = [...p];
        p2[axis] += T;
        const a = detailNormalJS(n, p, 0.004, 1), b = detailNormalJS(n, p2, 0.004, 1);
        sab += a[0] * b[0] + a[2] * b[2];
        saa += a[0] * a[0] + a[2] * a[2];
        sbb += b[0] * b[0] + b[2] * b[2];
      }
      const r = Math.abs(sab / Math.sqrt(saa * sbb));
      if (r > worst) { worst = r; worstT = T; }
    }
  }
  check(worst < 0.12, "no tiling (perturbation uncorrelated across candidate periods, 3 axes)", `max |r| ${worst.toFixed(3)} at T = ${worstT}`);
  // anti-aliasing fade, low spec
  const n = [0, 1, 0];
  let farMax = 0, lowDiff = 0;
  for (let q = 0; q < 2000; q++) {
    const p = [next() * 500, next() * 50, next() * 500];
    farMax = Math.max(farMax, angle(n, detailNormalJS(n, p, 0.25, 1)));
    const hi = detailNormalJS(n, p, 0.1, 1), lo = detailNormalJS(n, p, 0.1, 1, true);
    lowDiff = Math.max(lowDiff, angle(hi, lo));
  }
  check(farMax === 0, "both scales off at a coarse pixel footprint (no sub-pixel creases)", `max tilt ${farMax} at 0.25 u/px`);
  check(lowDiff < 1e-6, "fine scale already faded at 0.1 u/px; low spec = coarse scale only", `max Δ ${lowDiff.toExponential(2)} rad`);
  // facet gate
  check(facetWJS(0.8, 5, 1) === 0 && facetWJS(0.99, 60, 1) === 0 && facetWJS(0.99, 5, 0) === 0 && facetWJS(0.99, 5, 1) > 0.19,
    "facet blend only where the facet agrees with the smooth normal, near, on rock",
    `w(agree 0.8) ${facetWJS(0.8, 5, 1)}, w(60 u) ${facetWJS(0.99, 60, 1)}, w(sand) ${facetWJS(0.99, 5, 0)}, w(rock, near) ${facetWJS(0.99, 5, 1).toFixed(2)}`);
}

(async () => {
  console.log("detail normal");
  await compileChecks();
  statsChecks();
  if (failed) {
    console.log(`${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log("all detail checks passed");
})();
