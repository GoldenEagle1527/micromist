/**
 * Active sonar: pulse / fade math (scene/sonar.ts, sonarLong.ts), the ping itself
 * (survival/sonarPing.ts: key 3, battery cost, cooldown, sonar unit), the light
 * modes without sonar, and the additive overlay in every sonar-lit shader.
 * Run: npm run test:sonar
 */
import * as THREE from "three";
import { SONAR_OPAQUE, SONAR_TUNING as T, SonarPulses, sonarAmp, sonarFront, sonarLifetime, sonarRangeFade, sonarTrail } from "../src/games/deep-march/scene/sonar";
import { LONG_SONAR_TUNING, createLongPulses, longPingDue } from "../src/games/deep-march/scene/sonarLong";
import { ITEMS, LIGHT_MODES, SURVIVAL_TUNING, createSurvival } from "../src/games/deep-march/survival";
import { LampRig } from "../src/games/deep-march/scene/lampRig";
import { RING_FRAG } from "../src/games/deep-march/scene/wallRingShader";
import { NODE_OPAQUE } from "../src/games/deep-march/scene/expedition/nodeShader";
import { STRUCT_OPAQUE } from "../src/games/deep-march/scene/base/structureShader";

let failed = 0;
const check = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;
const S = SURVIVAL_TUNING.sonar;

console.log("sonar pulses (one per ping)");
check(S.cooldown >= 2 && S.cooldown <= 3 && T.period === S.cooldown && T.range >= 300, "tuning: a ping every 2–3 s at most, reaching ~300 m", `cooldown ${S.cooldown} s, range ${T.range} m, speed ${T.speed} m/s`);
const origin = new THREE.Vector3(10, -40, 5);
const sp = new SonarPulses(5);
sp.update(100);
check(sp.count === 0 && sp.pulse.every((p) => p.w < 0) && sp.lastPing === -Infinity, "no ping: no pulses", `count ${sp.count}`);
sp.ping(100.5, origin);
sp.update(100.5);
check(sp.count === 1 && near(sp.pulse[0].w, 0) && sp.pulse[0].x === 10 && sp.pulse[0].y === -40 && sp.lastPing === 100.5, "a ping starts at the diver", `R ${sp.pulse[0].w}, origin ${sp.pulse[0].x},${sp.pulse[0].y},${sp.pulse[0].z}`);
origin.set(50, -40, 5); // the diver swims on: the wavefront stays where it was emitted
sp.update(102);
check(sp.count === 1 && near(sp.pulse[0].w, 1.5 * T.speed, 1e-6) && sp.pulse[0].x === 10, "front radius = age × speed, origin fixed in the world", `R ${sp.pulse[0].w.toFixed(1)} m`);
sp.ping(103, origin);
sp.update(103);
check(sp.count === 2 && sp.pulse[1].x === 50 && near(sp.pulse[1].w, 0, 1e-6), "the next ping from the new position", `count ${sp.count}`);
let maxCount = 0;
for (let t = 103, next = 103; t < 160; t += 1 / 60) {
  if (t >= next) (sp.ping(t, origin), (next += S.cooldown));
  sp.update(t);
  maxCount = Math.max(maxCount, sp.count);
}
const life = sonarLifetime(T, 5);
check(maxCount <= 5 && near(life, Math.min(T.range / T.speed + 4 * T.trail, 5 * T.period)), "pinging at the cooldown: bounded count; lifetime = travel + 4 trail τ (capped)", `max ${maxCount} live, life ${life.toFixed(2)} s`);
check(sonarAmp(0, life) === 1 && sonarAmp(life - 1, life) === 1 && near(sonarAmp(life, life), 0) && sonarAmp(life - 0.5, life) > 0.4 && sonarAmp(life - 0.5, life) < 0.6, "pulse amplitude fades out at end of life", `amp(life − 0.5) ${sonarAmp(life - 0.5, life).toFixed(2)}`);
const low = new SonarPulses(3);
let lowMax = 0, oldestAmpAtDrop = 0;
for (let t = 0, next = 0; t < 40; t += 1 / 60) {
  const r0 = low.pulse[0].w, a0 = low.amp[0];
  if (t >= next) (low.ping(t, origin), (next += S.cooldown));
  low.update(t);
  if (r0 > 0 && low.pulse[0].w < r0) oldestAmpAtDrop = Math.max(oldestAmpAtDrop, a0); // oldest was retired
  lowMax = Math.max(lowMax, low.count);
}
check(lowMax <= 3 && low.life <= 3 * T.period && oldestAmpAtDrop < 0.05, "low spec: 3 slots, oldest already faded when replaced", `life ${low.life.toFixed(2)} s, amp at retire ${oldestAmpAtDrop.toFixed(3)}`);
low.update(41);
const stillAging = low.count;
low.update(60);
check(stillAging > 0 && low.count === 0, "no more pings: the live ones age out", `after the last ping ${stillAging}, 19 s later ${low.count}`);

console.log("long pulses (the ring wall, the omen)");
{
  const long = createLongPulses();
  const at = new THREE.Vector3();
  let sent = 0;
  for (let t = 0; t < 20; t += S.cooldown) {
    if (longPingDue(long, t)) (long.ping(t, at), sent++);
    long.update(t);
  }
  check(LONG_SONAR_TUNING.period === 2 * T.period && sent === Math.ceil(20 / LONG_SONAR_TUNING.period) && long.count <= long.max, "a ping sends a long pulse at most every 2 cooldowns", `${sent} long pulses for 8 pings in 20 s`);
  long.update(60);
  check(long.count === 0, "long pulses age out (ring and omen hidden again)", `${long.count}`);
}

console.log("fade math");
check(near(sonarFront(100, 100), 1) && sonarFront(100, 100 - T.front) < 0.37 && sonarFront(100, 100 - 3 * T.front) < 1e-3, "front band gaussian", `front(W) ${sonarFront(100, 100 - T.front).toFixed(3)}`);
check(sonarTrail(100, 101) === 0 && near(sonarTrail(100, 100), 1) && near(sonarTrail(100 + T.speed * T.trail, 100), Math.exp(-1)), "hit trail: 0 before the front, e^-1 after τ", `trail(τ) ${sonarTrail(100 + T.speed * T.trail, 100).toFixed(3)}`);
const trail3 = sonarTrail(T.speed * 3, 0);
check(trail3 > 0.1 && trail3 < 0.4, "hit lines persist a few seconds", `after 3 s ${trail3.toFixed(2)}`);
check(sonarRangeFade(0) === 1 && sonarRangeFade(0.85 * T.range) === 1 && sonarRangeFade(T.range) === 0 && sonarRangeFade(0.925 * T.range) > 0.4, "range fade over the last 15 %", `fade(0.925 R) ${sonarRangeFade(0.925 * T.range).toFixed(2)}`);

console.log("the ping (survival/sonarPing.ts)");
{
  const s = createSurvival();
  const cap = SURVIVAL_TUNING.battery.capacity;
  check(LIGHT_MODES.join() === "beam,high" && !("sonar" in SURVIVAL_TUNING.lights), "sonar left the light modes (keys 1 / 2 / L)", LIGHT_MODES.join(" / "));
  check(s.equipment.has("sonar") && "sonar-unit" in ITEMS && s.sonar.state(0).available && s.sonar.state(0).ready, "sonar unit equipped by default: ready", JSON.stringify(s.sonar.state(0)));
  check(s.sonar.ping(10) === null && s.sonar.take() === 1 && s.sonar.take() === 0 && near(s.resources.value("battery"), cap - S.pingCost, 1e-9), "a ping costs its charge once and is taken by one frame", `battery ${s.resources.value("battery")}`);
  const cd = s.sonar.state(10 + S.cooldown / 2);
  check(s.sonar.ping(10 + S.cooldown / 2) === "cooldown" && s.sonar.take() === 0 && !cd.ready && near(cd.cooldown, S.cooldown / 2, 1e-9) && near(cd.charge, 0.5, 1e-9), "refused during the cooldown (no charge taken)", JSON.stringify(cd));
  check(s.sonar.ping(10 + S.cooldown) === null && s.sonar.take() === 1 && near(s.resources.value("battery"), cap - 2 * S.pingCost, 1e-9), "allowed again once the cooldown ran out", `battery ${s.resources.value("battery").toFixed(1)}`);
  s.resources.consume("battery", s.resources.value("battery") - S.pingCost / 2);
  const flat = s.sonar.state(100);
  check(s.sonar.ping(100) === "battery" && !flat.ready && flat.cooldown === 0 && s.sonar.take() === 0, "refused on a nearly flat battery", `battery ${s.resources.value("battery").toFixed(2)}`);
  s.sonar.queue();
  check(s.sonar.take() === 1 && near(s.resources.value("battery"), S.pingCost / 2, 1e-9), "debug ping: free, no cooldown", `battery ${s.resources.value("battery").toFixed(2)}`);
  s.resources.add("battery", cap);
  s.lights.setOn(false);
  s.tick(1);
  check(near(s.resources.value("battery"), cap, 1e-9), "no drain while idle between pings (only lights drain)", `${s.resources.value("battery")}`);
  s.equipment.unequip(ITEMS["sonar-unit"].slot);
  check(s.sonar.ping(200) === "gear" && !s.sonar.state(200).available && s.lights.available().join() === "beam,high", "unequipping the unit disables the ping, not the lamps", JSON.stringify(s.sonar.state(200)));
  s.dispose();
}

console.log("lamps stay on under the sonar");
{
  const rig = new LampRig(new THREE.PerspectiveCamera());
  rig.update(0, { mode: "beam", on: true, locked: false, available: LIGHT_MODES }, true);
  check(rig.env.water === 1 && rig.env.ambientMul === 1 && rig.spot.intensity > 0 && !("sonar" in rig), "beam: the lit environment (no sonar level any more)", `water ${rig.env.water}, spot ${rig.spot.intensity}`);
  rig.update(0, { mode: "high", on: false, locked: false, available: LIGHT_MODES }, true);
  check(rig.env.water === 0 && rig.spot.intensity === 0, "off: dark", `water ${rig.env.water}`);
}

console.log("additive overlay (option ①: over the current lights)");
check(/outgoingLight \+= sonarCol;/.test(SONAR_OPAQUE) && /if \(uSonar > 0\.001\)/.test(SONAR_OPAQUE) && !/mix\(outgoingLight/.test(SONAR_OPAQUE), "seabed: pulse light added on top (uSonar gates the branch)", "outgoingLight += sonarCol");
check([NODE_OPAQUE, STRUCT_OPAQUE].every((f) => /outgoingLight \+= echo \* uSonar/.test(f) && !/mix\(outgoingLight, echo/.test(f)), "nodes and base structures: echo added on top", "outgoingLight += echo * uSonar");
check(/gl_FragColor = vec4\(sonarCol \* \(uSonar \* k\), 1\.0\)/.test(RING_FRAG) && !/dmBackground/.test(RING_FRAG.split("void main")[1] ?? ""), "far ring: additive, no background replacement", "sonarCol * (uSonar * k)");

console.log("ghost echo pulses (M8: SonarPulses.echo)");
{
  const g = new SonarPulses(5);
  const o = new THREE.Vector3(0, -20, 0);
  g.ping(0, o);
  g.echo(0.6, 180, -20, 40, 0.55);
  g.update(1.0);
  const ghost = g.pulse[1], real = g.pulse[0];
  check(g.count === 2 && ghost.x === 180 && ghost.z === 40 && near(ghost.w, 0.4 * T.speed, 1e-6) && near(g.amp[1], 0.55 * sonarAmp(0.4, g.life)) && near(g.amp[0], sonarAmp(1, g.life)) && real.x === 0, "an echo is an ordinary slot: its own origin and start, amplitude × gain", `R ${ghost.w.toFixed(0)} m, amp ${g.amp[1].toFixed(2)}`);
  for (let i = 0; i < 12; i++) g.echo(1 + i * 0.01, 100, 0, 0, 0.5);
  g.update(1.2);
  check(g.count <= g.max && g.pulse.every((p, i) => (p.w < 0 ? g.amp[i] === 0 : true)), "echoes never exceed the slots (the oldest retire)", `${g.count} of ${g.max}`);
}

if (failed) {
  console.log(`${failed} check(s) FAILED`);
  process.exit(1);
}
console.log("all sonar checks passed");
