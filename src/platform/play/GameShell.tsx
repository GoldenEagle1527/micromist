import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router";
import { CardFx } from "../../components/ChipIcon";
import { useShellGrid } from "../../components/board-expand-context";
import { useLocale } from "../../i18n";
import { copyText } from "./copy-text";
import type {
  ConfirmSpec,
  GamePlayModule,
  GamePreview,
  GameSession,
  GameSnapshot,
  InvitePane,
  ParamField,
  RecordsPane,
  RoomPane,
  SessionContext,
  ShellAction,
} from "./types";
import "./game-shell.css";

type GameShellProps = {
  load: () => Promise<GamePlayModule>;
  preview: GamePreview;
};

type SessionCall = (session: GameSession) => void;

type ShellTile =
  | { role: "intro"; id: "intro" }
  | { role: "menu"; id: string; itemId: string; label: string }
  | { role: "params"; id: "params"; fields: ParamField[] }
  | { role: "hud"; id: "hud" }
  | { role: "action"; id: string; action: ShellAction }
  | { role: "room"; id: "room"; room: RoomPane }
  | { role: "invite"; id: "invite"; invite: InvitePane }
  | { role: "records"; id: "records"; records: RecordsPane }
  | { role: "board"; id: "board" };

function collectTiles(snapshot: GameSnapshot): ShellTile[] {
  const tiles: ShellTile[] = [];
  if (snapshot.title || snapshot.hint || snapshot.menu?.canBack) {
    tiles.push({ role: "intro", id: "intro" });
  }
  for (const item of snapshot.menu?.items ?? []) {
    tiles.push({ role: "menu", id: `menu:${item.id}`, itemId: item.id, label: item.label });
  }
  if (snapshot.params && snapshot.params.fields.length > 0) {
    tiles.push({ role: "params", id: "params", fields: snapshot.params.fields });
  }
  if ((snapshot.hud && snapshot.hud.length > 0) || snapshot.status) {
    tiles.push({ role: "hud", id: "hud" });
  }
  for (const action of snapshot.actions ?? []) {
    tiles.push({ role: "action", id: `action:${action.id}`, action });
  }
  if (snapshot.room) tiles.push({ role: "room", id: "room", room: snapshot.room });
  if (snapshot.invite) tiles.push({ role: "invite", id: "invite", invite: snapshot.invite });
  if (snapshot.records) tiles.push({ role: "records", id: "records", records: snapshot.records });
  if (snapshot.phase === "play") tiles.push({ role: "board", id: "board" });
  return tiles;
}

function BoardHost({ session, active }: { session: GameSession; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const host = ref.current;
    if (!host) return;
    const handle = session.bindBoard(host);
    return () => handle.destroy();
  }, [session, active]);

  return <div className="game-shell-board-host" ref={ref} />;
}

function useLoadedModule(load: () => Promise<GamePlayModule>): GamePlayModule | null {
  const [module, setModule] = useState<GamePlayModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setModule(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);
  return module;
}

function ParamFields({
  fields,
  onChange,
}: {
  fields: ParamField[];
  onChange: (id: string, value: string | number) => void;
}) {
  return (
    <div className="game-shell-params">
      {fields.map((field) => (
        <label key={field.id}>
          {field.label}
          {field.type === "select" ? (
            <select
              value={field.value}
              disabled={field.disabled}
              onChange={(event) => onChange(field.id, event.target.value)}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === "number" ? (
            <input
              type="number"
              value={field.value}
              min={field.min}
              max={field.max}
              disabled={field.disabled}
              onChange={(event) => {
                const next = Number(event.target.value);
                onChange(field.id, Number.isFinite(next) ? next : field.value);
              }}
            />
          ) : (
            <input
              type="text"
              value={field.value}
              disabled={field.disabled}
              onChange={(event) => onChange(field.id, event.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

export function GameShell({ load, preview }: GameShellProps) {
  const { locale } = useLocale();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const module = useLoadedModule(load);
  const [pendingConfirm, setPendingConfirm] = useState<{ id: string; confirm: ConfirmSpec } | null>(
    null,
  );
  const [invitePhase, setInvitePhase] = useState<"idle" | "ok" | "fail">("idle");
  const [sharePhase, setSharePhase] = useState<"idle" | "ok">("idle");
  const inviteTimer = useRef<number | null>(null);
  const shareTimer = useRef<number | null>(null);

  const setSearchRef = useRef(setSearchParams);
  setSearchRef.current = setSearchParams;

  const ctxRef = useRef<SessionContext>({
    locale,
    path: location.pathname,
    origin: typeof window !== "undefined" ? window.location.origin : "",
    search: searchParams,
    setSearch: (next, opts) => {
      const record: Record<string, string> = {};
      next.forEach((value, key) => {
        record[key] = value;
      });
      setSearchRef.current(record, { replace: opts?.replace ?? true });
    },
  });
  ctxRef.current.locale = locale;
  ctxRef.current.path = location.pathname;
  ctxRef.current.search = searchParams;
  if (typeof window !== "undefined") ctxRef.current.origin = window.location.origin;

  const session = useMemo(() => {
    if (!module) return null;
    return module.createSession(ctxRef.current);
  }, [module]);

  useEffect(() => {
    session?.syncContext();
  }, [session, locale, location.pathname, location.search]);

  useEffect(() => () => session?.destroy(), [session]);

  const snapshotCache = useRef<{ session: GameSession; value: GameSnapshot } | null>(null);
  if (session && snapshotCache.current?.session !== session) {
    snapshotCache.current = { session, value: session.snapshot() };
  }
  if (!session) snapshotCache.current = null;

  const liveSnapshot: GameSnapshot | null = useSyncExternalStore(
    (listener) => {
      if (!session) return () => undefined;
      return session.subscribe(() => {
        snapshotCache.current = { session, value: session.snapshot() };
        listener();
      });
    },
    () => (session && snapshotCache.current ? snapshotCache.current.value : null),
    () => (session && snapshotCache.current ? snapshotCache.current.value : null),
  );

  const pendingCalls = useRef<SessionCall[]>([]);
  const [paramOverrides, setParamOverrides] = useState<Record<string, string | number>>({});

  useEffect(() => {
    if (!session) return;
    const queued = pendingCalls.current;
    pendingCalls.current = [];
    for (const [id, value] of Object.entries(paramOverrides)) {
      session.setParam(id, value);
    }
    if (Object.keys(paramOverrides).length > 0) setParamOverrides({});
    for (const call of queued) call(session);
    // Flush only when the session first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const runSession = (call: SessionCall) => {
    if (session) {
      call(session);
      return;
    }
    pendingCalls.current.push(call);
  };

  const previewSnapshot = useMemo(
    () => preview(ctxRef.current),
    [preview, locale, location.pathname, location.search],
  );

  let snapshot = liveSnapshot ?? previewSnapshot;
  if (!liveSnapshot && snapshot.params && Object.keys(paramOverrides).length > 0) {
    snapshot = {
      ...snapshot,
      params: {
        fields: snapshot.params.fields.map((field) => {
          if (!(field.id in paramOverrides)) return field;
          const next = paramOverrides[field.id];
          if (field.type === "number") {
            const value = typeof next === "number" ? next : Number(next);
            return { ...field, value: Number.isFinite(value) ? value : field.value };
          }
          return { ...field, value: String(next) };
        }),
      },
    };
  }

  useEffect(() => {
    setInvitePhase("idle");
    setSharePhase("idle");
    setPendingConfirm(null);
  }, [session]);

  useEffect(
    () => () => {
      if (inviteTimer.current != null) window.clearTimeout(inviteTimer.current);
      if (shareTimer.current != null) window.clearTimeout(shareTimer.current);
    },
    [],
  );

  const runAction = (id: string, confirm?: ConfirmSpec) => {
    if (confirm) {
      setPendingConfirm({ id, confirm });
      return;
    }
    runSession((current) => current.dispatch({ type: "ui", id }));
  };

  const setParamValue = (id: string, value: string | number) => {
    if (!session) setParamOverrides((prev) => ({ ...prev, [id]: value }));
    runSession((current) => current.setParam(id, value));
  };

  const tiles = collectTiles(snapshot);
  const boardIndex = tiles.findIndex((tile) => tile.role === "board");
  const { boardStyle, cardStyle } = useShellGrid(Math.max(1, tiles.length), boardIndex);

  const dialog = pendingConfirm
    ? {
        id: "confirm-action",
        title: pendingConfirm.confirm.title,
        body: pendingConfirm.confirm.body,
        ok: pendingConfirm.confirm.ok,
        cancel: pendingConfirm.confirm.cancel,
        actionId: pendingConfirm.id,
      }
    : snapshot.dialog;

  const copyInvite = (text: string) => {
    void copyText(text).then((ok) => {
      setInvitePhase(ok ? "ok" : "fail");
      if (inviteTimer.current != null) window.clearTimeout(inviteTimer.current);
      inviteTimer.current = window.setTimeout(() => setInvitePhase("idle"), 2000);
    });
  };

  return (
    <>
      <section className="grid" style={boardStyle}>
        {tiles.map((tile, index) => {
          const style = cardStyle(index);
          if (tile.role === "intro") {
            return (
              <section key={tile.id} className="card is-static" style={style}>
                <CardFx />
                {snapshot.menu?.canBack ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => runSession((current) => current.back())}
                  >
                    {snapshot.menu.backLabel ?? "←"}
                  </button>
                ) : null}
                {snapshot.title ? <h2>{snapshot.title}</h2> : null}
                {snapshot.hint ? <p>{snapshot.hint}</p> : null}
              </section>
            );
          }
          if (tile.role === "menu") {
            return (
              <button
                key={tile.id}
                type="button"
                className="card"
                style={style}
                onClick={() => runSession((current) => current.choose(tile.itemId))}
              >
                <CardFx />
                <h2>{tile.label}</h2>
              </button>
            );
          }
          if (tile.role === "params") {
            return (
              <section key={tile.id} className="card is-static" style={style}>
                <CardFx />
                <ParamFields fields={tile.fields} onChange={setParamValue} />
              </section>
            );
          }
          if (tile.role === "hud") {
            return (
              <section key={tile.id} className="card is-static" style={style}>
                <CardFx />
                {snapshot.hud && snapshot.hud.length > 0 ? (
                  <div className="game-shell-hud">
                    {snapshot.hud.map((item) => (
                      <span key={item.id} className="game-shell-hud-item">
                        {item.label ? `${item.label}：` : null}
                        <strong>{item.value}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
                {snapshot.status ? <p>{snapshot.status}</p> : null}
              </section>
            );
          }
          if (tile.role === "action") {
            const action = tile.action;
            const primary = action.kind === "primary";
            return (
              <button
                key={tile.id}
                type="button"
                className={`card${primary ? " is-primary" : ""}`}
                style={style}
                disabled={action.disabled}
                onClick={() => runAction(action.id, action.confirm)}
              >
                <CardFx />
                <h2>{action.label}</h2>
              </button>
            );
          }
          if (tile.role === "room") {
            const room = tile.room;
            return (
              <section key={tile.id} className="card is-static" style={style} aria-label={room.title}>
                <CardFx />
                <h2>{room.title}</h2>
                {room.status ? <p>{room.status}</p> : null}
                {room.code ? <p className="game-shell-room-code">{room.code}</p> : null}
                {room.shareUrl ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const url = room.shareUrl;
                      if (!url) return;
                      void copyText(url).then((ok) => {
                        if (!ok) return;
                        setSharePhase("ok");
                        if (shareTimer.current != null) window.clearTimeout(shareTimer.current);
                        shareTimer.current = window.setTimeout(() => setSharePhase("idle"), 2000);
                      });
                    }}
                  >
                    {sharePhase === "ok" ? (room.copiedLabel ?? room.shareLabel) : room.shareLabel}
                  </button>
                ) : null}
                {room.seats && room.seats.length > 0 ? (
                  <ul className="game-shell-seats">
                    {room.seats.map((seat) => (
                      <li key={seat.id}>
                        {seat.canClaim ? (
                          <button
                            type="button"
                            className="ghost"
                            onClick={() =>
                              runSession((current) =>
                                current.dispatch({ type: "claim-seat", id: seat.id }),
                              )
                            }
                          >
                            {seat.label}
                          </button>
                        ) : (
                          <span>
                            {seat.label}
                            {seat.detail ? ` · ${seat.detail}` : ""}
                            {seat.isYou ? " ·" : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          }
          if (tile.role === "invite") {
            const invite = tile.invite;
            return (
              <button
                key={tile.id}
                type="button"
                className="card"
                style={style}
                onClick={() => copyInvite(invite.text)}
              >
                <CardFx />
                <h2>
                  {invitePhase === "ok"
                    ? invite.copied
                    : invitePhase === "fail"
                      ? invite.failed
                      : invite.line}
                </h2>
              </button>
            );
          }
          if (tile.role === "records") {
            const records = tile.records;
            return (
              <section key={tile.id} className="card is-static" style={style} aria-label={records.title}>
                <CardFx />
                <h2>{records.title}</h2>
                {records.groups.every((group) => group.rows.length === 0) ? (
                  <p>{records.empty}</p>
                ) : (
                  records.groups.map((group) =>
                    group.rows.length === 0 ? null : (
                      <div key={group.id} className="game-shell-records-group">
                        <p className="game-shell-records-label">{group.label}</p>
                        <ul>
                          {group.rows.map((row) => (
                            <li key={row.id}>
                              {row.badge ? <span className="game-shell-badge">{row.badge}</span> : null}
                              <span>{row.title}</span>
                              {row.meta ? <span className="hint">{row.meta}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )
                )}
              </section>
            );
          }
          return (
            <section key={tile.id} className="card is-static is-board" style={style}>
              {session ? <BoardHost session={session} active /> : null}
            </section>
          );
        })}
      </section>

      {dialog ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setPendingConfirm(null);
          }}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-shell-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="game-shell-dialog-title">{dialog.title}</h2>
              {dialog.cancel ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setPendingConfirm(null)}
                  aria-label={dialog.cancel}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
                  </svg>
                </button>
              ) : null}
            </div>
            <p className="lede modal-body">{dialog.body}</p>
            <div className="modal-actions">
              {dialog.cancel ? (
                <button type="button" className="ghost" onClick={() => setPendingConfirm(null)}>
                  {dialog.cancel}
                </button>
              ) : null}
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const actionId = dialog.actionId;
                  setPendingConfirm(null);
                  runSession((current) => current.dispatch({ type: "ui", id: actionId }));
                }}
              >
                {dialog.ok}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
