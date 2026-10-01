/**
 * The chaos presentation's logic (plan M8; scene/chaos/*): stage 0 is all zeros
 * and the director does nothing; strengths fixed per generation; χ_l decays with
 * distance; the light wave stays ≤ 3 Hz (calm: shallower, slower); the fog keeps
 * its luminance; ghost echoes only at stage ≥ 1, from the wall's side; the omen
 * is telegraphed (rumble first, fades in, keeps its distance, rare, near cracks).
 */
import * as THREE from "three";
import type { ChaosView } from "../../src/games/deep-march/conserve";
import { previewChaos } from "../../src/games/deep-march/conserve/chaos/preview";
import { chaosViewOf } from "../../src/games/deep-march/conserve/chaos/view";
import type { DiveAudio } from "../../src/games/deep-march/scene/audio";
import { ChaosDirector, needsChaosProgram } from "../../src/games/deep-march/scene/chaos/chaosDirector";
import { CHAOS_LOOK } from "../../src/games/deep-march/scene/chaos/config";
import { NO_CHAOS, chaosFrame, chaosLevels, followFactor, localChaos, shiftFog, slowWave, slowWaveMaxHz } from "../../src/games/deep-march/scene/chaos/effects";
import { GhostEchoes, wallToward } from "../../src/games/deep-march/scene/chaos/ghostEcho";
import { OmenChain } from "../../src/games/deep-march/scene/chaos/omen";
import { buildOmenGeometry } from "../../src/games/deep-march/scene/chaos/omenGeometry";
import { createChaosUniforms } from "../../src/games/deep-march/scene/chaos/seabedChaos";
import { createFogUniforms } from "../../src/games/deep-march/scene/fog";
import type { LampRig } from "../../src/games/deep-march/scene/lampRig";
import { SonarPulses, createSonarUniforms } from "../../src/games/deep-march/scene/sonar";
import { createLongPulses } from "../../src/games/deep-march/scene/sonarLong";
import type { Checker } from "./checks";
import { RING10 } from "./chaosFixture";

const CTX = { gen: 3, seed: 42, ring: RING10, base: { x: 0, z: 0 }, siteHarvest: new Array(100).fill(0) };
const viewAt = (stage: 0 | 1 | 2, cracks: 1 | 2 = 1, scar = false): ChaosView => chaosViewOf(previewChaos({ stage, cracks, scar }, CTX), { sitesX: 10, sitesZ: 10 }, true);

function effectChecks(c: Checker): void {
  c.section("chaos effects (scene/chaos/effects.ts)");
  const v0 = viewAt(0), v1 = viewAt(1), v2 = viewAt(2);
  const zero = Object.values(chaosLevels(v0)).every((x) => x === 0 || x === false);
  c.check(zero && chaosLevels(null) === NO_CHAOS && !needsChaosProgram(v0) && !needsChaosProgram(null), "stage 0: every strength 0, the M7 seabed program");
  c.check(needsChaosProgram(v1) && needsChaosProgram(viewAt(0, 1, true)), "stage ≥ 1, or a scar: the chaos program");
  const l1 = chaosLevels(v1), l2 = chaosLevels(v2);
  c.check(l1.veins > 0 && l1.glow === 0 && l1.ghost > 0 && !l1.omen && l2.glow > 0 && l2.flicker > 0 && l2.flicker <= 0.4 && l2.omen, "stage 1: veins + ghosts; stage 2: crack light, lamp (≤ 40 %), omen", `veins ${l1.veins.toFixed(2)}, flicker ${l2.flicker.toFixed(2)}`);
  c.check(JSON.stringify(chaosLevels(viewAt(2))) === JSON.stringify(l2), "fixed per generation: the strengths are a function of its view alone");
  const k = v2.cracks[0];
  const inward = (d: number) => localChaos(v2.cracks, k.x - k.nx * d, k.z - k.nz * d);
  c.check(Math.abs(inward(0) - 1) < 1e-9 && inward(200) < inward(50) && inward(1200) < 0.01 && localChaos([], k.x, k.z) === 0, "χ_l: 1 at the crack, decaying, ~0 a kilometre off, 0 without cracks", `${inward(50).toFixed(2)} @50 m, ${inward(200).toFixed(2)} @200 m`);
  c.check(slowWaveMaxHz(false) <= CHAOS_LOOK.flicker.maxHz && slowWaveMaxHz(true) < slowWaveMaxHz(false), "light wave components ≤ 3 Hz (calm: the slowest only)", `${slowWaveMaxHz(false)} Hz / ${slowWaveMaxHz(true)} Hz`);
  let minLamp = 1, minCalm = 1, maxRate = 0, prev = chaosFrame(l2, 1, 0, false).lamp;
  const dt = 1 / 240;
  for (let t = dt; t < 60; t += dt) {
    const f = chaosFrame(l2, 1, t, false).lamp;
    minLamp = Math.min(minLamp, f);
    minCalm = Math.min(minCalm, chaosFrame(l2, 1, t, true).lamp);
    maxRate = Math.max(maxRate, Math.abs(f - prev) / dt);
    prev = f;
  }
  const bound = 2 * Math.PI * CHAOS_LOOK.flicker.maxHz * l2.flicker;
  c.check(minLamp >= 0.6 && maxRate <= bound && slowWave(3, false) >= 0 && slowWave(3, false) <= 1, "lamp never below 60 %, never faster than a 3 Hz sine of its depth (no strobe)", `min ${minLamp.toFixed(2)}, max slope ${maxRate.toFixed(2)}/s ≤ ${bound.toFixed(2)}`);
  c.check(1 - minCalm <= l2.flicker * CHAOS_LOOK.flicker.calm + 1e-9 && 1 - minCalm < 1 - minLamp, "「减弱灯光起伏」: at most a quarter of the depth", `dip ${(1 - minCalm).toFixed(3)} vs ${(1 - minLamp).toFixed(3)}`);
  const f0 = chaosFrame(NO_CHAOS, 1, 5, false);
  c.check(f0.lamp === 1 && f0.fog === 0 && f0.audio === 0 && f0.veins === 0 && f0.glow === 0, "stage 0 frame: the identity");
  c.check(followFactor(k, k.x - k.nx * 100, k.z - k.nz * 100) === 1 && followFactor(k, k.x + k.tx * 100, k.z + k.tz * 100) < 1, "the crack light is brightest with the diver in front ('it watches')");
  const col = { r: 0.03, g: 0.05, b: 0.08 }, lum = (q: typeof col) => 0.2126 * q.r + 0.7152 * q.g + 0.0722 * q.b, l0 = lum(col);
  const same = { ...col };
  shiftFog(same, 0);
  shiftFog(col, 1);
  const [r, g, b] = CHAOS_LOOK.fog.color;
  c.check(same.r === 0.03 && same.b === 0.08 && Math.abs(lum(col) - l0) < 1e-12 && Math.abs(col.g / col.r - g / r) < 1e-9 && Math.abs(col.b / col.r - b / r) < 1e-9, "fog shift: share 0 unchanged; share 1 = the chaos hue at the same luminance");
}

function ghostChecks(c: Checker): void {
  c.section("ghost echoes (scene/chaos/ghostEcho.ts)");
  const v1 = viewAt(1), toward = wallToward(v1), b = v1.bounds;
  const count = (chance: number) => {
    const g = new GhostEchoes(chance, 5);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      g.ping(i * 2.5, b.cx + b.hx - 150, 0, b.cz, toward);
      n += g.due(i * 2.5 + 2).length;
    }
    return n;
  };
  const n1 = count(chaosLevels(v1).ghost);
  c.check(count(chaosLevels(viewAt(0)).ghost) === 0 && n1 > 60 && n1 < 150, "stage 0: none; stage 1: about a quarter of the pings", `${n1} of 400`);
  const g = new GhostEchoes(1, 9);
  g.ping(10, b.cx + b.hx - 150, 3, b.cz, toward);
  const [p] = g.due(20);
  const delay = p.at - 10, G = CHAOS_LOOK.ghost;
  c.check(p.x > b.cx + b.hx - 150 && Math.abs(p.z - b.cz) < 1e-9 && p.y === 3 && Math.hypot(p.x - (b.cx + b.hx - 150), p.z - b.cz) <= G.reach + 1e-9 && delay >= G.delay[0] && delay <= G.delay[1], "it starts toward the nearest wall (≤ reach), after 0.3 … 1.2 s", `${(p.x - (b.cx + b.hx - 150)).toFixed(0)} m, ${delay.toFixed(2)} s`);
}

function omenChecks(c: Checker): void {
  c.section("the omen (scene/chaos/omen.ts)");
  const O = CHAOS_LOOK.omen;
  const run = (opts: { crackAt: number; blocked?: boolean; enabled?: boolean; secs?: number }) => {
    const chain = new OmenChain(opts.enabled ?? true, 3);
    const diver = { x: 0, y: -20, z: 0 };
    const r = { firstLead: -1, runs: 0, minDist: Infinity, maxStep: 0, presenceBeforeRumble: false, maxPresence: 0 };
    let prevP = 0;
    for (let t = 0; t < (opts.secs ?? 1500); t += 0.1) {
      diver.x = 60 * Math.sin(t / 40);
      const f = chain.update({ dt: 0.1, time: t, diver, crack: { x: opts.crackAt, z: 0 }, blocked: opts.blocked ?? false });
      if (f.phase === "lead" && r.firstLead < 0) r.firstLead = t;
      if (f.presence > 0) r.minDist = Math.min(r.minDist, Math.hypot(f.x - diver.x, f.z - diver.z));
      if (f.presence > 0 && f.rumble <= 0 && f.phase !== "leave") r.presenceBeforeRumble = true;
      r.maxStep = Math.max(r.maxStep, f.presence - prevP);
      r.maxPresence = Math.max(r.maxPresence, f.presence);
      prevP = f.presence;
    }
    r.runs = chain.runs;
    return r;
  };
  const near = run({ crackAt: 400 });
  c.check(near.firstLead >= O.firstS && near.runs >= 2 && near.runs <= O.perGeneration && near.maxPresence > 0.99, "near a crack: first after 50 s, then every 4–7 min, at most 3 per generation", `first ${near.firstLead.toFixed(0)} s, ${near.runs} runs in 25 min`);
  c.check(!near.presenceBeforeRumble && near.maxStep <= 0.1 / O.fadeS + 1e-9, "telegraphed: the rumble comes first, the silhouette fades in over 3 s (no pop)");
  c.check(near.minDist >= O.minDistance - 1e-6, "never nearer than 180 m (no jump scare)", `${near.minDist.toFixed(0)} m`);
  c.check(run({ crackAt: 2000 }).runs === 0 && run({ crackAt: 400, blocked: true }).runs === 0 && run({ crackAt: 400, enabled: false }).runs === 0, "none far from cracks, during the tide, or below stage 2");
  const g = buildOmenGeometry();
  c.check(g.triangles > 800 && g.triangles < 1600 && g.positions.length / 3 < 65536 && g.sway.every((s) => s >= 0 && s <= 1.4), "silhouette ≈ 1.2k triangles, 16-bit indices", `${g.triangles} triangles`);
}

type Calls = { chaos: number; rumble: number; play: number; loop: number; loops: Record<string, number> };
function fakeParts() {
  const calls: Calls = { chaos: 0, rumble: 0, play: 0, loop: 0, loops: {} };
  const setLoop = (id: string, level: number) => void (calls.loop++, (calls.loops[id] = level));
  const audio = { chaos: () => void calls.chaos++, rumble: () => void calls.rumble++, play: () => void calls.play++, setLoop } as unknown as DiveAudio;
  const rig = { spot: { intensity: 26 }, beam: { uBeamGain: { value: 1.5 } } } as unknown as LampRig;
  const pulses = new SonarPulses(5);
  const d = { uniforms: createChaosUniforms(), fog: createFogUniforms(), rig, audio, pulses, sonar: createSonarUniforms(pulses), long: createLongPulses(), scene: new THREE.Scene(), calm: false, seed: 7 };
  return { d, calls, rig };
}

function directorChecks(c: Checker): void {
  c.section("chaos director (scene/chaos/chaosDirector.ts)");
  const z = fakeParts(), dir0 = new ChaosDirector(z.d, viewAt(0));
  const fog0 = z.d.fog.uFogColor.value.clone();
  for (let i = 0; i < 100; i++) {
    dir0.frame({ dt: 0.016, time: i * 0.016, camera: new THREE.Vector3(0, 0, 0), suppressed: false });
    dir0.sonar({ dt: 0.016, pulseTime: i * 0.016, time: i * 0.016, pings: i % 10 === 0 ? 1 : 0, sonar: 1, diver: new THREE.Vector3(), blocked: false });
  }
  c.check(z.rig.spot.intensity === 26 && z.d.fog.uFogColor.value.equals(fog0) && z.calls.chaos + z.calls.rumble + z.calls.play + z.calls.loop === 0 && z.d.uniforms.uChaos.value.lengthSq() === 0 && z.d.pulses.count === 0 && z.d.scene.children.length === 0, "stage 0: nothing touched, nothing built (zero cost)");
  const p = fakeParts(), v2 = viewAt(2), k = v2.cracks[0], dir = new ChaosDirector(p.d, v2);
  const at = new THREE.Vector3(k.x - k.nx * 60, 0, k.z - k.nz * 60);
  let minLamp = 1;
  for (let i = 0; i < 300; i++) {
    p.rig.spot.intensity = 26;
    dir.frame({ dt: 0.016, time: 1 + i * 0.016, camera: at, suppressed: false });
    minLamp = Math.min(minLamp, p.rig.spot.intensity / 26);
  }
  const u = p.d.uniforms;
  c.check(minLamp < 1 && minLamp >= 0.6 && p.calls.chaos > 0 && u.uChaos.value.x > 0 && u.uChaos.value.y > 0 && u.uCrack.value[0].w > 0 && u.uCrack.value[0].x === k.x, "stage 2 near a crack: lamp modulated, audio detuned, veins and crack light on", `lamp ≥ ${minLamp.toFixed(2)}`);
  p.rig.spot.intensity = 26;
  const fogBefore = p.d.fog.uFogColor.value.clone();
  dir.frame({ dt: 0.016, time: 9, camera: at, suppressed: true });
  c.check(p.rig.spot.intensity === 26 && p.d.fog.uFogColor.value.equals(fogBefore), "during the tide: lamp and fog left alone");
  const s = fakeParts(), dirS = new ChaosDirector(s.d, viewAt(1, 1, true));
  c.check(s.d.uniforms.uChaos.value.z === 1 && s.d.uniforms.uScar.value[0].x !== 1e6 && s.d.uniforms.uScar.value[1].x === 1e6, "a healed crack: its scar slot is set (the wall darkens along it)");
  dirS.setView(viewAt(0));
  c.check(s.d.uniforms.uChaos.value.lengthSq() === 0 && s.d.uniforms.uScar.value[0].x === 1e6 && (s.calls.loops.dread ?? 0) === 0, "the tide's switch to a calm generation clears everything (the dread loop silent)");
  dir.dispose();
}

export function chaosSceneChecks(c: Checker): void {
  effectChecks(c);
  ghostChecks(c);
  omenChecks(c);
  directorChecks(c);
}
