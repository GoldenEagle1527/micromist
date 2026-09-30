/**
 * The staging debug panel's contract with the dive (types only). A dive lends
 * DebugParts to the panel's factory (DeepMarchOptions.debug, port.ts) and hands the
 * resulting DebugPort out on its handle. Production builds never load the panel,
 * never pass a factory, and so no dive there builds a port.
 */
import type { ChaosView } from "../conserve";
import type { LightMode } from "../survival";
import type { WorldRect } from "../terrain/siteLayout";

/** A place and a view (world metres, radians; yaw 0 faces −z / north, pitch 0 level). */
export type Pose = { x: number; y: number; z: number; yaw: number; pitch: number };

/** Density test of the current generation's terrain: true inside rock. */
export type Solid = (x: number, y: number, z: number) => boolean;

/** What a dive lends the panel (scene/world.ts). Getters follow the tide's switch to gen + 1. */
export type DebugParts = {
  solid: Solid;
  /** Terrain units → metres (the vertical search range scales with it). */
  worldScale: number;
  /** Bounded world rectangle, null in the endless free dive. */
  world: () => WorldRect | null;
  /** Conserve: the chaos the dive draws (open cracks), else null. */
  chaos: () => ChaosView | null;
  /** The lander spawn (free dive: the start). */
  spawn: { x: number; y: number; z: number; yaw: number };
  /** Conserve: the base core's home spot once it stands, else null. */
  home: () => { x: number; y: number; z: number; yaw: number } | null;
  position: () => { x: number; y: number; z: number };
  /** Put the diver there (velocity cleared, collisions resolved). */
  place: (p: Pose) => void;
  lights: {
    state(): { mode: LightMode; on: boolean; available: readonly LightMode[] };
    select(m: LightMode): LightMode;
    setOn(on: boolean): boolean;
  };
  /** A sonar ping from the diver, bypassing its battery cost and cooldown. */
  ping: () => void;
  /** The spawn-candidate / region overlay (the B key). */
  markers: { readonly visible: boolean; setVisible(on: boolean): void };
  /** Battery to full (the dive's own resource: not in any save). */
  fillBattery: () => void;
  conserve: boolean;
};

export type TargetKind = "spawn" | "base" | "crack" | "edge" | "corner";
/** A teleport destination; `key`: crack number (1…), edge n/e/s/w, corner ne/nw/se/sw; `pose()` searches the terrain (on use). */
export type TeleportTarget = { kind: TargetKind; key: string; pose: () => Pose };

export type LightChoice = LightMode | "off";

/** The runtime half of the panel (debug/port.ts): acts on the running dive at once. */
export type DebugPort = {
  conserve: boolean;
  targets(): TeleportTarget[];
  /** Teleport to a pose made safe (above the seabed, not in rock); returns where the diver ended. */
  teleport(p: Pose): Pose;
  position(): { x: number; y: number; z: number };
  light(): LightChoice;
  lightChoices(): LightChoice[];
  setLight(c: LightChoice): void;
  /** A free sonar ping (no battery, no cooldown). */
  ping(): void;
  markers(): boolean;
  setMarkers(on: boolean): void;
  fillBattery(): void;
};
