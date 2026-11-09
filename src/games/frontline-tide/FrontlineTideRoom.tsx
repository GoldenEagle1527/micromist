import { useEffect, useState } from "react";
import type { TideAction, TideEffect } from "../../../shared/frontline-tide/actions";
import type { TidePublicState } from "../../../shared/frontline-tide/observe";
import { useLocale } from "../../i18n";
import {
  OnlineRoomClient,
  getOrCreatePlayerIdForGame,
  type Phase,
  type RoomPlayer,
  type Seat,
} from "../../multiplayer/OnlineRoomClient";
import "./frontline-tide.css";

function readPublic(payload: Record<string, unknown>): TidePublicState | null {
  const direct = payload.publicState;
  if (direct && typeof direct === "object" && Array.isArray((direct as TidePublicState).board)) {
    return direct as TidePublicState;
  }
  const observation = payload.observation;
  if (observation && typeof observation === "object") {
    const nested = (observation as { publicState?: unknown }).publicState;
    if (nested && typeof nested === "object" && Array.isArray((nested as TidePublicState).board)) {
      return nested as TidePublicState;
    }
  }
  return null;
}

function readActions(payload: Record<string, unknown>): TideAction[] | null {
  const observation = payload.observation;
  if (!observation || typeof observation !== "object") return null;
  const actions = (observation as { legalActions?: unknown }).legalActions;
  return Array.isArray(actions) ? (actions as TideAction[]) : null;
}

export function FrontlineTideRoom({ roomCode }: { roomCode: string }) {
  const { t } = useLocale();
  const fl = t.frontline;
  const [client, setClient] = useState<OnlineRoomClient | null>(null);
  const [seat, setSeat] = useState<Seat>("spectator");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [pub, setPub] = useState<TidePublicState | null>(null);
  const [actions, setActions] = useState<TideAction[]>([]);
  const [effects, setEffects] = useState<TideEffect[]>([]);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<{ row: number; col: number } | null>(null);
  const [nightArmed, setNightArmed] = useState(false);

  useEffect(() => {
    const room = new OnlineRoomClient("frontline-tide");
    const playerId = getOrCreatePlayerIdForGame("frontline-tide");
    setClient(room);
    room.connect(roomCode, {
      onOpen: () => {
        room.join({ playerId, name: "Player" });
      },
      onWelcome: (payload) => {
        setSeat(payload.seat);
      },
      onRoom: (payload) => {
        setPhase(payload.phase);
        setPlayers(payload.players);
      },
      onError: (payload) => setError(payload.message),
      onMessage: (type, payload) => {
        if (type === "seated") {
          const you = payload.you;
          if (you && typeof you === "object" && typeof (you as { seat?: unknown }).seat === "string") {
            setSeat((you as { seat: Seat }).seat);
          }
        }
        const next = readPublic(payload);
        if (next) setPub(next);
        const legal = readActions(payload);
        if (legal) setActions(legal);
        if (type === "move_applied" && Array.isArray(payload.effects)) {
          setEffects(payload.effects as TideEffect[]);
        }
        if (type === "game_over") setPhase("over");
      },
    });
    return () => room.close();
  }, [roomCode]);

  const playing = seat === "player" && phase === "playing";

  function send(action: TideAction) {
    client?.send("move", action);
    setPick(null);
    setNightArmed(false);
    setError("");
  }

  function onCell(row: number, col: number) {
    if (!playing || !pub) return;
    if (pub.tidePhase === "day_build") {
      const place = actions.find((action) => action.type === "place" && action.row === row && action.col === col);
      if (place) send(place);
      else if (row !== pub.pathRow) setError(fl.noteOffRoad);
      return;
    }
    if (pub.tidePhase !== "day_match") return;
    if (!pick) {
      setPick({ row, col });
      return;
    }
    if (pick.row === row && pick.col === col) {
      setPick(null);
      return;
    }
    const swap = actions.find(
      (action) =>
        action.type === "swap" &&
        ((action.row === pick.row && action.col === pick.col && action.row2 === row && action.col2 === col) ||
          (action.row2 === pick.row && action.col2 === pick.col && action.row === row && action.col === col)),
    );
    if (swap) send(swap);
    else setPick({ row, col });
  }

  const night = effects.find((effect) => effect.type === "night");
  const building = pub?.tidePhase === "day_build";
  const scrubbed = new Set(pub?.scrubbedRoad ?? []);
  const washCols = new Set(pub?.washColumns ?? (pub?.washColumn == null ? [] : [pub.washColumn]));
  const openRoad = pub?.openRoadCols ?? [];
  const canNight = actions.some((action) => action.type === "end_phase");

  return (
    <div className={`frontline-tide${building ? " ft-build" : ""}`}>
      <header className="ft-hud">
        <div className="ft-hud-top">
          <span className="ft-day">{pub ? fl.day(pub.day) : roomCode}</span>
          <span className="ft-phase">{pub?.tidePhase ?? phase}</span>
        </div>
        {pub ? (
          <div className="ft-stats">
            <span className="ft-stat"><strong>{fl.hearts(pub.hearts, pub.hearts)}</strong></span>
            <span className="ft-stat"><strong>{fl.swaps(pub.swapsLeft)}</strong></span>
            <span className="ft-stat"><strong>{fl.points(pub.points)}</strong></span>
            <span className="ft-stat ft-road-stat">
              <strong>{pub.pathRow == null ? "" : fl.roadStat(pub.pathRow + 1)}</strong>
            </span>
            <span className="ft-stat">
              <strong>{pub.frontDir === -1 ? fl.dirShore : fl.dirSea}</strong>
              <span>{fl.wash((pub.washColumns.length ? pub.washColumns : [pub.washColumn ?? 0]).map((col) => col + 1))}</span>
            </span>
          </div>
        ) : null}
      </header>
      {error ? <p className="ft-note">{error}</p> : null}
      {pub && pub.day === 1 && pub.pathRow != null ? (
        <p className="ft-rules ft-teach">
          {fl.teachBite(pub.pathRow + 1)} {fl.teachWash}
        </p>
      ) : null}
      {pub && pub.day >= 10 ? <p className={pub.day === 10 ? "ft-rules ft-milestone" : "ft-rules"}>{fl.ruleDay10}</p> : null}
      {pub && pub.day >= 25 ? <p className={pub.day === 25 ? "ft-rules ft-milestone" : "ft-rules"}>{fl.ruleDay25}</p> : null}
      {pub && pub.day >= 50 && pub.pathRow != null ? (
        <p className={pub.day === 50 ? "ft-rules ft-milestone" : "ft-rules"}>{fl.ruleDay50(pub.pathRow + 1)}</p>
      ) : null}
      {night && night.type === "night" ? (
        <p className="ft-rules">{fl.day(night.day)} · {fl.hearts(night.hearts, night.hearts)}</p>
      ) : null}
      {pub && pub.board.length > 0 ? (
        <div className="ft-stage">
          <div className="ft-shore">{fl.shore}</div>
          <div
            className="ft-board"
            style={{ gridTemplateColumns: `repeat(${pub.board.length}, minmax(0, 1fr))` }}
          >
            {pub.board.map((row) =>
              row.map((cell) => (
                <button
                  key={`${cell.row}-${cell.col}`}
                  type="button"
                  className={[
                    "ft-cell",
                    `ft-band-${cell.terrain}`,
                    cell.row === pub.pathRow ? "ft-road" : "",
                    building && cell.row !== pub.pathRow ? "ft-offroad" : "",
                    cell.row === pub.pathRow && cell.kind !== "defense" && (building || scrubbed.has(cell.col))
                      ? "ft-road-gap"
                      : "",
                    cell.row === pub.pathRow && scrubbed.has(cell.col) && cell.kind !== "defense" ? "ft-road-scrub" : "",
                    washCols.has(cell.col) ? "ft-front" : "",
                    cell.row === pub.pathRow && cell.col === row.length - 1 ? "ft-sea-edge" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onCell(cell.row, cell.col)}
                  disabled={!playing}
                >
                  {washCols.has(cell.col) && cell.row === 0 ? <span className="ft-flag">{fl.flag}</span> : null}
                  {cell.row === pub.pathRow && cell.col === row.length - 1 ? <span className="ft-road-flag">←</span> : null}
                  {cell.kind === "gem" ? <i className="ft-gem" data-color={cell.color ?? 0} /> : null}
                  {cell.kind === "defense" ? <i className="ft-defense" data-tier={cell.tier ?? 1} /> : null}
                  {cell.kind === "empty" ? <i className="ft-hole" /> : null}
                </button>
              )),
            )}
          </div>
          <div className="ft-sea">{fl.sea}</div>
        </div>
      ) : (
        <p className="ft-rules">{players.map((player) => player.seat).join(" · ") || phase}</p>
      )}
      <div className="ft-actions">
        {seat !== "player" && phase === "lobby" ? (
          <button type="button" className="primary" onClick={() => client?.send("claim_seat", { seat: "player" })}>
            {fl.sit}
          </button>
        ) : null}
        {playing && pub?.tidePhase === "day_match" && canNight ? (
          <button type="button" className="primary" onClick={() => send({ type: "end_phase" })}>
            {fl.toBuild}
          </button>
        ) : null}
        {playing && building && canNight ? (
          <button
            type="button"
            className={openRoad.length > 0 && !nightArmed ? "ghost" : "primary"}
            onClick={() => {
              if (openRoad.length > 0 && !nightArmed) {
                setNightArmed(true);
                setError(fl.noteNightGap);
                return;
              }
              send({ type: "end_phase" });
            }}
          >
            {nightArmed && openRoad.length > 0 ? fl.confirmNight : fl.toNight}
          </button>
        ) : null}
        {playing && building && !canNight ? <p className="ft-note">{fl.notePatchRoad}</p> : null}
      </div>
    </div>
  );
}
