/**
 * Bottom-right fan-shaped button cluster: annular sectors along a quarter arc
 * around the corner — Down / Up (hold), Swim (toggle latch), Lamp (on/off),
 * Mode (cycle beam / high beam / night vision; icon + label show the current mode).
 */
import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { arcPath, polar, sectorPath, ticksPath } from "./geom";
import type { LightMode } from "../survival";
import { IconBeam, IconDown, IconHighBeam, IconLamp, IconNightVision, IconSwim, IconUp } from "./icons";

const MODE_ICON: Record<LightMode, ReactNode> = { beam: <IconBeam />, high: <IconHighBeam />, night: <IconNightVision /> };

const VB = 240;
const OX = VB;
const OY = VB;
const R0 = 80;
const R1 = 160;
// screen angles (0 = up, clockwise): the quarter from left (270°) to up (360°)
const A0 = 270;
const A1 = 360;
const GAP = 1.6;

type Btn = {
  id: "down" | "up" | "swim" | "lamp" | "mode";
  label: string;
  icon: ReactNode;
  kind: "hold" | "toggle";
  on: boolean;
};

export function ActionFan({
  labels,
  lampOn,
  lampLocked,
  lightMode,
  swimLatch,
  swimming,
  stateLabel,
  speed,
  onHold,
  onToggle,
}: {
  labels: { up: string; down: string; swim: string; lamp: string; mode: string };
  lampOn: boolean;
  /** Battery flat: lamp can't switch on. */
  lampLocked: boolean;
  lightMode: LightMode;
  swimLatch: boolean;
  swimming: boolean;
  stateLabel: string;
  speed: number;
  onHold: (id: "up" | "down", on: boolean) => void;
  onToggle: (id: "swim" | "lamp" | "mode") => void;
}) {
  const [held, setHeld] = useState<{ up: boolean; down: boolean }>({ up: false, down: false });
  const owners = useRef(new Map<number, "up" | "down">());

  const buttons: Btn[] = [
    { id: "down", label: labels.down, icon: <IconDown />, kind: "hold", on: held.down },
    { id: "up", label: labels.up, icon: <IconUp />, kind: "hold", on: held.up },
    { id: "swim", label: labels.swim, icon: <IconSwim />, kind: "toggle", on: swimLatch || swimming },
    { id: "lamp", label: labels.lamp, icon: <IconLamp />, kind: "toggle", on: lampOn },
    { id: "mode", label: labels.mode, icon: MODE_ICON[lightMode], kind: "toggle", on: lampOn },
  ];
  const seg = (A1 - A0) / buttons.length;

  const down = (b: Btn) => (e: RPointerEvent<SVGGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (b.kind === "toggle") {
      onToggle(b.id as "swim" | "lamp" | "mode");
      return;
    }
    const id = b.id as "up" | "down";
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    owners.current.set(e.pointerId, id);
    setHeld((h) => ({ ...h, [id]: true }));
    onHold(id, true);
  };
  const up = (e: RPointerEvent<SVGGElement>) => {
    const id = owners.current.get(e.pointerId);
    if (!id) return;
    owners.current.delete(e.pointerId);
    if ([...owners.current.values()].includes(id)) return;
    setHeld((h) => ({ ...h, [id]: false }));
    onHold(id, false);
  };

  return (
    <svg className={`dm-fan${swimming ? " lit" : ""}`} viewBox={`0 0 ${VB} ${VB}`}>
      {/* frame arcs + ticks */}
      <path d={arcPath(OX, OY, R1 + 10, A0 + 1, A1 - 1)} className="dm-hud-dim" fill="none" />
      <path d={ticksPath(OX, OY, R1 + 12, R1 + 16, A0 + 3, A1 - 3, 3)} className="dm-hud-dim" />
      <path d={ticksPath(OX, OY, R1 + 12, R1 + 21, A0 + seg, A1 - seg, seg)} className="dm-hud-stroke" />
      <path d={arcPath(OX, OY, R0 - 8, A0 + 2, A1 - 2)} className="dm-hud-dim" fill="none" strokeDasharray="2 4" />
      {/* core: state */}
      <path d={sectorPath(OX, OY, 0, R0 - 14, A0, A1)} className="dm-fan-core" />
      <text x={OX - 36} y={OY - 42} className="dm-hud-text dm-fan-state" textAnchor="middle">
        {stateLabel}
      </text>
      <text x={OX - 36} y={OY - 28} className="dm-hud-text dm-hud-small" textAnchor="middle">
        {speed.toFixed(1)} m/s
      </text>
      {buttons.map((b, i) => {
        const a0 = A0 + i * seg + GAP;
        const a1 = A0 + (i + 1) * seg - GAP;
        const mid = (a0 + a1) / 2;
        const [ix, iy] = polar(OX, OY, (R0 + R1) / 2 + 6, mid);
        const [lx, ly] = polar(OX, OY, (R0 + R1) / 2 - 20, mid);
        return (
          <g
            key={b.id}
            className={`dm-fan-btn dm-fan-${b.id}${b.on ? " on" : ""}${lampLocked && (b.id === "lamp" || b.id === "mode") ? " locked" : ""}`}
            data-mode={b.id === "mode" ? lightMode : undefined}
            onPointerDown={down(b)}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
            role="button"
            aria-label={b.label}
            aria-pressed={b.on}
          >
            <path d={sectorPath(OX, OY, R0, R1, a0, a1)} className="dm-fan-seg" />
            <path d={arcPath(OX, OY, R1 - 4, a0 + 2, a1 - 2)} className="dm-fan-edge" fill="none" />
            <g transform={`translate(${ix} ${iy})`} className="dm-fan-icon">
              {b.icon}
            </g>
            <text x={lx} y={ly} className="dm-hud-text dm-fan-label" textAnchor="middle" dominantBaseline="middle">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
