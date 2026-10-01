/**
 * One-off explanations (deep-march rule): text that teaches is shown the first
 * time ever, holds 2 s and fades out (.dm-once in panel.css); the "seen" flags
 * live in the settings game-store (settings.ts takeTip). Live state and
 * warnings never go through here.
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { takeTip, type TipId } from "../settings";

/** 2 s shown + the fade (keep in step with the dm-once keyframes). */
export const ONCE_MS = 2700;

/** True while tip `id` is on screen: from the first time ever `when` turns true, for ONCE_MS. */
export function useOnce(id: TipId, when: boolean): boolean {
  const [shown, setShown] = useState(false);
  // the tip taken by this component and until when it shows (a re-run of the effect keeps it, never re-takes it)
  const took = useRef<{ id: TipId; until: number } | null>(null);
  useEffect(() => {
    if (!when) {
      setShown(false);
      return;
    }
    if (took.current?.id !== id) {
      if (!takeTip(id)) return;
      took.current = { id, until: performance.now() + ONCE_MS };
    }
    const left = took.current.until - performance.now();
    if (left <= 0) return;
    setShown(true);
    const t = window.setTimeout(() => setShown(false), left);
    return () => window.clearTimeout(t);
  }, [id, when]);
  return shown;
}

/** A teaching note (`<p>`): the first time ever it would show, for 2 s, then fades. */
export function OnceNote({ id, className, children }: { id: TipId; className?: string; children: ReactNode }) {
  const shown = useOnce(id, true);
  return shown ? createElement("p", { className: `${className ?? ""} dm-once`.trim() }, children) : null;
}
