/**
 * Sci-fi diving HUD, kept to what matters now. Always: compass, depth + battery,
 * the ≡ menu button (touch: dial + a 4-button fan). Only when it applies: the
 * mode's gauges, warnings, region / light toasts, the base and recall buttons,
 * the fan's context button, the observation banner, conserve overlays (tank,
 * base, tide, hints). Everything else lives in the ≡ menu (also Esc) and the
 * help sheet (also ?).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useOnce } from "./useOnce";
import type { DeepMarchHandle } from "../scene/world";
import { ActionFan, type FanPressId, type FanToggleId } from "./ActionFan";
import { IconBase, IconMenu } from "./icons";
import { LookPad } from "./LookPad";
import { MoveDial } from "./MoveDial";
import { Readout, type ReadoutLabels } from "./Readout";
import { km2, ObserveBanner, SonarChip, type SonarHudLabels } from "./SonarGauge";
import { useTelemetry } from "./useTelemetry";
import { ConserveOverlays } from "./ConserveOverlays";
import type { ExpeditionDict } from "./expedition/i18n";
import { RecallButton } from "./expedition/RecallButton";
import { TankGauge } from "./expedition/TankGauge";
import { useExpedition } from "./expedition/useExpedition";
import { BaseEnergy } from "./base/BaseStatus";
import type { BaseDict } from "./base/i18n";
import { useBase } from "./base/useBase";
import type { TideDict } from "./tide/i18n";
import { useTide } from "./tide/useTide";
import type { HintDict } from "./hints/i18n";
import { useHints } from "./hints/useHints";
import { GameMenu, HelpSheet, type MenuSound } from "./menu/GameMenu";
import type { MenuDict } from "./menu/i18n";
import "./panel.css";
import "./expedition/expedition.css";
import "./base/base.css";
import "./base/basePanel.css";

export type PanelLabels = ReadoutLabels & {
  btnUp: string;
  btnDown: string;
  btnLamp: string;
  btnPing: string;
  sonar: SonarHudLabels;
  dialMove: string;
  menu: MenuDict;
  /** Help sheet: the controls (keys + touch). */
  controls: readonly string[];
  /** Conserve additions to the help. */
  conserveControls: readonly string[];
  /** 「种子 …」 for the menu. */
  seedNow: (seed: string) => string;
  expedition: ExpeditionDict;
  base: BaseDict;
  tide: TideDict;
  hints: HintDict;
};

type Props = {
  game: DeepMarchHandle | null;
  panelOn: boolean;
  onTogglePanel: () => void;
  /** Leave the dive (menu). */
  onExit: () => void;
  /** Flip the rotated portrait fallback by 180° (menu; only while rotated). */
  onFlip?: () => void;
  /** Sound for the menu; undefined: no audio this dive. */
  sound?: MenuSound;
  /** True fullscreen for the menu; undefined: not supported. */
  fullscreen?: { on: boolean; toggle: () => void };
  /** The dive's seed text. */
  seed: string;
  /** Staging: open the debug panel (menu). */
  onDebug?: () => void;
  /** The debug panel is open: Esc is its own. */
  debugOpen: boolean;
  labels: PanelLabels;
};

export function ControlPanel({ game, panelOn, onTogglePanel, onExit, onFlip, sound, fullscreen, seed, onDebug, debugOpen, labels }: Props) {
  const tel = useTelemetry(game);
  // conserve mode only: tank, aim prompt, cache markers, recall (null in the free dive)
  const exp = useExpedition(game);
  // conserve with a base (M5): build mode, storage, energy (null in the free dive)
  const base = useBase(game);
  // conserve with a tide (M7): countdown, phase, dome warning, summary
  const tide = useTide(game);
  const hints = useHints(exp, base, tide, tel?.ready ?? false, tel?.scan.observe ?? false);
  const building = base?.build.active ?? false;
  const [, force] = useState(0);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const swimming = tel?.state === "swim";
  const observeTip = useOnce("observe", tel?.scan.observe ?? false);
  const keysTip = useOnce("keys", (tel?.ready ?? false) && !panelOn);

  // Esc: the menu (once the mouse is free; the debug panel keeps its own Esc); ? / F1: help
  const keys = useRef({ menu, help, debugOpen });
  keys.current = { menu, help, debugOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || keys.current.debugOpen) return;
      const k = keys.current;
      if (e.code === "Escape") {
        if (k.help) setHelp(false);
        else if (k.menu) setMenu(false);
        else if (!document.pointerLockElement) setMenu(true);
      } else if (e.key === "?" || e.code === "F1") {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if ((menu || help) && document.pointerLockElement) document.exitPointerLock();
  }, [menu, help]);

  const onHold = useCallback(
    (id: "up" | "down" | "absorb", on: boolean) => {
      if (game) game.panelInput[id] = on;
    },
    [game],
  );
  const onToggle = useCallback(
    (id: FanToggleId) => {
      if (!game) return;
      game.baseCommand({ type: id });
      force((n) => n + 1);
    },
    [game],
  );
  const onPress = useCallback(
    (id: FanPressId, long: boolean) => {
      if (!game) return;
      if (id === "lamp") {
        if (long) game.cycleLight();
        else game.toggleLamp();
      } else if (long) game.toggleObserve();
      else game.ping();
      force((n) => n + 1);
    },
    [game],
  );

  const founded = base?.view.founded ?? false;
  const atBase = base?.atBase ?? false;
  const showBase = !!base && founded && (atBase || base.panel);
  const showRecall = !!exp && (!atBase || exp.recall.phase !== "idle");
  const showEnergy = !!base && founded && (atBase || base.docked || base.view.brownout);
  const canBuild = !!base && !building && (!founded || atBase);
  const helpItems = exp ? [...labels.controls, ...labels.conserveControls] : labels.controls;

  return (
    <div className={`dm-hud-layer${panelOn ? " panel-on" : ""}`}>
      <Readout
        tel={tel}
        labels={labels}
        lightToast={!panelOn}
        extra={
          <>
            {tel && !panelOn ? <SonarChip tel={tel} labels={labels.sonar} /> : null}
            {exp ? <TankGauge exp={exp} labels={labels.expedition} /> : null}
            {base && showEnergy ? <BaseEnergy base={base} labels={labels.base} /> : null}
          </>
        }
      />
      {tel?.scan.observe && observeTip ? <ObserveBanner labels={labels.sonar} area={tel.scan.area} touch={panelOn} /> : null}
      <ConserveOverlays game={game} exp={exp} base={base} tide={tide} panelOn={panelOn} hints={hints} labels={labels} />
      <div className="dm-hud-buttons">
        {showBase && base && game ? (
          <button
            type="button"
            className={`dm-hud-btn dm-base-toggle${base.panel ? " on" : ""}`}
            onClick={() => game.baseCommand({ type: "panel" })}
            aria-label={labels.base.btnBase}
            aria-pressed={base.panel}
            title={`${labels.base.btnBase} (Q)`}
          >
            <IconBase />
          </button>
        ) : null}
        {showRecall && exp && game ? <RecallButton game={game} exp={exp} labels={labels.expedition} /> : null}
        <button
          type="button"
          className={`dm-hud-btn dm-menu-btn${menu ? " on" : ""}`}
          onClick={() => setMenu((m) => !m)}
          aria-label={labels.menu.open}
          aria-expanded={menu}
          title={labels.menu.open}
        >
          <IconMenu />
        </button>
      </div>
      {keysTip ? <div className="dm-key-chip dm-once">{labels.menu.keyChip}</div> : null}
      {panelOn && game ? (
        <>
          <LookPad onLook={game.addLook} />
          <MoveDial input={game.panelInput} swimming={swimming || (tel?.swimLatch ?? false)} label={labels.dialMove} swimLabel={labels.stateSwim} onDoubleTap={() => (game.toggleSwimLatch(), force((n) => n + 1))} />
          <ActionFan
            labels={{ up: labels.btnUp, down: labels.btnDown, lamp: labels.btnLamp, modes: labels.lightModes }}
            lampOn={tel?.lamp ?? true}
            lampLocked={tel?.light.locked ?? false}
            lightMode={tel?.light.mode ?? "beam"}
            swimming={swimming}
            onHold={onHold}
            onToggle={onToggle}
            onPress={onPress}
            ping={tel?.sonar.available ? { label: labels.btnPing, ready: tel.sonar.ready, charge: tel.sonar.charge, observe: tel.scan.observe } : undefined}
            absorb={exp && !building ? { label: labels.expedition.btnAbsorb, active: exp.absorbing, target: exp.target !== null } : undefined}
            place={building ? { label: labels.base.btnPlace, ok: base?.build.ok ?? false } : undefined}
            build={canBuild ? { label: labels.base.btnBuild, active: false } : undefined}
            contextSlot={!!exp}
          />
        </>
      ) : null}
      {menu ? (
        <GameMenu
          labels={labels.menu}
          seed={labels.seedNow(seed)}
          mapped={tel?.sonar.available ? km2(tel.scan.area) : null}
          sound={sound}
          fullscreen={fullscreen}
          panel={{ on: panelOn, toggle: onTogglePanel }}
          onFlip={onFlip}
          hints={exp ? { on: hints.on, setOn: hints.setOn } : undefined}
          onDebug={
            onDebug
              ? () => {
                  setMenu(false);
                  onDebug();
                }
              : undefined
          }
          onHelp={() => {
            setMenu(false);
            setHelp(true);
          }}
          onExit={onExit}
          onClose={() => setMenu(false)}
        />
      ) : null}
      {help ? <HelpSheet title={labels.menu.helpTitle} items={helpItems} closeLabel={labels.menu.close} onClose={() => setHelp(false)} /> : null}
    </div>
  );
}
