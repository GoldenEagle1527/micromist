/**
 * Portrait fallback for mobile landscape play: the play area is rendered
 * rotated by ±90° inside a fixed full-viewport container. Pointer events still
 * arrive in screen (client) coordinates; these helpers map them into the
 * rotated play area's local frame. One mutable singleton (a single game runs
 * at a time), updated by DeepMarchGame on every layout change.
 *
 *  deg  90: content rotated clockwise — phone held rotated counter-clockwise
 *           (landscape-primary, home side right). screen = (w − ly, lx)
 *  deg −90: flipped 180° from that. screen = (ly, h − lx)
 */
export type Rotation = 0 | 90 | -90;

export const viewRotation: { deg: Rotation; w: number; h: number } = { deg: 0, w: 0, h: 0 };

/** Screen-space drag delta → play-area delta. */
export function screenDelta(dx: number, dy: number): [number, number] {
  switch (viewRotation.deg) {
    case 90:
      return [dy, -dx];
    case -90:
      return [-dy, dx];
    default:
      return [dx, dy];
  }
}

/** Client point → play-area local point (same origin convention as localRect). */
export function screenToLocal(x: number, y: number): [number, number] {
  switch (viewRotation.deg) {
    case 90:
      return [y, viewRotation.w - x];
    case -90:
      return [viewRotation.h - y, x];
    default:
      return [x, y];
  }
}

/** Element box in play-area local coordinates (axis-aligned since rotation is ±90°). */
export function localRect(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  if (viewRotation.deg === 0) return { left: r.left, top: r.top, width: r.width, height: r.height };
  const [ax, ay] = screenToLocal(r.left, r.top);
  const [bx, by] = screenToLocal(r.right, r.bottom);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}
