import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router";
import { App } from "./App";
import { LocaleProvider } from "./i18n";
import {
  applyResolvedTheme,
  readStoredTheme,
  resolveTheme,
} from "./theme/applyTheme";
import { hrefOf, isGameEmbedSession, locationFromWindow } from "./lib/embed";
import { ensureLocalDbReady } from "./lib/game-store";
import "./index.css";

applyResolvedTheme(resolveTheme(readStoredTheme()));

const gameEmbed = isGameEmbedSession();
if (gameEmbed) {
  document.documentElement.dataset.embed = "game";
  void ensureLocalDbReady();
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

const loc = locationFromWindow();
const embedEntry = hrefOf(loc.pathname, loc.search, loc.hash) || "/";

createRoot(root).render(
  <StrictMode>
    {gameEmbed ? (
      <MemoryRouter initialEntries={[embedEntry]}>
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </MemoryRouter>
    ) : (
      <BrowserRouter>
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
