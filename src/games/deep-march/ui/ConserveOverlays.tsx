/**
 * The conserve mode's overlays on the HUD (nothing in the free dive): cache and
 * home marks on the compass, the tide, the new-player hint (M9), the aim prompt,
 * and the base's notice line (sharing one lane with the expedition's), build bar and panel;
 * at stage 5 the gaze's card and prompt, and the endings (湮灭 → onExit).
 */
import type { BaseTelemetry } from "../scene/base/telemetry";
import type { ExpeditionTelemetry } from "../scene/expedition/telemetry";
import type { TideTelemetry } from "../scene/tide/telemetry";
import type { DeepMarchHandle } from "../scene/world";
import type { PanelLabels } from "./ControlPanel";
import { AbsorbPrompt } from "./expedition/AbsorbPrompt";
import { CacheMarks } from "./expedition/CacheMarks";
import { BasePanel } from "./base/BasePanel";
import { BaseNoticeLine } from "./base/BaseStatus";
import { BuildBar } from "./base/BuildBar";
import { HomeMark } from "./base/HomeMark";
import { HintCard } from "./hints/HintCard";
import type { HintState } from "./hints/useHints";
import { useOnce } from "./useOnce";
import { TideHud } from "./tide/TideHud";
import type { GazeTelemetry } from "../scene/gaze/telemetry";
import { GazeHud } from "./gaze/GazeHud";
import { EndingOverlay } from "./gaze/EndingOverlay";

type Props = {
  game: DeepMarchHandle | null;
  exp: ExpeditionTelemetry | null;
  base: BaseTelemetry | null;
  tide: TideTelemetry | null;
  gaze: GazeTelemetry | null;
  panelOn: boolean;
  /** The new-player tips (ControlPanel owns them: the ≡ menu switches them). */
  hints: HintState;
  labels: PanelLabels;
  /** Leave the dive (the 湮灭 ending's way back). */
  onExit?: () => void;
};

export function ConserveOverlays({ game, exp, base, tide, gaze, panelOn, hints, labels, onExit }: Props) {
  // each new-player step teaches once: its card shows 2 s and fades; the step itself stays until done (progression unchanged)
  const hintShown = useOnce(`hint:${hints.step ?? ""}`, hints.step !== null);
  if (!exp) return null;
  const building = base?.build.active ?? false;
  return (
    <>
      <CacheMarks exp={exp} title={labels.expedition.cacheMark} />
      {tide ? <TideHud tide={tide} labels={labels.tide} biomes={labels.regions} /> : null}
      {gaze ? <GazeHud gaze={gaze} labels={labels.gaze} kinds={labels.expedition.kinds} touch={panelOn} /> : null}
      {base ? <HomeMark base={base} title={labels.base.homeMark} /> : null}
      {hintShown ? <HintCard hints={hints} touch={panelOn} labels={labels.hints} /> : null}
      {!building ? <AbsorbPrompt exp={exp} touch={panelOn} labels={labels.expedition} /> : null}
      {base && game ? (
        <>
          {/* one notice lane: the expedition's (in AbsorbPrompt) wins */}
          {!exp.notice ? <BaseNoticeLine base={base} labels={labels.base} /> : null}
          <BuildBar base={base} touch={panelOn} labels={labels.base} kinds={labels.expedition.kinds} send={game.baseCommand} />
          <BasePanel base={base} labels={labels.base} kinds={labels.expedition.kinds} send={game.baseCommand} />
        </>
      ) : null}
      {gaze ? <EndingOverlay gaze={gaze} labels={labels.gaze} onExit={onExit} /> : null}
    </>
  );
}
