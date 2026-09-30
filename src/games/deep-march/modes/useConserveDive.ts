/**
 * Play screen, conserve mode: open the world save before the world is built (its
 * seed comes from the save), hand the world its bounded site layout and the loading
 * screen its step list, count the dive when it begins, and write the save on page
 * hide and when the dive ends.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConserveSession, OpenIntent } from "../conserve";
import { seedFromString } from "../terrain/noise";
import type { SiteLayout } from "../terrain/siteLayout";
import { LOADING_STEPS, type LoadingStepDef } from "../ui/loading/steps";
import { loadConserve } from "./conserveLoader";

export type ConserveDive =
  | { status: "idle" | "opening" | "failed" }
  /** Save opened: dive with `seedText` in the bounded world `world` (this generation's site table). */
  | { status: "open"; seedText: string; world: SiteLayout; steps: readonly LoadingStepDef[] }
  /** The save can't be entered: the loading screen shows why (no world is built). */
  | { status: "blocked"; steps: readonly LoadingStepDef[] };

export function useConserveDive(intent: OpenIntent | null): { dive: ConserveDive; onDiveBegun: () => void } {
  const [dive, setDive] = useState<ConserveDive>({ status: "idle" });
  const sessionRef = useRef<ConserveSession | null>(null);

  useEffect(() => {
    if (!intent) return;
    let cancelled = false;
    let unbind = () => {};
    setDive({ status: "opening" });
    loadConserve().then(
      (mod) => {
        if (cancelled) return;
        const outcome = mod.openConserveSession({ backend: mod.createGameStoreBackend(), intent, hashSeed: seedFromString });
        const report = outcome.ok ? outcome.session.report : outcome.report;
        const steps = mod.withWorldSaveStep(LOADING_STEPS, report);
        if (!outcome.ok) return setDive({ status: "blocked", steps });
        sessionRef.current = outcome.session;
        unbind = mod.flushOnPageHide(() => outcome.session.flush());
        setDive({ status: "open", seedText: outcome.session.seedText, world: mod.terrainLayoutOf(outcome.session.siteTable), steps });
      },
      () => !cancelled && setDive({ status: "failed" }),
    );
    return () => {
      cancelled = true;
      unbind();
      sessionRef.current?.close();
      sessionRef.current = null;
      setDive({ status: "idle" });
    };
  }, [intent]);

  const onDiveBegun = useCallback(() => sessionRef.current?.recordDiveStart(), []);
  return { dive, onDiveBegun };
}
