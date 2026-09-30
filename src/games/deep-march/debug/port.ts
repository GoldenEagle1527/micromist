/**
 * The debug panel's runtime port: what the panel does to the running dive at
 * once (teleport, light mode, a free sonar ping, the B overlay, battery). Built by the dive from
 * the parts it lends (scene/world.ts → DeepMarchOptions.debug); only staging
 * builds pass this factory. Nothing here writes a save.
 */
import { heightRange, placeSafely, teleportTargets } from "./teleport";
import type { DebugParts, DebugPort, LightChoice, Pose } from "./types";

export function createDebugPort(p: DebugParts): DebugPort {
  const h = heightRange(p.worldScale);
  return {
    conserve: p.conserve,
    targets: () => teleportTargets(p.solid, { spawn: p.spawn, home: p.home(), world: p.world(), chaos: p.chaos() }, h),
    teleport: (want: Pose) => {
      const at = placeSafely(p.solid, want, h);
      p.place(at);
      return at;
    },
    position: p.position,
    light: () => {
      const s = p.lights.state();
      return s.on ? s.mode : "off";
    },
    lightChoices: () => ["off", ...p.lights.state().available],
    setLight: (c: LightChoice) => {
      if (c === "off") p.lights.setOn(false);
      else p.lights.select(c);
    },
    ping: p.ping,
    markers: () => p.markers.visible,
    setMarkers: (on) => p.markers.setVisible(on),
    fillBattery: p.fillBattery,
  };
}
