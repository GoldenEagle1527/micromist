/** The dive's handle for the React shell: loading snapshot, controls, telemetry. */
import type { DensityField } from "../../terrain/density";
import type { ChunkManager } from "../../terrain/chunks";
import { SURVIVAL_TUNING, type LightMode, type Survival } from "../../survival";
import type { DiveAudio } from "../audio";
import type { DiverController } from "../diver";
import type { InputController } from "../input";
import type { MaterialLibrary } from "../materialLibrary";
import type { SonarUniforms } from "../sonar";
import type { ConserveLayer } from "./conserveLayer";
import type { TideDirector } from "../tide/tideDirector";
import type { GpuHealth } from "./gpuHealth";
import type { HudChips } from "./hudChips";
import type { LoadingGate } from "./loadingGate";
import type { DeepMarchHandle, DeepMarchOptions, HudLabels, LoadingSnapshot, Telemetry } from "./types";
import type { DebugPort } from "../../debug/types";

export type HandleParts = {
  opts: DeepMarchOptions;
  startAt: { x: number; y: number; z: number };
  field: DensityField;
  chunks: ChunkManager;
  conserve: ConserveLayer | null;
  tide: TideDirector | null;
  materials: MaterialLibrary;
  gate: LoadingGate;
  health: GpuHealth;
  survival: Survival;
  sonar: SonarUniforms;
  audio: DiveAudio;
  input: InputController;
  diver: DiverController;
  hud: HudChips;
  controls: { toggleLamp: () => boolean; cycleLight: () => LightMode };
  updatePrompt: () => void;
  setLabels: (labels: HudLabels) => void;
  destroy: () => void;
  /** Staging debug panel's port (opts.debug), else null. */
  debug: DebugPort | null;
};

function systemState(p: HandleParts): LoadingSnapshot["system"] {
  const avail = p.survival.lights.available();
  return {
    battery: p.survival.resources.view("battery").ratio,
    lamps: avail.filter((m) => m !== "sonar"),
    sonar: avail.includes("sonar") && p.sonar.uSonarPulse.value.length > 0,
    shaders: p.health.shadersReady,
    shaderError: p.health.shaderError,
    gpu: p.health.gpu,
    gpuLost: p.health.gpuLost,
  };
}

function loadingSnapshot(p: HandleParts): LoadingSnapshot {
  const { gate, startAt } = p;
  const tp = gate.terrainProgress();
  const system = systemState(p);
  const mat = p.materials.status();
  const snd = gate.audioGate();
  const expedition = p.conserve?.expedition;
  return {
    seed: p.opts.seed,
    spawn: { x: startAt.x, y: startAt.y, z: startAt.z },
    regions: p.field.regions,
    world: p.chunks.worldRect,
    caches: expedition ? expedition.telemetry().caches.map((c) => ({ x: c.x, z: c.z })) : [],
    materials: mat,
    terrain: { done: tp.done, total: tp.total, ready: gate.terrainReady },
    system,
    audio: snd,
    loaded: gate.terrainReady && mat.ready && system.shaders && !system.shaderError && !system.gpuLost && snd.settled,
    diving: gate.ready,
  };
}

function telemetry(p: HandleParts): Telemetry {
  const { diver, survival } = p;
  const light = survival.lights.state();
  const b = survival.resources.view("battery");
  return {
    depth: 100 - diver.position.y,
    heading: ((((-diver.yaw * 180) / Math.PI) % 360) + 360) % 360,
    pitch: (diver.pitch * 180) / Math.PI,
    speed: diver.speed,
    state: diver.state,
    contact: diver.contact,
    terrain: p.hud.terrain,
    region: p.hud.region,
    lamp: light.on,
    light,
    battery: { value: b.value, capacity: b.capacity, ratio: b.ratio, rate: b.rate, low: b.ratio <= SURVIVAL_TUNING.battery.lowFraction },
    swimLatch: p.input.panel.swimLatch,
    ready: p.gate.ready,
    ticks: diver.totalTicks,
    x: diver.position.x,
    y: diver.position.y,
    z: diver.position.z,
  };
}

export function createHandle(p: HandleParts): DeepMarchHandle {
  const { input } = p;
  return {
    loading: () => loadingSnapshot(p),
    startDive: () => {
      p.gate.diveRequested = true;
    },
    retryMaterials: () => p.materials.retry(),
    panelInput: input.panel,
    setPanelMode: (on) => {
      input.panelMode = on;
      if (on) input.releaseLock();
      p.updatePrompt();
    },
    setLabels: p.setLabels,
    addLook: (dx, dy, touch) => input.addLookPx(dx, dy, touch),
    toggleLamp: p.controls.toggleLamp,
    cycleLight: p.controls.cycleLight,
    toggleSwimLatch: () => {
      input.panel.swimLatch = !input.panel.swimLatch;
      return input.panel.swimLatch;
    },
    setSound: (s) => p.audio.setSound(s),
    telemetry: () => telemetry(p),
    expedition: () => p.conserve?.expedition.telemetry() ?? null,
    base: () => p.conserve?.base?.telemetry() ?? null,
    baseCommand: (cmd) => p.conserve?.base?.command(cmd),
    tide: () => p.tide?.telemetry() ?? null,
    debug: p.debug,
    destroy: p.destroy,
  };
}
