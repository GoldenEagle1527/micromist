/**
 * The hint card's state for the dive (conserve mode only): the progress from the
 * game-store, completed by each telemetry poll, saved when it changes; H (or the
 * card's 「知道了」) dismisses the current hint; the ≡ menu's 「新手提示」 turns them all off / on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BaseTelemetry } from "../../scene/base/telemetry";
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import type { TideTelemetry } from "../../scene/tide/telemetry";
import { currentHint, dismissHint, observe, setHintsOn, type HintProgress, type HintStep } from "./hintModel";
import { observationOf } from "./hintObservation";
import { loadHints, saveHints } from "./hintStore";

export type HintState = {
  step: HintStep | null;
  dismiss: () => void;
  /** The tips are on (the in-game menu's 「新手提示」 switch; switching on starts them over). */
  on: boolean;
  setOn: (on: boolean) => void;
};

export function useHints(exp: ExpeditionTelemetry | null, base: BaseTelemetry | null, tide: TideTelemetry | null, diving: boolean, observing = false): HintState {
  const [progress, setProgress] = useState<HintProgress>(loadHints);
  const obs = exp ? observationOf(exp, base, tide, diving, observing) : null;
  const step = obs ? currentHint(progress, obs) : null;
  const update = useCallback((next: HintProgress) => {
    setProgress(next);
    saveHints(next);
  }, []);
  useEffect(() => {
    if (!obs) return;
    const next = observe(progress, obs);
    if (next !== progress) update(next);
  });
  const dismiss = useCallback(() => {
    if (step) update(dismissHint(progress, step));
  }, [step, progress, update]);
  const setOn = useCallback((on: boolean) => update(setHintsOn(progress, on)), [progress, update]);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyH" || e.repeat || e.target instanceof HTMLInputElement) return;
      dismissRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { step, dismiss, on: !progress.off, setOn };
}
