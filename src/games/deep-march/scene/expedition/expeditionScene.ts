/**
 * The expedition in the dive (plan M4), created by world.ts only when the
 * conserve mode hands it an ExpeditionPort (the free dive never builds it):
 * node / cache drawing (nodeView.ts), absorbing (interaction.ts), the recall
 * (recall.ts), the cache beacon (beacon.ts), the tank as a survival resource
 * ("tank", mirrored from the ledger's carried pool) and the HUD telemetry.
 */
import * as THREE from "three";
import type { ExpeditionPort } from "../../conserve";
import type { ResourceSystem } from "../../survival";
import type { DensityField } from "../../terrain/density";
import { findOpenWater } from "../../terrain/openWater";
import type { SiteLayout, WorldRect } from "../../terrain/siteLayout";
import type { DiveAudio } from "../audio";
import { CacheBeacon } from "./beacon";
import { NODE_VIEW, RECALL } from "./config";
import { AbsorbInteraction, type AbsorbEvent } from "./interaction";
import { createNodeMaterial, type NodeMaterial, type NodeMaterialOptions } from "./nodeMaterial";
import { NodeView } from "./nodeView";
import { RecallSequence } from "./recall";
import { bearingDeg, relativeDeg, type ExpeditionNotice, type ExpeditionTelemetry } from "./telemetry";

export type ExpeditionSceneDeps = NodeMaterialOptions & {
  port: ExpeditionPort;
  field: DensityField;
  layout: SiteLayout;
  rect: WorldRect | null;
  resources: ResourceSystem;
  audio: DiveAudio;
  /** The canvas overlay (the blackout sits in it). */
  overlay: HTMLElement;
  lowSpec: boolean;
  /** Wake at the dive's start point (the base core once built) with a full battery. */
  respawn: () => void;
  /** Death inside the base (M5): the tank goes into storage instead of a cache; returns the particles moved, null outside. */
  safeLoss?: (at: THREE.Vector3) => number | null;
};

export type ExpeditionFrame = {
  dt: number;
  /** Seconds since the dive was created (node material clock). */
  time: number;
  ready: boolean;
  eye: THREE.Vector3;
  /** Unit view direction. */
  dir: THREE.Vector3;
  /** The diver's simulated position (the cache is left there). */
  diver: THREE.Vector3;
  absorb: boolean;
  recall: boolean;
};

const CUES: Record<Exclude<AbsorbEvent, null>, [ "switch" | "mode" | "warn", number, number]> = {
  start: ["switch", 0.22, 1.5],
  emptied: ["mode", 0.35, 1.25],
  full: ["warn", 0.3, 1.1],
  battery: ["warn", 0.3, 0.9],
};

export class ExpeditionScene {
  private readonly deps: ExpeditionSceneDeps;
  private readonly mat: NodeMaterial;
  private readonly view: NodeView;
  private readonly absorb: AbsorbInteraction;
  private readonly recall = new RecallSequence();
  private readonly beacon = new CacheBeacon();
  private readonly blackout: HTMLDivElement;
  private readonly warm: THREE.InstancedMesh;
  private notice: ExpeditionNotice | null = null;
  private noticeLeft = 0;
  private readonly eye: [number, number, number] = [0, 0, 0];
  private heading = 0;

  constructor(deps: ExpeditionSceneDeps) {
    this.deps = deps;
    this.mat = createNodeMaterial(deps);
    this.view = new NodeView(deps.field, deps.layout, deps.port, this.mat.material);
    this.absorb = new AbsorbInteraction(deps.port, deps.resources);
    deps.resources.register({ id: "tank", capacity: deps.port.tankCapacity, initial: deps.port.carried(), flags: ["hud"] });
    this.blackout = document.createElement("div");
    this.blackout.className = "dm-blackout";
    deps.overlay.appendChild(this.blackout);
    this.warm = new THREE.InstancedMesh(this.view.mesh.geometry, this.mat.material, 1);
  }

  /** The one instanced draw (add to the scene). */
  get mesh(): THREE.InstancedMesh {
    return this.view.mesh;
  }

  /** A stand-in with the same program, for the loading screen's warm compile. */
  get warmObject(): THREE.Object3D {
    return this.warm;
  }

  /** Black screen: the diver's controls are frozen. */
  busy(): boolean {
    return this.recall.busy();
  }

  update(f: ExpeditionFrame): void {
    const { port, resources, audio } = this.deps;
    this.mat.time.value = f.time;
    this.eye[0] = f.eye.x;
    this.eye[1] = f.eye.y;
    this.eye[2] = f.eye.z;
    this.heading = bearingDeg(f.dir.x, f.dir.z);
    const s = this.absorb.current();
    const highlight = s.target ? { key: s.target.key, absorbing: s.absorbing } : null;
    this.view.update(f.eye, f.time, highlight, this.deps.lowSpec ? NODE_VIEW.budgetMsLow : NODE_VIEW.budgetMs);
    const act = f.ready && !this.recall.busy();
    const ev = this.absorb.update(f.dt, this.view.visible(), this.eye, [f.dir.x, f.dir.y, f.dir.z], f.absorb, act);
    if (ev) audio.play(CUES[ev][0], { gain: CUES[ev][1], rate: CUES[ev][2] });
    this.recall.update(f.dt, f.recall, f.ready, () => this.fire(f.diver));
    if (f.ready) for (const t of this.beacon.update(f.time, port.caches(), this.eye)) audio.play("sonar", { gain: t.gain, rate: t.rate, lowpass: t.lowpass });
    const tank = resources.value("tank");
    if (tank !== port.carried()) resources.add("tank", port.carried() - tank);
    this.blackout.style.opacity = this.recall.blackout().toFixed(3);
    this.blackout.classList.toggle("on", this.recall.blackout() > 0);
    if (this.noticeLeft > 0 && (this.noticeLeft -= f.dt) <= 0) this.notice = null;
  }

  private fire(at: THREE.Vector3): void {
    const { port, field, rect } = this.deps;
    const saved = this.deps.safeLoss?.(at) ?? null;
    if (saved !== null) this.notice = saved > 0 ? { kind: "deposited", total: saved } : { kind: "recalled" };
    else {
      const spot = findOpenWater(field, at.x, at.y, at.z, rect, 2);
      const before = port.caches().length;
      const cache = port.loseCarried([spot.x, spot.y, spot.z]);
      this.notice = cache ? { kind: "lost", total: cache.total, evicted: port.caches().length === before } : { kind: "recalled" };
    }
    this.noticeLeft = RECALL.notice;
    this.deps.audio.play("warn", { gain: 0.45, rate: 0.6, lowpass: 900 });
    this.deps.respawn();
  }

  telemetry(): ExpeditionTelemetry {
    const t = this.deps.resources.view("tank");
    const s = this.absorb.current();
    const caches = this.deps.port.caches().map((c) => {
      const dx = c.pos[0] - this.eye[0], dz = c.pos[2] - this.eye[2];
      return {
        id: c.id,
        total: c.total,
        distance: Math.hypot(dx, c.pos[1] - this.eye[1], dz),
        bearing: relativeDeg(bearingDeg(dx, dz), this.heading),
        x: c.pos[0],
        z: c.pos[2],
      };
    });
    return {
      tank: { value: t.value, capacity: t.capacity, ratio: t.ratio },
      target: s.target ? { ...s.target } : null,
      absorbing: s.absorbing,
      holding: s.holding,
      blocked: s.blocked,
      caches,
      recall: { phase: this.recall.current(), progress: this.recall.progress() },
      notice: this.notice,
      drawn: this.view.visible().length,
    };
  }

  dispose(): void {
    this.absorb.dispose();
    this.view.dispose();
    this.warm.dispose();
    this.mat.dispose();
    this.blackout.remove();
  }
}
