import { useCallback, useEffect, useRef, useState } from "react";
import "./term-run.css";
import { useLocale } from "../../i18n";
import {
  createEngine,
  jump,
  resetEngine,
  slide,
  step,
  type EngineState,
} from "./engine";
import { drawFrame } from "./render";
import { loadScores, recordRun, type TermRunScores } from "./scores";

export function TermRunGame() {
  const { locale } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<EngineState>(createEngine());
  const scoresRef = useRef<TermRunScores>(loadScores());
  const recordedRef = useRef(false);
  const [best, setBest] = useState(() => loadScores().best?.score ?? 0);
  const [, setUiTick] = useState(0);

  const restart = useCallback(() => {
    stateRef.current = resetEngine();
    recordedRef.current = false;
    setUiTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let blink = 0;
    let alive = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const frame = (now: number) => {
      if (!alive) return;
      resize();
      const dt = (now - last) / 1000;
      last = now;
      blink += dt;
      const st = stateRef.current;
      const h = canvas.height;
      step(st, dt, h);

      if (st.phase === "dead" && !recordedRef.current) {
        recordedRef.current = true;
        const { scores, isNewBest } = recordRun({
          score: st.score,
          lines: st.linesPassed,
          ok: st.okCount,
          distance: Math.floor(st.distance),
          at: Date.now(),
        });
        scoresRef.current = scores;
        if (isNewBest) setBest(st.score);
        else setBest(scores.best?.score ?? 0);
        setUiTick((n) => n + 1);
      }

      drawFrame(ctx, st, canvas.width, canvas.height, {
        best: scoresRef.current.best?.score ?? 0,
        blink,
        locale: locale === "zh" ? "zh" : "en",
      });
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [locale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const st = stateRef.current;
      const canvas = canvasRef.current;
      const h = canvas?.height || 540;

      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        if (st.phase === "dead") {
          restart();
          return;
        }
        jump(st, h);
        return;
      }
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        e.preventDefault();
        if (st.phase === "dead") return;
        slide(st);
      }
      if (e.code === "KeyR" && st.phase === "dead") restart();
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [restart]);

  const onPointer = () => {
    const st = stateRef.current;
    const canvas = canvasRef.current;
    const h = canvas?.height || 540;
    if (st.phase === "dead") {
      restart();
      return;
    }
    jump(st, h);
  };

  const zh = locale === "zh";

  return (
    <section className="term-run">
      <header className="term-run-head">
        <div>
          <h1>term-run</h1>
          <p>
            {zh
              ? "行越长坡越高。躲 5xx，踩 2xx。旁人眼里只是 access.log 在刷。"
              : "Line length is terrain height. Dodge 5xx, land 2xx. Looks like access.log."}
          </p>
        </div>
        <div className="term-run-best">best={best}</div>
      </header>

      <div className="term-run-stage">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={zh ? "终端跑酷画布" : "Terminal runner canvas"}
          onPointerDown={onPointer}
        />
      </div>

      <p className="term-run-help">
        <kbd>Space</kbd> / <kbd>↑</kbd> {zh ? "跳" : "jump"} · <kbd>↓</kbd>{" "}
        {zh ? "滑铲" : "slide"} · {zh ? "点画布也可跳" : "tap canvas to jump"}
      </p>
    </section>
  );
}
