/**
 * The base in the dive (plan M5), created by world.ts only when the conserve
 * mode hands it a BasePort (the free dive never builds it): the buildings
 * (structureInstances.ts), the lighthouse light and beams (baseLight.ts,
 * beamColumn.ts), build mode and its hologram (buildMode.ts, hologram.ts),
 * energy ticks, departures, docking, and the HUD telemetry / commands.
 */
import * as THREE from "three";
import type { BasePort, BaseView, StructureInfo } from "../../conserve";
import type { ResourceSystem } from "../../survival";
import type { DensityField } from "../../terrain/density";
import type { SiteLayout, WorldRect } from "../../terrain/siteLayout";
import type { DiveAudio } from "../audio";
import { bearingDeg, relativeDeg } from "../expedition/telemetry";
import { sweepAngle, updateBaseLight } from "./baseLight";
import { BeamColumns } from "./beamColumn";
import { BuildMode } from "./buildMode";
import { runCommand } from "./commands";
import { BASE_LIGHT, DOCK, MAX_PER_KIND } from "./config";
import { DepartureWatch, docked } from "./dock";
import { Hologram } from "./hologram";
import { homeSpawn, type HomeSpot } from "./home";
import { wallInnerRect } from "./innerRect";
import { createStructureMaterial, type StructureMaterial, type StructureMaterialOptions } from "./structureMaterial";
import { StructureInstances } from "./structureInstances";
import type { BaseCommand, BaseNotice, BaseTelemetry } from "./telemetry";

export type BaseSceneDeps = StructureMaterialOptions & {
  port: BasePort;
  field: DensityField;
  layout: SiteLayout;
  rect: WorldRect | null;
  resources: ResourceSystem;
  audio: DiveAudio;
  /** Camera far plane (m): the beams fade out before it. */
  far: number;
  /** The panel opened: release the mouse. */
  onPanel?: (open: boolean) => void;
};

export type BaseFrame = {
  dt: number;
  time: number;
  ready: boolean;
  eye: THREE.Vector3;
  dir: THREE.Vector3;
  diver: THREE.Vector3;
  /** One-shot presses this frame. */
  press: { build: boolean; kind: boolean; place: boolean; panel: boolean };
};

const NOTICE_S = 3.5;
const BIG_RECT: WorldRect = { x0: -1e6, z0: -1e6, x1: 1e6, z1: 1e6 };

export class BaseScene {
  readonly group = new THREE.Group();
  private readonly deps: BaseSceneDeps;
  private readonly mat: StructureMaterial;
  private readonly instances: StructureInstances;
  private readonly hologram: Hologram;
  private readonly beams: BeamColumns;
  private readonly build: BuildMode;
  private readonly depart = new DepartureWatch();
  private readonly births = new Map<number, number>();
  private readonly warm = new THREE.Group();
  private readonly structures: readonly StructureInfo[];
  private view: BaseView;
  private key = "";
  private panel = false;
  private notice: BaseNotice | null = null;
  private noticeLeft = 0;
  private atBase = false;
  private isDocked = false;
  private readonly eye = new THREE.Vector3();
  private heading = 0;

  constructor(deps: BaseSceneDeps) {
    this.deps = deps;
    const { port } = deps;
    this.mat = createStructureMaterial(deps);
    this.instances = new StructureInstances(this.mat.material, port.kinds, MAX_PER_KIND);
    this.hologram = new Hologram(this.instances.geometries);
    this.beams = new BeamColumns(MAX_PER_KIND, deps.far);
    this.build = new BuildMode(port, deps.field, deps.layout, wallInnerRect(deps.rect ?? BIG_RECT));
    this.group.add(this.instances.group, this.hologram.group, this.beams.mesh);
    this.group.name = "deep-march-base";
    this.view = port.view();
    this.structures = port.kinds.map((k) => port.info(k));
    for (const b of this.view.buildings) this.births.set(b.id, -1e3);
    const inst = (g: THREE.BufferGeometry, m: THREE.Material) => new THREE.InstancedMesh(g, m, 1);
    this.warm.add(inst(this.instances.geometries.core.geometry, this.mat.material), inst(this.beams.mesh.geometry, this.beams.mesh.material as THREE.Material), ...this.hologram.warmObjects());
  }

  /** Stand-ins with the building, beam and hologram programs, for the loading screen's warm compile. */
  get warmObject(): THREE.Object3D {
    return this.warm;
  }

  /** Where recall / death wakes the diver (null: no core yet, the lander spawn). */
  home(): HomeSpot | null {
    return homeSpawn(this.deps.field, this.deps.rect, this.deps.port.view(), this.deps.port.info("core").radius);
  }

  /** Death / recall at `at`: inside the base the tank goes into storage (null outside). */
  safeLoss(at: THREE.Vector3): number | null {
    return this.deps.port.inside(at.x, at.z) ? this.deps.port.depositOnDeath() : null;
  }

  /** Build mode is on (E / click places instead of absorbing). */
  building(): boolean {
    return this.build.current().active;
  }

  update(f: BaseFrame): void {
    const { port, resources } = this.deps;
    this.mat.time.value = f.time;
    this.eye.copy(f.eye);
    this.heading = bearingDeg(f.dir.x, f.dir.z);
    if (f.ready) {
      port.tick(f.dt);
      if (f.press.build) this.command({ type: "build" });
      if (f.press.kind) this.command({ type: "kind", kind: "next" });
      if (f.press.panel) this.command({ type: "panel" });
      if (f.press.place) this.command({ type: "place" });
    }
    const v = (this.view = port.view());
    this.refresh(v, f.time);
    const c = v.center;
    const dist = c ? Math.hypot(f.diver.x - c[0], f.diver.z - c[2]) : Infinity;
    this.atBase = dist <= v.radius;
    if (f.ready && c && this.depart.update(dist, v.radius)) port.recordDeparture();
    this.isDocked = f.ready && docked(v, f.diver.x, f.diver.y, f.diver.z);
    if (this.isDocked) resources.add("battery", (resources.view("battery").capacity * DOCK.charge * f.dt) / 100);
    this.build.update(f.eye, f.dir, f.time);
    this.showHologram(v, f.time);
    const lit = v.buildings.filter((b) => b.kind === "lighthouse" && b.working).map((b) => ({ x: b.pos[0], y: b.pos[1] + BASE_LIGHT.lanternY, z: b.pos[2] }));
    updateBaseLight(this.deps.baseLight, lit, f.eye, f.time, this.deps.far);
    this.beams.set(lit, sweepAngle(f.time), f.time);
    if (this.noticeLeft > 0 && (this.noticeLeft -= f.dt) <= 0) this.notice = null;
  }

  /** Re-upload the instances when a building or its working state changed. */
  private refresh(v: BaseView, time: number): void {
    const key = v.buildings.map((b) => `${b.id}${b.working ? "+" : "-"}`).join(",");
    if (key === this.key) return;
    this.key = key;
    for (const b of v.buildings) if (!this.births.has(b.id)) this.births.set(b.id, time);
    this.instances.set(v.buildings.map((b) => ({ ...b, birth: this.births.get(b.id)! })));
  }

  private showHologram(v: BaseView, time: number): void {
    const s = this.build.current();
    if (!s.active || !s.spot) return this.hologram.hide();
    const r = this.deps.port.info(s.kind).radius;
    const area = v.center ? { x: v.center[0], y: v.center[1], z: v.center[2], r: v.radius } : { x: s.spot.x, y: s.spot.y, z: s.spot.z, r: v.radius };
    this.hologram.show(s.kind, s.spot.x, s.spot.y, s.spot.z, s.spot.yaw, r, s.spot.reason === "ok", area, time);
  }

  command(cmd: BaseCommand): void {
    const r = runCommand(cmd, { port: this.deps.port, audio: this.deps.audio, build: this.build, view: this.view, atBase: this.atBase, panel: this.panel });
    if (r.panel !== this.panel) this.deps.onPanel?.((this.panel = r.panel));
    if (r.notice) (this.notice = r.notice), (this.noticeLeft = NOTICE_S);
    if (cmd.type !== "kind" && cmd.type !== "panel") this.view = this.deps.port.view();
  }

  telemetry(): BaseTelemetry {
    const { port } = this.deps;
    const v = this.view, s = this.build.current(), c = v.center;
    const dx = c ? c[0] - this.eye.x : 0, dz = c ? c[2] - this.eye.z : 0;
    const cost = this.instances.cost();
    const holo = s.active && s.spot ? 2 : 0;
    return {
      view: v,
      atBase: this.atBase,
      home: c ? { distance: Math.hypot(dx, c[1] - this.eye.y, dz), bearing: relativeDeg(bearingDeg(dx, dz), this.heading) } : null,
      docked: this.isDocked,
      build: { active: s.active, kind: s.kind, reason: s.spot?.reason ?? null, ok: s.spot?.reason === "ok", shortfall: port.shortfall(s.kind) },
      panel: this.panel,
      tide: port.tide(),
      forecast: port.forecast(),
      notice: this.notice,
      kinds: port.activeKinds,
      structures: this.structures,
      draws: cost.draws + (this.beams.mesh.count > 0 ? 1 : 0) + holo,
      triangles: cost.triangles + this.beams.mesh.count * this.beams.triangles,
    };
  }

  dispose(): void {
    this.instances.dispose();
    this.hologram.dispose();
    this.beams.dispose();
    this.mat.dispose();
    for (const o of this.warm.children) if (o instanceof THREE.InstancedMesh) o.dispose();
  }
}
