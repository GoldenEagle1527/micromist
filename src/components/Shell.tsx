import { useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useMatch } from "react-router";
import { getGame } from "../games/catalog";
import { useLocale } from "../i18n";
import { useTheme } from "../hooks/useTheme";

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

export function Shell() {
  const { mode, cycleMode } = useTheme();
  const { locale, t, toggleLocale } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutTitleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const playMatch = useMatch("/play/:slug");
  const playGame = playMatch?.params.slug
    ? getGame(playMatch.params.slug)
    : undefined;
  const themeLabel =
    mode === "system" ? t.themeSystem : mode === "light" ? t.themeLight : t.themeDark;
  const langButtonLabel = locale === "zh" ? "EN" : "中";
  const langRowLabel = locale === "zh" ? "中文 / EN" : "English / 中";

  useEffect(() => {
    if (!aboutOpen && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (aboutOpen) setAboutOpen(false);
      else if (menuOpen) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aboutOpen, menuOpen]);

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

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-zh">{t.brand}</span>
          {locale === "zh" ? <span className="brand-en">{t.brandSub}</span> : null}
        </NavLink>
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

      <nav
        id="mobile-nav"
        className={`mobile-nav${menuOpen ? " open" : ""}`}
        aria-label={t.menuAria}
      >
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
        <button type="button" className="mobile-nav-item" onClick={openAbout}>
          <span className="mobile-nav-item-label">{t.aboutAria}</span>
          <span className="mobile-nav-item-icon" aria-hidden="true">
            <AboutIcon />
          </span>
        </button>
      </nav>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <span>{t.footer}</span>
        <a href="https://github.com/GoldenEagle1527/micromist">GitHub</a>
      </footer>

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
