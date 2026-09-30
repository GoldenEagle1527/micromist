/**
 * The chaos a dive draws (MVP plan M8): the generation's own, or a staging
 * preview (chaos/preview.ts, chosen in the debug panel) built for this world and base — as the scene's view
 * (chaos/view.ts) and the terrain's wall (thickness, open cracks). Never written
 * to the save: the session keeps its chaos for the forecast and the tide.
 */
import { previewChaos, type ChaosPreviewSpec } from "../chaos/preview";
import { ringOf } from "../chaos/ring";
import { chaosViewOf, type ChaosView } from "../chaos/view";
import { wallStateOfChaos, type WallState } from "../chaos/wallModel";
import type { ConserveSession } from "../session/conserveSession";

export type DiveChaos = { view: ChaosView; wall: WallState };

/** spec: the debug panel's preview for this dive (scene/dive/params.ts), null = the generation's own. */
export function diveChaosOf(session: ConserveSession, spec: ChaosPreviewSpec | null): DiveChaos {
  const table = session.siteTable;
  const size = { sitesX: table.sitesX, sitesZ: table.sitesZ };
  if (!spec) return { view: chaosViewOf(session.chaos, size), wall: session.wall };
  const c = session.base.view().center;
  const chaos = previewChaos(spec, {
    gen: session.gen,
    seed: session.seed,
    ring: ringOf(size),
    base: c ? { x: c[0], z: c[2] } : null,
    siteHarvest: new Array<number>(table.sites.length).fill(0),
  });
  return { view: chaosViewOf(chaos, size, true), wall: wallStateOfChaos(chaos) };
}
