/**
 * The in-game ≡ menu (also on Esc once the mouse is free): everything that used
 * to sit on the HUD or the play bar but isn't needed every second — sound,
 * true fullscreen, the touch controls, the portrait flip, beginner tips, help,
 * the staging debug panel, the seed / sonar survey, and leaving the dive.
 * While it is open the dive is paused (ControlPanel → game.setPaused): every
 * game clock stops, the sound is suspended, the mouse is free; closing resumes.
 */
import type { MenuDict } from "./i18n";
import "./menu.css";

export type MenuSound = { muted: boolean; volume: number; onChange: (next: { muted: boolean; volume: number }) => void };

type Props = {
  labels: MenuDict;
  /** 「种子 …」 line. */
  seed: string;
  /** Surveyed seabed (km² text), null without the sonar. */
  mapped: string | null;
  /** Undefined: no audio this dive (sound off in the debug panel / no Web Audio). */
  sound?: MenuSound;
  /** Undefined: the browser has no true fullscreen (iPhone Safari). */
  fullscreen?: { on: boolean; toggle: () => void };
  panel: { on: boolean; toggle: () => void };
  onFlip?: () => void;
  /** Conserve: the beginner tips. */
  hints?: { on: boolean; setOn: (on: boolean) => void };
  /** Staging only. */
  onDebug?: () => void;
  onHelp: () => void;
  onExit: () => void;
  onClose: () => void;
};

function Switch({ label, hint, on, onClick, labels }: { label: string; hint?: string; on: boolean; onClick: () => void; labels: MenuDict }) {
  return (
    <button type="button" className="dm-menu-row" role="switch" aria-checked={on} onClick={onClick}>
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <b className={on ? "on" : undefined}>{on ? labels.on : labels.off}</b>
    </button>
  );
}

export function GameMenu({ labels, seed, mapped, sound, fullscreen, panel, onFlip, hints, onDebug, onHelp, onExit, onClose }: Props) {
  return (
    <div className="dm-menu-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dm-menu" role="dialog" aria-label={labels.title} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dm-menu-head">
          <strong>{labels.title}</strong>
          <small>
            {seed}
            {mapped !== null ? ` · ${labels.mapped} ${mapped} km²` : ""}
          </small>
        </div>
        <button type="button" className="dm-menu-main" onClick={onClose}>
          {labels.resume}
        </button>
        {sound ? (
          <div className="dm-menu-sound">
            <Switch label={labels.sound} on={!sound.muted} onClick={() => sound.onChange({ ...sound, muted: !sound.muted })} labels={labels} />
            <label className="dm-menu-slider">
              <span>
                {labels.volume} <b>{Math.round(sound.volume * 100)}%</b>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sound.volume}
                disabled={sound.muted}
                onChange={(e) => sound.onChange({ muted: sound.muted, volume: Number(e.target.value) })}
              />
            </label>
          </div>
        ) : null}
        {fullscreen ? <Switch label={labels.fullscreen} hint={labels.fullscreenHint} on={fullscreen.on} onClick={fullscreen.toggle} labels={labels} /> : null}
        <Switch label={labels.touchControls} on={panel.on} onClick={panel.toggle} labels={labels} />
        {hints ? <Switch label={labels.hints} on={hints.on} onClick={() => hints.setOn(!hints.on)} labels={labels} /> : null}
        {onFlip ? (
          <button type="button" className="dm-menu-row" onClick={onFlip}>
            <span>{labels.flip}</span>
          </button>
        ) : null}
        <button type="button" className="dm-menu-row" onClick={onHelp}>
          <span>{labels.help}</span>
          <kbd>?</kbd>
        </button>
        {onDebug ? (
          <button type="button" className="dm-menu-row dm-menu-debug" onClick={onDebug}>
            <span>{labels.debug}</span>
            <kbd>`</kbd>
          </button>
        ) : null}
        <button type="button" className="dm-menu-row dm-menu-exit" onClick={onExit}>
          <span>{labels.exit}</span>
        </button>
      </div>
    </div>
  );
}

/** The controls list (what the setup screen shows), on top of the dive. */
export function HelpSheet({ title, items, closeLabel, onClose }: { title: string; items: readonly string[]; closeLabel: string; onClose: () => void }) {
  return (
    <div className="dm-menu-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dm-menu dm-help" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dm-menu-head">
          <strong>{title}</strong>
          <button type="button" className="dm-menu-close" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <ul>
          {items.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
