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
  /** Recorded points (followed by the count). */
  recorded: string;
};

const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);

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
          {labels.recorded} {kilo(tel.scan.points)}
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
