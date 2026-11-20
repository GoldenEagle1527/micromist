import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { isOver, isValidState, type GameState, type Player } from "./engine";
import { GomokuBoard } from "./GomokuBoard";
import { useLocale } from "../../i18n";
import {
  GomokuOnlineClient,
  getOrCreatePlayerId,
  shareUrl,
  type Phase,
  type RoomPlayer,
  type Seat,
} from "./online";

type You = {
  playerId: string;
  seat: Seat;
};

function seatToPlayer(seat: Seat): Player | null {
  if (seat === "red") return 1;
  if (seat === "blue") return 2;
  return null;
}

function occupant(players: RoomPlayer[], seat: "red" | "blue"): RoomPlayer | undefined {
  return players.find((p) => p.seat === seat);
}

export function GomokuRoom({ roomCode }: { roomCode: string }) {
  const { t } = useLocale();
  const g = t.gomoku;
  const [you, setYou] = useState<You | null>(null);
  const [phase, setPhase] = useState<Phase | "connecting">("connecting");
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [peerHint, setPeerHint] = useState("");
  const clientRef = useRef<GomokuOnlineClient | null>(null);

  useEffect(() => {
    const client = new GomokuOnlineClient();
    const playerId = getOrCreatePlayerId();
    clientRef.current = client;
    client.connect(roomCode, {
      onOpen: () => {
        client.join({ playerId, name: "Player" });
      },
      onWelcome: (payload) => {
        setYou({ playerId: payload.playerId, seat: payload.seat });
        setPhase((current) => (current === "connecting" ? "lobby" : current));
      },
      onRoom: (payload) => {
        setPhase(payload.phase);
        setPlayers(payload.players);
        const self = payload.players.find((p) => p.playerId === playerId);
        if (self) setYou({ playerId: self.playerId, seat: self.seat });
      },
      onStart: () => {
        setPhase("playing");
        setError("");
        setPeerHint("");
      },
      onState: (payload) => {
        if (isValidState(payload.publicState)) {
          setState(payload.publicState);
          setError("");
        }
      },
      onGameOver: () => {
        setPhase("over");
      },
      onSeated: (payload) => {
        if (payload.playerId === playerId) {
          setYou({ playerId: payload.playerId, seat: payload.seat });
        }
      },
      onError: (payload) => {
        setError(payload.message);
      },
      onPeerLeft: () => {
        setPeerHint(g.opponentLeft);
      },
      onRoomClosed: () => {
        setClosed(true);
      },
      onClose: () => {
        setPhase((current) => (current === "connecting" ? "connecting" : current));
      },
    });
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [roomCode, g.opponentLeft]);

  const myColor = you ? seatToPlayer(you.seat) : null;
  const black = occupant(players, "red");
  const white = occupant(players, "blue");
  const canPlay = Boolean(
    myColor &&
      state &&
      phase === "playing" &&
      !isOver(state) &&
      state.turn === myColor,
  );
  const link = useMemo(() => shareUrl(roomCode), [roomCode]);
  const myRecord = you ? players.find((p) => p.playerId === you.playerId) : undefined;
  const askedRematch = Boolean(myRecord?.rematch);

  const status = (() => {
    if (closed) return g.roomClosed;
    if (!you || phase === "connecting") return g.roomConnecting;
    if (phase === "lobby") {
      if (you.seat === "red") return black && !white ? g.waitingWhite : g.waitingSeats;
      if (you.seat === "blue") return white && !black ? g.waitingBlack : g.waitingSeats;
      return g.waitingSeats;
    }
    if (state && (phase === "over" || isOver(state))) {
      if (state.winner === 3) return g.draw;
      if (myColor && (state.winner === 1 || state.winner === 2)) {
        return state.winner === myColor ? g.youWin : g.youLose;
      }
      return state.winner === 1 ? g.blackWins : g.whiteWins;
    }
    if (state && phase === "playing") {
      if (myColor) return state.turn === myColor ? g.yourTurn : g.opponentTurn;
      return state.turn === 1 ? g.turnBlack : g.turnWhite;
    }
    return g.waitingSeats;
  })();

  const claim = (seat: "red" | "blue") => {
    clientRef.current?.claimSeat(seat);
  };

  const copy = () => {
    void navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setError(g.copyFailed),
    );
  };

  const seatLabel = (seat: "red" | "blue") => (seat === "red" ? g.black : g.white);
  const seatLine = (seat: "red" | "blue") => {
    const player = occupant(players, seat);
    const taken = Boolean(player);
    const mine = you?.seat === seat;
    const name = player?.name || (mine ? g.you : "");
    const online = player ? (player.connected ? g.onlineNow : g.offlineNow) : g.seatEmpty;
    return `${seatLabel(seat)} · ${taken ? `${name || g.seatTaken} (${online})` : g.seatEmpty}`;
  };

  return (
    <div className="gomoku gomoku-playing gomoku-room">
      <div className="gomoku-hud">
        <p className="gomoku-status">{g.roomCodeLabel(roomCode)}</p>
        <p className="hint" style={{ margin: 0 }}>
          {status}
          {you?.seat === "red" ? ` ${g.youAreBlack}` : you?.seat === "blue" ? ` ${g.youAreWhite}` : you ? ` ${g.watching}` : ""}
        </p>
        {peerHint ? <p className="hint" style={{ margin: 0 }}>{peerHint}</p> : null}
        {error ? <p className="hint" style={{ margin: 0 }}>{error}</p> : null}
        <p className="hint gomoku-seat-line" style={{ margin: 0 }}>
          {seatLine("red")}
        </p>
        <p className="hint gomoku-seat-line" style={{ margin: 0 }}>
          {seatLine("blue")}
        </p>
      </div>

      {phase === "lobby" || (!state && !closed) ? (
        <div className="row gomoku-room-actions">
          <button
            type="button"
            className="primary"
            onClick={() => claim("red")}
            disabled={Boolean(black) && you?.seat !== "red"}
          >
            {g.claimBlack}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => claim("blue")}
            disabled={Boolean(white) && you?.seat !== "blue"}
          >
            {g.claimWhite}
          </button>
          <button type="button" className="ghost" onClick={copy}>
            {copied ? g.linkCopied : g.copyLink}
          </button>
        </div>
      ) : (
        <div className="row gomoku-room-actions">
          <button type="button" className="ghost" onClick={copy}>
            {copied ? g.linkCopied : g.copyLink}
          </button>
        </div>
      )}

      {state ? (
        <GomokuBoard
          state={state}
          canPlay={canPlay}
          ghostColor={myColor ?? state.turn}
          boardAria={g.boardAria}
          emptyAria={g.emptyAria}
          stoneAria={g.stoneAria}
          black={g.black}
          white={g.white}
          onPointClick={(index) => {
            if (!canPlay) return;
            clientRef.current?.move(index);
          }}
        />
      ) : null}

      <div className="gomoku-actions">
        {phase === "playing" && myColor && state && !isOver(state) ? (
          <button type="button" className="ghost" onClick={() => clientRef.current?.surrender()}>
            {g.resign}
          </button>
        ) : null}
        {phase === "over" && myColor ? (
          <button type="button" className="primary" onClick={() => clientRef.current?.rematch()} disabled={askedRematch}>
            {askedRematch ? g.rematchWaiting : g.rematch}
          </button>
        ) : null}
        <Link className="ghost btn-link" to="/play/gomoku">
          {g.leaveRoom}
        </Link>
      </div>
    </div>
  );
}
