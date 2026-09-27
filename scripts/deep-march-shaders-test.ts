/**
 * glslang compile check of every deep-march shader variant (code check only):
 *  - seabed terrain fragment: the full chain the material patches into three's
 *    MeshStandardMaterial (map / emissive / lights_end / opaque / dithering blocks),
 *    three's built-ins stubbed, for detail on/off × desktop/low spec × LOD fade on/off;
 *  - seabed terrain vertex region-weight patch (materialShader.ts): compiles, its
 *    varyings match the fragment's, its attributes are the ones chunks.ts binds;
 *  - background dome (water + turbidity);
 *  - plankton sprites (vertex + fragment);
 *  - the EXACT seabed programs three r186 sends to the driver (captured from a real
 *    WebGLRenderer on a mock WebGL2 context: three's prefix, precision, light setup,
 *    our onBeforeCompile patches) for desktop / phone / fallback × highp / mediump,
 *    compiled under GLSL ES rules, checked against the WebGL2 minimum limits, and the
 *    phone / fallback material path linted for the constructs mobile compilers fail
 *    on (local arrays, dynamic vector indexing, loops).
 * Run: npm run test:shaders
 */
import glslangInit from "@webgpu/glslang/dist/node-devel/glslang.js";
import { DECLS, DITHER_FRAGMENT, EMISSIVE_FRAGMENT, LIGHTS_END_FRAGMENT, MAP_FRAGMENT, OPAQUE_FRAGMENT, WATER_GLSL } from "../src/games/deep-march/scene/seabedShader";
import { DETAIL_GLSL } from "../src/games/deep-march/scene/detailNormal";
import { FOG_GLSL } from "../src/games/deep-march/scene/fog";
import { BEAM_DECLS } from "../src/games/deep-march/scene/highBeam";
import { PL_DECLS } from "../src/games/deep-march/scene/particleLight";
import { SONAR_DECLS } from "../src/games/deep-march/scene/sonar";
import { SNOW_FRAG, SNOW_VERT } from "../src/games/deep-march/scene/particles";
import { MAT_DECLS, MAT_VERT_DECLS, MAT_VERT_MAIN } from "../src/games/deep-march/scene/materialShader";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { capturePrograms } from "./lib/three-capture";
import { esForGlslang, preprocess, uniformVectors } from "./lib/glsl-es";
import { createSeabedMaterial, createWaterUniforms } from "../src/games/deep-march/scene/seabedMaterial";
import { createMaterialUniforms } from "../src/games/deep-march/scene/materialUniforms";
import { createFogUniforms } from "../src/games/deep-march/scene/fog";
import { SonarPulses, createSonarUniforms } from "../src/games/deep-march/scene/sonar";
import { createBeamUniforms } from "../src/games/deep-march/scene/highBeam";
import { createParticleLightUniforms } from "../src/games/deep-march/scene/particleLight";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

/** WebGL GLSL → Vulkan GLSL 450 enough for glslang: plain uniforms become globals, samplers get bindings. */
function vulkanize(src: string, stage: "vertex" | "fragment", st: { binding: number; inLoc: number; outLoc: number }): string {
  return src
    .replace(/#include <[^>]+>/g, "")
    .replace(/uniform (sampler2D|sampler2DArray) (\w+);/g, (_, t, n) => `layout(set = 0, binding = ${st.binding++}) uniform ${t} ${n};`)
    .replace(/uniform (float|int|vec2|vec3|vec4|mat3|mat4) (\w+(?:\[\w+\])?);/g, "$1 $2;")
    .replace(/attribute (\w+) (\w+);/g, (_, t, n) => `layout(location = ${st.inLoc++}) in ${t} ${n};`)
    .replace(/varying (\w+) (\w+);/g, (_, t, n) => (stage === "vertex" ? `layout(location = ${st.outLoc++}) out ${t} ${n};` : `layout(location = ${st.inLoc++}) in ${t} ${n};`))
    .replace(/gl_FragColor/g, "outColor")
    .replace(/texture2D\(/g, "texture(");
}

function seabedSource(defines: string[]): string {
  const st = { binding: 0, inLoc: 0, outLoc: 0 };
  const decls = DECLS + DETAIL_GLSL + WATER_GLSL + FOG_GLSL + SONAR_DECLS + BEAM_DECLS + PL_DECLS;
  return [
    "#version 450",
    ...defines.map((d) => `#define ${d}`),
    "vec3 cameraPosition; mat4 viewMatrix; vec2 uLodFade;",
    "struct ReflectedLight { vec3 directDiffuse; vec3 directSpecular; vec3 indirectDiffuse; vec3 indirectSpecular; };",
    vulkanize(decls, "fragment", st),
    "layout(location = 0) out vec4 outColor;",
    "void main() {",
    "  vec4 diffuseColor = vec4(1.0); vec3 totalEmissiveRadiance = vec3(0.0); vec3 normal = vec3(0.0, 1.0, 0.0);",
    "  ReflectedLight reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));",
    vulkanize(MAP_FRAGMENT, "fragment", st),
    "  float roughnessFactor = clamp(mix(0.55, 1.0, dmRough), 0.3, 1.0);",
    "  normal = normalize((viewMatrix * vec4(dmWorldNormal, 0.0)).xyz);",
    vulkanize(EMISSIVE_FRAGMENT, "fragment", st),
    vulkanize(LIGHTS_END_FRAGMENT, "fragment", st),
    "  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
    vulkanize(OPAQUE_FRAGMENT, "fragment", st),
    "  outColor = vec4(outgoingLight, 1.0);",
    vulkanize(DITHER_FRAGMENT, "fragment", st),
    "}",
  ].join("\n");
}

function seabedVertexSource(): string {
  const st = { binding: 0, inLoc: 3, outLoc: 0 };
  return ["#version 450", "mat4 modelMatrix; mat4 viewMatrix; mat4 projectionMatrix;",
    "layout(location = 0) in vec3 position;", "layout(location = 1) in vec3 normal;", "layout(location = 2) in float ao;",
    vulkanize(MAT_VERT_DECLS, "vertex", st), "layout(location = 15) out float vAO;",
    "void main() {", "  vAO = ao;", MAT_VERT_MAIN, "  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);", "}"].join("\n");
}

function domeSource(): string {
  const st = { binding: 0, inLoc: 0, outLoc: 0 };
  return ["#version 450", vulkanize(WATER_GLSL + FOG_GLSL, "fragment", st), "layout(location = 0) in vec3 vDir;", "layout(location = 0) out vec4 outColor;",
    "void main() { outColor = vec4(dmBackground(normalize(vDir)), 1.0); }"].join("\n");
}

function snowSources(): [string, string] {
  const sv = { binding: 0, inLoc: 1, outLoc: 0 };
  const vert = ["#version 450", "mat4 modelViewMatrix; mat4 projectionMatrix;", "layout(location = 0) in vec3 position;", vulkanize(SNOW_VERT, "vertex", sv)].join("\n");
  const sf = { binding: 0, inLoc: 0, outLoc: 0 };
  const frag = ["#version 450", "layout(location = 0) out vec4 outColor;", vulkanize(SNOW_FRAG, "fragment", sf)].join("\n");
  return [vert, frag];
}

/** Seabed scene as world.ts builds it: hemisphere + sun + camera spot lamp, base + LOD fade meshes. */
function seabedScene(lowSpec: boolean, simple: boolean) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
  const spot = new THREE.SpotLight();
  camera.add(spot, spot.target);
  scene.add(camera);
  const sb = createSeabedMaterial({
    lowSpec,
    water: createWaterUniforms(new THREE.Color(0.1, 0.2, 0.3), 500),
    worldScale: 4,
    fog: createFogUniforms(),
    sonar: createSonarUniforms(new SonarPulses(lowSpec ? 3 : 5)),
    beam: createBeamUniforms(),
    particleLights: createParticleLightUniforms(),
    materials: createMaterialUniforms(new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1)),
  });
  const fade = sb.fadeMaterial().material;
  if (simple) sb.useSimplePath();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
  scene.add(new THREE.Mesh(geo, sb.material), new THREE.Mesh(geo, fade));
  return { scene, camera, simple: sb.simple() };
}

// WebGL2 minimums (a phone may have exactly these)
const MIN_FRAGMENT_UNIFORM_VECTORS = 224;
const MIN_VERTEX_UNIFORM_VECTORS = 256;
const MIN_VARYING_VECTORS = 15;
const MIN_VERTEX_ATTRIBS = 16;

type Compile = (name: string, src: string, stage: "vertex" | "fragment") => void;

function exactPrograms(compile: Compile) {
  const cases = [
    { name: "desktop", lowSpec: false, simple: false },
    { name: "desktop fallback", lowSpec: false, simple: true },
    { name: "phone", lowSpec: true, simple: false },
  ];
  for (const c of cases) for (const highp of [true, false]) {
    const { scene, camera, simple } = seabedScene(c.lowSpec, c.simple);
    const progs = capturePrograms(scene, camera, { highp });
    const tag = `${c.name}, ${highp ? "highp" : "mediump"}`;
    check(progs.length === 2 && progs.every((p) => p.fragment.includes("dmSampleLayer")), `three builds base + fade seabed programs [${tag}]`, `${progs.length} programs`);
    check(simple === (c.lowSpec || c.simple), `material path [${tag}]`, simple ? "simple" : "full");
    progs.forEach((p, i) => {
      const kind = i === 0 ? "base" : "fade";
      check(p.fragment.startsWith("#version 300 es") && /precision (highp|mediump) sampler2DArray;/.test(p.fragment), `three declares sampler2DArray precision [${tag}, ${kind}]`, (/precision \w+ sampler2DArray;/.exec(p.fragment) ?? ["missing"])[0]);
      check(!highp === /precision mediump float;/.test(p.fragment), `default float precision follows the device [${tag}, ${kind}]`, (/precision \w+ float;/.exec(p.fragment) ?? ["?"])[0]);
      compile(`exact three vertex ES [${tag}, ${kind}]`, esForGlslang(p.vertex, "vertex"), "vertex");
      compile(`exact three fragment ES [${tag}, ${kind}]`, esForGlslang(p.fragment, "fragment"), "fragment");
      const fu = uniformVectors(p.fragment), vu = uniformVectors(p.vertex);
      check(fu.packed <= MIN_FRAGMENT_UNIFORM_VECTORS - 16, `fragment uniform vectors [${tag}, ${kind}]`, `${fu.packed} packed (${fu.rows} unpacked) ≤ ${MIN_FRAGMENT_UNIFORM_VECTORS} − 16 headroom`);
      check(vu.packed <= MIN_VERTEX_UNIFORM_VECTORS - 16, `vertex uniform vectors [${tag}, ${kind}]`, `${vu.packed} packed`);
      const pv = preprocess(p.vertex);
      const vary = [...pv.matchAll(/^\s*(?:flat\s+)?varying\s+(?:\w+\s+)?(\w+)\s+\w+/gm)].map((m) => (m[1] === "mat3" ? 3 : m[1] === "mat4" ? 4 : 1)).reduce((a, b) => a + b, 0);
      const attrs = [...pv.matchAll(/^\s*attribute\s+/gm)].length;
      check(vary <= MIN_VARYING_VECTORS && attrs <= MIN_VERTEX_ATTRIBS, `varyings / attributes [${tag}, ${kind}]`, `${vary} varyings, ${attrs} attributes`);
      // constructs mobile GLSL compilers are known to fail or miscompile
      const pf = preprocess(p.fragment);
      check(!/\bbool\s+\w+\s*\[/.test(pf), `no bool arrays [${tag}, ${kind}]`, "");
      check(!/\buPalC?\s*\[[^\]]+\]\s*\[/.test(pf), `no dynamic vector component indexing of palettes [${tag}, ${kind}]`, "");
      if (simple) {
        const a = pf.indexOf("---- surface weights"), b = pf.indexOf("vec3 albedo =");
        const body = a >= 0 && b > a ? pf.slice(a, b) : "";
        const localArrays = [...body.matchAll(/^\s*(?:int|float|vec\d|ivec\d)\s+\w+\s*\[[^\]]*\]\s*(?:;|=)/gm)].map((m) => m[0].trim());
        check(body !== "" && localArrays.every((d) => /float slotW\[5\] =/.test(d)), `simple material path: only the initialized constant-read slot array [${tag}, ${kind}]`, localArrays.join(" | ") || "none");
        check(!/\bfor\s*\(|\bwhile\s*\(/.test(body), `simple material path: no loops [${tag}, ${kind}]`, "");
        check(!/slotW\s*\[\s*[^\d\s]/.test(body), `simple material path: slot weights read with constant indices only [${tag}, ${kind}]`, "");
      }
    });
  }
}

(async () => {
  type G = { compileGLSL(src: string, stage: "vertex" | "fragment", debug: boolean): Uint32Array };
  // the emscripten module is a thenable resolving to itself: unwrap it by hand
  const glslang = await new Promise<G>((res) => (glslangInit() as unknown as { then(cb: (g: G & { then?: unknown }) => void): void }).then((g) => {
    delete g.then;
    res(g);
  }));
  const compile = (name: string, src: string, stage: "vertex" | "fragment") => {
    let err = "", words = 0;
    try {
      words = glslang.compileGLSL(src, stage, false).length;
    } catch (e) {
      err = String(e).slice(0, 400);
    }
    check(!err && words > 0, name, err || `${words} SPIR-V words`);
  };
  console.log("deep-march shaders (glslang)");
  const variants: string[][] = [];
  // desktop full path, desktop fallback (simple path), phone (always simple)
  for (const detail of [true, false]) for (const kind of ["full", "safe", "low"]) for (const fade of [false, true]) variants.push([...(detail ? ["DM_DETAIL"] : []), ...(kind === "low" ? ["DM_LOW_SPEC"] : []), ...(kind !== "full" ? ["DM_SIMPLE_MAT"] : []), ...(fade ? ["DM_LOD_FADE"] : []), `DM_SONAR_N ${kind === "low" ? 3 : 5}`]);
  for (const v of variants) compile(`seabed fragment [${v.join(" + ") || "base"}]`, seabedSource(v), "fragment");
  // GLSL ES rules (no implicit int→float etc., as WebGL2 enforces): the same chain as ES 3.1
  const es = (src: string) => src.replace("#version 450", "#version 310 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler2DArray;");
  for (const v of variants) compile(`seabed fragment ES [${v.join(" + ")}]`, es(seabedSource(v)), "fragment");
  compile("seabed vertex ES (region weights)", es(seabedVertexSource()), "vertex");
  compile("seabed vertex (region weights)", seabedVertexSource(), "vertex");
  {
    const vary = (src: string) => [...src.matchAll(/varying (\w+) (vReg\w*);/g)].map((m) => `${m[1]} ${m[2]}`).sort().join();
    check(vary(MAT_VERT_DECLS) === vary(MAT_DECLS) && vary(MAT_DECLS) !== "", "region varyings vertex = fragment", vary(MAT_VERT_DECLS));
    const attrs = [...MAT_VERT_DECLS.matchAll(/attribute \w+ (\w+);/g)].map((m) => m[1]);
    const chunks = readFileSync("src/games/deep-march/terrain/chunks.ts", "utf8");
    check(attrs.length === 2 && attrs.every((a) => chunks.includes(`setAttribute("${a}"`)), "region attributes bound by chunks.ts", attrs.join(", "));
  }
  exactPrograms(compile);
  compile("background dome fragment", domeSource(), "fragment");
  const [sv, sf] = snowSources();
  compile("plankton vertex", sv, "vertex");
  compile("plankton fragment", sf, "fragment");
  if (failed) {
    console.log(`${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log("all shader checks passed");
})();
