/**
 * The base core on the heading compass (same arc as Readout's Compass and
 * CacheMarks): a house mark at its bearing with the distance, or an edge
 * chevron beyond the ±55° shown.
 */
import type { BaseTelemetry } from "../../scene/base/telemetry";
import { polar } from "../geom";

const W = 260;
const R = 260;
const CX = W / 2;
const CY = R + 18;
const SCALE = 0.6;
const SPAN = 55;

export function HomeMark({ base, title }: { base: BaseTelemetry; title: (m: number) => string }) {
  const h = base.home;
  if (!h) return null;
  const inside = Math.abs(h.bearing) <= SPAN;
  const a = Math.max(-SPAN, Math.min(SPAN, h.bearing)) * SCALE;
  const [x, y] = polar(CX, CY, R - 10, a);
  const [tx, ty] = polar(CX, CY, R - 21, a);
  const m = Math.round(h.distance);
  return (
    <svg className="dm-compass dm-home-mark" viewBox={`0 0 ${W} 60`} role="img" aria-label={title(m)}>
      <g className={`dm-home${inside ? "" : " edge"}`}>
        <title>{title(m)}</title>
        {inside ? (
          <path d={`M ${x - 4} ${y + 4} L ${x - 4} ${y - 1} L ${x} ${y - 5} L ${x + 4} ${y - 1} L ${x + 4} ${y + 4} Z`} transform={`rotate(${a} ${x} ${y})`} />
        ) : (
          <path d={h.bearing > 0 ? `M ${x - 3} ${y - 4} L ${x + 3} ${y} L ${x - 3} ${y + 4}` : `M ${x + 3} ${y - 4} L ${x - 3} ${y} L ${x + 3} ${y + 4}`} fill="none" />
        )}
        {base.atBase ? null : (
          <text x={tx} y={ty} className="dm-hud-text dm-hud-small" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${a} ${tx} ${ty})`}>
            {m}m
          </text>
        )}
      </g>
    </svg>
  );
}
