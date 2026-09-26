/** Battery bar + active light mode (survival HUD, sits under the depth readout). */
import type { LightMode } from "../survival";
import type { Telemetry } from "../scene/world";

export type BatteryLabels = {
  battery: string;
  lightOff: string;
  lightModes: Record<LightMode, string>;
  batteryEmpty: string;
  batteryCharging: string;
};

const SEGMENTS = 10;

export function BatteryGauge({ tel, labels }: { tel: Telemetry; labels: BatteryLabels }) {
  const { battery: b, light } = tel;
  const pct = Math.round(b.ratio * 100);
  const lit = Math.ceil(b.ratio * SEGMENTS - 1e-6);
  const state = light.locked ? "empty" : b.low ? "low" : "ok";
  const status = light.locked ? labels.batteryEmpty : b.rate > 0.001 && b.ratio < 1 ? labels.batteryCharging : "";
  return (
    <div className="dm-battery" data-state={state} data-mode={light.on ? light.mode : "off"} title={labels.battery}>
      <div className="dm-battery-head">
        <small>{labels.battery}</small>
        <b>{pct}%</b>
        <span className={`dm-light-mode${light.on ? " on" : ""}`}>{light.on ? labels.lightModes[light.mode] : labels.lightOff}</span>
      </div>
      <div className="dm-battery-bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} className={i < lit ? "on" : undefined} />
        ))}
      </div>
      {status ? <div className="dm-battery-status">{status}</div> : null}
    </div>
  );
}
