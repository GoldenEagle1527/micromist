/**
 * Where this generation's nodes sit (plan M4): each site near the diver is
 * placed once, node after node in ordinal order, each on a deterministic surface
 * anchor (terrain/surfaceAnchor.ts) seeded by the node's hash — so every device
 * puts every node on the same spot, whatever order the sites are visited in.
 * Work is sliced by attempts under a per-frame time budget (no hitch on phones);
 * sites are queued nearest first once their point is within `prefetch` metres.
 * A node no attempt can anchor is not drawn: its particles stay in the terrain
 * body (W), conservation is unchanged. No three.js: node tests run it as it is.
 */
import type { ExpeditionNode, ExpeditionPort } from "../../conserve";
import { ANCHOR } from "../../terrain/anchorConfig";
import type { DensityField } from "../../terrain/density";
import { MACRO } from "../../terrain/regions";
import { layoutRect, layoutSitePoint, type SiteLayout, type WorldRect } from "../../terrain/siteLayout";
import { ANCHOR_ATTEMPTS, AnchorProbe, anchorAttempt, type Anchor, type AnchorQuery } from "../../terrain/surfaceAnchor";

export type PlacedNode = { node: ExpeditionNode; anchor: Anchor };

type SiteWork = {
  site: number;
  nodes: readonly ExpeditionNode[];
  query: Omit<AnchorQuery, "surface" | "seed">;
  next: number;
  attempt: number;
  taken: Anchor[];
  placed: PlacedNode[];
  missed: number;
};

export class NodePlacement {
  private readonly probe: AnchorProbe;
  private readonly port: ExpeditionPort;
  private readonly layout: SiteLayout;
  private readonly cell: number;
  private readonly rect: WorldRect;
  private readonly prefetch: number;
  private readonly work = new Map<number, SiteWork>();
  private readonly done = new Map<number, SiteWork>();
  /** Bumps whenever a node is placed. */
  version = 0;

  constructor(field: DensityField, layout: SiteLayout, port: ExpeditionPort, prefetch: number) {
    this.probe = new AnchorProbe(field);
    this.port = port;
    this.layout = layout;
    this.cell = MACRO.cell * field.settings.worldScale;
    this.rect = layoutRect(layout, this.cell);
    this.prefetch = prefetch;
  }

  sitePoint(site: number): { x: number; z: number } {
    return layoutSitePoint(this.layout, site, this.cell, MACRO.jitter);
  }

  private start(site: number): SiteWork {
    const p = this.sitePoint(site);
    const w: SiteWork = {
      site,
      nodes: this.port.siteNodes(site),
      query: { cx: p.x, cz: p.z, radius: ANCHOR.discFraction * this.cell, rect: this.rect, region: this.layout.region[site] },
      next: 0,
      attempt: 0,
      taken: [],
      placed: [],
      missed: 0,
    };
    this.work.set(site, w);
    return w;
  }

  /** One attempt on a site; true once every node of it is settled. */
  private step(w: SiteWork): boolean {
    if (w.next >= w.nodes.length) return true;
    const node = w.nodes[w.next];
    const a = anchorAttempt(this.probe, { ...w.query, surface: node.surface, seed: node.hash }, w.attempt, w.taken);
    if (a) {
      w.taken.push(a);
      w.placed.push({ node, anchor: a });
      this.version++;
    }
    if (a || ++w.attempt >= ANCHOR_ATTEMPTS) {
      if (!a) w.missed++;
      w.next++;
      w.attempt = 0;
    }
    if (w.next < w.nodes.length) return false;
    this.work.delete(w.site);
    this.done.set(w.site, w);
    return true;
  }

  /** Sites within `prefetch` of (x, z), nearest first, not yet complete. */
  private pending(x: number, z: number): number[] {
    const out: [number, number][] = [];
    const n = this.layout.nx * this.layout.nz;
    for (let i = 0; i < n; i++) {
      if (this.done.has(i)) continue;
      const p = this.sitePoint(i);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d <= this.prefetch) out.push([d, i]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }

  /** Place near (x, z) for at most `budgetMs` (at least one attempt when anything is pending). */
  update(x: number, z: number, budgetMs: number, clock: () => number = () => performance.now()): void {
    const t0 = clock();
    for (const site of this.pending(x, z)) {
      const w = this.work.get(site) ?? this.start(site);
      while (!this.step(w)) if (clock() - t0 >= budgetMs) return;
      if (clock() - t0 >= budgetMs) return;
    }
  }

  /** Place one site to completion (tests, and the site the diver spawns in). */
  placeSite(site: number): readonly PlacedNode[] {
    const w = this.done.get(site) ?? this.work.get(site) ?? this.start(site);
    while (!this.step(w));
    return w.placed;
  }

  /** Every node placed so far (complete and partly placed sites). */
  forEach(fn: (p: PlacedNode) => void): void {
    for (const w of this.done.values()) w.placed.forEach(fn);
    for (const w of this.work.values()) w.placed.forEach(fn);
  }

  stats(): { sites: number; placed: number; missed: number; pending: number } {
    let placed = 0, missed = 0;
    for (const w of this.done.values()) {
      placed += w.placed.length;
      missed += w.missed;
    }
    return { sites: this.done.size, placed, missed, pending: this.work.size };
  }
}
