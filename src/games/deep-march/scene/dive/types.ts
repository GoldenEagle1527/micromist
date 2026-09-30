/**
 * The dive's public surface (scene/world.ts): options, HUD labels, telemetry,
 * the loading snapshot and the handle the page drives. Types only.
 */
import type { BasePort, ChaosView, ExpeditionPort, TidePort } from "../../conserve";
import type { LightMode, LightState, SonarState } from "../../survival";
import type { RegionField, RegionKey } from "../../terrain/regions";
import type { SiteLayout, WorldRect } from "../../terrain/siteLayout";
import type { EnvironmentKind, SurfaceType } from "../../terrain/terrainInfo";
import type { AudioStatus } from "../audio";
import type { BaseCommand, BaseTelemetry } from "../base/telemetry";
import type { TideTelemetry } from "../tide/telemetry";
import type { DiverState } from "../diver";
import type { ExpeditionTelemetry } from "../expedition/telemetry";
import type { GpuInfo } from "../gpuDiagnostics";
import type { PanelInput } from "../input";
import type { MaterialStatus } from "../materialLibrary";
import type { DebugParts, DebugPort } from "../../debug/types";
import type { ScanStore } from "../sonarScan/scanStore";

export type HudLabels = {
  chunks: string;
  floaters: string;
  tris: string;
  mainThread: string;
  classify: string;
  spawnDebugTitle: string;
  surfaceTypes: Record<SurfaceType, string>;
  regionDebugTitle: string;
  regionNames: Record<RegionKey, string>;
  regionEdge: string;
  lockPrompt: string;
  /** In-game alert: WebGL context lost (GPU reset). */
  gpuLost: string;
  /** In-game alert: a shader program failed to build during the dive. */
  shaderFailed: string;
};

export type DeepMarchOptions = {
  seed: number;
  sensitivity: number;
  invertY: boolean;
  panel: boolean;
  labels: HudLabels;
  /** Created inside the dive-start click so the browser allows playback. Null skips audio. */
  audioContext?: AudioContext | null;
  /** Initial volume / mute (settings.ts); later changes via handle.setSound. */
  sound?: { muted: boolean; volume: number };
  /** M key: the page owns (and persists) the mute state. */
  onMuteToggle?: () => void;
  /** Bounded world: explicit site layout (terrain/siteLayout.ts); omitted = the endless free dive. */
  world?: SiteLayout | null;
  /** Conserve mode: this generation's nodes, tank and lost caches (scene/expedition); null / omitted in the free dive. */
  expedition?: ExpeditionPort | null;
  /** Conserve mode (M5): the base — buildings, storage, energy (scene/base); needs `expedition`. */
  base?: BasePort | null;
  /** Conserve mode (M7): the tide (唤潮, the show, gen + 1); needs `base`. */
  tide?: TidePort | null;
  /** Conserve mode (M8): this generation's chaos as the scene presents it (conserve/chaos/view.ts). */
  chaos?: ChaosView | null;
  /** 「减弱灯光起伏」 (settings.ts): shallower, slower light changes near cracks. */
  calmLights?: boolean;
  /** Where the sonar scan record lives: conserve passes the save's store; omitted = this session (free dive). */
  scans?: ScanStore | null;
  /** Staging debug panel (debug/port.ts): builds the handle's `debug` port from what the dive lends. Production builds never pass it. */
  debug?: ((parts: DebugParts) => DebugPort) | null;
};

export type Telemetry = {
  depth: number;
  heading: number;
  pitch: number;
  speed: number;
  state: DiverState;
  contact: "floor" | "ceiling" | "wall" | null;
  /** Stable terrain classification around the diver (null until first evaluation). */
  terrain: EnvironmentKind | null;
  /** Macro region under the diver (switches once the new region dominates, no flicker on borders). */
  region: RegionKey | null;
  lamp: boolean;
  light: LightState;
  /** Active sonar: unit equipped, ready, cooldown (survival/sonarPing.ts). */
  sonar: SonarState;
  /** Sonar observation mode (N) and the points recorded so far. */
  scan: { observe: boolean; points: number };
  battery: { value: number; capacity: number; ratio: number; rate: number; low: boolean };
  swimLatch: boolean;
  ready: boolean;
  /** Simulated ticks so far (20/s of sim time). */
  ticks: number;
  x: number;
  y: number;
  z: number;
};

/** Raw initialization state for the loading screen (ui/loading), polled per frame. */
export type LoadingSnapshot = {
  seed: number;
  spawn: { x: number; y: number; z: number };
  /** Macro region field of this world (world units) for the region map. */
  regions: RegionField;
  /** Bounded world rectangle (world units), null for the endless free dive. */
  world: WorldRect | null;
  /** Lost caches (world x / z) for the map; empty without an expedition. */
  caches: { x: number; z: number }[];
  materials: MaterialStatus;
  /** Terrain around the spawn: gate items done / total, and the gate itself. */
  terrain: { done: number; total: number; ready: boolean };
  system: {
    battery: number;
    lamps: LightMode[];
    sonar: boolean;
    /** Points in the sonar scan record the dive starts with (conserve: from the save). */
    scanPoints?: number;
    /** Program compile / link check finished. */
    shaders: boolean;
    /** A program failed to build: program / fragment / vertex info logs. */
    shaderError: string | null;
    /** Renderer string and key limits. */
    gpu: GpuInfo;
    /** WebGL context lost (GPU reset / out of memory). */
    gpuLost: boolean;
  };
  /** Sound clips (optional: settles on failure / timeout, never holds the dive for long). */
  audio: AudioStatus;
  /** Everything above is ready: the dive can start (startDive). */
  loaded: boolean;
  /** The dive started (simulation running). */
  diving: boolean;
};

export type DeepMarchHandle = {
  /** Loading-screen state (textures, terrain, system check). */
  loading: () => LoadingSnapshot;
  /** Leave the loading screen: the simulation starts once everything is loaded. */
  startDive: () => void;
  /** After a final texture download failure: try the failed layers again. */
  retryMaterials: () => void;
  destroy: () => void;
  /** Analog state from the on-screen panel. */
  panelInput: PanelInput;
  setPanelMode: (on: boolean) => void;
  /** Push new UI strings (language change) to the canvas overlay and debug legend. */
  setLabels: (labels: HudLabels) => void;
  addLook: (dxPx: number, dyPx: number, touch: boolean) => void;
  toggleLamp: () => boolean;
  /** Next available light mode (turns the light on). */
  cycleLight: () => LightMode;
  /** Sonar ping (key 3); false if refused (cooldown, battery, no unit). */
  ping: () => boolean;
  /** Sonar observation mode on / off (key N); returns the new state (refused while loading or during a tide). */
  toggleObserve: () => boolean;
  toggleSwimLatch: () => boolean;
  /** Master volume 0..1 / mute. */
  setSound: (s: { muted: boolean; volume: number }) => void;
  telemetry: () => Telemetry;
  /** Tank, aim target, caches, recall (null in the free dive). */
  expedition: () => ExpeditionTelemetry | null;
  /** Buildings, storage, energy, build mode (null in the free dive). */
  base: () => BaseTelemetry | null;
  /** HUD buttons (build, place, storage moves, demolish); ignored in the free dive. */
  baseCommand: (cmd: BaseCommand) => void;
  /** The tide: countdown, phase, dome, summary (null in the free dive). */
  tide: () => TideTelemetry | null;
  /** Staging debug panel's runtime port (teleport, light, overlay, battery); null without `opts.debug`. */
  debug: DebugPort | null;
};
