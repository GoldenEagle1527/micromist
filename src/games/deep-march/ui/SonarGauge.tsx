/**
 * Active sonar strip under the battery (survival HUD): ready / recharging bar for
 * the ping (key 3 or the fan's PING sector), why a ping would be refused, and the
 * observation-mode toggle (key N) — plus the banner shown while observing.
 */
import type { Telemetry } from "../scene/world";
import "./sonar.css";

export type SonarHudLabels = {
  title: string;
  ready: string;
  cooling: string;
  noBattery: string;
  /** Observation toggle button. */
  observe: string;
  /** Banner while observing: title and what the player is looking at. */
  observeOn: string;
  observeHint: string;
  /** Surveyed seabed (followed by km²). */
  recorded: string;
};

/** Surveyed seabed, m² → km² for the strip. */
const km2 = (m2: number) => (m2 <= 0 ? "0" : m2 < 10_000 ? "<0.01" : (m2 / 1e6).toFixed(2));

export function SonarGauge({ tel, labels, onObserve }: { tel: Telemetry; labels: SonarHudLabels; onObserve?: () => void }) {
  const s = tel.sonar;
  if (!s.available) return null;
  const state = s.ready ? "ready" : s.cooldown > 0 ? "cooling" : "battery";
  const text = state === "ready" ? labels.ready : state === "cooling" ? `${labels.cooling} ${s.cooldown.toFixed(1)}s` : labels.noBattery;
  const on = tel.scan.observe;
  return (
    <div className="dm-sonar" data-state={state} data-observe={on ? "on" : "off"} title={`${labels.title} (3)`}>
      <div className="dm-sonar-head">
        <small>{labels.title}</small>
        <span>{text}</span>
      </div>
      <div className="dm-sonar-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(s.charge * 100)}%` }} />
      </div>
      <div className="dm-sonar-foot">
        <small>
          {labels.recorded} {km2(tel.scan.area)} km²
        </small>
        {onObserve ? (
          <button type="button" className={`dm-sonar-observe${on ? " on" : ""}`} onClick={onObserve} aria-pressed={on} title={`${labels.observeOn} (N)`}>
            {labels.observe}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Top-centre banner while the view shows the scan record instead of the live world. */
export function ObserveBanner({ labels }: { labels: SonarHudLabels }) {
  return (
    <div className="dm-observe-banner" role="status">
      <b>{labels.observeOn}</b>
      <small>{labels.observeHint}</small>
    </div>
  );
}
