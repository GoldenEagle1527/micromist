/**
 * 直视 in the dive (design doc §4.6, §7.3, §9.1): drives the session's gaze
 * each frame and presents it —
 *  - the eye beyond the main breach (eyeMesh.ts): turns from past the world to
 *    the base over the first 90 s, then its slit follows the diver's lamp;
 *    a chaos preview at stage 5 shows it too (visual only, nothing ticks);
 *  - the anchors (anchorMesh.ts): hold interact near one to light it;
 *  - the berserk swarm on the sonar (berserk.ts) and the atmosphere (atmosphere.ts);
 *  - 封界: both conditions held and the diver under the dome → the 封界潮
 *    (the tide director's own call); the eye closes during it;
 *  - 湮灭: the conserve layer locks, the veil closes; the HUD runs the ending.
 */
import type * as THREE from "three";
import type { BasePort, ChaosCrackView, GazePort, GazeView } from "../../conserve";
import type { ChaosDirector } from "../chaos/chaosDirector";
import type { ConserveLayer } from "../dive/conserveLayer";
import type { FogUniforms } from "../fog";
import type { InputController } from "../input";
import type { SonarPulses, SonarUniforms } from "../sonar";
import type { TideDirector } from "../tide/tideDirector";
import { AnchorMesh } from "./anchorMesh";
import { GazeAtmosphere, type AtmosphereDeps } from "./atmosphere";
import { GazeSwarm } from "./berserk";
import { GAZE_LOOK } from "./config";
import { EyeCurtain } from "./eyeMesh";
import type { GazeTelemetry } from "./telemetry";

export type GazeDirectorDeps = AtmosphereDeps & {
  /** The session's gaze (null: none in this dive). */
  port: GazePort | null;
  chaos: ChaosDirector;
  scene: THREE.Scene;
  fog: FogUniforms;
  sonar: SonarUniforms;
  long: SonarPulses;
  tide: () => TideDirector | null;
  base: () => BasePort | null;
  layer: () => ConserveLayer | null;
  input: () => InputController | null;
  lampOn: () => boolean;
};

export type GazeFrameInput = { dt: number; time: number; ready: boolean; camera: THREE.Vector3; diver: THREE.Vector3 };

export class GazeDirector {
  private readonly d: GazeDirectorDeps;
  private readonly eye: EyeCurtain;
  private readonly anchors = new AnchorMesh();
  private readonly swarm: GazeSwarm;
  private readonly air: GazeAtmosphere;
  private view: GazeView | null = null;
  private slit = 0.45;
  private sealing = false;
  private sealed = false;
  private closing = 0;
  private endedFor = 0;

  constructor(d: GazeDirectorDeps) {
    this.d = d;
    this.eye = new EyeCurtain(d.fog);
    this.swarm = new GazeSwarm({ sonar: d.sonar, long: d.long });
    this.air = new GazeAtmosphere(d);
    d.scene.add(this.eye.mesh, this.anchors.mesh, this.swarm.mesh);
  }

  /** Per frame, after the chaos frame (its sound floors are read by the chaos sonar after). */
  frame(i: GazeFrameInput): void {
    const tide = this.d.tide(), tideOn = tide?.active() ?? false;
    const g = (this.view = this.tick(i, tideOn));
    if (this.sealing && !tideOn) [this.sealing, this.sealed] = [false, true];
    if (g?.sealReady && !tideOn && i.ready && (g.anywhere || this.underDome(i.diver))) this.sealing = tide?.call() ?? false;
    this.closing = this.sealing ? this.closing + i.dt : 0;
    const center = this.center(i.diver);
    this.drawEye(i, g, center);
    this.anchors.update(g?.active ? { anchors: g.anchors, camera: i.camera, time: i.time, reach: g.reach, hold: g.hold } : null);
    this.swarm.update({ center, view: g ?? IDLE, time: i.time, sonar: this.d.long.count > 0 ? 1 : 0, presence: g?.active && !tideOn ? 1 : 0 });
    if (g?.ended) this.end(i.dt);
    else this.air.frame(g, center, i.camera, tideOn);
  }

  telemetry(): GazeTelemetry | null {
    const g = this.view;
    return g && (g.active || g.ended || this.sealing || this.sealed) ? { ...g, sealing: this.sealing, sealed: this.sealed, endedFor: this.endedFor } : null;
  }

  private tick(i: GazeFrameInput, tide: boolean): GazeView | null {
    const p = this.d.port;
    if (!p) return null;
    if (!i.ready) return p.view();
    const input = this.d.input();
    const interact = !!input && (input.held("KeyE") || input.held("Mouse0") || input.panel.absorb);
    return p.tick({ dt: i.dt, diver: { x: i.diver.x, y: i.diver.y, z: i.diver.z }, interact, tide });
  }

  private underDome(diver: THREE.Vector3): boolean {
    const b = this.d.base();
    return !b?.view().founded || b.inside(diver.x, diver.z);
  }

  private center(diver: THREE.Vector3): { x: number; y: number; z: number } {
    const c = this.d.base()?.view().center;
    return c ? { x: c[0], y: c[1], z: c[2] } : { x: diver.x, y: diver.y, z: diver.z };
  }

  private drawEye(i: GazeFrameInput, g: GazeView | null, center: { x: number; y: number; z: number }): void {
    const L = GAZE_LOOK.eye, v = this.d.chaos.current();
    const breach: ChaosCrackView | null = v?.stage === 5 ? (v.cracks.find((c) => c.breach) ?? null) : null;
    if (!breach || !v) return this.eye.update(null, 0, { camera: i.camera, target: center, turn: 0, slit: 0, presence: 0, time: i.time });
    const clock = g ? g.elapsed : v.preview ? i.time - L.previewDelay : 0;
    const turn = Math.min(1, Math.max(0, clock / L.turnS));
    const want = this.sealing ? 0 : turn < 1 ? 0.45 : g?.phase === 3 ? 0.95 : this.d.lampOn() ? 0 : 0.55;
    this.slit += (want - this.slit) * (1 - Math.exp(-i.dt / L.pupilS));
    const presence = this.sealing ? Math.max(0, 1 - this.closing / L.closeS) : 1;
    this.eye.update(breach, v.wallThickness, { camera: i.camera, target: { x: center.x, y: center.y + 20, z: center.z }, turn, slit: this.slit, presence, time: i.time });
  }

  /** 湮灭: nothing more to do in this world — locked, held, the veil closing. */
  private end(dt: number): void {
    this.endedFor += dt;
    const layer = this.d.layer();
    if (layer) [layer.tide.lock, layer.tide.hold] = [true, this.endedFor > 3];
    this.air.ending(this.endedFor);
  }

  dispose(): void {
    this.air.dispose();
    this.eye.dispose();
    this.anchors.dispose();
    this.swarm.dispose();
  }
}

const IDLE: GazeView = {
  active: false, phase: 0, phaseU: 0, elapsed: 0, left: 0, forecastM: 0, sealM: 0, anchors: [], lit: 0, sealReady: false,
  anywhere: false, price: [], reach: -1, hold: 0, short: false, squeeze: null, ended: false,
};
