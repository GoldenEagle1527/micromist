/**
 * Minimal holographic readout: the heading compass (top centre), depth + thin
 * battery bar (top left) with whatever needs saying right now under it (low
 * battery, the mode's gauges, contact), and the toast lane under the compass
 * (a new region for 3 s; keyboard play: the light switching).
 */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { Telemetry } from "../scene/world";
import { REGION_COLORS, REGION_KEYS, type RegionKey } from "../terrain/regions";
import { arcPath, polar } from "./geom";
import { BatteryGauge, type BatteryLabels } from "./BatteryGauge";

export type ReadoutLabels = BatteryLabels & {
  depth: string;
  stateSwim: string;
  contactFloor: string;
  contactCeiling: string;
  contactWall: string;
  regionTitle: string;
  /** Toast on entering a region (followed by its name). */
  regionEnter: string;
  regions: Record<RegionKey, string>;
};

const CARDINAL: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };

/** Re-renders only when the (0.5°-rounded) heading changes. */
const Compass = memo(function Compass({ heading }: { heading: number }) {
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
});

/** Shows `key` for `ms` after it changes (not for the first value when `skipFirst`). */
function useFlash<T>(key: T | null, ms: number, skipFirst: boolean): T | null {
  const [shown, setShown] = useState<T | null>(null);
  const first = useRef(true);
  const timer = useRef(0);
  useEffect(() => {
    if (key === null) return;
    if (first.current) {
      first.current = false;
      if (skipFirst) return;
    }
    setShown(key);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(null), ms);
  }, [key, ms, skipFirst]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return shown;
}

/**
 * `extra`: what sits under the battery (sonar recharge chip, conserve: tank, base energy);
 * `lightToast`: keyboard play shows the light switching under the compass (touch: the LAMP button shows it).
 */
export function Readout({ tel, labels, extra, lightToast }: { tel: Telemetry | null; labels: ReadoutLabels; extra?: ReactNode; lightToast: boolean }) {
  const region = useFlash(tel?.ready ? tel.region : null, 3000, false);
  const lightKey = tel ? (tel.light.on ? tel.light.mode : "off") : null;
  const light = useFlash(lightToast && tel?.ready ? lightKey : null, 1400, true);
  if (!tel) return null;
  const contact =
    tel.contact === "floor"
      ? labels.contactFloor
      : tel.contact === "ceiling"
        ? labels.contactCeiling
        : tel.contact === "wall"
          ? labels.contactWall
          : "";
  const observing = tel.scan.observe;
  return (
    <>
      <Compass heading={Math.round(tel.heading * 2) / 2} />
      {!observing && (region || light) ? (
        <div className="dm-toasts" role="status">
          {region ? (
            <div className="dm-toast dm-region-toast" data-region={region} key={`r${region}`}>
              <i style={{ background: REGION_COLORS[REGION_KEYS.indexOf(region)] }} />
              <small>{labels.regionEnter}</small>
              <span>{labels.regions[region]}</span>
            </div>
          ) : null}
          {light ? (
            <div className="dm-toast dm-light-toast" data-mode={light} key={`l${light}`}>
              {light === "off" ? labels.lightOff : labels.lightModes[light]}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className="dm-readout"
        data-state={tel.state}
        data-region={tel.region ?? undefined}
        data-y={tel.y.toFixed(3)}
        data-x={tel.x.toFixed(3)}
        data-z={tel.z.toFixed(3)}
        data-ticks={tel.ticks}
      >
        <div className="dm-readout-frame">
          <div className="dm-readout-label">{labels.depth}</div>
          <div className="dm-readout-depth">
            {tel.depth.toFixed(1)}
            <small>m</small>
          </div>
          <BatteryGauge tel={tel} labels={labels} />
        </div>
        {extra}
        {contact ? <div className="dm-readout-warn">⚠ {contact}</div> : null}
      </div>
    </>
  );
}
