/**
 * One-off explanations (deep-march rule): text that teaches is shown the first
 * time ever, holds 2 s and fades out (.dm-once in panelNotices.css); the "seen" flags
 * live in the settings game-store (settings.ts takeTip). Live state and
 * warnings never go through here. The 2 s run on the dive's game clock: they
 * freeze while the ≡ menu pauses the game (the fade too: .dm-paused in panelNotices.css).
 */
import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { takeTip, type TipId } from "../settings";
import type { ClockView } from "../scene/gameClock";
import { usePauseClock, usePaused } from "./pauseClock";

/** 2 s shown + the fade (keep in step with the dm-once keyframes). */
export const ONCE_MS = 2700;

/** True while tip `id` is on screen: from the first time ever `when` turns true, for ONCE_MS (`own`: a clock outside the provider). */
export function useOnce(id: TipId, when: boolean, own?: ClockView | null): boolean {
  const [shown, setShown] = useState(false);
  const ctx = usePauseClock();
  const clock = own ?? ctx;
  const paused = usePaused(clock);
  // the tip taken by this component and until when it shows (game time; a re-run of the effect keeps it, never re-takes it)
  const took = useRef<{ id: TipId; until: number } | null>(null);
  useEffect(() => {
    if (!when) {
      setShown(false);
      return;
    }
    if (took.current?.id !== id) {
      if (!takeTip(id)) return;
      took.current = { id, until: clock.now() + ONCE_MS };
    }
    const left = took.current.until - clock.now();
    if (left <= 0) return;
    setShown(true);
    // paused: stays on screen, the rest of its time runs after the resume
    if (paused) return;
    const t = window.setTimeout(() => setShown(false), left);
    return () => window.clearTimeout(t);
  }, [id, when, clock, paused]);
  return shown;
}

/** A teaching note (`<p>`): the first time ever it would show, for 2 s, then fades. */
export function OnceNote({ id, className, children }: { id: TipId; className?: string; children: ReactNode }) {
  const shown = useOnce(id, true);
  return shown ? createElement("p", { className: `${className ?? ""} dm-once`.trim() }, children) : null;
}
