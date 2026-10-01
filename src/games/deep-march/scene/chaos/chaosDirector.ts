/**
 * The chaos presentation's per-frame driver (MVP plan M8, design doc §4.2 / §4.5 /
 * §7.3). One per conserve dive; it holds the generation's ChaosView (fixed for the
 * generation, D11 — the tide hands it the next one at the switch) and, when that
 * generation shows no chaos (stage 0 without scars), does nothing at all.
 *  frame() — after the water look: seabed chaos uniforms (veins, the nearest open
 *    cracks' light — brighter while the diver, followed with a 3 s lag, stands in
 *    front: "it watches" — and scars), the lamp's slow modulation, the fog's
 *    colour shift and the audio detune, all by the local intensity χ_l;
 *  sonar() — after the pulses: ghost echoes from the wall, the omen (rumble, then
 *    a far sonar silhouette).
 * Stage 3+ adds the deep layer (deepChaos.ts: global fog / audio, plankton, the
 * surge, the blink, the shell beyond through cracks) and the late omens
 * (lateChaos.ts: false sonar readings, the lighthouse dimming, the base's ghost
 * echo — these also run in a calm generation when the debug panel forces them).
 * During the tide (suppressed) the lamp / fog / audio return to normal, no ghost or
 * omen starts, and a running omen withdraws.
 */
import type * as THREE from "three";
import type { ChaosView } from "../../conserve";
import type { DiveAudio } from "../audio";
import type { FogUniforms } from "../fog";
import type { LampRig } from "../lampRig";
import type { SonarPulses, SonarUniforms } from "../sonar";
import { fillCrackSlots, fillScarSlots, nearest } from "./chaosSlots";
import { CHAOS_LOOK } from "./config";
import { DeepChaos, type DeepFrame, type PlanktonChaos } from "./deepChaos";
import { NO_CHAOS, chaosAudioParams, chaosFrame, chaosLevels, followFactor, localChaos, shiftFog } from "./effects";
import { GhostEchoes, ghostOrigin, wallToward, type WallToward } from "./ghostEcho";
import { OmenChain } from "./omen";
import { createOmenMesh, type OmenMesh } from "./omenMesh";
import { CHAOS_CRACK_N, CHAOS_SCAR_N, type ChaosUniforms } from "./seabedChaos";
import type { BaseLightUniforms } from "../base/baseLight";
import { LateChaos, NO_FORCE, type LateForce } from "./lateChaos";
import { NO_GLITCH, type GlitchOffsets } from "./readingGlitch";

export type ChaosDirectorDeps = {
  uniforms: ChaosUniforms;
  fog: FogUniforms;
  rig: LampRig;
  audio: DiveAudio;
  pulses: SonarPulses;
  sonar: SonarUniforms;
  long: SonarPulses;
  scene: THREE.Scene;
  /** The plankton (stage 3+ tint and distorted swarm), null in node tests. */
  snow?: PlanktonChaos | null;
  /** 「减弱灯光起伏」 (settings): shallower, slower light changes. */
  calm: boolean;
  seed: number;
  /** The lighthouse light (dimming) and the base core (its ghost echo); absent in node tests. */
  baseLight?: BaseLightUniforms | null;
  home?: () => { x: number; y: number; z: number } | null;
  /** Debug-panel previews of the late omens. */
  force?: LateForce;
};

export type ChaosFrameInput = { dt: number; time: number; camera: THREE.Vector3; suppressed: boolean };
/** pings: the diver's pings this frame (key 3); sonar: 1 while a long pulse is alive (the omen can be seen), else 0. */
export type ChaosSonarInput = { dt: number; pulseTime: number; time: number; pings: number; sonar: number; diver: THREE.Vector3; blocked: boolean };

/** Whether a generation's terrain needs the chaos program (stage ≥ 1, or a scar). */
export function needsChaosProgram(view: ChaosView | null): boolean {
  return !!view && (view.stage > 0 || view.cracks.length > 0 || view.scars.length > 0);
}

/** Scar slots are re-picked (nearest) this often (s). */
const SCAR_REFRESH_S = 1;
/** A preview (debug panel) runs its first omen this soon (s) instead of omen.firstS. */
const PREVIEW_OMEN_S = 12;

export class ChaosDirector {
  private readonly d: ChaosDirectorDeps;
  private view: ChaosView | null = null;
  private levels = NO_CHAOS;
  private active = false;
  private gen = 0;
  private ghosts = new GhostEchoes(0, 0);
  private toward: WallToward | null = null;
  private omen = new OmenChain(false, 0);
  private omenMesh: OmenMesh | null = null;
  private readonly lag = { x: 0, z: 0, set: false };
  private scarClock = 0;
  /** Dive clock at the last sonar() (s): a generation's first omen counts from its start. */
  private clock = 0;
  private deep: DeepChaos | null = null;
  private deepOut: DeepFrame | null = null;
  private late: LateChaos | null = null;
  /** The rumble was driven last frame (so it is brought back to 0). */
  private rumbling = false;
  /** The gaze's floor under the rumble (scene/gaze/, stage 5; its growl loop is the gaze's own), 0 … 1. */
  readonly floor = { rumble: 0 };

  constructor(d: ChaosDirectorDeps, view: ChaosView | null) {
    this.d = d;
    this.setView(view);
  }

  /** The chaos drawn now (the debug panel's crack teleports). */
  current(): ChaosView | null {
    return this.view;
  }

  /** The generation's chaos (at the start, and at the tide's switch to gen + 1). */
  setView(view: ChaosView | null): void {
    const { uniforms: u, audio } = this.d;
    const was = this.active;
    this.view = view;
    this.levels = chaosLevels(view);
    this.active = needsChaosProgram(view);
    const seed = this.d.seed + 1013 * ++this.gen;
    this.ghosts = new GhostEchoes(this.levels.ghost, seed);
    this.toward = view ? wallToward(view) : null;
    this.omen = new OmenChain(this.levels.omen && !!view?.cracks.length, seed, this.clock + (view?.preview ? PREVIEW_OMEN_S : CHAOS_LOOK.omen.firstS));
    if (this.levels.omen && !this.omenMesh) {
      this.omenMesh = createOmenMesh({ sonar: this.d.sonar, long: this.d.long });
      this.d.scene.add(this.omenMesh.mesh);
    }
    if (this.omenMesh) this.omenMesh.mesh.visible = false;
    u.uChaos.value.set(0, 0, view?.scars.length ? 1 : 0, 0);
    fillCrackSlots(u.uCrack.value, [], () => 0);
    fillScarSlots(u.uScar.value, u.uScarT.value, view ? nearest(view.scars, 0, 0, CHAOS_SCAR_N) : []);
    this.lag.set = false;
    this.scarClock = SCAR_REFRESH_S;
    this.deep?.dispose();
    const { scene, fog, snow = null } = this.d;
    this.deep = new DeepChaos({ scene, fog, audio, snow, seed }, view, this.levels, this.clock);
    this.deepOut = null;
    this.late?.dispose();
    const { sonar, baseLight = null, home = () => null, force = NO_FORCE, calm } = this.d;
    this.late = new LateChaos({ scene, pulses: this.d.pulses, color: sonar.uSonarColor.value, audio, baseLight, home, calm, seed, force }, this.levels, this.clock);
    if (was && this.levels.detune <= 0) audio.chaos(chaosAudioParams(0, 0));
    if (was || this.rumbling) audio.rumble(0);
    this.rumbling = false;
  }

  /** Depth / heading offsets the HUD shows now (stage 3+ false readings). */
  glitch(): GlitchOffsets {
    return this.late?.glitch() ?? NO_GLITCH;
  }

  private nearestCrack(x: number, z: number) {
    return this.view ? (nearest(this.view.cracks, x, z, 1)[0] ?? null) : null;
  }

  get stage(): number {
    return this.view?.stage ?? 0;
  }

  /** Per frame, after the water look and the lamp rig (both rewrite what this scales). */
  frame(i: ChaosFrameInput): void {
    this.late?.frame({ ...i, crack: this.nearestCrack(i.camera.x, i.camera.z) });
    if (!this.active) return;
    const v = this.view!, d = this.d, L = CHAOS_LOOK;
    const k = this.lag.set ? 1 - Math.exp(-i.dt / L.glow.followLagS) : 1;
    this.lag.x += (i.camera.x - this.lag.x) * k;
    this.lag.z += (i.camera.z - this.lag.z) * k;
    this.lag.set = true;
    const chiL = i.suppressed ? 0 : localChaos(v.cracks, i.camera.x, i.camera.z);
    const f = chaosFrame(this.levels, chiL, i.time, d.calm);
    const deep = (this.deepOut = this.deep!.frame({ ...i, chiL, watch: (c) => followFactor(c, this.lag.x, this.lag.z) }));
    const glow = f.glow * deep.glow;
    d.uniforms.uChaos.value.set(f.veins, v.cracks.length ? glow : 0, v.scars.length ? 1 : 0, 0);
    if (v.cracks.length) {
      const near = nearest(v.cracks, i.camera.x, i.camera.z, CHAOS_CRACK_N);
      fillCrackSlots(d.uniforms.uCrack.value, near, (c) => glow * followFactor(c, this.lag.x, this.lag.z));
    }
    if (v.scars.length > CHAOS_SCAR_N && (this.scarClock += i.dt) >= SCAR_REFRESH_S) {
      this.scarClock = 0;
      fillScarSlots(d.uniforms.uScar.value, d.uniforms.uScarT.value, nearest(v.scars, i.camera.x, i.camera.z, CHAOS_SCAR_N));
    }
    if (f.lamp !== 1) {
      d.rig.spot.intensity *= f.lamp;
      d.rig.beam.uBeamGain.value *= f.lamp;
    }
    shiftFog(d.fog.uFogColor.value, 1 - (1 - f.fog) * (1 - deep.fog));
    if (this.levels.detune > 0) d.audio.chaos(chaosAudioParams(Math.max(f.audio, deep.audio), i.time));
  }

  /** Per frame, after the sonar pulses: ghost echoes and the omen. */
  sonar(i: ChaosSonarInput): void {
    this.clock = i.time;
    this.late?.sonar({ ...i, crack: this.nearestCrack(i.diver.x, i.diver.z) });
    let rumble = Math.max(this.late?.rumble ?? 0, this.floor.rumble);
    if (this.active) rumble = Math.max(rumble, this.omenSonar(i));
    if (rumble > 0 || this.rumbling) this.d.audio.rumble(rumble);
    this.rumbling = rumble > 0;
  }

  /** Ghost echoes and the omen; returns the omen / blink rumble. */
  private omenSonar(i: ChaosSonarInput): number {
    const d = this.d, G = CHAOS_LOOK.ghost;
    if (i.blocked) this.ghosts.clear();
    else if (i.pings > 0 && this.toward) this.ghosts.ping(i.pulseTime, i.diver.x, i.diver.y, i.diver.z, this.toward);
    const storm = !i.blocked && this.deepOut?.ghost && this.toward ? ghostOrigin(this.toward, i.diver.x, i.diver.y, i.diver.z) : null;
    for (const g of storm ? [...this.ghosts.due(i.pulseTime), storm] : this.ghosts.due(i.pulseTime)) {
      d.pulses.echo(i.pulseTime, g.x, g.y, g.z, G.gain);
      d.audio.play("sonar", G.sound);
    }
    const deep = this.deepOut?.rumble ?? 0;
    if (!this.omenMesh || !this.levels.omen) return deep;
    const crack = this.nearestCrack(i.diver.x, i.diver.z);
    const f = this.omen.update({ dt: i.dt, time: i.time, diver: i.diver, crack, blocked: i.blocked });
    this.omenMesh.update(f, i.sonar, i.time);
    return Math.max(f.rumble, deep);
  }

  dispose(): void {
    this.late?.dispose();
    this.late = null;
    this.deep?.dispose();
    this.deep = null;
    this.omenMesh?.mesh.removeFromParent();
    this.omenMesh?.dispose();
    this.omenMesh = null;
  }
}
