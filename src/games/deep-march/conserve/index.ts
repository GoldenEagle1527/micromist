/**
 * Conserve mode ("深潜·守恒") public entry. Loaded only with a dynamic import
 * (modes/conserveLoader.ts), so none of this is in the free-dive bundle
 * (test:modes checks it). See README.md for the module map and data flow.
 */
export { createGameStoreBackend } from "./platform/gameStoreBackend";
export { openConserveSession, type OpenIntent, type OpenOutcome } from "./session/openSession";
export type { ConserveSession } from "./session/conserveSession";
export { peekWorldSlot, type SlotSummary } from "./session/peekSlot";
export { flushOnPageHide } from "./platform/pageLifecycle";
export { terrainLayoutOf } from "./platform/terrainLayout";
export type { SiteTable, Site } from "./world/siteTable";
export { withWorldSaveStep } from "./loading/worldSaveStep";
export type { OpenReport } from "./session/openReport";
