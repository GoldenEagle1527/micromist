import { useCallback, useEffect, useRef, useState } from "react";
import "./term-run.css";
import { useLocale } from "../../i18n";
import { createEngine, jump, resetEngine, step, type EngineState } from "./engine";
import { drawFrame } from "./render";
import { loadScores, recordRun, type TermRunScores } from "./scores";

export function TermRunGame() {
  const { locale } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<EngineState>(createEngine());
  const scoresRef = useRef<TermRunScores>(loadScores());
  const recordedRef = useRef(false);
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
      const parent = canvas.parentElement;
      const rect = parent?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
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
      step(st, dt);

      if (st.phase === "dead" && !recordedRef.current) {
        recordedRef.current = true;
        const { scores } = recordRun({
          score: st.score,
          lines: st.linesPassed,
          ok: 0,
          distance: st.linesPassed,
          at: Date.now(),
        });
        scoresRef.current = scores;
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
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        if (st.phase === "dead") {
          restart();
          return;
        }
        jump(st);
        return;
      }
      if (e.code === "KeyR" && st.phase === "dead") restart();
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [restart]);

  const onPointer = () => {
    const st = stateRef.current;
    if (st.phase === "dead") {
      restart();
      return;
    }
    jump(st);
  };

  return (
    <div className="game-viewport term-run-viewport">
      <div className="game-stage term-run-stage">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="access.log"
          onPointerDown={onPointer}
        />
      </div>
    </div>
  );
}
