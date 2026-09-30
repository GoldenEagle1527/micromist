/**
 * The open debug panel: the registry's sections as clickable rows, the current
 * position, and the restart bar (the draft of the next dive's overrides → apply
 * and restart the dive, or reset everything to the defaults).
 */
import { useState } from "react";
import { DEFAULT_DIVE_PARAMS, diveParams, setDiveParams, type DiveParams } from "../../scene/dive/params";
import { DEBUG_COMMANDS } from "../commands";
import type { DebugDict } from "../i18n";
import { SECTIONS, pendingKeys, visibleCommands, type DebugCtx } from "../registry";
import type { DebugPort } from "../types";
import { CommandRow } from "./CommandRow";

type Props = { port: DebugPort | null; conserve: boolean; d: DebugDict; onRestart: () => void; onClose: () => void };

export function DebugSheet({ port, conserve, d, onRestart, onClose }: Props) {
  const [draft, setDraftState] = useState<DiveParams>(() => ({ ...diveParams() }));
  const [custom, setCustomState] = useState(() => {
    const p = port?.position() ?? { x: 0, y: 0, z: 0 };
    return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
  });
  const [, bump] = useState(0);
  const ctx: DebugCtx = {
    port,
    conserve,
    draft,
    setDraft: (patch) => setDraftState((cur) => ({ ...cur, ...patch })),
    custom,
    setCustom: (patch) => setCustomState((cur) => ({ ...cur, ...patch })),
  };
  const pending = pendingKeys(draft, diveParams()).length;
  const restart = () => {
    setDiveParams(draft);
    onRestart();
  };
  const pos = port?.position();
  return (
    <div className="dm-dbg-sheet" role="dialog" aria-label={d.title} onPointerDown={(e) => e.stopPropagation()}>
      <div className="dm-dbg-head">
        <strong>{d.title}</strong>
        <span className="dm-dbg-hint">{d.keyHint}</span>
        <button type="button" className="dm-dbg-btn" onClick={onClose}>
          {d.close}
        </button>
      </div>
      <p className="dm-dbg-note">{pos ? d.position(pos.x, pos.y, pos.z) : d.loading}</p>
      {SECTIONS.map((s) => {
        const rows = visibleCommands(DEBUG_COMMANDS, s, ctx);
        if (!rows.length) return null;
        return (
          <section key={s} className="dm-dbg-section">
            <h4>{d.sections[s]}</h4>
            {rows.map((k) => (
              <CommandRow key={k.id} k={k} c={ctx} d={d} done={() => bump((n) => n + 1)} />
            ))}
          </section>
        );
      })}
      <div className="dm-dbg-restart">
        {pending > 0 ? <span>{d.pending(pending)}</span> : null}
        <button type="button" className="dm-dbg-btn" onClick={() => setDraftState({ ...DEFAULT_DIVE_PARAMS })}>
          {d.resetAll}
        </button>
        <button type="button" className={`dm-dbg-btn${pending > 0 ? " on" : ""}`} onClick={restart}>
          {d.restart}
        </button>
      </div>
      <p className="dm-dbg-note">{d.noSave}</p>
    </div>
  );
}
