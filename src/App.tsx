import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { EmbedBridge } from "./components/EmbedBridge";
import { Shell } from "./components/Shell";
import { useLocale } from "./i18n";
import {
  hasEmbedFlag,
  hrefOf,
  isCatalogPlayPath,
  isEmbeddedFrame,
  isGameEmbedSession,
} from "./lib/embed";
import { ensureLocalDbReady } from "./lib/game-store";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlayPage } from "./pages/PlayPage";

function PlayFallback() {
  return <PlayPage />;
}

function shouldRenderChromeLess(pathname: string, search: string): boolean {
  if (!isEmbeddedFrame()) return false;
  return hasEmbedFlag(search) || isCatalogPlayPath(pathname);
}

function ChromeLessApp() {
  const { t } = useLocale();
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.embed = "game";
    let cancelled = false;
    void ensureLocalDbReady().then(() => {
      if (!cancelled) setDbReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!dbReady) {
    return <p className="lede">{t.loading}</p>;
  }

  return (
    <div className="embed-root">
      {isGameEmbedSession() ? <EmbedBridge /> : null}
      <Routes>
        <Route path="play/:slug" element={<PlayFallback />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}

function TopLevelApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const chromeLess = shouldRenderChromeLess(location.pathname, location.search);

  useEffect(() => {
    if (isEmbeddedFrame()) return;
    if (!hasEmbedFlag(location.search)) return;
    const next = hrefOf(location.pathname, location.search, location.hash);
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (next === current) return;
    // Top-level ?embed=1 is a normal shareable game URL — drop the flag.
    navigate(next, { replace: true });
  }, [location, navigate]);

  useEffect(() => {
    if (chromeLess) {
      document.documentElement.dataset.embed = "game";
    } else {
      delete document.documentElement.dataset.embed;
    }
  }, [chromeLess]);

  if (chromeLess) {
    return <ChromeLessApp />;
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={null} />
        <Route path="play/:slug" element={<PlayFallback />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  if (isGameEmbedSession()) {
    return <ChromeLessApp />;
  }
  return <TopLevelApp />;
}
