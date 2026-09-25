/** Sci-fi diving HUD: readout (always), plus dial / action fan / look pad when the panel is on. */
import { useCallback, useState } from "react";
import type { DeepMarchHandle } from "../scene/world";
import { ActionFan } from "./ActionFan";
import { IconPanel } from "./icons";
import { LookPad } from "./LookPad";
import { MoveDial } from "./MoveDial";
import { Readout, type ReadoutLabels } from "./Readout";
import { useTelemetry } from "./useTelemetry";
import "./panel.css";

export type PanelLabels = ReadoutLabels & {
  btnUp: string;
  btnDown: string;
  btnSwim: string;
  btnLamp: string;
  dialMove: string;
  showPanel: string;
  hidePanel: string;
};

export function ControlPanel({
  game,
  panelOn,
  onTogglePanel,
  labels,
}: {
  game: DeepMarchHandle | null;
  panelOn: boolean;
  onTogglePanel: () => void;
  labels: PanelLabels;
}) {
  const tel = useTelemetry(game);
  const [, force] = useState(0);
  const swimming = tel?.state === "swim";

  const onHold = useCallback(
    (id: "up" | "down", on: boolean) => {
      if (game) game.panelInput[id] = on;
    },
    [game],
  );
  const onToggle = useCallback(
    (id: "swim" | "lamp") => {
      if (!game) return;
      if (id === "swim") game.toggleSwimLatch();
      else game.toggleLamp();
      force((n) => n + 1);
    },
    [game],
  );

  return (
    <div className={`dm-hud-layer${panelOn ? " panel-on" : ""}`}>
      <Readout tel={tel} labels={labels} />
      <button
        type="button"
        className={`dm-panel-toggle${panelOn ? " on" : ""}`}
        onClick={onTogglePanel}
        aria-label={panelOn ? labels.hidePanel : labels.showPanel}
        aria-pressed={panelOn}
        title={panelOn ? labels.hidePanel : labels.showPanel}
      >
        <IconPanel />
      </button>
      {panelOn && game ? (
        <>
          <LookPad onLook={game.addLook} />
          <MoveDial input={game.panelInput} swimming={swimming} label={labels.dialMove} swimLabel={labels.stateSwim} />
          <ActionFan
            labels={{ up: labels.btnUp, down: labels.btnDown, swim: labels.btnSwim, lamp: labels.btnLamp }}
            lampOn={tel?.lamp ?? true}
            swimLatch={tel?.swimLatch ?? false}
            swimming={swimming}
            stateLabel={swimming ? labels.stateSwim : labels.stateHover}
            speed={tel?.speed ?? 0}
            onHold={onHold}
            onToggle={onToggle}
          />
        </>
      ) : null}
    </div>
  );
}
