/**
 * Conserve worlds only: the tide's director wired into the dive (world.ts).
 * The generation-bound parts (terrain, field, conserve layer, HUD lookups,
 * wall ring) live in the loop's and the handle's parts; the switch rebinds them
 * there, so every reader sees gen + 1 from the next frame on. The free dive
 * never calls this.
 */
import type * as THREE from "three";
import type { TidePort } from "../../conserve";
import type { DensityField } from "../../terrain/density";
import { TideDirector, type GenerationSlots, type TideDirectorDeps } from "../tide/tideDirector";
import type { WallRing } from "../wallRing";
import type { DiveParts } from "./diveLoop";
import type { HandleParts } from "./handle";
import { HudChips } from "./hudChips";

export type TideWiring = Omit<TideDirectorDeps, "port" | "get" | "bind" | "start" | "pxPerM"> & {
  port: TidePort;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  simple: boolean;
  /** A wall ring for the field (added to the scene), or null. */
  wallRing: (field: DensityField) => WallRing | null;
  /** The loop's and the handle's parts (both exist before the first tide frame). */
  parts: () => { loop: DiveParts; handle: HandleParts };
};

export function createTideDirector(w: TideWiring): TideDirector {
  const memory = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory;
  const get = (): GenerationSlots => {
    const { loop, handle } = w.parts();
    return { field: handle.field, chunks: loop.chunks, conserve: loop.conserve };
  };
  const bind = (g: GenerationSlots) => {
    const { loop, handle } = w.parts();
    if (g.field !== handle.field) {
      loop.hud = handle.hud = new HudChips(g.chunks.terrain, g.field.regions);
      loop.wallRing?.mesh.removeFromParent();
      loop.wallRing?.dispose();
      loop.wallRing = w.wallRing(g.field);
    }
    loop.chunks = handle.chunks = g.chunks;
    loop.conserve = handle.conserve = g.conserve;
    handle.field = g.field;
  };
  return new TideDirector({
    ...w,
    start: { simple: w.simple, lowMemory: memory !== undefined && memory <= w.port.lowMemoryGB },
    // point size: pixels per metre at 1 m (drawing-buffer height over the view's height at 1 m)
    pxPerM: () => w.renderer.domElement.height / (2 * Math.tan((w.camera.fov * Math.PI) / 360)),
    get,
    bind,
  });
}
