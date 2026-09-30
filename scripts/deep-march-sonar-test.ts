/**
 * SONAR mode: pulse timing / fade math (scene/sonar.ts) and the survival changes
 * (sonar unit replaces the goggles; sonar light mode on key 3, highest drain).
 * Run: npm run test:sonar
 */
import * as THREE from "three";
import { SONAR_TUNING as T, SonarPulses, sonarAmp, sonarFront, sonarLifetime, sonarRangeFade, sonarTrail } from "../src/games/deep-march/scene/sonar";
import { ITEMS, LIGHT_MODES, SURVIVAL_TUNING, createSurvival } from "../src/games/deep-march/survival";
import { LampRig } from "../src/games/deep-march/scene/lampRig";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

console.log("sonar pulses");
check(T.period >= 2 && T.period <= 3 && T.range >= 300, "tuning: a ping every 2–3 s reaching ~300 m", `period ${T.period} s, range ${T.range} m, speed ${T.speed} m/s`);

// scheduling
const origin = new THREE.Vector3(10, -40, 5);
const sp = new SonarPulses(5);
sp.update(100, false, origin);
check(sp.count === 0 && sp.pulse.every((p) => p.w < 0), "inactive: no pulses", `count ${sp.count}`);
sp.update(100.5, true, origin);
check(sp.count === 1 && near(sp.pulse[0].w, 0) && sp.pulse[0].x === 10 && sp.pulse[0].y === -40, "first ping right on activation, from the diver", `R ${sp.pulse[0].w}, origin ${sp.pulse[0].x},${sp.pulse[0].y},${sp.pulse[0].z}`);
origin.set(50, -40, 5); // diver swims on: the old wavefront stays where it was emitted
sp.update(100.5 + T.period * 0.99, true, origin);
check(sp.count === 1 && near(sp.pulse[0].w, T.period * 0.99 * T.speed, 1e-6) && sp.pulse[0].x === 10, "front radius = age × speed, origin fixed in the world", `R ${sp.pulse[0].w.toFixed(1)} m`);
sp.update(100.5 + T.period, true, origin);
check(sp.count === 2 && sp.pulse[1].x === 50 && near(sp.pulse[1].w, 0, 1e-6), "next ping after one period, from the new position", `count ${sp.count}`);
let maxCount = 0;
const counts: number[] = [];
for (let t = 100.5 + T.period; t < 160; t += 1 / 60) {
  sp.update(t, true, origin);
  maxCount = Math.max(maxCount, sp.count);
  counts.push(sp.count);
}
const life = sonarLifetime(T, 5);
check(maxCount <= 5 && near(life, Math.min(T.range / T.speed + 4 * T.trail, 5 * T.period)), "bounded pulse count; lifetime = travel + 4 trail τ (capped)", `max ${maxCount} live, life ${life.toFixed(2)} s`);
// amplitude fades over the last second, so capacity drops never pop
check(sonarAmp(0, life) === 1 && sonarAmp(life - 1, life) === 1 && near(sonarAmp(life, life), 0) && sonarAmp(life - 0.5, life) > 0.4 && sonarAmp(life - 0.5, life) < 0.6, "pulse amplitude fades out at end of life", `amp(life − 0.5) ${sonarAmp(life - 0.5, life).toFixed(2)}`);
const low = new SonarPulses(3);
let lowMax = 0, oldestAmpAtDrop = 0;
for (let t = 0; t < 40; t += 1 / 60) {
  const r0 = low.pulse[0].w, a0 = low.amp[0];
  low.update(t, true, origin);
  if (r0 > 0 && low.pulse[0].w < r0) oldestAmpAtDrop = Math.max(oldestAmpAtDrop, a0); // oldest was retired
  lowMax = Math.max(lowMax, low.count);
}
check(lowMax <= 3 && low.life <= 3 * T.period && oldestAmpAtDrop < 0.05, "low spec: 3 slots, oldest already faded when replaced", `life ${low.life.toFixed(2)} s, amp at retire ${oldestAmpAtDrop.toFixed(3)}`);
low.update(41, false, origin);
const stillAging = low.count;
low.update(60, false, origin);
check(stillAging > 0 && low.count === 0, "switched off: no new pings, existing ones age out", `after off ${stillAging}, 19 s later ${low.count}`);

// fade math
check(near(sonarFront(100, 100), 1) && sonarFront(100, 100 - T.front) < 0.37 && sonarFront(100, 100 - 3 * T.front) < 1e-3, "front band gaussian", `front(W) ${sonarFront(100, 100 - T.front).toFixed(3)}`);
check(sonarTrail(100, 101) === 0 && near(sonarTrail(100, 100), 1) && near(sonarTrail(100 + T.speed * T.trail, 100), Math.exp(-1)), "hit trail: 0 before the front, e^-1 after τ", `trail(τ) ${sonarTrail(100 + T.speed * T.trail, 100).toFixed(3)}`);
const trail3 = sonarTrail(T.speed * 3, 0);
check(trail3 > 0.1 && trail3 < 0.4, "hit lines persist a few seconds", `after 3 s ${trail3.toFixed(2)}`);
check(sonarRangeFade(0) === 1 && sonarRangeFade(0.85 * T.range) === 1 && sonarRangeFade(T.range) === 0 && sonarRangeFade(0.925 * T.range) > 0.4, "range fade over the last 15 %", `fade(0.925 R) ${sonarRangeFade(0.925 * T.range).toFixed(2)}`);

console.log("survival: sonar replaces night vision");
const s = createSurvival();
check(LIGHT_MODES.join() === "beam,high,sonar", "modes on keys 1/2/3", LIGHT_MODES.join(" / "));
check(s.equipment.has("sonar") && "sonar-unit" in ITEMS && !("nv-goggles" in ITEMS), "sonar unit equipped by default, goggles gone", Object.keys(ITEMS).join(", "));
check(s.lights.available().includes("sonar") && s.lights.select("sonar") === "sonar" && s.lights.state().on, "select sonar", JSON.stringify(s.lights.state()));
const L = SURVIVAL_TUNING.lights as Record<string, number>;
check(L.sonar > L.high && L.high > L.beam && !("night" in L), "sonar has the highest drain tier", `beam ${L.beam}, high ${L.high}, sonar ${L.sonar}`);
s.tick(1);
check(near(s.resources.value("battery"), SURVIVAL_TUNING.battery.capacity - L.sonar, 1e-6), "battery drains at the sonar rate", `${s.resources.value("battery")}`);
s.equipment.unequip(ITEMS["sonar-unit"].slot);
check(!s.lights.available().includes("sonar") && s.lights.state().mode !== "sonar", "unequipping the unit disables sonar", JSON.stringify(s.lights.state()));
s.dispose();

console.log("lamp rig in sonar mode");
const rig = new LampRig(new THREE.PerspectiveCamera());
rig.update(0, { mode: "sonar", on: true, locked: false, available: LIGHT_MODES }, true);
const e = rig.env;
check(rig.sonar === 1 && e.water === 0 && e.ambientMul === 0 && e.ambientAdd === 0 && e.sunAdd === 0 && rig.spot.intensity === 0 && e.murk === 0 && e.glow === 0, "dark background: no environment, lamp, murk or glow", `sonar ${rig.sonar}, water ${e.water}, spot ${rig.spot.intensity}`);
rig.update(0, { mode: "sonar", on: false, locked: false, available: LIGHT_MODES }, true);
check(rig.sonar === 0, "off: sonar strength 0", `${rig.sonar}`);

console.log("ghost echo pulses (M8: SonarPulses.echo)");
{
  const g = new SonarPulses(5);
  const o = new THREE.Vector3(0, -20, 0);
  g.update(0, true, o);
  g.echo(0.6, 180, -20, 40, 0.55);
  g.update(1.0, true, o);
  const ghost = g.pulse[1], real = g.pulse[0];
  check(g.count === 2 && ghost.x === 180 && ghost.z === 40 && near(ghost.w, 0.4 * T.speed, 1e-6) && near(g.amp[1], 0.55 * sonarAmp(0.4, g.life)) && near(g.amp[0], sonarAmp(1, g.life)) && real.x === 0, "an echo is an ordinary slot: its own origin and start, amplitude × gain", `R ${ghost.w.toFixed(0)} m, amp ${g.amp[1].toFixed(2)}`);
  for (let i = 0; i < 12; i++) g.echo(1 + i * 0.01, 100, 0, 0, 0.5);
  g.update(1.2, true, o);
  check(g.count <= g.max && g.pulse.every((p, i) => (p.w < 0 ? g.amp[i] === 0 : true)), "echoes never exceed the slots (the oldest retire)", `${g.count} of ${g.max}`);
}

if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all sonar checks passed");
