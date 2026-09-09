import { useCallback, useMemo, useState } from "react";
import { useLocale } from "../../i18n";
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

export function ChromaSlideGame() {
  const { t } = useLocale();
  const ch = t.chroma;

  const [screen, setScreen] = useState<Screen>("setup");
  const [preset, setPreset] = useState<PresetId>("small");
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const won = useMemo(() => (puzzle ? isWon(puzzle) : false), [puzzle]);

  const startGame = useCallback(() => {
    setPuzzle(newPuzzle(preset));
    setHoverIndex(null);
    setScreen("playing");
  }, [preset]);

  const reshuffle = useCallback(() => {
    if (!puzzle) return;
    setPuzzle(newPuzzle(puzzle.preset));
    setHoverIndex(null);
  }, [puzzle]);

  const backToSetup = useCallback(() => {
    setScreen("setup");
    setPuzzle(null);
    setHoverIndex(null);
  }, []);

  const onCellClick = useCallback(
    (index: number) => {
      if (!puzzle || won) return;
      const next = clickMove(puzzle, index);
      if (next !== puzzle) {
        setPuzzle(next);
        setHoverIndex(null);
      }
    },
    [puzzle, won],
  );

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
    hoverIndex != null && !won && isLegalClick(puzzle, hoverIndex);

  return (
    <div className="chroma-slide chroma-playing">
      <div className="panel chroma-status">
        <div className="row" style={{ marginTop: 0 }}>
          <button type="button" className="ghost" onClick={backToSetup}>
            {ch.backSetup}
          </button>
          <span>
            {ch.stepsHud}：<strong>{steps}</strong>
          </span>
          <span className="hint" style={{ margin: 0 }}>
            {PRESETS[puzzle.preset].size}×{PRESETS[puzzle.preset].size}
          </span>
        </div>
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {won ? ch.winMessage(steps) : ch.playHint}
        </p>
        <div className="row">
          <button type="button" className="ghost" onClick={reshuffle}>
            {ch.reshuffle}
          </button>
          {won ? (
            <button type="button" className="primary" onClick={reshuffle}>
              {ch.playAgain}
            </button>
          ) : null}
        </div>
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
                // same row: highlight between empty and hover (inclusive of tiles that move)
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
              disabled={won || isEmpty}
              aria-label={
                isEmpty
                  ? ch.emptyAria
                  : ch.tileAria(cell + 1, Math.floor(index / size) + 1, (index % size) + 1)
              }
              onClick={() => onCellClick(index)}
              onMouseEnter={() => setHoverIndex(index)}
              onFocus={() => setHoverIndex(index)}
            />
          );
        })}
      </div>
    </div>
  );
}
