import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ChromaPublicState } from "../../../shared/chroma-slide/observe";
import { useLocale } from "../../i18n";
import {
  OnlineRoomClient,
  getOrCreatePlayerIdForGame,
  type Phase,
  type RoomPlayer,
  type Seat,
} from "../../multiplayer/OnlineRoomClient";
import { EMPTY, TILE_COLORS, isLegalClick, type PuzzleState } from "./engine";

type You = {
  playerId: string;
  seat: Seat;
  name?: string;
};

function isPublicState(value: unknown): value is ChromaPublicState {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ChromaPublicState>;
  return Array.isArray(row.board) && !!row.config && typeof row.config === "object";
}

function readPublic(payload: Record<string, unknown>): ChromaPublicState | null {
  if (isPublicState(payload.publicState)) return payload.publicState;
  const observation = payload.observation;
  if (observation && typeof observation === "object") {
    const nested = (observation as { publicState?: unknown }).publicState;
    if (isPublicState(nested)) return nested;
  }
  return null;
}

function puzzleFromPublic(pub: ChromaPublicState): PuzzleState | null {
  if (pub.board.length === 0) return null;
  const size = pub.config.size;
  const board: number[] = [];
  let emptyIndex = 0;
  for (const row of pub.board) {
    for (const cell of row) {
      if (cell.empty || cell.color == null) {
        emptyIndex = board.length;
        board.push(EMPTY);
      } else {
        board.push(cell.color);
      }
    }
  }
  if (board.length !== size * size) return null;
  return {
    preset: pub.config.preset,
    size,
    colorCount: pub.config.colorCount,
    board,
    emptyIndex,
    steps: pub.steps,
  };
}

export function ChromaSlideRoom({ roomCode }: { roomCode: string }) {
  const { t } = useLocale();
  const ch = t.chroma;
  const [you, setYou] = useState<You | null>(null);
  const [phase, setPhase] = useState<Phase>("lobby");
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [pub, setPub] = useState<ChromaPublicState | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [client, setClient] = useState<OnlineRoomClient | null>(null);

  useEffect(() => {
    const room = new OnlineRoomClient("chroma-slide");
    const playerId = getOrCreatePlayerIdForGame("chroma-slide");
    setClient(room);
    room.connect(roomCode, {
      onOpen: () => {
        room.join({ playerId, name: "Player" });
      },
      onWelcome: (payload) => {
        setYou({ playerId: payload.playerId, seat: payload.seat });
      },
      onRoom: (payload) => {
        setPhase(payload.phase);
        setPlayers(payload.players);
      },
      onError: (payload) => {
        setError(payload.message);
      },
      onRoomClosed: () => {
        setClosed(true);
      },
      onMessage: (type, payload) => {
        if (type === "seated") {
          const seated = payload.you;
          if (seated && typeof seated === "object") {
            const body = seated as { playerId?: unknown; seat?: unknown };
            if (typeof body.playerId === "string" && typeof body.seat === "string") {
              setYou({ playerId: body.playerId, seat: body.seat as Seat });
            }
          }
        }
        const next = readPublic(payload);
        if (next && (type === "state" || type === "move_applied" || type === "your_turn" || type === "observation")) {
          setPub(next);
          setError("");
        }
      },
    });
    return () => {
      room.close();
    };
  }, [roomCode]);

  const puzzle = useMemo(() => (pub ? puzzleFromPublic(pub) : null), [pub]);
  const solver = players.find((p) => p.seat === "player");
  const solving = you?.seat === "player" && phase === "playing" && pub?.won !== true;
  const won = pub?.won === true || phase === "over";

  const onCellClick = (index: number) => {
    if (!client || !puzzle || !solving) return;
    if (!isLegalClick(puzzle, index)) return;
    const row = Math.floor(index / puzzle.size);
    const col = index % puzzle.size;
    client.send("move", { row, col });
  };

  const status = closed
    ? ch.roomClosed
    : !you
      ? ch.roomConnecting
      : won && pub
        ? ch.roomSolved(pub.steps)
        : you.seat === "player"
          ? ch.roomYouSolve
          : solver
            ? ch.roomWatching(solver.name)
            : ch.roomWaiting;

  return (
    <div className="chroma-slide chroma-playing chroma-room">
      <div className="chroma-hud">
        <p className="chroma-steps">
          {ch.roomCode(roomCode)}
          {pub ? (
            <>
              {" "}
              · {pub.config.preset} · {ch.stepsHud} <strong>{pub.steps}</strong>
            </>
          ) : null}
        </p>
        <p className="hint" style={{ margin: 0 }}>
          {status}
        </p>
        {you?.seat === "spectator" && phase === "playing" ? (
          <p className="hint" style={{ margin: 0 }}>
            {ch.roomSpectatorHint}
          </p>
        ) : null}
        {error ? (
          <p className="hint" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
      </div>

      {puzzle ? (
        <div
          className={`chroma-board glass${won ? " chroma-board-won" : ""}`}
          style={{ ["--chroma-size" as string]: puzzle.size }}
          role="grid"
          aria-label={ch.boardAria}
        >
          {puzzle.board.map((cell, index) => {
            const isEmpty = cell === EMPTY || index === puzzle.emptyIndex;
            const legal = solving && isLegalClick(puzzle, index);
            return (
              <button
                key={index}
                type="button"
                role="gridcell"
                className={["chroma-cell", isEmpty ? "chroma-empty" : "", won && !isEmpty ? "chroma-cell-won" : ""]
                  .filter(Boolean)
                  .join(" ")}
                style={isEmpty ? undefined : { backgroundColor: TILE_COLORS[cell] ?? "#888" }}
                disabled={!legal}
                aria-label={
                  isEmpty
                    ? ch.emptyAria
                    : ch.tileAria(cell + 1, Math.floor(index / puzzle.size) + 1, (index % puzzle.size) + 1)
                }
                onClick={() => onCellClick(index)}
              />
            );
          })}
        </div>
      ) : null}

      <div className="chroma-actions">
        {you?.seat === "spectator" && phase === "lobby" && !solver ? (
          <button
            type="button"
            className="primary"
            onClick={() => client?.send("claim_seat", { seat: "player" })}
          >
            {ch.roomClaim}
          </button>
        ) : null}
        <Link className="ghost chroma-room-back" to="/play/chroma-slide">
          {ch.roomBack}
        </Link>
      </div>
    </div>
  );
}
