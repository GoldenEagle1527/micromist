/** Thin battery bar under the depth (survival HUD); words only when it runs low or flat. */
import type { LightMode } from "../survival";
import type { Telemetry } from "../scene/world";

export type BatteryLabels = {
  battery: string;
  lightOff: string;
  lightModes: Record<LightMode, string>;
  batteryEmpty: string;
  batteryLow: string;
};

export function BatteryGauge({ tel, labels }: { tel: Telemetry; labels: BatteryLabels }) {
  const { battery: b, light } = tel;
  const pct = Math.round(b.ratio * 100);
  const state = light.locked ? "empty" : b.low ? "low" : "ok";
  const status = light.locked ? labels.batteryEmpty : b.low ? `${labels.batteryLow} ${pct}%` : "";
  return (
    <div className="dm-battery" data-state={state} data-mode={light.on ? light.mode : "off"} title={`${labels.battery} ${pct}%`}>
      <div className="dm-battery-bar" role="meter" aria-label={labels.battery} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </div>
      {status ? <div className="dm-battery-status">{status}</div> : null}
    </div>
  );
}
