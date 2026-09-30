/**
 * Build mode (plan M5): the diver aims at the seabed; the chosen building is
 * checked there — ground (terrain/groundProbe.ts), the base's 2D rules
 * (BasePort.check) and, for the core, the frozen-zone check (terrain/frozenZone.ts)
 * — throttled to PLACEMENT.intervalMs unless the aim moved. place() builds
 * what the last check allowed. No rendering (the hologram reads current()).
 */
import type { BasePort, PlacementReason, StructureKind, WorldRect } from "../../conserve";
import type { DensityField } from "../../terrain/density";
import { checkFrozenZone, frozenCellsAt } from "../../terrain/frozenZone";
import { GroundProbe, type GroundReason } from "../../terrain/groundProbe";
import { MACRO } from "../../terrain/regions";
import { layoutIndex, type SiteLayout } from "../../terrain/siteLayout";
import { PLACEMENT } from "./config";

export type BuildReason = PlacementReason | Exclude<GroundReason, "ok"> | "frozen";

export type BuildState = {
  active: boolean;
  kind: StructureKind;
  /** The last check at the aimed point (null: nothing aimed yet). */
  spot: { x: number; y: number; z: number; yaw: number; reason: BuildReason } | null;
};

type V3 = { x: number; y: number; z: number };

export class BuildMode {
  private readonly port: BasePort;
  private readonly field: DensityField;
  private readonly layout: SiteLayout;
  private readonly rect: WorldRect;
  private readonly probe: GroundProbe;
  private state: BuildState;
  private lastAt = -1e9;
  private lastAim: V3 = { x: 0, y: 0, z: 0 };
  private lastRev = -1;

  constructor(port: BasePort, field: DensityField, layout: SiteLayout, rect: WorldRect) {
    this.port = port;
    this.field = field;
    this.layout = layout;
    this.rect = rect;
    this.probe = new GroundProbe(field);
    this.state = { active: false, kind: port.view().founded ? "lighthouse" : "core", spot: null };
  }

  current(): BuildState {
    return this.state;
  }

  toggle(on = !this.state.active): void {
    const founded = this.port.view().founded;
    const kind = !founded ? "core" : this.state.kind === "core" ? "lighthouse" : this.state.kind;
    this.state = { active: on, kind, spot: null };
    this.lastAt = -1e9;
  }

  /** The next building kind (the core only until it stands, then the other three). */
  select(kind: StructureKind | "next"): void {
    const kinds: readonly StructureKind[] = this.port.view().founded ? this.port.kinds.filter((k) => k !== "core") : ["core"];
    const next = kind === "next" ? kinds[(kinds.indexOf(this.state.kind) + 1) % kinds.length] : kinds.includes(kind) ? kind : this.state.kind;
    this.state = { ...this.state, kind: next ?? kinds[0], spot: null };
    this.lastAt = -1e9;
  }

  /** Re-check at the aimed point (throttled). time: seconds. */
  update(eye: V3, dir: V3, time: number): void {
    if (!this.state.active) return;
    const rev = this.port.revision();
    const aim = this.probe.pick(eye, dir);
    const moved = !aim || Math.hypot(aim.x - this.lastAim.x, aim.y - this.lastAim.y, aim.z - this.lastAim.z) > PLACEMENT.moveEps;
    if (!moved && rev === this.lastRev && (time - this.lastAt) * 1000 < PLACEMENT.intervalMs) return;
    this.lastAt = time;
    this.lastRev = rev;
    if (!aim) {
      this.state = { ...this.state, spot: null };
      return;
    }
    this.lastAim = aim;
    this.state = { ...this.state, spot: this.check(aim, eye) };
  }

  private check(aim: V3, eye: V3): NonNullable<BuildState["spot"]> {
    const kind = this.state.kind;
    const info = this.port.info(kind);
    const slopeMax = kind === "core" ? PLACEMENT.slopeMaxCore : PLACEMENT.slopeMaxOther;
    const g = this.probe.footprint(aim.x, aim.y, aim.z, { radius: info.radius, height: info.height, slopeMax });
    const yaw = Math.round(Math.atan2(eye.x - g.x, eye.z - g.z) / PLACEMENT.yawStep) * PLACEMENT.yawStep;
    const spot = { x: g.x, y: g.y, z: g.z, yaw };
    if (g.reason !== "ok") return { ...spot, reason: g.reason };
    const rule = this.port.check(kind, g.x, g.z, this.rect);
    if (rule !== "ok" || kind !== "core") return { ...spot, reason: rule };
    const S = this.field.settings.worldScale;
    const frozen = frozenCellsAt(this.field.regions, g.x, g.z, S);
    const zone = checkFrozenZone(this.field.regions, { x: g.x, z: g.z, radius: PLACEMENT.frozenRadius, frozen, worldScale: S });
    return { ...spot, reason: zone.ok ? "ok" : "frozen" };
  }

  /** Build what the last check allowed; the check runs again right after. */
  place(): { ok: boolean; kind: StructureKind; reason: BuildReason } {
    const { kind, spot } = this.state;
    if (!this.state.active || !spot || spot.reason !== "ok") return { ok: false, kind, reason: spot?.reason ?? "no-ground" };
    const pos: [number, number, number] = [spot.x, spot.y, spot.z];
    const r = kind === "core" ? this.port.found(pos, spot.yaw, this.coreSite(spot.x, spot.z), this.rect) : this.port.build(kind, pos, spot.yaw, this.rect);
    this.lastAt = -1e9;
    if (r.ok && kind === "core") this.select("lighthouse");
    return r.ok ? { ok: true, kind, reason: "ok" } : { ok: false, kind, reason: r.reason === "unknown" ? "no-ground" : r.reason };
  }

  /** The layout site under the core (centre of the frozen 3 × 3). */
  private coreSite(x: number, z: number): number {
    const G = MACRO.cell * this.field.settings.worldScale;
    return layoutIndex(this.layout, Math.floor(x / G), Math.floor(z / G));
  }
}
