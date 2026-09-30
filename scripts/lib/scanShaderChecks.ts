/**
 * test:shaders — the sonar observation view (scene/sonarScan): one opaque program
 * over the recorded surfaces (the old sonar light mode's look), exactly as three
 * builds it, highp and mediump: ASCII, no samplers, array precision, WebGL2
 * minimums, glslang ES and the Mali-G57 budget (SCAN_MALI_BUDGET). Plus the phone's
 * draw / buffer budget: every recorded vertex drawn once, one draw per 128 m block
 * in reach, bounded rebuilds.
 */
import * as THREE from "three";
import { SCAN_FRAG, SCAN_VERT } from "../../src/games/deep-march/scene/sonarScan/scanShader";
import { SCAN_VIEW, ScanView } from "../../src/games/deep-march/scene/sonarScan/scanView";
import { SCAN_TUNING } from "../../src/games/deep-march/scene/sonarScan/sonarScanner";
import { ScanRecord } from "../../src/games/deep-march/scene/sonarScan/scanRecord";
import { SCAN_GRID } from "../../src/games/deep-march/scene/sonarScan/scanGrid";
import { programChecks, type Budget, type Check, type Compile } from "./baseShaderChecks";
import { arrayPrecisionIssues } from "./glsl-es";
import { findMalioc } from "./malioc";
import { capturePrograms } from "./three-capture";
import { lodTerrain, pingAll } from "./scanFixture";

/**
 * Contours + rim + echo + the front band, no textures. Measured Oct 2026 (longest
 * A / LS / T): highp 2.8 / 0 / 0, mediump 2.75 / 0 / 0 — about 1/60 of the seabed program.
 */
export const SCAN_MALI_BUDGET: Budget = { stack: 0, longestLS: 2, longestTex: 0, longestArith: 8 };

export function scanPrograms(check: Check, compile: Compile): void {
  for (const [name, src] of Object.entries({ SCAN_VERT, SCAN_FRAG })) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const rec = new ScanRecord(SCAN_TUNING.cap.phone);
  pingAll(rec, { x: 0, y: -40, z: 0 }, 206, lodTerrain((x, z) => -50 + 6 * Math.sin(x / 23) * Math.cos(z / 17), 0, 0));
  const camera = new THREE.PerspectiveCamera(70, 1080 / 2400, 0.1, 1000);
  camera.position.set(0, -40, 0);
  camera.updateMatrixWorld();
  const view = new ScanView(true);
  for (let f = 0; f < 50; f++) view.update(rec, camera, new THREE.Vector4(0, -40, 0, 30));
  const draws = view.scene.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[];
  const drawn = draws.reduce((s, m) => s + m.geometry.getAttribute("position").count, 0);
  check(draws.length >= 1 && drawn === rec.verts && draws.every((m) => m.material === view.material), "the view draws exactly the recorded surfaces, one mesh per block, one shared program", `${draws.length} draws, ${drawn} vertices`);
  const span = SCAN_GRID.tile * SCAN_VIEW.block, r = SCAN_VIEW.phone.radius + span * 0.71;
  const maxDraws = Math.ceil((Math.PI * r * r) / (span * span)) + 8;
  const gpu = SCAN_TUNING.cap.phone * (12 + 3 + 2 * 6);
  check(maxDraws <= 40 && gpu <= 4.5 * 1048576 && SCAN_VIEW.phone.rebuild <= 20_000, "phone: ≤ 40 draws in reach, ≤ 4.5 MB of buffers at the cap, ≤ 20k vertices rebuilt per frame", `≤ ${maxDraws} draws, ${(gpu / 1048576).toFixed(1)} MB`);
  const bin = findMalioc();
  for (const highp of [true, false]) {
    const tag = highp ? "highp" : "mediump";
    const progs = capturePrograms(view.scene, camera, { highp });
    check(progs.length === 1, `three builds one scan-view program [scan view, ${tag}]`, `${progs.length}`);
    if (progs[0]) programChecks(check, compile, bin, `[scan view, ${tag}]`, progs[0], SCAN_MALI_BUDGET, "scan view");
  }
  view.dispose();
}
