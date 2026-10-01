/**
 * Swapping columns without holes or pops (chunks.ts): a node that leaves the
 * wanted set stays drawn until the nodes replacing it are ready; replacement
 * meshes stay hidden until the whole footprint is ready, then they dither in while
 * the old ones dither out (chunkFade.ts). Top-level columns stay resident (hidden,
 * not freed) while their children are drawn, so coarsening back is instant.
 */
import { overlaps, type ChunkNode } from "./chunkNode";
import type { LodFader } from "./chunkFade";

export type SwapHost = {
  nodes: Map<string, ChunkNode>;
  levels: number;
  fader: LodFader;
  /** Loading screen up: swaps are instant. */
  loading: () => boolean;
  recycle: (n: ChunkNode) => void;
};

/**
 * Drop unwanted nodes once whatever replaces their footprint is ready: crossfade
 * them out against the (hidden until now) replacement meshes.
 */
export function retire(h: SwapHost) {
  const wantedMesh: ChunkNode[] = [];
  for (const n of h.nodes.values()) if (n.wanted && n.kind === "mesh") wantedMesh.push(n);
  for (const n of [...h.nodes.values()]) {
    if (n.wanted) continue;
    if (n.resident) {
      // hidden top-level column: freed only once nothing wanted overlaps it (out of range)
      if (!wantedMesh.some((w) => overlaps(w, n))) h.recycle(n);
      continue;
    }
    if (n.kind === "info" || n.state !== "ready" || !n.mesh) {
      h.recycle(n);
      continue;
    }
    if (n.fade < 0) continue; // already dissolving
    let covered = true;
    let overlap = false;
    for (const w of wantedMesh) {
      if (!overlaps(w, n)) continue;
      overlap = true;
      if (w.state !== "ready") {
        covered = false;
        break;
      }
    }
    if (!overlap) h.recycle(n);
    else if (covered) {
      const incoming = wantedMesh.filter((w) => w.awaitFade && overlaps(w, n));
      if (!h.fader.enabled || !n.mesh.visible || h.loading()) {
        dropCovered(h, n);
        for (const w of incoming) reveal(w);
        continue;
      }
      h.fader.start(n, -1);
      for (const w of incoming) h.fader.start(w, 1);
    }
  }
  // replacements whose predecessors went away without a fade: just show them
  for (const w of wantedMesh) {
    if (!w.awaitFade) continue;
    let blocked = false;
    for (const n of h.nodes.values()) {
      if (!n.wanted && n.kind === "mesh" && n.mesh && n.mesh.visible && n.fade >= 0 && overlaps(n, w)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) reveal(w);
  }
}

/** A mesh-carrying node that isn't drawn yet because an old mesh still covers its footprint. */
export function hasVisibleOverlap(nodes: Map<string, ChunkNode>, e: ChunkNode): boolean {
  for (const n of nodes.values()) {
    if (n !== e && !n.wanted && n.kind === "mesh" && n.mesh && n.mesh.visible && overlaps(n, e)) return true;
  }
  return false;
}

/** An unwanted node whose footprint is drawn by its replacement: freed, or hidden if top-level. */
export function dropCovered(h: SwapHost, n: ChunkNode) {
  if (n.kind === "mesh" && n.lod === h.levels - 1 && n.mesh) {
    if (n.fade !== 0 || n.fadeMat) h.fader.end(n);
    n.mesh.visible = false;
    n.awaitFade = true;
    n.resident = true;
  } else h.recycle(n);
}

function reveal(w: ChunkNode) {
  w.awaitFade = false;
  w.resident = false;
  if (w.mesh) w.mesh.visible = true;
}
