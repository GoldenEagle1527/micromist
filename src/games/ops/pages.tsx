import { useMemo, useState } from "react";
import type { OpsDict } from "./i18n";
import { dashboardStats } from "./engine";
import { CROP_ORDER, SEED_PRICE, type CropId, type OpsState } from "./types";

type PageProps = {
  state: OpsState;
  t: OpsDict;
  onBuy: (crop: CropId) => void;
  onPlant: (plotId: string, crop: CropId) => void;
  onRunCron: (id: OpsState["cron"][number]["id"]) => void;
  onToggleCron: (id: OpsState["cron"][number]["id"]) => void;
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

export function DashboardPage({ state, t }: Pick<PageProps, "state" | "t">) {
  const stats = useMemo(() => dashboardStats(state), [state]);
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

export function PlotsPage({ state, t, onPlant }: PageProps) {
  const [picking, setPicking] = useState<string | null>(null);
  const available = CROP_ORDER.filter((c) => state.seeds[c] > 0);

  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <h2>{t.plotsTitle}</h2>
        <p className="ops-page-sub">{t.menuHint.plots}</p>
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
                </td>
                <td>
                  <StatusPill status={plot.status} label={t.status[plot.status]} />
                </td>
                <td>{plot.crop ? t.crop[plot.crop] : "—"}</td>
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
                              {t.crop[crop]} ({state.seeds[crop]})
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
                    <span className="ops-muted">—</span>
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

export function ShopPage({ state, t, onBuy }: PageProps) {
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
              <h3>{t.crop[crop]}</h3>
              <p className="ops-muted">{t.cropBlurb[crop]}</p>
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

export function WarehousePage({ state, t }: Pick<PageProps, "state" | "t">) {
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
              </tr>
            </thead>
            <tbody>
              {state.inventory.map((item) => (
                <tr key={item.id}>
                  <td>{t.crop[item.crop]}</td>
                  <td>{item.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CronPage({ state, t, onRunCron, onToggleCron }: PageProps) {
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
  cleared,
  onClear,
}: Pick<PageProps, "state" | "t"> & { cleared: boolean; onClear: () => void }) {
  const lines = cleared ? [] : state.logs;
  return (
    <div className="ops-page">
      <header className="ops-page-head ops-page-head-row">
        <div>
          <h2>{t.terminalTitle}</h2>
          <p className="ops-page-sub">{t.terminalHint}</p>
        </div>
        <button type="button" className="ops-btn ops-btn-ghost" onClick={onClear}>
          {t.terminalClear}
        </button>
      </header>
      <pre className="ops-terminal" aria-live="polite">
        {lines.length === 0
          ? "# empty"
          : lines
              .map((l) => {
                const ts = new Date(l.at).toISOString().slice(11, 19);
                return `[${ts}] ${l.level.padEnd(4)} ${l.text}`;
              })
              .join("\n")}
      </pre>
    </div>
  );
}
