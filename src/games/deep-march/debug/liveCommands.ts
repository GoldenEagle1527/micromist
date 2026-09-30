/**
 * Runtime commands (registry.ts): act on the running dive at once through its
 * port — 传送, 灯光/声呐, 资源, 调试叠加层. Hidden while the dive loads. None
 * writes a save (the battery is the dive's own resource).
 */
import type { DebugCommand, DebugCtx } from "./registry";

const live = (c: DebugCtx) => c.port !== null;
/** Custom teleport range (m): x / z across any world, y the terrain's vertical range. */
const XZ = 6000;
const Y = { min: -128, max: 120 };

const coord = (axis: "x" | "y" | "z", label: "customX" | "customY" | "customZ"): DebugCommand => ({
  id: `teleport.custom.${axis}`,
  section: "teleport",
  label,
  kind: "stepper",
  steps: [10, 100],
  min: axis === "y" ? Y.min : -XZ,
  max: axis === "y" ? Y.max : XZ,
  when: live,
  get: (c) => c.custom[axis],
  set: (c, v) => c.setCustom({ [axis]: v }),
});

export const LIVE_COMMANDS: readonly DebugCommand[] = [
  {
    id: "teleport.targets",
    section: "teleport",
    label: "targets",
    kind: "targets",
    when: live,
    items: (c) => c.port?.targets() ?? [],
    go: (c, t) => {
      const at = c.port?.teleport(t.pose());
      if (at) c.setCustom({ x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) });
    },
  },
  coord("x", "customX"),
  coord("y", "customY"),
  coord("z", "customZ"),
  {
    id: "teleport.custom.here",
    section: "teleport",
    label: "customHere",
    kind: "action",
    when: live,
    apply: (c) => {
      const p = c.port?.position();
      if (p) c.setCustom({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
    },
  },
  {
    id: "teleport.custom.go",
    section: "teleport",
    label: "customGo",
    kind: "action",
    when: live,
    apply: (c) => {
      const at = c.port?.teleport({ ...c.custom, yaw: 0, pitch: 0 });
      if (at) c.setCustom({ y: Math.round(at.y) });
    },
  },
  {
    id: "light.mode",
    section: "light",
    label: "lightMode",
    kind: "choice",
    when: live,
    options: (c) => (c.port?.lightChoices() ?? []).map((m) => ({ value: m, label: m === "off" ? "lightOff" : m === "beam" ? "lightBeam" : "lightHigh" })),
    get: (c) => c.port?.light() ?? "off",
    set: (c, v) => c.port?.setLight(v as Parameters<NonNullable<DebugCtx["port"]>["setLight"]>[0]),
  },
  { id: "light.ping", section: "light", label: "ping", kind: "action", when: live, apply: (c) => c.port?.ping() },
  { id: "resources.battery", section: "resources", label: "fillBattery", kind: "action", when: live, apply: (c) => c.port?.fillBattery() },
  {
    id: "overlay.markers",
    section: "overlay",
    label: "markers",
    kind: "toggle",
    when: live,
    get: (c) => c.port?.markers() ?? false,
    set: (c, on) => c.port?.setMarkers(on),
  },
];
