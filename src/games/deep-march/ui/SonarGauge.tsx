/**
 * Active sonar strip under the battery (survival HUD): ready / recharging bar
 * for the ping (key 3 or the fan's PING sector) and why a ping would be refused.
 */
import type { Telemetry } from "../scene/world";
import "./sonar.css";

export type SonarHudLabels = {
  title: string;
  ready: string;
  cooling: string;
  noBattery: string;
};

export function SonarGauge({ tel, labels }: { tel: Telemetry; labels: SonarHudLabels }) {
  const s = tel.sonar;
  if (!s.available) return null;
  const state = s.ready ? "ready" : s.cooldown > 0 ? "cooling" : "battery";
  const text = state === "ready" ? labels.ready : state === "cooling" ? `${labels.cooling} ${s.cooldown.toFixed(1)}s` : labels.noBattery;
  return (
    <div className="dm-sonar" data-state={state} title={`${labels.title} (3)`}>
      <div className="dm-sonar-head">
        <small>{labels.title}</small>
        <span>{text}</span>
      </div>
      <div className="dm-sonar-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(s.charge * 100)}%` }} />
      </div>
    </div>
  );
}
