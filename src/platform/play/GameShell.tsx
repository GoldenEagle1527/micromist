import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router";
import { useLocale } from "../../i18n";
import {
  USER_NAME_MAX,
  normalizeUserName,
  userNameLength,
  writeUserName,
} from "../../lib/user-name";
import { copyText } from "./copy-text";
import { playFrameStyle, useSetPlayChrome } from "./play-chrome";
import type {
  ConfirmSpec,
  GamePlayModule,
  GamePreview,
  GameSession,
  GameSnapshot,
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

function ParamFieldView({
  field,
  onChange,
}: {
  field: ParamField;
  onChange: (id: string, value: string | number) => void;
}) {
  return (
    <label className="game-shell-param">
      <span>{field.label}</span>
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
  );
}

function actionClass(kind: ShellAction["kind"]): string {
  if (kind === "primary") return "primary";
  if (kind === "danger") return "ghost";
  return "ghost";
}

function ActionsRow({
  actions,
  onRun,
}: {
  actions: ShellAction[];
  onRun: (id: string, confirm?: ConfirmSpec) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="game-shell-actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={actionClass(action.kind)}
          disabled={action.disabled}
          onClick={() => onRun(action.id, action.confirm)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function RoomView({
  room,
  sharePhase,
  onCopyShare,
  onClaim,
}: {
  room: RoomPane;
  sharePhase: "idle" | "ok";
  onCopyShare: (url: string) => void;
  onClaim: (id: string) => void;
}) {
  const seats = room.seats ?? [];
  const people = room.spectators?.people ?? [];
  return (
    <section className="game-shell-room" aria-label={room.title}>
      <h3>{room.title}</h3>
      {room.status ? <p className="hint">{room.status}</p> : null}
      {room.code ? <p className="game-shell-room-code">{room.code}</p> : null}
      {room.shareUrl ? (
        <button type="button" className="ghost" onClick={() => onCopyShare(room.shareUrl ?? "")}>
          {sharePhase === "ok" ? (room.copiedLabel ?? room.shareLabel) : room.shareLabel}
        </button>
      ) : null}
      {room.rules && room.rules.lines.length > 0 ? (
        <div className="game-shell-room-mod">
          <p className="game-shell-room-mod-title">
            {room.rules.title}
            {room.rules.frozen ? (
              <span className="hint">{room.rules.frozenLabel ?? ""}</span>
            ) : null}
          </p>
          <dl className="game-shell-rules">
            {room.rules.lines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {seats.length > 0 ? (
        <div className={`game-shell-vs${seats.length === 1 ? " is-single" : ""}`}>
          {seats.flatMap((seat, index) => {
            const card = (
              <div key={seat.id} className={`game-shell-seat-card${seat.isYou ? " is-you" : ""}`}>
                <p className="game-shell-seat-label">{seat.label}</p>
                <p className="game-shell-seat-name">
                  {seat.occupant || seat.status || seat.detail || ""}
                </p>
                {seat.status && seat.occupant ? <p className="hint">{seat.status}</p> : null}
                {seat.canClaim ? (
                  <button
                    type="button"
                    className="primary game-shell-seat-claim"
                    onClick={() => onClaim(seat.id)}
                  >
                    {seat.claimLabel || seat.detail || seat.label}
                  </button>
                ) : null}
              </div>
            );
            if (index === 1) {
              return [
                <span key="vs" className="game-shell-vs-mark" aria-hidden="true">
                  VS
                </span>,
                card,
              ];
            }
            return [card];
          })}
        </div>
      ) : null}
      {room.spectators ? (
        <div className="game-shell-room-mod">
          <p className="game-shell-room-mod-title">{room.spectators.title}</p>
          {room.spectators.watching ? <p className="hint">{room.spectators.watching}</p> : null}
          {people.length === 0 ? (
            <p className="hint">{room.spectators.empty}</p>
          ) : (
            <ul className="game-shell-spec-list">
              {people.map((person) => (
                <li key={person.id} className={person.isYou ? "is-you" : undefined}>
                  {person.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function RecordsView({ records }: { records: RecordsPane }) {
  return (
    <section className="game-shell-records" aria-label={records.title}>
      <h3>{records.title}</h3>
      {records.groups.every((group) => group.rows.length === 0) ? (
        <p className="hint">{records.empty}</p>
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


export function GameShell({ load, preview }: GameShellProps) {
  const { locale, t } = useLocale();
  const setPlayChrome = useSetPlayChrome();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const module = useLoadedModule(load);
  const [pendingConfirm, setPendingConfirm] = useState<{ id: string; confirm: ConfirmSpec } | null>(
    null,
  );
  const [invitePhase, setInvitePhase] = useState<"idle" | "ok" | "fail">("idle");
  const [sharePhase, setSharePhase] = useState<"idle" | "ok">("idle");
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState(false);
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

  const dismissDialog = () => {
    const hadPending = pendingConfirm != null;
    setPendingConfirm(null);
    if (!hadPending && snapshot.dialog) {
      runSession((current) => current.dispatch({ type: "ui", id: "dismiss-dialog" }));
    }
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissDialog();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // dismissDialog closes over snapshot; rebind when dialog identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog?.id, dialog?.actionId]);

  const copyInvite = (text: string) => {
    void copyText(text).then((ok) => {
      setInvitePhase(ok ? "ok" : "fail");
      if (inviteTimer.current != null) window.clearTimeout(inviteTimer.current);
      inviteTimer.current = window.setTimeout(() => setInvitePhase("idle"), 2000);
    });
  };

  const copyShare = (url: string) => {
    void copyText(url).then((ok) => {
      if (!ok) return;
      setSharePhase("ok");
      if (shareTimer.current != null) window.clearTimeout(shareTimer.current);
      shareTimer.current = window.setTimeout(() => setSharePhase("idle"), 2000);
    });
  };

  const claimSeat = (id: string) => {
    runSession((current) => current.dispatch({ type: "claim-seat", id }));
  };

  const showBoard = snapshot.phase === "play" && Boolean(session);
  const playChrome = useMemo(() => {
    if (snapshot.phase !== "play" || !snapshot.chrome) return undefined;
    const notice = snapshot.status?.trim();
    if (!notice) return snapshot.chrome;
    return { ...snapshot.chrome, notice };
  }, [snapshot.phase, snapshot.chrome, snapshot.status]);

  useEffect(() => {
    setPlayChrome(playChrome ?? null);
  }, [setPlayChrome, playChrome]);

  useEffect(() => () => setPlayChrome(null), [setPlayChrome]);

  return (
    <div
      className={snapshot.phase === "play" ? "game-shell game-shell-is-play" : "game-shell"}
      style={snapshot.phase === "play" ? playFrameStyle(playChrome) : undefined}
      data-frame-active={playChrome?.active ?? undefined}
    >
      {snapshot.phase === "menu" ? (
        <div className="game-shell-setup">
          <div className="panel">
            {snapshot.menu?.canBack ? (
              <button
                type="button"
                className="ghost game-shell-back"
                onClick={() => runSession((current) => current.back())}
              >
                {snapshot.menu.backLabel ?? "←"}
              </button>
            ) : null}
            {snapshot.title ? <h2>{snapshot.title}</h2> : null}
            {snapshot.hint ? <p className="hint">{snapshot.hint}</p> : null}
            {snapshot.status ? <p className="hint">{snapshot.status}</p> : null}
            {snapshot.menu?.items && snapshot.menu.items.length > 0 ? (
              <div className="game-shell-menu">
                {snapshot.menu.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="primary"
                    onClick={() => runSession((current) => current.choose(item.id))}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {snapshot.params?.fields && snapshot.params.fields.length > 0 ? (
              <div className="game-shell-params">
                {snapshot.params.fields.map((field) => (
                  <ParamFieldView key={field.id} field={field} onChange={setParamValue} />
                ))}
              </div>
            ) : null}
            <ActionsRow actions={snapshot.actions ?? []} onRun={runAction} />
            {snapshot.room ? (
              <RoomView
                room={snapshot.room}
                sharePhase={sharePhase}
                onCopyShare={copyShare}
                onClaim={claimSeat}
              />
            ) : null}
            {snapshot.invite ? (
              <button
                type="button"
                className="ghost game-shell-invite"
                onClick={() => {
                  const invite = snapshot.invite;
                  if (invite) copyInvite(invite.text);
                }}
              >
                {invitePhase === "ok"
                  ? snapshot.invite.copied
                  : invitePhase === "fail"
                    ? snapshot.invite.failed
                    : snapshot.invite.line}
              </button>
            ) : null}
            {snapshot.records ? <RecordsView records={snapshot.records} /> : null}
          </div>
        </div>
      ) : (
        <div className="game-shell-play">
          {snapshot.room?.seats?.some((seat) => seat.canClaim) ? (
            <RoomView
              room={snapshot.room}
              sharePhase={sharePhase}
              onCopyShare={copyShare}
              onClaim={claimSeat}
            />
          ) : null}
          {showBoard && session ? <BoardHost session={session} active /> : null}
          <ActionsRow actions={snapshot.actions ?? []} onRun={runAction} />
        </div>
      )}

      {snapshot.askName ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="game-shell-name-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="game-shell-name-title">{t.displayNameTitle}</h2>
            </div>
            <p className="lede modal-body">{t.displayNameBody}</p>
            <label className="game-shell-param">
              <span className="hint">
                {userNameLength(nameDraft)} / {USER_NAME_MAX}
              </span>
              <input
                type="text"
                maxLength={USER_NAME_MAX * 2}
                value={nameDraft}
                placeholder={t.displayNamePlaceholder}
                autoComplete="nickname"
                autoFocus
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setNameError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const saved = writeUserName(nameDraft);
                  if (!saved) {
                    setNameError(true);
                    return;
                  }
                  setNameError(false);
                  runSession((current) =>
                    current.dispatch({ type: "ui", id: "display-name-ready", name: saved }),
                  );
                }}
              />
            </label>
            {nameError ? <p className="hint">{t.displayNameInvalid}</p> : null}
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => runSession((current) => current.dispatch({ type: "ui", id: "display-name-cancel" }))}
              >
                {t.displayNameCancel}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const saved = writeUserName(nameDraft);
                  if (!saved || !normalizeUserName(nameDraft)) {
                    setNameError(true);
                    return;
                  }
                  setNameError(false);
                  runSession((current) =>
                    current.dispatch({ type: "ui", id: "display-name-ready", name: saved }),
                  );
                }}
              >
                {t.displayNameOk}
              </button>
            </div>
          </div>
        </div>
      ) : dialog ? (
        <div className="modal-backdrop" role="presentation" onClick={dismissDialog}>
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
                  onClick={dismissDialog}
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
                <button type="button" className="ghost" onClick={dismissDialog}>
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
    </div>
  );
}
