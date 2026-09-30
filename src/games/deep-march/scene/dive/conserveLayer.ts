/**
 * The conserve mode inside the dive: the expedition (M4: nodes, absorbing,
 * lost caches, recall) and the base (M5: buildings, lighthouse light, build
 * mode). Built only when the mode hands over its ports; the free dive has
 * neither and never constructs this (world.ts), so its frame stays as before.
 */
import * as THREE from "three";
import type { BasePort, ExpeditionPort } from "../../conserve";
import type { ResourceSystem } from "../../survival";
import type { DensityField } from "../../terrain/density";
import type { SiteLayout, WorldRect } from "../../terrain/siteLayout";
import type { DiveAudio } from "../audio";
import { ExpeditionScene } from "../expedition/expeditionScene";
import type { NodeMaterialOptions } from "../expedition/nodeMaterial";
import type { BaseLightUniforms } from "../base/baseLight";
import { BaseScene } from "../base/baseScene";
import type { HomeSpot } from "../base/home";
import type { InputController } from "../input";

export type ConserveLayerDeps = NodeMaterialOptions & {
  expedition: ExpeditionPort;
  base: BasePort | null | undefined;
  field: DensityField;
  layout: SiteLayout;
  rect: WorldRect | null;
  resources: ResourceSystem;
  audio: DiveAudio;
  overlay: HTMLElement;
  lowSpec: boolean;
  baseLight: BaseLightUniforms;
  /** Camera far plane (m). */
  far: number;
  /** After a recall: put the diver at `home` (base core) or, with no base, the lander spawn (null). */
  respawn: (home: HomeSpot | null) => void;
  /** The base panel opened: release the mouse. */
  releaseLock: () => void;
};

export type ConserveFrame = {
  dt: number;
  time: number;
  ready: boolean;
  camera: THREE.Camera;
  diver: THREE.Vector3;
  input: InputController;
};

export class ConserveLayer {
  readonly expedition: ExpeditionScene;
  readonly base: BaseScene | null;
  private readonly viewDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, d: ConserveLayerDeps) {
    const materials = { water: d.water, fog: d.fog, sonar: d.sonar, beam: d.beam, absorb: d.absorb };
    const world = { field: d.field, layout: d.layout, rect: d.rect, resources: d.resources, audio: d.audio };
    this.expedition = new ExpeditionScene({
      port: d.expedition,
      ...world,
      overlay: d.overlay,
      lowSpec: d.lowSpec,
      ...materials,
      // M5: back at the base core once it stands, else the lander spawn
      respawn: () => d.respawn(this.home()),
      safeLoss: d.base ? (at) => this.base?.safeLoss(at) ?? null : undefined,
    });
    scene.add(this.expedition.mesh);
    this.base = d.base
      ? new BaseScene({
          port: d.base,
          ...world,
          ...materials,
          baseLight: d.baseLight,
          far: d.far,
          onPanel: (open) => {
            if (open) d.releaseLock();
          },
        })
      : null;
    if (this.base) scene.add(this.base.group);
  }

  /** E / left mouse (captured) absorb, X recall; with a base also G build mode, T building kind, Q base panel. */
  holdKeys(): string[] {
    return ["KeyE", "Mouse0", "KeyX", ...(this.base ? ["KeyG", "KeyT", "KeyQ"] : [])];
  }

  /** Stand-ins for the system check's warm compile. */
  warmObjects(): THREE.Object3D[] {
    return this.base ? [this.expedition.warmObject, this.base.warmObject] : [this.expedition.warmObject];
  }

  /** The base core's spawn once it stands. */
  home(): HomeSpot | null {
    return this.base?.home() ?? null;
  }

  /** The recall's black screen: no movement. */
  busy(): boolean {
    return this.expedition.busy();
  }

  /** Per frame, after the camera sync: base presses first (E / click place while building), then absorbing. */
  update(f: ConserveFrame): void {
    const { base, expedition } = this;
    const input = f.input;
    if (base) {
      const act = f.ready && !expedition.busy();
      const press = (code: string) => input.takePress(code) && act;
      const place = press("KeyE") || press("Mouse0");
      base.update({
        dt: f.dt,
        time: f.time,
        ready: f.ready,
        eye: f.camera.position,
        dir: f.camera.getWorldDirection(this.viewDir),
        diver: f.diver,
        press: { build: press("KeyG"), kind: press("KeyT"), panel: press("KeyQ"), place: place && base.building() },
      });
    }
    const absorbHeld = !base?.building() && (input.held("KeyE") || input.held("Mouse0") || input.panel.absorb);
    expedition.update({
      dt: f.dt,
      time: f.time,
      ready: f.ready,
      eye: f.camera.position,
      dir: f.camera.getWorldDirection(this.viewDir),
      diver: f.diver,
      absorb: absorbHeld,
      recall: input.held("KeyX") || input.panel.recall,
    });
  }

  dispose(): void {
    this.expedition.dispose();
    this.base?.dispose();
  }
}
