/**
 * glslang compile check of every deep-march shader variant (code check only):
 *  - seabed terrain fragment: the full chain the material patches into three's
 *    MeshStandardMaterial (map incl. LOD fade / emissive / lights_end / opaque blocks),
 *    three's built-ins stubbed, for detail on/off × desktop/low spec × LOD fade on/off;
 *  - seabed terrain vertex region-weight patch (materialShader.ts): compiles, its
 *    varyings match the fragment's, its attributes are the ones chunks.ts binds;
 *  - background dome (water + turbidity);
 *  - plankton sprites (vertex + fragment);
 *  - the EXACT seabed programs three r186 sends to the driver (captured from a real
 *    WebGLRenderer on a mock WebGL2 context: three's prefix, precision, light setup,
 *    our onBeforeCompile patches) for desktop / phone × highp / mediump: compiled
 *    under GLSL ES rules and by the real GLSL ES 3.00 front end (glslangValidator,
 *    when installed), checked against the WebGL2 minimum limits (uniform vectors,
 *    varyings, attributes, texture units ≤ 16 fragment / 32 combined), no dynamic
 *    sampler indexing, ASCII only, no #extension, injected code after the precision
 *    statements, and one material shader for phones and desktop;
 *  - array precision lint on every injected block and no array constructors in any
 *    captured program (Mali behind ANGLE: "S0032: no default precision defined for
 *    variable 'float[5]'");
 *  - Mali-G57 cost budget on every captured seabed fragment program (Mali Offline
 *    Compiler, scripts/lib/malioc.ts; skipped with a warning when not installed):
 *    stack, longest-path load/store and texture cycles, and the LOD fade and tide
 *    front programs discarding before any shading (the tide-front variant, M7, is
 *    the third seabed program; base and fade programs don't carry it);
 *  - the ring wall's far proxy ring (wallRing.ts / wallRingShader.ts): the exact
 *    programs three builds (highp / mediump), glslang + glslangValidator ES 300,
 *    array precision, no samplers, and its own Mali-G57 budget (RING_MALI_BUDGET);
 *  - the resource-node / lost-cache program (M4, lib/nodeShaderChecks.ts): one
 *    instanced program, no samplers, WebGL2 minimums, its own Mali-G57 budget;
 *  - the base's programs (M5, lib/baseShaderChecks.ts): buildings (one instanced
 *    program for all kinds), lighthouse beams, placement hologram; same checks,
 *    their own Mali-G57 budgets. The seabed budget above includes the lighthouse light;
 *  - the tide's programs (M7, lib/tideShaderChecks.ts): the dome and the particle
 *    currents; same checks, their own Mali-G57 budgets.
 * Run: npm run test:shaders
 */
import glslangInit from "@webgpu/glslang/dist/node-devel/glslang.js";
import { DECLS, EMISSIVE_FRAGMENT, LOD_FADE_FRAGMENT, LIGHTS_END_FRAGMENT, MAP_FRAGMENT, OPAQUE_FRAGMENT, WATER_GLSL } from "../src/games/deep-march/scene/seabedShader";
import { DETAIL_GLSL } from "../src/games/deep-march/scene/detailNormal";
import { FOG_GLSL } from "../src/games/deep-march/scene/fog";
import { BEAM_DECLS } from "../src/games/deep-march/scene/highBeam";
import { PL_DECLS } from "../src/games/deep-march/scene/particleLight";
import { BL_DECLS, BL_LIGHT } from "../src/games/deep-march/scene/base/baseLightShader";
import { createBaseLightUniforms } from "../src/games/deep-march/scene/base/baseLight";
import { SONAR_DECLS } from "../src/games/deep-march/scene/sonar";
import { SNOW_FRAG, SNOW_VERT } from "../src/games/deep-march/scene/particles";
import { MAT_DECLS, MAT_FRAGMENT, MAT_VERT_DECLS, MAT_VERT_MAIN } from "../src/games/deep-march/scene/materialShader";
import { DETAIL_APPLY } from "../src/games/deep-march/scene/detailNormal";
import { FOG_OPAQUE } from "../src/games/deep-march/scene/fog";
import { BEAM_LIGHT, BEAM_OPAQUE } from "../src/games/deep-march/scene/highBeam";
import { PL_LIGHT } from "../src/games/deep-march/scene/particleLight";
import { SONAR_OPAQUE } from "../src/games/deep-march/scene/sonar";
import * as THREE from "three";
import { capturePrograms } from "./lib/three-capture";
import { MALIOC_INSTALL, SEABED_MALI_BUDGET, budgetIssues, findMalioc, fmtMalioc, maliocFragment, type MaliocStats } from "./lib/malioc";
import { arrayPrecisionIssues, dynamicSamplerIndexing, esForGlslang, preprocess, samplerUniforms, uniformVectors } from "./lib/glsl-es";
import { createSeabedMaterial, createWaterUniforms } from "../src/games/deep-march/scene/seabedMaterial";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialUniforms } from "../src/games/deep-march/scene/materialUniforms";
import { createFogUniforms } from "../src/games/deep-march/scene/fog";
import { SonarPulses, createSonarUniforms } from "../src/games/deep-march/scene/sonar";
import { createBeamUniforms } from "../src/games/deep-march/scene/highBeam";
import { createParticleLightUniforms } from "../src/games/deep-march/scene/particleLight";
import { RING_FRAG, RING_VERT } from "../src/games/deep-march/scene/wallRingShader";
import { createWallRing } from "../src/games/deep-march/scene/wallRing";
import { createLongPulses } from "../src/games/deep-march/scene/sonarLong";
import { createDensityField } from "../src/games/deep-march/terrain/density";
import { TERRAIN } from "../src/games/deep-march/terrain/config";
import { genesisLayout } from "./lib/worldFixture";
import { nodePrograms } from "./lib/nodeShaderChecks";
import { basePrograms } from "./lib/baseShaderChecks";
import { tidePrograms } from "./lib/tideShaderChecks";

/**
 * Far proxy ring on Mali-G57: no textures, a handful of pulses — a small fraction of
 * the seabed's budget (it covers a thin band of the screen, sonar mode only).
 */
const RING_MALI_BUDGET = { stack: 0, longestLS: 4, longestTex: 0, longestArith: 12 };

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

/** WebGL GLSL → Vulkan GLSL 450 enough for glslang: plain uniforms become globals, samplers get bindings. */
function vulkanize(src: string, stage: "vertex" | "fragment", st: { binding: number; inLoc: number; outLoc: number }): string {
  return src
    .replace(/#include <[^>]+>/g, "")
    .replace(/uniform ((?:highp |mediump |lowp |DM_M )?)(sampler2D|sampler2DArray) (\w+);/g, (_, q, t, n) => `layout(set = 0, binding = ${st.binding++}) uniform ${q}${t} ${n};`)
    .replace(/uniform ((?:highp |mediump |lowp |DM_P )?)(float|int|vec2|vec3|vec4|mat3|mat4) (\w+(?:\[[\w${}.* ]+\])?);/g, "$1$2 $3;")
    .replace(/attribute (\w+) (\w+);/g, (_, t, n) => `layout(location = ${st.inLoc++}) in ${t} ${n};`)
    .replace(/varying (\w+) (\w+);/g, (_, t, n) => (stage === "vertex" ? `layout(location = ${st.outLoc++}) out ${t} ${n};` : `layout(location = ${st.inLoc++}) in ${t} ${n};`))
    .replace(/gl_FragColor/g, "outColor")
    .replace(/texture2D\(/g, "texture(");
}

function seabedSource(defines: string[]): string {
  const st = { binding: 0, inLoc: 0, outLoc: 0 };
  const decls = DECLS + DETAIL_GLSL + WATER_GLSL + FOG_GLSL + SONAR_DECLS + BEAM_DECLS + PL_DECLS + BL_DECLS;
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

/** Seabed scene as world.ts builds it: hemisphere + sun + camera spot lamp, base + LOD fade + tide front meshes. */
function seabedScene(lowSpec: boolean) {
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
    baseLight: createBaseLightUniforms(),
    materials: createMaterialUniforms(new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1)),
  });
  const fade = sb.fadeMaterial().material;
  const tide = sb.tideMaterial().material;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
  scene.add(new THREE.Mesh(geo, sb.material), new THREE.Mesh(geo, fade), new THREE.Mesh(geo, tide));
  return { scene, camera };
}

// WebGL2 minimums (a phone may have exactly these)
const MIN_FRAGMENT_UNIFORM_VECTORS = 224;
const MIN_VERTEX_UNIFORM_VECTORS = 256;
const MIN_VARYING_VECTORS = 15;
const MIN_VERTEX_ATTRIBS = 16;
const MIN_TEXTURE_IMAGE_UNITS = 16;
const MIN_VERTEX_TEXTURE_IMAGE_UNITS = 16;
const MIN_COMBINED_TEXTURE_IMAGE_UNITS = 32;

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

/** Every GLSL block we inject: array types need explicit precision, no array constructors. */
function arrayLint() {
  const blocks: Record<string, string> = { DECLS, WATER_GLSL, DETAIL_GLSL, DETAIL_APPLY, FOG_GLSL, FOG_OPAQUE, SONAR_DECLS, SONAR_OPAQUE, BEAM_DECLS, BEAM_LIGHT, BEAM_OPAQUE, PL_LIGHT, BL_DECLS, BL_LIGHT, MAT_DECLS, MAT_FRAGMENT, MAT_VERT_DECLS, MAT_VERT_MAIN, MAP_FRAGMENT, EMISSIVE_FRAGMENT, LIGHTS_END_FRAGMENT, OPAQUE_FRAGMENT, LOD_FADE_FRAGMENT, SNOW_VERT, SNOW_FRAG };
  for (const [name, src] of Object.entries(blocks)) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  // particleLight.ts is frozen: its one global uniform array (after three's default
  // precision statement, present since before the material library) is reported only
  const pl = arrayPrecisionIssues(PL_DECLS);
  check(pl.every((i) => /uniform vec4 uPL\[/.test(i)), "PL_DECLS: nothing beyond the known uniform uPL[]", pl.join(" | ") || "clean");
  // the lint itself: the Mali-rejected line of 8435322..e68b454 must be caught
  const bad = arrayPrecisionIssues("  float slotW[5] = float[5](a, b, c, d, e);\nvoid f(in vec3 v[4]) {}\nint k[3];");
  check(bad.length === 4, "lint catches float[5](...) constructors and unqualified array declarations / parameters", bad.join(" | "));
}

function exactPrograms(compile: Compile) {
  const cases = [
    { name: "desktop", lowSpec: false },
    { name: "phone", lowSpec: true },
  ];
  // the region between these markers is the material code (materialShader.ts)
  const material = (frag: string) => {
    const pf = preprocess(frag);
    return pf.slice(pf.indexOf("---- surface weights"), pf.indexOf("tone the photo sets"));
  };
  const materialOf: Record<string, string> = {};
  const fragments: { tag: string; kind: string; fragment: string }[] = [];
  for (const c of cases) for (const highp of [true, false]) {
    const { scene, camera } = seabedScene(c.lowSpec);
    const progs = capturePrograms(scene, camera, { highp });
    const tag = `${c.name}, ${highp ? "highp" : "mediump"}`;
    check(progs.length === 3 && progs.every((p) => /#define DM_SONAR_N/.test(p.fragment)), `three builds base + fade + tide-front seabed programs [${tag}]`, `${progs.length} programs`);
    check(!/uTideFront/.test(progs[0].fragment) && !/uTideFront/.test(progs[1].fragment) && /#define DM_TIDE_FRONT/.test(progs[2].fragment), `only the tide program carries the front (base / fade unchanged) [${tag}]`, "");
    materialOf[tag] = material(progs[0].fragment);
    progs.forEach((p, i) => {
      const kind = ["base", "fade", "tide"][i];
      const t = `[${tag}, ${kind}]`;
      fragments.push({ tag, kind, fragment: p.fragment });
      check(p.fragment.startsWith("#version 300 es") && /precision (highp|mediump) sampler2DArray;/.test(p.fragment), `three declares sampler2DArray precision ${t}`, (/precision \w+ sampler2DArray;/.exec(p.fragment) ?? ["missing"])[0]);
      check(!highp === /precision mediump float;/.test(p.fragment), `default float precision follows the device ${t}`, (/precision \w+ float;/.exec(p.fragment) ?? ["?"])[0]);
      check(!/[^\x00-\x7f]/.test(p.vertex + p.fragment), `sources are pure ASCII ${t}`, "");
      check(!/^\s*#\s*extension\b/m.test(preprocess(p.fragment)), `no #extension directives ${t}`, "");
      for (const [stage, src] of [["vertex", p.vertex], ["fragment", p.fragment]] as const) {
        const pp = preprocess(src);
        const ctor = arrayPrecisionIssues(pp, { constructorsOnly: true });
        check(ctor.length === 0, `no array constructors (Mali S0032) in the ${stage} program ${t}`, ctor.join(" | ") || "none");
        const prec = pp.search(/^\s*precision\s+(highp|mediump)\s+float\s*;/m);
        const ours = pp.search(stage === "vertex" ? /\bvRegA\b/ : /\buWS\b/);
        check(prec >= 0 && ours > prec, `injected code after the float precision statement (${stage}) ${t}`, `precision at ${prec}, injected at ${ours}`);
      }
      compile(`exact three vertex ES ${t}`, esForGlslang(p.vertex, "vertex"), "vertex");
      compile(`exact three fragment ES ${t}`, esForGlslang(p.fragment, "fragment"), "fragment");
      if (highp || c.lowSpec) {
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
    });
  }
  // the ring wall's material slot reaches the shader (7th weight → palettes 12 / 13)
  check(fragments.every((f) => /dmTop2\(vRegB\.z, 6,/.test(preprocess(f.fragment))), "ring-wall weight (vRegB.z, material slot 6) enters the region top-2", "");
  const mats = Object.values(materialOf);
  check(mats[0].length > 1000 && mats.every((m) => m === mats[0]), "one material shader for phones and desktop", `${mats.length} programs, ${mats[0].length} chars`);
  maliBudget(fragments);
}

/**
 * Mali-G57 cost budget (scripts/lib/malioc.ts) on the exact programs: stack
 * (spills / local arrays), longest-path load/store and texture cycles; the LOD fade
 * program must discard before shading (its shortest path is the discard).
 */
function maliBudget(fragments: { tag: string; kind: string; fragment: string }[]) {
  const bin = findMalioc();
  if (!bin) {
    console.log(`  WARN malioc not found: Mali cost budget SKIPPED (${MALIOC_INSTALL})`);
    return;
  }
  const b = SEABED_MALI_BUDGET;
  for (const f of fragments) {
    const t = `[${f.tag}, ${f.kind}]`;
    let s: MaliocStats;
    try {
      s = maliocFragment(bin, f.fragment);
    } catch (e) {
      check(false, `malioc compiles the seabed fragment ${t}`, String(e).slice(0, 400));
      continue;
    }
    const issues = budgetIssues(s, b);
    check(issues.length === 0, `Mali-G57 budget (stack <= ${b.stack} B, load/store <= ${b.longestLS}, texture <= ${b.longestTex}) ${t}`, issues.length ? `${issues.join("; ")} | ${fmtMalioc(s)}` : fmtMalioc(s));
    // the tide front reads a varying + a vec4 before its discard: highp may add one load/store cycle
    const lsMax = f.kind === "tide" ? 1 : 0;
    if (f.kind !== "base") check(s.shortest.arith < 2 && s.shortest.ls <= lsMax && s.shortest.tex === 0, `${f.kind === "fade" ? "LOD fade" : "tide front"} discards before shading ${t}`, `shortest path A/LS/T ${s.shortest.arith}/${s.shortest.ls}/${s.shortest.tex}`);
  }
}

/** The wall ring as world.ts builds it (genesis wall), for both float precisions. */
function wallRingPrograms(compile: Compile) {
  const field = createDensityField(7, TERRAIN, undefined, genesisLayout(7));
  const long = createLongPulses();
  const ring = createWallRing(field, { water: createWaterUniforms(new THREE.Color(0, 0.1, 0.2), 420), fog: createFogUniforms(), sonar: createSonarUniforms(new SonarPulses(5)), long, far: 420 })!;
  check(!!ring && ring.triangles <= 2200, "wall ring built from the genesis wall", `${ring.triangles} triangles`);
  for (const [name, src] of Object.entries({ RING_VERT, RING_FRAG })) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const bin = findMalioc();
  for (const highp of [true, false]) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(ring.mesh);
    ring.mesh.visible = true;
    const progs = capturePrograms(scene, camera, { highp });
    const t = `[wall ring, ${highp ? "highp" : "mediump"}]`;
    check(progs.length === 1, `three builds one wall-ring program ${t}`, `${progs.length}`);
    const p = progs[0];
    check(!/[^\x00-\x7f]/.test(p.vertex + p.fragment), `sources are pure ASCII ${t}`, "");
    check(samplerUniforms(p.fragment).count === 0, `no texture fetches ${t}`, samplerUniforms(p.fragment).names.join(", ") || "none");
    compile(`exact three vertex ES ${t}`, esForGlslang(p.vertex, "vertex"), "vertex");
    compile(`exact three fragment ES ${t}`, esForGlslang(p.fragment, "fragment"), "fragment");
    es300(`exact three vertex, glslangValidator ES 300 ${t}`, p.vertex, "vert");
    es300(`exact three fragment, glslangValidator ES 300 ${t}`, p.fragment, "frag");
    if (!bin) continue;
    let st: MaliocStats;
    try {
      st = maliocFragment(bin, p.fragment);
    } catch (e) {
      check(false, `malioc compiles the wall-ring fragment ${t}`, String(e).slice(0, 400));
      continue;
    }
    const b = RING_MALI_BUDGET;
    const issues = [...budgetIssues(st, b), ...(st.longest.arith > b.longestArith ? [`arith ${st.longest.arith} > ${b.longestArith}`] : [])];
    check(issues.length === 0, `Mali-G57 budget (stack <= ${b.stack} B, load/store <= ${b.longestLS}, texture <= ${b.longestTex}, arith <= ${b.longestArith}) ${t}`, issues.length ? `${issues.join("; ")} | ${fmtMalioc(st)}` : fmtMalioc(st));
  }
  ring.dispose();
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
  for (const detail of [true, false]) for (const low of [false, true]) for (const fade of [false, true]) variants.push([...(detail ? ["DM_DETAIL"] : []), ...(low ? ["DM_LOW_SPEC"] : []), ...(fade ? ["DM_LOD_FADE"] : []), `DM_SONAR_N ${low ? 3 : 5}`]);
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
  arrayLint();
  exactPrograms(compile);
  wallRingPrograms(compile);
  nodePrograms(check, compile);
  basePrograms(check, compile);
  tidePrograms(check, compile);
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
