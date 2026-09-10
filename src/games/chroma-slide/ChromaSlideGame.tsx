import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./chroma-slide.css";
import { useLocale } from "../../i18n";
import { clearLocalProgress, useLocalGamePersist } from "../local-persist";
import {
  EMPTY,
  PRESETS,
  TILE_COLORS,
  clickMove,
  isLegalClick,
  isWon,
  newPuzzle,
  normalizePresetId,
  type PresetId,
  type PuzzleState,
} from "./engine";
import {
  loadScores,
  recordWin,
  type ChromaRunRecord,
  type ChromaScores,
} from "./scores";

type Screen = "setup" | "playing";
type ConfirmKind = "reshuffle" | "setup" | null;

type ChromaPersist = {
  screen: "playing";
  preset: PresetId;
  puzzle: PuzzleState;
};

type WinModalState = {
  steps: number;
  isNewBest: boolean;
};

function presetLabel(ch: { easy: string; normal: string; hard: string }, id: PresetId): string {
  if (id === "easy") return ch.easy;
  if (id === "normal") return ch.normal;
  return ch.hard;
}

function HistoryRow({
  run,
  ch,
  badge,
}: {
  run: ChromaRunRecord;
  ch: ReturnType<typeof useLocale>["t"]["chroma"];
  badge?: string;
}) {
  return (
    <li className="chroma-history-row">
      <div className="chroma-history-row-main">
        {badge ? <span className="chroma-history-badge">{badge}</span> : null}
        <span className="chroma-history-steps">{ch.stepsCount(run.steps)}</span>
        <span className="chroma-history-preset">{presetLabel(ch, run.preset)}</span>
      </div>
      <div className="chroma-history-row-meta">
        <time dateTime={new Date(run.at).toISOString()}>{ch.playedAt(run.at)}</time>
        {run.durationMs != null ? (
          <span className="chroma-history-duration">{ch.durationLabel(run.durationMs)}</span>
        ) : null}
      </div>
    </li>
  );
}

export function ChromaSlideGame() {
  const { t } = useLocale();
  const ch = t.chroma;

  const [screen, setScreen] = useState<Screen>("setup");
  const [preset, setPreset] = useState<PresetId>("easy");
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [scores, setScores] = useState<ChromaScores>(() => loadScores());
  const [winModal, setWinModal] = useState<WinModalState | null>(null);
  const confirmTitleId = useId();
  const winTitleId = useId();
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const winPlayAgainRef = useRef<HTMLButtonElement | null>(null);
  const recordedWinRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  const persistState: ChromaPersist | null =
    screen === "playing" && puzzle
      ? { screen: "playing", preset, puzzle }
      : null;

  useLocalGamePersist<ChromaPersist>("chroma-slide", persistState, {
    shouldSave: (s) => s.screen === "playing" && s.puzzle != null,
    onHydrate: (data) => {
      if (data.screen !== "playing" || !data.puzzle) return;
      const pid =
        normalizePresetId(data.preset) ??
        normalizePresetId(data.puzzle.preset) ??
        "easy";
      const expect = PRESETS[pid];
      const pz = data.puzzle;
      // Drop incompatible mid-run saves after preset retune.
      if (
        pz.size !== expect.size ||
        pz.colorCount !== expect.colorCount ||
        pz.board.length !== expect.size * expect.size
      ) {
        return;
      }
      const puzzle = { ...pz, preset: pid };
      setPreset(pid);
      setPuzzle(puzzle);
      setHoverIndex(null);
      setConfirm(null);
      startedAtRef.current = null;
      const alreadyWon = isWon(puzzle);
      // Already recorded: skip recordWin, but still show the result modal.
      recordedWinRef.current = alreadyWon;
      setWinModal(
        alreadyWon ? { steps: puzzle.steps, isNewBest: false } : null,
      );
      setScreen("playing");
    },
  });

  const won = useMemo(() => (puzzle ? isWon(puzzle) : false), [puzzle]);

  useEffect(() => {
    if (screen === "setup") setScores(loadScores());
  }, [screen]);

  useEffect(() => {
    if (!won || !puzzle || recordedWinRef.current) return;
    recordedWinRef.current = true;
    const at = Date.now();
    const startedAt = startedAtRef.current;
    const durationMs =
      startedAt != null && at >= startedAt ? at - startedAt : undefined;
    const { scores: next, isNewBest } = recordWin({
      steps: puzzle.steps,
      preset: puzzle.preset,
      at,
      ...(durationMs != null ? { durationMs } : {}),
    });
    setScores(next);
    setWinModal({ steps: puzzle.steps, isNewBest });
  }, [won, puzzle]);

  const startGame = useCallback(() => {
    setPuzzle(newPuzzle(preset));
    setHoverIndex(null);
    setConfirm(null);
    setWinModal(null);
    startedAtRef.current = Date.now();
    recordedWinRef.current = false;
    setScreen("playing");
  }, [preset]);

  const doReshuffle = useCallback(() => {
    if (!puzzle) return;
    setPuzzle(newPuzzle(puzzle.preset));
    setHoverIndex(null);
    setConfirm(null);
    setWinModal(null);
    startedAtRef.current = Date.now();
    recordedWinRef.current = false;
  }, [puzzle]);

  const doBackToSetup = useCallback(() => {
    setScreen("setup");
    setPuzzle(null);
    setHoverIndex(null);
    setConfirm(null);
    setWinModal(null);
  }, []);

  const playAgain = useCallback(() => {
    clearLocalProgress("chroma-slide");
    doBackToSetup();
  }, [doBackToSetup]);

  const onCellClick = useCallback(
    (index: number) => {
      if (!puzzle || won || confirm || winModal) return;
      const next = clickMove(puzzle, index);
      if (next !== puzzle) {
        setPuzzle(next);
        setHoverIndex(null);
      }
    },
    [puzzle, won, confirm, winModal],
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

  useEffect(() => {
    if (!winModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWinModal(null);
    };
    document.addEventListener("keydown", onKey);
    winPlayAgainRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [winModal]);

  if (screen === "setup") {
    const p = PRESETS[preset];
    const hasHistory = scores.best != null || scores.recent.length > 0;
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
                <option value="easy">
                  {ch.easy} · {PRESETS.easy.size}×{PRESETS.easy.size} ·{" "}
                  {PRESETS.easy.squareSide}×{PRESETS.easy.squareSide}
                </option>
                <option value="normal">
                  {ch.normal} · {PRESETS.normal.size}×{PRESETS.normal.size} ·{" "}
                  {PRESETS.normal.squareSide}×{PRESETS.normal.squareSide}
                </option>
                <option value="hard">
                  {ch.hard} · {PRESETS.hard.size}×{PRESETS.hard.size} ·{" "}
                  {PRESETS.hard.squareSide}×{PRESETS.hard.squareSide}
                </option>
              </select>
            </label>
          </div>
          <p className="hint chroma-preset-blurb">
            {ch.presetBlurb(p.size, p.colorCount, p.squareSide)}
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={startGame}>
              {ch.start}
            </button>
          </div>
        </div>

        <section className="chroma-history" aria-label={ch.historyTitle}>
          <h3 className="chroma-history-title">{ch.historyTitle}</h3>
          {!hasHistory ? (
            <p className="hint chroma-history-empty">{ch.emptyHistory}</p>
          ) : (
            <div className="chroma-history-scroll">
              {scores.best ? (
                <div className="chroma-history-block">
                  <p className="chroma-history-label">{ch.bestLabel}</p>
                  <ul className="chroma-history-list">
                    <HistoryRow run={scores.best} ch={ch} badge={ch.bestLabel} />
                  </ul>
                </div>
              ) : null}
              {scores.recent.length > 0 ? (
                <div className="chroma-history-block">
                  <p className="chroma-history-label">{ch.recentLabel}</p>
                  <ul className="chroma-history-list">
                    {scores.recent.map((run) => (
                      <HistoryRow
                        key={`${run.at}-${run.steps}-${run.preset}`}
                        run={run}
                        ch={ch}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (!puzzle) return null;

  const { size, board, emptyIndex, steps } = puzzle;
  const legalHover =
    hoverIndex != null && !won && !confirm && !winModal && isLegalClick(puzzle, hoverIndex);

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
              disabled={won || isEmpty || Boolean(confirm) || Boolean(winModal)}
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
          disabled={Boolean(winModal)}
        >
          {ch.reshuffle}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setConfirm("setup")}
          disabled={Boolean(winModal)}
        >
          {ch.adjustSettings}
        </button>
      </div>

      {winModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setWinModal(null)}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={winTitleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id={winTitleId}>{ch.winModalTitle}</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setWinModal(null)}
                aria-label={ch.confirmCancel}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
                </svg>
              </button>
            </div>
            <p className="lede modal-body">{ch.winMessage(winModal.steps)}</p>
            {winModal.isNewBest ? (
              <p className="chroma-win-best-badge">{ch.newBestBadge}</p>
            ) : null}
            <div className="modal-actions">
              <button
                ref={winPlayAgainRef}
                type="button"
                className="primary"
                onClick={playAgain}
              >
                {ch.playAgain}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirm && !winModal ? (
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
