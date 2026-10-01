/**
 * The new-player hint (conserve mode, M9): one compact line under the ≡ button,
 * top right — never over the view centre, the aim prompt or the notices; each
 * step's card shows once, 2 s, then fades (ConserveOverlays / useOnce). 「知道了」 / H dismisses it (the ≡ menu turns all tips off), and
 * it also goes away by itself once the player does what it says (hintModel.ts).
 */
import type { HintState } from "./useHints";
import type { HintDict } from "./i18n";
import "./hints.css";

export function HintCard({ hints, touch, labels }: { hints: HintState; touch: boolean; labels: HintDict }) {
  if (!hints.step) return null;
  const text = labels.steps[hints.step][touch ? "touch" : "key"];
  return (
    <div className="dm-hint dm-once" role="note" aria-label={labels.title} key={hints.step} onPointerDown={(e) => e.stopPropagation()}>
      <p>{text}</p>
      <button type="button" className="dm-base-btn" onClick={hints.dismiss}>
        {labels.gotIt}
        {touch ? null : <kbd>{labels.gotItKey}</kbd>}
      </button>
    </div>
  );
}
