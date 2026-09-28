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
 *    on (local arrays, dynamic vector indexing, loops), for every seabed shader mode
 *    (full / simple / lite / flat): texture units (≤ 16 fragment, 32 combined), no
 *    dynamic sampler indexing, ASCII only, no #extension, the real GLSL ES 3.00
 *    front end (glslangValidator, when installed), and a fetch-site budget for the
 *    phone modes (the lite path must stay below the pre-library 4-set shader).
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
import * as THREE from "three";
import { capturePrograms } from "./lib/three-capture";
import { dynamicSamplerIndexing, esForGlslang, inlinedFetchSites, preprocess, samplerUniforms, uniformVectors } from "./lib/glsl-es";
import { SEABED_MODES, createSeabedMaterial, createWaterUniforms, type SeabedShaderMode } from "../src/games/deep-march/scene/seabedMaterial";
import { shaderModeOf } from "../src/games/deep-march/scene/gpuDiagnostics";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
function seabedScene(lowSpec: boolean, mode: SeabedShaderMode) {
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
  const defaultMode = sb.mode();
  const fade = sb.fadeMaterial().material;
  sb.setMode(mode); // after the fade material exists: exercises the runtime switch
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
  scene.add(new THREE.Mesh(geo, sb.material), new THREE.Mesh(geo, fade));
  return { scene, camera, sb, defaultMode };
}

// WebGL2 minimums (a phone may have exactly these)
const MIN_FRAGMENT_UNIFORM_VECTORS = 224;
const MIN_VERTEX_UNIFORM_VECTORS = 256;
const MIN_VARYING_VECTORS = 15;
const MIN_VERTEX_ATTRIBS = 16;
const MIN_TEXTURE_IMAGE_UNITS = 16;
const MIN_VERTEX_TEXTURE_IMAGE_UNITS = 16;
const MIN_COMBINED_TEXTURE_IMAGE_UNITS = 32;
/**
 * Texture fetch sites of main() after inlining, phone modes. The 4-set seabed that
 * phones rendered before the material library had 17-23; "simple" has 61 and
 * failed on a phone ("Fragment shader is not compiled", empty driver log).
 */
const PHONE_FETCH_BUDGET = 16;

type Compile = (name: string, src: string, stage: "vertex" | "fragment") => void;

/** Real GLSL ES 3.00 front end (glslangValidator, if installed): the exact three strings. */
function es300(name: string, src: string, stage: "vert" | "frag") {
  const probe = spawnSync("glslangValidator", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.log(`  SKIP ${name}: glslangValidator not installed`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "dm-es300-"));
  const file = join(dir, `s.${stage}`);
  // glslang knows an AMD built-in named average(); three's common chunk declares one
  writeFileSync(file, src.replace(/\baverage\b/g, "average_"));
  const r = spawnSync("glslangValidator", [file], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  check(r.status === 0, name, r.status === 0 ? "#version 300 es accepted" : (r.stdout + r.stderr).trim().slice(0, 400));
}

function exactPrograms(compile: Compile) {
  const cases: { name: string; lowSpec: boolean; mode: SeabedShaderMode; phone: boolean }[] = [
    { name: "desktop full", lowSpec: false, mode: "full", phone: false },
    { name: "desktop simple", lowSpec: false, mode: "simple", phone: false },
    { name: "desktop lite", lowSpec: false, mode: "lite", phone: false },
    { name: "desktop flat", lowSpec: false, mode: "flat", phone: false },
    { name: "phone simple (?seabed=simple)", lowSpec: true, mode: "simple", phone: false },
    { name: "phone lite", lowSpec: true, mode: "lite", phone: true },
    { name: "phone flat", lowSpec: true, mode: "flat", phone: true },
  ];
  {
    check(seabedScene(true, "lite").defaultMode === "lite", "phones start in lite mode", "");
    check(seabedScene(false, "full").defaultMode === "full", "desktop starts in full mode", "");
    const { sb } = seabedScene(false, "full");
    const chain = [sb.mode()];
    for (let m = sb.degrade(); m; m = sb.degrade()) chain.push(m);
    check(chain.join(">") === SEABED_MODES.join(">") && sb.degrade() === null, "fallback chain", chain.join(" > "));
  }
  for (const c of cases) for (const highp of [true, false]) {
    const { scene, camera, sb } = seabedScene(c.lowSpec, c.mode);
    const progs = capturePrograms(scene, camera, { highp });
    const tag = `${c.name}, ${highp ? "highp" : "mediump"}`;
    check(progs.length === 2 && progs.every((p) => /#define DM_SONAR_N/.test(p.fragment)) && sb.mode() === c.mode, `three builds base + fade seabed programs [${tag}]`, `${progs.length} programs`);
    check(progs.every((p) => shaderModeOf(p.fragment) === c.mode), `mode define in the program [${tag}]`, progs.map((p) => shaderModeOf(p.fragment)).join(", "));
    progs.forEach((p, i) => {
      const kind = i === 0 ? "base" : "fade";
      const t = `[${tag}, ${kind}]`;
      check(p.fragment.startsWith("#version 300 es") && /precision (highp|mediump) sampler2DArray;/.test(p.fragment), `three declares sampler2DArray precision ${t}`, (/precision \w+ sampler2DArray;/.exec(p.fragment) ?? ["missing"])[0]);
      check(!highp === /precision mediump float;/.test(p.fragment), `default float precision follows the device ${t}`, (/precision \w+ float;/.exec(p.fragment) ?? ["?"])[0]);
      check(!/[^\x00-\x7f]/.test(p.vertex + p.fragment), `sources are pure ASCII ${t}`, "");
      check(!/^\s*#\s*extension\b/m.test(preprocess(p.fragment)), `no #extension directives ${t}`, "");
      compile(`exact three vertex ES ${t}`, esForGlslang(p.vertex, "vertex"), "vertex");
      compile(`exact three fragment ES ${t}`, esForGlslang(p.fragment, "fragment"), "fragment");
      if (highp || c.phone) {
        es300(`exact three vertex, glslangValidator ES 300 ${t}`, p.vertex, "vert");
        es300(`exact three fragment, glslangValidator ES 300 ${t}`, p.fragment, "frag");
      }
      const fu = uniformVectors(p.fragment), vu = uniformVectors(p.vertex);
      check(fu.packed <= MIN_FRAGMENT_UNIFORM_VECTORS - 16 && fu.rows <= MIN_FRAGMENT_UNIFORM_VECTORS, `fragment uniform vectors ${t}`, `${fu.packed} packed, ${fu.rows} unpacked (every declaration its own rows) ≤ ${MIN_FRAGMENT_UNIFORM_VECTORS}`);
      check(vu.packed <= MIN_VERTEX_UNIFORM_VECTORS - 16, `vertex uniform vectors ${t}`, `${vu.packed} packed`);
      const fs = samplerUniforms(p.fragment), vs = samplerUniforms(p.vertex);
      check(fs.count <= MIN_TEXTURE_IMAGE_UNITS && vs.count <= MIN_VERTEX_TEXTURE_IMAGE_UNITS && fs.count + vs.count <= MIN_COMBINED_TEXTURE_IMAGE_UNITS, `texture image units ${t}`, `fragment ${fs.count} (${fs.names.join(", ")}) ≤ ${MIN_TEXTURE_IMAGE_UNITS}, vertex ${vs.count}, combined ${fs.count + vs.count} ≤ ${MIN_COMBINED_TEXTURE_IMAGE_UNITS}`);
      const dyn = [...dynamicSamplerIndexing(p.fragment), ...dynamicSamplerIndexing(p.vertex)];
      check(dyn.length === 0, `no dynamic sampler-array indexing ${t}`, dyn.join(" ") || "none");
      const pv = preprocess(p.vertex);
      const vary = [...pv.matchAll(/^\s*(?:flat\s+)?varying\s+(?:\w+\s+)?(\w+)\s+\w+/gm)].map((m) => (m[1] === "mat3" ? 3 : m[1] === "mat4" ? 4 : 1)).reduce((a, b) => a + b, 0);
      const attrs = [...pv.matchAll(/^\s*attribute\s+/gm)].length;
      check(vary <= MIN_VARYING_VECTORS && attrs <= MIN_VERTEX_ATTRIBS, `varyings / attributes ${t}`, `${vary} varyings, ${attrs} attributes`);
      // constructs mobile GLSL compilers are known to fail or miscompile
      const pf = preprocess(p.fragment);
      check(!/\bbool\s+\w+\s*\[/.test(pf), `no bool arrays ${t}`, "");
      check(!/\buPalC?\s*\[[^\]]+\]\s*\[/.test(pf), `no dynamic vector component indexing of palettes ${t}`, "");
      const sites = inlinedFetchSites(p.fragment);
      if (c.phone) check(sites <= PHONE_FETCH_BUDGET, `phone mode: texture fetch sites after inlining ${t}`, `${sites} ≤ ${PHONE_FETCH_BUDGET}`);
      else console.log(`  INFO texture fetch sites after inlining ${t}: ${sites}`);
      if (c.mode === "flat") {
        check(fs.names.every((n) => !/^tMat/.test(n)), `flat mode samples no material textures ${t}`, fs.names.join(", "));
        check(!/\[\s*[a-zA-Z_]\w*\s*\]/.test(pf.slice(pf.indexOf("---- surface weights"), pf.indexOf("vec3 albedo ="))) && pf.includes("---- flat tones"), `flat mode: constant indices only ${t}`, "");
      }
      if (c.mode !== "full") {
        const a = pf.indexOf("---- surface weights"), b = pf.lastIndexOf("vec3 albedo =");
        const body = a >= 0 && b > a ? pf.slice(a, b) : "";
        const localArrays = [...body.matchAll(/^\s*(?:int|float|vec\d|ivec\d)\s+\w+\s*\[[^\]]*\]\s*(?:;|=)/gm)].map((m) => m[0].trim());
        check(body !== "" && localArrays.every((d) => /float slotW\[5\] =/.test(d)), `${c.mode} material path: only the initialized constant-read slot array ${t}`, localArrays.join(" | ") || "none");
        check(!/\bfor\s*\(|\bwhile\s*\(/.test(body), `${c.mode} material path: no loops ${t}`, "");
        check(!/slotW\s*\[\s*[^\d\s]/.test(body), `${c.mode} material path: slot weights read with constant indices only ${t}`, "");
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
  const MODE_DEF: Record<string, string[]> = { full: [], simple: ["DM_SIMPLE_MAT"], lite: ["DM_LITE_MAT"], flat: ["DM_FLAT_MAT"] };
  for (const detail of [true, false]) for (const low of [false, true]) for (const mode of ["full", "simple", "lite", "flat"]) for (const fade of [false, true]) {
    if (low && mode === "full") continue;
    variants.push([...(detail ? ["DM_DETAIL"] : []), ...(low ? ["DM_LOW_SPEC"] : []), ...MODE_DEF[mode], ...(fade ? ["DM_LOD_FADE"] : []), `DM_SONAR_N ${low ? 3 : 5}`]);
  }
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
