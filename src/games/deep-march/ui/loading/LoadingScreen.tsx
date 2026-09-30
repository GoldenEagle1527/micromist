/**
 * Pre-dive loading screen: the real initialization pipeline of a dive, one compact
 * row per registered step (steps/index.ts), a focus card with the lines of the step
 * that matters now, a diagnostics drawer (GPU facts, logs, formats; opens by itself
 * on an error), the seed's region map drawn as it is computed (regionMap.ts) and a
 * total progress bar that always stays on screen. All progress comes from the world
 * (DeepMarchHandle.loading). When everything is in, "Begin dive" starts the
 * simulation and the screen fades out (gate: loadingGate.ts).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./loading.css";
import type { DeepMarchHandle, LoadingSnapshot } from "../../scene/world";
import { REGION_COLORS, REGION_KEYS } from "../../terrain/regions";
import { applyStep, canBeginDive } from "./loadingGate";
import { LoadingModel } from "./loadingModel";
import { REGION_MAP, RegionMapRaster, hexToRgb, mapSpecFor, worldToPixel } from "./regionMap";
import { LOADING_STEPS, type LoadingLabels, type LoadingStepDef, type StepAction, type StepContext, type StepEval } from "./steps";

export type { LoadingLabels } from "./steps";

type Props = {
  game: DeepMarchHandle | null;
  seedText: string;
  seed: number;
  labels: LoadingLabels;
  /** Steps of this dive (fixed for the screen's lifetime); default: the shared registry. Conserve mode prepends its world-save step. */
  steps?: readonly LoadingStepDef[];
  /** The screen has faded out (unmount it). */
  onDone: () => void;
};

/** Main-thread time per frame for the region map. */
const MAP_BUDGET_MS = 5;
/** "Begin dive" stays up this long before the fade (transition, not progress). */
const BEGIN_HOLD_MS = 900;
const FADE_MS = 700;
const COLORS = REGION_COLORS.map(hexToRgb);

type View = { snap: LoadingSnapshot | null; mapRows: number; phase: "loading" | "begin" | "fade" };

export function LoadingScreen({ game, seedText, seed, labels: L, steps: stepsProp = LOADING_STEPS, onDone }: Props) {
  const steps = useRef(stepsProp).current;
  const model = useRef(new LoadingModel(steps)).current;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const [view, setView] = useState<View>({ snap: null, mapRows: 0, phase: "loading" });
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // after a shader error: the player chose to dive anyway (the error stays listed)
  const forceRef = useRef(false);
  // latest labels for the loop's step evaluation (language may switch mid-load)
  const ctxRef = useRef<Omit<StepContext, "mapRows" | "mapSize">>({ L, seedText, seed });
  ctxRef.current = { L, seedText, seed };
  // a row the player tapped: its lines stay in the focus card (null = follow the pipeline)
  const [pinned, setPinned] = useState<string | null>(null);
  // diagnostics drawer: null = automatic (open while a step is in error)
  const [diagOpen, setDiagOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let raf = 0;
    let raster: RegionMapRaster | null = null;
    let img: ImageData | null = null;
    let phase: View["phase"] = "loading";
    let beginAt = 0;
    let lastUi = 0;
    let shownPhase: View["phase"] = "loading";
    let doneTimer = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const snap = game?.loading() ?? null;
      // region map, computed in time slices and drawn as rows arrive
      if (snap) {
        if (!raster) {
          raster = new RegionMapRaster(snap.regions, mapSpecFor(snap.spawn, snap.world));
          const c = canvasRef.current;
          if (c) {
            c.width = c.height = REGION_MAP.size;
            img = c.getContext("2d")?.createImageData(REGION_MAP.size, REGION_MAP.size) ?? null;
          }
        }
        if (!raster.done) {
          const y0 = raster.rows;
          const t0 = performance.now();
          while (!raster.done && performance.now() - t0 < MAP_BUDGET_MS) raster.computeRows(2);
          const c = canvasRef.current?.getContext("2d");
          if (img && c) {
            raster.paintRows(img.data, y0, raster.rows, COLORS);
            c.putImageData(img, 0, 0, 0, y0, REGION_MAP.size, raster.rows - y0);
          }
        }
      }
      const ctx: StepContext = { ...ctxRef.current, mapRows: raster?.rows ?? 0, mapSize: REGION_MAP.size };
      for (const def of steps) applyStep(model, def.id, def.evaluate(snap, ctx));
      if (snap) {
        // begin dive → fade (or, after a shader error, once the player chose to dive anyway)
        if (phase === "loading" && canBeginDive(model, steps, snap, forceRef.current)) {
          phase = "begin";
          beginAt = now;
          game?.startDive();
        }
        if (phase === "begin" && snap.diving && now - beginAt >= BEGIN_HOLD_MS) {
          phase = "fade";
          doneTimer = window.setTimeout(() => onDoneRef.current(), FADE_MS);
        }
      }
      if (now - lastUi > 100 || phase !== shownPhase) {
        lastUi = now;
        shownPhase = phase;
        setView({ snap, mapRows: raster?.rows ?? 0, phase });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(doneTimer);
    };
    // the loop reads the latest game handle; labels only affect rendering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const snap = view.snap;
  const ctx: StepContext = { L, seedText, seed, mapRows: view.mapRows, mapSize: REGION_MAP.size };
  const evals = new Map<string, StepEval>(steps.map((d) => [d.id, d.evaluate(snap, ctx)]));
  const auto = model.focus();
  const focus = pinned ?? auto;
  const focusDef = steps.find((d) => d.id === focus) ?? null;
  const focusEval = focusDef ? evals.get(focusDef.id) : undefined;
  const anyError = steps.some((d) => model.status[d.id] === "error");
  const actions = [...new Set(steps.flatMap((d) => evals.get(d.id)?.actions ?? []))];
  const diag = steps.flatMap((d) => (evals.get(d.id)?.diag ?? []).map((e) => ({ step: d.id, ...e })));
  const overall = model.overall();
  const pct = (f: number) => Math.floor(f * 100);
  const mapHalf = view.mapRows >= REGION_MAP.size / 2;
  // spawn marker: the centre of the endless map, its own pixel on a bounded world map
  const spawnPx = snap ? worldToPixel(mapSpecFor(snap.spawn, snap.world), snap.spawn.x, snap.spawn.z) : null;
  const spawnStyle = spawnPx ? { left: `${(spawnPx[0] / REGION_MAP.size) * 100}%`, top: `${(spawnPx[1] / REGION_MAP.size) * 100}%` } : undefined;
  // conserve: lost caches (plan M4 map marker) on the bounded world map
  const cachePx = snap && snap.world ? (snap.caches ?? []).map((c) => worldToPixel(mapSpecFor(snap.spawn, snap.world), c.x, c.z)) : [];

  // keep the focused row in view when the list scrolls (many steps / very short screens);
  // scrollTop only: scrollIntoView would also scroll the rotated immersive stage
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-step="${focus ?? ""}"]`);
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [focus]);

  const runAction = (a: StepAction) => {
    if (a === "retryMaterials") game?.retryMaterials();
    else forceRef.current = true;
  };

  return (
    <div className="dm-load" data-phase={view.phase} role="status" aria-live="polite">
      <div className="dm-load-frame">
        <header className="dm-load-head">
          <span className="dm-load-title">{L.title}</span>
          <span className="dm-load-sub">{L.subtitle}</span>
        </header>
        <div className="dm-load-body">
          <div className="dm-load-col">
            <ol className="dm-load-steps" ref={listRef}>
              {steps.map((d, k) => {
                const st = model.status[d.id];
                const p = model.progress[d.id];
                return (
                  <li key={d.id} data-step={d.id} data-status={st} data-focus={d.id === focus || undefined} data-optional={!d.required || undefined}>
                    <button type="button" className="dm-load-step" aria-pressed={pinned === d.id} onClick={() => setPinned((cur) => (cur === d.id ? null : d.id))}>
                      <span className="dm-load-idx">{String(k + 1).padStart(2, "0")}</span>
                      <span className="dm-load-name">{L.steps[d.id]}</span>
                      <span className="dm-load-bar" aria-hidden="true">
                        <i style={{ width: `${p * 100}%` }} />
                      </span>
                      <span className="dm-load-st">{st === "active" && p > 0 ? `${pct(p)}%` : L.status[st]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <section className="dm-load-focus" data-status={focusDef ? model.status[focusDef.id] : "done"}>
              <div className="dm-load-focus-head">
                {focusDef ? (
                  <>
                    <span className="dm-load-focus-tag">{L.now}</span>
                    <span className="dm-load-focus-name">{L.steps[focusDef.id]}</span>
                  </>
                ) : (
                  <span className="dm-load-focus-name">{L.allReady}</span>
                )}
              </div>
              <div className="dm-load-focus-lines">
                {(focusEval?.lines ?? []).map((line) => (
                  <div key={line} className="dm-load-line" title={line}>
                    {line}
                  </div>
                ))}
              </div>
              {actions.length > 0 && (
                <div className="dm-load-actions">
                  {actions.map((a) => (
                    <button key={a} type="button" className="dm-load-retry" onClick={() => runAction(a)}>
                      {a === "retryMaterials" ? L.retry : L.diveAnyway}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <details className="dm-load-diag" open={diagOpen ?? anyError} onToggle={(e) => {
              const open = e.currentTarget.open;
              if (open !== (diagOpen ?? anyError)) setDiagOpen(open);
            }}>
              <summary>{L.diagnostics}</summary>
              <dl>
                {diag.map((e) => (
                  <div key={`${e.step}:${e.label}`} className="dm-load-diag-row">
                    <dt>{e.label}</dt>
                    <dd>{e.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
          <figure className="dm-load-map">
            <div className="dm-load-mapbox">
              <canvas ref={canvasRef} width={REGION_MAP.size} height={REGION_MAP.size} />
              <div className="dm-load-scanline" style={{ top: `${(view.mapRows / REGION_MAP.size) * 100}%` }} hidden={view.mapRows >= REGION_MAP.size || view.mapRows === 0} />
              {mapHalf && <span className="dm-load-spawn" title={L.spawn} style={spawnStyle} />}
              {mapHalf &&
                cachePx.map(([x, y], i) => (
                  <span key={i} className="dm-load-cache" title={L.mapCache} style={{ left: `${(x / REGION_MAP.size) * 100}%`, top: `${(y / REGION_MAP.size) * 100}%` }} />
                ))}
            </div>
            <figcaption className="dm-load-legend">
              <span className="dm-load-legend-title">{L.legend}</span>
              {REGION_KEYS.map((k, i) => (
                <span key={k} className="dm-load-key" title={L.regionNames[k]}>
                  <i style={{ background: REGION_COLORS[i] }} />
                  <span className="dm-load-key-name">{L.regionNames[k]}</span>
                </span>
              ))}
              <span className="dm-load-key" title={L.spawn}>
                <i className="dm-load-key-spawn" />
                <span className="dm-load-key-name">{L.spawn}</span>
              </span>
              {cachePx.length > 0 && L.mapCache ? (
                <span className="dm-load-key" title={L.mapCache}>
                  <i className="dm-load-key-cache" />
                  <span className="dm-load-key-name">{L.mapCache}</span>
                </span>
              ) : null}
            </figcaption>
          </figure>
        </div>
        <footer className="dm-load-foot">
          <span className="dm-load-overall">{L.overall}</span>
          <div className="dm-load-bar dm-load-bar-main">
            <i style={{ width: `${overall * 100}%` }} />
          </div>
          <span className="dm-load-pct">{pct(overall)}%</span>
        </footer>
      </div>
      {view.phase !== "loading" && <div className="dm-load-begin">{L.begin}</div>}
    </div>
  );
}
