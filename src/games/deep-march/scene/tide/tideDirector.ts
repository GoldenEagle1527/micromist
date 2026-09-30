/**
 * The tide in the dive (plan M7; design doc §5.5, §5.6): drives the session's
 * tide each frame and carries out its events on the scene —
 * - precompute: gen + 1's terrain starts streaming, hidden, on the same
 *   workers (nextTerrain.ts); its readiness is the tide's `nextReady`;
 * - commit (gen + 1 is on disk): the conserve layer is rebuilt on the new
 *   generation's expedition and base (its nodes hidden until the end), no
 *   LOD crossfades while the front runs;
 * - swap (P4, or in the murk's dark): terrain, collision, HUD lookups and
 *   the wall ring switch to gen + 1; the old columns are freed;
 * - done: nodes back, normal streaming, the summary on the HUD.
 * The dome's rule is the tide's (conserve/tide/dome.ts): a particle-ized
 * diver is held still in the dark and wakes at the core, battery full.
 */
import type * as THREE from "three";
import type { BasePort, ChaosView, ExpeditionPort, TidePort, TideView } from "../../conserve";
import type { ChunkManager } from "../../terrain/chunks";
import type { TerrainSettings } from "../../terrain/config";
import type { DensityField } from "../../terrain/density";
import type { PoolRouter } from "../../terrain/poolRouter";
import { needsChaosProgram, type ChaosDirector } from "../chaos/chaosDirector";
import type { ConserveLayer } from "../dive/conserveLayer";
import type { DiverController } from "../diver";
import { TIDE_VIEW } from "./config";
import { NextTerrain } from "./nextTerrain";
import type { TideTelemetry } from "./telemetry";
import { TideVisuals, type VisualsDeps } from "./tideVisuals";

/** The parts of the dive that follow the generation (the loop and the handle read them through `get`). */
export type GenerationSlots = { field: DensityField; chunks: ChunkManager; conserve: ConserveLayer | null };

export type TideDirectorDeps = Omit<VisualsDeps, "timeline"> & {
  port: TidePort;
  camera: THREE.Camera;
  router: PoolRouter;
  settings: TerrainSettings;
  diver: DiverController;
  /** ?tide=simple, and a low-memory device (navigator.deviceMemory): the murk from the start. */
  start: { simple: boolean; lowMemory: boolean };
  gpuLost: () => boolean;
  pxPerM: () => number;
  get: () => GenerationSlots;
  /** A new conserve layer on these ports and field (added to the scene). */
  conserveLayer: (ports: { expedition: ExpeditionPort; base: BasePort }, field: DensityField) => ConserveLayer;
  /** The switch: the new terrain, field and layer become the dive's (HUD lookups, wall ring, loop, handle). */
  bind: (next: GenerationSlots) => void;
  /** Wake at the base core, battery full. */
  wake: () => void;
  /** M8: the chaos presentation (gets gen + 1's chaos at the switch), or null. */
  chaos: ChaosDirector | null;
  /** Compile programs ahead of use (gen + 1's chaos variant at the precompute: no hitch at the switch). */
  warm: (materials: THREE.Material[]) => void;
};

export class TideDirector {
  private readonly d: TideDirectorDeps;
  private readonly visuals: TideVisuals;
  private next: NextTerrain | null = null;
  /** gen + 1's chaos, read at the precompute (the pending plan is gone by the end). */
  private nextChaos: ChaosView | null = null;
  private warmed = false;
  private view: TideView | null = null;
  private running = false;
  private summaryLeft = 0;

  constructor(d: TideDirectorDeps) {
    this.d = d;
    this.visuals = new TideVisuals({ ...d, timeline: d.port.timeline });
  }

  get warmObjects(): THREE.Object3D[] {
    return this.visuals.warmObjects;
  }

  /** 唤潮 (the base panel's button; the base checks the diver is at the base). */
  call(): boolean {
    if (this.running || !this.d.port.call(this.d.start)) return false;
    this.running = true;
    return true;
  }

  active(): boolean {
    return this.running;
  }

  /** Per frame after the terrain / occlusion update: rawMs = the last frame interval (the governor). */
  update(dt: number, rawMs: number, time: number): void {
    if (this.summaryLeft > 0) this.summaryLeft -= dt;
    if (!this.running) return;
    const { diver, camera } = this.d;
    const at = diver.position;
    if (this.next && !this.view?.swapped) this.next.update(at, camera, dt);
    const v = (this.view = this.d.port.step({ dt, nextReady: this.next?.ready(at) ?? false, frameMs: rawMs, contextLost: this.d.gpuLost(), diver: { x: at.x, z: at.z } }));
    for (const e of v.events) {
      if (e === "precompute") this.precompute(v.gen + 1);
      else if (e === "commit") this.commit();
      else if (e === "swap") this.swap();
    }
    const layer = this.d.get().conserve;
    if (layer) {
      layer.tide.lock = v.committed && !v.events.includes("done");
      layer.tide.hold = v.fate !== "free";
    }
    this.visuals.frame(v, this.d.get().chunks, at, time, dt, this.d.pxPerM());
    if (v.wake) this.d.wake();
    if (v.events.includes("done")) this.finish();
  }

  private precompute(gen: number): void {
    const layout = this.d.port.nextLayout();
    if (!layout) return;
    const { scene, router, seed, settings, seabed, lowSpec } = this.d;
    this.nextChaos = this.d.port.nextChaos();
    const chaos = needsChaosProgram(this.nextChaos);
    const variant = seabed.variant(chaos);
    if (chaos && !this.warmed && variant.material !== seabed.material) {
      this.warmed = true;
      this.d.warm([variant.material, variant.fadeMaterial().material]);
    }
    this.next = new NextTerrain(scene, router, seed, settings, layout, gen, variant, lowSpec);
  }

  private commit(): void {
    const s = this.d.get();
    s.chunks.loading = true;
    s.conserve?.dispose();
    const layer = this.d.conserveLayer(this.d.port.ports(), this.next?.field ?? s.field);
    layer.expedition.mesh.visible = false;
    this.d.bind({ ...s, conserve: layer });
  }

  private swap(): void {
    const next = this.next;
    if (!next) return;
    const old = this.d.get();
    next.show();
    this.visuals.front.clear(old.chunks.baseMaterial);
    this.d.diver.setField(next.field, (gi, gj, gk) => next.chunks.isRemovedPoint(gi, gj, gk));
    this.d.bind({ field: next.field, chunks: next.chunks, conserve: old.conserve });
    old.chunks.dispose();
    this.d.chaos?.setView(this.nextChaos);
  }

  private finish(): void {
    const s = this.d.get();
    this.visuals.end(s.chunks.baseMaterial);
    s.chunks.loading = false;
    if (s.conserve) {
      s.conserve.expedition.mesh.visible = true;
      s.conserve.tide.lock = s.conserve.tide.hold = false;
    }
    this.next = null;
    this.running = false;
    this.summaryLeft = TIDE_VIEW.summaryS;
  }

  telemetry(): TideTelemetry {
    const v = this.view, port = this.d.port;
    const running = this.running && !!v;
    const base = this.d.get().conserve?.base?.telemetry();
    const showSummary = this.summaryLeft > 0 || (running && v!.phase === "settle");
    return {
      state: running ? v!.state : "idle",
      left: running ? v!.left : 0,
      extended: running && v!.extended,
      phase: running ? v!.phase : null,
      u: running ? v!.u : 0,
      fallback: running ? v!.fallback : null,
      zone: running ? (v!.dome?.zone ?? null) : null,
      fate: running ? v!.fate : "free",
      fateU: running ? v!.fateU : 0,
      gen: v?.gen ?? 0,
      summary: showSummary ? port.summary() : null,
      callable: !this.running && !!base?.atBase && port.readiness().ready,
    };
  }

  dispose(): void {
    this.visuals.dispose();
    this.next?.dispose();
    this.next = null;
  }
}
