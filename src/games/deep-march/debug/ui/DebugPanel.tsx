/**
 * Staging debug panel host (the debug chunk's UI entry): ` toggles it on desktop,
 * a small button on touch devices. Opening releases the pointer lock; the dive
 * keeps running (nothing is paused). Refreshes its live values twice a second.
 */
import { useEffect, useState } from "react";
import { useLocale } from "../../../../i18n";
import type { DeepMarchHandle } from "../../scene/world";
import { debugEn, debugZh } from "../i18n";
import { DebugSheet } from "./DebugSheet";
import "./debug.css";

type Props = { game: DeepMarchHandle | null; touch: boolean; conserve: boolean; onRestart: () => void };

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

export function DebugPanel({ game, touch, conserve, onRestart }: Props) {
  const { locale } = useLocale();
  const d = locale === "zh" ? debugZh : debugEn;
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.repeat) return;
      if (e.code === "Backquote") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.code === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [open]);

  return (
    <div className="dm-dbg">
      {touch && !open ? (
        <button type="button" className="dm-dbg-open" onClick={() => setOpen(true)} aria-label={d.title}>
          {d.open}
        </button>
      ) : null}
      {open ? <DebugSheet key={game ? "dive" : "none"} port={game?.debug ?? null} conserve={conserve} d={d} onRestart={onRestart} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
