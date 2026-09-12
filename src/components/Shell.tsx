import { useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useMatch } from "react-router";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";
import { useTheme } from "../hooks/useTheme";
import {
  isFloatEmbed,
  openAdDocumentPip,
  supportsDocumentPip,
} from "../lib/document-pip";
import { LocalDataModal } from "./LocalDataModal";
import { ensureLocalDbReady } from "../lib/game-store";
import { siteKind, switchSiteHref } from "../lib/sites";

function ThemeIcon({ mode }: { mode: "light" | "dark" | "system" }) {
  if (mode === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-5.14-7.5A8.96 8.96 0 0 0 12 3z" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5h1v3h-2V2h1zm0 17h1v3h-2v-3h1zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4L4.2 5.6zm12.1 12.1 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4zM2 11h3v2H2v-2zm17 0h3v2h-3v-2zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4zm12.1-12.1 2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20V2zm0 2v16a8 8 0 0 0 0-16z" />
    </svg>
  );
}

function AboutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
    </svg>
  );
}

function FloatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 7h-8v6h8V7zm-2 4h-4V9h4v2zm4-8H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2zM2 4v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2zm2 0h16v16H4V4z" />
    </svg>
  );
}

export function Shell() {
  const { mode, cycleMode } = useTheme();
  const { locale, t, toggleLocale } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [floatBusy, setFloatBusy] = useState(false);
  const inFloat = isFloatEmbed();
  const canFloat = !inFloat && supportsDocumentPip();
  useEffect(() => {
    let cancelled = false;
    void ensureLocalDbReady().then(() => {
      if (!cancelled) setDbReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const aboutTitleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const playMatch = useMatch("/play/:slug");
  const isHome = useMatch({ path: "/", end: true });
  const playGame = playMatch?.params.slug
    ? getGame(playMatch.params.slug)
    : undefined;
  const themeLabel =
    mode === "system" ? t.themeSystem : mode === "light" ? t.themeLight : t.themeDark;
  const langButtonLabel = locale === "zh" ? "EN" : "中";
  const langRowLabel = locale === "zh" ? "中文 / EN" : "English / 中";
  const kind = siteKind();
  const switchHref = switchSiteHref(kind);
  const switchLabel =
    kind === "staging"
      ? t.aboutSwitchToProd
      : kind === "prod"
        ? t.aboutSwitchToStaging
        : t.aboutOpenStaging;

  useEffect(() => {
    if (!aboutOpen && !menuOpen && !storageOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (storageOpen) setStorageOpen(false);
      else if (aboutOpen) setAboutOpen(false);
      else if (menuOpen) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aboutOpen, menuOpen, storageOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!aboutOpen) return;
    closeBtnRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [aboutOpen]);

  const openAbout = () => {
    setMenuOpen(false);
    setAboutOpen(true);
  };

  const openStorage = () => {
    setMenuOpen(false);
    setAboutOpen(false);
    setStorageOpen(true);
  };

  const openFloat = async () => {
    setMenuOpen(false);
    if (!supportsDocumentPip()) {
      window.alert(t.floatUnsupported);
      return;
    }
    if (floatBusy) return;
    setFloatBusy(true);
    try {
      await openAdDocumentPip({
        adBadge: t.floatAdBadge,
        adTitle: t.floatAdTitle,
        unsupported: t.floatUnsupported,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.floatUnsupported;
      window.alert(msg);
    } finally {
      setFloatBusy(false);
    }
  };

  if (!dbReady) {
    return (
      <div className="shell">
        <main className="main" style={{ padding: "2rem", textAlign: "center" }}>
          <p className="hint">{t.loading}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-zh">{t.brand}</span>
          {locale === "zh" ? <span className="brand-en">{t.brandSub}</span> : null}
        </NavLink>
        {kind === "staging" ? (
          <span className="staging-badge" title={t.stagingBadgeAria} aria-label={t.stagingBadgeAria}>
            {t.stagingBadge}
          </span>
        ) : null}
        {playGame ? (
          <div className="topbar-game" aria-current="page">
            {playGame.title[locale]}
          </div>
        ) : (
          <div className="topbar-game topbar-game-empty" aria-hidden="true" />
        )}
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn lang-btn desktop-only"
            onClick={toggleLocale}
            aria-label={t.langAria}
            title={t.langTitle}
          >
            <span className="lang-btn-label">{langButtonLabel}</span>
          </button>
          <button
            type="button"
            className="icon-btn desktop-only"
            onClick={cycleMode}
            aria-label={t.themeAria(themeLabel)}
            title={themeLabel}
          >
            <ThemeIcon mode={mode} />
          </button>
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={t.menuAria}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {menuOpen ? (
                <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
              ) : (
                <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
              )}
            </svg>
          </button>
          {canFloat ? (
            <button
              type="button"
              className="icon-btn desktop-only"
              onClick={() => void openFloat()}
              aria-label={t.floatAria}
              title={t.floatTitle}
              disabled={floatBusy}
            >
              <FloatIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn desktop-only"
            onClick={openStorage}
            aria-label={t.storageAria}
            title={t.storageAria}
          >
            <StorageIcon />
          </button>
          <button
            type="button"
            className="icon-btn desktop-only"
            onClick={() => setAboutOpen(true)}
            aria-label={t.aboutAria}
            title={t.aboutAria}
          >
            <AboutIcon />
          </button>
        </div>
      </header>

      <button
        type="button"
        className={`mobile-nav-backdrop${menuOpen ? " open" : ""}`}
        aria-label={t.menuAria}
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />
      <nav
        id="mobile-nav"
        className={`mobile-nav${menuOpen ? " open" : ""}`}
        aria-label={t.menuAria}
        aria-hidden={!menuOpen}
      >
        <button
          type="button"
          className="mobile-nav-header"
          onClick={() => setMenuOpen(false)}
        >
          <svg className="mobile-nav-back-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
          <span className="mobile-nav-back-label">{t.menuBack}</span>
        </button>
        <div className="mobile-nav-body">
        <button type="button" className="mobile-nav-item" onClick={toggleLocale}>
          <span className="mobile-nav-item-label">{t.langAria}</span>
          <span className="mobile-nav-item-value">{langRowLabel}</span>
        </button>
        <button
          type="button"
          className="mobile-nav-item"
          onClick={cycleMode}
          aria-label={t.themeAria(themeLabel)}
        >
          <span className="mobile-nav-item-label">{themeLabel}</span>
          <span className="mobile-nav-item-icon" aria-hidden="true">
            <ThemeIcon mode={mode} />
          </span>
        </button>
        {canFloat ? (
          <button
            type="button"
            className="mobile-nav-item"
            onClick={() => void openFloat()}
            disabled={floatBusy}
          >
            <span className="mobile-nav-item-label">{t.floatTitle}</span>
            <span className="mobile-nav-item-icon" aria-hidden="true">
              <FloatIcon />
            </span>
          </button>
        ) : null}
        <button type="button" className="mobile-nav-item" onClick={openStorage}>
          <span className="mobile-nav-item-label">{t.storageAria}</span>
          <span className="mobile-nav-item-icon" aria-hidden="true">
            <StorageIcon />
          </span>
        </button>
        <button type="button" className="mobile-nav-item" onClick={openAbout}>
          <span className="mobile-nav-item-label">{t.aboutAria}</span>
          <span className="mobile-nav-item-icon" aria-hidden="true">
            <AboutIcon />
          </span>
        </button>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>

      {isHome ? (
        <footer className="footer">
          <span>{t.footer}</span>
          <a href="https://github.com/GoldenEagle1527/micromist">GitHub</a>
        </footer>
      ) : null}

      <LocalDataModal
        open={storageOpen}
        onClose={() => setStorageOpen(false)}
        locale={locale}
        t={t}
      />

      {aboutOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={aboutTitleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id={aboutTitleId}>{t.aboutTitle}</h2>
              <button
                ref={closeBtnRef}
                type="button"
                className="icon-btn"
                onClick={() => setAboutOpen(false)}
                aria-label={t.aboutClose}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z" />
                </svg>
              </button>
            </div>
            <p className="lede modal-body">{t.aboutBody}</p>
            <div className="modal-actions">
              {switchHref ? (
                <a href={switchHref} className="ghost about-site-switch">
                  {switchLabel}
                </a>
              ) : null}
              <a
                href="https://github.com/GoldenEagle1527/micromist"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <button
                type="button"
                className="primary"
                onClick={() => setAboutOpen(false)}
              >
                {t.aboutClose}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
