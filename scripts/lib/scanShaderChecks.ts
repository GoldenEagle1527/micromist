/**
 * test:shaders — the sonar observation view (scene/sonarScan): one additive Points
 * program over the recorded scan, exactly as three builds it, highp and mediump:
 * ASCII, no samplers, array precision, WebGL2 minimums, glslang ES and the Mali-G57
 * budget (SCAN_MALI_BUDGET). Plus the phone's draw / buffer budget: points ≤ the
 * record cap, one draw per 128 m block in reach, per-frame rebuild bounded.
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
import { pingAll, terrain } from "./scanFixture";

/** Additive round points: no textures, a handful of ALU ops per pixel (the vertex shader does the shading). */
export const SCAN_MALI_BUDGET: Budget = { stack: 0, longestLS: 2, longestTex: 0, longestArith: 4 };

const renderer = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1080, 2400) } as unknown as THREE.WebGLRenderer;

export function scanPrograms(check: Check, compile: Compile): void {
  for (const [name, src] of Object.entries({ SCAN_VERT, SCAN_FRAG })) {
    const issues = arrayPrecisionIssues(src);
    check(issues.length === 0, `array types carry explicit precision, no array constructors: ${name}`, issues.join(" | ") || "clean");
  }
  const rec = new ScanRecord(SCAN_TUNING.cap.phone);
  pingAll(rec, { x: 0, y: -40, z: 0 }, 60, terrain(() => -50, -128, 128, -128, 128));
  const camera = new THREE.PerspectiveCamera(70, 1080 / 2400, 0.1, 1000);
  camera.position.set(0, -40, 0);
  camera.updateMatrixWorld();
  const view = new ScanView(true);
  view.update(rec, camera, renderer, new THREE.Vector4(0, -40, 0, 30));
  const draws = view.scene.children.filter((o) => (o as THREE.Points).isPoints) as THREE.Points[];
  const drawn = draws.reduce((s, p) => s + p.geometry.getAttribute("position").count, 0);
  check(draws.length >= 1 && drawn === rec.points, "the view draws exactly the recorded points (one Points per block)", `${draws.length} draws, ${drawn} points`);
  const span = SCAN_GRID.tile * SCAN_VIEW.block, r = SCAN_VIEW.phone.radius + span * 0.71;
  const maxDraws = Math.ceil((Math.PI * r * r) / (span * span)) + 8;
  check(maxDraws <= 40 && SCAN_VIEW.phone.maxPx <= 8, "phone: ≤ 40 point draws in reach, point sprites ≤ 8 px", `≤ ${maxDraws} draws, ${SCAN_VIEW.phone.maxPx} px`);
  const vram = SCAN_TUNING.cap.phone * (12 + 3);
  check(vram <= 2 << 20 && SCAN_VIEW.phone.rebuild <= 12_000 && SCAN_TUNING.budget.phone <= 10_000, "phone: ≤ 2 MB of point buffers, ≤ 12k points rebuilt and ≤ 10k vertices scanned per frame", `${(vram / 1048576).toFixed(2)} MB`);
  const bin = findMalioc();
  for (const highp of [true, false]) {
    const tag = highp ? "highp" : "mediump";
    const progs = capturePrograms(view.scene, camera, { highp });
    check(progs.length === 1, `three builds one scan-view program [scan view, ${tag}]`, `${progs.length}`);
    if (progs[0]) programChecks(check, compile, bin, `[scan view, ${tag}]`, progs[0], SCAN_MALI_BUDGET, "scan view");
  }
  view.dispose();
}
