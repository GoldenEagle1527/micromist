/**
 * Staging debug panel (replaces the old URL debug switches). Loaded only through
 * modes/debugLoader.ts, which production builds fold to null — no chunk, no
 * strings, no panel there (test:modes checks the bundle). See README.md.
 */
export { DebugPanel } from "./ui/DebugPanel";
export { createDebugPort } from "./port";
