/**
 * The stage 3–4 omens the deep layer leaves out (design doc §4.2 渗入 / 侵蚀,
 * §4.5; plan backlog "阶段 3–4 还没做的设计条目"), owned by the ChaosDirector,
 * numbers in CHAOS_LOOK.late. All slow, all telegraphed, none a jump scare:
 *  - 声呐假读数 (stage 3+, near cracks): phantom contacts in the pings' returns
 *    (phantoms.ts) and the depth / heading readouts jumping (readingGlitch.ts);
 *  - 基地灯塔偶尔变暗 (stage 4+, near a lit lighthouse): a low groan, then the
 *    lighthouse light eases down and back (lighthouseDim.ts; 「减弱灯光起伏」 aware);
 *  - 基地的幽灵回波 (stage 4+, away from the base): a ping answered from a
 *    phantom base in the wrong direction (homeGhost.ts).
 * (异常地形 is baked into the terrain at the tide: terrain/anomaly.ts.) The debug
 * panel's previews force each one on at any stage, first event within seconds.
 * During the tide (blocked / suppressed) nothing new starts and the light is whole.
 */
import type * as THREE from "three";
import type { ChaosCrackView } from "../../conserve";
import type { DiveAudio } from "../audio";
import { BASE_LIGHT } from "../base/config";
import type { BaseLightUniforms } from "../base/baseLight";
import type { SonarPulses } from "../sonar";
import { CHAOS_LOOK, type ChaosStageLook } from "./config";
import { HomeGhosts } from "./homeGhost";
import { LighthouseDim } from "./lighthouseDim";
import { ContactSet, homeShape } from "./phantomContacts";
import { PhantomMesh } from "./phantomMesh";
import { Phantoms } from "./phantoms";
import { NO_GLITCH, ReadingGlitch, type GlitchOffsets } from "./readingGlitch";

type Point = { x: number; y: number; z: number };

/** Debug-panel previews of the late omens (never saved; the terrain's is conserve-side). */
export type LateForce = { phantoms: boolean; dimming: boolean; homeGhost: boolean };
export const NO_FORCE: LateForce = { phantoms: false, dimming: false, homeGhost: false };

export type LateDeps = {
  scene: THREE.Scene;
  pulses: SonarPulses;
  color: THREE.Color;
  audio: DiveAudio;
  baseLight: BaseLightUniforms | null;
  /** The base core (null: none yet). */
  home: () => Point | null;
  calm: boolean;
  seed: number;
  force: LateForce;
};

export type LateFrameInput = { dt: number; time: number; camera: Point; suppressed: boolean; crack: ChaosCrackView | null };
export type LateSonarInput = { pulseTime: number; pings: number; diver: Point; blocked: boolean; crack: ChaosCrackView | null };

export class LateChaos {
  private readonly d: LateDeps;
  private readonly phantoms: Phantoms;
  private readonly homes: HomeGhosts;
  private readonly glitches: ReadingGlitch;
  private readonly dim: LighthouseDim;
  private readonly contacts = new ContactSet();
  /** The false-readings preview: anywhere, not only near cracks. */
  private readonly forced: boolean;
  private mesh: PhantomMesh | null = null;
  private offsets: GlitchOffsets = NO_GLITCH;
  private dimmed = false;
  /** The groan before a dimming (0 … 1), for the director's rumble. */
  rumble = 0;

  constructor(d: LateDeps, levels: ChaosStageLook, clock: number) {
    this.d = d;
    const f = d.force, L = levels, first = CHAOS_LOOK.late.previewS;
    this.phantoms = new Phantoms(L.phantom, f.phantoms, d.seed);
    this.glitches = new ReadingGlitch(L.glitch || f.phantoms, d.seed, clock, f.phantoms ? first : undefined);
    this.homes = new HomeGhosts(L.homeGhost, f.homeGhost, d.seed);
    this.dim = new LighthouseDim((L.dim || f.dimming) && !!d.baseLight, d.calm, d.seed, clock, f.dimming ? first : undefined);
    this.forced = f.phantoms;
    if (this.phantoms.on || this.homes.on) {
      this.mesh = new PhantomMesh(d.color);
      d.scene.add(this.mesh.points);
    }
  }

  /** Within reach of a crack for the false readings (anywhere in their preview). */
  private near(crack: ChaosCrackView | null, at: Point): boolean {
    return this.forced || (crack !== null && Math.hypot(crack.x - at.x, crack.z - at.z) < CHAOS_LOOK.late.phantom.reach);
  }

  /** Per frame (after the conserve layer filled the lighthouse light): dimming, readings, returns fading. */
  frame(i: LateFrameInput): void {
    const bl = this.d.baseLight;
    const lit = !!bl && bl.uBLCount.value > 0;
    const dim = this.dim.update(i.time, lit, i.suppressed);
    this.rumble = dim.rumble;
    if (bl && (dim.gain < 1 || this.dimmed)) {
      bl.uBLGain.value = BASE_LIGHT.gain * dim.gain;
      this.dimmed = dim.gain < 1;
    }
    this.offsets = this.glitches.update(i.time, this.near(i.crack, i.camera), i.suppressed);
    if (this.mesh) this.contacts.update(i.dt, i.time, i.camera);
  }

  /** Per frame, after the sonar pulses: new phantoms on a ping, due home echoes, the returns' light. */
  sonar(i: LateSonarInput): void {
    if (!this.mesh) return;
    if (i.blocked) {
      this.homes.clear();
      this.contacts.leaveAll();
    } else if (i.pings > 0) {
      this.phantoms.ping(i.pulseTime, i.diver, i.crack, this.contacts);
      this.homes.ping(i.pulseTime, i.diver, this.d.home());
    }
    const H = CHAOS_LOOK.late.homeGhost;
    for (const e of this.homes.due(i.pulseTime)) {
      this.d.pulses.echo(i.pulseTime, e.x, e.y + 20, e.z, H.gain);
      this.contacts.add(homeShape(e), i.pulseTime, 10);
      this.d.audio.play("sonar", H.sound);
    }
    this.mesh.update(this.contacts.list, this.d.pulses);
  }

  glitch(): GlitchOffsets {
    return this.offsets;
  }

  dispose(): void {
    if (this.dimmed && this.d.baseLight) this.d.baseLight.uBLGain.value = BASE_LIGHT.gain;
    this.dimmed = false;
    this.rumble = 0;
    this.mesh?.dispose();
    this.mesh = null;
  }
}
