import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { SetURLSearchParams } from "react-router";
import {
  WIN_MODE_ANNIHILATION,
  WIN_MODE_AREA,
  WIN_MODE_STEPS,
  type WinMode,
} from "./engine";
import type { AiDifficulty } from "./ai";
import type { HostColor, Phase, Role, RoomConfig, RoomPlayer, Seat } from "./online";
import { clearLocalProgress } from "../local-persist";
import { seatLabel, winModeLabel, youAreLabel } from "./labels";
import {
  SOLO_PROGRESS_SLUG,
  type RedOwner,
  type Settings,
  type SoloPersist,
} from "./settings";

export type ExplosiveChessSetupProps = {
  ex: Record<string, string>;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  pendingRestoreRef: MutableRefObject<SoloPersist | null>;
  disconnectOnline: () => void;
  setSearchParams: SetURLSearchParams;
  onlinePhase: Phase | "idle" | "connecting" | "reconnecting";
  onlineConfig: RoomConfig | null;
  onlineConfigLocked: boolean;
  roomFromQuery: string;
  showWinParam: boolean;
  startLocalGame: () => void;
  onlineStatus: string;
  onlineSeat: Seat;
  connectedLobby: boolean;
  createRoom: () => void;
  joinRoom: () => void;
  shareLink: string;
  roomCode: string;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setShareLink: Dispatch<SetStateAction<string>>;
  setOnlineStatus: Dispatch<SetStateAction<string>>;
  onlinePlayers: RoomPlayer[];
  onlineRole: Role;
  reconnectAttemptsRef: MutableRefObject<number>;
};

export function ExplosiveChessSetup({
  ex,
  settings,
  setSettings,
  pendingRestoreRef,
  disconnectOnline,
  setSearchParams,
  onlinePhase,
  onlineConfig,
  onlineConfigLocked,
  roomFromQuery,
  showWinParam,
  startLocalGame,
  onlineStatus,
  onlineSeat,
  connectedLobby,
  createRoom,
  joinRoom,
  shareLink,
  roomCode,
  setRoomCode,
  setShareLink,
  setOnlineStatus,
  onlinePlayers,
  onlineRole,
  reconnectAttemptsRef,
}: ExplosiveChessSetupProps) {
  return (
      <div className="explosive-chess explosive-setup">
        <div className="panel">
          <h2>{ex.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {ex.setupHint}
          </p>
          <div className="explosive-controls">
            <label>
              {ex.mode}
              <select
                value={settings.opponent === "online" ? "online" : "solo"}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === "online") {
                    clearLocalProgress(SOLO_PROGRESS_SLUG);
                    pendingRestoreRef.current = null;
                    setSettings((s) => ({ ...s, opponent: "online" }));
                    return;
                  }
                  disconnectOnline();
                  setSearchParams({}, { replace: true });
                  setSettings((s) => ({
                    ...s,
                    opponent: s.opponent === "local" ? "local" : "ai",
                  }));
                }}
              >
                <option value="solo">{ex.solo}</option>
                <option value="online">{ex.online}</option>
              </select>
            </label>
            {settings.opponent !== "online" ? (
              <label>
                {ex.soloMatch}
                <select
                  value={settings.opponent}
                  onChange={(e) => {
                    const opponent = e.target.value as "ai" | "local";
                    setSettings((s) => ({ ...s, opponent }));
                  }}
                >
                  <option value="ai">{ex.vsAi}</option>
                  <option value="local">{ex.hotseat}</option>
                </select>
              </label>
            ) : null}

            {/* Solo: always editable. Online: editable only before create; after create read-only. */}
            {settings.opponent !== "online" || onlinePhase === "idle" || onlineConfig ? (
              <>
                <label>
                  {ex.board}
                  <select
                    value={
                      settings.opponent === "online" && onlineConfig
                        ? onlineConfig.boardSize
                        : settings.boardSize
                    }
                    disabled={onlineConfigLocked}
                    onChange={(e) => {
                      const boardSize = Number(e.target.value) as 9 | 11 | 13;
                      setSettings((s) => ({ ...s, boardSize }));
                    }}
                  >
                    <option value={9}>9×9</option>
                    <option value={11}>11×11</option>
                    <option value={13}>13×13</option>
                  </select>
                </label>
                <label>
                  {ex.winMode}
                  <select
                    value={
                      settings.opponent === "online" && onlineConfig
                        ? onlineConfig.winMode
                        : settings.winMode
                    }
                    disabled={onlineConfigLocked}
                    onChange={(e) => {
                      const winMode = e.target.value as WinMode;
                      setSettings((s) => ({ ...s, winMode }));
                    }}
                  >
                    <option value={WIN_MODE_ANNIHILATION}>{ex.annihilation}</option>
                    <option value={WIN_MODE_STEPS}>{ex.steps}</option>
                    <option value={WIN_MODE_AREA}>{ex.area}</option>
                  </select>
                </label>
                {showWinParam ||
                (onlineConfig && onlineConfig.winMode !== WIN_MODE_ANNIHILATION) ? (
                  <label>
                    {(onlineConfig?.winMode ?? settings.winMode) === WIN_MODE_STEPS
                      ? ex.stepCount
                      : ex.targetCells}
                    <input
                      type="number"
                      min={1}
                      value={onlineConfig?.winParam ?? settings.winParam}
                      disabled={onlineConfigLocked}
                      onChange={(e) => {
                        const winParam = Math.max(1, Number(e.target.value) || 1);
                        setSettings((s) => ({ ...s, winParam }));
                      }}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {settings.opponent === "ai" ? (
              <>
                <label>
                  {ex.aiDifficulty}
                  <select
                    value={settings.difficulty}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        difficulty: e.target.value as AiDifficulty,
                      }))
                    }
                  >
                    <option value="easy">{ex.easy}</option>
                    <option value="medium">{ex.medium}</option>
                    <option value="hard">{ex.hard}</option>
                    <option value="hell">{ex.hell}</option>
                  </select>
                </label>
                <label>
                  {ex.redFirst}
                  <select
                    value={settings.redOwner}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        redOwner: e.target.value as RedOwner,
                      }))
                    }
                  >
                    <option value="player">{ex.me}</option>
                    <option value="ai">{ex.ai}</option>
                  </select>
                </label>
              </>
            ) : null}

            {settings.opponent === "online" && (onlinePhase === "idle" || onlineConfig) && !roomFromQuery ? (
              <label>
                {ex.myColor}
                <select
                  value={onlineConfig?.hostColor ?? settings.hostColor}
                  disabled={onlineConfigLocked}
                  onChange={(e) => {
                    const hostColor = e.target.value as HostColor;
                    setSettings((s) => ({ ...s, hostColor }));
                  }}
                >
                  <option value="red">{ex.redFirstSeat}</option>
                  <option value="blue">{ex.blueSecond}</option>
                </select>
              </label>
            ) : null}
            {settings.opponent === "online" && onlineConfigLocked ? (
              <p className="hint" style={{ margin: 0 }}>
                {ex.onlineConfigLocked}
              </p>
            ) : null}
          </div>

          {settings.opponent !== "online" ? (
            <div className="row">
              <button type="button" className="primary" onClick={startLocalGame}>
                {ex.start}
              </button>
            </div>
          ) : null}
        </div>

        {settings.opponent === "online" ? (
          <div className="panel explosive-online-lobby">
            <h2>{ex.onlineLobby}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              {onlineStatus || ex.onlineHint}
              {onlinePhase === "lobby" && onlineSeat ? ` ${youAreLabel(onlineSeat, ex)}` : ""}
            </p>
            <div className="row">
              {onlinePhase === "idle" || onlinePhase === "connecting" || onlinePhase === "reconnecting" ? (
                <>
                  {!roomFromQuery && onlinePhase !== "reconnecting" ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={createRoom}
                      disabled={onlinePhase === "connecting"}
                    >
                      {ex.createRoom}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        reconnectAttemptsRef.current = 0;
                        joinRoom();
                      }}
                      disabled={onlinePhase === "connecting" || onlinePhase === "reconnecting"}
                    >
                      {onlinePhase === "reconnecting" ? ex.reconnecting : ex.joinRoom}
                    </button>
                  )}
                </>
              ) : null}
              {connectedLobby ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    disconnectOnline();
                    setSearchParams({}, { replace: true });
                    setRoomCode("");
                    setShareLink("");
                    setOnlineStatus(ex.leftRoom);
                  }}
                >
                  {ex.leaveRoom}
                </button>
              ) : null}
            </div>

            {onlineRole === "host" && roomCode && (onlinePhase === "lobby" || onlinePhase === "connecting") ? (
              <div className="explosive-room-code">
                <p className="room-code-line">
                  {ex.roomCode}
                  <span className="room-code-value">{roomCode}</span>
                </p>
                {shareLink ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(shareLink);
                      setOnlineStatus(ex.linkCopied);
                    }}
                  >
                    {ex.copyLink}
                  </button>
                ) : null}
              </div>
            ) : null}

            {onlineConfig && onlineRole !== "host" && connectedLobby ? (
              <p className="hint">
                {ex.configLabel}
                {onlineConfig.boardSize}×{onlineConfig.boardSize} · {winModeLabel(onlineConfig.winMode, ex)}
                {onlineConfig.winMode !== WIN_MODE_ANNIHILATION
                  ? ` (${onlineConfig.winParam})`
                  : ""}{" "}
                · {ex.hostLabel}{" "}
                {onlineConfig.hostColor === "red" ? ex.colorRed : ex.colorBlue}
              </p>
            ) : null}

            {onlinePlayers.length > 0 ? (
              <ul className="explosive-player-list">
                {onlinePlayers.map((p) => (
                  <li key={p.playerId}>
                    {p.name} · {seatLabel(p.seat, ex)} · {p.role}
                    {p.rematch ? ` · ${ex.rematchMark}` : ""}
                    {!p.connected ? ` · ${ex.offline}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}

          </div>
        ) : null}
      </div>
  );
}
