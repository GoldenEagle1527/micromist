/**
 * Aim prompt under the view centre: the lit node / cache (kind, particles
 * left), the hold progress, how to absorb (key or touch), and why it's
 * blocked. Plus the recall's hold / blackout message and the loss notice.
 */
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { ExpeditionDict } from "./i18n";

export function AbsorbPrompt({ exp, touch, labels }: { exp: ExpeditionTelemetry; touch: boolean; labels: ExpeditionDict }) {
  const t = exp.target;
  const recall = exp.recall.phase;
  if (recall !== "idle") {
    const dark = recall !== "holding";
    return (
      <div className={`dm-absorb dm-recall-msg${dark ? " dark" : ""}`} role="status">
        <div className="dm-absorb-name">{dark ? labels.recallDark : labels.recallHolding}</div>
        {!dark ? (
          <div className="dm-absorb-bar warn">
            <i style={{ width: `${Math.round(exp.recall.progress * 100)}%` }} />
          </div>
        ) : null}
      </div>
    );
  }
  const notice = exp.notice ? <div className="dm-exp-notice">{exp.notice.kind === "lost" ? labels.lost(exp.notice.total, exp.notice.evicted) : labels.recalledEmpty}</div> : null;
  if (!t) return notice;
  const name = t.kind === "cache" ? labels.cache : (labels.kinds[t.particle ?? 0] ?? labels.kinds[0]);
  const done = t.amount > 0 ? 1 - t.left / t.amount : 0;
  const hint = exp.blocked === "full" ? labels.blockedFull : exp.blocked === "battery" ? labels.blockedBattery : exp.absorbing ? labels.absorbing : touch ? labels.holdTouch : labels.holdKey;
  return (
    <>
      {notice}
      <div className="dm-absorb" data-kind={t.kind} data-blocked={exp.blocked ?? undefined} role="status">
        <div className="dm-absorb-name">
          {name}
          <small>{labels.left(Math.ceil(t.left))}</small>
        </div>
        <div className={`dm-absorb-bar${exp.absorbing ? " on" : ""}`}>
          <i style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
        <div className={`dm-absorb-hint${exp.blocked ? " warn" : ""}`}>{hint}</div>
      </div>
    </>
  );
}
