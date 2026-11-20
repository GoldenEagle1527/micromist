import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import "./gomoku.css";
import { useLocale } from "../../i18n";
import { useLocalGamePersist } from "../local-persist";
import { chooseMove, type Difficulty } from "./ai";
import {
  emptyState,
  isOver,
  isValidState,
  play,
  undo,
  type GameState,
  type Player,
} from "./engine";
import { GomokuBoard } from "./GomokuBoard";
import { GomokuRoom } from "./GomokuRoom";
import { generateRoomCode } from "./online";

type Opponent = "ai" | "local" | "online";
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
  const [searchParams] = useSearchParams();
  const roomCode = (searchParams.get("room") ?? "").trim().toLowerCase();
  if (/^[a-z0-9]+$/.test(roomCode)) {
    return <GomokuRoom roomCode={roomCode} />;
  }
  return <GomokuLocalGame />;
}

function GomokuLocalGame() {
  const { t } = useLocale();
  const g = t.gomoku;
  const [, setSearchParams] = useSearchParams();
  const [screen, setScreen] = useState<Screen>("setup");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<GameState>(() => emptyState());
  const [thinking, setThinking] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const confirmTitleId = useId();
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const thinkingRef = useRef(false);
  const aiTimer = useRef<number | null>(null);

  const persistState: Persist | null =
    screen === "playing" && settings.opponent !== "online"
      ? { screen: "playing", settings, state }
      : null;

  useLocalGamePersist<Persist>("gomoku", persistState, {
    shouldSave: (s) =>
      s.screen === "playing" &&
      s.settings.opponent !== "online" &&
      s.state.moves.length > 0 &&
      s.state.winner === 0,
    onHydrate: (data) => {
      if (data.screen !== "playing" || !isValidState(data.state)) return;
      if (data.settings?.opponent === "online") return;
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
    setConfirm(null);
    setScreen("playing");
  }, [clearAiTimer]);

  const doRestart = useCallback(() => {
    clearAiTimer();
    setState(emptyState());
    setConfirm(null);
  }, [clearAiTimer]);

  const doBackToSetup = useCallback(() => {
    clearAiTimer();
    setState(emptyState());
    setConfirm(null);
    setScreen("setup");
  }, [clearAiTimer]);

  const onUndo = useCallback(() => {
    if (thinking || state.moves.length === 0) return;
    clearAiTimer();
    const steps = settings.opponent === "ai" ? Math.min(2, state.moves.length) : 1;
    setState((current) => undo(current, steps));
  }, [thinking, state.moves.length, settings.opponent, clearAiTimer]);

  const onPointClick = useCallback(
    (index: number) => {
      if (thinking || confirm || isOver(state)) return;
      if (settings.opponent === "ai" && state.turn !== settings.humanColor) return;
      const next = play(state, index);
      if (!next) return;
      setState(next);
    },
    [thinking, confirm, state, settings],
  );

  const canPlay =
    !thinking && !confirm && !isOver(state) &&
    (settings.opponent !== "ai" || state.turn === settings.humanColor);

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
                onChange={(e) => {
                  const value = e.target.value;
                  setSettings((s) => ({
                    ...s,
                    opponent: value === "local" ? "local" : value === "online" ? "online" : "ai",
                  }));
                }}
              >
                <option value="ai">{g.vsAi}</option>
                <option value="local">{g.hotseat}</option>
                <option value="online">{g.online}</option>
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
            {settings.opponent === "online" ? (
              <button
                type="button"
                className="primary"
                onClick={() => setSearchParams({ room: generateRoomCode() })}
              >
                {g.createRoom}
              </button>
            ) : (
              <button type="button" className="primary" onClick={startGame}>
                {g.start}
              </button>
            )}
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

      <GomokuBoard
        state={state}
        canPlay={canPlay}
        ghostColor={state.turn}
        boardAria={g.boardAria}
        emptyAria={g.emptyAria}
        stoneAria={g.stoneAria}
        black={g.black}
        white={g.white}
        onPointClick={onPointClick}
      />

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
