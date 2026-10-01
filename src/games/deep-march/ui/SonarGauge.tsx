/**
 * Sonar on the HUD, only when it says something: a small recharge chip under the
 * battery while a ping can't go out (keyboard play; on touch the PING button's
 * ring shows it), and the banner while observing the scan record — with the
 * surveyed area and how to get back (N / hold PING).
 */
import type { Telemetry } from "../scene/world";
import "./sonar.css";

export type SonarHudLabels = {
  title: string;
  ready: string;
  cooling: string;
  noBattery: string;
  /** Observation (scan record view) name, as in the help. */
  observe: string;
  /** Banner while observing: title and what the player is looking at. */
  observeOn: string;
  observeHint: string;
  /** How to leave the view: keyboard / touch. */
  exitKey: string;
  exitTouch: string;
  /** Surveyed seabed (followed by km²). */
  recorded: string;
};

/** Surveyed seabed, m² → km². */
export const km2 = (m2: number) => (m2 <= 0 ? "0" : m2 < 10_000 ? "<0.01" : (m2 / 1e6).toFixed(2));

/** Recharge / no-battery chip (nothing while the ping is ready). */
export function SonarChip({ tel, labels }: { tel: Telemetry; labels: SonarHudLabels }) {
  const s = tel.sonar;
  if (!s.available || s.ready) return null;
  const cooling = s.cooldown > 0;
  return (
    <div className="dm-sonar-chip" data-state={cooling ? "cooling" : "battery"} title={`${labels.title} (3)`}>
      <small>{labels.title}</small>
      <span>{cooling ? `${labels.cooling} ${s.cooldown.toFixed(1)}s` : labels.noBattery}</span>
      <i style={{ width: `${Math.round(s.charge * 100)}%` }} aria-hidden="true" />
    </div>
  );
}

/** Top-centre banner the first time ever the view shows the scan record (ControlPanel: once, 2 s, then fades). */
export function ObserveBanner({ labels, area, touch }: { labels: SonarHudLabels; area: number; touch: boolean }) {
  return (
    <div className="dm-observe-banner dm-once" role="status">
      <b>{labels.observeOn}</b>
      <small>{labels.observeHint}</small>
      <small>
        {labels.recorded} {km2(area)} km² · {touch ? labels.exitTouch : labels.exitKey}
      </small>
    </div>
  );
}
