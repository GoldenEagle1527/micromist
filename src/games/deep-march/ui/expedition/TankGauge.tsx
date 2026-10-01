/** Particle tank (「粒子罐」) as a thin bar with its count, under the battery; 「已满」 only when full. */
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { ExpeditionDict } from "./i18n";

export function TankGauge({ exp, labels }: { exp: ExpeditionTelemetry; labels: ExpeditionDict }) {
  const { value, capacity, ratio } = exp.tank;
  const full = value >= capacity;
  return (
    <div className="dm-tank" data-state={full ? "full" : exp.absorbing ? "filling" : "ok"} title={`${labels.tank} ${Math.round(value)}/${capacity}`}>
      <div className="dm-tank-head">
        <small>{labels.tank}</small>
        <b>{Math.round(value)}</b>
      </div>
      <div className="dm-tank-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {full ? <div className="dm-tank-status">{labels.tankFull}</div> : null}
    </div>
  );
}
