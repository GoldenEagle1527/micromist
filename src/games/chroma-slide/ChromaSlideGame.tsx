import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./chroma-slide.css";
import { useLocale } from "../../i18n";
import { useLocalGamePersist } from "../local-persist";
import {
  EMPTY,
  PRESETS,
  TILE_COLORS,
  clickMove,
  isLegalClick,
  isWon,
  newPuzzle,
  type PresetId,
  type PuzzleState,
} from "./engine";

type Screen = "setup" | "playing";
type ConfirmKind = "reshuffle" | "setup" | null;

type ChromaPersist = {
  screen: "playing";
  preset: PresetId;
  puzzle: PuzzleState;
};

export function ChromaSlideGame() {
  const { t } = useLocale();
  const ch = t.chroma;

  const [screen, setScreen] = useState<Screen>("setup");
  const [preset, setPreset] = useState<PresetId>("small");
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const confirmTitleId = useId();
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);

  const persistState: ChromaPersist | null =
    screen === "playing" && puzzle
      ? { screen: "playing", preset, puzzle }
      : null;

  useLocalGamePersist<ChromaPersist>("chroma-slide", persistState, {
    shouldSave: (s) => s.screen === "playing" && s.puzzle != null,
    onHydrate: (data) => {
      if (data.screen !== "playing" || !data.puzzle) return;
      setPreset(data.preset);
      setPuzzle(data.puzzle);
      setHoverIndex(null);
      setConfirm(null);
      setScreen("playing");
    },
  });

  const won = useMemo(() => (puzzle ? isWon(puzzle) : false), [puzzle]);

  const startGame = useCallback(() => {
    setPuzzle(newPuzzle(preset));
    setHoverIndex(null);
    setConfirm(null);
    setScreen("playing");
  }, [preset]);

  const doReshuffle = useCallback(() => {
    if (!puzzle) return;
    setPuzzle(newPuzzle(puzzle.preset));
    setHoverIndex(null);
    setConfirm(null);
  }, [puzzle]);

  const doBackToSetup = useCallback(() => {
    setScreen("setup");
    setPuzzle(null);
    setHoverIndex(null);
    setConfirm(null);
  }, []);

  const onCellClick = useCallback(
    (index: number) => {
      if (!puzzle || won || confirm) return;
      const next = clickMove(puzzle, index);
      if (next !== puzzle) {
        setPuzzle(next);
        setHoverIndex(null);
      }
    },
    [puzzle, won, confirm],
  );

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirm(null);
    };
    document.addEventListener("keydown", onKey);
    confirmCancelRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [confirm]);

  if (screen === "setup") {
    const p = PRESETS[preset];
    return (
      <div className="chroma-slide chroma-setup">
        <div className="panel">
          <h2>{ch.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {ch.setupHint}
          </p>
          <div className="chroma-controls">
            <label>
              {ch.difficulty}
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as PresetId)}
              >
                <option value="small">
                  {ch.small} · {PRESETS.small.size}×{PRESETS.small.size} ·{" "}
                  {PRESETS.small.colorCount} {ch.colors}
                </option>
                <option value="medium">
                  {ch.medium} · {PRESETS.medium.size}×{PRESETS.medium.size} ·{" "}
                  {PRESETS.medium.colorCount} {ch.colors}
                </option>
                <option value="large">
                  {ch.large} · {PRESETS.large.size}×{PRESETS.large.size} ·{" "}
                  {PRESETS.large.colorCount} {ch.colors}
                </option>
              </select>
            </label>
          </div>
          <p className="hint chroma-preset-blurb">
            {ch.presetBlurb(p.size, p.colorCount, p.tilesPerColor)}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={startGame}>
              {ch.start}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!puzzle) return null;

  const { size, board, emptyIndex, steps } = puzzle;
  const legalHover =
    hoverIndex != null && !won && !confirm && isLegalClick(puzzle, hoverIndex);

  return (
    <div className="chroma-slide chroma-playing">
      <div className="chroma-hud">
        <p className="chroma-steps">
          {ch.stepsHud}
          <strong>{steps}</strong>
        </p>
        {won ? <p className="chroma-win">{ch.winMessage(steps)}</p> : null}
      </div>

      <div
        className={`chroma-board glass${won ? " chroma-board-won" : ""}`}
        style={{ ["--chroma-size" as string]: size }}
        role="grid"
        aria-label={ch.boardAria}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {board.map((cell, index) => {
          const isEmpty = cell === EMPTY || index === emptyIndex;
          const isHoverTarget = legalHover && hoverIndex === index;
          const onLine =
            legalHover &&
            hoverIndex != null &&
            (() => {
              const er = Math.floor(emptyIndex / size);
              const ec = emptyIndex % size;
              const hr = Math.floor(hoverIndex / size);
              const hc = hoverIndex % size;
              const r = Math.floor(index / size);
              const c = index % size;
              if (er === hr) {
                const lo = Math.min(ec, hc);
                const hi = Math.max(ec, hc);
                return r === er && c >= lo && c <= hi;
              }
              const lo = Math.min(er, hr);
              const hi = Math.max(er, hr);
              return c === ec && r >= lo && r <= hi;
            })();

          return (
            <button
              key={index}
              type="button"
              role="gridcell"
              className={[
                "chroma-cell",
                isEmpty ? "chroma-empty" : "",
                isHoverTarget ? "chroma-cell-target" : "",
                onLine && !isEmpty ? "chroma-cell-path" : "",
                won && !isEmpty ? "chroma-cell-won" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                isEmpty
                  ? undefined
                  : { backgroundColor: TILE_COLORS[cell] ?? "#888" }
              }
              disabled={won || isEmpty || Boolean(confirm)}
              aria-label={
                isEmpty
                  ? ch.emptyAria
                  : ch.tileAria(
                      cell + 1,
                      Math.floor(index / size) + 1,
                      (index % size) + 1,
                    )
              }
              onClick={() => onCellClick(index)}
              onMouseEnter={() => setHoverIndex(index)}
              onFocus={() => setHoverIndex(index)}
            />
          );
        })}
      </div>

      <div className="chroma-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => setConfirm("reshuffle")}
        >
          {ch.reshuffle}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setConfirm("setup")}
        >
          {ch.adjustSettings}
        </button>
      </div>

      {confirm ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setConfirm(null)}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id={confirmTitleId}>
                {confirm === "reshuffle"
                  ? ch.confirmReshuffleTitle
                  : ch.confirmSetupTitle}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setConfirm(null)}
                aria-label={ch.confirmCancel}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
                </svg>
              </button>
            </div>
            <p className="lede modal-body">
              {confirm === "reshuffle"
                ? ch.confirmReshuffleBody
                : ch.confirmSetupBody}
            </p>
            <div className="modal-actions">
              <button
                ref={confirmCancelRef}
                type="button"
                className="ghost"
                onClick={() => setConfirm(null)}
              >
                {ch.confirmCancel}
              </button>
              <button
                type="button"
                className="primary"
                onClick={
                  confirm === "reshuffle" ? doReshuffle : doBackToSetup
                }
              >
                {ch.confirmOk}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
