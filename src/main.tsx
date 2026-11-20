import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { LocaleProvider } from "./i18n";
import {
  applyResolvedTheme,
  readStoredTheme,
  resolveTheme,
} from "./theme/applyTheme";
import "./index.css";

applyResolvedTheme(resolveTheme(readStoredTheme()));

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
);
