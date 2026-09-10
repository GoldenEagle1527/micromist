import type { MutableRefObject, RefObject } from "react";
import type { GameInstance, MoveResult, PlayerColor } from "./engine";
import type { Phase } from "./online";
import type { BoardRenderer } from "./boardRenderer";
import { clearLocalProgress } from "../local-persist";
import { colorLabel, formatWinReason, winnerLabel } from "./labels";
import { SOLO_PROGRESS_SLUG, type Settings, type SoloPersist } from "./settings";
import type { ExplosiveOnlineClient } from "./online";

export type ExplosiveChessPlayProps = {
  ex: Record<string, string>;
  tExplosive: Record<string, string>;
  settings: Settings;
  turn: PlayerColor;
  stepCount: number;
  counts: { red: number; blue: number };
  myColor: PlayerColor | null;
  gameOver: boolean;
  winner: MoveResult["winner"];
  winReason: string;
  tip: string;
  onlineStatus: string;
  onlinePhase: Phase | "idle" | "connecting" | "reconnecting";
  screen: "setup" | "playing";
  roomFromQuery: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<BoardRenderer | null>;
  gameRef: MutableRefObject<GameInstance | null>;
  settingsRef: MutableRefObject<Settings>;
  myColorRef: MutableRefObject<PlayerColor | null>;
  pendingRestoreRef: MutableRefObject<SoloPersist | null>;
  reconnectAttemptsRef: MutableRefObject<number>;
  roomCodeRef: MutableRefObject<string>;
  clientRef: MutableRefObject<ExplosiveOnlineClient | null>;
  backToSetup: () => void;
  setLocalSession: (fn: (n: number) => number) => void;
  connectToRoom: (code: string, opts?: { keepPlaying?: boolean }) => void;
  setScreen: (s: "setup" | "playing") => void;
  destroyBoard: () => void;
  handlePointer: (x: number, y: number) => void;
};

export function ExplosiveChessPlay(p: ExplosiveChessPlayProps) {
  const {
    ex,
    tExplosive,
    settings,
    turn,
    stepCount,
    counts,
    myColor,
    gameOver,
    winner,
    winReason,
    tip,
    onlineStatus,
    onlinePhase,
    screen,
    roomFromQuery,
    canvasRef,
    rendererRef,
    gameRef,
    settingsRef,
    myColorRef,
    pendingRestoreRef,
    reconnectAttemptsRef,
    roomCodeRef,
    clientRef,
    backToSetup,
    setLocalSession,
    connectToRoom,
    setScreen,
    destroyBoard,
    handlePointer,
  } = p;
  const t = { explosive: tExplosive };
  return (
    <div className="explosive-chess explosive-playing">
      <div className="panel explosive-status">
        <div className="row" style={{ marginTop: 0 }}>
          <button type="button" className="ghost" onClick={backToSetup}>
            {ex.backSetup}
          </button>
          <span>
            {ex.turn}：<strong>{colorLabel(turn, ex)}</strong>
          </span>
          <span>
            {ex.stepsHud}：{stepCount}
          </span>
          <span className="explosive-count red">
            {ex.colorRed} {counts.red}
          </span>
          <span className="explosive-count blue">
            {ex.colorBlue} {counts.blue}
          </span>
          {settings.opponent === "online" && myColor != null ? (
            <span>
              {ex.you}：{colorLabel(myColor, ex)}
            </span>
          ) : null}
        </div>
        <p className="hint" style={{ marginTop: "0.5rem" }}>
          {gameOver ? `${winnerLabel(winner, ex)}${winReason ? ` · ${formatWinReason(winReason, t.explosive)}` : ""}` : tip}
          {settings.opponent === "online" && onlineStatus ? ` · ${onlineStatus}` : ""}
        </p>
        <div className="row">
          {settings.opponent !== "online" ? (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                clearLocalProgress(SOLO_PROGRESS_SLUG);
                pendingRestoreRef.current = null;
                setLocalSession((n) => n + 1);
              }}
            >
              {ex.restart}
            </button>
          ) : null}
          {settings.opponent === "online" &&
          (onlinePhase === "reconnecting" || onlinePhase === "idle") ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                reconnectAttemptsRef.current = 0;
                const code = roomCodeRef.current || roomFromQuery;
                if (code) connectToRoom(code, { keepPlaying: screen === "playing" });
              }}
            >
              {ex.reconnect}
            </button>
          ) : null}
          {settings.opponent === "online" && onlinePhase === "playing" ? (
            <button type="button" className="ghost" onClick={() => clientRef.current?.surrender()}>
              {ex.surrender}
            </button>
          ) : null}
          {settings.opponent === "online" && onlinePhase === "over" ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                clientRef.current?.rematch();
                setScreen("setup");
                destroyBoard();
              }}
            >
              {ex.rematch}
            </button>
          ) : null}
        </div>
      </div>

      <div className="explosive-board glass">
        <canvas
          ref={canvasRef}
          onClick={(e) => handlePointer(e.clientX, e.clientY)}
          onMouseMove={(e) => {
            const renderer = rendererRef.current;
            const game = gameRef.current;
            if (!renderer || !game || game.gameOver) {
              renderer?.clearHover();
              return;
            }
            if (
              settingsRef.current.opponent === "online" &&
              myColorRef.current != null &&
              game.currentTurn !== myColorRef.current
            ) {
              renderer.clearHover();
              return;
            }
            const cell = renderer.pixelToCell(e.clientX, e.clientY);
            if (cell) renderer.setHoverCell(cell.row, cell.col);
            else renderer.clearHover();
          }}
          onMouseLeave={() => rendererRef.current?.clearHover()}
          onTouchStart={(e) => {
            e.preventDefault();
            const touch = e.touches[0];
            if (touch) handlePointer(touch.clientX, touch.clientY);
          }}
        />
      </div>
    </div>
  );
}
