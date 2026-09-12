import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent,
} from "react";
import {
  applyHand,
  applySponge,
  applyWireCut,
  type ToolId,
} from "./engine";
import {
  drawPottery,
  layoutPottery,
  sampleIndexAtY,
  type PotteryLayout,
} from "./draw";

export type PotteryStudioHandle = {
  captureThumb: () => string;
};

export type PotteryStudioProps = {
  profile: number[];
  tool: ToolId;
  spinning: boolean;
  readOnly?: boolean;
  onProfileChange?: (next: number[]) => void;
  onGestureStart?: () => void;
  ariaLabel?: string;
};

const SPIN_MS = 2600;

export const PotteryStudio = forwardRef<PotteryStudioHandle, PotteryStudioProps>(
  function PotteryStudio(
    {
      profile,
      tool,
      spinning,
      readOnly = false,
      onProfileChange,
      onGestureStart,
      ariaLabel,
    },
    ref,
  ) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const profileRef = useRef(profile);
    const toolRef = useRef(tool);
    const spinningRef = useRef(spinning);
    const readOnlyRef = useRef(readOnly);
    const layoutRef = useRef<PotteryLayout | null>(null);
    const draggingRef = useRef(false);
    const lastXRef = useRef(0);
    const gestureStartedRef = useRef(false);
    const onChangeRef = useRef(onProfileChange);
    const onStartRef = useRef(onGestureStart);
    const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });

    profileRef.current = profile;
    toolRef.current = tool;
    spinningRef.current = spinning;
    readOnlyRef.current = readOnly;
    onChangeRef.current = onProfileChange;
    onStartRef.current = onGestureStart;

    const paint = useCallback((spin: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const showWire = !readOnlyRef.current && toolRef.current === "wire";
      layoutRef.current = drawPottery(ctx, profileRef.current, w, h, {
        spin,
        showWire,
        wireSample: showWire ? profileRef.current.length - 1 : undefined,
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        captureThumb: () => {
          const canvas = canvasRef.current;
          if (!canvas) return "";
          paint(((performance.now() / SPIN_MS) * Math.PI * 2) % (Math.PI * 2));
          try {
            return canvas.toDataURL("image/jpeg", 0.7);
          } catch {
            return "";
          }
        },
      }),
      [paint],
    );

    useEffect(() => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      if (!wrap || !canvas) return;

      const resize = () => {
        const rect = wrap.getBoundingClientRect();
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        sizeRef.current = { w, h, dpr };
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        paint(((performance.now() / SPIN_MS) * Math.PI * 2) % (Math.PI * 2));
      };

      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [paint]);

    useEffect(() => {
      let raf = 0;
      const tick = (now: number) => {
        const spin = spinningRef.current
          ? ((now / SPIN_MS) * Math.PI * 2) % (Math.PI * 2)
          : 0;
        paint(spin);
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(raf);
    }, [paint]);

    const mapPointer = (e: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const layout =
        layoutRef.current ??
        layoutPottery(rect.width, rect.height, profileRef.current.length);
      return { x, y, layout, sample: sampleIndexAtY(layout, y) };
    };

    const applyAt = (e: PointerEvent<HTMLCanvasElement>, first: boolean) => {
      if (readOnlyRef.current || !onChangeRef.current) return;
      const mapped = mapPointer(e);
      if (!mapped) return;
      const { x, layout, sample } = mapped;
      const current = profileRef.current;
      const t = toolRef.current;

      if (first) {
        lastXRef.current = x;
        if (!gestureStartedRef.current) {
          gestureStartedRef.current = true;
          onStartRef.current?.();
        }
      }

      if (t === "hand") {
        const dx = x - lastXRef.current;
        lastXRef.current = x;
        const side = x >= layout.cx ? 1 : -1;
        const delta = (side * dx) / Math.max(24, layout.maxRadius);
        if (delta === 0) return;
        onChangeRef.current(applyHand(current, sample, delta));
      } else if (t === "sponge") {
        onChangeRef.current(applySponge(current, sample));
      } else {
        onChangeRef.current(applyWireCut(current, sample + 1));
      }
    };

    const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
      if (readOnlyRef.current) return;
      e.preventDefault();
      draggingRef.current = true;
      gestureStartedRef.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      applyAt(e, true);
    };

    const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      applyAt(e, false);
    };

    const endDrag = (e: PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      gestureStartedRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };

    return (
      <div ref={wrapRef} className="pottery-stage">
        <canvas
          ref={canvasRef}
          className="pottery-canvas"
          aria-label={ariaLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    );
  },
);


/** One-shot still of a stored profile — collection fallback when no JPEG thumb. */
export function PotteryThumb({
  profile,
  alt,
}: {
  profile: number[];
  alt?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = 180;
    const h = 240;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) drawPottery(ctx, profile, w, h, { spin: 0.35 });
  }, [profile]);
  return <canvas ref={ref} className="pottery-thumb" aria-label={alt} />;
}
