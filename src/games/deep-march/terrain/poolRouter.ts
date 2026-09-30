/**
 * One worker pool shared by several ChunkManagers — the tide's double-buffered
 * terrain (scene/tide/): the current generation keeps streaming while gen + 1's
 * columns are meshed on the same workers (no second set of workers, no second
 * startup). Each `view(gen)` is a JobPool for one manager:
 * - its job ids are remapped to pool-global ids and its requests name their
 *   generation (key 0 = the pool's init layout; others via `addGen`);
 * - responses and crashed-slot losses are routed back to the view that asked;
 * - disposing a view drops its generation in the workers (in-flight results are
 *   discarded) but keeps the workers; `dispose()` on the router ends them.
 * The free dive never uses this (its ChunkManager owns a plain WorkerPool).
 */
import type { GenerationHost, JobPool, JobRequest } from "./jobPool";
import type { MesherResponse } from "./protocol";
import type { SiteLayout } from "./siteLayout";

type Route = { view: RoutedView; id: number };

class RoutedView implements JobPool {
  readonly bucket: MesherResponse[] = [];
  onLost: ((ids: number[]) => void) | null = null;
  disposed = false;
  private readonly router: PoolRouter;
  readonly gen: number;

  constructor(router: PoolRouter, gen: number) {
    this.router = router;
    this.gen = gen;
  }

  live(): number {
    return this.disposed ? 0 : this.router.pool.live();
  }

  free(): number {
    return this.disposed ? 0 : this.router.pool.free();
  }

  submit(req: JobRequest): void {
    this.router.submit(this, req);
  }

  drain(out: MesherResponse[]): void {
    this.router.pump();
    for (const r of this.bucket) out.push(r);
    this.bucket.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bucket.length = 0;
    this.router.release(this);
  }
}

export class PoolRouter {
  private readonly routes = new Map<number, Route>();
  private readonly views = new Set<RoutedView>();
  private readonly incoming: MesherResponse[] = [];
  private nextId = 1;
  readonly pool: JobPool & Partial<GenerationHost>;

  constructor(pool: JobPool & Partial<GenerationHost>) {
    this.pool = pool;
    pool.onLost = (ids) => this.lost(ids);
  }

  /** A JobPool for generation `gen`; gen ≠ 0 needs its layout (sent to the workers once). */
  view(gen: number, layout: SiteLayout | null = null): JobPool {
    if (gen !== 0) this.pool.addGen?.(gen, layout);
    const v = new RoutedView(this, gen);
    this.views.add(v);
    return v;
  }

  /** Views not yet disposed (tests). */
  get viewCount(): number {
    return this.views.size;
  }

  /** Jobs submitted and not yet answered (tests). */
  get inFlight(): number {
    return this.routes.size;
  }

  submit(view: RoutedView, req: JobRequest): void {
    if (view.disposed) return;
    const id = this.nextId++;
    this.routes.set(id, { view, id: req.id });
    this.pool.submit(view.gen === 0 ? { ...req, id } : { ...req, id, gen: view.gen });
  }

  /** Collect the pool's responses into their views' buckets. */
  pump(): void {
    this.pool.drain(this.incoming);
    for (const r of this.incoming) {
      const route = this.routes.get(r.id);
      if (!route) continue;
      this.routes.delete(r.id);
      if (!route.view.disposed) route.view.bucket.push({ ...r, id: route.id });
    }
    this.incoming.length = 0;
  }

  release(view: RoutedView): void {
    this.views.delete(view);
    this.pool.dropGen?.(view.gen);
  }

  private lost(ids: number[]): void {
    const byView = new Map<RoutedView, number[]>();
    for (const g of ids) {
      const route = this.routes.get(g);
      if (!route) continue;
      this.routes.delete(g);
      if (route.view.disposed) continue;
      const list = byView.get(route.view) ?? [];
      list.push(route.id);
      byView.set(route.view, list);
    }
    for (const [view, list] of byView) view.onLost?.(list);
  }

  dispose(): void {
    for (const v of [...this.views]) v.dispose();
    this.pool.dispose();
  }
}
