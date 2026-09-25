/** Compact holographic readout: heading compass arc (top centre) + depth/state block (top left). */
import type { ReactNode } from "react";
import type { Telemetry } from "../scene/world";
import { arcPath, polar } from "./geom";

export type ReadoutLabels = {
  depth: string;
  speed: string;
  heading: string;
  stateSwim: string;
  stateHover: string;
  contactFloor: string;
  contactCeiling: string;
  contactWall: string;
};

const CARDINAL: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };

function Compass({ heading }: { heading: number }) {
  // Heading tape bent onto an arc: ±60° of heading shown over ±48° of arc.
  const W = 260;
  const cx = W / 2;
  const R = 260;
  const cy = R + 18;
  const scale = 0.6;
  const span = 55;
  const ticks: ReactNode[] = [];
  const first = Math.ceil((heading - span) / 5) * 5;
  for (let h = first; h <= heading + span; h += 5) {
    const a = (h - heading) * scale;
    const hn = ((h % 360) + 360) % 360;
    const major = hn % 45 === 0;
    const mid = hn % 15 === 0;
    const len = major ? 9 : mid ? 6 : 3.5;
    const [x0, y0] = polar(cx, cy, R, a);
    const [x1, y1] = polar(cx, cy, R + len, a);
    const fade = 1 - Math.abs(h - heading) / span;
    ticks.push(
      <line key={`t${h}`} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? "dm-hud-stroke" : "dm-hud-dim"} opacity={0.25 + 0.75 * fade} />,
    );
    if (major || hn % 30 === 0) {
      const [tx, ty] = polar(cx, cy, R + 17, a);
      ticks.push(
        <text
          key={`l${h}`}
          x={tx}
          y={ty}
          className={CARDINAL[hn] ? "dm-hud-text dm-hud-cardinal" : "dm-hud-text dm-hud-small"}
          textAnchor="middle"
          dominantBaseline="middle"
          opacity={0.2 + 0.8 * fade}
          transform={`rotate(${a} ${tx} ${ty})`}
        >
          {CARDINAL[hn] ?? String(hn)}
        </text>,
      );
    }
  }
  return (
    <svg className="dm-compass" viewBox={`0 0 ${W} 60`} aria-hidden="true">
      <path d={arcPath(cx, cy, R - 3, -span * scale, span * scale)} className="dm-hud-dim" fill="none" />
      <path d={arcPath(cx, cy, R, -span * scale - 2, span * scale + 2)} className="dm-hud-stroke" fill="none" opacity={0.55} />
      {ticks}
      <path d={`M ${cx - 5} ${cy - R - 9} L ${cx + 5} ${cy - R - 9} L ${cx} ${cy - R - 2} Z`} className="dm-hud-fill" />
      <rect x={cx - 22} y={cy - R - 3} width={44} height={16} rx={2} className="dm-hud-box" />
      <text x={cx} y={cy - R + 5.5} className="dm-hud-text dm-hud-num" textAnchor="middle" dominantBaseline="middle">
        {String(Math.round(heading) % 360).padStart(3, "0")}°
      </text>
    </svg>
  );
}

export function Readout({ tel, labels }: { tel: Telemetry | null; labels: ReadoutLabels }) {
  if (!tel) return null;
  const swim = tel.state === "swim";
  const contact =
    tel.contact === "floor"
      ? labels.contactFloor
      : tel.contact === "ceiling"
        ? labels.contactCeiling
        : tel.contact === "wall"
          ? labels.contactWall
          : "";
  // pitch ladder: −90…90 → bar
  const pitchPct = 50 - (tel.pitch / 90) * 50;
  return (
    <>
      <Compass heading={tel.heading} />
      <div className="dm-readout" data-state={tel.state} data-y={tel.y.toFixed(3)} data-x={tel.x.toFixed(3)} data-z={tel.z.toFixed(3)} data-ticks={tel.ticks}>
        <div className="dm-readout-frame">
          <div className="dm-readout-label">{labels.depth}</div>
          <div className="dm-readout-depth">
            {tel.depth.toFixed(1)}
            <small>m</small>
          </div>
          <div className="dm-readout-row">
            <span className={`dm-state-chip${swim ? " on" : ""}`}>
              <i />
              {swim ? labels.stateSwim : labels.stateHover}
            </span>
            <span className="dm-readout-speed">
              {tel.speed.toFixed(1)}
              <small>m/s</small>
            </span>
          </div>
          <div className="dm-pitch" aria-hidden="true">
            <span style={{ top: `${pitchPct}%` }} />
          </div>
        </div>
        {contact ? <div className="dm-readout-warn">⚠ {contact}</div> : null}
      </div>
    </>
  );
}
