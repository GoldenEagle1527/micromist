/** Compact holographic readout: heading compass arc (top centre) + depth/state block (top left). */
import type { ReactNode } from "react";
import type { Telemetry } from "../scene/world";
import type { EnvironmentKind } from "../terrain/classify";
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
  terrainTitle: string;
  terrain: Record<EnvironmentKind, string>;
};

/** 16×10 line glyphs per terrain kind (diver = the dot where relevant). */
const TERRAIN_GLYPH: Record<EnvironmentKind, string> = {
  open: "M 1 4 Q 4.5 1 8 4 T 15 4 M 1 8 Q 4.5 5 8 8 T 15 8",
  flat: "M 1 8.5 L 15 8.5 M 3 6.5 L 4 6.5 M 8 6.5 L 9 6.5 M 12 6.5 L 13 6.5",
  slope: "M 1 9 L 15 2 M 1 9 L 15 9",
  cliff: "M 4 1 L 4 9 L 15 9 M 4 1 L 1 1",
  cave: "M 1 9 L 1 5 Q 1 1 8 1 Q 15 1 15 5 L 15 9 Z",
  overhang: "M 1 1.5 L 15 1.5 L 15 9 M 9 9 L 15 9 M 1 1.5 L 1 3.5",
  canyon: "M 2 1 L 5 9 L 11 9 L 14 1",
  ridge: "M 1 9 L 8 1.5 L 15 9",
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
        {tel.terrain ? (
          <div className="dm-terrain" data-kind={tel.terrain} title={labels.terrainTitle}>
            <svg viewBox="0 0 16 10" aria-hidden="true">
              <path d={TERRAIN_GLYPH[tel.terrain]} />
            </svg>
            <span>{labels.terrain[tel.terrain]}</span>
          </div>
        ) : null}
        {contact ? <div className="dm-readout-warn">⚠ {contact}</div> : null}
      </div>
    </>
  );
}
