/**
 * test:shaders — the tide's programs (M7, scene/tide): the dome (domeMesh.ts,
 * additive fresnel) and the particle currents (tideParticles.ts, one Points
 * draw, motion in the vertex shader), exactly as three builds them, highp and
 * mediump: ASCII, no samplers, array precision, WebGL2 minimums, glslang ES
 * and Mali-G57 budgets (TIDE_MALI_BUDGET). Plus the geometry budgets: dome
 * ≤ 1k triangles, particles phone 3k / desktop 12k + the 500-particle burst.
 */
import * as THREE from "three";
import { TIDE_VIEW } from "../../src/games/deep-march/scene/tide/config";
import { TideDome } from "../../src/games/deep-march/scene/tide/domeMesh";
import { DOME_FRAG, DOME_VERT } from "../../src/games/deep-march/scene/tide/domeShader";
import { TIDE_FRONT_DECLS, TIDE_FRONT_EMISSIVE, TIDE_FRONT_FRAGMENT } from "../../src/games/deep-march/scene/tide/tideFrontShader";
import { PARTICLE_FRAG, PARTICLE_VERT } from "../../src/games/deep-march/scene/tide/tideParticleShader";
import { TideParticles } from "../../src/games/deep-march/scene/tide/tideParticles";
import { programChecks, type Budget, type Check, type Compile } from "./baseShaderChecks";
import { arrayPrecisionIssues } from "./glsl-es";
import { findMalioc } from "./malioc";
import { capturePrograms } from "./three-capture";

/** Dome and particles: additive, no textures, a few ALU ops per pixel. */
export const TIDE_MALI_BUDGET: Budget = { stack: 0, longestLS: 2, longestTex: 0, longestArith: 6 };

const CLOCK = { stripStart: 5, stripLen: 8, gatherStart: 21, gatherLen: 9 };

export function tidePrograms(check: Check, compile: Compile): void {
  for (const [name, src] of Object.entries({ DOME_VERT, DOME_FRAG, PARTICLE_VERT, PARTICLE_FRAG, TIDE_FRONT_DECLS, TIDE_FRONT_FRAGMENT, TIDE_FRONT_EMISSIVE })) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const dome = new TideDome();
  check(dome.triangles <= 1000, "tide dome ≤ 1k triangles (one draw)", `${dome.triangles} triangles`);
  const phone = new TideParticles(true, 7, CLOCK), desktop = new TideParticles(false, 7, CLOCK);
  const P = TIDE_VIEW.particles;
  check(phone.count === P.phone + P.burst && P.phone === 3000, "particles: phone 3k + 500 burst, one Points draw", `${phone.count}`);
  check(desktop.count === P.desktop + P.burst && P.desktop > P.phone, "particles: desktop more", `${desktop.count}`);
  const bytes = phone.count * 4 * 4;
  check(bytes <= 64 * 1024, "phone particle buffer (aSeed vec4) ≤ 64 KB", `${(bytes / 1024).toFixed(0)} KB`);
  const bin = findMalioc();
  for (const highp of [true, false]) {
    const tag = highp ? "highp" : "mediump";
    for (const [label, obj] of [["dome", dome.mesh], ["particles", phone.points]] as const) {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      obj.visible = true;
      scene.add(obj);
      const progs = capturePrograms(scene, camera, { highp });
      check(progs.length === 1, `three builds one ${label} program [tide ${label}, ${tag}]`, `${progs.length}`);
      if (progs[0]) programChecks(check, compile, bin, `[tide ${label}, ${tag}]`, progs[0], TIDE_MALI_BUDGET, `tide ${label}`);
      scene.remove(obj);
    }
  }
  dome.dispose();
  phone.dispose();
  desktop.dispose();
}
