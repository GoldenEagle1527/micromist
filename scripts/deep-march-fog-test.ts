/**
 * Turbidity (scene/fog.ts) math + the fog override parsing + the lamp rig's per-mode fog.
 * Run: npm run test:fog
 */
import * as THREE from "three";
import { FOG_TUNING, fogK, fogTransmittance, glowIntegral, parseFogParam } from "../src/games/deep-march/scene/fog";
import { LampRig } from "../src/games/deep-march/scene/lampRig";
import type { LightState } from "../src/games/deep-march/survival";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

console.log("fog / turbidity");
const V = FOG_TUNING.visibility;
check(V.beam >= 40 && V.beam <= 60 && V.high >= 60 && V.high <= 80, "default visibility in range", `beam ${V.beam} m, high ${V.high} m, off ${V.off} m`);
check(near(fogTransmittance(fogK(50), 50), 0.05, 0.002), "5 % of the light left at the visibility distance", `T(50 m) = ${fogTransmittance(fogK(50), 50).toFixed(4)}`);
check(fogTransmittance(fogK(50), 100) < 0.003 && fogTransmittance(fogK(50), 10) > 0.5, "tens of metres, not hundreds", `T(10) ${fogTransmittance(fogK(50), 10).toFixed(2)}, T(100) ${fogTransmittance(fogK(50), 100).toFixed(4)}`);
check(fogK(0) === 0 && glowIntegral(0, 1e5) === 0 && near(glowIntegral(fogK(50), 1e5), 1) && glowIntegral(fogK(50), 5) < glowIntegral(fogK(50), 20), "backscatter integral: 0 without fog, grows with depth to 1", `g(5) ${glowIntegral(fogK(50), 5).toFixed(3)}, g(20) ${glowIntegral(fogK(50), 20).toFixed(3)}`);
const p1 = parseFogParam("60"), p2 = parseFogParam("50,80");
check(parseFogParam(null)?.beam === V.beam && parseFogParam("off") === null && parseFogParam("0") === null && parseFogParam("abc")?.beam === V.beam &&
  p1?.beam === 60 && near(p1.high, 60 * (V.high / V.beam)) && p2?.beam === 50 && p2.high === 80,
  "fog override parsing", `null → defaults, off/0 → none, 60 → ${p1?.beam}/${p1?.high.toFixed(1)}, 50,80 → ${p2?.beam}/${p2?.high}`);

// lamp rig: per-mode extinction, murk / glow only with a lamp
const cam = new THREE.PerspectiveCamera();
const rig = new LampRig(cam, V);
const st = (mode: LightState["mode"], on: boolean): LightState => ({ mode, on, locked: false, available: ["beam", "high"] as LightState["available"] });
rig.update(0, st("beam", true), true);
const kb = rig.env.fogK, gb = rig.env.glow, mb = rig.env.murk;
rig.update(0, st("high", true), true);
const kh = rig.env.fogK, gh = rig.env.glow;
rig.update(0, st("beam", false), true);
const ko = rig.env.fogK, go = rig.env.glow, mo = rig.env.murk;
check(near(kb, fogK(V.beam)) && near(kh, fogK(V.high)) && near(ko, fogK(V.off)), "extinction per mode", `beam ${kb.toFixed(4)}, high ${kh.toFixed(4)}, off ${ko.toFixed(4)} /m`);
check(gh > gb && gb > 0 && go === 0 && mo === 0 && mb === 1, "lights off: black murk, no glow; high beam glows most", `glow beam ${gb}, high ${gh}, off ${go}; murk on ${mb}, off ${mo}`);
check(rig.beam.uBeamRange.value <= 120, "high beam fog-limited range", `${rig.beam.uBeamRange.value} m`);
const noFog = new LampRig(cam, null);
noFog.update(0, st("beam", true), true);
check(noFog.env.fogK === 0 && noFog.beam.uBeamRange.value === 280, "fog off: no extinction, original high-beam range", `k ${noFog.env.fogK}, range ${noFog.beam.uBeamRange.value}`);
if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all fog checks passed");
