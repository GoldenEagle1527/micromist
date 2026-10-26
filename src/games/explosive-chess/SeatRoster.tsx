import type { Phase, RoomPlayer } from "./online";

export function SeatRoster(props: {
  ex: Record<string, string>;
  players: RoomPlayer[];
  myPlayerId: string;
  phase: Phase | "idle" | "connecting" | "reconnecting";
  onClaim?: (seat: "red" | "blue") => void;
}) {
  const { ex, players, myPlayerId, phase, onClaim } = props;
  const red = players.find((p) => p.seat === "red");
  const blue = players.find((p) => p.seat === "blue");
  const spectators = players.filter((p) => p.seat === "spectator");
  const me = players.find((p) => p.playerId === myPlayerId);
  const lobby = phase === "lobby";

  const seatRow = (seat: "red" | "blue", occupant: RoomPlayer | undefined) => {
    const mine = occupant?.playerId === myPlayerId;
    const open = !occupant;
    const showSit = Boolean(lobby && open && me && me.seat !== seat && onClaim);
    return (
      <li key={seat} className="explosive-roster-row">
        <span>
          <strong>{seat === "red" ? ex.seatRed : ex.seatBlue}</strong>
          {" · "}
          {occupant
            ? `${occupant.name}${mine ? ` (${ex.you})` : ""}${occupant.kind === "agent" ? ` · ${ex.agentMark}` : ""} · ${occupant.role}${occupant.connected ? "" : ` · ${ex.offline}`}`
            : ex.seatEmpty}
        </span>
        {showSit ? (
          <button type="button" className="primary" onClick={() => onClaim?.(seat)}>
            {seat === "red" ? ex.sitRed : ex.sitBlue}
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <div className="explosive-roster">
      <p className="hint" style={{ margin: 0 }}>
        {ex.rosterTitle}
      </p>
      <ul className="explosive-player-list">
        {seatRow("red", red)}
        {seatRow("blue", blue)}
        <li className="explosive-roster-row">
          <span>
            <strong>{ex.spectatorsLabel}</strong>
            {spectators.length === 0 ? ` · ${ex.seatEmpty}` : ` · ${spectators.length}`}
          </span>
        </li>
        {spectators.map((p) => (
          <li key={p.playerId}>
            {p.name}
            {p.playerId === myPlayerId ? ` (${ex.you})` : ""}
            {p.kind === "agent" ? ` · ${ex.agentMark}` : ""}
            {p.connected ? "" : ` · ${ex.offline}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
