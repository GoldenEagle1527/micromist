/**
 * The new-player hint (conserve mode, M9): a small card under the HUD buttons,
 * top right — never over the view centre, the aim prompt or the notices.
 * Dismissible (「知道了」 / H, 「不再提示」); it also goes away by itself once the
 * player does what it says (hintModel.ts).
 */
import type { HintState } from "./useHints";
import type { HintDict } from "./i18n";
import "./hints.css";

export function HintCard({ hints, touch, labels }: { hints: HintState; touch: boolean; labels: HintDict }) {
  if (!hints.step) return null;
  const text = labels.steps[hints.step][touch ? "touch" : "key"];
  return (
    <div className="dm-hint" role="note" aria-label={labels.title} onPointerDown={(e) => e.stopPropagation()}>
      <small>{labels.title}</small>
      <p>{text}</p>
      <div className="dm-hint-actions">
        <button type="button" className="dm-base-btn" onClick={hints.dismiss}>
          {labels.gotIt}
          {touch ? null : <kbd>{labels.gotItKey}</kbd>}
        </button>
        <button type="button" className="dm-base-btn dim" onClick={hints.hideAll}>
          {labels.hideAll}
        </button>
      </div>
    </div>
  );
}
