/**
 * Setup screen: mode (conserved world / free dive), the conserve save slot, seed,
 * controls, the conserve mode's new-player hints (M9) and sound. Starting hands the parent an OpenIntent in conserve mode
 * (continue / new world) or null for the free dive.
 */
import { useState } from "react";
import type { OpenIntent } from "../../conserve";
import type { DeepMarchDict } from "../../i18n";
import type { GameMode } from "../../modes/gameMode";
import { useConserveSlot } from "../../modes/useConserveSlot";
import { randomSeed, type SoundSettings } from "../../settings";
import { useHintSetting } from "../hints/useHintSetting";
import { ConserveSlotCard } from "./ConserveSlotCard";
import { conserveStart } from "./conserveStart";
import { ModePicker } from "./ModePicker";

export type SetupValues = { mode: GameMode; seed: string; sensitivity: number; invertY: boolean; calmLights: boolean; panelOn: boolean; sound: SoundSettings };

type Props = {
  dm: DeepMarchDict;
  values: SetupValues;
  onChange: (patch: Partial<SetupValues>) => void;
  /** Changes when the save slot may have changed (e.g. back from a dive). */
  slotRefresh: unknown;
  onStart: (intent: OpenIntent | null) => void;
};

export function SetupScreen({ dm, values, onChange, slotRefresh, onStart }: Props) {
  const { mode, seed, sensitivity, invertY, calmLights, panelOn, sound } = values;
  const conserve = mode === "conserve";
  const slot = useConserveSlot(conserve, slotRefresh);
  const [newWorld, setNewWorld] = useState(false);
  const [hintsOn, setHintsOn] = useHintSetting();
  const plan = conserveStart(slot, newWorld);
  const showSeed = !conserve || plan.showSeed;
  const canStart = !conserve || plan.canStart;
  const startLabel = conserve ? dm.setup.start[plan.label] : dm.start;

  const start = () => {
    if (!canStart) return;
    if (!conserve) return onStart(null);
    onStart(plan.intent === "new" ? { kind: "new", seedText: seed.trim() || "1" } : { kind: "continue" });
  };

  return (
    <div className="deep-march dm-setup">
      <div className="panel">
        <h2>{dm.setupTitle}</h2>
        <ModePicker mode={mode} onChange={(m) => onChange({ mode: m })} title={dm.setup.modeTitle} names={dm.setup.modes} hint={conserve ? dm.setup.conserveHint : dm.setupHint} />
        {conserve && <ConserveSlotCard view={slot} plan={plan} newWorldRequested={newWorld} onRequestNewWorld={setNewWorld} labels={dm.setup.slot} />}
        {showSeed && (
          <label className="dm-field">
            <span>{dm.seedLabel}</span>
            <div className="dm-seed-row">
              <input
                type="text"
                inputMode="numeric"
                maxLength={32}
                value={seed}
                onChange={(e) => onChange({ seed: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") start();
                }}
              />
              <button type="button" className="ghost" onClick={() => onChange({ seed: randomSeed() })}>
                {dm.randomSeed}
              </button>
            </div>
          </label>
        )}
        <label className="dm-field">
          <span>
            {dm.sensitivity} <b className="dm-sens-val">{sensitivity.toFixed(1)}×</b>
          </span>
          <input type="range" min={0.2} max={3} step={0.1} value={sensitivity} onChange={(e) => onChange({ sensitivity: Number(e.target.value) })} />
        </label>
        <label className="dm-check">
          <input type="checkbox" checked={invertY} onChange={(e) => onChange({ invertY: e.target.checked })} />
          <span>{dm.invertY}</span>
        </label>
        <label className="dm-check">
          <input type="checkbox" checked={calmLights} onChange={(e) => onChange({ calmLights: e.target.checked })} />
          <span>
            {dm.calmLights}
            <small className="dm-check-hint">{dm.calmLightsHint}</small>
          </span>
        </label>
        {conserve && (
          <label className="dm-check">
            <input type="checkbox" checked={hintsOn} onChange={(e) => setHintsOn(e.target.checked)} />
            <span>
              {dm.hints.setting}
              <small className="dm-check-hint">{dm.hints.settingHint}</small>
            </span>
          </label>
        )}
        <label className="dm-check">
          <input type="checkbox" checked={panelOn} onChange={(e) => onChange({ panelOn: e.target.checked })} />
          <span>
            {dm.panelToggle}
            <small className="dm-check-hint">{dm.panelToggleHint}</small>
          </span>
        </label>
        <label className="dm-check">
          <input type="checkbox" checked={!sound.muted} onChange={(e) => onChange({ sound: { ...sound, muted: !e.target.checked } })} />
          <span>{dm.soundToggle}</span>
        </label>
        <label className="dm-field">
          <span>
            {dm.volume} <b className="dm-sens-val">{Math.round(sound.volume * 100)}%</b>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={sound.volume} disabled={sound.muted} onChange={(e) => onChange({ sound: { ...sound, volume: Number(e.target.value) } })} />
        </label>
        <div className="row">
          <button type="button" className="primary" onClick={start} disabled={!canStart}>
            {startLabel}
          </button>
        </div>
        <div className="dm-controls">
          <h3>{dm.controlsTitle}</h3>
          <ul>
            {(conserve ? [...dm.controls, ...dm.setup.conserveControls] : dm.controls).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
