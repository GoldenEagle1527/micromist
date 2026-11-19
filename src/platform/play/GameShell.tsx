import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router";
import { useLocale } from "../../i18n";
import { copyText } from "./copy-text";
import type {
  ConfirmSpec,
  GamePlayModule,
  GameSession,
  GameSnapshot,
  SessionContext,
} from "./types";
import "./game-shell.css";

type GameShellProps = {
  load: () => Promise<GamePlayModule>;
};

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

export function GameShell({ load }: GameShellProps) {
  const { locale, t } = useLocale();
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
  }, [session, locale, location.pathname, searchParams]);

  useEffect(() => () => session?.destroy(), [session]);

  const snapshot: GameSnapshot | null = useSyncExternalStore(
    session ? session.subscribe : () => () => undefined,
    session ? session.snapshot : () => null,
    session ? session.snapshot : () => null,
  );

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

  if (!module || !session || !snapshot) {
    return <p className="lede game-shell-loading">{t.loading}</p>;
  }

  const runAction = (id: string, confirm?: ConfirmSpec) => {
    if (confirm) {
      setPendingConfirm({ id, confirm });
      return;
    }
    session.dispatch({ type: "ui", id });
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

  return (
    <div className={`game-shell${snapshot.phase === "play" ? " is-play" : " is-menu"}`}>
      <div className="game-shell-chrome">
        {snapshot.title ? <h2 className="game-shell-title">{snapshot.title}</h2> : null}
        {snapshot.hint ? <p className="hint game-shell-hint">{snapshot.hint}</p> : null}

        {snapshot.menu?.canBack ? (
          <div className="row">
            <button type="button" className="ghost" onClick={() => session.back()}>
              {snapshot.menu.backLabel ?? "←"}
            </button>
          </div>
        ) : null}

        {snapshot.menu && snapshot.menu.items.length > 0 ? (
          <div className="game-shell-menu">
            {snapshot.menu.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="game-shell-menu-item"
                onClick={() => session.choose(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {snapshot.params && snapshot.params.fields.length > 0 ? (
          <div className="game-shell-params">
            {snapshot.params.fields.map((field) => (
              <label key={field.id}>
                {field.label}
                {field.type === "select" ? (
                  <select
                    value={field.value}
                    disabled={field.disabled}
                    onChange={(event) => session.setParam(field.id, event.target.value)}
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
                      session.setParam(field.id, Number.isFinite(next) ? next : field.value);
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={field.value}
                    disabled={field.disabled}
                    onChange={(event) => session.setParam(field.id, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}

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

        {snapshot.status ? <p className="hint game-shell-status">{snapshot.status}</p> : null}

        {snapshot.actions && snapshot.actions.length > 0 ? (
          <div className="row game-shell-actions">
            {snapshot.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={action.kind === "primary" ? "primary" : "ghost"}
                disabled={action.disabled}
                onClick={() => runAction(action.id, action.confirm)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {snapshot.room ? (
          <section className="game-shell-room" aria-label={snapshot.room.title}>
            <h3 className="game-shell-subtitle">{snapshot.room.title}</h3>
            {snapshot.room.status ? <p className="hint">{snapshot.room.status}</p> : null}
            {snapshot.room.code ? (
              <p className="game-shell-room-code">{snapshot.room.code}</p>
            ) : null}
            {snapshot.room.shareUrl ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const url = snapshot.room?.shareUrl;
                  if (!url) return;
                  void copyText(url).then((ok) => {
                    if (!ok) return;
                    setSharePhase("ok");
                    if (shareTimer.current != null) window.clearTimeout(shareTimer.current);
                    shareTimer.current = window.setTimeout(() => setSharePhase("idle"), 2000);
                  });
                }}
              >
                {sharePhase === "ok"
                  ? (snapshot.room.copiedLabel ?? snapshot.room.shareLabel)
                  : snapshot.room.shareLabel}
              </button>
            ) : null}
            {snapshot.room.seats && snapshot.room.seats.length > 0 ? (
              <ul className="game-shell-seats">
                {snapshot.room.seats.map((seat) => (
                  <li key={seat.id}>
                    {seat.canClaim ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => session.dispatch({ type: "claim-seat", id: seat.id })}
                      >
                        {seat.label}
                        {seat.detail ? ` · ${seat.detail}` : ""}
                      </button>
                    ) : (
                      <span>
                        {seat.label}
                        {seat.isYou ? " · •" : ""}
                        {seat.detail ? ` · ${seat.detail}` : ""}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {snapshot.invite ? (
          <button
            type="button"
            className="game-shell-invite"
            data-phase={invitePhase}
            aria-live="polite"
            onClick={() => {
              const text = snapshot.invite?.text;
              if (!text) return;
              void copyText(text).then((ok) => {
                setInvitePhase(ok ? "ok" : "fail");
                if (inviteTimer.current != null) window.clearTimeout(inviteTimer.current);
                inviteTimer.current = window.setTimeout(() => setInvitePhase("idle"), 2000);
              });
            }}
          >
            {invitePhase === "ok"
              ? snapshot.invite.copied
              : invitePhase === "fail"
                ? snapshot.invite.failed
                : snapshot.invite.line}
          </button>
        ) : null}

        {snapshot.records ? (
          <section className="game-shell-records" aria-label={snapshot.records.title}>
            <h3 className="game-shell-subtitle">{snapshot.records.title}</h3>
            {snapshot.records.groups.every((group) => group.rows.length === 0) ? (
              <p className="hint">{snapshot.records.empty}</p>
            ) : (
              snapshot.records.groups.map((group) =>
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
        ) : null}
      </div>

      {snapshot.phase === "play" ? (
        <div className="game-shell-board">
          <BoardHost session={session} active />
        </div>
      ) : null}

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
                  session.dispatch({ type: "ui", id: actionId });
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
