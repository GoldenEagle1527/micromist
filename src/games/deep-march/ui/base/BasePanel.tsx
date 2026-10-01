/**
 * The base panel (plan M5; Q or the HUD 「基地」 button): energy, storage vs
 * tank per particle kind with deposit / withdraw / 放流 (release, unlimited),
 * the buildings (BuildingList: switches, the reactor's fuel, demolish), and
 * 唤潮 — its requirements, what to do before it (tideAdvice.ts) and the
 * forecast (TideForecastCard).
 */
import type { BaseCommand, BaseTelemetry } from "../../scene/base/telemetry";
import type { ExpeditionDict } from "../expedition/i18n";
import type { BaseDict } from "./i18n";
import { BuildingList } from "./BuildingList";
import { TideForecastCard } from "./TideForecastCard";
import { adviceText, tideAdvice } from "./tideAdvice";
import { OnceNote } from "../useOnce";

type Props = { base: BaseTelemetry; labels: BaseDict; kinds: ExpeditionDict["kinds"]; send: (cmd: BaseCommand) => void };

export function BasePanel({ base, labels, kinds, send }: Props) {
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
        <OnceNote id="baseIntro" className="dm-base-note">
          {labels.notFounded}
        </OnceNote>
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
          <BuildingList base={base} labels={labels} kinds={kinds} send={send} />
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
      <OnceNote id="releaseNote" className="dm-base-note">
        {labels.releaseNote}
      </OnceNote>
    </div>
  );
}

function Tide({ base, labels, send }: { base: BaseTelemetry; labels: BaseDict; send: (cmd: BaseCommand) => void }) {
  const t = base.tide, f = base.forecast;
  const advice = t.gaze ? null : tideAdvice(base.view, t, base.tideActive, base.structures);
  return (
    <div className="dm-base-section dm-base-tide">
      <div className="dm-base-row-head">
        <b>{labels.tideTitle}</b>
        <button type="button" className="dm-base-btn" disabled={!t.ready || !base.atBase || base.tideActive} onClick={() => send({ type: "tide" })}>
          {labels.tideBtn}
        </button>
      </div>
      <p className={`dm-base-note${t.gaze === "watching" ? " warn" : ""}`}>{t.gaze ? labels.tideGaze[t.gaze] : labels.tideNeeds(t.energy, t.energyNeeded, t.dives, t.divesNeeded)}</p>
      {advice ? <p className="dm-base-note warn">{adviceText(advice, labels.advice)}</p> : null}
      {f ? <TideForecastCard forecast={f} labels={labels.forecast} /> : null}
      {base.tideActive ? <p className="dm-base-note">{labels.tideRunning}</p> : !base.atBase ? <p className="dm-base-note dim">{labels.tideAway}</p> : null}
    </div>
  );
}
