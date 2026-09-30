/** Setup screen, conserve mode: the save slot's state and the "new world" choice. */
import type { SlotView } from "../../modes/useConserveSlot";
import type { ConserveStart } from "./conserveStart";
import type { SetupDict } from "./i18n";

type Props = {
  view: SlotView;
  plan: ConserveStart;
  newWorldRequested: boolean;
  onRequestNewWorld: (on: boolean) => void;
  labels: SetupDict["slot"];
};

function slotLine(view: SlotView, L: SetupDict["slot"]): string {
  switch (view.state) {
    case "loading":
      return L.loading;
    case "failed":
      return L.failed;
    case "empty":
      return L.empty;
    case "ready":
      return L.ready(view.seedText, view.gen, view.divesStarted);
    case "ended":
      return L.ended(view.seedText);
    case "unreadable":
      return L.unreadable;
  }
}

export function ConserveSlotCard({ view, plan, newWorldRequested, onRequestNewWorld, labels: L }: Props) {
  const replacing = plan.label === "overwrite";
  return (
    <section className="dm-slot" data-state={view.state} aria-live="polite">
      <p className="dm-slot-line">{slotLine(view, L)}</p>
      {replacing && <p className="dm-slot-warn">{L.overwriteWarning}</p>}
      {plan.showNewWorldButton && (
        <button type="button" className="ghost" onClick={() => onRequestNewWorld(true)}>
          {L.newWorld}
        </button>
      )}
      {newWorldRequested && view.state === "ready" && (
        <button type="button" className="ghost" onClick={() => onRequestNewWorld(false)}>
          {L.cancelNew}
        </button>
      )}
    </section>
  );
}
