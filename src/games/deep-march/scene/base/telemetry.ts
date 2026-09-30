/**
 * What the HUD reads of the base (ui/base), polled like the dive telemetry.
 * Plain data: no three.js, no conserve runtime (types only).
 */
import type { BaseView, StructureInfo, StructureKind, TideForecast, TideReadiness } from "../../conserve";
import type { BuildReason } from "./buildMode";

export type BaseNotice =
  | { kind: "built"; structure: StructureKind }
  | { kind: "refused"; structure: StructureKind; reason: BuildReason }
  | { kind: "deposited"; total: number }
  | { kind: "moved"; action: "deposit" | "withdraw" | "release"; total: number }
  | { kind: "demolished"; structure: StructureKind }
  | { kind: "tide" };

export type BaseTelemetry = {
  view: BaseView;
  /** Inside the protection radius (storage moves allowed). */
  atBase: boolean;
  /** To the core: metres and degrees off the view heading (null before the founding). */
  home: { distance: number; bearing: number } | null;
  docked: boolean;
  build: { active: boolean; kind: StructureKind; reason: BuildReason | null; ok: boolean; shortfall: readonly number[] };
  panel: boolean;
  tide: TideReadiness;
  /** The tide forecast (M6): computed only while the panel shows it, else null. */
  forecast: TideForecast | null;
  notice: BaseNotice | null;
  /** Particle kinds of this world, in storage order. */
  kinds: readonly number[];
  /** Costs and effects of each building kind. */
  structures: readonly StructureInfo[];
  /** Draw calls / triangles of the buildings, beams and hologram now. */
  draws: number;
  triangles: number;
};

/** UI → scene. */
export type BaseCommand =
  | { type: "build"; on?: boolean }
  | { type: "kind"; kind: StructureKind | "next" }
  | { type: "place" }
  | { type: "panel"; open?: boolean }
  | { type: "deposit"; kind: number | null }
  | { type: "withdraw"; kind: number; count: number }
  | { type: "release"; kind: number; count: number }
  | { type: "demolish"; id: number }
  | { type: "tide" };
