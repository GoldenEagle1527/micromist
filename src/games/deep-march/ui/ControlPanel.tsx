/** Sci-fi diving HUD: readout (always), plus dial / action fan / look pad when the panel is on. */
import { useCallback, useState } from "react";
import type { DeepMarchHandle } from "../scene/world";
import { ActionFan, type FanToggleId } from "./ActionFan";
import { IconBase, IconExit, IconFlip, IconMute, IconPanel, IconSound } from "./icons";
import { LookPad } from "./LookPad";
import { MoveDial } from "./MoveDial";
import { Readout, type ReadoutLabels } from "./Readout";
import { useTelemetry } from "./useTelemetry";
import { AbsorbPrompt } from "./expedition/AbsorbPrompt";
import { CacheMarks } from "./expedition/CacheMarks";
import type { ExpeditionDict } from "./expedition/i18n";
import { RecallButton } from "./expedition/RecallButton";
import { TankGauge } from "./expedition/TankGauge";
import { useExpedition } from "./expedition/useExpedition";
import { BasePanel } from "./base/BasePanel";
import { BaseEnergy, BaseNoticeLine } from "./base/BaseStatus";
import { BuildBar } from "./base/BuildBar";
import { HomeMark } from "./base/HomeMark";
import type { BaseDict } from "./base/i18n";
import { useBase } from "./base/useBase";
import { TideHud } from "./tide/TideHud";
import type { TideDict } from "./tide/i18n";
import { useTide } from "./tide/useTide";
import "./panel.css";
import "./expedition/expedition.css";
import "./base/base.css";
import "./base/basePanel.css";

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
  expedition: ExpeditionDict;
  base: BaseDict;
  tide: TideDict;
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
  // conserve mode only: tank, aim prompt, cache markers, recall (null in the free dive)
  const exp = useExpedition(game);
  // conserve with a base (M5): build mode, storage, energy (null in the free dive)
  const base = useBase(game);
  // conserve with a tide (M7): countdown, phase, dome warning, summary
  const tide = useTide(game);
  const building = base?.build.active ?? false;
  const [, force] = useState(0);
  const swimming = tel?.state === "swim";

  const onHold = useCallback(
    (id: "up" | "down" | "absorb", on: boolean) => {
      if (game) game.panelInput[id] = on;
    },
    [game],
  );
  const onToggle = useCallback(
    (id: FanToggleId) => {
      if (!game) return;
      if (id === "build") game.baseCommand({ type: "build" });
      else if (id === "place") game.baseCommand({ type: "place" });
      else if (id === "swim") game.toggleSwimLatch();
      else if (id === "mode") game.cycleLight();
      else game.toggleLamp();
      force((n) => n + 1);
    },
    [game],
  );

  return (
    <div className={`dm-hud-layer${panelOn ? " panel-on" : ""}`}>
      <Readout
        tel={tel}
        labels={labels}
        extra={
          exp ? (
            <>
              <TankGauge exp={exp} labels={labels.expedition} />
              {base ? <BaseEnergy base={base} labels={labels.base} /> : null}
            </>
          ) : null
        }
      />
      {exp ? <CacheMarks exp={exp} title={labels.expedition.cacheMark} /> : null}
      {tide ? <TideHud tide={tide} labels={labels.tide} biomes={labels.regions} /> : null}
      {base ? <HomeMark base={base} title={labels.base.homeMark} /> : null}
      {exp && !building ? <AbsorbPrompt exp={exp} touch={panelOn} labels={labels.expedition} /> : null}
      {base && game ? (
        <>
          <BaseNoticeLine base={base} labels={labels.base} />
          <BuildBar base={base} touch={panelOn} labels={labels.base} kinds={labels.expedition.kinds} send={game.baseCommand} />
          <BasePanel base={base} labels={labels.base} kinds={labels.expedition.kinds} send={game.baseCommand} />
        </>
      ) : null}
      <div className="dm-hud-buttons">
        {base && game ? (
          <button
            type="button"
            className={`dm-hud-btn dm-base-toggle${base.panel ? " on" : ""}`}
            onClick={() => game.baseCommand({ type: "panel" })}
            aria-label={labels.base.btnBase}
            aria-pressed={base.panel}
            title={labels.base.btnBase}
          >
            <IconBase />
          </button>
        ) : null}
        {exp && game ? <RecallButton game={game} exp={exp} labels={labels.expedition} /> : null}
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
            absorb={exp && !building ? { label: labels.expedition.btnAbsorb, active: exp.absorbing } : undefined}
            place={building ? { label: labels.base.btnPlace, ok: base?.build.ok ?? false } : undefined}
            build={base ? { label: labels.base.btnBuild, active: building } : undefined}
          />
        </>
      ) : null}
    </div>
  );
}
