import { useCallback, useEffect, useMemo, useState } from "react";
import "./ops.css";
import { useLocale } from "../../i18n";
import { clearLocalProgress, useLocalGamePersist } from "../local-persist";
import {
  buySeed,
  createInitialState,
  normalizeState,
  plantOnPlot,
  runCron,
  setPage,
  toggleCron,
  toggleSidebar,
} from "./engine";
import { OPS_MENU } from "./menu";
import {
  CronPage,
  DashboardPage,
  PlotsPage,
  SettingsPage,
  ShopPage,
  TerminalPage,
  WarehousePage,
} from "./pages";
import { SLUG, type CropId, type OpsPageId, type OpsState } from "./types";

type Screen = "setup" | "panel";

const MOBILE_MQ = "(max-width: 820px)";

function isMobileViewport(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_MQ).matches;
}

export function OpsGame() {
  const { t } = useLocale();
  const op = t.ops;

  const [screen, setScreen] = useState<Screen>("setup");
  const [state, setState] = useState<OpsState>(() => createInitialState());
  const [hasSave, setHasSave] = useState(false);
  const [termCleared, setTermCleared] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const persistState = screen === "panel" ? state : null;
  const { clear: clearProgress } = useLocalGamePersist<OpsState>(SLUG, persistState, {
    shouldSave: () => true,
    onHydrate: (saved) => {
      const fixed = normalizeState(saved);
      if (!fixed) return;
      setState(fixed);
      setHasSave(true);
    },
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => {
      if (!mq.matches) setMobileNavOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const enterFresh = useCallback(() => {
    clearProgress();
    clearLocalProgress(SLUG);
    const fresh = createInitialState();
    setState(fresh);
    setHasSave(false);
    setTermCleared(false);
    setMobileNavOpen(false);
    setScreen("panel");
  }, [clearProgress]);

  const enterResume = useCallback(() => {
    setTermCleared(false);
    setMobileNavOpen(false);
    setScreen("panel");
  }, []);

  const exitPanel = useCallback(() => {
    setMobileNavOpen(false);
    setScreen("setup");
    setHasSave(true);
  }, []);

  const patch = useCallback((fn: (s: OpsState) => OpsState) => {
    setState((s) => fn(s));
    setTermCleared(false);
  }, []);

  const goPage = useCallback(
    (page: OpsPageId) => {
      patch((s) => setPage(s, page));
      setTermCleared(false);
      setMobileNavOpen(false);
    },
    [patch],
  );

  const onMenuButton = useCallback(() => {
    if (isMobileViewport()) {
      setMobileNavOpen((open) => !open);
      return;
    }
    patch((s) => toggleSidebar(s));
  }, [patch]);

  const pageBody = useMemo(() => {
    const common = {
      state,
      t: op,
      onBuy: (crop: CropId) => patch((s) => buySeed(s, crop)),
      onPlant: (plotId: string, crop: CropId) => patch((s) => plantOnPlot(s, plotId, crop)),
      onRunCron: (id: OpsState["cron"][number]["id"]) => patch((s) => runCron(s, id)),
      onToggleCron: (id: OpsState["cron"][number]["id"]) => patch((s) => toggleCron(s, id)),
    };
    switch (state.page) {
      case "dashboard":
        return <DashboardPage state={state} t={op} />;
      case "plots":
        return <PlotsPage {...common} />;
      case "shop":
        return <ShopPage {...common} />;
      case "warehouse":
        return <WarehousePage state={state} t={op} />;
      case "cron":
        return <CronPage {...common} />;
      case "terminal":
        return (
          <TerminalPage
            state={state}
            t={op}
            cleared={termCleared}
            onClear={() => setTermCleared(true)}
          />
        );
      case "settings":
        return <SettingsPage t={op} />;
      default:
        return null;
    }
  }, [state, op, patch, termCleared]);

  if (screen === "setup") {
    return (
      <section className="ops-setup">
        <div className="ops-setup-card">
          <p className="ops-setup-kicker">micromist · solo</p>
          <h1>{op.setupTitle}</h1>
          <p className="lede">{op.setupHint}</p>
          <div className="ops-setup-actions">
            <button type="button" className="ops-btn ops-btn-primary" onClick={enterFresh}>
              {hasSave ? op.setupReset : op.setupStart}
            </button>
            {hasSave ? (
              <button type="button" className="ops-btn" onClick={enterResume}>
                {op.setupResume}
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const collapsed = state.sidebarCollapsed;
  const menuAria = mobileNavOpen
    ? op.collapseSidebar
    : collapsed
      ? op.expandSidebar
      : op.collapseSidebar;

  return (
    <div
      className={[
        "ops-shell",
        collapsed ? "ops-shell-collapsed" : "",
        mobileNavOpen ? "ops-shell-mobile-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="ops-backdrop"
        aria-label={op.collapseSidebar}
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside className="ops-sidebar" aria-label={op.brand} id="ops-sidebar-nav">
        <div className="ops-brand">
          <span className="ops-brand-mark" aria-hidden>
            ◆
          </span>
          <div className="ops-brand-text">
            <strong>{op.brand}</strong>
            <span>{op.brandSub}</span>
          </div>
        </div>
        <nav className="ops-nav">
          {OPS_MENU.map((item) => {
            const active = state.page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`ops-nav-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={`${op.menu[item.id]} · ${op.menuHint[item.id]}`}
                onClick={() => goPage(item.id)}
              >
                <span className="ops-nav-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="ops-nav-label">
                  <span>{op.menu[item.id]}</span>
                  <small>{op.menuHint[item.id]}</small>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="ops-main">
        <header className="ops-topbar">
          <div className="ops-topbar-left">
            <button
              type="button"
              className="ops-icon-btn"
              aria-label={menuAria}
              aria-expanded={mobileNavOpen || !collapsed}
              aria-controls="ops-sidebar-nav"
              onClick={onMenuButton}
            >
              ☰
            </button>
            <div className="ops-crumb">
              <span>{op.menu[state.page]}</span>
              <small>{op.menuHint[state.page]}</small>
            </div>
          </div>
          <div className="ops-topbar-right">
            <span className="ops-chip ops-chip-ok">{op.statusOnline}</span>
            <span className="ops-chip ops-chip-uptime">{op.statusUptime(state.day)}</span>
            <span className="ops-chip ops-chip-coin">{op.coins(state.coins)}</span>
            <button type="button" className="ops-btn ops-btn-ghost ops-btn-sm" onClick={exitPanel}>
              {op.exitPanel}
            </button>
          </div>
        </header>
        <main className="ops-content">{pageBody}</main>
      </div>
    </div>
  );
}
