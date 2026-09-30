/**
 * Lost-cache markers on the heading compass (same arc as Readout's Compass):
 * a diamond at the cache's bearing with its distance, or an edge chevron when
 * it is behind / beside the ±55° shown. The compass is the map during the dive.
 */
import type { ExpeditionTelemetry } from "../../scene/expedition/telemetry";
import { polar } from "../geom";

const W = 260;
const R = 260;
const CX = W / 2;
const CY = R + 18;
const SCALE = 0.6;
const SPAN = 55;

export function CacheMarks({ exp, title }: { exp: ExpeditionTelemetry; title: (n: number, m: number) => string }) {
  if (exp.caches.length === 0) return null;
  return (
    <svg className="dm-compass dm-cache-marks" viewBox={`0 0 ${W} 60`} role="img" aria-label={exp.caches.map((c) => title(c.total, Math.round(c.distance))).join(", ")}>
      {exp.caches.map((c) => {
        const inside = Math.abs(c.bearing) <= SPAN;
        const a = Math.max(-SPAN, Math.min(SPAN, c.bearing)) * SCALE;
        const [x, y] = polar(CX, CY, R - 10, a);
        const [tx, ty] = polar(CX, CY, R - 21, a);
        return (
          <g key={c.id} className={`dm-cache-mark${inside ? "" : " edge"}`}>
            <title>{title(c.total, Math.round(c.distance))}</title>
            {inside ? (
              <path d={`M ${x} ${y - 5} L ${x + 4} ${y} L ${x} ${y + 5} L ${x - 4} ${y} Z`} transform={`rotate(${a} ${x} ${y})`} />
            ) : (
              <path d={c.bearing > 0 ? `M ${x - 3} ${y - 4} L ${x + 3} ${y} L ${x - 3} ${y + 4}` : `M ${x + 3} ${y - 4} L ${x - 3} ${y} L ${x + 3} ${y + 4}`} fill="none" />
            )}
            <text x={tx} y={ty} className="dm-hud-text dm-hud-small" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${a} ${tx} ${ty})`}>
              {Math.round(c.distance)}m
            </text>
          </g>
        );
      })}
    </svg>
  );
}
