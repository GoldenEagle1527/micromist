/**
 * Base energy chip under the tank gauge (once the core stands: energy / cap,
 * net rate, brown-out, docked), and the base's notices (built, refused,
 * storage moves, demolished, the tide stub).
 */
import type { BaseNotice, BaseTelemetry } from "../../scene/base/telemetry";
import type { BaseDict } from "./i18n";

export function BaseEnergy({ base, labels }: { base: BaseTelemetry; labels: BaseDict }) {
  const v = base.view;
  if (!v.founded) return null;
  const ratio = v.energyCap > 0 ? v.energy / v.energyCap : 0;
  return (
    <div className="dm-base-energy" data-state={v.brownout ? "brownout" : base.docked ? "docked" : "ok"} title={labels.energy}>
      <div className="dm-tank-head">
        <small>{labels.energy}</small>
        <b>
          {Math.floor(v.energy)}
          <span>/{v.energyCap}</span>
        </b>
      </div>
      <div className="dm-base-energy-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="dm-tank-status">{v.brownout ? labels.brownout : base.docked ? labels.docked : labels.rate(v.energyRate)}</div>
    </div>
  );
}

export function noticeText(n: BaseNotice, labels: BaseDict): string {
  switch (n.kind) {
    case "built":
      return labels.built(labels.structures[n.structure]);
    case "refused":
      return labels.refused(labels.structures[n.structure], labels.reasons[n.reason]);
    case "moved":
      return labels.moved(n.action, n.total);
    case "demolished":
      return labels.demolished(labels.structures[n.structure]);
    case "deposited":
      return labels.moved("deposit", n.total);
    case "tide":
      return n.ok ? labels.tideCalled : n.away ? labels.tideAway : labels.tideNotReady;
  }
}

export function BaseNoticeLine({ base, labels }: { base: BaseTelemetry; labels: BaseDict }) {
  if (!base.notice) return null;
  return (
    <div className="dm-exp-notice dm-base-notice" role="status">
      {noticeText(base.notice, labels)}
    </div>
  );
}
