/**
 * test:shaders — the chaos programs (M8, scene/chaos): exactly as three builds
 * them, desktop / phone, highp / mediump.
 *  - stage 0 is zero-cost: with the chaos uniforms present, a calm generation's
 *    base and LOD-fade seabed programs are the M7 strings bit for bit (hashes
 *    recorded at deep-march-mvp-m7) apart from the active sonar's one-line blend
 *    (mix → additive overlay, SONAR_BLEND);
 *  - the chaos variant (DM_CHAOS: veins, crack light, scars) — ASCII, no array
 *    constructors, glslang ES, WebGL2 minimums, the seabed Mali-G57 budget, the
 *    fade variant still discarding first; its longest-path arithmetic over the M7
 *    base is reported (the veins run only on wall pixels, behind uniform branches);
 *  - aChaos is bound by chunks.ts; array lint on every injected block;
 *  - the omen silhouette (one additive program, no textures, OMEN_MALI_BUDGET).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { createBaseLightUniforms } from "../../src/games/deep-march/scene/base/baseLight";
import { createOmenMesh } from "../../src/games/deep-march/scene/chaos/omenMesh";
import { OMEN_FRAG, OMEN_VERT } from "../../src/games/deep-march/scene/chaos/omenShader";
import * as C from "../../src/games/deep-march/scene/chaos/seabedChaos";
import { createFogUniforms } from "../../src/games/deep-march/scene/fog";
import { createBeamUniforms } from "../../src/games/deep-march/scene/highBeam";
import { createMaterialUniforms } from "../../src/games/deep-march/scene/materialUniforms";
import { createParticleLightUniforms } from "../../src/games/deep-march/scene/particleLight";
import { createSeabedMaterial, createWaterUniforms } from "../../src/games/deep-march/scene/seabedMaterial";
import { SonarPulses, createSonarUniforms } from "../../src/games/deep-march/scene/sonar";
import { createLongPulses } from "../../src/games/deep-march/scene/sonarLong";
import { programChecks, type Budget, type Check, type Compile } from "./baseShaderChecks";
import { arrayPrecisionIssues, esForGlslang, preprocess, samplerUniforms, uniformVectors } from "./glsl-es";
import { SEABED_MALI_BUDGET, budgetIssues, findMalioc, fmtMalioc, maliocFragment, type MaliocStats } from "./malioc";
import { capturePrograms, type CapturedProgram } from "./three-capture";

/** The omen: additive, no textures, three long pulses. */
export const OMEN_MALI_BUDGET: Budget = { stack: 0, longestLS: 4, longestTex: 0, longestArith: 12 };

/** sha256 (16 hex) of vertex + fragment of the M7 base and fade seabed programs (tag deep-march-mvp-m7). */
const M7_SEABED: Record<string, [string, string]> = {
  "desktop, highp": ["1dd796d0fb8f4dd7", "7f686ff70b385bf3"],
  "desktop, mediump": ["7ea1accf99575ef2", "1a9a2ff314f325f4"],
  "phone, highp": ["f15a4c319468d39e", "a1d0bdd9cd48f923"],
  "phone, mediump": ["2233fc4e464ec26d", "3147291661193a38"],
};

/** The one line the active sonar changed since M7 (sonar.ts SONAR_OPAQUE): the M7 form is hashed. */
const SONAR_BLEND = { now: "      outgoingLight += sonarCol; // overlaid on the lamps' image (uSonar only gates)", m7: "      outgoingLight = mix(outgoingLight, sonarCol, uSonar);" };
const asM7 = (p: CapturedProgram): CapturedProgram => ({ ...p, fragment: p.fragment.replace(SONAR_BLEND.now, SONAR_BLEND.m7) });
const hashOf = (p: CapturedProgram) => createHash("sha256").update(p.vertex + "\n----\n" + p.fragment).digest("hex").slice(0, 16);

/** The seabed as world.ts builds it for a conserve dive (chaos uniforms present), its base + fade programs of one variant. */
function seabedPrograms(lowSpec: boolean, highp: boolean, chaos: boolean): CapturedProgram[] {
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
    chaos: C.createChaosUniforms(),
  });
  const v = sb.variant(chaos);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
  scene.add(new THREE.Mesh(geo, v.material), new THREE.Mesh(geo, v.fadeMaterial().material));
  return capturePrograms(scene, camera, { highp });
}

function mali(bin: string, fragment: string, check: Check, t: string): MaliocStats | null {
  try {
    return maliocFragment(bin, fragment);
  } catch (e) {
    check(false, `malioc compiles the chaos seabed fragment ${t}`, String(e).slice(0, 400));
    return null;
  }
}

function chaosSeabed(check: Check, compile: Compile, bin: string | null, lowSpec: boolean, highp: boolean): void {
  const tag = `${lowSpec ? "phone" : "desktop"}, ${highp ? "highp" : "mediump"}`;
  const calm = seabedPrograms(lowSpec, highp, false);
  const blend = calm.every((p) => p.fragment.split(SONAR_BLEND.now).length === 2);
  check(calm.length === 2 && blend && calm.map((p) => hashOf(asM7(p))).join() === M7_SEABED[tag].join(), `stage 0: the M7 base + fade programs bit for bit but the sonar blend line (zero cost) [${tag}]`, calm.map((p) => hashOf(asM7(p))).join(" "));
  const progs = seabedPrograms(lowSpec, highp, true);
  check(progs.length === 2 && progs.every((p) => /#define DM_CHAOS/.test(p.fragment) && /attribute float aChaos;/.test(preprocess(p.vertex))), `chaos variant: base + fade programs with DM_CHAOS and aChaos [${tag}]`, `${progs.length} programs`);
  const base = bin && calm[0] ? mali(bin, calm[0].fragment, check, `[${tag}, M7 base]`) : null;
  progs.forEach((p, i) => {
    const kind = i ? "fade" : "base";
    const t = `[${tag}, chaos ${kind}]`;
    check(!/[^\x00-\x7f]/.test(p.vertex + p.fragment), `sources are pure ASCII ${t}`, "");
    for (const [stage, src] of [["vertex", p.vertex], ["fragment", p.fragment]] as const) {
      const ctor = arrayPrecisionIssues(preprocess(src), { constructorsOnly: true });
      check(ctor.length === 0, `no array constructors in the ${stage} program ${t}`, ctor.join(" | ") || "none");
      compile(`exact three ${stage} ES ${t}`, esForGlslang(src, stage), stage);
    }
    const fu = uniformVectors(p.fragment), vu = uniformVectors(p.vertex), fs = samplerUniforms(p.fragment);
    const pv = preprocess(p.vertex);
    const vary = [...pv.matchAll(/^\s*(?:flat\s+)?varying\s+(?:\w+\s+)?(\w+)\s+\w+/gm)].map((m) => (m[1] === "mat3" ? 3 : m[1] === "mat4" ? 4 : 1)).reduce((a, b) => a + b, 0);
    const attrs = [...pv.matchAll(/^\s*attribute\s+/gm)].length;
    check(fu.packed <= 224 - 16 && vu.packed <= 256 - 16 && fs.count <= 16 && vary <= 15 && attrs <= 16, `WebGL2 minimums ${t}`, `uniform vectors ${fu.packed} / ${vu.packed}, ${fs.count} samplers, ${vary} varyings, ${attrs} attributes`);
    if (!bin) return;
    const s = mali(bin, p.fragment, check, t);
    if (!s) return;
    const issues = budgetIssues(s, SEABED_MALI_BUDGET);
    const delta = base ? `, arith +${(s.longest.arith - base.longest.arith).toFixed(2)} over M7 (${base.longest.arith})` : "";
    check(issues.length === 0, `Mali-G57 seabed budget (stack <= ${SEABED_MALI_BUDGET.stack} B, load/store <= ${SEABED_MALI_BUDGET.longestLS}, texture <= ${SEABED_MALI_BUDGET.longestTex}) ${t}`, `${issues.join("; ") || "ok"} | ${fmtMalioc(s)}${kind === "base" ? delta : ""}`);
    if (kind === "fade") check(s.shortest.arith < 2 && s.shortest.ls === 0 && s.shortest.tex === 0, `LOD fade still discards before shading ${t}`, `shortest A/LS/T ${s.shortest.arith}/${s.shortest.ls}/${s.shortest.tex}`);
  });
}

export function chaosPrograms(check: Check, compile: Compile): void {
  const blocks = { CHAOS_VERT_DECLS: C.CHAOS_VERT_DECLS, CHAOS_VERT_MAIN: C.CHAOS_VERT_MAIN, CHAOS_DECLS: C.CHAOS_DECLS, CHAOS_MAP: C.CHAOS_MAP, CHAOS_EMISSIVE: C.CHAOS_EMISSIVE, CHAOS_OPAQUE: C.CHAOS_OPAQUE, OMEN_VERT, OMEN_FRAG };
  for (const [name, src] of Object.entries(blocks)) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const chunks = readFileSync("src/games/deep-march/terrain/chunks.ts", "utf8");
  check(chunks.includes(`setAttribute("aChaos"`), "chaos attribute aChaos bound by chunks.ts", "");
  const bin = findMalioc();
  for (const lowSpec of [false, true]) for (const highp of [true, false]) chaosSeabed(check, compile, bin, lowSpec, highp);
  const pulses = new SonarPulses(5);
  const omen = createOmenMesh({ sonar: createSonarUniforms(pulses), long: createLongPulses() });
  check(omen.triangles <= 1600, "omen silhouette ≤ 1.6k triangles (one draw)", `${omen.triangles} triangles`);
  for (const highp of [true, false]) {
    const scene = new THREE.Scene();
    omen.mesh.visible = true;
    scene.add(omen.mesh);
    const progs = capturePrograms(scene, new THREE.PerspectiveCamera(), { highp });
    const t = `[omen, ${highp ? "highp" : "mediump"}]`;
    check(progs.length === 1, `three builds one omen program ${t}`, `${progs.length}`);
    if (progs[0]) programChecks(check, compile, bin, t, progs[0], OMEN_MALI_BUDGET, "omen");
    scene.remove(omen.mesh);
  }
  omen.dispose();
}
