/** Sci-fi diving HUD: readout (always), plus dial / action fan / look pad when the panel is on. */
import { useCallback, useState } from "react";
import type { DeepMarchHandle } from "../scene/world";
import { ActionFan } from "./ActionFan";
import { IconExit, IconFlip, IconMute, IconPanel, IconSound } from "./icons";
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
  exit: string;
  flip: string;
  mute: string;
  unmute: string;
};

export function ControlPanel({
  game,
  panelOn,
  onTogglePanel,
  onExit,
  onFlip,
  muted,
  onToggleMute,
  labels,
}: {
  game: DeepMarchHandle | null;
  panelOn: boolean;
  onTogglePanel: () => void;
  /** In-HUD exit (immersive mobile play, where the play bar is hidden). */
  onExit?: () => void;
  /** Flip the rotated portrait fallback by 180°. */
  onFlip?: () => void;
  /** Sound state; undefined hides the mute button (?audio=0 / no Web Audio). */
  muted?: boolean;
  onToggleMute?: () => void;
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
    (id: "swim" | "lamp" | "mode") => {
      if (!game) return;
      if (id === "swim") game.toggleSwimLatch();
      else if (id === "mode") game.cycleLight();
      else game.toggleLamp();
      force((n) => n + 1);
    },
    [game],
  );

  return (
    <div className={`dm-hud-layer${panelOn ? " panel-on" : ""}`}>
      <Readout tel={tel} labels={labels} />
      <div className="dm-hud-buttons">
        {onFlip ? (
          <button type="button" className="dm-hud-btn dm-flip-btn" onClick={onFlip} aria-label={labels.flip} title={labels.flip}>
            <IconFlip />
          </button>
        ) : null}
        {muted !== undefined && onToggleMute ? (
          <button
            type="button"
            className={`dm-hud-btn dm-mute-btn${muted ? " on" : ""}`}
            onClick={onToggleMute}
            aria-label={muted ? labels.unmute : labels.mute}
            aria-pressed={muted}
            title={`${muted ? labels.unmute : labels.mute} (M)`}
          >
            {muted ? <IconMute /> : <IconSound />}
          </button>
        ) : null}
        <button
          type="button"
          className={`dm-hud-btn dm-panel-toggle${panelOn ? " on" : ""}`}
          onClick={onTogglePanel}
          aria-label={panelOn ? labels.hidePanel : labels.showPanel}
          aria-pressed={panelOn}
          title={panelOn ? labels.hidePanel : labels.showPanel}
        >
          <IconPanel />
        </button>
        {onExit ? (
          <button type="button" className="dm-hud-btn dm-exit-btn" onClick={onExit} aria-label={labels.exit} title={labels.exit}>
            <IconExit />
          </button>
        ) : null}
      </div>
      {panelOn && game ? (
        <>
          <LookPad onLook={game.addLook} />
          <MoveDial input={game.panelInput} swimming={swimming} label={labels.dialMove} swimLabel={labels.stateSwim} />
          <ActionFan
            labels={{ up: labels.btnUp, down: labels.btnDown, swim: labels.btnSwim, lamp: labels.btnLamp, mode: labels.lightModes[tel?.light.mode ?? "beam"] }}
            lampOn={tel?.lamp ?? true}
            lampLocked={tel?.light.locked ?? false}
            lightMode={tel?.light.mode ?? "beam"}
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
