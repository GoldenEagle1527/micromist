/**
 * The base panel (plan M5; Q or the HUD 「基地」 button): energy, storage vs
 * tank per particle kind with deposit / withdraw / 放流 (release, unlimited),
 * the buildings with demolish (full refund, confirmed), and the tide (唤潮)
 * stub — its requirements and the forecast (TideForecastCard); the sequence is M7's.
 */
import { useState } from "react";
import type { BaseCommand, BaseTelemetry } from "../../scene/base/telemetry";
import type { ExpeditionDict } from "../expedition/i18n";
import type { BaseDict } from "./i18n";
import { TideForecastCard } from "./TideForecastCard";

type Props = { base: BaseTelemetry; labels: BaseDict; kinds: ExpeditionDict["kinds"]; send: (cmd: BaseCommand) => void };

export function BasePanel({ base, labels, kinds, send }: Props) {
  const [confirm, setConfirm] = useState<number | null>(null);
  if (!base.panel) return null;
  const v = base.view;
  const close = () => send({ type: "panel", open: false });
  return (
    <div className="dm-base-panel" role="dialog" aria-label={labels.panelTitle} onPointerDown={(e) => e.stopPropagation()}>
      <div className="dm-base-head">
        <b>{labels.panelTitle}</b>
        <button type="button" className="dm-base-btn" onClick={close}>
          {labels.close}
        </button>
      </div>
      {!v.founded ? (
        <p className="dm-base-note">{labels.notFounded}</p>
      ) : (
        <>
          <div className="dm-base-stats">
            <span>
              {labels.energy} <b>{Math.floor(v.energy)}</b>/{v.energyCap} · {v.brownout ? labels.brownout : labels.rate(v.energyRate)}
            </span>
            <span>
              {labels.storage} <b>{v.stored}</b>/{v.capacity}
            </span>
          </div>
          <Storage base={base} labels={labels} kinds={kinds} send={send} />
          <div className="dm-base-section">
            <b>{labels.buildings}</b>
            <ul className="dm-base-list">
              {v.buildings.map((b) => (
                <li key={b.id}>
                  <span>
                    {labels.structures[b.kind]} <small className={b.working ? "on" : "off"}>{b.working ? labels.working : labels.idle}</small>
                  </span>
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
              ))}
            </ul>
          </div>
        </>
      )}
      <Tide base={base} labels={labels} send={send} />
    </div>
  );
}

function Storage({ base, labels, kinds, send }: Props) {
  const v = base.view;
  const off = !base.atBase;
  const btn = (text: string, cmd: BaseCommand, disabled: boolean, cls = "") => (
    <button type="button" className={`dm-base-btn${cls}`} disabled={off || disabled} onClick={() => send(cmd)}>
      {text}
    </button>
  );
  return (
    <div className="dm-base-section">
      <div className="dm-base-row-head">
        <b>{labels.storage}</b>
        {btn(labels.depositAll, { type: "deposit", kind: null }, v.tank.every((n) => n <= 0))}
      </div>
      {off ? <p className="dm-base-note warn">{labels.onlyAtBase}</p> : null}
      <table className="dm-base-table">
        <thead>
          <tr>
            <th>{labels.kind}</th>
            <th>{labels.tank}</th>
            <th>{labels.storage}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {base.kinds.map((k) => {
            const tank = v.tank[k] ?? 0, stored = v.storage[k] ?? 0;
            return (
              <tr key={k}>
                <td>{kinds[k] ?? k}</td>
                <td>{tank}</td>
                <td>{stored}</td>
                <td className="dm-base-actions">
                  {btn(labels.deposit, { type: "deposit", kind: k }, tank <= 0)}
                  {btn(labels.withdraw(10), { type: "withdraw", kind: k, count: 10 }, stored <= 0)}
                  {btn(labels.withdraw(null), { type: "withdraw", kind: k, count: stored }, stored <= 0)}
                  {btn(labels.release(10), { type: "release", kind: k, count: 10 }, stored <= 0, " release")}
                  {btn(labels.release(100), { type: "release", kind: k, count: 100 }, stored <= 0, " release")}
                  {btn(labels.release(null), { type: "release", kind: k, count: stored }, stored <= 0, " release")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dm-base-note">{labels.releaseNote}</p>
    </div>
  );
}

function Tide({ base, labels, send }: { base: BaseTelemetry; labels: BaseDict; send: (cmd: BaseCommand) => void }) {
  const t = base.tide, f = base.forecast;
  return (
    <div className="dm-base-section dm-base-tide">
      <div className="dm-base-row-head">
        <b>{labels.tideTitle}</b>
        <button type="button" className="dm-base-btn" disabled={!t.ready || !base.atBase || base.tideActive} onClick={() => send({ type: "tide" })}>
          {labels.tideBtn}
        </button>
      </div>
      <p className="dm-base-note">{labels.tideNeeds(t.energy, t.energyNeeded, t.dives, t.divesNeeded)}</p>
      {f ? <TideForecastCard forecast={f} labels={labels.forecast} /> : null}
      {base.tideActive ? <p className="dm-base-note">{labels.tideRunning}</p> : !base.atBase ? <p className="dm-base-note dim">{labels.tideAway}</p> : null}
    </div>
  );
}
