/**
 * glslang compile check of every deep-march shader variant (code check only):
 *  - seabed terrain fragment: the full chain the material patches into three's
 *    MeshStandardMaterial (map / emissive / lights_end / opaque / dithering blocks),
 *    three's built-ins stubbed, for detail on/off × desktop/low spec × LOD fade on/off;
 *  - background dome (water + turbidity);
 *  - plankton sprites (vertex + fragment).
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

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

/** WebGL GLSL → Vulkan GLSL 450 enough for glslang: plain uniforms become globals, samplers get bindings. */
function vulkanize(src: string, stage: "vertex" | "fragment", st: { binding: number; inLoc: number; outLoc: number }): string {
  return src
    .replace(/#include <[^>]+>/g, "")
    .replace(/uniform sampler2D (\w+);/g, (_, n) => `layout(set = 0, binding = ${st.binding++}) uniform sampler2D ${n};`)
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
