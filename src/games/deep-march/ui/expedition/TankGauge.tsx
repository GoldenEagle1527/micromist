/** Particle tank bar (「粒子罐 n/200」), under the battery in the readout block. */
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { ExpeditionDict } from "./i18n";

const SEGMENTS = 10;

export function TankGauge({ exp, labels }: { exp: ExpeditionTelemetry; labels: ExpeditionDict }) {
  const { value, capacity, ratio } = exp.tank;
  const lit = Math.ceil(ratio * SEGMENTS - 1e-6);
  const full = value >= capacity;
  return (
    <div className="dm-tank" data-state={full ? "full" : exp.absorbing ? "filling" : "ok"} title={labels.tank}>
      <div className="dm-tank-head">
        <small>{labels.tank}</small>
        <b>
          {Math.round(value)}
          <span>/{capacity}</span>
        </b>
      </div>
      <div className="dm-tank-bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} className={i < lit ? "on" : undefined} />
        ))}
      </div>
      {full ? <div className="dm-tank-status">{labels.tankFull}</div> : null}
    </div>
  );
}
