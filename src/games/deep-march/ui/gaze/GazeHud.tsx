/**
 * 直视 on the HUD (design doc §9.1): 「它在看着这里。」, the phase and the time to
 * the forced tide, the two 封界 conditions (returned m against 0.84, anchors
 * lit), the anchor prompt within reach, a squeeze's warning. Quiet type, no
 * flashing: the dread is in the world, not in the HUD.
 */
import type { GazeTelemetry } from "../../scene/gaze/telemetry";
import type { GazeDict } from "./i18n";
import "./gaze.css";

/** 「渊核 50 · 灵光 75」 from a per-kind price. */
export function priceText(price: readonly number[], kinds: readonly string[]): string {
  return price.flatMap((n, k) => (n > 0 ? [`${kinds[k]} ${n}`] : [])).join(" · ");
}

export function GazeHud({ gaze, labels, kinds, touch }: { gaze: GazeTelemetry; labels: GazeDict; kinds: readonly string[]; touch: boolean }) {
  const g = gaze;
  if (!g.active) return g.sealing ? <div className="dm-gaze-line">{labels.sealing}</div> : null;
  const price = priceText(g.price, kinds);
  const ok = g.forecastM >= g.sealM - 1e-9;
  return (
    <>
      <div className="dm-gaze-card" role="status">
        <div className="dm-gaze-watch">{labels.watching}</div>
        <div>
          {labels.phases[g.phase]} · {labels.left(g.left)}
        </div>
        <div className={ok ? "done" : ""}>{labels.returned(g.forecastM, g.sealM)}</div>
        <div className={g.lit === g.anchors.length ? "done" : ""}>{labels.anchors(g.lit, g.anchors.length)}</div>
        {g.sealReady ? <div className="done">{labels.sealReady}</div> : null}
      </div>
      {g.reach >= 0 ? (
        <div className="dm-gaze-prompt">
          {g.short ? labels.short(price) : labels.hold(price, touch)}
          {!g.short && g.hold > 0 ? <span className="dm-gaze-hold" style={{ transform: `scaleX(${g.hold})` }} /> : null}
        </div>
      ) : g.squeeze ? (
        <div className="dm-gaze-line">{labels.squeeze}</div>
      ) : null}
    </>
  );
}
