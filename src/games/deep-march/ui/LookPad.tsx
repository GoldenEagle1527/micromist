/** Transparent layer under the panel widgets: drag anywhere else to look (touch or mouse). */
import { useRef } from "react";

export function LookPad({ onLook }: { onLook: (dx: number, dy: number, touch: boolean) => void }) {
  const pid = useRef<number | null>(null);
  const last = useRef<[number, number]>([0, 0]);
  return (
    <div
      className="dm-lookpad"
      onPointerDown={(e) => {
        if (pid.current !== null) return;
        pid.current = e.pointerId;
        last.current = [e.clientX, e.clientY];
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pid.current) return;
        onLook(e.clientX - last.current[0], e.clientY - last.current[1], e.pointerType !== "mouse");
        last.current = [e.clientX, e.clientY];
      }}
      onPointerUp={(e) => {
        if (e.pointerId === pid.current) pid.current = null;
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === pid.current) pid.current = null;
      }}
    />
  );
}
