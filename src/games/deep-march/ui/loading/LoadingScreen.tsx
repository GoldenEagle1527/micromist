/**
 * Pre-dive loading screen: the real initialization pipeline of a dive, step by step
 * (loadingModel.ts), with the seed's region map drawn top to bottom as it is
 * computed (regionMap.ts). All progress comes from the world (DeepMarchHandle.loading):
 * spawn search, texture bytes / layers, terrain gate items, system check. When
 * everything is in, "Begin dive" starts the simulation and the screen fades out.
 */
import { useEffect, useRef, useState } from "react";
import "./loading.css";
import type { DeepMarchHandle, LoadingSnapshot } from "../../scene/world";
import { LAYERS } from "../../scene/materialCatalog";
import { REGION_COLORS, REGION_KEYS, type RegionKey } from "../../terrain/regions";
import type { LightMode } from "../../survival";
import type { LoadingDict } from "./i18n";
import { LoadingModel, STEPS, formatMB, type StepId } from "./loadingModel";
import { REGION_MAP, RegionMapRaster, hexToRgb, mapSpec } from "./regionMap";

export type LoadingLabels = LoadingDict & { regionNames: Record<RegionKey, string>; lightModes: Record<LightMode, string> };

type Props = {
  game: DeepMarchHandle | null;
  seedText: string;
  seed: number;
  labels: LoadingLabels;
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

export function LoadingScreen({ game, seedText, seed, labels: L, onDone }: Props) {
  const model = useRef(new LoadingModel()).current;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View>({ snap: null, mapRows: 0, phase: "loading" });
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // after a shader error: the player chose to dive anyway (the error stays listed)
  const forceRef = useRef(false);

  useEffect(() => {
    let raf = 0;
    let raster: RegionMapRaster | null = null;
    let img: ImageData | null = null;
    let phase: View["phase"] = "loading";
    let beginAt = 0;
    let lastUi = 0;
    let shownPhase: View["phase"] = "loading";
    let doneTimer = 0;
    model.start("coords");
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const snap = game?.loading() ?? null;
      if (snap) {
        // 1. coordinates: the world exists = seed read and entry point found
        model.complete("coords");
        // 2. region map, computed in time slices and drawn as rows arrive
        if (!raster) {
          raster = new RegionMapRaster(snap.regions, mapSpec(snap.spawn.x, snap.spawn.z));
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
          model.report("regions", raster.rows, REGION_MAP.size);
          if (raster.done) model.complete("regions");
        }
        // 3. materials: bytes of all 22 layers, then the GPU upload
        const m = snap.materials;
        if (m.ready) model.complete("materials");
        else {
          model.report("materials", m.bytes, m.totalBytes);
          if (m.error) model.fail("materials");
          else model.recover("materials");
        }
        // 4. terrain gate around the spawn
        if (snap.terrain.ready) model.complete("terrain");
        else model.report("terrain", snap.terrain.done, Math.max(1, snap.terrain.total));
        // 5. system check
        const s = snap.system;
        const broken = !!s.shaderError || s.gpuLost;
        const ok = [s.battery > 0, s.lamps.length > 0, s.sonar, s.shaders && !broken].filter(Boolean).length;
        if (ok === 4) model.complete("system");
        else {
          model.report("system", ok, 4);
          if (broken) model.fail("system");
          else model.recover("system");
        }
        // begin dive → fade (or, after a shader error, once the player chose to dive anyway)
        const forced = forceRef.current && !s.gpuLost && s.shaders && snap.terrain.ready && snap.materials.ready && STEPS.every((id) => id === "system" || model.status[id] === "done");
        if (phase === "loading" && ((model.allDone() && snap.loaded) || forced)) {
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
  const pct = (f: number) => Math.floor(f * 100);
  const detail = (id: StepId): string[] => {
    switch (id) {
      case "coords":
        return [L.seed(seedText, (seed >>> 0).toString(16).padStart(8, "0")), snap ? L.spawnFix(Math.round(snap.spawn.x), Math.round(snap.spawn.z), Math.round(100 - snap.spawn.y)) : L.locating];
      case "regions":
        return [L.mapProgress(pct(view.mapRows / REGION_MAP.size), (REGION_MAP.span / 1000).toFixed(1))];
      case "materials": {
        const m = snap?.materials;
        if (!m) return [L.connecting];
        const lines = [L.materialCount(m.done, m.total, formatMB(m.bytes), formatMB(m.totalBytes))];
        if (m.done === m.total && !m.ready) lines.push(L.uploading);
        else if (m.last >= 0) lines.push(L.laying(L.materialNames[LAYERS[m.last].key] ?? LAYERS[m.last].key));
        else lines.push(L.connecting);
        if (m.fellBack) lines.push(L.fallback);
        if (m.retrying > 0 && !m.error) lines.push(L.retrying(m.retrying));
        if (m.error) lines.push(L.failed(m.error));
        return lines;
      }
      case "terrain":
        if (!snap || snap.terrain.total === 0) return [L.terrainPlanning];
        return [L.terrain(snap.terrain.ready ? 100 : pct(Math.min(0.99, snap.terrain.done / snap.terrain.total)))];
      case "system": {
        if (!snap) return [];
        const s = snap.system;
        return [
          `${s.battery > 0 ? "✓" : "·"} ${L.battery(Math.round(s.battery * 100))}`,
          `${s.lamps.length ? "✓" : "·"} ${L.lamps(s.lamps.map((m) => L.lightModes[m]).join(" · "))}`,
          `${s.sonar ? "✓" : "·"} ${L.sonar}`,
          s.gpuLost ? `✗ ${L.gpuLost}` : s.shaderError ? `✗ ${L.shaderError(s.shaderError)}` : `${s.shaders ? "✓" : "·"} ${s.shaderFallback ? L.shadersSimple : L.shaders}`,
        ];
      }
    }
  };
  const overall = model.overall();
  const mapHalf = view.mapRows >= REGION_MAP.size / 2;

  return (
    <div className="dm-load" data-phase={view.phase} role="status" aria-live="polite">
      <div className="dm-load-frame">
        <header className="dm-load-head">
          <span className="dm-load-title">{L.title}</span>
          <span className="dm-load-sub">{L.subtitle}</span>
        </header>
        <div className="dm-load-body">
          <ol className="dm-load-steps">
            {STEPS.map((id, k) => (
              <li key={id} className="dm-load-step" data-status={model.status[id]}>
                <div className="dm-load-step-row">
                  <span className="dm-load-idx">{String(k + 1).padStart(2, "0")}</span>
                  <span className="dm-load-name">{L.steps[id]}</span>
                  <span className="dm-load-st">{L.status[model.status[id]]}</span>
                </div>
                <div className="dm-load-bar">
                  <i style={{ width: `${model.progress[id] * 100}%` }} />
                </div>
                {model.status[id] !== "pending" && (
                  <div className="dm-load-detail">
                    {detail(id).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                    {id === "materials" && snap?.materials.error && (
                      <button type="button" className="dm-load-retry" onClick={() => game?.retryMaterials()}>
                        {L.retry}
                      </button>
                    )}
                    {id === "system" && snap?.system.shaderError && !snap.system.gpuLost && (
                      <button
                        type="button"
                        className="dm-load-retry"
                        onClick={() => {
                          forceRef.current = true;
                        }}
                      >
                        {L.diveAnyway}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <figure className="dm-load-map">
            <div className="dm-load-mapbox">
              <canvas ref={canvasRef} width={REGION_MAP.size} height={REGION_MAP.size} />
              <div className="dm-load-scanline" style={{ top: `${(view.mapRows / REGION_MAP.size) * 100}%` }} hidden={view.mapRows >= REGION_MAP.size || view.mapRows === 0} />
              {mapHalf && <span className="dm-load-spawn" title={L.spawn} />}
            </div>
            <figcaption className="dm-load-legend">
              <span className="dm-load-legend-title">{L.legend}</span>
              {REGION_KEYS.map((k, i) => (
                <span key={k} className="dm-load-key">
                  <i style={{ background: REGION_COLORS[i] }} />
                  {L.regionNames[k]}
                </span>
              ))}
              <span className="dm-load-key">
                <i className="dm-load-key-spawn" />
                {L.spawn}
              </span>
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
