/** The HUD telemetry (expedition, base, tide) → one hint observation (pure; types-only imports). */
import type { BaseTelemetry } from "../../scene/base/telemetry";
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { TideTelemetry } from "../../scene/tide/telemetry";
import type { HintObservation } from "./hintModel";

/** diving: the loading screen is gone (the hints wait for the dive); observing: sonar observation mode is on. */
export function observationOf(exp: ExpeditionTelemetry, base: BaseTelemetry | null, tide: TideTelemetry | null, diving: boolean, observing = false): HintObservation {
  const bn = base?.notice ?? null;
  const en = exp.notice;
  const deposited = (bn?.kind === "moved" && bn.action === "deposit" && bn.total > 0) || (bn?.kind === "deposited" && bn.total > 0) || (en?.kind === "deposited" && en.total > 0);
  const released = bn?.kind === "moved" && bn.action === "release" && bn.total > 0;
  const tideCalled = !!tide && tide.state !== "idle";
  const tideRunning = !!tide && (tide.state === "warning" || tide.state === "show" || tide.state === "murk");
  return {
    tank: exp.tank.value,
    founded: base?.view.founded ?? false,
    reactor: base?.view.buildings.some((b) => b.kind === "reactor") ?? false,
    deposited,
    released,
    gen: tide?.gen ?? 1,
    tideCalled,
    observing,
    busy: !diving || tideRunning || exp.recall.phase !== "idle" || (base?.panel ?? false),
  };
}
