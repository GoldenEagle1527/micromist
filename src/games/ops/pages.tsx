import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { OpsDict } from "./i18n";
import { dashboardStats, listAlerts, nextProvisionCost } from "./engine";
import {
  CROP_ORDER,
  EXPORT_VALUE,
  HOST_POOL,
  PANEL_VERSION,
  SEED_PRICE,
  type CropId,
  type OpsState,
} from "./types";

type PageProps = {
  state: OpsState;
  t: OpsDict;
  onBuy: (crop: CropId) => void;
  onPlant: (plotId: string, crop: CropId) => void;
  onHealthCheck: (plotId: string) => void;
  onRelease: (plotId: string) => void;
  onExport: (crop: CropId, qty?: number) => void;
  onProvision: () => void;
  onRunCron: (id: OpsState["cron"][number]["id"]) => void;
  onToggleCron: (id: OpsState["cron"][number]["id"]) => void;
  onTermCommand: (line: string) => string[];
  termCleared: boolean;
  onTermClear: () => void;
  onExportSave: () => void;
  onImportSave: (file: File) => void;
  onResetSave: () => void;
  onToggleCompact: () => void;
  onToggleDebug: () => void;
  settingsFlash: string | null;
};

function formatTime(at: number | null, neverLabel: string): string {
  if (at == null) return neverLabel;
  try {
    return new Date(at).toLocaleString();
  } catch {
    return neverLabel;
  }
}

function StatusPill({
  status,
  label,
}: {
  status: OpsState["plots"][number]["status"];
  label: string;
}) {
  return <span className={`ops-pill ops-pill-${status}`}>{label}</span>;
}

export function DashboardPage({
  state,
  t,
  onRunCron,
  onHealthCheck,
}: Pick<PageProps, "state" | "t" | "onRunCron" | "onHealthCheck">) {
  const stats = useMemo(() => dashboardStats(state), [state]);
  const alerts = useMemo(() => listAlerts(state), [state]);
  const cards = [
    { label: t.cardGrowing, value: String(stats.growing) },
    { label: t.cardReady, value: String(stats.ready) },
    { label: t.cardEmpty, value: String(stats.empty) },
    { label: t.cardWilted, value: String(stats.wilted) },
    { label: t.cardMoisture, value: `${stats.avgMoisture}%` },
    { label: t.cardSeeds, value: String(stats.seedStock) },
    { label: t.cardCoins, value: String(state.coins) },
    { label: t.cardDay, value: String(state.day) },
  ];

  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <h2>{t.dashboardTitle}</h2>
        <p className="ops-page-sub">{t.menuHint.dashboard}</p>
      </header>
      <div className="ops-card-grid">
        {cards.map((c) => (
          <article key={c.label} className="ops-stat-card">
            <div className="ops-stat-label">{c.label}</div>
            <div className="ops-stat-value">{c.value}</div>
          </article>
        ))}
      </div>
      <section className="ops-panel">
        <h3>{t.dashQuickTitle}</h3>
        <div className="ops-quick-row">
          <button type="button" className="ops-btn" onClick={() => onRunCron("water-all")}>
            {t.dashQuickHealth}
          </button>
          <button type="button" className="ops-btn" onClick={() => onRunCron("harvest-ready")}>
            {t.dashQuickRelease}
          </button>
          <button type="button" className="ops-btn ops-btn-ghost" onClick={() => onRunCron("scan-pests")}>
            {t.dashQuickScan}
          </button>
        </div>
      </section>
      <section className="ops-panel">
        <h3>{t.alertsTitle}</h3>
        {alerts.length === 0 ? (
          <p className="ops-muted">{t.alertsEmpty}</p>
        ) : (
          <ul className="ops-alert-list">
            {alerts.map((plot) => (
              <li key={plot.id} className="ops-alert-row">
                <div>
                  <StatusPill status="wilted" label={t.status.wilted} />
                  <span className="ops-alert-text">{t.alertsHost(plot.host)}</span>
                </div>
                <button
                  type="button"
                  className="ops-btn ops-btn-sm"
                  onClick={() => onHealthCheck(plot.id)}
                >
                  {t.alertsHandle}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ops-panel">
        <h3>{t.recentLogs}</h3>
        <ul className="ops-log-list">
          {state.logs.slice(0, 6).map((line) => (
            <li key={line.id} className={`ops-log ops-log-${line.level}`}>
              <time>{formatTime(line.at, "—")}</time>
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function PlotsPage({
  state,
  t,
  onPlant,
  onHealthCheck,
  onRelease,
  onProvision,
}: Pick<PageProps, "state" | "t" | "onPlant" | "onHealthCheck" | "onRelease" | "onProvision">) {
  const [picking, setPicking] = useState<string | null>(null);
  const available = CROP_ORDER.filter((c) => state.seeds[c] > 0);
  const cost = nextProvisionCost(state);
  const canProvision = state.plots.length < HOST_POOL.length && state.coins >= cost;
  const quotaFull = state.plots.length >= HOST_POOL.length;

  return (
    <div className="ops-page">
      <header className="ops-page-head ops-page-head-row">
        <div>
          <h2>{t.plotsTitle}</h2>
          <p className="ops-page-sub">{t.menuHint.plots}</p>
        </div>
        <button
          type="button"
          className="ops-btn"
          disabled={!canProvision}
          title={quotaFull ? t.provisionFull : t.provisionCost(cost)}
          onClick={onProvision}
        >
          {t.provisionSite}
          {!quotaFull ? ` · ${t.provisionCost(cost)}` : ""}
        </button>
      </header>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>{t.plotsColHost}</th>
              <th>{t.plotsColStatus}</th>
              <th>{t.plotsColCrop}</th>
              <th>{t.plotsColGrowth}</th>
              <th>{t.plotsColMoisture}</th>
              <th>{t.plotsColAction}</th>
            </tr>
          </thead>
          <tbody>
            {state.plots.map((plot) => (
              <tr key={plot.id}>
                <td>
                  <code>{plot.host}</code>
                  {state.prefs.showDebug ? (
                    <div className="ops-muted ops-debug-id">{plot.id}</div>
                  ) : null}
                </td>
                <td>
                  <StatusPill status={plot.status} label={t.status[plot.status]} />
                </td>
                <td>{plot.crop ? t.app[plot.crop] : "—"}</td>
                <td>
                  <div className="ops-bar" title={`${plot.growth}%`}>
                    <div className="ops-bar-fill" style={{ width: `${plot.growth}%` }} />
                    <span>{plot.growth}%</span>
                  </div>
                </td>
                <td>{plot.moisture}%</td>
                <td>
                  {plot.status === "empty" ? (
                    picking === plot.id ? (
                      <div className="ops-inline-pick">
                        {available.length === 0 ? (
                          <span className="ops-muted">{t.noSeeds}</span>
                        ) : (
                          available.map((crop) => (
                            <button
                              key={crop}
                              type="button"
                              className="ops-btn ops-btn-sm"
                              onClick={() => {
                                onPlant(plot.id, crop);
                                setPicking(null);
                              }}
                            >
                              {t.app[crop]} ({state.seeds[crop]})
                            </button>
                          ))
                        )}
                        <button
                          type="button"
                          className="ops-btn ops-btn-ghost ops-btn-sm"
                          onClick={() => setPicking(null)}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ops-btn ops-btn-sm"
                        onClick={() => setPicking(plot.id)}
                      >
                        {t.plant}
                      </button>
                    )
                  ) : (
                    <div className="ops-inline-pick">
                      {(plot.status === "growing" ||
                        plot.status === "wilted" ||
                        plot.status === "ready") && (
                        <button
                          type="button"
                          className="ops-btn ops-btn-sm"
                          onClick={() => onHealthCheck(plot.id)}
                        >
                          {t.healthCheck}
                        </button>
                      )}
                      {plot.status === "ready" ? (
                        <button
                          type="button"
                          className="ops-btn ops-btn-sm ops-btn-ok"
                          onClick={() => onRelease(plot.id)}
                        >
                          {t.releaseSite}
                        </button>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ShopPage({ state, t, onBuy }: Pick<PageProps, "state" | "t" | "onBuy">) {
  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <h2>{t.shopTitle}</h2>
        <p className="ops-page-sub">{t.menuHint.shop}</p>
      </header>
      <div className="ops-shop-grid">
        {CROP_ORDER.map((crop) => {
          const price = SEED_PRICE[crop];
          const canBuy = state.coins >= price;
          return (
            <article key={crop} className="ops-shop-card">
              <div className="ops-shop-icon" aria-hidden>
                {crop === "lettuce" ? "Ng" : crop === "tomato" ? "My" : crop === "potato" ? "Rd" : "Pg"}
              </div>
              <h3>{t.app[crop]}</h3>
              <p className="ops-muted">{t.appBlurb[crop]}</p>
              <div className="ops-shop-meta">
                <span>{t.shopPrice(price)}</span>
                <span>{t.shopOwned(state.seeds[crop])}</span>
              </div>
              <button
                type="button"
                className="ops-btn"
                disabled={!canBuy}
                title={canBuy ? undefined : t.toastNeedCoins}
                onClick={() => onBuy(crop)}
              >
                {t.shopBuy}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function WarehousePage({
  state,
  t,
  onExport,
}: Pick<PageProps, "state" | "t" | "onExport">) {
  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <h2>{t.warehouseTitle}</h2>
        <p className="ops-page-sub">{t.menuHint.warehouse}</p>
      </header>
      {state.inventory.length === 0 ? (
        <p className="ops-empty">{t.warehouseEmpty}</p>
      ) : (
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>{t.warehouseColItem}</th>
                <th>{t.warehouseColQty}</th>
                <th>{t.warehouseColAction}</th>
              </tr>
            </thead>
            <tbody>
              {state.inventory.map((item) => (
                <tr key={item.id}>
                  <td>{t.app[item.crop]}</td>
                  <td>{item.qty}</td>
                  <td>
                    <button
                      type="button"
                      className="ops-btn ops-btn-sm"
                      title={t.warehouseExportValue(EXPORT_VALUE[item.crop])}
                      onClick={() => onExport(item.crop, 1)}
                    >
                      {t.warehouseExport} · {t.warehouseExportValue(EXPORT_VALUE[item.crop])}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CronPage({
  state,
  t,
  onRunCron,
  onToggleCron,
}: Pick<PageProps, "state" | "t" | "onRunCron" | "onToggleCron">) {
  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <h2>{t.cronTitle}</h2>
        <p className="ops-page-sub">{t.menuHint.cron}</p>
      </header>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>{t.cronColName}</th>
              <th>{t.cronColEnabled}</th>
              <th>{t.cronColLast}</th>
              <th>{t.cronColAction}</th>
            </tr>
          </thead>
          <tbody>
            {state.cron.map((job) => (
              <tr key={job.id}>
                <td>
                  <div className="ops-cron-name">{t.cronName[job.id]}</div>
                  <div className="ops-muted">{t.cronBlurb[job.id]}</div>
                </td>
                <td>
                  <button
                    type="button"
                    className={`ops-btn ops-btn-sm ${job.enabled ? "ops-btn-ok" : "ops-btn-ghost"}`}
                    onClick={() => onToggleCron(job.id)}
                  >
                    {job.enabled ? t.cronEnabled : t.cronDisabled}
                  </button>
                </td>
                <td>{formatTime(job.lastRunAt, t.cronNever)}</td>
                <td>
                  <button
                    type="button"
                    className="ops-btn ops-btn-sm"
                    onClick={() => onRunCron(job.id)}
                  >
                    {t.cronRun}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TerminalPage({
  state,
  t,
  termCleared,
  onTermClear,
  onTermCommand,
}: Pick<PageProps, "state" | "t" | "termCleared" | "onTermClear" | "onTermCommand">) {
  const [input, setInput] = useState("");
  const [extra, setExtra] = useState<string[]>([]);

  const logLines = termCleared ? [] : state.logs;
  const body =
    extra.length > 0 || logLines.length > 0
      ? [
          ...extra,
          ...logLines.map((l) => {
            const ts = new Date(l.at).toISOString().slice(11, 19);
            return `[${ts}] ${l.level.padEnd(4)} ${l.text}`;
          }),
        ].join("\n")
      : "# empty · type help";

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const line = input.trim();
    if (!line) return;
    setInput("");
    const echo = onTermCommand(line);
    if (echo.includes("__CLEAR__")) {
      onTermClear();
      setExtra([]);
      return;
    }
    if (echo.length) {
      setExtra((prev) => [...echo, ...prev].slice(0, 120));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className="ops-page">
      <header className="ops-page-head ops-page-head-row">
        <div>
          <h2>{t.terminalTitle}</h2>
          <p className="ops-page-sub">{t.terminalHint}</p>
        </div>
        <button
          type="button"
          className="ops-btn ops-btn-ghost"
          onClick={() => {
            onTermClear();
            setExtra([]);
          }}
        >
          {t.terminalClear}
        </button>
      </header>
      <pre className="ops-terminal" aria-live="polite">
        {body}
      </pre>
      <form className="ops-term-form" onSubmit={submit}>
        <label className="ops-term-prompt" htmlFor="ops-term-input">
          {t.terminalPrompt}$
        </label>
        <input
          id="ops-term-input"
          className="ops-term-input"
          value={input}
          placeholder={t.terminalPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="ops-btn ops-btn-sm">
          {t.terminalRun}
        </button>
      </form>
    </div>
  );
}

export function SettingsPage({
  state,
  t,
  onExportSave,
  onImportSave,
  onResetSave,
  onToggleCompact,
  onToggleDebug,
  settingsFlash,
}: Pick<
  PageProps,
  | "state"
  | "t"
  | "onExportSave"
  | "onImportSave"
  | "onResetSave"
  | "onToggleCompact"
  | "onToggleDebug"
  | "settingsFlash"
>) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <h2>{t.settingsTitle}</h2>
        <p className="ops-page-sub">{t.menuHint.settings}</p>
      </header>

      {settingsFlash ? <p className="ops-settings-flash">{settingsFlash}</p> : null}

      <section className="ops-panel ops-settings-block">
        <h3>{t.settingsSaveTitle}</h3>
        <p className="ops-muted">{t.settingsSaveHint}</p>
        <div className="ops-quick-row">
          <button type="button" className="ops-btn" onClick={onExportSave}>
            {t.settingsExport}
          </button>
          <button type="button" className="ops-btn" onClick={() => fileRef.current?.click()}>
            {t.settingsImport}
          </button>
          <button
            type="button"
            className="ops-btn ops-btn-ghost"
            onClick={() => {
              if (window.confirm(t.settingsResetConfirm)) onResetSave();
            }}
          >
            {t.settingsReset}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onImportSave(file);
          }}
        />
      </section>

      <section className="ops-panel ops-settings-block">
        <h3>{t.settingsPrefsTitle}</h3>
        <label className="ops-toggle-row">
          <input
            type="checkbox"
            checked={state.prefs.compact}
            onChange={onToggleCompact}
          />
          <span>
            <strong>{t.settingsCompact}</strong>
            <small className="ops-muted">{t.settingsCompactHint}</small>
          </span>
        </label>
        <label className="ops-toggle-row">
          <input
            type="checkbox"
            checked={state.prefs.showDebug}
            onChange={onToggleDebug}
          />
          <span>
            <strong>{t.settingsDebug}</strong>
            <small className="ops-muted">{t.settingsDebugHint}</small>
          </span>
        </label>
      </section>

      <section className="ops-panel ops-settings-block">
        <h3>{t.settingsAboutTitle}</h3>
        <p className="ops-settings-about">{t.settingsAboutBody(PANEL_VERSION)}</p>
      </section>
    </div>
  );
}
