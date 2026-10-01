/**
 * The two endings of 直视 (design doc §9.1, D14): 湮灭 — the screen slowly
 * darkens with the world's veil, the unmanned tide's lines come one by one, then
 * 「湮灭」 and the way back (the save is ended for good); 封界 — after the
 * sealing tide, its closing lines over the dive, and play goes on. Every line
 * fades in over seconds; nothing flashes.
 */
import { useState } from "react";
import type { GazeTelemetry } from "../../scene/gaze/telemetry";
import type { GazeDict } from "./i18n";
import "./gaze.css";

/** Seconds between lines, and before the first. */
const STEP = 6;
const FIRST = 4;

export function EndingOverlay({ gaze, labels, onExit }: { gaze: GazeTelemetry; labels: GazeDict; onExit?: () => void }) {
  const [closed, setClosed] = useState(false);
  if (gaze.ended) {
    const A = labels.annihilated, t = gaze.endedFor;
    const shown = Math.max(0, Math.min(A.lines.length, Math.floor((t - FIRST) / STEP) + 1));
    const done = t >= FIRST + STEP * A.lines.length;
    return (
      <div className="dm-ending dm-ending-dark" style={{ opacity: Math.min(1, t / 10) }}>
        {A.lines.slice(0, shown).map((l) => (
          <p key={l}>{l}</p>
        ))}
        {done ? (
          <div className="dm-ending-end">
            <h2>{A.title}</h2>
            <p className="dim">{A.note}</p>
            <button type="button" className="dm-ending-btn" onClick={onExit}>
              {A.back}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
  if (!gaze.sealed || closed) return null;
  const S = labels.sealed;
  return (
    <div className="dm-ending dm-ending-light">
      {S.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      <div className="dm-ending-end">
        <h2>{S.title}</h2>
        <button type="button" className="dm-ending-btn" onClick={() => setClosed(true)}>
          {S.close}
        </button>
      </div>
    </div>
  );
}
