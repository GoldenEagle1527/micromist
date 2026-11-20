import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./gomoku.css";
import { useLocale } from "../../i18n";
import { useLocalGamePersist } from "../local-persist";
import { chooseMove, type Difficulty } from "./ai";
import {
  SIZE,
  colOf,
  emptyState,
  isOver,
  isValidState,
  play,
  rowOf,
  undo,
  type GameState,
  type Player,
} from "./engine";

type Opponent = "ai" | "local";
type Screen = "setup" | "playing";
type ConfirmKind = "restart" | "setup" | null;

type Settings = {
  opponent: Opponent;
  difficulty: Difficulty;
  humanColor: Player;
};

type Persist = {
  screen: "playing";
  settings: Settings;
  state: GameState;
};

const COLS = "ABCDEFGHIJKLMNO";
const STARS = new Set([
  `${3}-${3}`,
  `${3}-11`,
  `${7}-${7}`,
  `${11}-${3}`,
  `${11}-11`,
]);

const DEFAULT_SETTINGS: Settings = {
  opponent: "ai",
  difficulty: "normal",
  humanColor: 1,
};

function statusText(
  state: GameState,
  settings: Settings,
  thinking: boolean,
  t: ReturnType<typeof useLocale>["t"]["gomoku"],
): string {
  if (thinking) return t.thinking;
  if (state.winner === 3) return t.draw;
  if (state.winner === 1 || state.winner === 2) {
    if (settings.opponent === "ai") {
      return state.winner === settings.humanColor ? t.youWin : t.youLose;
    }
    return state.winner === 1 ? t.blackWins : t.whiteWins;
  }
  return state.turn === 1 ? t.turnBlack : t.turnWhite;
}

export function GomokuGame() {
  const { t } = useLocale();
  const g = t.gomoku;
  const [screen, setScreen] = useState<Screen>("setup");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<GameState>(() => emptyState());
  const [hover, setHover] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const confirmTitleId = useId();
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const thinkingRef = useRef(false);
  const aiTimer = useRef<number | null>(null);

  const persistState: Persist | null =
    screen === "playing"
      ? { screen: "playing", settings, state }
      : null;

  useLocalGamePersist<Persist>("gomoku", persistState, {
    shouldSave: (s) => s.screen === "playing" && s.state.moves.length > 0 && s.state.winner === 0,
    onHydrate: (data) => {
      if (data.screen !== "playing" || !isValidState(data.state)) return;
      const nextSettings: Settings = {
        opponent: data.settings?.opponent === "local" ? "local" : "ai",
        difficulty:
          data.settings?.difficulty === "easy" || data.settings?.difficulty === "hard"
            ? data.settings.difficulty
            : "normal",
        humanColor: data.settings?.humanColor === 2 ? 2 : 1,
      };
      setSettings(nextSettings);
      setState(data.state);
      setHover(null);
      setConfirm(null);
      setScreen("playing");
    },
  });

  const clearAiTimer = useCallback(() => {
    if (aiTimer.current != null) {
      window.clearTimeout(aiTimer.current);
      aiTimer.current = null;
    }
    thinkingRef.current = false;
    setThinking(false);
  }, []);

  useEffect(() => () => clearAiTimer(), [clearAiTimer]);

  const needsAi =
    screen === "playing" &&
    settings.opponent === "ai" &&
    !isOver(state) &&
    state.turn !== settings.humanColor &&
    !confirm;

  const runAi = useCallback((from: GameState, difficulty: Difficulty) => {
    clearAiTimer();
    thinkingRef.current = true;
    setThinking(true);
    aiTimer.current = window.setTimeout(() => {
      const move = chooseMove(from, difficulty);
      const next = play(from, move);
      thinkingRef.current = false;
      setThinking(false);
      aiTimer.current = null;
      if (next) setState(next);
    }, 80);
  }, [clearAiTimer]);

  useEffect(() => {
    if (!needsAi || thinkingRef.current) return;
    runAi(state, settings.difficulty);
    return () => {
      clearAiTimer();
    };
  }, [needsAi, state, settings.difficulty, runAi, clearAiTimer]);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirm(null);
    };
    document.addEventListener("keydown", onKey);
    confirmCancelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm]);

  const startGame = useCallback(() => {
    clearAiTimer();
    setState(emptyState());
    setHover(null);
    setConfirm(null);
    setScreen("playing");
  }, [clearAiTimer]);

  const doRestart = useCallback(() => {
    clearAiTimer();
    setState(emptyState());
    setHover(null);
    setConfirm(null);
  }, [clearAiTimer]);

  const doBackToSetup = useCallback(() => {
    clearAiTimer();
    setState(emptyState());
    setHover(null);
    setConfirm(null);
    setScreen("setup");
  }, [clearAiTimer]);

  const onUndo = useCallback(() => {
    if (thinking || state.moves.length === 0) return;
    clearAiTimer();
    const steps = settings.opponent === "ai" ? Math.min(2, state.moves.length) : 1;
    setState((current) => undo(current, steps));
    setHover(null);
  }, [thinking, state.moves.length, settings.opponent, clearAiTimer]);

  const onPointClick = useCallback(
    (index: number) => {
      if (thinking || confirm || isOver(state)) return;
      if (settings.opponent === "ai" && state.turn !== settings.humanColor) return;
      const next = play(state, index);
      if (!next) return;
      setState(next);
      setHover(null);
    },
    [thinking, confirm, state, settings],
  );

  const lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
  const winSet = useMemo(() => new Set(state.winLine ?? []), [state.winLine]);
  const canHover =
    !thinking && !confirm && !isOver(state) &&
    (settings.opponent !== "ai" || state.turn === settings.humanColor);

  const lineNodes = useMemo(() => {
    const n = SIZE;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1)) * 100;
      lines.push(`M 0 ${p} H 100`);
      lines.push(`M ${p} 0 V 100`);
    }
    return lines;
  }, []);

  if (screen === "setup") {
    return (
      <div className="gomoku gomoku-setup">
        <div className="panel">
          <h2>{g.setupTitle}</h2>
          <p className="hint">{g.setupHint}</p>
          <div className="gomoku-controls">
            <label>
              {g.mode}
              <select
                value={settings.opponent}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    opponent: e.target.value === "local" ? "local" : "ai",
                  }))
                }
              >
                <option value="ai">{g.vsAi}</option>
                <option value="local">{g.hotseat}</option>
              </select>
            </label>
            {settings.opponent === "ai" ? (
              <>
                <label>
                  {g.difficulty}
                  <select
                    value={settings.difficulty}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        difficulty: e.target.value as Difficulty,
                      }))
                    }
                  >
                    <option value="easy">{g.easy}</option>
                    <option value="normal">{g.normal}</option>
                    <option value="hard">{g.hard}</option>
                  </select>
                </label>
                <label>
                  {g.yourColor}
                  <select
                    value={settings.humanColor}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        humanColor: e.target.value === "2" ? 2 : 1,
                      }))
                    }
                  >
                    <option value="1">{g.playBlack}</option>
                    <option value="2">{g.playWhite}</option>
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={startGame}>
              {g.start}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gomoku gomoku-playing">
      <div className="gomoku-hud">
        <p className="gomoku-status">{statusText(state, settings, thinking, g)}</p>
      </div>

      <div className="gomoku-board-wrap">
        <div
          className="gomoku-board"
          style={{ ["--gomoku-n" as string]: SIZE }}
          role="grid"
          aria-label={g.boardAria}
          onMouseLeave={() => setHover(null)}
        >
          <div className="gomoku-inner">
          <svg className="gomoku-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {lineNodes.map((d) => (
              <path key={d} d={d} fill="none" stroke="rgba(40, 24, 8, 0.55)" strokeWidth="0.28" />
            ))}
            {[...STARS].map((key) => {
              const [r, c] = key.split("-").map(Number);
              const x = (c / (SIZE - 1)) * 100;
              const y = (r / (SIZE - 1)) * 100;
              return <circle key={key} cx={x} cy={y} r="0.85" fill="rgba(40, 24, 8, 0.7)" />;
            })}
          </svg>
          <div className="gomoku-points">
            {state.board.map((stone, index) => {
              const r = rowOf(index);
              const c = colOf(index);
              const colLabel = COLS[c] ?? String(c + 1);
              const showGhost = canHover && hover === index && stone === 0;
              const ghostColor = state.turn;
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className="gomoku-point"
                  disabled={!canHover || stone !== 0}
                  aria-label={
                    stone === 0
                      ? g.emptyAria(r + 1, colLabel)
                      : g.stoneAria(stone === 1 ? g.black : g.white, r + 1, colLabel)
                  }
                  onClick={() => onPointClick(index)}
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                >
                  {stone !== 0 ? (
                    <span
                      className={[
                        "gomoku-stone",
                        stone === 1 ? "is-black" : "is-white",
                        lastMove === index ? "is-last" : "",
                        winSet.has(index) ? "is-win" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  ) : showGhost ? (
                    <span
                      className={`gomoku-ghost gomoku-stone ${ghostColor === 1 ? "is-black" : "is-white"}`}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          </div>
        </div>
      </div>

      <div className="gomoku-actions">
        <button
          type="button"
          className="ghost"
          onClick={onUndo}
          disabled={thinking || Boolean(confirm) || state.moves.length === 0}
        >
          {g.undo}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setConfirm("restart")}
          disabled={thinking || Boolean(confirm)}
        >
          {g.restart}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setConfirm("setup")}
          disabled={thinking || Boolean(confirm)}
        >
          {g.backSetup}
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
                {confirm === "restart" ? g.confirmRestartTitle : g.confirmSetupTitle}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setConfirm(null)}
                aria-label={g.confirmCancel}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
                </svg>
              </button>
            </div>
            <p className="lede modal-body">
              {confirm === "restart" ? g.confirmRestartBody : g.confirmSetupBody}
            </p>
            <div className="modal-actions">
              <button
                ref={confirmCancelRef}
                type="button"
                className="ghost"
                onClick={() => setConfirm(null)}
              >
                {g.confirmCancel}
              </button>
              <button
                type="button"
                className="primary"
                onClick={confirm === "restart" ? doRestart : doBackToSetup}
              >
                {g.confirmOk}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
