/**
 * The chaos a dive draws (MVP plan M8): the generation's own, or a staging
 * preview (chaos/preview.ts, chosen in the debug panel) built for this world and base — as the scene's view
 * (chaos/view.ts) and the terrain's wall (thickness, open cracks, anomaly). Never written
 * to the save: the session keeps its chaos for the forecast and the tide.
 * The debug panel's 异常地形 preview (forceAnomaly) bakes the anomalous terrain at
 * full strength around the open cracks; with none open it previews stage 2 with two.
 */
import { previewChaos, type ChaosPreviewSpec } from "../chaos/preview";
import { ringOf } from "../chaos/ring";
import { chaosViewOf, type ChaosView } from "../chaos/view";
import { wallStateOfChaos, type WallState } from "../chaos/wallModel";
import type { ConserveSession } from "../session/conserveSession";

export type DiveChaos = { view: ChaosView; wall: WallState };

/** The anomaly preview's chaos when the generation has no open crack. */
const ANOMALY_SPEC: ChaosPreviewSpec = { stage: 2, cracks: 2, scar: false };

/** spec: the debug panel's preview for this dive (scene/dive/params.ts), null = the generation's own. */
export function diveChaosOf(session: ConserveSession, spec: ChaosPreviewSpec | null, forceAnomaly = false): DiveChaos {
  const own = !spec && !(forceAnomaly && !session.chaos.cracks.some((k) => k.open));
  const dc = own ? ownChaos(session) : previewOf(session, spec ?? ANOMALY_SPEC);
  return forceAnomaly ? { ...dc, wall: { ...dc.wall, anomaly: 1 } } : dc;
}

function ownChaos(session: ConserveSession): DiveChaos {
  const table = session.siteTable;
  return { view: chaosViewOf(session.chaos, { sitesX: table.sitesX, sitesZ: table.sitesZ }), wall: session.wall };
}

function previewOf(session: ConserveSession, spec: ChaosPreviewSpec): DiveChaos {
  const table = session.siteTable;
  const size = { sitesX: table.sitesX, sitesZ: table.sitesZ };
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
