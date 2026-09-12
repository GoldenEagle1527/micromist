import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { games } from "../games/catalog";
import type { Locale } from "../i18n";
import {
  PLATFORM_GAME,
  estimateOriginStorage,
  formatBytes,
  listLegacyLocalStorageKeys,
  localDbSummarizeByGame,
  type LocalDbGameSummary,
  type StorageQuotaInfo,
} from "../lib/local-db";
import {
  gameStoreClearGame,
  gameStoreNukeEverythingIncludingPlatformLs,
  gameStoreReload,
} from "../lib/game-store";

export type LocalDataDict = {
  storageTitle: string;
  storageClose: string;
  storageHint: string;
  storageQuota: (used: string, quota: string) => string;
  storageQuotaUnknown: string;
  storageEmpty: string;
  storageEntries: (n: number) => string;
  storageClearGame: string;
  storageClearAll: string;
  storageConfirmClearGame: (name: string) => string;
  storageConfirmClearAll: string;
  storageConfirmCancel: string;
  storageConfirmOk: string;
  storagePlatform: string;
  storageUnknownGame: string;
  storageRefresh: string;
  storageLegacyNote: string;
};

type Row = {
  game: string;
  label: string;
  idb: LocalDbGameSummary | null;
  legacyCount: number;
  legacyBytes: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  t: LocalDataDict;
};

function gameLabel(
  slug: string,
  locale: Locale,
  t: LocalDataDict,
): string {
  if (slug === PLATFORM_GAME) return t.storagePlatform;
  const meta = games.find((g) => g.slug === slug);
  if (meta) return meta.title[locale];
  if (slug === "unknown") return t.storageUnknownGame;
  return slug;
}

export function LocalDataModal({ open, onClose, locale, t }: Props) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [idbRows, setIdbRows] = useState<LocalDbGameSummary[]>([]);
  const [quota, setQuota] = useState<StorageQuotaInfo>({ usage: null, quota: null });
  const [legacy, setLegacy] = useState(() => listLegacyLocalStorageKeys());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    null | { kind: "game"; game: string } | { kind: "all" }
  >(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await gameStoreReload();
      const [summaries, est] = await Promise.all([
        localDbSummarizeByGame(),
        estimateOriginStorage(),
      ]);
      setIdbRows(summaries);
      setQuota(est);
      setLegacy(listLegacyLocalStorageKeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    closeBtnRef.current?.focus();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirm) setConfirm(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, confirm]);

  const rows: Row[] = useMemo(() => {
    const byGame = new Map<string, Row>();
    const ensure = (game: string) => {
      let row = byGame.get(game);
      if (!row) {
        row = {
          game,
          label: gameLabel(game, locale, t),
          idb: null,
          legacyCount: 0,
          legacyBytes: 0,
        };
        byGame.set(game, row);
      }
      return row;
    };
    for (const s of idbRows) {
      const row = ensure(s.game);
      row.idb = s;
    }
    for (const k of legacy) {
      const row = ensure(k.game);
      row.legacyCount += 1;
      row.legacyBytes += k.approxBytes;
    }
    // Always show catalog games so empty state is clear per title
    for (const g of games) ensure(g.slug);
    ensure(PLATFORM_GAME);

    return [...byGame.values()].sort((a, b) => {
      const aHas = (a.idb?.count ?? 0) + a.legacyCount;
      const bHas = (b.idb?.count ?? 0) + b.legacyCount;
      if (aHas !== bHas) return bHas - aHas;
      return a.label.localeCompare(b.label, locale === "zh" ? "zh-CN" : "en");
    });
  }, [idbRows, legacy, locale, t]);

  const loc = locale === "zh" ? "zh-CN" : "en-US";
  const usedLabel = formatBytes(quota.usage, loc);
  const quotaLabel = formatBytes(quota.quota, loc);

  const runClearGame = async (game: string) => {
    setBusy(true);
    setError(null);
    try {
      await gameStoreClearGame(game);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const runClearAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await gameStoreNukeEverythingIncludingPlatformLs();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel local-data-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId}>{t.storageTitle}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={t.storageClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
            </svg>
          </button>
        </div>

        <p className="hint local-data-hint">{t.storageHint}</p>
        <p className="hint local-data-quota">
          {quota.usage != null || quota.quota != null
            ? t.storageQuota(usedLabel, quotaLabel)
            : t.storageQuotaUnknown}
        </p>
        <p className="hint local-data-legacy-note">{t.storageLegacyNote}</p>
        {error ? <p className="local-data-error">{error}</p> : null}

        <ul className="local-data-list">
          {rows.every(
            (r) => (r.idb?.count ?? 0) === 0 && r.legacyCount === 0,
          ) ? (
            <li className="local-data-empty">{t.storageEmpty}</li>
          ) : (
            rows.map((row) => {
              const idbCount = row.idb?.count ?? 0;
              const total = idbCount + row.legacyCount;
              if (total === 0) return null;
              const bytes =
                (row.idb?.approxBytes ?? 0) + row.legacyBytes;
              return (
                <li key={row.game} className="local-data-row">
                  <div className="local-data-row-main">
                    <span className="local-data-row-title">{row.label}</span>
                    <span className="local-data-row-meta">
                      {t.storageEntries(total)} · {formatBytes(bytes, loc)}
                      {idbCount > 0 && row.legacyCount > 0
                        ? ` · IDB ${idbCount} / LS ${row.legacyCount}`
                        : idbCount > 0
                          ? " · IndexedDB"
                          : " · localStorage"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => setConfirm({ kind: "game", game: row.game })}
                  >
                    {t.storageClearGame}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="modal-actions local-data-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {t.storageRefresh}
          </button>
          <button
            type="button"
            className="danger-btn"
            disabled={busy}
            onClick={() => setConfirm({ kind: "all" })}
          >
            {t.storageClearAll}
          </button>
          <button type="button" className="primary" onClick={onClose}>
            {t.storageClose}
          </button>
        </div>

        {confirm ? (
          <div className="local-data-confirm" role="alertdialog">
            <p>
              {confirm.kind === "all"
                ? t.storageConfirmClearAll
                : t.storageConfirmClearGame(gameLabel(confirm.game, locale, t))}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                {t.storageConfirmCancel}
              </button>
              <button
                type="button"
                className="danger-btn"
                disabled={busy}
                onClick={() =>
                  void (confirm.kind === "all"
                    ? runClearAll()
                    : runClearGame(confirm.game))
                }
              >
                {t.storageConfirmOk}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
