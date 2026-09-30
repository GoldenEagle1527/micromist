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
export { tidePortOf, type TidePort, type TideTimeline } from "./platform/tidePort";
export type { TideView, TideInput, DomeZone, FateState, GenerationSummary, TideStart } from "./tide/port";
export type { TideState, TideEvent, TideFallback, TidePhase } from "./tide/frame";
export type { Biome } from "./config";
export type { SiteTable, Site } from "./world/siteTable";
export type { WallState } from "./chaos/wallModel";
export type { ChaosView, ChaosCrackView } from "./chaos/view";
export type { ChaosStage } from "./chaos/model";
export { diveChaosOf, type DiveChaos } from "./platform/diveChaos";
export type { BasePort, BaseView, BaseBuilding, BaseAction, StructureInfo, StructureKind, PlacementReason, WorldRect, TideReadiness, TideForecast } from "./base/port";
export type { ExpeditionPort, ExpeditionNode, ExpeditionCache, FlowResult, NodeSurface } from "./expedition/port";
export { withWorldSaveStep } from "./loading/worldSaveStep";
export type { OpenReport } from "./session/openReport";
