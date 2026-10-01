/**
 * Bottom-right fan of big sectors along a quarter arc — only what touch play
 * needs right now:
 * - DOWN / UP (hold);
 * - LAMP: tap = on / off, hold = switch beam / high beam (icon + label show the mode);
 * - PING: tap = sonar ping (an arc shows the recharge), hold = sonar observation view;
 * - one context slot: PLACE while building, else ABSORB while aiming at a node or
 *   cache (or still holding it), else BUILD where building is possible (conserve).
 * Swimming lives on the move dial (its outer SWIM arc; double-tap keeps it on).
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { arcPath, polar, sectorPath, ticksPath } from "./geom";
import type { LightMode } from "../survival";
import { IconAbsorb, IconBeam, IconBuild, IconDown, IconHighBeam, IconLamp, IconPlace, IconSonar, IconUp } from "./icons";

const MODE_ICON: Record<LightMode, ReactNode> = { beam: <IconBeam />, high: <IconHighBeam /> };

const VB = 240;
const OX = VB;
const OY = VB;
const R0 = 80;
const R1 = 160;
// screen angles (0 = up, clockwise): the quarter from left (270°) to up (360°)
const A0 = 270;
const A1 = 360;
const GAP = 1.6;
/** Hold this long for a button's second action (LAMP: light mode, PING: observation). */
const LONG_MS = 450;

type HoldId = "up" | "down" | "absorb";
/** Tap and hold do different things. */
export type FanPressId = "lamp" | "ping";
export type FanToggleId = "build" | "place";

type Btn = {
  id: HoldId | FanPressId | FanToggleId;
  label: string;
  icon: ReactNode;
  kind: "hold" | "press" | "toggle";
  on: boolean;
  extra?: string;
};

export function ActionFan({
  labels,
  lampOn,
  lampLocked,
  lightMode,
  swimming,
  onHold,
  onToggle,
  onPress,
  ping,
  absorb,
  build,
  place,
  contextSlot,
}: {
  labels: { up: string; down: string; lamp: string; modes: Record<LightMode, string> };
  lampOn: boolean;
  /** Battery flat: lamp can't switch on. */
  lampLocked: boolean;
  lightMode: LightMode;
  swimming: boolean;
  onHold: (id: HoldId, on: boolean) => void;
  onToggle: (id: FanToggleId) => void;
  /** LAMP / PING: `long` = held past LONG_MS. */
  onPress: (id: FanPressId, long: boolean) => void;
  /** Sonar ping button (omitted without the sonar unit): lit when a ping would go out; `charge` 0..1; `observe` = the scan view is on. */
  ping?: { label: string; ready: boolean; charge: number; observe: boolean };
  /** Conserve: the absorb hold button; shown while `target` (aiming at a node / cache) or while held. */
  absorb?: { label: string; active: boolean; target: boolean };
  /** Conserve: build mode toggle, shown where building is possible. */
  build?: { label: string; active: boolean };
  /** Build mode on: place the building (lit when the spot is valid); takes the context slot. */
  place?: { label: string; ok: boolean };
  /** Keep the context slot's place even while it is empty (conserve), so the other buttons never move under a thumb. */
  contextSlot: boolean;
}) {
  const [held, setHeld] = useState<Record<HoldId, boolean>>({ up: false, down: false, absorb: false });
  const [pressing, setPressing] = useState<FanPressId | null>(null);
  const owners = useRef(new Map<number, HoldId>());
  const press = useRef<{ pointer: number; id: FanPressId; timer: number; fired: boolean } | null>(null);
  useEffect(() => () => window.clearTimeout(press.current?.timer ?? 0), []);

  const context: Btn | null = place
    ? { id: "place", label: place.label, icon: <IconPlace />, kind: "toggle", on: place.ok }
    : absorb && (absorb.target || held.absorb)
      ? { id: "absorb", label: absorb.label, icon: <IconAbsorb />, kind: "hold", on: held.absorb || absorb.active }
      : build
        ? { id: "build", label: build.label, icon: <IconBuild />, kind: "toggle", on: build.active }
        : null;
  const buttons: Btn[] = [
    { id: "down", label: labels.down, icon: <IconDown />, kind: "hold", on: held.down },
    { id: "up", label: labels.up, icon: <IconUp />, kind: "hold", on: held.up },
    { id: "lamp", label: lampOn ? labels.modes[lightMode] : labels.lamp, icon: lampOn ? MODE_ICON[lightMode] : <IconLamp />, kind: "press", on: lampOn },
    ...(ping ? [{ id: "ping", label: ping.label, icon: <IconSonar />, kind: "press", on: ping.ready, extra: ping.observe ? " observe" : "" } as Btn] : []),
    ...(context ? [context] : []),
  ];
  const slots = buttons.length + (contextSlot && !context ? 1 : 0);
  const seg = (A1 - A0) / slots;

  const down = (b: Btn) => (e: RPointerEvent<SVGGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (b.kind === "toggle") {
      onToggle(b.id as FanToggleId);
      return;
    }
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    if (b.kind === "press") {
      if (press.current) return;
      const id = b.id as FanPressId;
      const p = { pointer: e.pointerId, id, timer: 0, fired: false };
      p.timer = window.setTimeout(() => {
        p.fired = true;
        setPressing(null);
        onPress(id, true);
      }, LONG_MS);
      press.current = p;
      setPressing(id);
      return;
    }
    const id = b.id as HoldId;
    owners.current.set(e.pointerId, id);
    setHeld((h) => ({ ...h, [id]: true }));
    onHold(id, true);
  };
  /** `tap`: a real release (not a cancel) ends a short press as a tap. */
  const up = (tap: boolean) => (e: RPointerEvent<SVGGElement>) => {
    const p = press.current;
    if (p && p.pointer === e.pointerId) {
      press.current = null;
      window.clearTimeout(p.timer);
      setPressing(null);
      if (!p.fired && tap) onPress(p.id, false);
      return;
    }
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
      {slots > 1 ? <path d={ticksPath(OX, OY, R1 + 12, R1 + 21, A0 + seg, A1 - seg, seg)} className="dm-hud-stroke" /> : null}
      <path d={arcPath(OX, OY, R0 - 8, A0 + 2, A1 - 2)} className="dm-hud-dim" fill="none" strokeDasharray="2 4" />
      <path d={sectorPath(OX, OY, 0, R0 - 14, A0, A1)} className="dm-fan-core" />
      {buttons.map((b, i) => {
        const a0 = A0 + i * seg + GAP;
        const a1 = A0 + (i + 1) * seg - GAP;
        const mid = (a0 + a1) / 2;
        const [ix, iy] = polar(OX, OY, (R0 + R1) / 2 + 6, mid);
        const [lx, ly] = polar(OX, OY, (R0 + R1) / 2 - 20, mid);
        const charge = b.id === "ping" && ping && !ping.ready ? ping.charge : null;
        return (
          <g
            key={b.id}
            className={`dm-fan-btn dm-fan-${b.id}${b.on ? " on" : ""}${b.extra ?? ""}${pressing === b.id ? " pressing" : ""}${lampLocked && b.id === "lamp" ? " locked" : ""}`}
            data-mode={b.id === "lamp" ? (lampOn ? lightMode : "off") : undefined}
            onPointerDown={down(b)}
            onPointerUp={up(true)}
            onPointerCancel={up(false)}
            onLostPointerCapture={up(false)}
            onContextMenu={(e) => e.preventDefault()}
            role="button"
            aria-label={b.label}
            aria-pressed={b.on}
          >
            <path d={sectorPath(OX, OY, R0, R1, a0, a1)} className="dm-fan-seg" />
            <path d={arcPath(OX, OY, R1 - 4, a0 + 2, a1 - 2)} className="dm-fan-edge" fill="none" />
            {charge !== null ? <path d={arcPath(OX, OY, R1 - 4, a0 + 2, a0 + 2 + (a1 - a0 - 4) * Math.max(0.02, charge))} className="dm-fan-charge" fill="none" /> : null}
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
