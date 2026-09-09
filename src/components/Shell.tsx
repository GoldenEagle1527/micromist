import { useState } from "react";
import { NavLink, Outlet } from "react-router";
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

function GamesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
    </svg>
  );
}

function RoomsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

export function Shell() {
  const { mode, cycleMode } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const themeLabel =
    mode === "system" ? "跟随系统" : mode === "light" ? "浅色" : "深色";

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-zh">微渺</span>
          <span className="brand-en">micromist</span>
        </NavLink>
        <div className="topbar-actions">
          <nav className="nav" aria-label="主导航">
            <NavLink to="/" end>
              游戏
            </NavLink>
            <NavLink to="/rooms">房间</NavLink>
          </nav>
          <button
            type="button"
            className="icon-btn"
            onClick={cycleMode}
            aria-label={`主题：${themeLabel}，点击切换`}
            title={`主题：${themeLabel}`}
          >
            <ThemeIcon mode={mode} />
          </button>
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="打开菜单"
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
        </div>
      </header>

      <nav
        id="mobile-nav"
        className={`mobile-nav${menuOpen ? " open" : ""}`}
        aria-label="移动菜单"
      >
        <NavLink to="/" end onClick={() => setMenuOpen(false)}>
          游戏 Games
        </NavLink>
        <NavLink to="/rooms" onClick={() => setMenuOpen(false)}>
          房间 Rooms
        </NavLink>
      </nav>

      <main className="main">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="底部导航">
        <NavLink to="/" end>
          <GamesIcon />
          游戏
        </NavLink>
        <NavLink to="/rooms">
          <RoomsIcon />
          房间
        </NavLink>
      </nav>

      <footer className="footer">
        <span>开源 MIT · Workers Static Assets · 不持久化账号</span>
        <a href="https://github.com/GoldenEagle1527/micromist">GitHub</a>
      </footer>
    </div>
  );
}
