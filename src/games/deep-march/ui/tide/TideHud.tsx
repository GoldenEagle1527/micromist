/**
 * The tide on the HUD (plan M7; design doc §5.5, §5.6): the warning's
 * countdown (「回到穹顶内」 outside the dome, 「潮在积蓄」 when extended), the
 * show's phase or 「浊潮」, the dome-edge warning, the particle-ized black
 * screen's line, and the generation summary after the tide.
 */
import type { Biome } from "../../conserve";
import type { TideTelemetry } from "../../scene/tide/telemetry";
import type { TideDict } from "./i18n";
import "./tide.css";

export function TideHud({ tide, labels, biomes }: { tide: TideTelemetry; labels: TideDict; biomes: Record<Biome, string> }) {
  const t = tide;
  const warn = t.zone === "edge" || t.zone === "outside";
  let head: string | null = null;
  if (t.state === "warning") head = t.extended ? labels.gathering : t.zone === "outside" ? labels.comeBack(t.left) : labels.coming(t.left);
  else if (t.state === "show" && t.phase) head = labels.phases[t.phase];
  else if (t.state === "murk") head = labels.murk;
  const inTide = t.state === "show" || t.state === "murk";
  return (
    <>
      {head ? (
        <div className={`dm-tide-head${t.state === "warning" && warn ? " warn" : ""}`} role="status">
          {head}
        </div>
      ) : null}
      {inTide && t.fate === "free" && warn ? <div className="dm-tide-edge">{t.zone === "outside" ? labels.outside : labels.edge}</div> : null}
      {t.fate !== "free" ? <div className="dm-tide-taken">{labels.taken}</div> : null}
      {t.summary && t.fate === "free" ? <div className="dm-tide-summary">{labels.summary(t.summary, biomes)}</div> : null}
    </>
  );
}
