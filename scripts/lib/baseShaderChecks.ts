/**
 * test:shaders — the base's programs (M5, scene/base): the building program
 * (structureMaterial.ts, one instanced MeshPhong program for all four kinds,
 * with the terrain's water / fog / sonar / high beam and the lighthouse light),
 * the beam columns (beamColumn.ts) and the placement hologram + rings
 * (hologram.ts), exactly as three builds them for the dive's lights, desktop
 * (5 sonar slots) and phone (3), highp and mediump: ASCII, no samplers,
 * explicit array precision, WebGL2 minimums, glslang ES, and Mali-G57 budgets
 * (STRUCTURE_MALI_BUDGET / OVERLAY_MALI_BUDGET, measured Sep 2026, see the output).
 */
import * as THREE from "three";
import { createFogUniforms } from "../../src/games/deep-march/scene/fog";
import { createBeamUniforms } from "../../src/games/deep-march/scene/highBeam";
import { createWaterUniforms } from "../../src/games/deep-march/scene/seabedMaterial";
import { SonarPulses, createSonarUniforms } from "../../src/games/deep-march/scene/sonar";
import { createBaseLightUniforms } from "../../src/games/deep-march/scene/base/baseLight";
import { BL_DECLS, BL_LIGHT } from "../../src/games/deep-march/scene/base/baseLightShader";
import { BeamColumns } from "../../src/games/deep-march/scene/base/beamColumn";
import { BEAM_COLUMN_FRAG, BEAM_COLUMN_VERT } from "../../src/games/deep-march/scene/base/beamShader";
import { Hologram } from "../../src/games/deep-march/scene/base/hologram";
import { HOLO_FRAG, HOLO_VERT } from "../../src/games/deep-march/scene/base/hologramShader";
import { createStructureMaterial } from "../../src/games/deep-march/scene/base/structureMaterial";
import { StructureInstances } from "../../src/games/deep-march/scene/base/structureInstances";
import * as S from "../../src/games/deep-march/scene/base/structureShader";
import type { StructureKind } from "../../src/games/deep-march/conserve";
import { arrayPrecisionIssues, esForGlslang, preprocess, samplerUniforms, uniformVectors } from "./glsl-es";
import { budgetIssues, findMalioc, fmtMalioc, maliocFragment, type MaliBudget } from "./malioc";
import { capturePrograms, type CapturedProgram } from "./three-capture";

export type Budget = MaliBudget & { longestArith: number };
/**
 * Buildings: Phong + seams + sonar / beam / 2 lighthouse lights; no textures.
 * Measured Oct 2026 (longest A / LS / T): desktop highp 17.9 / 11 / 0, phone
 * highp 17 / 9 / 0, mediump 16.1 / 0 / 0 (the seabed: ~100 / ≤ 150 / ≤ 40). The
 * highp program fills all 128 fast uniform registers, so each extra uniform
 * costs load/store (the reactor's tint took it to 15): the static look is constants.
 */
export const STRUCTURE_MALI_BUDGET: Budget = { stack: 0, longestLS: 14, longestTex: 0, longestArith: 24 };
/** Beam columns, hologram, rings: additive, a few ALU ops (measured ≤ 2.1 / 0 / 0). */
export const OVERLAY_MALI_BUDGET: Budget = { stack: 0, longestLS: 2, longestTex: 0, longestArith: 4 };

export type Check = (ok: boolean, name: string, detail: string) => void;
export type Compile = (name: string, src: string, stage: "vertex" | "fragment") => void;
const KINDS: readonly StructureKind[] = ["core", "lighthouse", "energy", "storage"];

function rig() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
  const spot = new THREE.SpotLight();
  camera.add(spot, spot.target);
  scene.add(camera);
  return { scene, camera };
}

function baseScenes(pulses: number) {
  const mat = createStructureMaterial({
    water: createWaterUniforms(new THREE.Color(0.1, 0.2, 0.3), 500),
    fog: createFogUniforms(),
    sonar: createSonarUniforms(new SonarPulses(pulses)),
    beam: createBeamUniforms(),
    baseLight: createBaseLightUniforms(),
    absorb: new THREE.Vector3(0.06, 0.024, 0.014),
  });
  const inst = new StructureInstances(mat.material, KINDS, 4);
  inst.set(KINDS.map((kind, i) => ({ id: i + 1, kind, pos: [i * 30, 0, 0] as const, yaw: 0, working: true, on: true, damage: 0, birth: 0 })));
  const beams = new BeamColumns(4, 500);
  beams.set([{ x: 0, y: 41, z: 0 }], 0, 0);
  const holo = new Hologram(inst.geometries);
  holo.show("core", 0, 0, 0, 0, 10, true, { x: 0, y: 0, z: 0, r: 48 }, 0);
  const a = rig(), b = rig(), c = rig();
  a.scene.add(inst.group);
  b.scene.add(beams.mesh);
  c.scene.add(holo.group);
  return { structure: a, beam: b, holo: c, dispose: () => (inst.dispose(), beams.dispose(), holo.dispose(), mat.dispose()) };
}

export function programChecks(check: Check, compile: Compile, bin: string | null, t: string, p: CapturedProgram, budget: Budget, label: string) {
  check(!/[^\x00-\x7f]/.test(p.vertex + p.fragment), `sources are pure ASCII ${t}`, "");
  const fs = samplerUniforms(p.fragment), vs = samplerUniforms(p.vertex);
  check(fs.count === 0 && vs.count === 0, `no texture fetches ${t}`, [...fs.names, ...vs.names].join(", ") || "none");
  const pv = preprocess(p.vertex);
  const vary = [...pv.matchAll(/^\s*(?:flat\s+)?varying\s+(?:\w+\s+)?(\w+)\s+\w+/gm)].length;
  const attrs = [...pv.matchAll(/^\s*attribute\s+/gm)].length;
  check(vary <= 15 && attrs <= 16, `varyings / attributes within the WebGL2 minimum ${t}`, `${vary} varyings, ${attrs} attributes`);
  check(uniformVectors(p.fragment).packed <= 224 - 16, `fragment uniform vectors ${t}`, `${uniformVectors(p.fragment).packed} packed`);
  for (const [stage, src] of [["vertex", p.vertex], ["fragment", p.fragment]] as const) {
    const ctor = arrayPrecisionIssues(preprocess(src), { constructorsOnly: true });
    check(ctor.length === 0, `no array constructors in the ${stage} program ${t}`, ctor.join(" | ") || "none");
    compile(`exact three ${stage} ES ${t}`, esForGlslang(src, stage), stage);
  }
  if (!bin) return;
  try {
    const st = maliocFragment(bin, p.fragment);
    const issues = [...budgetIssues(st, budget), ...(st.longest.arith > budget.longestArith ? [`arith ${st.longest.arith} > ${budget.longestArith}`] : [])];
    check(issues.length === 0, `Mali-G57 ${label} budget (stack <= ${budget.stack} B, load/store <= ${budget.longestLS}, texture <= ${budget.longestTex}, arith <= ${budget.longestArith}) ${t}`, issues.length ? `${issues.join("; ")} | ${fmtMalioc(st)}` : fmtMalioc(st));
  } catch (e) {
    check(false, `malioc compiles the ${label} fragment ${t}`, String(e).slice(0, 400));
  }
}

export function basePrograms(check: Check, compile: Compile): void {
  const blocks = { ...Object.fromEntries(Object.entries(S).filter(([, v]) => typeof v === "string")), BL_DECLS, BL_LIGHT, BEAM_COLUMN_VERT, BEAM_COLUMN_FRAG, HOLO_VERT, HOLO_FRAG };
  for (const [name, src] of Object.entries(blocks)) {
    const issues = arrayPrecisionIssues(src as string);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const bin = findMalioc();
  for (const [device, pulses] of [["desktop", 5], ["phone", 3]] as const)
    for (const highp of [true, false]) {
      const tag = `${device}, ${highp ? "highp" : "mediump"}`;
      const s = baseScenes(pulses);
      const sp = capturePrograms(s.structure.scene, s.structure.camera, { highp });
      const bp = capturePrograms(s.beam.scene, s.beam.camera, { highp });
      const hp = capturePrograms(s.holo.scene, s.holo.camera, { highp });
      s.dispose();
      check(sp.length === 1 && /#define DM_STRUCT/.test(sp[0]?.fragment ?? "") && /#define USE_INSTANCING/.test(sp[0]?.vertex ?? ""), `four building kinds share one instanced program [buildings, ${tag}]`, `${sp.length}`);
      check(bp.length === 1 && /#define USE_INSTANCING/.test(bp[0]?.vertex ?? ""), `beam columns: one instanced program [beams, ${tag}]`, `${bp.length}`);
      check(hp.length === 2, `hologram + rings: two programs [hologram, ${tag}]`, `${hp.length}`);
      if (sp[0]) programChecks(check, compile, bin, `[buildings, ${tag}]`, sp[0], STRUCTURE_MALI_BUDGET, "building");
      if (bp[0]) programChecks(check, compile, bin, `[beams, ${tag}]`, bp[0], OVERLAY_MALI_BUDGET, "beam");
      hp.forEach((p, i) => programChecks(check, compile, bin, `[hologram ${i ? "rings" : "mesh"}, ${tag}]`, p, OVERLAY_MALI_BUDGET, "hologram"));
    }
}
