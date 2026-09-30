/** Setup screen: choose the conserved world or the free dive. */
import { GAME_MODES, type GameMode } from "../../modes/gameMode";

type Props = { mode: GameMode; onChange: (mode: GameMode) => void; title: string; names: Record<GameMode, string>; hint: string };

export function ModePicker({ mode, onChange, title, names, hint }: Props) {
  return (
    <fieldset className="dm-modes">
      <legend>{title}</legend>
      {GAME_MODES.map((m) => (
        <label key={m} className="dm-mode" data-on={m === mode || undefined}>
          <input type="radio" name="dm-mode" value={m} checked={m === mode} onChange={() => onChange(m)} />
          <span className="dm-mode-name">{names[m]}</span>
        </label>
      ))}
      <p className="dm-mode-hint">{hint}</p>
    </fieldset>
  );
}
