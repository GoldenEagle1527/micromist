/**
 * What the shared scene sees of an expedition (plan M4): the nodes to place and
 * draw, the tank, absorbing, lost caches and death. The scene imports these
 * types only (type-only, erased); the object comes through modes/ from the
 * conserve chunk, so the free dive never loads any of it.
 */
import type { NodeSurface } from "../config";

export type { NodeSurface };

export type ExpeditionNode = {
  id: number;
  /** Site index (row-major, = the terrain layout's site index). */
  site: number;
  /** Particle kind (storage index: 0 lithic, 1 silica, 2 lumen, 3 ferro, …). */
  kind: number;
  /** Particles at the start of the generation. */
  amount: number;
  surface: NodeSurface;
  /** uint32 seed of the node's deterministic surface search. */
  hash: number;
};

export type ExpeditionCache = {
  id: number;
  /** World position (metres). */
  pos: readonly [number, number, number];
  /** Particles still in it. */
  total: number;
};

export type FlowResult = {
  /** Particles moved into the tank this step. */
  moved: number;
  /** Left in the node / cache. */
  left: number;
  /** Nothing moved because the tank is full. */
  full: boolean;
};

export interface ExpeditionPort {
  readonly tankCapacity: number;
  readonly sitesX: number;
  readonly sitesZ: number;
  /** This generation's nodes of one site (fixed until the next tide). */
  siteNodes(site: number): readonly ExpeditionNode[];
  remaining(nodeId: number): number;
  /** Particles in the tank (ledger pool P). */
  carried(): number;
  /** A tide is running: absorbing and retrieving are refused (M7). */
  readonly isLocked: boolean;
  /** Hold-to-absorb step on a node: W → P. */
  absorb(nodeId: number, dt: number): FlowResult;
  caches(): readonly ExpeditionCache[];
  /** Hold-to-retrieve step on a lost cache: L → P. */
  retrieve(cacheId: number, dt: number): FlowResult;
  /** The hold ended: fractional progress is dropped. */
  release(): void;
  /** Death: everything carried becomes a lost cache at `pos` (P → L); null when the tank was empty. */
  loseCarried(pos: readonly [number, number, number]): ExpeditionCache | null;
  /** Changes on every node, tank or cache change (the scene refreshes on a new value). */
  revision(): number;
}
