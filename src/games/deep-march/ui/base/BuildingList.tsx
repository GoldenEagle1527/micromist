/**
 * The base panel's buildings (plan M5, M9; the volt reactor): state (on / standby /
 * off), the switch for consumers and fuelled buildings (StructureInfo.switchable),
 * demolish (full refund, confirmed), and the reactor's fuel line — voltite in
 * storage and the minutes of full output it gives the reactors switched on.
 */
import { useState } from "react";
import type { BaseBuilding } from "../../conserve";
import type { BaseCommand, BaseTelemetry } from "../../scene/base/telemetry";
import type { ExpeditionDict } from "../expedition/i18n";
import type { BaseDict } from "./i18n";

type Props = { base: BaseTelemetry; labels: BaseDict; kinds: ExpeditionDict["kinds"]; send: (cmd: BaseCommand) => void };

/** Fuel lines: per fuelled producer kind that stands, its fuel in storage and minutes at full output. */
function fuelLines(base: BaseTelemetry): { kind: number; n: number; minutes: number | null }[] {
  const v = base.view;
  return base.structures.flatMap((s) => {
    if (!(s.energy > 0) || !s.fuel || !v.buildings.some((b) => b.kind === s.kind)) return [];
    const n = v.storage[s.fuel.kind] ?? 0;
    const running = v.buildings.filter((b) => b.kind === s.kind && b.on).length;
    return [{ kind: s.fuel.kind, n, minutes: running > 0 && n > 0 ? Math.max(1, Math.floor((n * s.fuel.every) / running / 60)) : null }];
  });
}

function stateOf(b: BaseBuilding, labels: BaseDict): { text: string; cls: string } {
  if (b.working) return { text: labels.working, cls: "on" };
  return b.standby ? { text: labels.standby, cls: "on" } : { text: labels.idle, cls: "off" };
}

export function BuildingList({ base, labels, kinds, send }: Props) {
  const [confirm, setConfirm] = useState<number | null>(null);
  const v = base.view;
  const switchable = (b: BaseBuilding) => base.structures.find((x) => x.kind === b.kind)?.switchable ?? false;
  return (
    <div className="dm-base-section">
      <b>{labels.buildings}</b>
      {fuelLines(base).map((f) => (
        <p key={f.kind} className={`dm-base-note${f.n > 0 ? "" : " warn"}`}>
          {labels.fuel(kinds[f.kind] ?? String(f.kind), f.n, f.minutes)}
        </p>
      ))}
      <ul className="dm-base-list">
        {v.buildings.map((b) => {
          const st = stateOf(b, labels);
          return (
            <li key={b.id}>
              <span>
                {labels.structures[b.kind]} <small className={st.cls}>{st.text}</small>
              </span>
              {switchable(b) && confirm !== b.id ? (
                <button type="button" className="dm-base-btn" aria-pressed={!b.on} onClick={() => send({ type: "switch", id: b.id, on: !b.on })}>
                  {b.on ? labels.switchOff : labels.switchOn}
                </button>
              ) : null}
              {b.kind === "core" ? null : confirm === b.id ? (
                <span className="dm-base-confirm">
                  <small>{labels.confirmDemolish(labels.structures[b.kind])}</small>
                  <button type="button" className="dm-base-btn warn" onClick={() => (send({ type: "demolish", id: b.id }), setConfirm(null))}>
                    {labels.yes}
                  </button>
                  <button type="button" className="dm-base-btn" onClick={() => setConfirm(null)}>
                    {labels.no}
                  </button>
                </span>
              ) : (
                <button type="button" className="dm-base-btn" onClick={() => setConfirm(b.id)}>
                  {labels.demolish}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
