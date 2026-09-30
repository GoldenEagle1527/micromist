/** Setup screen: what is in the conserve save slot (loads the conserve chunk on first use). */
import { useEffect, useState } from "react";
import type { SlotSummary } from "../conserve";
import { loadConserve } from "./conserveLoader";

export type SlotView = { state: "loading" } | { state: "failed" } | SlotSummary;

/** `refresh` changes whenever the slot may have changed (back from a dive). */
export function useConserveSlot(active: boolean, refresh: unknown): SlotView {
  const [view, setView] = useState<SlotView>({ state: "loading" });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadConserve().then(
      (mod) => !cancelled && setView(mod.peekWorldSlot(mod.createGameStoreBackend())),
      () => !cancelled && setView({ state: "failed" }),
    );
    return () => {
      cancelled = true;
    };
  }, [active, refresh]);
  return view;
}
