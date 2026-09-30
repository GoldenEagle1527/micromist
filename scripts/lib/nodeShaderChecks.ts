/**
 * test:shaders — the node / cache program (scene/expedition/nodeMaterial.ts +
 * nodeShader.ts) exactly as three builds it for the dive's lights (hemisphere,
 * sun, head-lamp spot), desktop (5 sonar slots) and phone (3), highp and
 * mediump: one program, ASCII, no samplers, explicit array precision, WebGL2
 * minimum varyings / attributes / uniform vectors, glslang ES, and its own
 * Mali-G57 budget (NODE_MALI_BUDGET, measured Sep 2026: longest arith 15.75 /
 * LS 5 / tex 0, highp desktop, 5 pulses; MeshPhongMaterial, so no BRDF LUT).
 * Nodes cover a few hundred pixels; the budget keeps them far below the seabed's.
 */
import * as THREE from "three";
import { createFogUniforms } from "../../src/games/deep-march/scene/fog";
import { createBeamUniforms } from "../../src/games/deep-march/scene/highBeam";
import { createWaterUniforms } from "../../src/games/deep-march/scene/seabedMaterial";
import { SonarPulses, createSonarUniforms } from "../../src/games/deep-march/scene/sonar";
import { createNodeMaterial } from "../../src/games/deep-march/scene/expedition/nodeMaterial";
import { NodeInstances } from "../../src/games/deep-march/scene/expedition/nodeInstances";
import { NODE_EMISSIVE, NODE_FRAG_DECLS, NODE_NORMAL, NODE_OPAQUE, NODE_VERT_BEGIN, NODE_VERT_DECLS, NODE_VERT_MAIN } from "../../src/games/deep-march/scene/expedition/nodeShader";
import { arrayPrecisionIssues, esForGlslang, preprocess, samplerUniforms, uniformVectors } from "./glsl-es";
import { budgetIssues, findMalioc, fmtMalioc, maliocFragment, type MaliBudget } from "./malioc";
import { capturePrograms } from "./three-capture";

/** No textures; lights + a 5-pulse loop. Measured at M4: see the test output. */
export const NODE_MALI_BUDGET: MaliBudget & { longestArith: number } = { stack: 0, longestLS: 8, longestTex: 0, longestArith: 20 };

type Check = (ok: boolean, name: string, detail: string) => void;
type Compile = (name: string, src: string, stage: "vertex" | "fragment") => void;

function nodeScene(pulses: number) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
  const spot = new THREE.SpotLight();
  camera.add(spot, spot.target);
  scene.add(camera);
  const mat = createNodeMaterial({
    water: createWaterUniforms(new THREE.Color(0.1, 0.2, 0.3), 500),
    fog: createFogUniforms(),
    sonar: createSonarUniforms(new SonarPulses(pulses)),
    beam: createBeamUniforms(),
    absorb: new THREE.Vector3(0.06, 0.024, 0.014),
  });
  const inst = new NodeInstances(mat.material, 150);
  inst.mesh.count = 1;
  scene.add(inst.mesh);
  return { scene, camera, dispose: () => (inst.dispose(), mat.dispose()) };
}

export function nodePrograms(check: Check, compile: Compile): void {
  const blocks = { NODE_VERT_DECLS, NODE_VERT_BEGIN, NODE_VERT_MAIN, NODE_FRAG_DECLS, NODE_NORMAL, NODE_EMISSIVE, NODE_OPAQUE };
  for (const [name, src] of Object.entries(blocks)) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const bin = findMalioc();
  for (const [device, pulses] of [["desktop", 5], ["phone", 3]] as const)
    for (const highp of [true, false]) {
      const t = `[nodes, ${device}, ${highp ? "highp" : "mediump"}]`;
      const s = nodeScene(pulses);
      const progs = capturePrograms(s.scene, s.camera, { highp });
      s.dispose();
      check(progs.length === 1 && /#define DM_SONAR_N/.test(progs[0]?.fragment ?? ""), `three builds one node program ${t}`, `${progs.length}`);
      const p = progs[0];
      if (!p) continue;
      check(!/[^\x00-\x7f]/.test(p.vertex + p.fragment), `sources are pure ASCII ${t}`, "");
      check(/#define USE_INSTANCING/.test(p.vertex), `instanced program ${t}`, "");
      const fs = samplerUniforms(p.fragment), vs = samplerUniforms(p.vertex);
      check(fs.count === 0 && vs.count === 0, `no texture fetches ${t}`, [...fs.names, ...vs.names].join(", ") || "none");
      const pv = preprocess(p.vertex);
      const vary = [...pv.matchAll(/^\s*(?:flat\s+)?varying\s+(?:\w+\s+)?(\w+)\s+\w+/gm)].length;
      const attrs = [...pv.matchAll(/^\s*attribute\s+/gm)].length;
      check(vary <= 15 && attrs <= 16, `varyings / attributes within the WebGL2 minimum ${t}`, `${vary} varyings, ${attrs} attributes`);
      const fu = uniformVectors(p.fragment);
      check(fu.packed <= 224 - 16, `fragment uniform vectors ${t}`, `${fu.packed} packed`);
      for (const [stage, src] of [["vertex", p.vertex], ["fragment", p.fragment]] as const) {
        const ctor = arrayPrecisionIssues(preprocess(src), { constructorsOnly: true });
        check(ctor.length === 0, `no array constructors in the ${stage} program ${t}`, ctor.join(" | ") || "none");
        compile(`exact three ${stage} ES ${t}`, esForGlslang(src, stage), stage);
      }
      if (!bin) continue;
      try {
        const st = maliocFragment(bin, p.fragment);
        const b = NODE_MALI_BUDGET;
        const issues = [...budgetIssues(st, b), ...(st.longest.arith > b.longestArith ? [`arith ${st.longest.arith} > ${b.longestArith}`] : [])];
        check(issues.length === 0, `Mali-G57 budget (stack <= ${b.stack} B, load/store <= ${b.longestLS}, texture <= ${b.longestTex}, arith <= ${b.longestArith}) ${t}`, issues.length ? `${issues.join("; ")} | ${fmtMalioc(st)}` : fmtMalioc(st));
      } catch (e) {
        check(false, `malioc compiles the node fragment ${t}`, String(e).slice(0, 400));
      }
    }
}
