/**
 * Build mode bar (plan M5): the building cards (the core until it stands,
 * then lighthouse / energy tower / storage / volt reactor) with their costs (have / need),
 * the live placement verdict, PLACE and LEAVE. Keys: E / click place, T next, G leave.
 */
import type { StructureInfo } from "../../conserve";
import type { BaseTelemetry, BaseCommand } from "../../scene/base/telemetry";
import type { ExpeditionDict } from "../expedition/i18n";
import type { BaseDict } from "./i18n";
import { fundsOf } from "./useBase";
import { useOnce } from "../useOnce";

type Props = { base: BaseTelemetry; touch: boolean; labels: BaseDict; kinds: ExpeditionDict["kinds"]; send: (cmd: BaseCommand) => void };

export function BuildBar({ base, touch, labels, kinds, send }: Props) {
  const b = base.build;
  // the keys / touch line teaches once; the cards, costs and the live verdict stay
  const howTo = useOnce("buildHow", b.active);
  if (!b.active) return null;
  const funds = fundsOf(base);
  const cards = base.structures.filter((s) => (base.view.founded ? s.kind !== "core" : s.kind === "core"));
  const reason = b.reason ? labels.reasons[b.reason] : labels.reasons["no-ground"];
  return (
    <div className="dm-build" role="group" aria-label={labels.buildTitle}>
      <div className="dm-build-head">
        <b>{labels.buildTitle}</b>
        {howTo ? <small className="dm-once">{touch ? labels.buildTouch : labels.buildKeys}</small> : null}
      </div>
      <div className="dm-build-cards">
        {cards.map((s) => (
          <Card key={s.kind} info={s} on={s.kind === b.kind} funds={funds} labels={labels} kinds={kinds} onPick={() => send({ type: "kind", kind: s.kind })} />
        ))}
      </div>
      <div className={`dm-build-verdict${b.ok ? " ok" : " bad"}`} role="status">
        {reason}
      </div>
      <div className="dm-build-actions">
        <button type="button" className="dm-build-btn place" disabled={!b.ok} onClick={() => send({ type: "place" })}>
          {labels.btnPlace}
        </button>
        <button type="button" className="dm-build-btn" onClick={() => send({ type: "build", on: false })}>
          {labels.cancel}
        </button>
      </div>
    </div>
  );
}

function Card({ info, on, funds, labels, kinds, onPick }: { info: StructureInfo; on: boolean; funds: number[]; labels: BaseDict; kinds: readonly string[]; onPick: () => void }) {
  const costs = info.cost.flatMap((n, k) => (n > 0 ? [{ k, n, have: funds[k] ?? 0 }] : []));
  return (
    <button type="button" className={`dm-build-card${on ? " on" : ""}`} aria-pressed={on} onClick={onPick}>
      <b>{labels.structures[info.kind]}</b>
      <small>{labels.notes[info.kind]}</small>
      <ul>
        {costs.map((c) => (
          <li key={c.k} className={c.have >= c.n ? "ok" : "short"}>
            {kinds[c.k] ?? c.k} <span>{Math.floor(Math.min(c.have, 99999))}/{c.n}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}
