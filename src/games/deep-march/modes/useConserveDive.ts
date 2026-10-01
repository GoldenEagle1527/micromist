/**
 * Play screen, conserve mode: open the world save before the world is built (its
 * seed comes from the save), hand the world its bounded site layout, expedition
 * and base and the loading screen its step list, count the dive when it begins, and write the save on page
 * hide and when the dive ends.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BasePort, ChaosView, ConserveSession, ExpeditionPort, GazePort, OpenIntent, TidePort } from "../conserve";
import { seedFromString } from "../terrain/noise";
import type { SiteLayout } from "../terrain/siteLayout";
import { LOADING_STEPS, type LoadingStepDef } from "../ui/loading/steps";
import { loadConserve } from "./conserveLoader";
import { diveParams } from "../scene/dive/params";
import { saveScanKey, savedScanStore, type ScanStore } from "../scene/sonarScan/scanStore";

export type ConserveDive =
  | { status: "idle" | "opening" | "failed" }
  /**
   * Save opened: dive with `seedText` in the bounded world `world` (this generation's site table), its
   * expedition (nodes, tank, caches), base and tide. The tide switches the dive to gen + 1 in place
   * (these stay the objects the world was built with; the world takes the new ones from the tide port).
   * `chaos`: the generation's chaos as the scene presents it (M8), or the debug panel's preview (never saved).
   * `scans`: the save's sonar scan record (game store `scan/<slot>`; a tide leaves it as it is).
   * `gaze`: stage 5's sequence (idle without one). The debug panel's 结局演练 opens a sandboxed copy of
   * the save instead (conserve/session/rehearsal.ts): it and its scans live in memory, the real slot is never written.
   */
  | { status: "open"; seedText: string; world: SiteLayout; expedition: ExpeditionPort; base: BasePort; tide: TidePort; chaos: ChaosView; gaze: GazePort; scans: ScanStore; steps: readonly LoadingStepDef[] }
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
        // the debug panel's 结局演练: a sandboxed copy in memory (save and scans), never the real slot
        const phase = diveParams().rehearsal;
        const store = () => (phase === null ? mod.createGameStoreBackend() : mod.createMemoryBackend());
        const backend = phase === null ? store() : mod.rehearsalBackend(mod.createGameStoreBackend(), phase);
        const outcome = mod.openConserveSession({ backend, intent, hashSeed: seedFromString, rehearsal: phase !== null });
        const report = outcome.ok ? outcome.session.report : outcome.report;
        const steps = mod.withWorldSaveStep(LOADING_STEPS, report);
        if (!outcome.ok) return setDive({ status: "blocked", steps });
        sessionRef.current = outcome.session;
        unbind = mod.flushOnPageHide(() => outcome.session.flush());
        const s = outcome.session;
        // the generation's chaos, or the debug panel's preview: the terrain's wall (cracks) and the scene's view agree
        const dc = mod.diveChaosOf(s, diveParams().chaos, diveParams().omens.anomaly);
        const sk = saveScanKey(s.identity);
        const scans = savedScanStore(store(), sk.key, sk.tag);
        const world = mod.terrainLayoutOf(s.siteTable, dc.wall);
        setDive({ status: "open", seedText: s.seedText, world, expedition: s.expedition, base: s.base, tide: mod.tidePortOf(s), chaos: dc.view, gaze: mod.gazePortOf(s), scans, steps });
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
