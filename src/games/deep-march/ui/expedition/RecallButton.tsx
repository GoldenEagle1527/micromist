/** HUD hold button for the emergency recall (touch + mouse; X on the keyboard): a ring fills while held. */
import { useRef, type PointerEvent as RPointerEvent } from "react";
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { DeepMarchHandle } from "../../scene/world";
import type { ExpeditionDict } from "./i18n";

const C = 2 * Math.PI * 15;

export function RecallButton({ game, exp, labels }: { game: DeepMarchHandle; exp: ExpeditionTelemetry; labels: ExpeditionDict }) {
  const owner = useRef<number | null>(null);
  const set = (on: boolean) => {
    game.panelInput.recall = on;
  };
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    owner.current = e.pointerId;
    set(true);
  };
  const up = (e: RPointerEvent<HTMLButtonElement>) => {
    if (owner.current !== e.pointerId) return;
    owner.current = null;
    set(false);
  };
  const p = exp.recall.phase === "holding" ? exp.recall.progress : 0;
  return (
    <button
      type="button"
      className={`dm-hud-btn dm-recall-btn${p > 0 ? " on" : ""}`}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={labels.recall}
      title={`${labels.recall} — ${labels.recallHint}`}
    >
      <svg viewBox="-17 -17 34 34" aria-hidden="true">
        <path d="M 6 -6 A 8.5 8.5 0 1 0 8.5 1 M 6 -6 L 6.5 -1 M 6 -6 L 1.2 -5.2" />
        <circle r={15} className="dm-recall-ring" strokeDasharray={`${(p * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90)" />
      </svg>
    </button>
  );
}
