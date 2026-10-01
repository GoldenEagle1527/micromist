/**
 * Staging debug panel host (the debug chunk's UI entry): ` toggles it on desktop;
 * everywhere the in-game ≡ menu's 「调试」 entry opens it (`openSignal`). Opening
 * releases the pointer lock; the dive keeps running (nothing is paused).
 * Refreshes its live values twice a second.
 */
import { useEffect, useState } from "react";
import { useLocale } from "../../../../i18n";
import type { DeepMarchHandle } from "../../scene/world";
import { debugEn, debugZh } from "../i18n";
import { DebugSheet } from "./DebugSheet";
import "./debug.css";

type Props = {
  game: DeepMarchHandle | null;
  conserve: boolean;
  onRestart: () => void;
  /** Bumped by the in-game menu's 「调试」 entry: opens the panel (0 = never asked). */
  openSignal: number;
  /** Open / closed (the page leaves Esc to the panel while it is open). */
  onOpenChange?: (open: boolean) => void;
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

export function DebugPanel({ game, conserve, onRestart, openSignal, onOpenChange }: Props) {
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
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [open]);

  return (
    <div className="dm-dbg">
      {open ? <DebugSheet key={game ? "dive" : "none"} port={game?.debug ?? null} conserve={conserve} d={d} onRestart={onRestart} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
