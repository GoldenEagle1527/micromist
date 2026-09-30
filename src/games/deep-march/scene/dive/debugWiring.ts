/**
 * The staging debug panel's port on a running dive (debug/port.ts builds it from
 * what the dive lends here). Only when the page passes the factory
 * (DeepMarchOptions.debug) — production builds never do, so this stays unused.
 * Reads the generation-bound parts through the loop's and the handle's objects,
 * which the tide rebinds at its switch to gen + 1.
 */
import { SURVIVAL_TUNING } from "../../survival";
import type { DebugPort } from "../../debug/types";
import type { ChaosDirector } from "../chaos/chaosDirector";
import type { DiveParts } from "./diveLoop";
import type { HandleParts } from "./handle";
import type { DeepMarchOptions } from "./types";

type Lent = { handle: HandleParts; loop: DiveParts; chaos: ChaosDirector | null; spawnAt: { x: number; y: number; z: number; yaw: number }; worldScale: number; conserve: boolean };

export function debugPortOf(factory: DeepMarchOptions["debug"], w: Lent): DebugPort | null {
  if (!factory) return null;
  const { handle: h, loop, diver } = { ...w, diver: w.handle.diver };
  return factory({
    solid: (x, y, z) => h.field.sample(x, y, z) >= h.field.settings.isoLevel,
    worldScale: w.worldScale,
    world: () => h.chunks.worldRect,
    chaos: () => w.chaos?.current() ?? null,
    spawn: w.spawnAt,
    home: () => loop.conserve?.home() ?? null,
    position: () => diver.position,
    place: (p) => {
      diver.spawnAt(p.x, p.y, p.z, p.yaw);
      diver.setView(p.yaw, p.pitch);
    },
    lights: h.survival.lights,
    ping: () => h.survival.sonar.queue(),
    markers: loop.spawnDebug,
    fillBattery: () => h.survival.resources.add("battery", SURVIVAL_TUNING.battery.capacity),
    conserve: w.conserve,
  });
}
