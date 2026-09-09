import { NavLink, Outlet } from "react-router";

export function Shell() {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-zh">微渺</span>
          <span className="brand-en">micromist</span>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            游戏 Games
          </NavLink>
          <NavLink to="/rooms">房间 Rooms</NavLink>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>开源 MIT · Workers Static Assets · 不持久化账号</span>
        <a href="https://github.com/GoldenEagle1527/micromist">GitHub</a>
      </footer>
    </div>
  );
}
