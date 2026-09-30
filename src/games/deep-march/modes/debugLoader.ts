/**
 * The only door into debug/ (the staging debug panel): a dynamic import behind a
 * build-time gate. `vite build` (production mode: `npm run build` / `deploy`)
 * folds the condition to false, so the import, its chunk and every panel string
 * are dropped from the bundle; `deploy:staging` builds with `--mode staging`
 * and `vite` dev runs in development mode, both keeping it. A staging build
 * opened on the production host still shows no panel (siteKind).
 */
import { useEffect, useState } from "react";
import { siteKind } from "../../../lib/sites";

export type DebugModule = typeof import("../debug");

export function loadDebug(): Promise<DebugModule> | null {
  return import.meta.env.MODE !== "production" && siteKind() !== "prod" ? import("../debug") : null;
}

/** The debug module once loaded (null in production builds, on the production host, or while loading). */
export function useDebugModule(): DebugModule | null {
  const [mod, setMod] = useState<DebugModule | null>(null);
  useEffect(() => {
    let live = true;
    loadDebug()?.then(
      (m) => live && setMod(() => m),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return mod;
}
