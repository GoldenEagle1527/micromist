/**
 * Bottom-left movement dial. Drag the thumb for analog move (like WASD);
 * push it out through the forward fan sector past the ring → swim zone.
 */
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { PanelInput } from "../scene/input";
import { arcPath, sectorPath, ticksPath, toViewBox } from "./geom";

const VB = 220;
const CX = 104;
const CY = 118;
const R = 56; // full analog deflection
const R_MAX = 84; // thumb travel
const SWIM_R = 66; // past this inside the sector → swim
const SWIM_HALF = 35; // sector half-angle (cos 35° ≈ 0.82 ≥ MC's 0.8 sprint threshold)

export function MoveDial({
  input,
  swimming,
  label,
  swimLabel,
}: {
  input: PanelInput;
  swimming: boolean;
  label: string;
  swimLabel: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pid = useRef<number | null>(null);
  const [thumb, setThumb] = useState<[number, number]>([0, 0]);
  const [zone, setZone] = useState(false);

  const apply = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const [x, y] = toViewBox(svg, clientX, clientY, VB);
    let dx = x - CX;
    let dy = y - CY;
    const d = Math.hypot(dx, dy);
    if (d > R_MAX) {
      dx *= R_MAX / d;
      dy *= R_MAX / d;
    }
    const dd = Math.min(d, R_MAX);
    const ang = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = up
    const inZone = dd > SWIM_R && Math.abs(ang) < SWIM_HALF;
    const m = Math.min(1, dd / R) / Math.max(dd, 1e-6);
    input.moveX = dx * m;
    input.moveY = -dy * m;
    if (inZone) {
      // full forward push in the swim sector
      const l = Math.hypot(input.moveX, input.moveY) || 1;
      input.moveX /= l;
      input.moveY /= l;
    }
    input.swimZone = inZone;
    setThumb([dx, dy]);
    setZone(inZone);
  };

  const release = () => {
    pid.current = null;
    input.moveX = 0;
    input.moveY = 0;
    input.swimZone = false;
    setThumb([0, 0]);
    setZone(false);
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (pid.current !== null) return;
    const svg = svgRef.current;
    if (!svg) return;
    const [x, y] = toViewBox(svg, e.clientX, e.clientY, VB);
    if (Math.hypot(x - CX, y - CY) > R_MAX + 14) return; // outside the dial: let it fall through
    e.preventDefault();
    e.stopPropagation();
    pid.current = e.pointerId;
    svg.setPointerCapture(e.pointerId);
    apply(e.clientX, e.clientY);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerId !== pid.current) return;
    apply(e.clientX, e.clientY);
  };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerId !== pid.current) return;
    release();
  };

  const [tx, ty] = thumb;
  const active = pid.current !== null;
  const lit = zone || swimming;
  return (
    <svg
      ref={svgRef}
      className={`dm-dial${active ? " active" : ""}${lit ? " lit" : ""}`}
      viewBox={`0 0 ${VB} ${VB}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      role="slider"
      aria-label={label}
      aria-valuetext={`${Math.round(-ty)} ${Math.round(tx)}`}
    >
      <defs>
        <radialGradient id="dmDialBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(40 220 255 / 0.10)" />
          <stop offset="70%" stopColor="rgb(10 60 90 / 0.20)" />
          <stop offset="100%" stopColor="rgb(10 60 90 / 0)" />
        </radialGradient>
        <path id="dmSwimArc" d={arcPath(CX, CY, R_MAX + 6, -SWIM_HALF, SWIM_HALF)} />
      </defs>
      {/* hit area */}
      <circle cx={CX} cy={CY} r={R_MAX + 14} fill="transparent" className="dm-hit" />
      {/* corner fan frame */}
      <path d={arcPath(0, VB, 212, 2, 88)} className="dm-hud-dim" fill="none" strokeDasharray="1 5" />
      <path d={`M 4 ${VB - 60} L 4 ${VB - 4} L 60 ${VB - 4}`} className="dm-hud-stroke" fill="none" opacity={0.5} />
      <circle cx={CX} cy={CY} r={R + 20} fill="url(#dmDialBg)" />
      {/* swim sector (fan) */}
      <path d={sectorPath(CX, CY, 0, R_MAX, -SWIM_HALF, SWIM_HALF)} className="dm-swim-wedge" />
      <path d={sectorPath(CX, CY, SWIM_R, R_MAX, -SWIM_HALF, SWIM_HALF)} className="dm-swim-band" />
      <path d={ticksPath(CX, CY, SWIM_R + 2, R_MAX - 2, -SWIM_HALF + 5, SWIM_HALF - 5, 5)} className="dm-swim-ticks" />
      <text className="dm-hud-text dm-dial-swim-label">
        <textPath href="#dmSwimArc" startOffset="50%" textAnchor="middle">
          {swimLabel}
        </textPath>
      </text>
      {/* outer ring segment + ticks (open at the top where the fan is) */}
      <path d={arcPath(CX, CY, R_MAX + 2, SWIM_HALF + 6, 360 - SWIM_HALF - 6)} className="dm-hud-dim" fill="none" />
      <path d={ticksPath(CX, CY, R + 4, R + 8, SWIM_HALF + 10, 360 - SWIM_HALF - 10, 10)} className="dm-hud-dim" />
      <path d={ticksPath(CX, CY, R + 4, R + 12, 90, 270, 90)} className="dm-hud-stroke" />
      {/* base ring + inner ring + crosshair */}
      <circle cx={CX} cy={CY} r={R} className="dm-hud-stroke" fill="none" />
      <circle cx={CX} cy={CY} r={20} className="dm-hud-dim" fill="none" strokeDasharray="2 3" />
      <path
        d={`M ${CX} ${CY - R + 6} L ${CX} ${CY - 26} M ${CX} ${CY + 26} L ${CX} ${CY + R - 6} M ${CX - R + 6} ${CY} L ${CX - 26} ${CY} M ${CX + 26} ${CY} L ${CX + R - 6} ${CY}`}
        className="dm-hud-dim"
      />
      {/* thumb */}
      <line x1={CX} y1={CY} x2={CX + tx} y2={CY + ty} className="dm-hud-stroke" opacity={active ? 0.6 : 0} />
      <g transform={`translate(${CX + tx} ${CY + ty})`} className="dm-thumb">
        <circle r={17} className="dm-thumb-ring" />
        <circle r={11} className="dm-thumb-core" />
        <circle r={3} className="dm-hud-fill" />
      </g>
    </svg>
  );
}
